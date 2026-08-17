import { getState, getTag, toggleDone, updateTask, reorderTasks, deleteTask } from "./store.js";
import { filterTasks, sortTasks } from "./filters.js";
import { el, priorityFlag, dueBadge, tagBadges, subtaskProgress, recurrenceBadge } from "./dom-helpers.js";
import { openTaskModal } from "./modal.js";
import { showToast } from "./toast.js";

const listEl = document.getElementById("todo-list");
const itemsLeftEl = document.getElementById("items-left");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");

export const selection = new Set();

function isDragEnabled(settings) {
  const f = settings.filter;
  return (
    settings.sortBy === "manual" &&
    !settings.groupByTag &&
    f.status === "all" &&
    f.priority === "all" &&
    f.tagId === "all" &&
    f.range === "all" &&
    !f.query
  );
}

function createRow(task, { selectMode, dragEnabled }) {
  const li = el("li", "todo-item" + (task.status === "done" ? " completed" : "") + (task.pinned ? " pinned" : ""));
  li.dataset.id = task.id;
  li.draggable = dragEnabled && !selectMode;

  const handle = el("span", "drag-handle" + (dragEnabled && !selectMode ? "" : " disabled"), "⋮⋮");
  handle.title = dragEnabled ? "ドラッグして並び替え" : "手動並び替えは条件なしの時のみ";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = selectMode ? "row-select" : "row-done";
  checkbox.checked = selectMode ? selection.has(task.id) : task.status === "done";

  const pinBtn = el("button", "pin-btn" + (task.pinned ? " active" : ""), task.pinned ? "★" : "☆");
  pinBtn.type = "button";
  pinBtn.setAttribute("aria-label", "ピン留め切替");

  const main = el("div", "main");
  const titleRow = el("div", "title-row");
  const flag = priorityFlag(task);
  if (flag) titleRow.appendChild(flag);
  const text = el("span", "text", task.title);
  titleRow.appendChild(text);
  main.appendChild(titleRow);

  const meta = el("div", "meta");
  const due = dueBadge(task);
  if (due) meta.appendChild(due);
  const recur = recurrenceBadge(task);
  if (recur) meta.appendChild(recur);
  const sub = subtaskProgress(task);
  if (sub) meta.appendChild(sub);
  meta.appendChild(tagBadges(task));
  if (meta.childNodes.length) main.appendChild(meta);

  const deleteBtn = el("button", "delete-btn", "✕");
  deleteBtn.type = "button";
  deleteBtn.setAttribute("aria-label", "削除");

  li.appendChild(handle);
  li.appendChild(checkbox);
  li.appendChild(pinBtn);
  li.appendChild(main);
  li.appendChild(deleteBtn);
  return li;
}

function createGroupHeader(name, color) {
  const header = el("li", "group-header");
  const dot = el("span", "dot");
  dot.style.background = color;
  header.appendChild(dot);
  header.appendChild(document.createTextNode(name));
  return header;
}

export function renderList() {
  const { tasks, tags, settings } = getState();
  const filtered = sortTasks(filterTasks(tasks, settings.filter), settings.sortBy);
  const dragEnabled = isDragEnabled(settings);
  const selectMode = settings.selectMode;

  listEl.innerHTML = "";
  listEl.classList.toggle("select-mode", selectMode);

  if (filtered.length === 0) {
    listEl.appendChild(el("li", "empty-state", "タスクがありません"));
  } else if (settings.groupByTag) {
    const groups = new Map();
    tags.forEach((tag) => groups.set(tag.id, []));
    groups.set(null, []);
    filtered.forEach((t) => {
      const key = t.tagIds.find((id) => groups.has(id)) ?? null;
      groups.get(key ?? null).push(t);
    });
    tags.forEach((tag) => {
      const items = groups.get(tag.id);
      if (!items.length) return;
      listEl.appendChild(createGroupHeader(tag.name, tag.color));
      items.forEach((t) => listEl.appendChild(createRow(t, { selectMode, dragEnabled: false })));
    });
    const untagged = groups.get(null);
    if (untagged.length) {
      listEl.appendChild(createGroupHeader("タグなし", "#c7c9d6"));
      untagged.forEach((t) => listEl.appendChild(createRow(t, { selectMode, dragEnabled: false })));
    }
  } else {
    const frag = document.createDocumentFragment();
    filtered.forEach((t) => frag.appendChild(createRow(t, { selectMode, dragEnabled })));
    listEl.appendChild(frag);
  }

  const remaining = tasks.filter((t) => t.status !== "done").length;
  itemsLeftEl.textContent = `${remaining} 件残り`;
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = `${pct}%`;

  updateBulkToolbar();
}

function updateBulkToolbar() {
  const toolbar = document.getElementById("bulk-toolbar");
  const count = document.getElementById("bulk-count");
  const { settings } = getState();
  if (settings.selectMode) {
    toolbar.classList.remove("hidden");
    count.textContent = `${selection.size}件選択中`;
  } else {
    toolbar.classList.add("hidden");
  }
}

export function clearSelection() {
  selection.clear();
}

/* ---------------- event delegation ---------------- */

listEl.addEventListener("click", (e) => {
  const li = e.target.closest(".todo-item");
  if (!li) return;
  const id = li.dataset.id;

  if (e.target.classList.contains("delete-btn")) {
    deleteTask(id);
    showToast("タスクを削除しました", { undoable: true });
    return;
  }
  if (e.target.classList.contains("pin-btn")) {
    const { tasks } = getState();
    const task = tasks.find((t) => t.id === id);
    updateTask(id, { pinned: !task.pinned });
    return;
  }
  if (e.target.classList.contains("row-select")) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    renderList();
    return;
  }
  if (e.target.classList.contains("row-done")) {
    toggleDone(id);
    return;
  }
  if (e.target.closest(".main")) {
    const { tasks } = getState();
    const task = tasks.find((t) => t.id === id);
    if (task) openTaskModal(task);
  }
});

let dragEl = null;

listEl.addEventListener("dragstart", (e) => {
  const li = e.target.closest(".todo-item");
  if (!li) return;
  dragEl = li;
  li.classList.add("dragging");
});

listEl.addEventListener("dragend", () => {
  if (!dragEl) return;
  dragEl.classList.remove("dragging");
  const orderedIds = [...listEl.querySelectorAll(".todo-item")].map((el2) => el2.dataset.id);
  reorderTasks(orderedIds);
  dragEl = null;
});

listEl.addEventListener("dragover", (e) => {
  if (!dragEl) return;
  e.preventDefault();
  const afterElement = getDragAfterElement(listEl, e.clientY);
  if (afterElement == null) {
    listEl.appendChild(dragEl);
  } else {
    listEl.insertBefore(dragEl, afterElement);
  }
});

function getDragAfterElement(container, y) {
  const items = [...container.querySelectorAll(".todo-item:not(.dragging)")];
  return items.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}
