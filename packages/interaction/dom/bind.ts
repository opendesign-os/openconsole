/**
 * @file 绑定：把节点、动作、插件与输入源组装成一次次会话，所有能力都建立在它之上。
 *
 * {@link Binding} 实现 {@link Control}，由各输入源驱动；状态经节点的 {@link View} 共享并渲染。
 * {@link observe} 让外部旁观所有绑定的会话，例如放置区判定。
 * 坐标约定：输入点为屏幕坐标，状态在容器空间，两者之间的映射（frame）在会话开始与滚动时测量。
 */

import type { Matrix } from "@openconsole/matrix";

import {
  Tracker,
  type Action,
  type Context,
  type Input,
  type Plugin,
  type Step,
} from "../core";
import type { Operation, Patch, State } from "../model";
import { hold } from "./flip";
import { keyboard } from "./keyboard";
import { pointer } from "./pointer";
import type { Activation, Control, Keys, Mark, Sensor } from "./sensor";
import { View, type Render } from "./view";

/** 交给旁观者的会话快照；每次通知都新建，不随会话继续变化。 */
export interface Session {
  /** 会话所在的节点。 */
  readonly node: HTMLElement;
  /** 当前状态（容器空间）。 */
  readonly state: State;
  /** 屏幕坐标 → 容器空间的映射；它的逆把状态换回屏幕坐标。 */
  readonly frame: Matrix<2, "affine">;
  /** 当前动作；放置判定只在允许平移时进行。 */
  readonly action: Action;
  /** 最近一次输入（屏幕坐标）；键盘输入没有点。 */
  readonly input: Input;
  /** 绑定选项里的 `data`，例如交给放置区的载荷。 */
  readonly data: unknown;
}

/**
 * 旁观者：收到所有绑定的会话事件，不影响会话本身。
 *
 * 在会话自身的回调与插件之后收到通知；回调里可以调用 {@link observe} 返回的函数取消旁观。
 */
export interface Observer {
  /**
   * 会话开始。
   *
   * @param session 会话快照。
   */
  onStart?(session: Session): void;
  /**
   * 会话推进：每次移动、步进、滚动重放、动画帧，以及松手时的那一帧之后。
   *
   * @param session 会话快照。
   */
  onMove?(session: Session): void;
  /**
   * 会话结束（动画帧停下之后）。
   *
   * @param session 会话快照。
   */
  onEnd?(session: Session): void;
  /**
   * 会话取消，状态已回到起点。
   *
   * @param session 会话快照。
   */
  onCancel?(session: Session): void;
}

/** 句柄或排除区的取值：元素、元素数组，或在节点内按选择器查找。 */
export type Elements = Element | readonly Element[] | string;

/**
 * {@link bind} 的选项；各能力的选项都在此基础上扩展。
 *
 * {@link Binding.update} 只写传入的选项并就地生效，见该方法的说明。
 */
export interface BindOptions {
  /** 把输入点换算成状态的动作，例如 `transform({ translate: true })`。 */
  readonly action: Action;
  /**
   * 输入源；所有绑定缺省共用同一组实例。
   *
   * @default [pointer(), keyboard()]
   */
  readonly sensors?: readonly Sensor[];
  /**
   * 句柄：只有从句柄内按下才开始；缺省时整个节点都是句柄。
   *
   * 选择器在创建绑定或 `update` 改变它时于节点内查找一次，之后新增的元素不会自动成为句柄。
   */
  readonly handle?: Elements;
  /** 排除区：从这里按下不开始，交给外层绑定；选择器的查找时机同 `handle`。 */
  readonly ignore?: Elements;
  /** 插件，按数组顺序处理每一帧的候选状态；本选项里的回调总在所有插件之后。 */
  readonly plugins?: readonly Plugin[];
  /**
   * 指针起动条件，可按指针类型返回不同条件；缺省时按下后第一次移动就开始。
   *
   * @default {}
   */
  readonly activation?: Activation | ((type: string) => Activation);
  /**
   * 句柄与排除区的默认优先级，也决定同一元素上多个绑定的先后。
   *
   * @default 0
   */
  readonly priority?: number;
  /** 自定义渲染，替换默认的 CSS 写入。 */
  readonly render?: Render;
  /** 键盘映射；为空时不挂键盘输入源。 */
  readonly keys?: Keys;
  /** 交给旁观者的载荷，放置区可以读到。 */
  readonly data?: unknown;
  /** 会话开始时调用，此时已加锁并测量了 frame。 */
  readonly onStart?: (context: Context) => void;
  /** 每一帧候选状态经插件处理后调用（位于插件链末尾）；返回值被忽略，不能修改候选状态。 */
  readonly onMove?: (context: Context) => void;
  /** 会话结束时调用（动画帧停下之后），此时锁已释放。 */
  readonly onEnd?: (context: Context) => void;
  /** 会话取消时调用，状态已回到起点。 */
  readonly onCancel?: (context: Context) => void;
  /** 会话改变了状态时，在 `onEnd` 之后收到这次的净变化。 */
  readonly onCommit?: (operation: Operation) => void;
}

