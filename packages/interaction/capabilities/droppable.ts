/**
 * @file 放置区能力：旁观所有拖拽会话，判定被拖元素落在哪个区域，并派发进入、经过、离开与放下。
 *
 * 区域几何在会话开始时测量一次（滚动后 frame 变化时重测），放进可替换的空间索引
 * {@link Droppable.index}；每次移动只对与拖拽范围相交的区域判定，命中多个时最内层优先。
 */

import { plane, type Matrix, type Point } from "@openconsole/matrix";

import { choose, hotspot, Linear, type Candidate, type Index } from "../core";
import { observe, outline, type Session } from "../dom";
import {
  area,
  Capability,
  centroid,
  contains,
  corners,
  extent,
  intersect,
  type CapabilityOptions,
  type Part,
  type Polygon,
} from "../model";

/** 判定时看到的被拖元素；坐标都是屏幕坐标（client）。 */
export interface Drag {
  /** 被拖动的节点。 */
  readonly node: HTMLElement;
  /** 绑定选项 `data` 携带的载荷。 */
  readonly data: unknown;
  /** 热点：指针质心；没有指针（键盘）时为被拖元素的中心。 */
  readonly point: Point<2>;
  /** 被拖元素的四个角，屏幕坐标。 */
  readonly shape: Polygon;
}

/** 测量后的放置区，存放在空间索引里。 */
export interface Zone {
  /** 放置区节点。 */
  readonly element: HTMLElement;
  /** 会话开始时测得的区域四角，屏幕坐标。 */
  readonly shape: Polygon;
}

/**
 * 命中判定：返回分数表示命中，`undefined` 表示未命中。
 *
 * 命中多个区域时最内层优先，同层再比分数，高者胜出。
 */
export type Detect = (zone: Zone, drag: Drag) => number | undefined;

/** {@link Droppable} 的选项。 */
export interface DroppableOptions extends CapabilityOptions {
  /** 是否接受这次拖拽；在会话开始测量区域时判断一次。缺省全部接受。 */
  readonly accept?: (drag: Drag) => boolean;
  /**
   * 命中判定。
   * @default within
   */
  readonly detect?: Detect;
  /** 被拖元素进入本区域（成为命中目标）时调用。 */
  readonly onEnter?: (drag: Drag) => void;
  /** 停留在本区域时，每次移动调用。 */
  readonly onOver?: (drag: Drag) => void;
  /** 离开本区域或会话取消时调用。 */
  readonly onLeave?: (drag: Drag) => void;
  /** 在本区域上松手时调用。 */
  readonly onDrop?: (drag: Drag) => void;
}

/** 热点落在区域内即命中，分数恒为 1；对应 dnd-kit 的 `pointerWithin`。 */
export const within: Detect = (zone, drag) =>
  contains(zone.shape, drag.point) ? 1 : undefined;

/** 按交集面积除以并集面积打分，有交集即命中；对应 dnd-kit 的 `rectIntersection`。 */
export const overlap: Detect = (zone, drag) => {
  const shared = area(intersect(drag.shape, zone.shape));
  const union = area(drag.shape) + area(zone.shape) - shared;
  return shared > 0 ? shared / union : undefined;
};

/**
 * 按中心距离打分，越近分数越高。
 *
 * 只有与拖拽范围相交的区域才会参与判定，所以是相交区域里的“中心最近”。
 */
export const nearest: Detect = (zone, drag) => {
  const from = centroid(drag.shape);
  const to = centroid(zone.shape);
  return -Math.hypot(to.x - from.x, to.y - from.y);
};

/** 所有放置区及其选项；全局共享，与具体会话无关。 */
const zones = new Map<HTMLElement, DroppableOptions>();
/** 当前命中的区域。 */
let over: HTMLElement | undefined;
/** 上次测量区域时会话的 frame；frame 变化（滚动）或区域增减时置空，下次移动重新测量。 */
let measured: Matrix<2, "affine"> | undefined;

/** 把会话换算成判定用的 {@link Drag}：状态四角经 frame 的逆映射到屏幕坐标。 */
function describe(session: Session): Drag {
  const inverse = plane.invert(session.frame);
  const polygon = corners(session.state);
  const shape = inverse
    ? polygon.map((point) => plane.apply(inverse, point))
    : polygon;
  return {
    node: session.node,
    data: session.data,
    point: hotspot(session) ?? centroid(shape),
    shape,
  };
}

