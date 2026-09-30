# @openconsole/queue

面向整数下标的优先队列:元素是调用方的整数下标,优先级作为数值单独给出。

与 [`@openconsole/heap`](../heap/README.md) 的分工:**堆存值,队列排下标**。
图算法的典型形态——`dist: Float64Array` + 优先队列——正好落在这一侧:
队列内部不存元素对象、不需要比较器回调,也不需要句柄簿记。

## 特性

- **惰性队列** `LazyQueue`:任意数值优先级。下调优先级不做 decrease-key,改为追加条目,由调用方的 settled 位图跳过过期条目
- **桶队列** `BucketQueue`:非负整数且有界的优先级下 `push` / `poll` 均 O(1)(Dial 算法),侵入式链表实现,零对象分配
- **共享契约** `IndexQueue`:两种实现可直接互换,调用方按权重形态选一个
- **契约违反即抛错**:桶队列的整数 / 单调 / 窗口约束在 `push` 处校验,不静默算错
- 零运行时依赖

## 在本仓库中使用

```json
{
  "dependencies": {
    "@openconsole/queue": "workspace:*"
  }
}
```

## 为什么不用堆

同一张图(V=5000、E≈40000、权重 1..20)上跑单源最短路,同进程 A/B 实测:

| 结构                                | 耗时    | 相对  |
| ----------------------------------- | ------- | ----- |
| `PairingHeap` + decrease-key + 句柄 | 7.20 ms | 1.00x |
| `LazyQueue`                         | 4.59 ms | 1.56x |
| `BucketQueue`                       | 3.17 ms | 2.27x |

**先去掉 decrease-key,再考虑换更花的结构。** 配对堆的 decrease-key 需要为每次松弛
造一个元素对象、维护一个句柄数组、每次比较走一次回调——而节点本来就有整数下标,
距离本来就在 `Float64Array` 里,这些都是重复记账。斐波那契堆理论最优但常数过大,不提供。

## 使用指南

两种实现的消费模式完全一样:**settled 位图跳过过期条目**。这里利用了一条性质——
下标第一次出队时携带的必然是它的最小优先级,所以不需要比较优先级,一个位图就够:

```ts
import { BucketQueue, LazyQueue, type IndexQueue } from "@openconsole/queue";

// 非负整数权重且最大边权已知 → 桶队列;否则 → 惰性队列
const queue: IndexQueue = integral ? new BucketQueue(nodeCount, maxWeight) : new LazyQueue(edgeCount);

const dist = new Float64Array(nodeCount).fill(Infinity);
const settled = new Uint8Array(nodeCount);

dist[source] = 0;
queue.push(source, 0);

for (let u = queue.poll(); u !== -1; u = queue.poll()) {
  if (settled[u] === 1) continue; // 过期条目
  settled[u] = 1;

  for (const [v, w] of edgesOf(u)) {
    const candidate = dist[u] + w;
    if (candidate < dist[v]) {
      dist[v] = candidate;
      queue.push(v, candidate); // 惰性队列追加条目;桶队列就地下调
    }
  }
}
```

### 惰性是什么意思

```
push(v, 9)   push(v, 4)   →   队列里有两条 v
poll() → v   // 优先级 4,这是 v 的最终距离
poll() → v   // 优先级 9,过期条目;settled[v] 已置位,跳过
```

代价是条目数最多涨到 push 次数(图算法里即边数);收益是零句柄、零元素对象。

### 桶队列为什么是 O(1)

按优先级分桶,同优先级挂一条链,出队就是推进游标找第一个非空桶——**不做比较、不做筛选**。
桶以 `maxPriority + 1` 为周期循环复用,因为单调出队保证队列里所有优先级都落在
`[游标, 游标 + maxPriority]` 窗口内。下调优先级是就地重挂,所以永不产生过期条目。

## 选哪一个

|              | `LazyQueue`                 | `BucketQueue`                            |
| ------------ | --------------------------- | ---------------------------------------- |
| 优先级       | 任意数值(含负数、浮点)      | **非负整数**,且落在当前窗口内            |
| 出队顺序要求 | 无                          | **单调非递减**(非负权 Dijkstra 天然满足) |
| 重复 push    | 追加新条目 → 产生过期条目   | 就地下调 → 永不产生过期条目              |
| 条目数上限   | push 次数(最坏为边数)       | 下标数                                   |
| 内存         | 12 字节/条目,自动扩容       | O(capacity + maxPriority),一次分配       |
| 复杂度       | `push` / `poll` 均 O(log k) | `push` O(1),`poll` 摊销 O(1)             |
| 违反约束     | 不存在约束                  | 抛 `RangeError`                          |

`maxPriority` 很大时桶数组和空桶扫描都不划算,此时该退回 `LazyQueue`;
若确实需要「大 C + O(1)」,该上的是 radix heap 或多级桶(本包未实现)。

## API

### `interface IndexQueue`

| 成员                    | 说明                               |
| ----------------------- | ---------------------------------- |
| `size`                  | 条目数                             |
| `push(index, priority)` | 入队(语义见选型表)                 |
| `poll()`                | 取出优先级最小的下标;空队列返回 -1 |
| `empty()` / `clear()`   | 是否为空 / 清空                    |

### `class LazyQueue implements IndexQueue`

```ts
new LazyQueue(capacity?: number); // 初始条目容量,不足时自动翻倍
```

额外提供 `peek(): number`(查看最小优先级的下标,不出队)。

### `class BucketQueue implements IndexQueue`

```ts
new BucketQueue(capacity: number, maxPriority: number);
```

- `capacity`:下标上界(取值范围 `0 .. capacity-1`)
- `maxPriority`:相邻两次出队之间优先级的最大增量;Dijkstra 场景即最大边权

额外提供 `peek(): number` 与 `has(index): boolean`。

## 行为说明

- **过期条目由调用方过滤**:`LazyQueue` 不去重,这是它快的原因;调用方必须持有
  settled 位图(图算法本来就有)。
- **并列优先级的相对顺序不保证**:`LazyQueue` 取决于堆形状,`BucketQueue` 是桶内后进先出。
- **`BucketQueue.clear()` 会把游标归零**,实例可跨多次运行复用。
- **两种实现产出的结果一致**:已在同一张随机图上与朴素 O(n²) Dijkstra 三方比对,
  距离逐项相同——换队列只影响耗时,不影响结果。

## 类型安全实现要点

- tsconfig 继承 `@openconsole/tsconfig/strict`,含 `noUncheckedIndexedAccess`
  与 `exactOptionalPropertyTypes`。
- **全包零类型断言**;`!` 只用于断言 typed-array 下标在界内(由容量不变式保证)。

## 模块边界

```
core/
├── types.ts     - IndexQueue 契约
├── lazy.ts      - LazyQueue(惰性,任意数值优先级)
└── bucket.ts    - BucketQueue(Dial,整数有界优先级)
```

## 开发

```bash
pnpm --filter @openconsole/queue typecheck  # tsc
```

## License

MIT
