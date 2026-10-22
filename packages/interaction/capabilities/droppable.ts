/**
 * @file 放置区能力：旁观所有拖拽会话，判定被拖元素落在哪个区域，并派发进入、经过、离开与放下。
 *
 * 区域几何在会话开始时测量一次（滚动后 frame 变化、区域增删或选项更新后重测），放进可替换的空间索引
 * {@link Droppable.index}；每次移动只对与拖拽范围相交的区域判定，命中多个时最内层优先。
 * 所有判定都在屏幕坐标（client）的多边形上进行，区域或被拖元素带旋转、缩放时同样准确。
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
  /** 绑定选项 `data` 携带的载荷，用来区分拖的是什么。 */
  readonly data: unknown;
  /** 热点：指针质心；没有指针（键盘）时为被拖元素的中心。 */
  readonly point: Point<2>;
  /** 被拖元素边框盒的四个角（左上、右上、右下、左下），屏幕坐标；旋转后依然精确。 */
  readonly shape: Polygon;
}

/** 测量后的放置区，存放在空间索引里。 */
export interface Zone {
  /** 放置区节点。 */
  readonly element: HTMLElement;
  /** 测量时区域边框盒的四角，屏幕坐标；是凸四边形。 */
  readonly shape: Polygon;
}

/**
 * 命中判定：返回分数表示命中，`undefined` 表示未命中。
 *
 * 只有包围盒与拖拽范围（被拖元素与热点的包围盒）相交的区域才会被判定。
 * 命中多个区域时最内层优先，同层再比分数，高者胜出，分数相同保留先测量的区域。
 *
 * @param zone 待判定的区域。
 * @param drag 被拖元素。
 * @returns 分数，越大越优先；未命中时为 `undefined`。
 * @example
 * // 被拖元素的中心进入区域才算命中
 * const centered: Detect = (zone, drag) =>
 *   contains(zone.shape, centroid(drag.shape)) ? 1 : undefined;
 * new Droppable(slot, { detect: centered });
 */
export type Detect = (zone: Zone, drag: Drag) => number | undefined;

/**
 * {@link Droppable} 的选项；全部即时生效，`update` 从不重建。
 *
 * 回调只在本区域相关的变化时调用，收到的都是当下的 {@link Drag}。
 */
export interface DroppableOptions extends CapabilityOptions {
  /**
   * 是否接受这次拖拽；每次测量区域时判断（会话开始，以及滚动、区域增删或选项更新后的下一次移动），
   * 不接受的区域不参与判定。缺省全部接受。
   */
  readonly accept?: (drag: Drag) => boolean;
  /**
   * 命中判定。
   *
   * @default within
   */
  readonly detect?: Detect;
  /** 被拖元素进入本区域（成为命中目标）时调用。 */
  readonly onEnter?: (drag: Drag) => void;
  /** 成为命中目标之后，每次移动仍命中本区域时调用。 */
  readonly onOver?: (drag: Drag) => void;
  /** 离开本区域（命中目标换成别的区域或没有目标）或会话取消时调用。 */
  readonly onLeave?: (drag: Drag) => void;
  /** 在本区域上松手时调用；随后不再调用 `onLeave`。 */
  readonly onDrop?: (drag: Drag) => void;
}

/**
 * 热点落在区域内（含边界）即命中，分数恒为 1；对应 dnd-kit 的 `pointerWithin`。
 *
 * 嵌套的区域都命中时最内层胜出，适合文件夹、树节点这类“指到哪放到哪”的场景。
 *
 * @param zone 待判定的区域。
 * @param drag 被拖元素。
 * @returns 命中时为 1，否则为 `undefined`。
 * @example
 * new Droppable(folder); // 缺省即 within：指针落在文件夹上才算放入
 */
export const within: Detect = (zone, drag) =>
  contains(zone.shape, drag.point) ? 1 : undefined;

/**
 * 按交集面积除以并集面积（IoU）打分，有交集即命中；对应 dnd-kit 的 `rectIntersection`。
 *
 * 交集按凸多边形裁剪求出，区域与被拖元素旋转后依然精确；适合卡槽、栅格这类“重叠最多者胜出”的场景。
 *
 * @param zone 待判定的区域。
 * @param drag 被拖元素。
 * @returns 交并比，取值 `(0, 1]`；没有交集时为 `undefined`。
 * @example
 * new Droppable(slot, { detect: overlap });
 */