/**
 * 测量全部区域并重建索引：跳过被拖节点自身与其后代，`accept` 在这里判断一次。
 */
function measure(drag: Drag): void {
  const { index } = Droppable;
  index.clear();
  for (const [element, options] of zones) {
    if (element === drag.node || drag.node.contains(element)) continue;
    if (options.accept && !options.accept(drag)) continue;
    const shape = outline(element);
    if (shape) index.insert({ element, shape }, extent(shape));
  }
}

/**
 * 找出命中的区域：只判定包围盒与拖拽范围（被拖元素与热点的包围盒）相交的候选，
 * 再按“最内层优先，其次分数高”选出一个。
 */
function hit(drag: Drag): HTMLElement | undefined {
  const candidates: Candidate<HTMLElement>[] = [];
  for (const zone of Droppable.index.search(
    extent([...drag.shape, drag.point]),
  )) {
    const options = zones.get(zone.element);
    const score = options && (options.detect ?? within)(zone, drag);
    if (score !== undefined) candidates.push({ target: zone.element, score });
  }
  return choose(candidates, (outer, inner) => outer.contains(inner));
}

/** 会话开始与每次移动：按需重测，再派发进入、经过与离开。只跟踪能平移的动作。 */
function track(session: Session): void {
  if (!session.action.freedom.translate) return;
  const drag = describe(session);
  if (session.frame !== measured) {
    measured = session.frame;
    measure(drag);
  }
  const next = hit(drag);
  if (next === over) {
    if (over) zones.get(over)?.onOver?.(drag);
    return;
  }
  if (over) zones.get(over)?.onLeave?.(drag);
  over = next;
  if (next) zones.get(next)?.onEnter?.(drag);
}

/** 会话结束或取消：清空命中与索引，结束时派发放下，取消时派发离开。 */
function finish(session: Session, drop: boolean): void {
  const zone = over;
  over = undefined;
  measured = undefined;
  Droppable.index.clear();
  if (!zone) return;
  const drag = describe(session);
  const options = zones.get(zone);
  if (drop) options?.onDrop?.(drag);
  else options?.onLeave?.(drag);
}

/** 所有放置区共用的旁观者；有区域时登记，最后一个区域销毁时注销。 */
const observer = {
  onStart: track,
  onMove: track,
  onEnd: (session: Session) => finish(session, true),
  onCancel: (session: Session) => finish(session, false),
};

/**
 * 放置区：旁观任意绑定的拖拽会话，不绑定指针，也不改写被拖元素的状态。
 *
 * 区域旋转或缩放时同样准确，因为判定在屏幕坐标的多边形上进行；
 * 选项全部即时生效，`update` 从不重建。
 *
 * @example
 * const trash = new Droppable(bin, {
 *   detect: overlap,
 *   accept: ({ data }) => data === "card",
 *   onDrop: ({ node }) => node.remove(),
 * });
 * Droppable.index = new Hash(128); // 区域很多时换成网格哈希
 */
export class Droppable extends Capability<HTMLElement, DroppableOptions> {
  /**
   * 放置区的空间索引，所有区域共用；会话开始时清空并重建。
   *
   * 默认 {@link Linear} 逐个比较；区域很多时换成网格哈希 `Hash`，或实现 {@link Index} 接入 R 树等。
   */
  static index: Index<Zone> = new Linear();

  /**
   * @param zone 放置区节点。
   * @param options 放置区选项。
   */
  constructor(zone: HTMLElement, options: DroppableOptions = {}) {
    super(zone, options);
    this.refresh();
  }

  /** 是否有拖拽正停在本区域上。 */
  get active(): boolean {
    return over === this.node;
  }

  /** 登记区域与共用旁观者，并让下一次移动重新测量。 */
  protected build(): readonly Part[] {
    const { node } = this;
    zones.set(node, this.options);
    measured = undefined;
    const stop = observe(observer);
    return [
      () => {
        zones.delete(node);
        if (over === node) over = undefined;
        if (zones.size === 0) stop();
      },
    ];
  }

  /**
   * 写入新选项并让下一次移动重新测量，`accept` 与 `detect` 随之生效。
   * @returns 总是 `true`：放置区没有需要重建的结构性选项。
   */
  protected apply(): boolean {
    zones.set(this.node, this.options);
    measured = undefined;
    return true;
  }
}
