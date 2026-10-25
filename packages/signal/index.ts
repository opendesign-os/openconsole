/**
 * `@openconsole/signal` — 类型安全的事件发射器。
 *
 * 设计要点：
 * - 事件键到载荷类型的映射（`E extends object`）通过重载与条件类型逐方法精确推导；
 * - 只有一张按键分桶的注册表，通配符占用保留键 `'*'`：`on` / `off` / `has` / `count` /
 *   `listeners` 共享同一套键空间，不额外开一组 watcher 专用入口；
 * - 桶数组写时复制——增删整桶换新，取出的数组不会再被改写，于是派发无需拷贝快照，
 *   handler 内部 `on` / `off` 也不影响当次派发；
 * - `Watcher` 是泛型签名（`<K>(type: K, event: E[K])`），键与载荷保持相关；
 * - `emit` 的载荷走可变长元组 {@link Payload}：只有载荷域包含 `undefined` 的事件才允许省略实参；
 * - `once` 的包装函数通过内部 `WeakMap` 反查原始 handler，使 `off(type, original)` 仍能正确解绑；
 * - `AbortSignal` 联动在**任何**移除路径上都会摘掉 abort 监听，长生命周期的 signal 上不堆积监听器；
 * - 实现 `Symbol.dispose`：允许 `using signal = new Signal(...)` 在作用域结束自动 `clear()`。
 *
 * @packageDocumentation
 */

/** 通配符键：匹配全部事件，在事件映射里是保留键。 */
export type Wildcard = "*";

/** 从事件映射中抽出合法的事件键（与 Object 键空间一致）。 */
export type EventType<E extends object> = Extract<keyof E, string | symbol>;

/** 单事件 handler 签名。 */
export type Handler<T = unknown> = (event: T) => void;

/**
 * 通配符 handler 签名：接收事件名与其对应载荷。
 *
 * @template E 事件键到载荷类型的映射。
 *
 * @remarks 泛型 `K` 让「键」与「载荷」保持相关，派发侧可以直接以具体键调用，
 *   无需先把载荷退化成全键联合再断言。消费侧写 `(type, event) => ...` 时
 *   `K` 实例化为 `EventType<E>`，载荷即全键联合，与直觉一致。
 */
export type Watcher<E extends object = Record<string, unknown>> = <
  K extends EventType<E>,
>(
  type: K,
  event: E[K],
) => void;

/** 单事件 handler 与通配符 handler 的联合（对外描述监听器时使用）。 */
export type Listener<E extends object> = Handler<E[EventType<E>]> | Watcher<E>;

/**
 * {@link Emitter.emit} 的载荷实参。
 *
 * @template E 事件键到载荷类型的映射。
 * @template K 本次派发的事件键。
 *
 * @remarks 载荷域包含 `undefined`（`void` 或 `T | undefined`）时第二个实参可省略，
 *   否则必填——省略与多传都是编译错误。
 */
export type Payload<
  E extends object,
  K extends EventType<E>,
> = undefined extends E[K] ? [event?: E[K]] : [event: E[K]];

/** 取消订阅函数；重复调用无副作用。 */
export type Unsubscribe = () => void;

/**
 * `on` / `once` 的可选项。
 */
export interface Options {
  /**
   * 关联一个 {@link AbortSignal}：abort 时自动取消订阅。
   *
   * @remarks 若传入的 signal 在注册时已经 aborted，则 handler 永不注册。
   */
  signal?: AbortSignal;
}

/**
 * Signal 构造选项（Web API 风格的 `*Init`）。
 *
 * @template E 事件键到载荷类型的映射。
 */
export interface Init<E extends object> {
  /**
   * handler 抛错时的钩子。
   *
   * @remarks
   * - 缺省：将异常上抛（中断当次 `emit` 的剩余 handler 派发）；
   * - 提供时：异常吞到该钩子里，**`emit` 继续向后派发**，方便观察总线类场景。
   */
  rescue?: (
    error: unknown,
    type: EventType<E> | Wildcard,
    handler: Listener<E>,
  ) => void;
}

