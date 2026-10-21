export interface Candidate<T> {
  readonly target: T;
  readonly score: number;
}

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
