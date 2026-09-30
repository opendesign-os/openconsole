# @openconsole/heap

两种互补的堆实现:常数小的数组二叉堆,与带稳定句柄、支持 decrease-key 的配对堆。

> 元素本身就是**整数下标**(节点编号、数组位置)时,用 [`@openconsole/queue`](../queue/README.md)——
> 它把优先级留在调用方的平行数组里,零元素对象分配、零比较器回调。**堆存值,队列排下标。**

## 特性

- **数组二叉堆** `BinaryHeap`:纯优先队列场景常数最小;批量入堆走 Floyd O(n) 建堆
- **配对堆** `PairingHeap`:`push` 返回可长期持有的句柄,支持摊销 O(log n) 的任意删除与 decrease-key / increase-key
- **共享契约** `Heap<T>`:两者的查询与清理操作统一,便于依赖注入与替换
- **失效句柄安全**:对已出堆的句柄调用 `update` / `delete` 返回 `false`,不会静默破坏堆结构
- **内部状态不外泄**:句柄只暴露只读的 `value`,二叉堆只提供只读快照
- 比较器语义统一(栈顶为最小元素),反转比较器即得最大堆
- 零运行时依赖

## 在本仓库中使用

```json
{
  "dependencies": {
    "@openconsole/heap": "workspace:*"
  }
}
```

## 选哪一个

| 场景                                                 | 选择          | 理由                                    |
| ---------------------------------------------------- | ------------- | --------------------------------------- |
| 只有 push / poll / peek                              | `BinaryHeap`  | 数组布局、无节点对象分配,常数最小       |
| 出堆前需要调整优先级(Dijkstra / A\* 的 decrease-key) | `PairingHeap` | 句柄稳定,`update` 摊销 O(log n)         |
| 需要按元素删除任意位置                               | `PairingHeap` | 句柄删除 O(log n);二叉堆按值删除是 O(n) |
| 需要频繁合并两个堆                                   | `PairingHeap` | `meld` 天然 O(1)                        |

> 若元素是整数下标且需要 decrease-key,先看 [`@openconsole/queue`](../queue/README.md):
> 同一张图上实测,去掉 decrease-key 的惰性队列比配对堆快 1.56x,桶队列快 2.27x。

## 使用指南

### BinaryHeap

```ts
import { BinaryHeap } from "@openconsole/heap";

const heap = new BinaryHeap<number>((a, b) => a - b);

heap.push(5);
heap.push(3, 8, 1); // 多元素:整体追加后 Floyd 建堆,O(n)

heap.peek(); // 1
heap.poll(); // 1
heap.size; // 3

heap.replace(9); // 弹出堆顶并压入 9,只需一次 sift-down
heap.delete(8); // 按值删除(线性查找),返回 boolean
heap.has(9); // 线性查找
heap.snapshot(); // readonly T[](层序,非全序),调试用
```

按字段比较对象,或反转比较器得到最大堆:

```ts
const tasks = new BinaryHeap<{ name: string; cost: number }>((a, b) => a.cost - b.cost);
const max = new BinaryHeap<number>((a, b) => b - a);
```

### PairingHeap

```ts
import { PairingHeap } from "@openconsole/heap";

interface Reach {
  node: string;
  dist: number;
}

const heap = new PairingHeap<Reach>((a, b) => a.dist - b.dist);

const handle = heap.push({ node: "a", dist: 10 });
heap.push({ node: "b", dist: 4 });

heap.update(handle, { node: "a", dist: 1 }); // decrease-key → true
heap.peek(); // { node: 'a', dist: 1 }
handle.value; // 句柄同步反映新值(只读)

heap.delete(handle); // → true
heap.delete(handle); // → false(句柄已失效,堆不受影响)
```

典型的 Dijkstra 用法——句柄存在数组/Map 里,relax 时直接 decrease-key:

```ts
const handles = new Map<NodeId, PairingNode<Reach>>();

for (const edge of graph.outEdges(node)) {
  const candidate = dist + cost(edge);
  const handle = handles.get(edge.target);
  if (handle === undefined) {
    handles.set(edge.target, heap.push({ node: edge.target, dist: candidate }));
  } else if (candidate < handle.value.dist) {
    heap.update(handle, { node: edge.target, dist: candidate });
  }
}
```

## API

### `interface Heap<T>`

