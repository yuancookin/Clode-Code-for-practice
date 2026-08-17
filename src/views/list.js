/**
 * リストビュー。
 *
 * 大量の行でも軽く動くよう、次の 3 つを守っている:
 *  1. 行 DOM をキャッシュしてキー付きで並べ替える（毎回作り直さない）
 *  2. 行の内容は「署名」が変わったときだけ更新する
 *  3. イベントは一括委譲（行ごとに listener を張らない）
 */

import { todayISO } from "../date.js";
import { PRIORITIES, subtaskProgress } from "../model.js";
import { filterTasks, groupTasks, sortTasks } from "../query.js";
import { store } from "../store.js";
import { getDragAfterElement, h, reconcile, setChildren } from "../utils.js";
import { metaRow, progressBar } from "../ui/badges.js";
import { openDetail } from "../ui/detail.js";
import { toast } from "../ui/toast.js";

const rowCache = new Map();
const headerCache = new Map();

let listEl = null;
let bulkEl = null;
let moreEl = null;
let visibleIds = [];

/* ---------------- 行の生成 / 更新 ---------------- */

function rowSignature(task, ctx) {
  const progress = subtaskProgress(task);
  return [
    task.title,
    task.status,
    task.priority,
    task.due,
    task.dueTime,
    task.projectId,
    task.tagIds.join(","),
    task.repeat ? `${task.repeat.type}:${task.repeat.every}:${task.repeat.weekdays}` : "",
    progress ? `${progress.done}/${progress.total}` : "",
    task.pomodoros,
    task.archived,
    Boolean(task.deletedAt),
    ctx.scope,
    ctx.today,
    ctx.stamp,
    ctx.selectedId === task.id,
    ctx.selection.has(task.id),
    ctx.draggable,
  ].join("|");
}

function buildRow(task) {
  const row = h("li", {
    class: "task-row",
    dataset: { id: task.id },
    tabIndex: 0,
    role: "listitem",
  });
  row.appendChild(h("span", { class: "drag-handle", dataset: { act: "drag" }, "aria-hidden": "true", text: "⠿" }));
  row.appendChild(
    h("input", { type: "checkbox", class: "row-check", dataset: { act: "toggle" }, "aria-label": "完了にする" })
  );
  row.appendChild(h("div", { class: "row-body", dataset: { act: "open" } }));
  row.appendChild(h("div", { class: "row-actions" }));
  return row;
}

function updateRow(row, task, ctx) {
  row.className = [
    "task-row",
    task.status === "done" ? "done" : "",
    task.status === "doing" ? "doing" : "",
    ctx.selectedId === task.id ? "selected" : "",
    ctx.selection.has(task.id) ? "picked" : "",
    task.priority === 3 ? "urgent" : "",
  ]
    .filter(Boolean)
    .join(" ");
  row.draggable = ctx.draggable;
  row.setAttribute("aria-selected", String(ctx.selectedId === task.id));

  const [handle, check, body, actions] = row.children;
  handle.classList.toggle("disabled", !ctx.draggable);
  handle.title = ctx.draggable ? "ドラッグして並べ替え" : "並べ替えは「手動」かつグループ化なしのときだけ使えます";
  check.checked = task.status === "done";
  check.disabled = Boolean(task.deletedAt);

  setChildren(
    body,
    h(
      "div",
      { class: "row-title-line" },
      h("span", { class: "row-title", dataset: { act: "edit-title" }, text: task.title || "（無題）" }),
      task.notes ? h("span", { class: "note-mark", title: "メモあり", text: "🗒" }) : null
    ),
    metaRow(task, ctx.data, ctx.today),
    progressBar(task)
  );

  const buttons = [];
  if (task.deletedAt) {
    buttons.push(actionButton("restore", "↩", "元に戻す"));
    buttons.push(actionButton("purge", "🗑", "完全に削除"));
  } else {
    if (task.archived) buttons.push(actionButton("unarchive", "📤", "アーカイブから戻す"));
    buttons.push(actionButton("detail", "✎", "詳細を開く"));
    buttons.push(actionButton("delete", "✕", "削除"));
  }
  actions.replaceChildren(...buttons);
}

