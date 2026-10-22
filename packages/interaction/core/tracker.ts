/**
 * @file 跟手管线：把输入换算成状态，不依赖 DOM，可用于 canvas、测试与回放。
 *
 * 每帧：输入点经 frame 换到容器空间 → 动作从段基准求出候选（proposed）→ 插件依次约束 →
 * 调整尺寸时按最终尺寸再钉住对边 → 提交。手指数变化或施加 {@link Step} 时，
 * 当前结果收成新的段基准，所以一次会话的结果是各段变换的连乘。
 *
 * 会话生命周期：`start` → 若干次 `move`/`nudge` →（可选）`release` 后若干次 `tick` → `end`；
 * 任一时刻可以 `cancel` 回到起点。DOM 侧的 `bind` 是它的驱动方之一。
 */

import { plane, type Matrix, type Point } from "@openconsole/matrix";

import {
  center,
  centroid,
  delta,
  epsilon,
  merge,
  type Operation,
  type Patch,
  type State,
} from "../model";
import { anchor, pin, resizes, transform, type Action } from "./action";

/** 输入时按下的修饰键。 */
export interface Modifiers {
  /** Shift 键。 */
  readonly shift: boolean;
  /** Alt（Option）键。 */
  readonly alt: boolean;
  /** Ctrl 键。 */
  readonly control: boolean;
  /** Meta（Command、Win）键。 */
  readonly meta: boolean;
}

/** 一次输入：指针、键盘、滚轮与程序调用都换算成这种形态。 */
export interface Input {
  /** 输入点（屏幕坐标），0~2 个；键盘、滚轮输入为空数组。 */
  readonly points: readonly Point<2>[];
  /** 修饰键；程序调用可以省略。 */
  readonly modifiers?: Modifiers;
  /** 原生事件，按需自行收窄类型。 */
  readonly event?: unknown;
  /** 时间戳（毫秒），用于求速度与动画帧；{@link Tracker.tick} 会改写为帧时间。 */
  readonly timestamp?: number;
}

/**
 * 一步离散变换（键盘、滚轮、程序调用），作用在已约束的当前状态上。
 *
 * 空间决定矩阵乘在哪一侧：
 * - `"local"`：右乘 `M·S`，在节点自身坐标里变换，例如绕自身中心旋转。
 * - `"container"`：左乘 `S·M`，在容器空间里变换，例如平移若干像素。
 * - `"screen"`：先换到屏幕再变换 `F·S·F⁻¹·M`，例如绕指针缩放；F 为 frame。
 */
export interface Step {
  /** 变换矩阵，在 `space` 指定的空间里表达。 */
  readonly matrix: Matrix<2, "affine">;
  /** 矩阵所在的空间。 */
  readonly space: "screen" | "container" | "local";
}

/** 插件钩子收到的会话上下文。 */
export interface Context {
  /** 当前候选：`onMove` 里是前面插件处理后的结果，其余钩子里是当前状态。 */
  readonly state: State;
  /** 会话起点状态，取消时回到这里。 */
  readonly origin: State;
  /** 上一次提交的状态（约束之后）。 */
  readonly previous: State;
  /** frame：屏幕坐标 → 容器空间。 */
  readonly frame: Matrix<2, "affine">;
  /** 旋转、缩放保持不动的点（容器空间），见 {@link anchor}。 */
  readonly anchor: Point<2>;
  /** 本次会话的动作，插件按 `action.freedom` 决定行为。 */
  readonly action: Action;
  /** 最近一次输入。 */
  readonly input: Input;
  /** 输入已结束（松手或键盘放下），会话仍在为动画出帧。 */
  readonly released: boolean;
}

/**
 * 插件：在管线各阶段观察或修改状态；约束类插件只实现 `onMove`。
 *
 * 时序：`onStart` → 每帧 `onMove`（按插件顺序传递候选）→ 每次提交后 `onChange`；
 * 结束时 `onEnd`，状态相对起点有变化再调用 `onCommit`；取消时 `onCancel`。
 * 会话中替换的插件在会话结束后生效。
 *
 * @example
 * const floor: Plugin = {
 *   onMove: ({ state }) => {
 *     const [a, b, c, d, e, f] = state.matrix;
 *     return e < 0 ? { ...state, matrix: [a, b, c, d, 0, f] } : undefined;
 *   },
 * }; // 局部原点（左上角）在容器空间里的 x 不小于 0
 */