/**
 * Signal 事件发射器接口（独立暴露便于 mock / 依赖注入）。
 *
 * @template E 事件键到载荷类型的映射。
 */
export interface Emitter<E extends object> {
  /**
   * 注册监听器。
   *
   * @param type 事件键，或通配符 `'*'`——收全部事件，handler 形态为 {@link Watcher}。
   * @param handler 处理函数。
   * @param options 订阅选项，见 {@link Options}。
   * @returns 取消订阅函数；等价于 `off(type, handler)`，重复调用无副作用。
   */
  on<K extends EventType<E>>(
    type: K,
    handler: Handler<E[K]>,
    options?: Options,
  ): Unsubscribe;
  on(type: Wildcard, handler: Watcher<E>, options?: Options): Unsubscribe;

  /**
   * 注册只触发一次的监听器。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @param handler 处理函数，派发一次后自动解绑。
   * @param options 订阅选项，见 {@link Options}。
   * @returns 取消订阅函数；重复调用无副作用。
   *
   * @remarks 触发前调用 `off(type, handler)` 同样可以取消——内部按原始 handler 反查包装函数。
   */
  once<K extends EventType<E>>(
    type: K,
    handler: Handler<E[K]>,
    options?: Options,
  ): Unsubscribe;
  once(type: Wildcard, handler: Watcher<E>, options?: Options): Unsubscribe;

  /**
   * 取消监听。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @param handler 处理函数；省略时移除该键下的全部监听器。
   *
   * @remarks 同一 handler 重复注册时，一次调用只撤一份。
   */
  off<K extends EventType<E>>(type: K, handler?: Handler<E[K]>): void;
  off(type: Wildcard, handler?: Watcher<E>): void;

  /**
   * 派发事件。
   *
   * @param type 事件键。
   * @param payload 事件载荷；仅当载荷域包含 `undefined` 时可省略，见 {@link Payload}。
   * @returns 是否至少有一个监听器接收（含通配符）。
   * @throws handler 抛出的异常——未提供 {@link Init.rescue} 时原样上抛，并中断当次派发
   *
   * @remarks
   * - 派发顺序：**先具体事件 handler，再通配符 handler**；
   * - handler 内部 `on` / `off` 不影响当次派发，下一次 `emit` 才可见。
   */
  emit<K extends EventType<E>>(type: K, ...payload: Payload<E, K>): boolean;

  /**
   * 当前是否存在监听器。
   *
   * @param type 事件键，或通配符 `'*'`；省略时检查全图。
   * @returns 该键（或全图）上有监听器时为 `true`。
   */
  has(type?: EventType<E> | Wildcard): boolean;

  /**
   * 指定事件键的监听器数。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @returns 监听器数，含 `once` 包装；无人监听时为 `0`。
   */
  count(type: EventType<E> | Wildcard): number;

  /**
   * 当前有监听器的事件键。
   *
   * @returns 事件键，按首次注册顺序；通配符以 `'*'` 出现。
   */
  names(): Array<EventType<E> | Wildcard>;

  /**
   * 指定事件键的监听器。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @returns 监听器浅拷贝，外部可遍历但改动不影响内部。
   */
  listeners(type: EventType<E> | Wildcard): Listener<E>[];

  /** 清空全部监听器。 */
  clear(): void;

  /** Disposable 集成：等价于 {@link Emitter.clear}。 */
  [Symbol.dispose](): void;
}

/**
 * Signal 事件发射器实现。
 *
 * @template E 事件键到载荷类型的映射。
 *
 * @example 基础用法
 * ```ts
 * interface AppEvents { 'user:login': { id: number }; error: Error; ready: void; }
 *
 * const signal = new Signal<AppEvents>();
 * const off = signal.on('user:login', user => console.log(user.id));
 * signal.emit('user:login', { id: 1 }); // true
 * signal.emit('ready');                 // void 载荷可省略实参
 * off();
 * ```
 *
 * @example 通配符与一次性监听
 * ```ts
 * signal.on('*', (type, event) => console.log(type, event));
 * signal.once('ready', handler);
 * ```
 *
 * @example AbortSignal 集成
 * ```ts
 * const ac = new AbortController();
 * signal.on('ready', handler, { signal: ac.signal });
 * ac.abort(); // 自动 off
 * ```
 *
 * @example Disposable 资源管理
 * ```ts
 * {
 *   using signal = new Signal<AppEvents>();
 *   signal.on('ready', handler);
 * } // 作用域结束自动 clear()
 * ```
 */