function actionButton(act, label, title) {
  return h("button", {
    type: "button",
    class: "icon-btn small",
    dataset: { act },
    title,
    "aria-label": title,
    text: label,
  });
}

function getRow(task, ctx) {
  let entry = rowCache.get(task.id);
  if (!entry) {
    entry = { el: buildRow(task), sig: null };
    rowCache.set(task.id, entry);
  }
  const sig = rowSignature(task, ctx);
  if (entry.sig !== sig) {
    updateRow(entry.el, task, ctx);
    entry.sig = sig;
  }
  return entry.el;
}

function getHeader(group, count) {
  const key = group.key;
  let entry = headerCache.get(key);
  if (!entry) {
    entry = { el: h("li", { class: "group-header", role: "presentation" }), label: null };
    headerCache.set(key, entry);
  }
  const label = `${group.label}|${count}|${group.color}`;
  if (entry.label !== label) {
    setChildren(
      entry.el,
      group.color ? h("span", { class: "dot", style: { background: group.color }, "aria-hidden": "true" }) : null,
      h("span", { class: "group-name", text: group.label }),
      h("span", { class: "group-count", text: String(count) })
    );
    entry.label = label;
  }
  return entry.el;
}

/* ---------------- 描画 ---------------- */

export function renderList(container) {
  ensureShell(container);

  const { data, ui } = store;
  const today = todayISO();
  const filtered = filterTasks(data, ui, today);
  const sorted = sortTasks(filtered, ui.sortBy, ui.sortDir);
  const draggable = ui.sortBy === "manual" && ui.groupBy === "none" && !ui.search;

  const limited = sorted.slice(0, ui.limit);
  visibleIds = limited.map((t) => t.id);

  const ctx = {
    data,
    today,
    scope: ui.scope,
    selectedId: ui.selectedId,
    selection: ui.selection,
    draggable,
    stamp: dataStamp(data),
  };

  const nodes = [];
  if (limited.length === 0) {
    nodes.push(emptyState(ui));
  } else {
    for (const group of groupTasks(limited, ui.groupBy, data, today)) {
      if (group.label) nodes.push(getHeader(group, group.tasks.length));
      for (const task of group.tasks) nodes.push(getRow(task, ctx));
    }
  }

  reconcile(listEl, nodes);
  renderBulkBar();
  renderMore(sorted.length, limited.length);
  pruneCache(sorted);
}

function dataStamp(data) {
  // プロジェクト / タグの名前・色が変わったら全行を描き直す必要がある
  return (
    data.projects.map((p) => `${p.id}${p.name}${p.color}`).join("") +
    data.tags.map((t) => `${t.id}${t.name}${t.color}`).join("")
  );
}

function pruneCache(tasks) {
  if (rowCache.size <= tasks.length * 2 + 50) return;
  const alive = new Set(tasks.map((t) => t.id));
  for (const id of rowCache.keys()) {
    if (!alive.has(id)) rowCache.delete(id);
  }
}

function emptyState(ui) {
  const message = ui.search
    ? `「${ui.search}」に一致するタスクはありません`
    : ui.scope === "trash"
    ? "ゴミ箱は空です"
    : ui.scope === "completed"
    ? "完了したタスクはまだありません"
    : "タスクがありません。上の入力欄から追加できます";
  return h(
    "li",
    { class: "empty-state" },
    h("div", { class: "empty-mark", "aria-hidden": "true", text: "✦" }),
    h("p", { text: message })
  );
}

function renderMore(total, shown) {
  if (total <= shown) {
    moreEl.replaceChildren();
    return;
  }
  moreEl.replaceChildren(
    h("span", { class: "more-note", text: `${total} 件中 ${shown} 件を表示中` }),
    h("button", {
      type: "button",
      class: "btn subtle",
      text: "さらに300件表示",
      onclick: () => store.patchUI({ limit: store.ui.limit + 300 }),
    })
  );
}

