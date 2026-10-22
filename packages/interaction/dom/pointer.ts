/**
 * @file 指针输入源：文档级委托、句柄路由、起动条件与会话期间的事件处理。
 *
 * 每个 document 只装一个捕获阶段、passive 的 `pointerdown`；按下后沿 `composedPath()` 选出接受它的绑定。
 * 会话期间的监听共用一个 `AbortController`，结束时一次摘除；全局同一时间只有一个指针会话。
 */

import type { Point } from "@openconsole/matrix";

import {
  input,
  type Activation,
  type Control,
  type Mark,
  type Sensor,
} from "./sensor";

/**
 * 列表类能力的默认起动条件：触屏长按 250ms（容许 5px 抖动），其他指针移动 3px。
 *
 * 触屏因此仍能滚动页面，鼠标点击也不会误触拖动。
 * @param type `PointerEvent.pointerType`。
 * @returns 该指针类型的起动条件。
 */
export const deliberate = (type: string): Activation =>
  type === "touch" ? { delay: 250, tolerance: 5 } : { distance: 3 };

/** 一个绑定在某元素上登记的标记；同一元素可以有多个绑定的标记。 */
interface Claim {
  readonly control: Control;
  readonly kind: Mark["kind"];
  readonly priority: number;
}

/** 取事件目标上登记的标记。 */
type Lookup = (element: EventTarget) => readonly Claim[] | undefined;

