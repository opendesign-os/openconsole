import type { Input, State, Step } from "../core";
import { input } from "./router";

export type Key = Step | ((state: State) => Step | undefined);

export type Keys = Readonly<Record<string, Key>>;

export interface Grab {
  readonly keys: Keys;
  state(): State;
  start(input: Input): boolean;
  nudge(step: Step): void;
  end(input: Input): void;
  cancel(): void;
}

const targets = new WeakMap<Element, Grab>();
const documents = new WeakSet<Document>();
let active: { readonly element: Element; readonly target: Grab } | undefined;

const grabs = (key: string): boolean => key === " " || key === "Enter";

function blur(): void {
  stop("end", { points: [] });
}

function stop(kind: "end" | "cancel", last: Input): void {
  const current = active;
  if (!current) return;
  active = undefined;
  current.element.removeEventListener("blur", blur);
  if (kind === "end") current.target.end(last);
  else current.target.cancel();
}

function down(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  if (active) {
    const { target } = active;
    if (event.key === "Escape" || grabs(event.key)) {
      event.preventDefault();
      stop(event.key === "Escape" ? "cancel" : "end", input(event));
      return;
    }
    const name = event.shiftKey ? `Shift+${event.key}` : event.key;
    const key = target.keys[name] ?? target.keys[event.key];
    if (!key) return;
    event.preventDefault();
    const step = typeof key === "function" ? key(target.state()) : key;
    if (step) target.nudge(step);
    return;
  }
  if (!grabs(event.key) || !(event.target instanceof Element)) return;
  const element = event.target;
  const target = targets.get(element);
  if (!target || !target.start(input(event))) return;
  event.preventDefault();
  active = { element, target };
  element.addEventListener("blur", blur, { once: true });
}

export function listen(element: Element, target: Grab): () => void {
  targets.set(element, target);
  const document = element.ownerDocument;
  if (!documents.has(document)) {
    documents.add(document);
    document.addEventListener("keydown", down);
  }
  const focus =
    element instanceof HTMLElement &&
    !element.hasAttribute("tabindex") &&
    element.tabIndex < 0;
  if (focus) element.tabIndex = 0;
  return () => {
    if (targets.get(element) === target) targets.delete(element);
    if (focus) element.removeAttribute("tabindex");
    if (active?.target === target) stop("cancel", { points: [] });
  };
}