两种实现共享的契约(入堆与删除签名各异,不在此约束)。

| 成员      | 说明                            |
| --------- | ------------------------------- |
| `size`    | 当前元素个数                    |
| `peek()`  | 取堆顶但不移除;空堆 `undefined` |
| `poll()`  | 取出并移除堆顶;空堆 `undefined` |
| `empty()` | 是否为空                        |
| `clear()` | 清空                            |

### `class BinaryHeap<T> implements Heap<T>`

| 方法                | 说明                       | 复杂度                  |
| ------------------- | -------------------------- | ----------------------- |
| `push(...values)`   | 入堆,返回元素个数          | 单个 O(log n);批量 O(n) |
| `poll()` / `peek()` | 出堆 / 查看堆顶            | O(log n) / O(1)         |
| `replace(value)`    | 弹出堆顶并压入新值         | O(log n)                |
| `delete(value)`     | 按严格相等移除首个匹配元素 | O(n)                    |
| `has(value)`        | 是否包含                   | O(n)                    |
| `snapshot()`        | 内部数组的只读拷贝         | O(n)                    |

### `class PairingHeap<T> implements Heap<T>`

| 方法                    | 说明                                       | 复杂度               |
| ----------------------- | ------------------------------------------ | -------------------- |
| `push(value)`           | 入堆,返回 `PairingNode<T>` 句柄            | O(1)                 |
| `poll()` / `peek()`     | 出堆 / 查看堆顶                            | 摊销 O(log n) / O(1) |
| `update(handle, value)` | 改值(decrease / increase-key),返回是否成功 | 摊销 O(log n)        |
| `delete(handle)`        | 按句柄删除,返回是否成功                    | 摊销 O(log n)        |

### `interface PairingNode<T>`

```ts
interface PairingNode<T> {
  readonly value: T;
}
```

句柄只暴露 `value`,树指针是实现细节。句柄在元素出堆后失效,对失效句柄调用
`update` / `delete` 会返回 `false`。

### `type Comparator<T>`

```ts
type Comparator<T> = (a: T, b: T) => number;
```

负数表示 `a` 在前,正数表示 `a` 在后,0 表示等价。栈顶恒为比较器意义上的最小元素。

## 行为说明

- **`BinaryHeap` 不维护 `value -> index` 索引**:那会给每个筛选步骤都加一次 Map 写入,
  且元素“同值”(相等原语)时索引互相覆盖会导致按值删除删错元素。需要 O(log n)
  删除请改用 `PairingHeap` 的句柄。
- **重复元素**:`BinaryHeap.delete` 每次只移除一份,其余仍可被 `has` 找到。
- **句柄失效检测**:配对堆的不变式是「根节点 `prev` 为 `null`,在树中的非根节点 `prev` 必非 `null`」,
  据此可 O(1) 判断句柄是否仍在堆内——无需给每个节点加额外标记。
- **`poll` 会解除被弹出节点的全部指针**,避免它拖住已合并的子树导致内存滞留。
- **比较器必须是全序**:并列元素之间的相对顺序不保证(两种堆都不稳定)。

## 类型安全实现要点

- tsconfig 继承 `@openconsole/tsconfig/strict`,含 `noUncheckedIndexedAccess`
  与 `exactOptionalPropertyTypes`。
- **全包只有 1 处类型断言**:配对堆把公开句柄还原成内部节点(`unwrap`)。
- 二叉堆内部的 `!` 断言的是**下标在界内**(由完全二叉树不变式保证),而不是元素非空——
  `T` 本身允许包含 `undefined`,因此刻意不用 `=== undefined` 判空。
- 算法内核抽成不依赖实例的纯函数(`siftUp` / `siftDown` / `meld` / `collapse`),
  可独立复用与验证。

## 模块边界

```
core/
├── types.ts        - Comparator / Heap 公共契约
├── binary/
│   ├── sift.ts     - siftUp / siftDown 纯函数
│   └── heap.ts     - BinaryHeap
└── pairing/
    ├── node.ts     - 句柄类型、内部节点、指针手术(detach / isolate)
    ├── meld.ts     - link / meld / collapse 两阶段配对
    └── heap.ts     - PairingHeap
```

## 开发

```bash
pnpm --filter @openconsole/heap typecheck   # tsc
```

## License

MIT