function renderBulkBar() {
  const { ui, data } = store;
  const ids = [...ui.selection];
  if (ids.length === 0) {
    bulkEl.hidden = true;
    bulkEl.replaceChildren();
    return;
  }
  bulkEl.hidden = false;

  const prioritySelect = h(
    "select",
    {
      class: "bulk-select",
      "aria-label": "優先度を一括変更",
      onchange: (e) => {
        if (e.target.value === "") return;
        store.bulkUpdate(ids, { priority: Number(e.target.value) });
        e.target.value = "";
        toast(`${ids.length} 件の優先度を変更しました`, { actionLabel: "取り消す", onAction: () => store.undo() });
      },
    },
    h("option", { value: "", text: "優先度…" }),
    ...PRIORITIES.map((p) => h("option", { value: String(p.value), text: p.label }))
  );

  const projectSelect = h(
    "select",
    {
      class: "bulk-select",
      "aria-label": "プロジェクトを一括変更",
      onchange: (e) => {
        if (e.target.value === "") return;
        store.bulkUpdate(ids, { projectId: e.target.value === "none" ? null : e.target.value });
        e.target.value = "";
        toast(`${ids.length} 件を移動しました`, { actionLabel: "取り消す", onAction: () => store.undo() });
      },
    },
    h("option", { value: "", text: "プロジェクト…" }),
    h("option", { value: "none", text: "なし" }),
    ...data.projects.map((p) => h("option", { value: p.id, text: p.name }))
  );

  bulkEl.replaceChildren(
    h("span", { class: "bulk-count", text: `${ids.length} 件選択中` }),
    h("button", {
      type: "button",
      class: "btn subtle",
      text: "完了にする",
      onclick: () => {
        ids.forEach((id) => {
          const task = store.getTask(id);
          if (task && task.status !== "done") store.toggleTask(id);
        });
        store.clearSelection();
      },
    }),
    prioritySelect,
    projectSelect,
    h("button", {
      type: "button",
      class: "btn subtle",
      text: "アーカイブ",
      onclick: () => {
        store.bulkUpdate(ids, { archived: true });
        store.clearSelection();
        toast(`${ids.length} 件をアーカイブしました`, { actionLabel: "取り消す", onAction: () => store.undo() });
      },
    }),
    h("button", {
      type: "button",
      class: "btn danger subtle",
      text: "削除",
      onclick: () => {
        store.bulkUpdate(ids, { deletedAt: Date.now() });
        store.clearSelection();
        toast(`${ids.length} 件をゴミ箱へ移動しました`, { actionLabel: "取り消す", onAction: () => store.undo() });
      },
    }),
    h("button", {
      type: "button",
      class: "btn subtle",
      text: "選択解除",
      onclick: () => store.clearSelection(),
    })
  );
}

/* ---------------- 骨組みとイベント ---------------- */

function ensureShell(container) {
  if (listEl && listEl.parentNode === container) return;
  container.replaceChildren();
  rowCache.clear();
  headerCache.clear();

  bulkEl = h("div", { class: "bulk-bar", hidden: true });
  listEl = h("ul", { class: "task-list", role: "list" });
  moreEl = h("div", { class: "list-more" });

  attachHandlers(listEl);
  container.append(bulkEl, listEl, moreEl);
}

function taskIdFrom(target) {
  const row = target.closest?.(".task-row");
  return row ? row.dataset.id : null;
}

