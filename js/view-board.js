import { getState, setTaskStatus } from "./store.js";
import { filterTasks, sortTasks } from "./filters.js";
import { el, priorityFlag, dueBadge, tagBadges, subtaskProgress, recurrenceBadge } from "./dom-helpers.js";
import { openTaskModal } from "./modal.js";

const boardEl = document.getElementById("board-columns");

const COLUMNS = [
  { status: "todo", label: "未着手", icon: "📝" },
  { status: "doing", label: "進行中", icon: "🚧" },
  { status: "done", label: "完了", icon: "✅" },
];

function createCard(task) {
  const card = el("div", "kanban-card");
  card.draggable = true;
  card.dataset.id = task.id;

  const titleRow = el("div", "title-row");
  const flag = priorityFlag(task);
  if (flag) titleRow.appendChild(flag);
  titleRow.appendChild(el("span", "text", task.title));
  card.appendChild(titleRow);

  const meta = el("div", "meta");
  const due = dueBadge(task);
  if (due) meta.appendChild(due);
  const recur = recurrenceBadge(task);
  if (recur) meta.appendChild(recur);
  const sub = subtaskProgress(task);
  if (sub) meta.appendChild(sub);
  meta.appendChild(tagBadges(task));
  if (meta.childNodes.length) card.appendChild(meta);

  card.addEventListener("click", () => openTaskModal(task));
  card.addEventListener("dragstart", () => card.classList.add("dragging"));
  card.addEventListener("dragend", () => card.classList.remove("dragging"));

  return card;
}

export function renderBoard() {
  const { tasks, settings } = getState();
  const filtered = sortTasks(
    filterTasks(tasks, settings.filter, { includeStatus: false }),
    settings.sortBy
  );

  boardEl.innerHTML = "";
  COLUMNS.forEach((col) => {
    const items = filtered.filter((t) => t.status === col.status);
    const columnEl = el("div", "kanban-column");
    columnEl.dataset.status = col.status;

    const header = el("div", "kanban-header");
    header.appendChild(el("span", null, `${col.icon} ${col.label}`));
    header.appendChild(el("span", "kanban-count", String(items.length)));
    columnEl.appendChild(header);

    const body = el("div", "kanban-body");
    if (items.length === 0) {
      body.appendChild(el("div", "empty-state small", "タスクなし"));
    } else {
      items.forEach((t) => body.appendChild(createCard(t)));
    }
    columnEl.appendChild(body);
    boardEl.appendChild(columnEl);

    body.addEventListener("dragover", (e) => {
      e.preventDefault();
      body.classList.add("drag-over");
    });
    body.addEventListener("dragleave", () => body.classList.remove("drag-over"));
    body.addEventListener("drop", (e) => {
      e.preventDefault();
      body.classList.remove("drag-over");
      const dragging = boardEl.querySelector(".kanban-card.dragging");
      if (!dragging) return;
      const id = dragging.dataset.id;
      const task = getState().tasks.find((t) => t.id === id);
      if (task && task.status !== col.status) {
        setTaskStatus(id, col.status);
      }
    });
  });
}
