# @openconsole/signal

类型安全、支持通配符监听、与 AbortSignal / Disposable 集成的事件发射器。

## 特性

- 完整的 TS 事件映射:事件键 → 载荷类型,逐方法重载推导
- **载荷必填性由类型决定**:`emit` 走可变长元组,只有载荷域含 `undefined`(`void` / `T | undefined`)的事件才允许省略实参
- `*` 通配符监听全部事件;`Watcher` 是泛型签名,键与载荷保持相关
- `once()` 一次性监听,并可通过原始 handler 在触发前手动 `off`
- `AbortSignal` 集成:abort 即自动取消订阅,且**任何**移除路径都会摘掉 abort 监听
- `Symbol.dispose` 集成:`using signal = new Signal()` 自动 `clear()`
- `emit()` 返回 `boolean`(是否有监听器接收)
- 反射 API:`has` / `count` / `names` / `listeners`
- 监听器桶写时复制:派发不拷贝快照,handler 内部 `on/off` 也不影响当次派发
- 可选 `rescue` 钩子接管 handler 异常,emit 继续向后派发
- 零运行时依赖,内部状态不外泄(无可变的公开注册表)

## 在本仓库中使用

```json
{
  "dependencies": {
    "@openconsole/signal": "workspace:*"
  }
}
```

## 使用指南

### 基础用法

```ts
import { Signal } from "@openconsole/signal";

interface AppEvents {
  "user:login": { id: number; name: string };
  "user:logout": void;
  error: Error;
}

const signal = new Signal<AppEvents>();

const off = signal.on("user:login", (user) => {
  console.log(`User logged in: ${user.name}`);
});

signal.emit("user:login", { id: 1, name: "Alice" });
signal.emit("user:logout"); // 载荷为 void,实参可省略
off(); // 幂等:重复调用无副作用
```

载荷必填性由事件映射推导,写错在编译期就会被拦下:

```ts
signal.emit("user:login"); // ✗ 载荷必填
signal.emit("user:logout", { id: 1 }); // ✗ 该事件无载荷
signal.on("error", (e: string) => {}); // ✗ 载荷应为 Error
```

### 通配符监听

`'*'` 是保留键,与具体事件共用 `on` / `once` / `off` / `has` / `count` / `listeners`,
只是 handler 形态多一个事件名:

```ts
signal.on("*", (type, event) => {
  console.log(`[event] ${String(type)}`, event);
});
```

### 一次性监听

```ts
const handler = (error: Error) => console.error(error.message);

signal.once("error", handler);

// 触发前手动取消也可以(内部按原 handler 反查包装函数):
signal.off("error", handler);
```

### AbortSignal 集成

```ts
const ac = new AbortController();
signal.on("user:login", handler, { signal: ac.signal });

// 一次 abort 即清理全部关联订阅
ac.abort();
```

反向也成立:通过 `unsubscribe()` / `off()` / `clear()` / `once` 自卸移除订阅时,
挂在 `AbortSignal` 上的 abort 监听会一并摘掉——长生命周期的 `AbortController`
上不会随订阅次数堆积监听器。

### Disposable 资源管理(TC39 Explicit Resource Management)

```ts
{
  using signal = new Signal<AppEvents>();
  signal.on("user:login", handler);
}
// 离开作用域,自动 signal.clear()
```

### 异常托管

```ts
const signal = new Signal<AppEvents>({
  rescue(error, type, handler) {
    logger.error(`handler for ${String(type)} threw`, error);
  },
});

// handler 抛错被吞到 rescue,emit 继续派发剩余 handler
```

### 反射 / 调试

```ts
signal.has(); // 全图是否有监听器
signal.has("user:login"); // 指定事件键
signal.count("user:login"); // 监听器数
signal.names(); // 有监听器的事件键,按首次注册顺序,'*' 以保留键出现
signal.listeners("user:login"); // 浅拷贝,外部修改不影响内部
```

> 反射 API 不漏出可变引用:`listeners()` 返回拷贝,内部桶不外泄,
> 外部无法借反射 API 改动内部状态。

### 清理

```ts
signal.off("user:login"); // 移除该事件下所有监听器
signal.clear(); // 移除全部
signal[Symbol.dispose](); // 等价 clear()
```

## API

### `class Signal<E>` / `interface Emitter<E>`

泛型 `E` 是事件名到载荷类型的映射;`type` 处处可传具体事件键或 `'*'`。

