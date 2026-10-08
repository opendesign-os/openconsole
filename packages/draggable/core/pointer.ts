export interface Handler {
  start(event: PointerEvent): void;
  move(event: PointerEvent): void;
  end(event: PointerEvent): void;
}

interface Session {
  readonly node: HTMLElement;
  readonly handler: Handler;
  readonly first: PointerEvent;
  readonly controller: AbortController;
  last: PointerEvent;
  started: boolean;
}

const handlers = new WeakMap<Element, Handler>();
const documents = new WeakSet<Document>();
let session: Session | undefined;

function find(event: PointerEvent): [HTMLElement, Handler] | undefined {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    const handler = handlers.get(target);
    if (handler) return [target, handler];
  }
  return undefined;
}

function prevent(event: Event): void {
  event.preventDefault();
}

function down(event: PointerEvent): void {
  if (session || !event.isPrimary || event.button !== 0) return;
  const found = find(event);
  if (!found) return;
  const [node, handler] = found;
  const controller = new AbortController();
  session = {
    node,
    handler,
    first: event,
    controller,
    last: event,
    started: false,
  };
  const options = { capture: true, signal: controller.signal };
  const { ownerDocument } = node;
  ownerDocument.addEventListener("pointermove", move, options);
  ownerDocument.addEventListener("pointerup", up, options);
  ownerDocument.addEventListener("pointercancel", up, options);
  ownerDocument.addEventListener("dragstart", prevent, options);
}

function move(event: PointerEvent): void {
  if (!session || event.pointerId !== session.first.pointerId) return;
  session.last = event;
  if (!session.started) {
    session.started = true;
    session.node.setPointerCapture(event.pointerId);
    const { ownerDocument } = session.node;
    const clear = () => ownerDocument.getSelection()?.removeAllRanges();
    clear();
    ownerDocument.addEventListener("selectionchange", clear, {
      signal: session.controller.signal,
    });
    session.handler.start(session.first);
  }
  session.handler.move(event);
}

function up(event: PointerEvent): void {
  if (!session || event.pointerId !== session.first.pointerId) return;
  session.last = event;
  stop();
}

function stop(): void {
  if (!session) return;
  const { node, handler, controller, last, started } = session;
  session = undefined;
  controller.abort();
  if (!started) return;
  if (node.hasPointerCapture(last.pointerId)) {
    node.releasePointerCapture(last.pointerId);
  }
  handler.end(last);
}

export function bind(node: HTMLElement, handler: Handler): () => void {
  handlers.set(node, handler);
  const { ownerDocument } = node;
  if (!documents.has(ownerDocument)) {
    documents.add(ownerDocument);
    ownerDocument.addEventListener("pointerdown", down, { passive: true });
  }
  return () => {
    if (handlers.get(node) === handler) handlers.delete(node);
    if (session?.handler === handler) stop();
  };
}
