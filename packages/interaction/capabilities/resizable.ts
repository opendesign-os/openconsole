/**
 * @file 调整尺寸能力：每个手柄一份 {@link bind}，拖动时移动对应的边，对边保持不动。
 *
 * 插件顺序为 magnet → 用户插件 → bounds → limits → collide：先吸附移动的边，再夹进范围与尺寸上下限，
 * 碰撞最后；limits 排在 bounds 之后，最小尺寸优先于范围。旋转后的节点同样钉住对边。
 */

import { resize, type Handle } from "../core";
import {
  bind,
  grips,
  guides,
  outlines,
  range,
  region,
  View,
  type Binding,
  type BindOptions,
} from "../dom";
import { Shape, type CapabilityOptions, type Part, type Range } from "../model";
import { bounds, collide, limits, magnet } from "../plugins";

/** {@link Resizable} 的选项；另含 {@link BindOptions} 中除 `action`、`handle`、`keys` 外的通用选项。 */
export interface ResizableOptions
  extends Omit<BindOptions, "action" | "handle" | "keys">, CapabilityOptions {
  /** 手柄元素到所控制边的映射；缺省在节点四边与四角自动生成 8 个手柄（`data-layer="grip"`）。 */
  readonly handles?: ReadonlyMap<Element, Handle>;
  /**
   * 是否以中心为锚点对称调整，两侧同时伸缩。
   * @default false
   */
  readonly symmetric?: boolean;
  /** 宽度范围（像素，边框盒）；与节点 CSS 的 `min-width`、`max-width` 取交集。 */
  readonly width?: Range;
  /** 高度范围（像素，边框盒）；与节点 CSS 的 `min-height`、`max-height` 取交集。 */
  readonly height?: Range;
  /** 限定范围的祖先元素，移动的边不会越出它；缺省不限范围。 */
  readonly container?: HTMLElement;
  /** 磁吸目标，只吸移动的边：`true` 取父元素与兄弟元素，字符串为 `container` 里的选择器。 */
  readonly magnet?: boolean | string;
  /** 碰撞目标，取法同 `magnet`；调整到接触处停下。 */
  readonly collide?: boolean | string;
}

/**
 * 合并两个尺寸范围，取交集；下限至少为 0，上限无穷时省略。
 *
 * @param outer 选项给出的范围。
 * @param inner 从 CSS `min-*`、`max-*` 读出的范围。
 * @returns 同时满足两者的范围。
 */
function narrow(outer: Range = {}, inner: Range): Range {
  const min = Math.max(outer.min ?? 0, inner.min ?? 0);
  const max = Math.min(outer.max ?? Infinity, inner.max ?? Infinity);
  return { min, ...(Number.isFinite(max) ? { max } : {}) };
}

/**
 * 调整尺寸：拖动手柄改变边框盒宽高，对边钉住；与 `Draggable`、`Rotatable` 共享同一份状态。
 *
 * 尺寸变化时同时写 `width` 与 `height`（按 `box-sizing` 换算）。没有键盘映射。
 *
 * @example
 * new Resizable(card, { container: board, width: { min: 60 }, magnet: true });
 * new Resizable(panel, { handles: new Map([[corner, { x: 1, y: 1 }]]), symmetric: true });
 */
export class Resizable extends Shape<HTMLElement, ResizableOptions, Binding> {
  /**
   * @param node 被调整尺寸的节点。
   * @param options 调整尺寸选项。
   */
  constructor(node: HTMLElement, options: ResizableOptions = {}) {
    super(node, View.of(node).store, options);
    this.refresh();
  }

  /** 为每个手柄创建绑定；自动生成的手柄在重建或销毁时移除。 */
  protected build(): readonly Part<Binding>[] {
    const { handles } = this.options;
    if (handles) return this.#bind(handles);
    const created = grips(this.node);
    return [
      ...this.#bind(created),
      () => {
        for (const grip of created.keys()) grip.remove();
      },
    ];
  }

  /**
   * 就地更新各手柄的插件；`handles` 或 `symmetric` 变化会改变手柄与动作，需要重建。
   *
   * @param changes 本次传入 `update()` 的选项。
   * @returns 是否已就地应用。
   */
  protected apply(changes: Partial<ResizableOptions>): boolean {
    if ("handles" in changes || "symmetric" in changes) return false;
    for (const binding of this.units) binding.update(this.#config());
    return true;
  }

  /** 每个手柄一份绑定：句柄为手柄元素，动作按手柄所在的边调整尺寸。 */
  #bind(handles: ReadonlyMap<Element, Handle>): Binding[] {
    const { symmetric = false } = this.options;
    return [...handles].map(([handle, side]) =>
      bind(this.node, {
        ...this.#config(),
        handle,
        action: resize({ handle: side, symmetric }),
      }),
    );
  }

  /**
   * 各手柄共用的绑定选项，不含句柄与动作；插件顺序见文件说明。
   * 尺寸上下限每次都重新读取 CSS，样式变化后的 `update` 也能生效。
   */
  #config(): Omit<BindOptions, "action"> {
    const { node, options } = this;
    const { container, plugins = [] } = options;
    const scope = container ?? node.ownerDocument;
    return {
      ...options,
      plugins: [
        options.magnet
          ? magnet(outlines(node, options.magnet, scope), {
              onSnap: guides(() => node.offsetParent),
            })
          : undefined,
        ...plugins,
        container && bounds(region(container, node)),
        limits({
          width: narrow(options.width, range(node, "width")),
          height: narrow(options.height, range(node, "height")),
        }),
        options.collide
          ? collide(outlines(node, options.collide, scope))
          : undefined,
      ].filter((plugin) => plugin !== undefined),
    };
  }
}
