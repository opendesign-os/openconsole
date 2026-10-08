import { Draggable, type Context, type Plugin } from "@openconsole/draggable";
import { space } from "@openconsole/matrix";

function find<T extends Element>(
  selector: string,
  type: { new (): T; prototype: T },
): T {
  const element = document.querySelector(selector);
  if (element instanceof type) return element;
  throw new Error(`missing ${selector}`);
}

const board = find("#board", HTMLElement);
const snap = find("#snap", HTMLInputElement);
const lines = find("#lines", HTMLInputElement);
const step = find("#step", HTMLInputElement);
const zoom = find("#zoom", HTMLInputElement);
const turn = find("#turn", HTMLInputElement);
const reset = find("#reset", HTMLButtonElement);

function label(card: HTMLElement): Plugin {
  const show = ({ matrix }: Pick<Context, "matrix">) => {
    card.textContent = `${Math.round(matrix[12])}, ${Math.round(matrix[13])}`;
  };
  return { onAttach: show, onMove: show, onUpdate: show };
}

const home = (index: number) =>
  space.translate(40 + index * 160, 40 + index * 80, 0);

const drags = [...board.querySelectorAll<HTMLElement>(".card")].map(
  (card, index) =>
    new Draggable(card, board, { matrix: home(index) }).use(label(card)),
);

function apply(): void {
  board.style.scale = zoom.value;
  board.style.rotate = `${turn.value}deg`;
  for (const input of [step, zoom, turn]) {
    const output = input.nextElementSibling;
    if (output instanceof HTMLOutputElement) output.value = input.value;
  }
  const options = {
    grid: Number(step.value),
    snap: snap.checked,
    lines: lines.checked,
  };
  for (const drag of drags) drag.update(options);
}

for (const input of [snap, lines, step, zoom, turn]) {
  input.addEventListener("input", apply);
}
reset.addEventListener("click", () => {
  drags.forEach((drag, index) => drag.update({ matrix: home(index) }));
});
apply();