/** 一个已登记的标记及其输入源清理函数；重挂输入源时替换 `release`，标记本身不变。 */
interface Entry {
  /** 登记的句柄或排除区标记。 */
  readonly mark: Mark;
  /** 摘除各输入源为该标记挂上的监听；重挂输入源时换成新的清理函数。 */
  release: () => void;
}

/** 全局旁观者。 */
const observers = new Set<Observer>();

/** 缺省输入源：指针与键盘；模块级常量，所有绑定共用同一组实例。 */
const defaults: readonly Sensor[] = [pointer(), keyboard()];

/**
 * 旁观所有绑定的会话，例如放置区判定、全局日志。
 *
 * @param observer 旁观者；同一对象重复添加只算一次。
 * @returns 取消旁观的函数。
 * @example
 * const stop = observe({ onEnd: ({ node, data }) => console.log(node, data) });
 * stop();
 */
export function observe(observer: Observer): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

/**
 * 判断选项里是否有键盘映射；有无变化时要重挂输入源（键盘输入源只在有映射时挂载）。
 *
 * @param options 绑定选项。
 * @returns `keys` 至少有一项时为 `true`。
 */
const keyed = ({ keys = {} }: BindOptions): boolean =>
  Object.keys(keys).length > 0;

/**
 * 把 {@link Elements} 解析成元素列表；选择器在节点内查找（不含节点自身）。
 *
 * @param node 在其内部查找选择器的节点。
 * @param value 句柄或排除区的取值。
 * @returns 元素列表；`value` 为 `undefined` 时为空。
 */
function resolve(
  node: HTMLElement,
  value: Elements | undefined,
): readonly Element[] {
  if (typeof value === "string") return [...node.querySelectorAll(value)];
  return value instanceof Element ? [value] : (value ?? []);
}

/**
 * 一个节点上的一组交互：动作、插件、输入源，以及句柄与排除区。
 *
 * 实现 {@link Control}：输入源或程序调用 start、move、nudge、end、cancel 驱动会话。
 * 状态经节点的 {@link View} 与同一节点上的其他绑定共享，同一时间只有一个会话（Store 锁）。
 *
 * 会话流程：`start` 加锁并测量 frame；`move`、`nudge` 求解、经插件处理后提交并渲染；
 * `end` 先以 `released: true` 再跑一帧，插件仍在动画就继续出帧（`tick`），
 * 停下后收尾：先释放锁（让 onEnd 里的插件能写入状态），再触发 onEnd，状态有变化时触发 onCommit。
 *
 * @example
 * const binding = bind(node, { action: transform({ translate: true }) });
 * const release = binding.handle(title); // 只从标题栏拖
 * release(); // 注销后整个节点恢复为句柄
 * binding.destroy();
 */