function attachHandlers(el) {
  el.addEventListener("click", (event) => {
    const id = taskIdFrom(event.target);
    if (!id) return;
    const actionEl = event.target.closest("[data-act]");
    const act = actionEl?.dataset.act;

    if (event.ctrlKey || event.metaKey) {
      store.toggleSelection(id);
      return;
    }

    switch (act) {
      case "detail":
      case "open":
        openDetail(id);
        break;
      case "delete":
        store.deleteTask(id);
        toast("ゴミ箱へ移動しました", { actionLabel: "取り消す", onAction: () => store.undo() });
        break;
      case "restore":
        store.restoreTask(id);
        toast("元に戻しました");
        break;
      case "purge":
        if (!store.data.settings.confirmDelete || confirm("このタスクを完全に削除しますか？")) {
          store.purgeTask(id);
        }
        break;
      case "unarchive":
        store.setArchived(id, false);
        toast("アーカイブから戻しました");
        break;
      default:
        break;
    }
  });

  el.addEventListener("change", (event) => {
    if (event.target.dataset.act !== "toggle") return;
    const id = taskIdFrom(event.target);
    if (!id) return;
    const outcome = store.toggleTask(id);
    if (outcome === "repeated") {
      const task = store.getTask(id);
      toast(`次回の期限を ${task.due} に設定しました`, { actionLabel: "取り消す", onAction: () => store.undo() });
    } else if (outcome === "completed") {
      toast("完了しました 🎉", { actionLabel: "取り消す", onAction: () => store.undo(), duration: 3500 });
    }
  });

  el.addEventListener("dblclick", (event) => {
    if (event.target.dataset.act !== "edit-title") return;
    const id = taskIdFrom(event.target);
    if (id) startInlineEdit(event.target, id);
  });

  el.addEventListener("keydown", (event) => {
    const row = event.target.closest?.(".task-row");
    if (!row) return;
    const id = row.dataset.id;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusSibling(row, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusSibling(row, -1);
        break;
      case "Enter":
        event.preventDefault();
        openDetail(id);
        break;
      case " ":
      case "Spacebar":
        event.preventDefault();
        store.toggleTask(id);
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        store.deleteTask(id);
        toast("ゴミ箱へ移動しました", { actionLabel: "取り消す", onAction: () => store.undo() });
        break;
      case "x":
        event.preventDefault();
        store.toggleSelection(id);
        break;
      default:
        break;
    }
  });

  /* ドラッグ並べ替え */
  el.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".task-row");
    if (!row || !row.draggable) return;
    row.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.id);
  });

  el.addEventListener("dragover", (event) => {
    const dragging = el.querySelector(".task-row.dragging");
    if (!dragging) return;
    event.preventDefault();
    const after = getDragAfterElement(el, event.clientY, ".task-row");
    if (after) el.insertBefore(dragging, after);
    else el.appendChild(dragging);
  });

  el.addEventListener("dragend", (event) => {
    const row = event.target.closest(".task-row");
    if (!row) return;
    row.classList.remove("dragging");
    const ids = [...el.querySelectorAll(".task-row")].map((r) => r.dataset.id);
    store.reorderTasks(ids);
  });
}

function focusSibling(row, direction) {
  const rows = [...listEl.querySelectorAll(".task-row")];
  const index = rows.indexOf(row);
  const next = rows[index + direction];
  if (next) next.focus();
}

function startInlineEdit(titleEl, id) {
  const task = store.getTask(id);
  if (!task) return;
  const input = h("input", { type: "text", class: "inline-edit", value: task.title, maxLength: 500 });
  titleEl.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  // 署名を無効化しておかないと、内容が変わらなかったときに入力欄が残ってしまう
  const invalidate = () => {
    const entry = rowCache.get(id);
    if (entry) entry.sig = null;
  };

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    invalidate();
    const value = input.value.trim();
    if (value && value !== task.title) store.updateTask(id, { title: value });
    else store.emit();
  };

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") {
      done = true;
      invalidate();
      store.emit();
    }
  });
}

/** キーボードショートカットから先頭行にフォーカスするため */
export function focusFirstRow() {
  const first = listEl?.querySelector(".task-row");
  if (first) first.focus();
}

export function getVisibleIds() {
  return visibleIds;
}