export interface Plugin {
  /**
   * 加入管线时调用一次。
   *
   * @param context 只含当前状态的上下文。
   */
  onAttach?(context: Pick<Context, "state">): void;
  /**
   * 会话开始，在第一次 `onMove` 之前。
   *
   * @param context 会话上下文，`state` 为起点状态。
   */
  onStart?(context: Context): void;
  /**
   * 每帧调用，按插件顺序依次处理候选。
   *
   * @param context 会话上下文，`state` 为动作求出、经前面插件处理后的候选。
   * @returns 新的候选，交给下一个插件；返回 `undefined` 表示不修改候选。
   */
  onMove?(context: Context): State | undefined;
  /**
   * 会话结束，在 `onCommit` 之前。
   *
   * @param context 会话上下文，`state` 为最终状态。
   */
  onEnd?(context: Context): void;
  /**
   * 会话取消；被调用时状态已回到起点，插件可以在此基础上再写入。
   *
   * @param context 会话上下文，`state` 为起点状态。
   */
  onCancel?(context: Context): void;
  /**
   * 每次提交后调用一次：移动、nudge、帧、release、assign、cancel。
   *
   * @param context 只含刚提交的状态的上下文。
   */
  onChange?(context: Pick<Context, "state">): void;
  /**
   * 会话改变了状态时，在 `onEnd` 之后调用一次。
   *
   * @param operation 本次会话的净变化，见 {@link Operation}。
   */
  onCommit?(operation: Operation): void;
  /** 离开管线时调用一次。 */
  onDetach?(): void;
  /**
   * 是否还需要动画帧。任一插件返回 `true` 时，驱动方每帧调用 {@link Tracker.tick}；
   * 松手后仍为 `true` 时推迟结束，直到所有插件都返回 `false`。
   *
   * @returns 仍需动画帧时为 `true`。
   */
  animating?(): boolean;
}

/** {@link Tracker} 的配置。 */
export interface TrackerOptions {
  /**
   * 动作；会话中更新时从下一次会话起生效。
   *
   * @default transform({ translate: true })
   */
  readonly action?: Action | undefined;
  /**
   * 插件，按顺序执行；会话中更新时在会话结束后替换。
   *
   * @default []
   */
  readonly plugins?: readonly Plugin[] | undefined;
}

/** 进行中的会话。 */
interface Session {
  /** 会话开始时的动作；会话中更新动作不影响本次会话。 */
  readonly action: Action;
  /** 会话起点状态。 */
  readonly origin: State;
  /** 当前 frame，滚动后由驱动方重新测量传入。 */
  frame: Matrix<2, "affine">;
  /** 段基准：本段开始时的状态，动作每帧从这里整体求解。 */
  base: State;
  /** 本段开始时的输入点（容器空间）。 */
  from: readonly Point<2>[];
  /** 最近一次输入点（容器空间）。 */
  points: readonly Point<2>[];
  /** 动作求出、尚未经过插件约束的候选。 */
  proposed: State;
  /** 上一次提交的状态（约束之后）。 */
  previous: State;
  /** 最近一次输入。 */
  input: Input;
  /** 输入已结束，会话只为动画出帧。 */
  released: boolean;
}

/** 尚未写入状态时的初始值：单位矩阵、零尺寸。 */
const initial: State = {
  matrix: plane.identity,
  size: { width: 0, height: 0 },
};

/**
 * 判断净变化是否确有变化：矩阵不是单位矩阵，或宽高有增量；容差为 {@link epsilon}。
 *
 * @param operation 会话的净变化。
 * @returns 超出容差时为 `true`，据此决定是否调用 `onCommit`。
 */
const changed = ({ matrix, size }: Operation): boolean =>
  !plane.equals(matrix, plane.identity, epsilon) ||
  Math.abs(size.width) > epsilon ||
  Math.abs(size.height) > epsilon;