export class Binding implements Control {
  /** 被变换的节点。 */
  readonly node: HTMLElement;
  /** 节点的视图，持有共享状态。 */
  readonly #view: View;
  /** 不依赖 DOM 的会话流水线。 */
  readonly #tracker: Tracker;
  /** 已登记的句柄：元素 → 标记与清理函数。 */
  readonly #handles = new Map<Element, Entry>();
  /** 已登记的排除区：元素 → 标记与清理函数。 */
  readonly #ignores = new Map<Element, Entry>();
  /** 把选项里的回调接进插件链；每次调用都读取最新选项，所以更新回调不必替换插件。 */
  readonly #hooks: Plugin = {
    onStart: (context) => this.#options.onStart?.(context),
    onMove: (context) => {
      this.#options.onMove?.(context);
    },
    onEnd: (context) => this.#options.onEnd?.(context),
    onCancel: (context) => this.#options.onCancel?.(context),
    onCommit: (operation) => this.#options.onCommit?.(operation),
  };
  /** 当前选项：构造时的选项合并历次 `update` 写入的部分。 */
  #options: BindOptions;
  /** 没有任何句柄时把节点本身作为句柄的隐式标记。 */
  #fallback: Entry | undefined;
  /** 由选项 `handle`、`ignore` 登记的标记的注销函数；选项变化时只重登这一批，手动登记的保留。 */
  #declared: (() => void)[] = [];
  /** 是否尚未销毁；销毁后不再登记隐式句柄。 */
  #alive = true;
  /** 本次会话的屏幕 → 容器空间映射；滚动时重新测量。 */
  #frame: Matrix<2, "affine"> | undefined;
  /** 最近一次输入；滚动时据此重放，旁观者也读取它。 */
  #input: Input = { points: [] };
  /** 会话期间监听滚动的控制器，收尾时摘除。 */
  #scroll: AbortController | undefined;
  /** 已申请的动画帧。 */
  #request: number | undefined;

  /**
   * 创建绑定：加入节点的共享状态，登记句柄与排除区；没有句柄时整个节点作为句柄。
   *
   * 加入共享状态时立即同步当前状态；给出 `render` 时替换该节点视图的渲染。
   *
   * @param node 被变换的节点。
   * @param options 选项。
   */
  constructor(node: HTMLElement, options: BindOptions) {
    this.node = node;
    this.#options = options;
    this.#view = View.of(node);
    this.#tracker = new Tracker({
      action: options.action,
      plugins: [...(options.plugins ?? []), this.#hooks],
    });
    if (options.render) this.#view.render = options.render;
    this.#view.store.join(this.#tracker);
    this.#mount();
    this.#sync();
  }

  /** 当前选项，含 `update` 写入的部分。 */
  get options(): BindOptions {
    return this.#options;
  }

  /** 当前状态（容器空间）。 */
  get state(): State {
    return this.#tracker.state;
  }

  /** 当前动作；会话中改动作要等下一次会话才生效。 */
  get action(): Action {
    return this.#tracker.action;
  }

  /** 键盘映射；未设置时为空。 */
  get keys(): Keys {
    return this.#options.keys ?? {};
  }

  /** 是否有会话进行中，包括松手后仍在出动画帧的阶段。 */
  get active(): boolean {
    return this.#tracker.active;
  }

  /**
   * 按指针类型取起动条件。
   *
   * @param type `PointerEvent.pointerType`。
   * @returns 该指针类型的起动条件；选项 `activation` 是函数时调用它，否则原样返回。
   */
  activation(type: string): Activation {
    const { activation = {} } = this.#options;
    return typeof activation === "function" ? activation(type) : activation;
  }

  /**
   * 开始会话：先收尾仍在出帧的上一次会话，加锁，结束 FLIP 过渡并让状态跟上布局，
   * 测量 frame，再监听滚动。
   *
   * 滚动监听挂在文档捕获阶段，文档内任何元素滚动都会触发 {@link Binding.refresh}。不只听祖先是有意的：
   * 无关容器（如放置区所在的列表）滚动后，旁观者也靠这次刷新带来的新 frame 重新量取被滚走的目标。
   * 滚动事件随渲染帧派发，每个滚动元素每帧至多一次，开销有限。
   *
   * @param input 起点输入（屏幕坐标）。
   * @returns 是否开始；已有会话、被同一节点上的其他绑定锁住或无法测量 frame 时为 `false`。
   */
  start(input: Input): boolean {
    const tracker = this.#tracker;
    if (tracker.released) this.#close();
    const { store } = this.#view;
    if (tracker.active || !store.lock(tracker)) return false;
    hold(this.node);
    this.#view.prepare();
    const frame = this.#view.frame();
    if (!frame) {
      store.unlock(tracker);
      return false;
    }
    this.#frame = frame;
    this.#input = input;
    this.#scroll = new AbortController();
    this.node.ownerDocument.addEventListener("scroll", () => this.refresh(), {
      capture: true,
      passive: true,
      signal: this.#scroll.signal,
    });
    tracker.start(input, frame);
    this.#notify("onStart");
    return true;
  }

  /**
   * 按输入点推进会话：求解、经插件处理后提交并渲染；插件请求动画时开始出帧。
   *
   * 没有会话或已松手时忽略。
   *
   * @param input 当前输入（屏幕坐标）。
   * @returns 绑定本身。
   */
  move(input: Input): this {
    if (!this.#tracker.active || this.#tracker.released) return this;
    this.#input = input;
    this.#tracker.move(input);
    this.#commit();
    this.#notify("onMove");
    this.#animate();
    return this;
  }

  /**
   * 以一步离散变换推进会话（键盘、滚轮），作用在约束后的当前状态上。没有会话或已松手时忽略。
   *
   * @param step 变换及其所在空间。
   * @returns 绑定本身。
   */
  nudge(step: Step): this {
    if (!this.#tracker.active || this.#tracker.released) return this;
    this.#tracker.nudge(step);
    this.#commit();
    this.#notify("onMove");
    this.#animate();
    return this;
  }

  /**
   * 结束会话：先以 `released: true` 再跑一帧；插件仍在动画就继续出帧，否则立即收尾。
   *
   * 没有会话或已松手时忽略。
   *
   * @param input 结束时的输入；带点时记为最近一次输入。
   * @returns 绑定本身。
   */
  end(input?: Input): this {
    const tracker = this.#tracker;
    if (!tracker.active || tracker.released) return this;
    if (input && input.points.length > 0) this.#input = input;
    tracker.release(input);
    this.#commit();
    this.#notify("onMove");
    if (tracker.animating) this.#animate();
    else this.#close();
    return this;
  }

  /**
   * 取消会话：停止动画帧、释放锁，状态回到起点并触发 onCancel。
   *
   * 松手后仍在出帧的会话同样可以取消；没有会话时忽略。
   *
   * @returns 绑定本身。
   */
  cancel(): this {
    if (!this.#tracker.active) return this;
    this.#halt();
    this.#unlock();
    this.#tracker.cancel();
    this.#commit();
    this.#notify("onCancel");
    return this;
  }

  /**
   * 重新测量：没有会话时让状态跟上布局；会话中重测 frame 并重放最近一次输入（滚动时自动调用）。
   *
   * 重放让被拖元素在滚动后仍贴着指针；frame 测不出来时保持原样。
   *
   * @returns 绑定本身。
   */
  refresh(): this {
    if (!this.#tracker.active) {
      this.#view.prepare();
      return this;
    }
    const frame = this.#view.frame();
    if (!frame) return this;
    this.#frame = frame;
    this.#tracker.move(this.#input, frame);
    this.#commit();
    this.#notify("onMove");
    this.#animate();
    return this;
  }

  /**
   * 只写传入的选项并就地生效，不打断进行中的会话；按引用比较（`!==`），未变化的键不做任何事。
   *
   * - `action`、`plugins`：交给 Tracker，会话中延后到会话结束再替换。
   * - 回调、`keys`、`data`：立即生效（使用时读取最新选项）。
   * - `sensors`、`activation`，或 `keys` 由空变非空（或反之）：重挂所有标记上的输入源。
   * - `handle`、`ignore`、`priority`：重新登记由选项声明的标记，手动登记的保留。
   * - `render`：直接替换。
   *
   * @param options 要修改的选项。
   * @returns 绑定本身。
   */
  update(options: Partial<BindOptions>): this {
    const previous = this.#options;
    this.#options = { ...previous, ...options };
    /** 本次传入了其中任一键，且值与之前不同。 */
    const changed = (...keys: (keyof BindOptions)[]) =>
      keys.some((key) => key in options && options[key] !== previous[key]);
    if (changed("render")) this.#view.render = this.#options.render;
    if (changed("action", "plugins")) {
      this.#tracker.update({
        action: this.#options.action,
        plugins: [...(this.#options.plugins ?? []), this.#hooks],
      });
    }
    if (
      changed("sensors", "activation") ||
      keyed(previous) !== keyed(this.#options)
    ) {
      this.#reattach();
    }
    if (changed("handle", "ignore", "priority")) {
      this.#fallback?.release();
      this.#fallback = undefined;
      this.#mount();
      this.#sync();
    }
    return this;
  }

  /**
   * 写入状态（容器空间）；会话中无效。
   *
   * 写入经共享状态同步给同一节点上的其他绑定并渲染。
   *
   * @param patch 要写入的 `matrix`、`size` 或 `index`。
   * @returns 绑定本身。
   */
  assign(patch: Patch): this {
    this.#view.store.assign(patch);
    return this;
  }

  /**
   * 登记一个句柄：登记后只有从句柄内按下才开始；同一元素重复登记时替换。
   *
   * @param element 句柄元素；命中元素与被变换的节点可以不同。
   * @param options 登记选项。
   * @param options.priority 优先级，缺省为选项 `priority`。
   * @returns 注销函数，可直接用作框架 ref 回调的清理；句柄全部注销后整个节点恢复为句柄。
   */
  handle(element: Element, { priority = this.#priority } = {}): () => void {
    return this.#add(this.#handles, { element, kind: "handle", priority });
  }

  /**
   * 登记一个排除区：从这里按下不开始，交给外层绑定；同一元素重复登记时替换。
   *
   * @param element 排除区元素。
   * @param options 登记选项。
   * @param options.priority 优先级，缺省为选项 `priority`；高于内层句柄时可以覆盖它。
   * @returns 注销函数。
   */
  ignore(element: Element, { priority = this.#priority } = {}): () => void {
    return this.#add(this.#ignores, { element, kind: "ignore", priority });
  }

  /**
   * 销毁：仍在出帧的会话直接收尾，进行中的会话取消；注销全部标记并离开共享状态。可重复调用。
   *
   * 节点的视图与已写入的样式保留，同一节点上的其他绑定不受影响。
   */
  destroy(): void {
    if (!this.#alive) return;
    this.#alive = false;
    if (this.#tracker.released) this.#close();
    else this.cancel();
    for (const entry of [
      ...this.#handles.values(),
      ...this.#ignores.values(),
    ]) {
      entry.release();
    }
    this.#handles.clear();
    this.#ignores.clear();
    this.#declared = [];
    this.#sync();
    this.#view.store.leave(this.#tracker);
    this.#tracker.destroy();
  }

  /** 同 {@link Binding.destroy}，支持 `using` 声明。 */
  [Symbol.dispose](): void {
    this.destroy();
  }

  /** 选项里的默认优先级，缺省为 0；登记句柄、排除区与隐式句柄时使用。 */
  get #priority(): number {
    return this.#options.priority ?? 0;
  }

  /** 重新登记选项 `handle`、`ignore` 声明的标记，先注销上一批。 */
  #mount(): void {
    for (const release of this.#declared) release();
    const { handle, ignore } = this.#options;
    this.#declared = [
      ...resolve(this.node, handle).map((element) => this.handle(element)),
      ...resolve(this.node, ignore).map((element) => this.ignore(element)),
    ];
  }

  /**
   * 在句柄或排除区表里登记标记并挂载输入源，随后同步隐式句柄。
   *
   * @param entries 句柄表或排除区表；同一元素已有登记时先注销旧的。
   * @param mark 要登记的标记。
   * @returns 注销函数；元素已被重新登记时不做任何事，只注销本次登记的那一个。
   */
  #add(entries: Map<Element, Entry>, mark: Mark): () => void {
    entries.get(mark.element)?.release();
    const entry: Entry = { mark, release: this.#attach(mark) };
    entries.set(mark.element, entry);
    this.#sync();
    return () => {
      if (entries.get(mark.element) !== entry) return;
      entries.delete(mark.element);
      entry.release();
      this.#sync();
    };
  }

  /**
   * 让每个输入源为标记挂载监听；输入源取当前选项 `sensors`，缺省为指针与键盘。
   *
   * @param mark 要挂载的标记。
   * @returns 依次调用各输入源清理函数的函数。
   */
  #attach(mark: Mark): () => void {
    const { sensors = defaults } = this.#options;
    const releases = sensors.flatMap((sensor) => sensor(this, mark) ?? []);
    return () => {
      for (const release of releases) release();
    };
  }

  /** 用当前输入源重新挂载全部标记（含隐式句柄），标记本身不变。 */
  #reattach(): void {
    const entries = [...this.#handles.values(), ...this.#ignores.values()];
    for (const entry of this.#fallback
      ? [...entries, this.#fallback]
      : entries) {
      entry.release();
      entry.release = this.#attach(entry.mark);
    }
  }

  /** 没有句柄时把节点本身登记为隐式句柄，有了句柄就撤销；销毁后一律撤销。 */
  #sync(): void {
    const needed = this.#alive && this.#handles.size === 0;
    if (needed && !this.#fallback) {
      const mark: Mark = {
        element: this.node,
        kind: "handle",
        priority: this.#priority,
      };
      this.#fallback = { mark, release: this.#attach(mark) };
    } else if (!needed && this.#fallback) {
      this.#fallback.release();
      this.#fallback = undefined;
    }
  }

  /** 插件请求动画且尚未申请时，向节点所在窗口申请下一帧。 */
  #animate(): void {
    if (this.#request !== undefined || !this.#tracker.animating) return;
    const view = this.node.ownerDocument.defaultView;
    if (view)
      this.#request = view.requestAnimationFrame((time) => this.#tick(time));
  }

  /**
   * 动画帧：以帧时间重放最近一次输入并提交；仍有插件在动画就继续申请，
   * 已松手且动画停下则收尾。
   *
   * @param time `requestAnimationFrame` 给出的帧时间（毫秒）。
   */
  #tick(time: number): void {
    this.#request = undefined;
    const tracker = this.#tracker;
    if (!tracker.active) return;
    tracker.tick(time);
    this.#commit();
    this.#notify("onMove");
    if (tracker.animating) this.#animate();
    else if (tracker.released) this.#close();
  }

  /** 撤销已申请的动画帧。 */
  #halt(): void {
    if (this.#request === undefined) return;
    this.node.ownerDocument.defaultView?.cancelAnimationFrame(this.#request);
    this.#request = undefined;
  }

  /**
   * 收尾：停止动画帧，释放锁（让 onEnd 里的插件能写入状态），结束 Tracker
   * （依次触发 onEnd 与 onCommit），最后通知旁观者。
   */
  #close(): void {
    this.#halt();
    this.#unlock();
    this.#tracker.end();
    this.#notify("onEnd");
  }

  /** 把 Tracker 的状态提交到共享 Store 并渲染；来源是本绑定，同一节点上的其他成员随之同步。 */
  #commit(): void {
    this.#view.store.commit(this.#tracker.state, this.#tracker);
  }

  /** 释放 Store 锁并摘除滚动监听。 */
  #unlock(): void {
    this.#view.store.unlock(this.#tracker);
    this.#scroll?.abort();
    this.#scroll = undefined;
  }

  /**
   * 通知旁观者；没有旁观者或从未测量过 frame 时跳过。
   *
   * 遍历旁观者的副本，旁观者在回调里取消旁观不影响本轮通知。
   *
   * @param name 要调用的旁观者方法。
   */
  #notify(name: keyof Observer): void {
    const frame = this.#frame;
    if (observers.size === 0 || !frame) return;
    const session: Session = {
      node: this.node,
      state: this.#tracker.state,
      frame,
      action: this.#tracker.action,
      input: this.#input,
      data: this.#options.data,
    };
    for (const observer of [...observers]) observer[name]?.(session);
  }
}

/**
 * 创建绑定。所有能力都是它的预设，新能力用同一接口编写。
 *
 * @param node 被变换的节点。
 * @param options 选项。
 * @returns 绑定，等同于 `new Binding(node, options)`。
 * @example
 * const binding = bind(node, {
 *   action: transform({ translate: true, rotate: true, scale: true }),
 *   activation: (type) => (type === "touch" ? { delay: 250, tolerance: 5 } : { distance: 3 }),
 * });
 */
export const bind = (node: HTMLElement, options: BindOptions): Binding =>
  new Binding(node, options);
