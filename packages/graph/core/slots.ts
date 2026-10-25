/**
 * 稳定索引分配器：键与整数索引的双向映射。删除留下的空位进入自由表等待复用，
 * 已分配的索引在 {@link Slots.compact} 之前永不移动，外部持有的索引不会静默改指。
 */
export class Slots<K> {
  private readonly _index = new Map<K, number>();
  private readonly _keys: Array<K | undefined> = [];
  private readonly _free: number[] = [];

  public get size(): number {
    return this._index.size;
  }

  /** 索引上界，含尚未回收的空位。 */
  public get bound(): number {
    return this._keys.length;
  }

  /** 分配索引；键已存在时返回其现有索引。 */
  public add(key: K): number {
    const existing = this._index.get(key);
    if (existing !== undefined) return existing;
    const index = this._free.pop() ?? this._keys.length;
    this._keys[index] = key;
    this._index.set(key, index);
    return index;
  }

  /** 释放键占用的索引；键不存在返回 -1。 */
  public remove(key: K): number {
    const index = this._index.get(key);
    if (index === undefined) return -1;
    this._keys[index] = undefined;
    this._index.delete(key);
    this._free.push(index);
    return index;
  }

  public indexOf(key: K): number {
    return this._index.get(key) ?? -1;
  }

  /** 外部查询用：空位或越界返回 `undefined`。 */
  public at(index: number): K | undefined {
    return this._keys[index];
  }

  /**
   * 内部用：索引取自已登记的槽位，取不到属于程序错误而非查询失败。
   * 不变量收在一处，调用点就不必写非空断言。
   */
  public key(index: number): K {
    const found = this._keys[index];
    if (found === undefined) {
      throw new RangeError(`slot ${index} is empty or out of range`);
    }
    return found;
  }

  public has(key: K): boolean {
    return this._index.has(key);
  }

  public keys(): IterableIterator<K> {
    return this._index.keys();
  }

  /**
   * 消除空位并重新稠密编号。
   *
   * @returns 旧索引到新索引的映射，空位为 -1；调用方须据此重排自己的平行数组。
   */
  public compact(): Int32Array {
    const remap = new Int32Array(this._keys.length).fill(-1);
    let next = 0;
    for (let i = 0; i < this._keys.length; i++) {
      const key = this._keys[i];
      if (key === undefined) continue;
      remap[i] = next;
      this._keys[next] = key;
      this._index.set(key, next);
      next++;
    }
    this._keys.length = next;
    this._free.length = 0;
    return remap;
  }
}

/** 按 {@link Slots.compact} 的映射原地压缩平行数组。 */
export function gather<T>(list: T[], remapping: Int32Array, length: number): void {
  for (let i = 0; i < remapping.length; i++) {
    const to = remapping[i]!;
    if (to >= 0) list[to] = list[i]!;
  }
  list.length = length;
}

/** 按 {@link Slots.compact} 的映射改写列表里的槽位值；次序不动，因此位置索引仍然有效。 */
export function remap(list: number[], remapping: Int32Array): void {
  for (let i = 0; i < list.length; i++) list[i] = remapping[list[i]!]!;
}

/**
 * 按位置索引从无序列表里摘掉一项，O(1)：末尾那项补位，并改写补位者的位置索引。
 *
 * @remarks 边的两条邻接表与分组的子表共用这一个原语。换成在列表上 `indexOf` 就是
 *   O(size)，清空一个高扇出节点的连线、解散一个大分组都会整体退化成平方。
 */
export function unhook(list: number[], place: number[], item: number): void {
  const at = place[item]!;
  const last = list.length - 1;
  if (at !== last) {
    const moved = list[last]!;
    list[at] = moved;
    place[moved] = at;
  }
  list.pop();
}

/**
 * 名字 → 序号，按首次出现顺序编号。
 *
 * @remarks {@link Slots} 的只进不出版：没有删除也就没有空位，序号恒等于
 *   {@link Interner.table} 的下标，于是表本身就是反查，不必再留一条键数组。
 *   快照的端口层与序列化的短 id 都是这一件事。
 */
export class Interner {
  public readonly table: string[] = [];
  private readonly _seen = new Map<string, number>();

  public of(name: string): number {
    const known = this._seen.get(name);
    if (known !== undefined) return known;
    const id = this.table.length;
    this._seen.set(name, id);
    this.table.push(name);
    return id;
  }
}
