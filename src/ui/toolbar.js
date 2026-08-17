/**
 * ビュー切り替えと表示オプションのバー。
 */

import { todayISO } from "../date.js";
import { PRIORITIES, STATUSES } from "../model.js";
import { filterTasks, GROUP_BY_OPTIONS, scopeLabel, SORT_OPTIONS } from "../query.js";
import { store } from "../store.js";
import { h } from "../utils.js";
import { toast } from "./toast.js";

const VIEWS = [
  { id: "list", label: "リスト", icon: "☰" },
  { id: "board", label: "ボード", icon: "▦" },
  { id: "calendar", label: "カレンダー", icon: "▤" },
  { id: "stats", label: "統計", icon: "📊" },
];

export function renderToolbar() {
  const toolbar = document.getElementById("toolbar");
  if (!toolbar) return;
  const { data, ui } = store;
  const count = filterTasks(data, ui, todayISO()).length;

  toolbar.replaceChildren(
    h(
      "div",
      { class: "toolbar-row" },
      h(
        "div",
        { class: "toolbar-title" },
        h("h1", { text: scopeLabel(ui.scope, data) }),
        h("span", { class: "toolbar-count", text: `${count} 件` })
      ),
      h(
        "div",
        { class: "view-tabs", role: "tablist", "aria-label": "表示モード" },
        ...VIEWS.map((view) =>
          h(
            "button",
            {
              type: "button",
              class: `view-tab${ui.view === view.id ? " active" : ""}`,
              role: "tab",
              "aria-selected": String(ui.view === view.id),
              title: `${view.label}表示`,
              dataset: { view: view.id },
              onclick: () => store.patchUI({ view: view.id }),
            },
            h("span", { class: "tab-icon", "aria-hidden": "true", text: view.icon }),
            h("span", { class: "tab-label", text: view.label })
          )
        )
      )
    ),
    h("div", { class: "toolbar-row options" }, ...buildOptions(ui, data))
  );
}

function selectControl(label, value, options, onChange) {
  return h(
    "label",
    { class: "toolbar-select" },
    h("span", { class: "sr-only", text: label }),
    h(
      "select",
      { "aria-label": label, onchange: (event) => onChange(event.target.value) },
      ...options.map((option) =>
        h("option", { value: option.value, text: option.label, selected: option.value === value })
      )
    )
  );
}

function buildOptions(ui, data) {
  const controls = [];

  if (ui.view === "list") {
    controls.push(
      selectControl(
        "グループ化",
        ui.groupBy,
        GROUP_BY_OPTIONS.map((o) => ({ value: o.id, label: o.label })),
        (value) => store.patchUI({ groupBy: value })
      )
    );
  }

  if (ui.view === "list" || ui.view === "board") {
    controls.push(
      selectControl(
        "並び順",
        ui.sortBy,
        SORT_OPTIONS.map((o) => ({ value: o.id, label: o.label })),
        (value) => store.patchUI({ sortBy: value })
      ),
      h("button", {
        type: "button",
        class: "icon-btn small",
        title: ui.sortDir === "asc" ? "昇順（クリックで降順）" : "降順（クリックで昇順）",
        "aria-label": "並び順の向きを切り替え",
        text: ui.sortDir === "asc" ? "↑" : "↓",
        onclick: () => store.patchUI({ sortDir: ui.sortDir === "asc" ? "desc" : "asc" }),
      })
    );
  }

  controls.push(
    selectControl(
      "優先度で絞り込み",
      String(ui.filterPriority),
      [
        { value: "all", label: "優先度: すべて" },
        ...PRIORITIES.map((p) => ({ value: String(p.value), label: `優先度: ${p.label}` })),
      ],
      (value) => store.patchUI({ filterPriority: value === "all" ? "all" : Number(value) })
    ),
    selectControl(
      "ステータスで絞り込み",
      ui.filterStatus,
      [
        { value: "all", label: "状態: すべて" },
        ...STATUSES.map((s) => ({ value: s.id, label: `状態: ${s.label}` })),
      ],
      (value) => store.patchUI({ filterStatus: value })
    )
  );

  if (!["completed", "archived", "trash"].includes(ui.scope)) {
    controls.push(
      h(
        "label",
        { class: "toolbar-check" },
        h("input", {
          type: "checkbox",
          checked: ui.showCompleted,
          onchange: (event) => store.patchUI({ showCompleted: event.target.checked }),
        }),
        h("span", { text: "完了も表示" })
      )
    );
  }

  const hasFilters =
    ui.filterPriority !== "all" || ui.filterStatus !== "all" || ui.search || ui.groupBy !== "none";
  if (hasFilters) {
    controls.push(
      h("button", {
        type: "button",
        class: "btn subtle",
        text: "条件をリセット",
        onclick: () => {
          store.patchUI({ filterPriority: "all", filterStatus: "all", search: "", groupBy: "none" });
          const input = document.getElementById("search-input");
          if (input) input.value = "";
        },
      })
    );
  }

  if (ui.scope === "trash") {
    controls.push(
      h("button", {
        type: "button",
        class: "btn danger subtle",
        text: "ゴミ箱を空にする",
        onclick: () => {
          if (confirm("ゴミ箱のタスクをすべて完全に削除します。よろしいですか？")) {
            store.emptyTrash();
            toast("ゴミ箱を空にしました", { actionLabel: "取り消す", onAction: () => store.undo() });
          }
        },
      })
    );
  } else if (ui.view === "list") {
    controls.push(
      h("button", {
        type: "button",
        class: "btn subtle",
        text: "完了をアーカイブ",
        onclick: () => {
          if (store.clearCompleted()) {
            toast("完了タスクをアーカイブしました", { actionLabel: "取り消す", onAction: () => store.undo() });
          } else {
            toast("アーカイブする完了タスクがありません");
          }
        },
      })
    );
  }

  return controls;
}