| 方法                            | 说明                                      | 返回                    |
| ------------------------------- | ----------------------------------------- | ----------------------- |
| `on(type, handler, options?)`   | 注册监听器                                | `Unsubscribe`(幂等)     |
| `once(type, handler, options?)` | 注册一次性监听                            | `Unsubscribe`(幂等)     |
| `off(type, handler?)`           | 取消监听(handler 省略 = 移除该事件下全部) | `void`                  |
| `emit(type, ...payload)`        | 派发事件;载荷必填性见 `Payload<E, K>`     | `boolean`(是否有人接收) |
| `has(type?)`                    | 是否存在监听器(无参数 = 全图)             | `boolean`               |
| `count(type)`                   | 监听器数                                  | `number`                |
| `names()`                       | 有监听器的事件键,按首次注册顺序           | `Array<Key \| '*'>`     |
| `listeners(type)`               | 监听器列表浅拷贝                          | `Array<Listener>`       |
| `clear()`                       | 清空全部监听器                            | `void`                  |
| `[Symbol.dispose]()`            | `clear()` 的 Disposable 别名              | `void`                  |

### 载荷类型 `Payload<E, K>`

```ts
type Payload<E, K> = undefined extends E[K] ? [event?: E[K]] : [event: E[K]];
```

`emit` 只有一个签名,靠这个可变长元组同时表达「必填」与「可省略」:载荷是
`void` 或含 `undefined` 时第二个实参可省略,否则漏传即编译错误。

### `Options`

```ts
interface Options {
  /** abort 时自动取消订阅 */
  signal?: AbortSignal;
}
```

### `Init<E>`

```ts
interface Init<E> {
  /** handler 抛错时的钩子;不提供则异常上抛中断 emit */
  rescue?: (error: unknown, type: EventType<E> | "*", handler: Listener<E>) => void;
}
```

## 行为说明

- **派发顺序**:先具体事件 handler,再通配符 handler。
- **派发隔离**:监听器桶写时复制(增删整桶换新),派发中的那一份数组不会被改写,handler 内部 `on/off` 不影响当次派发(但下一次 emit 反映新状态)。
- **重复注册**:同一 handler 多次 `on()` 会被多次注册并多次调用;每次 `off()` 只移除一份;`on()` 返回的 unsubscribe 只负责它自己那一份,且幂等。
- **`once` 反向 off**:`off(type, originalHandler)` 通过内部 `WeakMap<wrapper, source>` 反查包装函数,可正常解绑;包装函数先解绑再调用原 handler,原 handler 抛错也不残留注册。
- **异常处理**:默认 handler 抛错会中断当次 emit 剩余派发;构造时传 `rescue` 则吞错继续。
- **AbortSignal**:注册时若 signal 已 aborted,直接 no-op 不注册;订阅被任何方式移除时,abort 监听同步摘除。
- **`'*'` 是保留键**:即使事件映射里真有一个名为 `'*'` 的事件,`on('*')` 也按通配符注册;`emit('*')` 则只通知通配符监听器一轮,事件名为 `'*'`。

## 类型安全实现要点

- **一张注册表**:具体事件与通配符同住一个 `Map`,通配符占 `'*'` 桶,反射 API 因此只有一套键空间,不另开 watcher 专用入口。
- **`Watcher` 是泛型签名**:`<K>(type: K, event: E[K]) => void`,键与载荷保持相关。
- **写时复制**:增删整桶换新,派发因此零拷贝、也不必防着 handler 内部增删;拷贝只留在 `listeners()` 这条冷路径上(桶若改为冻结,派发遍历会慢数倍,得不偿失)。
- **断言只剩 4 处边界**,且都带注释说明为何编译器看不到:`emit` 里的两处取桶
  (异构容器,桶与元素形态的对应关系由 `on` / `once` 的重载保证)、一处可变长元组取值,
  以及 `once` 包装的变长实参转调。其余实现全部类型自洽,无非空断言(`!`)。
- **严格度**:继承 `@openconsole/tsconfig/strict`(含 `noUncheckedIndexedAccess`
  与 `exactOptionalPropertyTypes`);该预设目前未开 `strict` 总开关,本包的实现
  在 `tsc --strict` 下同样零报错。

## 开发

```bash
pnpm --filter @openconsole/signal check
```

## License

MIT
