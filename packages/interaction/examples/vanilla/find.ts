export function find<T extends Element>(
  selector: string,
  type: { new (): T; prototype: T },
): T {
  const element = document.querySelector(selector);
  if (element instanceof type) return element;
  throw new Error(`missing ${selector}`);
}
