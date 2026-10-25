import { Incomplete, Interrupted } from "./error";

/**
 * 可分步推进的运算。全部中间状态都在实例上，因此随时可停、可续：
 * 中断只是停止调用 {@link Task.advance}，再调一次就从原处接着跑。
 *
 * @remarks 契约是接口而不是抽象类——它一个成员都不带实现，而凑得出这四样的不止一种东西：
 *   {@link ready} 的常量任务与 {@link chain} 串起来的两段都不走单步推进。要骨架就继承
 *   {@link Stepwise}，`settle` / `run` / `schedule` 只认这个接口。
 */
export interface Task<T> {
  /** 推进至多 `budget` 个基本步；返回 `false` 表示已跑完。 */
  advance(budget: number): boolean;

  /** 是否已跑完。 */
  readonly settled: boolean;

  /** 完成度 0..1，粒度取决于算法。 */
  readonly progress: number;

  /**
   * 取结果。
   *
   * @throws {@link Incomplete} 任务尚未跑完——中间态一律不对外，避免把未收敛的值当答案用
   */
  result(): T;
}

/**
 * {@link Stepwise} 与 {@link Future} 共享的推进状态：完成标记、进度归一、结果闸门。
 *
 * @remarks 两者只在"一步是同步还是异步"上分家，其余语义逐条一致，因此差异只压在各自的
 *   `advance` 里，共有的那份状态收在这里——两边各存一个 `settled` 迟早会跑偏。
 */
abstract class Progress<T> {
  #settled = false;

  public get settled(): boolean {
    return this.#settled;
  }

  /**
   * 完成度 0..1；跑完即为 1。
   *
   * @remarks 归一收在这里而不是交给各算法：{@link Progress.measure} 的估算多半是
   *   "已处理节点数 / 总数"，而提前终止（摸到终点、提前收敛、图不连通）时那个比值到不了
   *   分母——非连通图上的 Dijkstra 停在 0.5，进度条就永远差一口。
   */
  public get progress(): number {
    return this.#settled ? 1 : this.measure();
  }

  /**
   * 取结果。
   *
   * @throws {@link Incomplete} 任务尚未跑完
   */
  public abstract result(): T;

  /** 未跑完时的完成度估算，0..1；单调不减。 */
  protected abstract measure(): number;

  /**
   * {@link Progress.measure} 的惯用分式：`total` 为 0 时算作已完成。
   *
   * @remarks 空图、空分量、无边——这些边界在每个算法里都要挡一次，漏挡就是 `0/0` 得到
   *   `NaN`，进度条与 `onProgress` 拿到的都是它。收在这里比各算法各写一遍三元表达式可靠。
   */
  protected ratio(done: number, total: number): number {
    return total === 0 ? 1 : done / total;
  }

  /** 供 `result()` 开头调用。@throws {@link Incomplete} 尚未跑完 */
  protected ensure(): void {
    if (!this.#settled) throw new Incomplete(this.progress);
  }

  /** 单步推进答"没活了"时，由 `advance` 调一次。 */
  protected finish(): void {
    this.#settled = true;
  }
}

/**
 * 只需实现单步推进的任务骨架，预算记账与进度归一由基类负责。
 *
 * @remarks 构造函数里只做 O(V) 级的状态分配。与算法同阶的准备工作（排序、建堆、扫全部边）
 *   一律摆进 {@link Stepwise.step}，否则那部分既不受预算约束也中断不了。
 */
export abstract class Stepwise<T> extends Progress<T> implements Task<T> {
  public advance(budget: number): boolean {
    for (let i = 0; i < budget && !this.settled; i++) {
      if (!this.step()) this.finish();
    }
    return !this.settled;
  }

  /** 推进一个基本单位；返回 `false` 表示全部工作已完成。 */
  protected abstract step(): boolean;
}

/**
 * 每一步可以 await 的运算——{@link Task} 的异步孪生，其余语义完全一致：中间状态都在实例上，
 * 因此随时可停、可续、可做检查点。
 *
 * @remarks 另立一支而不是放宽 {@link Task.advance} 的返回值。后者看着更省，实则会在每个
 *   同步驱动点埋雷：`while (task.advance(Infinity));` 遇到 Promise 是恒真，直接变成死循环，
 *   而类型上毫无异样。`Future` 不实现 `Task`，于是 `settle(future)` 当场类型报错。
 *
 *   异步侧没有对应的契约接口（不像 `Task` / {@link Stepwise} 分两层），因为还没有
 *   {@link ready} / {@link chain} 那样不走单步推进的异步实现。真需要时再拆。
 */
export abstract class Future<T> extends Progress<T> {
  /** 推进至多 `budget` 个基本步；返回 `false` 表示已跑完。 */
  public async advance(budget: number): Promise<boolean> {
    for (let i = 0; i < budget && !this.settled; i++) {
      if (!(await this.step())) this.finish();
    }
    return !this.settled;
  }

