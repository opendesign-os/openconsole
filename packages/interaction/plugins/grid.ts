import { resizes, type Plugin } from "../core";

export function grid(step: number): Plugin {
  if (!(Number.isFinite(step) && step > 0)) {
    throw new RangeError(`expected a positive step, received ${step}`);
  }
  const snap = (value: number) => Math.round(value / step) * step;
  return {
    onMove: ({ state, action: { freedom } }) => {
      if (resizes(freedom)) {
        const { edges } = freedom;
        const { width, height } = state.size;
        return {
          ...state,
          size: {
            width: edges.left || edges.right ? snap(width) : width,
            height: edges.top || edges.bottom ? snap(height) : height,
          },
        };
      }
      if (!freedom.translate) return undefined;
      const [a, b, c, d, e, f] = state.matrix;
      return { ...state, matrix: [a, b, c, d, snap(e), snap(f)] };
    },
  };
}
