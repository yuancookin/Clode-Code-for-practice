import { getTag } from "./store.js";
import { formatDateTime, dueStatus } from "./utils.js";

const PRIORITY_LABEL = { high: "高", medium: "中", low: "低", none: "" };

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function priorityFlag(task) {
  if (task.priority === "none") return null;
  const flag = el("span", `priority-flag priority-${task.priority}`);
  flag.title = `優先度: ${PRIORITY_LABEL[task.priority]}`;
  flag.textContent = "●";
  return flag;
}

export function dueBadge(task) {
  if (!task.dueDate) return null;
  const status = dueStatus(task.dueDate, task.status);
  const badge = el(
    "span",
    "due-badge" + (status ? ` ${status}` : ""),
    formatDateTime(task.dueDate, task.dueTime)
  );
  return badge;
}

export function tagBadges(task) {
  const frag = document.createDocumentFragment();
  task.tagIds.forEach((id) => {
    const tag = getTag(id);
    if (!tag) return;
    const badge = el("span", "tag-badge");
    badge.style.background = tag.color;
    const dot = el("span", "dot");
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode(tag.name));
    frag.appendChild(badge);
  });
  return frag;
}

export function subtaskProgress(task) {
  if (!task.subtasks.length) return null;
  const done = task.subtasks.filter((s) => s.done).length;
  return el("span", "subtask-badge", `☑ ${done}/${task.subtasks.length}`);
}

export function recurrenceBadge(task) {
  if (!task.recurrence) return null;
  const label = { daily: "毎日", weekly: "毎週", monthly: "毎月" }[task.recurrence.freq];
  return el("span", "recur-badge", `↻ ${label}`);
}
