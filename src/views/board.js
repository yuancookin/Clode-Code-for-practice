/**
 * カンバンボード。列間のドラッグ＆ドロップでステータスを変更できる。
 */

import { todayISO } from "../date.js";
import { STATUSES } from "../model.js";
import { filterTasks, sortTasks, statusColor } from "../query.js";
import { store } from "../store.js";
import { getDragAfterElement, h } from "../utils.js";
import { metaRow, progressBar } from "../ui/badges.js";
import { openDetail } from "../ui/detail.js";
import { toast } from "../ui/toast.js";

const CARD_LIMIT = 200;

export function renderBoard(container) {
  const { data, ui } = store;
  const today = todayISO();

  // ボードでは完了列も見せたいので、状態の絞り込みだけ外す
  const tasks = filterTasks(data, { ...ui, showCompleted: true, filterStatus: "all" }, today).filter(
    (t) => !t.deletedAt && !t.archived
  );
  const sorted = sortTasks(tasks, ui.sortBy === "manual" ? "manual" : ui.sortBy, ui.sortDir);

  const board = h(
    "div",
    { class: "board" },
    ...STATUSES.map((status) => {
      const columnTasks = sorted.filter((t) => t.status === status.id);
      return renderColumn(status, columnTasks, data, today);
    })
  );

  container.replaceChildren(board);
}

function renderColumn(status, tasks, data, today) {
  const cards = tasks.slice(0, CARD_LIMIT).map((task) => renderCard(task, data, today));

  const body = h("div", { class: "board-body", dataset: { status: status.id } }, ...cards);

  if (tasks.length === 0) {
    body.appendChild(h("div", { class: "board-empty", text: "ここにドラッグ" }));
  }
  if (tasks.length > CARD_LIMIT) {
    body.appendChild(h("div", { class: "board-empty", text: `ほか ${tasks.length - CARD_LIMIT} 件` }));
  }

  body.addEventListener("dragover", (event) => {
    if (!document.querySelector(".board-card.dragging")) return;
    event.preventDefault();
    body.classList.add("drop-target");
    const dragging = document.querySelector(".board-card.dragging");
    const after = getDragAfterElement(body, event.clientY, ".board-card");
    if (after) body.insertBefore(dragging, after);
    else body.appendChild(dragging);
  });

  body.addEventListener("dragleave", (event) => {
    if (!body.contains(event.relatedTarget)) body.classList.remove("drop-target");
  });

  body.addEventListener("drop", (event) => {
    event.preventDefault();
    body.classList.remove("drop-target");
    const id = event.dataTransfer.getData("text/plain");
    const task = store.getTask(id);
    if (!task) return;

    const ids = [...body.querySelectorAll(".board-card")].map((c) => c.dataset.id);

    if (task.status !== status.id) {
      if (status.id === "done") {
        const outcome = store.toggleTask(id);
        if (outcome === "repeated") {
          toast(`くり返しタスクなので次回（${store.getTask(id).due}）へ送りました`);
        }
      } else {
        store.updateTask(id, { status: status.id });
      }
    }
    if (ids.length > 1) store.reorderTasks(ids);
  });

  return h(
    "section",
    { class: `board-column status-${status.id}` },
    h(
      "header",
      { class: "board-head" },
      h("span", { class: "dot", style: { background: statusColor(status.id) }, "aria-hidden": "true" }),
      h("h2", { text: status.label }),
      h("span", { class: "board-count", text: String(tasks.length) })
    ),
    body
  );
}

function renderCard(task, data, today) {
  const card = h(
    "article",
    {
      class: `board-card${task.status === "done" ? " done" : ""}${task.priority === 3 ? " urgent" : ""}`,
      dataset: { id: task.id },
      draggable: true,
      tabIndex: 0,
      onclick: () => openDetail(task.id),
      onkeydown: (event) => {
        if (event.key === "Enter") openDetail(task.id);
      },
      ondragstart: (event) => {
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
      },
      ondragend: () => card.classList.remove("dragging"),
    },
    h("h3", { class: "card-title", text: task.title || "（無題）" }),
    metaRow(task, data, today),
    progressBar(task)
  );
  return card;
}