  /** 推进一个基本单位；返回 `false` 表示全部工作已完成。 */
  protected abstract step(): Promise<boolean>;
}

/** 检查中断的步长：足够大以摊薄检查成本，足够小以保证响应及时。 */
const CHUNK = 4096;

/**
 * 同步跑完。异步任务用 {@link run}。
 *
 * @throws {@link Interrupted} `signal` 已中断；任务现场保留，可再次 settle 续跑
 */
export function settle<T>(task: Task<T>, signal?: AbortSignal): T {
  if (signal === undefined) {
    while (task.advance(Infinity));
    return task.result();
  }
  do {
    if (signal.aborted) throw new Interrupted(task.progress);
  } while (task.advance(CHUNK));
  return task.result();
}

/**
 * 一口气跑完，中途不让出事件循环；同步与异步任务都收。
 *
 * @remarks 异步侧的 {@link settle}。名字不叫 `settleAsync` 是因为它与 settle 有实质差别：
 *   异步任务每一步都可能挂起，"跑完"本身就是一个 `await`。
 *
 * @throws {@link Interrupted} `signal` 已中断；任务现场保留，可再次 run 续跑
 */
export async function run<T>(
  task: Task<T> | Future<T>,
  signal?: AbortSignal,
): Promise<T> {
  do {
    if (signal?.aborted) throw new Interrupted(task.progress);
  } while (await task.advance(CHUNK));
  return task.result();
}

export interface ScheduleOptions {
  /** 每帧推进的步数。 */
  budget?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

/**
 * 分帧推进，帧间让出事件循环，长跑算法不再冻结 UI。同步与异步任务都收。
 *
 * @remarks 每帧让出都要经过一轮宏任务，浏览器对嵌套 `setTimeout` 有约 4ms 的下限，
 *   因此 `budget` 定得过小会让让出成本盖过计算本身。要换别的让出原语（`MessageChannel`、
 *   `scheduler.yield`）就自己驱动 `advance`——它正是为此而公开的。
 *
 *   `await` 同时吃两种：同步任务返回的裸 `boolean` 经它原样通过，只多一轮微任务，
 *   而这里每帧本来就要付一轮宏任务，那点开销淹没在里面。因此不必为两种任务各写一个驱动。
 */
export async function schedule<T>(
  task: Task<T> | Future<T>,
  options: ScheduleOptions = {},
): Promise<T> {
  const { budget = CHUNK, signal, onProgress } = options;
  for (;;) {
    if (signal?.aborted) throw new Interrupted(task.progress);
    const running = await task.advance(budget);
    // 报告放在推进之后、跳出之前，最后一帧才会报出 1——否则进度条永远差一口。
    onProgress?.(task.progress);
    if (!running) break;
    await breathe();
  }
  return task.result();
}

const breathe = (): Promise<void> =>
  new Promise((resume) => {
    setTimeout(resume, 0);
  });

class Ready<T> implements Task<T> {
  public constructor(private readonly _value: T) {}

  public advance(): boolean {
    return false;
  }

  public get settled(): boolean {
    return true;
  }

  public get progress(): number {
    return 1;
  }

  public result(): T {
    return this._value;
  }
}

class Sequence<A, B> implements Task<B> {
  private _second: Task<B> | undefined;

  public constructor(
    private readonly _first: Task<A>,
    private readonly _next: (value: A) => Task<B>,
  ) {}

  /**
   * @remarks 阶段交接处就返回，不在同一次调用里接着推进第二段——否则一次
   *   `advance(budget)` 最坏会花掉 2×budget，分帧时正好卡在换阶段那一帧。
   *   {@link transform} 的第二段是 {@link Ready}，交接即完成，因此不会多让出一帧。
   */
  public advance(budget: number): boolean {
    if (this._second === undefined) {
      if (this._first.advance(budget)) return true;
      this._second = this._next(this._first.result());
      return !this._second.settled;
    }
    return this._second.advance(budget);
  }

  public get settled(): boolean {
    return this._second?.settled ?? false;
  }

  public get progress(): number {
    return this._second === undefined
      ? this._first.progress / 2
      : (1 + this._second.progress) / 2;
  }

  public result(): B {
    if (this._second === undefined) throw new Incomplete(this.progress);
    return this._second.result();
  }
}

/** 已经算完的任务，供组合使用。 */
export const ready = <T>(value: T): Task<T> => new Ready(value);

/** 串联两个阶段：后一阶段由前一阶段的结果构造，中断点贯穿两段。 */
export const chain = <A, B>(
  first: Task<A>,
  next: (value: A) => Task<B>,
): Task<B> => new Sequence(first, next);

/** 变换任务结果，不改变推进节奏。 */
export const transform = <A, B>(
  task: Task<A>,
  convert: (value: A) => B,
): Task<B> => new Sequence(task, (value) => new Ready(convert(value)));
