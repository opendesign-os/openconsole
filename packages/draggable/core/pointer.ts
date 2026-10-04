export interface Handler {
  start(event: PointerEvent): void;
  move(event: PointerEvent): void;
  end(event: PointerEvent): void;
}

interface Session {
  readonly node: HTMLElement;
  readonly handler: Handler;
  readonly first: PointerEvent;
  last: PointerEvent;
  started: boolean;
  select: string;
}

const handlers = new WeakMap<Element, Handler>();
const documents = new WeakSet<Document>();
let session: Session | undefined;

function owner(event: PointerEvent): [HTMLElement, Handler] | undefined {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    const handler = handlers.get(target);
    if (handler) return [target, handler];
  }
  return undefined;
}

function down(event: PointerEvent): void {
  if (session || !event.isPrimary || event.button !== 0) return;
  const found = owner(event);
  if (!found) return;
  const [node, handler] = found;
  session = {
    node,
    handler,
    first: event,
    last: event,
    started: false,
    select: "",
  };
  const { ownerDocument } = node;
  ownerDocument.addEventListener("pointermove", move, { capture: true });
  ownerDocument.addEventListener("pointerup", up, { capture: true });
  ownerDocument.addEventListener("pointercancel", up, { capture: true });
}

function move(event: PointerEvent): void {
  if (!session || event.pointerId !== session.first.pointerId) return;
  session.last = event;
  if (!session.started) {
    session.started = true;
    session.node.setPointerCapture(event.pointerId);
    const root = session.node.ownerDocument.documentElement;
    session.select = root.style.userSelect;
    root.style.userSelect = "none";
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
  const { node, handler, last, started, select } = session;
  session = undefined;
  const { ownerDocument } = node;
  ownerDocument.removeEventListener("pointermove", move, { capture: true });
  ownerDocument.removeEventListener("pointerup", up, { capture: true });
  ownerDocument.removeEventListener("pointercancel", up, { capture: true });
  if (!started) return;
  if (node.hasPointerCapture(last.pointerId)) {
    node.releasePointerCapture(last.pointerId);
  }
  ownerDocument.documentElement.style.userSelect = select;
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
    handlers.delete(node);
    if (session?.node === node) stop();
  };
}