/** 一次指针会话：从按下到最后一根手指抬起。 */
interface Session {
  readonly control: Control;
  /** 命中的句柄元素；指针捕获设在它上面，新手指须按在它内部才能加入。 */
  readonly handle: Element;
  readonly activation: Activation;
  /** 本次会话所有监听共用的控制器。 */
  readonly controller: AbortController;
  /** 每根手指按下时的位置（屏幕坐标），起动时作为起点。 */
  readonly presses: Map<number, Point<2>>;
  /** 每根仍按着的手指的当前位置（屏幕坐标）。 */
  readonly pointers: Map<number, Point<2>>;
  /** 首次按下的事件，用于判断起动距离。 */
  readonly first: PointerEvent;
  /** 最近一次指针事件，起动或结束时以它为输入。 */
  last: PointerEvent;
  /** 是否已满足起动条件并调用了 `start`。 */
  started: boolean;
  /** 长按起动的计时器。 */
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** 按在这些交互元素上（且它们在句柄内层）时不起动，保证输入框、按钮等正常工作。 */
const interactive =
  "input, textarea, select, button, option, [contenteditable]:not([contenteditable='false'])";

/** 元素 → 在其上登记的标记。 */
const claims = new WeakMap<EventTarget, readonly Claim[]>();
/** 当前指针会话；会话中新的按下只会作为额外手指加入。 */
let session: Session | undefined;

const locate = (event: PointerEvent): Point<2> => ({
  x: event.clientX,
  y: event.clientY,
});

/** 会话最多接受的手指数：动作允许旋转或缩放时为 2，否则为 1。 */
const limit = ({ action: { freedom } }: Control): number =>
  freedom.rotate || freedom.scale ? 2 : 1;

/**
 * 判断 `control` 是否接受这条事件路径上的按下。
 *
 * 沿路径由内向外查看属于 `control` 的标记：最内层的生效，外层标记优先级更高时覆盖；
 * 最终生效的是句柄才接受，是排除区或没有标记都不接受。
 * @param path `event.composedPath()`，由内向外。
 * @param control 待判断的绑定。
 * @param find 取元素上登记的标记。
 * @returns 是否接受。
 */
function allows(
  path: readonly EventTarget[],
  control: Control,
  find: Lookup,
): boolean {
  let best = -Infinity;
  let allowed = false;
  for (const element of path) {
    for (const claim of find(element) ?? []) {
      if (claim.control !== control || claim.priority <= best) continue;
      best = claim.priority;
      allowed = claim.kind === "handle";
    }
  }
  return allowed;
}

/**
 * 为一次按下选出处理它的绑定与句柄元素。
 *
 * 沿路径由内向外，在每个元素上按优先级从高到低尝试其句柄，返回第一个接受这次按下的绑定；
 * 被排除的按下因此会继续交给外层绑定，例如卡片正文上的按下去平移画布。
 * @param path `event.composedPath()`，由内向外。
 * @param find 取元素上登记的标记。
 * @returns 句柄元素与绑定；没有绑定接受时为 `undefined`。
 */
function pick(
  path: readonly EventTarget[],
  find: Lookup,
): { handle: EventTarget; control: Control } | undefined {
  for (const element of path) {
    const handles = (find(element) ?? [])
      .filter((claim) => claim.kind === "handle")
      .sort((left, right) => right.priority - left.priority);
    for (const { control } of handles) {
      if (allows(path, control, find)) return { handle: element, control };
    }
  }
  return undefined;
}

/** 按下点是否落在句柄内层的交互元素上，是则不起动。 */
function blocked(path: readonly EventTarget[], handle: Element): boolean {
  for (const element of path) {
    if (element === handle) return false;
    if (element instanceof Element && element.matches(interactive)) return true;
  }
  return false;
}

/** 设置指针捕获；合成事件或指针已释放时 `setPointerCapture` 会抛错，此时忽略。 */
function capture(element: Element, id: number): void {
  try {
    element.setPointerCapture(id);
  } catch {
    return;
  }
}

/** 吞掉拖动结束后紧随的一次 click，避免松手误触点击；下一个宏任务即撤销。 */
function suppress(document: Document): void {
  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  document.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(
    () => document.removeEventListener("click", swallow, { capture: true }),
    0,
  );
}

/** 阻止原生拖放（`dragstart`）打断会话。 */
function prevent(event: Event): void {
  event.preventDefault();
}

/**
 * 满足起动条件后开始会话：以按下位置调用 `start`，捕获所有手指，清除并持续清除文字选区，
 * 再以最新位置推进一次。`start` 返回 `false` 时取消这次按下。
 */
function begin(current: Session): void {
  if (current.started || session !== current) return;
  const { handle, control, presses, pointers, first } = current;
  if (!control.start(input(first, presses.values()))) {
    finish(current, "cancel", []);
    return;
  }
  current.started = true;
  for (const id of pointers.keys()) capture(handle, id);
  const document = handle.ownerDocument;
  const clear = () => document.getSelection()?.removeAllRanges();
  clear();
  document.addEventListener("selectionchange", clear, {
    signal: current.controller.signal,
  });
  control.move(input(current.last, pointers.values()));
}

/**
 * 结束指针会话并摘除监听；未起动的按下直接丢弃。
 *
 * `end` 时以结束位置调用 `control.end` 并吞掉随后的 click；`cancel` 时调用 `control.cancel`。
 * @param current 要结束的会话；已不是当前会话时忽略。
 * @param kind 结束方式。
 * @param points 结束时的输入点（屏幕坐标）。
 */
function finish(
  current: Session,
  kind: "end" | "cancel",
  points: readonly Point<2>[],
): void {
  if (session !== current) return;
  session = undefined;
  current.controller.abort();
  if (current.timer !== undefined) clearTimeout(current.timer);
  if (!current.started) return;
  const { handle, control } = current;
  for (const id of current.presses.keys()) {
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }
  if (kind === "cancel") {
    control.cancel();
    return;
  }
  control.end(input(current.last, points));
  suppress(handle.ownerDocument);
}

/**
 * 会话中又一根手指按下：未达手指上限且按在当前句柄内时加入同一会话；
 * 已起动时立即推进，点数变化由 Tracker 重新取锚，节点不跳。
 */
function join(current: Session, event: PointerEvent): void {
  if (current.pointers.size >= limit(current.control)) return;
  if (!event.composedPath().includes(current.handle)) return;
  const point = locate(event);
  current.presses.set(event.pointerId, point);
  current.pointers.set(event.pointerId, point);
  current.last = event;
  if (!current.started) return;
  capture(current.handle, event.pointerId);
  current.control.move(input(event, current.pointers.values()));
}

/**
 * 文档级 `pointerdown`：已有会话时尝试作为新手指加入；否则选出绑定，建立待起动的会话并挂上监听。
 * 鼠标只接受主键；长按起动时开始计时。
 */
function down(event: PointerEvent): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (session) {
    join(session, event);
    return;
  }
  const path = event.composedPath();
  const found = pick(path, (element) => claims.get(element));
  if (!found || !(found.handle instanceof Element)) return;
  const handle = found.handle;
  if (blocked(path, handle)) return;
  const activation = found.control.activation(event.pointerType);
  const point = locate(event);
  const current: Session = {
    control: found.control,
    handle,
    activation,
    controller: new AbortController(),
    presses: new Map([[event.pointerId, point]]),
    pointers: new Map([[event.pointerId, point]]),
    first: event,
    last: event,
    started: false,
    timer: undefined,
  };
  session = current;
  const options = { capture: true, signal: current.controller.signal };
  const document = handle.ownerDocument;
  document.addEventListener("pointermove", move, options);
  document.addEventListener("pointerup", up, options);
  document.addEventListener("pointercancel", cancel, options);
  document.addEventListener("lostpointercapture", lost, options);
  document.addEventListener("dragstart", prevent, options);
  document.addEventListener("keydown", escape, options);
  document.addEventListener("touchmove", touch, { ...options, passive: false });
  if (activation.delay !== undefined) {
    current.timer = setTimeout(() => begin(current), activation.delay);
  }
}

