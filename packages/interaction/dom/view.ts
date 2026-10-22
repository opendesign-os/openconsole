/**
 * @file View：节点在 DOM 侧的唯一代表，在 {@link Store} 之上负责接管、测量与渲染。
 *
 * 状态在容器空间（offsetParent 内边距盒，左上为原点）；渲染写 `transform = T(−offset)·matrix`，
 * offset 为布局位置（`offsetLeft/offsetTop`），所以变换为单位矩阵时节点恰在布局位置。
 */

import { plane, space, type Matrix, type Point } from "@openconsole/matrix";

import { convert, frame } from "../core";
import {
  extent,
  Store,
  type Bounds,
  type Patch,
  type Size,
  type State,
} from "../model";
import {
  client,
  computed,
  linear,
  offset,
  rect,
  rendered,
  size,
  write,
} from "./measure";
import { fold } from "./style";

/**
 * 自定义渲染：替换默认的 CSS 写入，例如交给框架状态或画布。
 * @param node 节点。
 * @param state 要呈现的状态（容器空间）。
 */
export type Render = (node: HTMLElement, state: State) => void;

/** 节点 → 视图；每个节点只有一个视图，节点上的多项能力共享。 */
const views = new WeakMap<HTMLElement, View>();

const same = (left: Size, right: Size): boolean =>
  Math.abs(left.width - right.width) < 1e-6 &&
  Math.abs(left.height - right.height) < 1e-6;

/**
 * 节点的视图：持有共享的 {@link Store}，首次可测量时把已有 CSS 变换折叠进状态（接管），
 * 此后状态是几何的唯一来源，每次提交都写回 DOM，不再从 DOM 读回变换。
 *
 * 用 {@link View.of} 获取，不直接构造。
 */
export class View {
  /** 被接管的节点。 */
  readonly node: HTMLElement;
  /** 节点的共享状态；节点上的每个绑定都以成员身份加入。 */
  readonly store: Store;
  /** 自定义渲染，设置后替换默认的 CSS 写入。 */
  render: Render | undefined;
  /** 最近一次读取的布局位置（`offsetLeft/offsetTop`，容器空间）。 */
  #offset: Point<2> = { x: 0, y: 0 };
  /** 节点当前的 DOM 尺寸（边框盒），用于判断是否需要写回宽高。 */
  #size: Size;
  /** 是否已接管：已折叠 CSS 变换并清除内联的 translate、rotate、scale。 */
  #folded = false;
  /** 接管前收到的写入是否已给出矩阵；是则接管时不再用折叠结果覆盖。 */
  #placed = false;
  /** 接管前收到的写入是否已给出尺寸；是则接管时不再用测量值覆盖。 */
  #sized = false;

