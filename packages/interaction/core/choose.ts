/**
 * @file 目标选择：在多个命中的候选里选出一个，最内层优先，其次分数高者。
 *
 * 放置区、嵌套容器与编辑器区域都用它：嵌套的目标里，指针所在的最内层总是优先。
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
 * 从候选中选出一个目标。
 *
 * 一个候选包含另一个时，取被包含的（更内层）；互不包含时取分数高者，分数相同保留先出现的。
 *
 * @template T 目标类型。
 * @param candidates 候选。
 * @param contains 判断 `outer` 是否包含 `inner`，元素通常传 `(outer, inner) => outer.contains(inner)`。
 * @returns 选中的目标；没有候选时为 `undefined`。
 * @example
 * choose(
 *   [
 *     { target: page, score: 0 },
 *     { target: column, score: 0 },
 *   ],
 *   (outer, inner) => outer.contains(inner),
 * ); // column（在 page 之内）
 */
export function choose<T>(
  candidates: Iterable<Candidate<T>>,
  contains: (outer: T, inner: T) => boolean,
): T | undefined {
  let best: Candidate<T> | undefined;
  for (const candidate of candidates) {
    if (
      !best ||
      contains(best.target, candidate.target) ||
      (!contains(candidate.target, best.target) && candidate.score > best.score)
    ) {
      best = candidate;
    }
  }
  return best?.target;
}