/**
 * 求拖拽热点（屏幕坐标）：有输入点时取其质心；键盘输入时取被拖元素中心在屏幕上的位置。
 *
 * @param context 含 `state`、`frame`、`input` 的上下文，插件上下文与旁观者会话都可以传入。
 * @returns 热点；没有输入点且 frame 不可逆时为 `undefined`。
 */
export function hotspot({
  state,
  frame,
  input,
}: Pick<Context, "state" | "frame" | "input">): Point<2> | undefined {
  if (input.points.length > 0) return centroid(input.points);
  const inverse = plane.invert(frame);
  return inverse && plane.apply(inverse, center(state));
}

/**
 * 把一步 {@link Step} 作用到状态矩阵上，三种空间见 {@link Step}。
 *
 * @param step 变换及其所在空间。
 * @param frame 屏幕坐标 → 容器空间。
 * @param matrix 当前状态矩阵。
 * @returns 新矩阵；`"screen"` 空间下 frame 不可逆时为 `undefined`。
 */
function apply(
  step: Step,
  frame: Matrix<2, "affine">,
  matrix: Matrix<2, "affine">,
): Matrix<2, "affine"> | undefined {
  if (step.space === "local") return plane.multiply(matrix, step.matrix);
  if (step.space === "container") return plane.multiply(step.matrix, matrix);
  const inverse = plane.invert(frame);
  return inverse && plane.multiply(frame, step.matrix, inverse, matrix);
}

/**
 * 跟手管线：维护一个状态，把输入按动作求解、经插件约束后提交。
 *
 * 同一时间最多一个会话。连续输入（`move`）每帧从段基准整体求解，离散输入（`nudge`）作用在
 * 已约束的当前状态上。松手后可由驱动方继续出帧：`release` → 每帧 `tick` → `end`。
 * 所有方法都返回自身，便于链式调用；没有会话时，会话类方法静默忽略。
 *
 * @example
 * const tracker = new Tracker({ plugins: [grid(20)] });
 * tracker.assign({ size: { width: 80, height: 40 } });
 * tracker.start({ points: [{ x: 10, y: 10 }] });
 * tracker.move({ points: [{ x: 47, y: 23 }] });
 * tracker.end();
 * tracker.state.matrix; // [1, 0, 0, 1, 40, 20]：平移吸附到 20 的倍数
 */
export class Tracker {
  /** 当前状态，即最近一次提交的结果。 */
  #state = initial;
  /** 新会话使用的动作。 */
  #action: Action;
  /** 当前插件。 */
  #plugins: readonly Plugin[] = [];
  /** 会话中传入、等会话结束后替换的插件。 */
  #pending: readonly Plugin[] | undefined;
  /** 进行中的会话。 */
  #session: Session | undefined;

  /**
   * 创建管线；状态初始为单位矩阵、零尺寸，插件依次收到 `onAttach`。
   *
   * @param options 动作与插件。
   */
  constructor(options: TrackerOptions = {}) {
    this.#action = options.action ?? transform({ translate: true });
    this.#swap(options.plugins ?? []);
  }

  /** 当前状态，即最近一次提交的结果。 */
  get state(): State {
    return this.#state;
  }

  /** 新会话使用的动作。 */
  get action(): Action {
    return this.#action;
  }

  /** 是否有会话，包括松手后仍在出帧的阶段。 */
  get active(): boolean {
    return this.#session !== undefined;
  }

  /** 输入是否已结束、会话仍在为动画出帧。 */
  get released(): boolean {
    return this.#session?.released ?? false;
  }

  /** 是否有插件请求继续出帧；没有会话时为 `false`。 */
  get animating(): boolean {
    return (
      this.#session !== undefined &&
      this.#plugins.some((plugin) => plugin.animating?.() === true)
    );
  }