  private constructor(node: HTMLElement) {
    this.node = node;
    this.#size = size(node);
    this.store = new Store(
      { matrix: plane.identity, size: this.#size },
      (state, patch) => this.#change(state, patch),
    );
    this.prepare();
  }

  /**
   * 取节点的视图，没有则创建并尝试立即接管。
   * @param node 节点。
   * @returns 该节点唯一的视图。
   */
  static of(node: HTMLElement): View {
    const existing = views.get(node);
    if (existing) return existing;
    const view = new View(node);
    views.set(node, view);
    return view;
  }

  /**
   * 让状态与当前布局一致；节点未渲染时什么也不做，留到下次调用。
   *
   * 首次接管：把计算样式里的 `transform-origin`、`translate`、`rotate`、`scale`、`transform`
   * 折叠成 `T(offset)·fold`，清除内联的 translate、rotate、scale 并设 `transform-origin: 0 0`。
   * 之后：布局位置或尺寸变了时，矩阵随布局平移同样的距离，即视觉位置跟着布局走。
   */
  prepare(): void {
    const { node, store } = this;
    if (!rendered(node)) return;
    const position = offset(node);
    const measured = size(node);
    if (!this.#folded) {
      const matrix = plane.multiply(
        plane.translate(position.x, position.y),
        fold(computed(node), measured) ?? plane.identity,
      );
      const { style } = node;
      style.transformOrigin = "0 0";
      style.transformBox = "border-box";
      style.translate = "none";
      style.rotate = "none";
      style.scale = "none";
      this.#folded = true;
      this.#offset = position;
      this.#size = measured;
      const changed = store.commit({
        matrix: this.#placed ? undefined : matrix,
        size: this.#sized ? undefined : measured,
      });
      if (!changed) this.#paint(store.state);
      return;
    }
    if (
      position.x === this.#offset.x &&
      position.y === this.#offset.y &&
      same(measured, this.#size)
    ) {
      return;
    }
    const shift = plane.translate(
      position.x - this.#offset.x,
      position.y - this.#offset.y,
    );
    this.#offset = position;
    this.#size = measured;
    store.commit({
      size: measured,
      matrix: plane.multiply(shift, store.state.matrix),
    });
  }

  /**
   * 布局位置变了但状态不变时重绘：只更新 offset，`transform` 抵消布局变化，节点在屏幕上原地不动。
   *
   * 与 {@link View.prepare} 相反：prepare 让状态跟着布局走，relayout 让节点留在状态所在的位置。
   * 排序时 DOM 重排后用它让被拖条目仍贴着指针。
   */
  relayout(): void {
    this.#offset = offset(this.node);
    this.#paint(this.store.state);
  }

  /**
   * 求屏幕坐标 → 容器空间的仿射映射。
   * @returns 映射矩阵；祖先变换不可逆时为 `undefined`。
   */
  frame(): Matrix<2, "affine"> | undefined {
    return frame(linear(this.node), rect(this.node), this.store.state);
  }

  /** Store 提交后的回调：接管前记录哪些分量已被写入，再渲染。 */
  #change(state: State, patch: Patch): void {
    if (!this.#folded) {
      this.#placed ||= Boolean(patch.matrix);
      this.#sized ||= Boolean(patch.size);
    }
    this.#paint(state);
  }

  /**
   * 把状态写回 DOM。有自定义渲染时交给它；否则尺寸变了先写 `width`、`height` 并重读 offset，
   * 再写 `transform: matrix3d(T(−offset)·matrix)`，恰为单位矩阵时写 `none`。未接管时不写。
   */
  #paint(state: State): void {
    const { node, render } = this;
    if (render) {
      render(node, state);
      return;
    }
    if (!this.#folded) return;
    if (!same(state.size, this.#size)) {
      write(node, state.size);
      this.#size = state.size;
      this.#offset = offset(node);
    }
    const matrix = plane.multiply(
      plane.translate(-this.#offset.x, -this.#offset.y),
      state.matrix,
    );
    node.style.transform = plane.equals(matrix, plane.identity)
      ? "none"
      : space.format(space.lift(matrix));
  }
}

/**
 * 把节点移到另一个容器，屏幕上的位置、旋转与尺寸都不变。
 *
 * 移动前后各求一次 frame，矩阵按 `convert(matrix, before, after)` 换到新容器的空间。
 * @param node 要移交的节点。
 * @param container 目标容器。
 * @returns 是否移交；已在该容器里或正处于会话中时为 `false`。
 * @example
 * transfer(card, group); // 卡片移进分组，视觉位置不跳
 */
export function transfer(node: HTMLElement, container: HTMLElement): boolean {
  const view = View.of(node);
  if (node.parentElement === container || view.store.locked) return false;
  view.prepare();
  const before = view.frame();
  const { matrix, size } = view.store.state;
  container.append(node);
  view.prepare();
  const after = view.frame();
  const next = before && after && convert(matrix, before, after);
  if (next) view.store.assign({ matrix: next, size });
  return true;
}

/**
 * 生成 `bounds` 插件的测量函数：容器的客户区在节点所在容器空间里的包围盒。
 *
 * 容器就是节点的 offsetParent 时直接取 `[0, clientWidth] × [0, clientHeight]`；
 * 否则（容器是更远的祖先）把容器客户区的屏幕多边形经节点的 frame 换算后取包围盒。
 * @param container 限定范围的容器，可以是任意祖先。
 * @param node 被限定的节点。
 * @returns 测量函数，`bounds` 在每次会话开始时调用。
 */
export const region =
  (container: HTMLElement, node: HTMLElement) => (): Bounds => {
    const whole = {
      left: 0,
      top: 0,
      right: container.clientWidth,
      bottom: container.clientHeight,
    };
    if (node.offsetParent === container) return whole;
    const frame = View.of(node).frame();
    const polygon = client(container);
    if (!frame || !polygon) return whole;
    return extent(polygon.map((point) => plane.apply(frame, point)));
  };

/**
 * 让节点回到布局位置：重读 offset 并把矩阵设为 `T(offset)`，使 `transform` 为 `none`。
 * 会话中调用无效（状态被锁）。
 * @param node 节点。
 */
export function reset(node: HTMLElement): void {
  const view = View.of(node);
  view.relayout();
  view.store.assign({
    matrix: plane.translate(node.offsetLeft, node.offsetTop),
  });
}
