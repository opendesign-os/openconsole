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
  const drag = new Draggable(card, {
    container: world,
    matrix: plane.translate(120 + index * 220, 120 + index * 90),
    grid: 24,
    lines: false,
  });
  const title = card.querySelector(".title");
  const pin = card.querySelector(".pin");
  if (title) drag.handle(title);
  if (pin) drag.ignore(pin);
});

reset.addEventListener("click", () => {
  zoom.update({ matrix: plane.identity });
});