export const overlap: Detect = (zone, drag) => {
  const shared = area(intersect(drag.shape, zone.shape));
  const union = area(drag.shape) + area(zone.shape) - shared;
  return shared > 0 ? shared / union : undefined;
};

/**
 * 按中心距离打分，越近分数越高，总是命中。
 *
 * 只有与拖拽范围相交的区域才会参与判定，所以是相交区域里的“中心最近”；适合看板列这类相邻区域。
 *
 * @param zone 待判定的区域。
 * @param drag 被拖元素。
 * @returns 两个中心距离（屏幕像素）的相反数，恒不大于 0。
 * @example
 * new Droppable(column, { detect: nearest });
 */
export const nearest: Detect = (zone, drag) => {
  const from = centroid(drag.shape);
  const to = centroid(zone.shape);
  return -Math.hypot(to.x - from.x, to.y - from.y);
};

/** 所有放置区及其选项；全局共享，与具体会话无关。 */
const zones = new Map<HTMLElement, DroppableOptions>();
/** 当前命中的区域；没有命中时为 `undefined`。 */
let over: HTMLElement | undefined;
/** 上次测量区域时会话的 frame；frame 变化（滚动）或区域增减时置空，下次移动重新测量。 */
let measured: Matrix<2, "affine"> | undefined;

/**
 * 把会话换算成判定用的 {@link Drag}：状态四角经 frame 的逆映射到屏幕坐标。
 *
 * @param session 旁观到的会话快照，状态在容器空间。
 * @returns 判定用的被拖元素；frame 不可逆时四角保留容器空间坐标，热点取不到时用四角的质心。
 */
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
 *
 * 区域按屏幕多边形（{@link outline}）量取，以多边形的包围盒插入 {@link Droppable.index}；量不出（变换不可逆）的区域跳过。
 *
 * @param drag 当前被拖元素，交给 `accept` 判断。
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
 * 再按“最内层优先，其次分数高”选出一个（{@link choose}）。
 *
 * @param drag 当前被拖元素。
 * @returns 命中的区域节点；没有命中时为 `undefined`。
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

/**
 * 会话开始与每次移动：按需重测，再派发进入、经过与离开。
 *
 * 只跟踪能平移的动作（拖拽、平移缩放），调整尺寸与旋转不参与判定。命中目标不变时派发 `onOver`；
 * 换了目标时先对旧目标派发 `onLeave`，再对新目标派发 `onEnter`。
 *
 * @param session 旁观到的会话快照。
 */
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

/**
 * 会话结束或取消：清空命中与索引，结束时派发放下，取消时派发离开。
 *
 * @param session 结束或取消时的会话快照。
 * @param drop `true` 为结束（对命中区域派发 `onDrop`），`false` 为取消（派发 `onLeave`）。
 */
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
 * 区域旋转或缩放时同样准确，因为判定在屏幕坐标的多边形上进行；被拖节点自身及其后代不会成为目标。
 * 同一时间最多一个命中区域，事件顺序为 `onEnter` → `onOver`… → `onLeave` 或 `onDrop`。
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
   * 放置区的空间索引，所有区域共用；每次测量时清空并重建，会话结束或取消时清空。
   *
   * 默认 {@link Linear} 逐个比较；区域很多时换成网格哈希 `Hash`，或实现 {@link Index} 接入 R 树等。
   */
  static index: Index<Zone> = new Linear();

  /**
   * 把节点登记为放置区：所有放置区共用一个旁观者，首个区域登记时开始旁观。
   *
   * @param zone 放置区节点。
   * @param options 放置区选项。
   */
  constructor(zone: HTMLElement, options: DroppableOptions = {}) {
    super(zone, options);
    this.refresh();
  }

  /** 是否有拖拽正停在本区域上（本区域是当前命中目标）。 */
  get active(): boolean {
    return over === this.node;
  }

  /**
   * 登记区域与共用旁观者，并让下一次移动重新测量。
   *
   * @returns 只含一个清理函数：注销区域，正被命中时清空命中，最后一个区域注销时停止旁观。
   */
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
   *
   * @returns 总是 `true`：放置区没有需要重建的结构性选项。
   */
  protected apply(): boolean {
    zones.set(this.node, this.options);
    measured = undefined;
    return true;
  }
}
