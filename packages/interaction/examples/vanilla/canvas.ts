import { Draggable, Zoomable, type State } from "@openconsole/interaction";
import { plane } from "@openconsole/matrix";

import { find } from "./find";

const viewport = find("#viewport", HTMLElement);
const world = find("#world", HTMLElement);
const hud = find("#hud", HTMLOutputElement);
const reset = find("#reset", HTMLButtonElement);

const show = ({ state }: { readonly state: State }) => {
  const [a, b] = state.matrix;
  hud.value = `${Math.round(Math.hypot(a, b) * 100)}%`;
};

const zoom = new Zoomable(world, {
  viewport,
  plugins: [{ onAttach: show, onChange: show }],
});

[...world.querySelectorAll<HTMLElement>(".card")].forEach((card, index) => {
  new Draggable(card, {
    container: world,
    grid: 24,
    lines: false,
    handle: card.querySelector(".title") ?? card,
    ignore: [...card.querySelectorAll(".pin")],
  }).assign({ matrix: plane.translate(120 + index * 220, 120 + index * 90) });
});

reset.addEventListener("click", () => {
  zoom.assign({ matrix: plane.identity });
});
