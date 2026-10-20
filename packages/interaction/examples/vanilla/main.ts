import {
  Draggable,
  Resizable,
  Rotatable,
  type Handle,
  type Plugin,
  type State,
} from "@openconsole/interaction";
import { plane } from "@openconsole/matrix";

import { find } from "./find";

const board = find("#board", HTMLElement);
const snap = find("#snap", HTMLInputElement);
const lines = find("#lines", HTMLInputElement);
const step = find("#step", HTMLInputElement);
const zoom = find("#zoom", HTMLInputElement);
const turn = find("#turn", HTMLInputElement);
const reset = find("#reset", HTMLButtonElement);

const sides: readonly Handle["x"][] = [-1, 0, 1];
const handles: readonly Handle[] = sides
  .flatMap((x) => sides.map((y) => ({ x, y })))
  .filter(({ x, y }) => x !== 0 || y !== 0);

const cursors = new Map([
  ["0", "ew-resize"],
  ["1", "nwse-resize"],
  ["-1", "nesw-resize"],
]);

function edges(card: HTMLElement): Map<Element, Handle> {
  return new Map(
    handles.map((handle): [Element, Handle] => {
      const edge = document.createElement("i");
      edge.className = "edge";
      edge.style.left = `${((handle.x + 1) / 2) * 100}%`;
      edge.style.top = `${((handle.y + 1) / 2) * 100}%`;
      edge.style.cursor =
        handle.x === 0
          ? "ns-resize"
          : (cursors.get(`${handle.x * handle.y}`) ?? "move");
      card.append(edge);
      return [edge, handle];
    }),
  );
}

function label(card: HTMLElement): Plugin {
  const text = card.querySelector(".label") ?? card;
  const show = ({ state }: { readonly state: State }) => {
    const [a, b, , , e, f] = state.matrix;
    const degrees = Math.round((Math.atan2(b, a) * 180) / Math.PI);
    text.textContent = `${Math.round(e)}, ${Math.round(f)} · ${degrees}°`;
  };
  return { onAttach: show, onChange: show };
}

const home = (index: number) =>
  plane.translate(40 + index * 160, 40 + index * 80);
const size = { width: 120, height: 80 };

const cards = [...board.querySelectorAll<HTMLElement>(".card")].map(
  (card, index) => {
    const grip = document.createElement("i");
    grip.className = "grip";
    card.append(grip);
    return {
      drag: new Draggable(card, {
        container: board,
        matrix: home(index),
        plugins: [label(card)],
      }),
      rotate: new Rotatable(card, { handle: grip, step: Math.PI / 12 }),
      resize: new Resizable(card, {
        handles: edges(card),
        container: board,
        width: { min: 60 },
        height: { min: 40 },
      }),
    };
  },
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
  for (const { drag } of cards) drag.update(options);
}

for (const input of [snap, lines, step, zoom, turn]) {
  input.addEventListener("input", apply);
}
reset.addEventListener("click", () => {
  cards.forEach(({ drag, resize }, index) => {
    resize.update({ size });
    drag.update({ matrix: home(index) });
  });
});
apply();
