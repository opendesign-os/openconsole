/**
 * @file 目标选择：在多个命中的候选里选出一个，最内层优先，其次分数高者。
 *
 * 放置区、嵌套容器与编辑器区域都用它：嵌套的目标里，指针所在的最内层总是优先。
 * 与 DOM 无关，包含关系由调用方传入，所以同样适用于 canvas 场景里的图形。
 */

/**
 * 一个候选目标及其分数。
 *
 * @template T 目标类型，通常是元素。
 */
export interface Candidate<T> {
  /** 候选目标。 */
  readonly target: T;
  /** 分数，越大越优先；只在两个候选互不包含时比较。 */
  readonly score: number;
}

/**
 * 从候选中选出一个目标：最内层优先，其次分数高者。
 *
 * 先排除包含其他候选的外层候选，再在剩下的最内层候选里取分数最高者，分数相同保留先出现的。
 * 外层候选无论分数多高都不会胜出，结果也与候选顺序无关。同一目标出现多次时互不排除。
 * 需要两两判断包含，`contains` 调用 O(n²) 次；命中的候选通常只有几个。
 *
 * @template T 目标类型。
 * @param candidates 候选，分数相同时按出现顺序取先者。
 * @param contains 判断 `outer` 是否包含 `inner`，元素通常传 `(outer, inner) => outer.contains(inner)`。
 * @returns 选中的目标；没有候选时为 `undefined`。
 * @example
 * choose(
 *   [
 *     { target: column, score: 1 },
 *     { target: aside, score: 2 },
 *     { target: page, score: 3 },
 *   ],
 *   (outer, inner) => outer.contains(inner),
 * ); // aside：page 包含 column 而被排除，column 与 aside 互不包含，aside 分数更高
 */
export function choose<T>(
  candidates: Iterable<Candidate<T>>,
  contains: (outer: T, inner: T) => boolean,
): T | undefined {
  const list = [...candidates];
  let best: Candidate<T> | undefined;
  for (const candidate of list) {
    const wraps = list.some(
      (other) =>
        other.target !== candidate.target &&
        contains(candidate.target, other.target),
    );
    if (!wraps && (!best || candidate.score > best.score)) best = candidate;
  }
  return best?.target;
}