/**
 * 会话中的指针移动：已起动则推进；未起动时检查起动条件，长按期间超出容差即放弃，
 * 移动距离达到要求即起动。
 */
function move(event: PointerEvent): void {
  const current = session;
  if (!current || !current.pointers.has(event.pointerId)) return;
  current.pointers.set(event.pointerId, locate(event));
  current.last = event;
  if (current.started) {
    current.control.move(input(event, current.pointers.values()));
    return;
  }
  const { delay, tolerance = 0, distance = 0 } = current.activation;
  const moved = Math.hypot(
    event.clientX - current.first.clientX,
    event.clientY - current.first.clientY,
  );
  if (delay !== undefined) {
    if (moved > tolerance) finish(current, "cancel", []);
    return;
  }
  if (moved >= distance) begin(current);
}

/** 手指抬起：最后一根抬起时以抬起位置结束会话，否则以剩下的手指推进。 */
function up(event: PointerEvent): void {
  const current = session;
  if (!current || !current.pointers.has(event.pointerId)) return;
  current.pointers.delete(event.pointerId);
  current.last = event;
  if (current.pointers.size === 0) {
    finish(current, "end", [locate(event)]);
    return;
  }
  if (current.started) {
    current.control.move(input(event, current.pointers.values()));
  }
}

/** `pointercancel`（例如被系统手势接管）时取消会话。 */
function cancel(event: PointerEvent): void {
  if (session?.pointers.has(event.pointerId)) finish(session, "cancel", []);
}

/** 失去指针捕获（例如句柄被移出文档）时以当前位置结束会话。 */
function lost(event: PointerEvent): void {
  const current = session;
  if (!current?.started || !current.pointers.has(event.pointerId)) return;
  finish(current, "end", [...current.pointers.values()]);
}

/** 会话中按 Esc 取消，状态回到起点。 */
function escape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !session) return;
  event.preventDefault();
  finish(session, "cancel", []);
}

/** 会话起动后阻止触屏滚动；为此 `touchmove` 监听不能是 passive。 */
function touch(event: TouchEvent): void {
  if (session?.started && event.cancelable) event.preventDefault();
}

/**
 * 在元素上登记标记，并确保该 document 已装好 `pointerdown` 委托（重复添加同一监听会被浏览器忽略）。
 *
 * 句柄的 `touch-action` 按起动条件设置：长按起动用 `manipulation`，保留页面滚动；否则为 `none`。
 * 注销时恢复原值。
 * @param element 句柄或排除区元素。
 * @param claim 要登记的标记。
 * @returns 注销函数。
 */
function register(element: Element, claim: Claim): () => void {
  claims.set(element, [...(claims.get(element) ?? []), claim]);
  element.ownerDocument.addEventListener("pointerdown", down, {
    capture: true,
    passive: true,
  });
  const style =
    claim.kind === "handle" &&
    (element instanceof HTMLElement || element instanceof SVGElement)
      ? element.style
      : undefined;
  const saved = style?.touchAction;
  if (style) {
    style.touchAction =
      claim.control.activation("touch").delay === undefined
        ? "none"
        : "manipulation";
  }
  return () => {
    const rest = (claims.get(element) ?? []).filter((item) => item !== claim);
    if (rest.length > 0) claims.set(element, rest);
    else claims.delete(element);
    if (style && saved !== undefined) style.touchAction = saved;
  };
}

/**
 * 指针输入源：为句柄与排除区登记标记，按下由文档级委托路由到绑定。
 *
 * 支持鼠标、触屏与笔；动作允许旋转或缩放时最多两指。起动条件取自 `control.activation`，
 * 起动后捕获指针、清除文字选区，Esc 或 `pointercancel` 取消，拖动后吞掉随后的 click。
 * @returns 输入源。
 * @example
 * bind(node, { action: transform({ translate: true }), sensors: [pointer()] });
 */
export const pointer =
  (): Sensor =>
  (control, { element, kind, priority }) =>
    register(element, { control, kind, priority });