  /**
   * 更新动作或插件，省略的保持不变。
   *
   * 会话中传入的插件在会话结束后替换；动作从下一次会话起生效。
   * 替换插件时，离开的调用 `onDetach`，新加入的调用 `onAttach`，两组都有的不打扰。
   *
   * @param options 要更新的项。
   * @returns 自身。
   */
  update({ action, plugins }: TrackerOptions): this {
    if (plugins) {
      if (this.#session) this.#pending = plugins;
      else this.#swap(plugins);
    }
    if (action) this.#action = action;
    return this;
  }

  /**
   * 写入状态；会话中不生效。
   *
   * 不经过动作与插件约束；有变化时通知各插件的 `onChange`。
   *
   * @param patch 要写入的字段。
   * @returns 自身。
   */
  assign(patch: Patch): this {
    const state = merge(this.#state, patch);
    if (state !== this.#state && !this.#session) this.#change(state);
    return this;
  }

  /**
   * 开始会话；已有会话时忽略。
   *
   * 记下起点状态与起始输入点，依次调用插件的 `onStart`；此时不提交新状态。
   *
   * @param input 起始输入，点为屏幕坐标。
   * @param frame 屏幕坐标 → 容器空间；缺省为单位矩阵，即输入点已在状态所在的空间。
   * @returns 自身。
   */
  start(input: Input, frame: Matrix<2, "affine"> = plane.identity): this {
    if (this.#session) return this;
    const state = this.#state;
    const points = input.points.map((point) => plane.apply(frame, point));
    const session: Session = {
      action: this.#action,
      origin: state,
      frame,
      base: state,
      from: points,
      points,
      proposed: state,
      previous: state,
      input,
      released: false,
    };
    this.#session = session;
    const context = this.#context(session, state);
    for (const plugin of this.#plugins) plugin.onStart?.(context);
    return this;
  }

  /**
   * 处理一次连续输入：从段基准整体求解，经插件约束后提交。
   *
   * 点数与段起点不同（第二根手指按下或抬起）时，先把上一帧的候选收成新的段基准，
   * 手指数变化时不跳动。没有会话时忽略。
   *
   * @param input 当前输入，点为屏幕坐标。
   * @param frame 新的 frame，例如滚动后重新测量；缺省沿用当前 frame。
   * @returns 自身。
   */
  move(input: Input, frame?: Matrix<2, "affine">): this {
    const session = this.#session;
    if (!session) return this;
    if (frame) session.frame = frame;
    const points = input.points.map((point) =>
      plane.apply(session.frame, point),
    );
    if (points.length !== session.from.length) {
      session.base = session.proposed;
      session.from = points;
    }
    session.points = points;
    session.input = input;
    session.proposed = session.action.solve(session.base, session.from, points);
    this.#commit(session);
    return this;
  }

  /**
   * 施加一步离散变换（键盘、滚轮），并把结果收成新的段基准。
   *
   * 作用在约束之后的状态上，所以撞到边界后反方向按一次就能离开。
   * 没有会话，或 `"screen"` 空间下 frame 不可逆时忽略。
   *
   * @param step 变换及其所在空间。
   * @returns 自身。
   */
  nudge(step: Step): this {
    const session = this.#session;
    if (!session) return this;
    const matrix = apply(step, session.frame, this.#state.matrix);
    if (!matrix) return this;
    session.proposed = { ...this.#state, matrix };
    session.base = session.proposed;
    session.from = session.points;
    this.#commit(session);
    return this;
  }

  /**
   * 出一帧动画：用最近一次输入重新求解并提交，`input.timestamp` 改为帧时间。
   *
   * 由驱动方在 {@link Tracker.animating} 为真时每帧调用。
   *
   * @param timestamp 帧时间（毫秒），通常取 `requestAnimationFrame` 回调的参数。
   * @returns 自身。
   */
  tick(timestamp: number): this {
    const session = this.#session;
    if (!session) return this;
    session.input = { ...session.input, timestamp };
    session.proposed = session.action.solve(
      session.base,
      session.from,
      session.points,
    );
    this.#commit(session);
    return this;
  }

  /**
   * 输入结束：标记 `released`，并以此再跑一帧，让插件（例如惯性）看到松手。
   *
   * 之后驱动方在 {@link Tracker.animating} 为真时继续 {@link Tracker.tick}，
   * 变为假后调用 {@link Tracker.end}。重复调用无效。
   *
   * @param input 结束时的输入；缺省沿用最近一次输入。
   * @returns 自身。
   */
  release(input?: Input): this {
    const session = this.#session;
    if (!session || session.released) return this;
    session.released = true;
    if (input) session.input = input;
    this.#commit(session);
    return this;
  }

  /**
   * 结束会话：调用插件的 `onEnd`；状态相对起点有变化时，再以净变化调用 `onCommit`。
   *
   * 净变化在 `onEnd` 之前求出，`onEnd` 里的写入（例如移交到别的容器）不计入。
   * 会话中传入的插件随后替换。
   *
   * @param input 结束时的输入；缺省沿用最近一次输入。
   * @returns 自身。
   */
  end(input?: Input): this {
    const session = this.#session;
    if (!session) return this;
    if (input) session.input = input;
    this.#session = undefined;
    const operation = delta(session.origin, this.#state);
    const context = this.#context(session, this.#state);
    for (const plugin of this.#plugins) plugin.onEnd?.(context);
    if (operation && changed(operation)) {
      for (const plugin of this.#plugins) plugin.onCommit?.(operation);
    }
    this.#flush();
    return this;
  }

  /**
   * 取消会话：状态先回到起点，再调用插件的 `onCancel`。
   *
   * 不调用 `onEnd` 与 `onCommit`；会话中传入的插件随后替换。
   *
   * @returns 自身。
   */
  cancel(): this {
    const session = this.#session;
    if (!session) return this;
    this.#session = undefined;
    this.#change(session.origin);
    const context = this.#context(session, session.origin);
    for (const plugin of this.#plugins) plugin.onCancel?.(context);
    this.#flush();
    return this;
  }

  /**
   * 取消进行中的会话，并卸下全部插件（依次调用 `onDetach`）。
   *
   * 会话中传入、尚未生效的插件会随取消先换上，再一并卸下。
   *
   * @returns 自身。
   */
  destroy(): this {
    this.cancel();
    this.#pending = undefined;
    this.#swap([]);
    return this;
  }

  /**
   * 组装插件上下文；锚点按段基准与最近的输入点求出。
   *
   * @param session 进行中的会话。
   * @param state 放进上下文的 `state`。
   * @returns 插件上下文。
   */
  #context(session: Session, state: State): Context {
    return {
      state,
      origin: session.origin,
      previous: session.previous,
      frame: session.frame,
      anchor: anchor(session.action.freedom, session.base, session.points),
      action: session.action,
      input: session.input,
      released: session.released,
    };
  }

  /**
   * 管线的一帧：候选依次经过插件，调整尺寸时按最终尺寸重新钉住对边，再提交。
   *
   * 钉住放在插件之后：插件改了尺寸也不会破坏"对边不动"。
   *
   * @param session 进行中的会话，提供候选、段基准与上下文。
   */
  #commit(session: Session): void {
    const context = this.#context(session, session.proposed);
    let state = session.proposed;
    for (const plugin of this.#plugins) {
      const next = plugin.onMove?.({ ...context, state });
      if (next) state = next;
    }
    const { freedom } = session.action;
    if (resizes(freedom)) {
      state = {
        ...state,
        matrix: pin(session.base, state.size, freedom.edges),
      };
    }
    session.previous = state;
    this.#change(state);
  }

  /**
   * 写入状态，并通知各插件的 `onChange`。
   *
   * @param state 新状态。
   */
  #change(state: State): void {
    this.#state = state;
    for (const plugin of this.#plugins) plugin.onChange?.({ state });
  }

  /** 会话结束后，换成会话中传入的插件。 */
  #flush(): void {
    if (this.#pending) this.#swap(this.#pending);
    this.#pending = undefined;
  }

  /**
   * 换一组插件：离开的调用 `onDetach`，新加入的调用 `onAttach`，保留的不打扰。
   *
   * @param plugins 新的插件列表。
   */
  #swap(plugins: readonly Plugin[]): void {
    const previous = this.#plugins;
    this.#plugins = plugins;
    for (const plugin of previous) {
      if (!plugins.includes(plugin)) plugin.onDetach?.();
    }
    for (const plugin of plugins) {
      if (!previous.includes(plugin)) plugin.onAttach?.({ state: this.#state });
    }
  }
}