export class Signal<E extends object = Record<string, unknown>>
  implements Emitter<E>
{
  /**
   * 按事件键分桶的监听器，通配符占 `'*'` 桶。
   *
   * @remarks 桶数组写时复制：增删都整桶换新，已取出的数组不再被改写——派发可以直接遍历，
   *   既不拷贝快照也不必防着 handler 内部增删。桶本身不外泄，{@link Signal.listeners}
   *   给的是拷贝。空桶随即删除，于是 `Map.has` 即「这个键有人听吗」。
   */
  private readonly _listeners = new Map<
    EventType<E> | Wildcard,
    readonly Listener<E>[]
  >();

  /**
   * `once` 包装函数 → 原始 handler 的反查表。
   *
   * @remarks 不污染公开类型；`off(type, original)` 通过该映射找到 wrapper 并解绑。
   *   使用 `WeakMap` 让 wrapper 在被 off 后能正常 GC。
   */
  private readonly _origins = new WeakMap<object, Listener<E>>();

  /**
   * 监听器 → 解除其 `AbortSignal` 联动。
   *
   * @remarks 所有移除路径（unsubscribe / off / once 自卸 / clear）都会调用，
   *   保证长生命周期的 `AbortSignal` 上不残留 abort 监听。
   */
  private readonly _aborts = new WeakMap<object, Unsubscribe>();

  /** handler 抛错时的钩子，来自 {@link Init.rescue}。 */
  private readonly _rescue: Init<E>["rescue"];

  /**
   * 创建事件发射器。
   *
   * @param init 构造选项，见 {@link Init}；省略时 handler 抛错会中断 emit。
   */
  public constructor(init?: Init<E>) {
    this._rescue = init?.rescue;
  }

  /**
   * 注册监听器；通配符与具体事件键同住一张表。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @param handler 处理函数。
   * @param options 订阅选项，见 {@link Options}。
   * @returns 取消订阅函数，幂等；`options.signal` 注册时已 aborted 则为空函数。
   */
  public on<K extends EventType<E>>(
    type: K,
    handler: Handler<E[K]>,
    options?: Options,
  ): Unsubscribe;
  public on(type: Wildcard, handler: Watcher<E>, options?: Options): Unsubscribe;
  public on(
    type: EventType<E> | Wildcard,
    handler: Listener<E>,
    options?: Options,
  ): Unsubscribe {
    return this._add(type, handler, options);
  }

  /**
   * 注册只触发一次的监听器：外面包一层，派发时先解绑再调用原 handler。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @param handler 处理函数。
   * @param options 订阅选项，见 {@link Options}。
   * @returns 取消订阅函数，幂等。
   */
  public once<K extends EventType<E>>(
    type: K,
    handler: Handler<E[K]>,
    options?: Options,
  ): Unsubscribe;
  public once(
    type: Wildcard,
    handler: Watcher<E>,
    options?: Options,
  ): Unsubscribe;
  public once(
    type: EventType<E> | Wildcard,
    handler: Listener<E>,
    options?: Options,
  ): Unsubscribe {
    let dispose: Unsubscribe = noop;
    dispose = this._add(type, this._wrap(handler, () => dispose()), options);
    return dispose;
  }

  /**
   * 取消监听。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @param handler 处理函数；省略时整桶摘掉。
   */
  public off<K extends EventType<E>>(type: K, handler?: Handler<E[K]>): void;
  public off(type: Wildcard, handler?: Watcher<E>): void;
  public off(type: EventType<E> | Wildcard, handler?: Listener<E>): void {
    if (handler !== undefined) {
      this._remove(type, handler);
      return;
    }

    const list = this._listeners.get(type);
    if (list === undefined) return;
    for (const entry of list) this._detach(entry);
    this._listeners.delete(type);
  }

  /**
   * 派发事件：先走该键的桶，再走 `'*'` 桶。
   *
   * @param type 事件键。
   * @param payload 事件载荷，见 {@link Payload}。
   * @returns 是否至少有一个监听器接收（含通配符）。
   * @throws handler 抛出的异常——未提供 {@link Init.rescue} 时原样上抛，并中断当次派发
   */
  public emit<K extends EventType<E>>(
    type: K,
    ...payload: Payload<E, K>
  ): boolean;
  public emit(type: EventType<E>, ...payload: [event?: unknown]): boolean {
    // Payload 的条件类型保证：仅当该键载荷域包含 undefined 时实参才可省略，
    // 因此这里取到的值（含 undefined）一定落在合法载荷域内。
    const event = payload[0] as E[EventType<E>];
    let received = false;

    // '*' 桶装的是 watcher，不能按 handler 调用；emit('*') 只走下面的通配符一轮。
    if (type !== "*") {
      // 非 '*' 的桶只由具体事件的 on / once 重载写入，元素必为 Handler。
      const list = this._listeners.get(type) as
        | readonly Handler<E[EventType<E>]>[]
        | undefined;
      if (list !== undefined) {
        received = true;
        for (const handler of list) {
          try {
            handler(event);
          } catch (error) {
            this._fail(error, type, handler);
          }
        }
      }
    }

    // '*' 桶只由通配符 on / once 重载写入，元素必为 Watcher。
    const watchers = this._listeners.get("*") as
      | readonly Watcher<E>[]
      | undefined;
    if (watchers !== undefined) {
      received = true;
      for (const watcher of watchers) {
        try {
          watcher(type, event);
        } catch (error) {
          this._fail(error, "*", watcher);
        }
      }
    }

    return received;
  }

  /**
   * 当前是否存在监听器；空桶即时删除，所以这就是一次查表。
   *
   * @param type 事件键，或通配符 `'*'`；省略时检查全图。
   * @returns 该键（或全图）上有监听器时为 `true`。
   */
  public has(type?: EventType<E> | Wildcard): boolean {
    if (type === undefined) return this._listeners.size > 0;
    return this._listeners.has(type);
  }

  /**
   * 指定事件键的监听器数。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @returns 监听器数，含 `once` 包装；无人监听时为 `0`。
   */
  public count(type: EventType<E> | Wildcard): number {
    return this._listeners.get(type)?.length ?? 0;
  }

  /**
   * 当前有监听器的事件键。
   *
   * @returns 事件键，按首次注册顺序；通配符以 `'*'` 出现。
   */
  public names(): Array<EventType<E> | Wildcard> {
    return [...this._listeners.keys()];
  }

  /**
   * 指定事件键的监听器。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @returns 桶的浅拷贝，改动不影响内部；无人监听时为空数组。
   */
  public listeners(type: EventType<E> | Wildcard): Listener<E>[] {
    const list = this._listeners.get(type);
    return list === undefined ? [] : [...list];
  }

  /** 清空全部监听器，并解除全部 `AbortSignal` 联动。 */
  public clear(): void {
    for (const list of this._listeners.values()) {
      for (const entry of list) this._detach(entry);
    }
    this._listeners.clear();
  }

  /** {@link Signal.clear} 的 Disposable 别名（`using signal = new Signal()` 生效）。 */
  public [Symbol.dispose](): void {
    this.clear();
  }

  /**
   * 注册的公共收口：入桶、`AbortSignal` 联动与幂等 unsubscribe 都在这里。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @param handler 入桶的监听器，可能是 {@link Signal._wrap} 给的包装。
   * @param options 订阅选项。
   * @returns 取消订阅函数，幂等；signal 注册时已 aborted 则为空函数。
   *
   * @remarks 重载签名保证了 `type` 与 `handler` 的对应关系，实现签名表达不了这种相关性
   *   （两个独立形参之间没有可判别的联系），于是按联合类型入桶，取出时在
   *   {@link Signal.emit} 收口。
   */
  private _add(
    type: EventType<E> | Wildcard,
    handler: Listener<E>,
    options: Options | undefined,
  ): Unsubscribe {
    const signal = options?.signal;
    // signal 已 aborted：等价于「立即取消订阅」，返回 no-op
    if (signal?.aborted) return noop;

    const list = this._listeners.get(type);
    this._listeners.set(
      type,
      list === undefined ? [handler] : [...list, handler],
    );

    let active = true;
    const dispose = (): void => {
      if (!active) return;
      active = false;
      this._remove(type, handler);
    };

    if (signal !== undefined) {
      const abort = (): void => {
        dispose();
      };
      signal.addEventListener("abort", abort, { once: true });
      this._aborts.set(handler, () => {
        signal.removeEventListener("abort", abort);
      });
    }

    return dispose;
  }

  /**
   * 包装成一次性监听器：先解绑，再交给原 handler。
   *
   * @param handler 原始监听器。
   * @param dispose 解绑函数，在调用原 handler 之前执行。
   * @returns 包装后的监听器，已登记进 {@link Signal._origins} 以供反查。
   *
   * @remarks 变长实参同时覆盖 `Handler`（一个实参）与 `Watcher`（两个实参）两种调用形态；
   *   断言只因编译器看不到「包装谁，就按谁的形态被调用」这层对应关系。
   *   先解绑后调用，即便原 handler 抛错也不会残留注册。
   */
  private _wrap(handler: Listener<E>, dispose: Unsubscribe): Listener<E> {
    const call = handler as (...args: unknown[]) => void;
    const wrapped: Listener<E> = (...args: unknown[]): void => {
      dispose();
      call(...args);
    };
    this._origins.set(wrapped, handler);
    return wrapped;
  }

  /**
   * 从桶里摘掉一个监听器。
   *
   * @param type 事件键，或通配符 `'*'`。
   * @param handler 注册时传入的函数；`once` 包装经 {@link Signal._origins} 反查。
   *
   * @remarks 只摘第一条匹配：同一 handler 可以重复注册，一次移除只撤一份。
   *   整桶换新而非原地删除，正在派发的那一份数组因此不受影响。
   */
  private _remove(type: EventType<E> | Wildcard, handler: Listener<E>): void {
    const list = this._listeners.get(type);
    if (list === undefined) return;

    const index = list.findIndex(
      (entry) => entry === handler || this._origins.get(entry) === handler,
    );
    // 未命中时 index 为 -1，取下标即 undefined，与「桶里没有这个 handler」合流。
    const dropped = list[index];
    if (dropped === undefined) return;

    this._detach(dropped);
    const rest = list.toSpliced(index, 1);
    if (rest.length === 0) this._listeners.delete(type);
    else this._listeners.set(type, rest);
  }

  /**
   * 解除监听器的 `AbortSignal` 联动。
   *
   * @param entry 被移除的监听器；没挂过 signal 时什么都不做。
   */
  private _detach(entry: Listener<E>): void {
    const abort = this._aborts.get(entry);
    if (abort === undefined) return;
    this._aborts.delete(entry);
    abort();
  }

  /**
   * handler 抛错时的出口。
   *
   * @param error handler 抛出的异常。
   * @param type 正在派发的事件键，通配符为 `'*'`。
   * @param handler 抛错的监听器。
   * @throws 未提供 {@link Init.rescue} 时原样上抛，中断当次 emit；否则吞到钩子里继续派发
   */
  private _fail(
    error: unknown,
    type: EventType<E> | Wildcard,
    handler: Listener<E>,
  ): void {
    if (this._rescue === undefined) throw error;
    this._rescue(error, type, handler);
  }
}

/** 空 unsubscribe 函数，复用避免不必要的闭包分配。 */
const noop: Unsubscribe = () => {};
