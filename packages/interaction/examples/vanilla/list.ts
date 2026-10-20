import { Droppable, Sortable } from "@openconsole/interaction";

import { find } from "./find";

const list = find("#list", HTMLElement);
const trash = find("#trash", HTMLElement);
const zoom = find("#zoom", HTMLInputElement);
const log = find("#log", HTMLOutputElement);

const sortable = new Sortable(list, {
  onSort: ({ item, from, to }) => {
    log.value = `${item.textContent}：${from.index + 1} → ${to.index + 1}`;
  },
});

new Droppable(trash, {
  accept: ({ node }) => list.contains(node),
  onEnter: () => trash.classList.add("over"),
  onLeave: () => trash.classList.remove("over"),
  onDrop: ({ node }) => {
    trash.classList.remove("over");
    log.value = `已删除 ${node.textContent}`;
    node.remove();
    sortable.refresh();
  },
});

function apply(): void {
  list.style.scale = zoom.value;
  const output = zoom.nextElementSibling;
  if (output instanceof HTMLOutputElement) output.value = zoom.value;
}

zoom.addEventListener("input", apply);
apply();
