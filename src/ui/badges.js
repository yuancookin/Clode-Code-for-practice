/**
 * タスク行・カードで共通に使う小さな表示部品。
 */

import { diffDays, formatDueLabel, todayISO } from "../date.js";
import { describeRepeat, priorityMeta, subtaskProgress } from "../model.js";
import { priorityColor } from "../query.js";
import { h, readableTextColor, withAlpha } from "../utils.js";

export function dueBadge(task, today = todayISO()) {
  if (!task.due) return null;
  const overdue = task.status !== "done" && task.due < today;
  const soon = task.status !== "done" && diffDays(today, task.due) === 0;
  const cls = `badge due${overdue ? " overdue" : soon ? " today" : ""}`;
  const label = formatDueLabel(task.due, today);
  return h(
    "span",
    { class: cls, title: `期限: ${task.due}${task.dueTime ? ` ${task.dueTime}` : ""}` },
    h("span", { class: "badge-icon", "aria-hidden": "true", text: overdue ? "⚠" : "📅" }),
    task.dueTime ? `${label} ${task.dueTime}` : label
  );
}

export function priorityBadge(task) {
  if (!task.priority) return null;
  const meta = priorityMeta(task.priority);
  const color = priorityColor(task.priority);
  return h(
    "span",
    {
      class: "badge priority",
      style: { color, borderColor: withAlpha(color, 0.45), background: withAlpha(color, 0.12) },
      title: `優先度: ${meta.label}`,
    },
    h("span", { class: "badge-icon", "aria-hidden": "true", text: meta.icon }),
    meta.label
  );
}

export function tagBadges(task, data) {
  return task.tagIds
    .map((id) => data.tags.find((t) => t.id === id))
    .filter(Boolean)
    .map((tag) =>
      h(
        "span",
        {
          class: "badge tag",
          style: { background: tag.color, color: readableTextColor(tag.color) },
        },
        `#${tag.name}`
      )
    );
}

export function projectBadge(task, data) {
  const project = data.projects.find((p) => p.id === task.projectId);
  if (!project) return null;
  return h(
    "span",
    { class: "badge project", style: { color: project.color, borderColor: withAlpha(project.color, 0.5) } },
    h("span", { class: "dot", style: { background: project.color }, "aria-hidden": "true" }),
    project.name
  );
}

export function repeatBadge(task) {
  if (!task.repeat) return null;
  return h("span", { class: "badge repeat", title: `くり返し: ${describeRepeat(task.repeat)}` }, "🔁", describeRepeat(task.repeat));
}

export function subtaskBadge(task) {
  const progress = subtaskProgress(task);
  if (!progress) return null;
  return h(
    "span",
    { class: `badge subtasks${progress.ratio === 1 ? " complete" : ""}`, title: "サブタスクの進捗" },
    `☑ ${progress.done}/${progress.total}`
  );
}

export function progressBar(task) {
  const progress = subtaskProgress(task);
  if (!progress) return null;
  return h(
    "div",
    {
      class: "progress",
      role: "progressbar",
      "aria-valuenow": Math.round(progress.ratio * 100),
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-label": "サブタスクの進捗",
    },
    h("div", { class: "progress-fill", style: { width: `${progress.ratio * 100}%` } })
  );
}

export function pomodoroBadge(task) {
  if (!task.pomodoros) return null;
  return h("span", { class: "badge pomo", title: "完了したポモドーロ" }, `🍅 ${task.pomodoros}`);
}

/** 行・カード共通のメタ情報 */
export function metaRow(task, data, today = todayISO()) {
  const items = [
    dueBadge(task, today),
    priorityBadge(task),
    projectBadge(task, data),
    ...tagBadges(task, data),
    repeatBadge(task),
    subtaskBadge(task),
    pomodoroBadge(task),
  ].filter(Boolean);
  if (items.length === 0) return null;
  return h("div", { class: "meta" }, items);
}
