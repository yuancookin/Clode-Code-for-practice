/**
 * コマンドパレット（Ctrl/⌘ + K）。
 * コマンドとタスクを横断して検索し、Enter で実行する。
 */

import { SCOPES } from "../query.js";
import { store } from "../store.js";
import { h } from "../utils.js";
import { openDetail } from "./detail.js";
import { closeModal } from "./modal.js";

let overlay = null;
let inputEl = null;
let listEl = null;
let items = [];
let cursor = 0;

export function isPaletteOpen() {
  return Boolean(overlay);
}

export function closePalette() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  inputEl = null;
  listEl = null;
  items = [];
}

export function openPalette(hooks = {}) {
  if (overlay) {
    inputEl.focus();
    inputEl.select();
    return;
  }
  closeModal();

  inputEl = h("input", {
    type: "text",
    class: "palette-input",
    placeholder: "コマンドやタスクを検索…",
    "aria-label": "コマンドパレット",
    autocomplete: "off",
  });
  listEl = h("ul", { class: "palette-list", role: "listbox" });

  const panel = h(
    "div",
    { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "コマンドパレット" },
    inputEl,
    listEl,
    h("div", { class: "palette-foot", text: "↑↓ で移動 ・ Enter で実行 ・ Esc で閉じる" })
  );

  overlay = h(
    "div",
    {
      class: "palette-backdrop",
      onclick: (event) => {
        if (event.target === overlay) closePalette();
      },
    },
    panel
  );

  document.getElementById("palette-root").appendChild(overlay);

  inputEl.addEventListener("input", () => update(hooks));
  inputEl.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Enter":
        event.preventDefault();
        run(items[cursor]);
        break;
      case "Escape":
        event.preventDefault();
        closePalette();
        break;
      default:
        break;
    }
  });

  update(hooks);
  inputEl.focus();
}

function move(delta) {
  if (items.length === 0) return;
  cursor = (cursor + delta + items.length) % items.length;
  paint();
}

function run(item) {
  if (!item) return;
  closePalette();
  item.action();
}

function buildCommands(hooks) {
  const commands = [
    { group: "ビュー", label: "リスト表示", action: () => store.patchUI({ view: "list" }) },
    { group: "ビュー", label: "ボード表示", action: () => store.patchUI({ view: "board" }) },
    { group: "ビュー", label: "カレンダー表示", action: () => store.patchUI({ view: "calendar" }) },
    { group: "ビュー", label: "統計表示", action: () => store.patchUI({ view: "stats" }) },
    {
      group: "操作",
      label: "新しいタスクを追加",
      action: () => document.getElementById("quick-add-input")?.focus(),
    },
    { group: "操作", label: "元に戻す", action: () => store.undo() },
    { group: "操作", label: "やり直す", action: () => store.redo() },
    { group: "操作", label: "テーマを切り替え", action: () => hooks.toggleTheme?.() },
    { group: "操作", label: "設定を開く", action: () => hooks.openSettings?.() },
    { group: "操作", label: "ショートカット一覧", action: () => hooks.openHelp?.() },
    { group: "データ", label: "JSON でエクスポート", action: () => hooks.exportJSON?.() },
    { group: "データ", label: "CSV でエクスポート", action: () => hooks.exportCSV?.() },
    { group: "データ", label: "JSON をインポート", action: () => hooks.importJSON?.() },
  ];

  SCOPES.forEach((scope) => {
    commands.push({
      group: "移動",
      label: `${scope.label} を開く`,
      action: () => store.patchUI({ scope: scope.id }),
    });
  });

  store.data.projects.forEach((project) => {
    commands.push({
      group: "プロジェクト",
      label: project.name,
      action: () => store.patchUI({ scope: `project:${project.id}`, view: "list" }),
    });
  });

  store.data.tags.forEach((tag) => {
    commands.push({
      group: "タグ",
      label: `#${tag.name}`,
      action: () => store.patchUI({ scope: `tag:${tag.id}`, view: "list" }),
    });
  });

  return commands;
}

function update(hooks) {
  const query = inputEl.value.trim().toLowerCase();
  const commands = buildCommands(hooks).filter((c) => !query || c.label.toLowerCase().includes(query));

  const tasks = query
    ? store.data.tasks
        .filter((t) => !t.deletedAt && t.title.toLowerCase().includes(query))
        .slice(0, 8)
        .map((task) => ({
          group: "タスク",
          label: task.title || "（無題）",
          action: () => openDetail(task.id),
        }))
    : [];

  items = [...tasks, ...commands].slice(0, 40);
  cursor = 0;
  paint();
}

function paint() {
  listEl.replaceChildren(
    ...items.map((item, index) =>
      h(
        "li",
        {
          class: `palette-item${index === cursor ? " active" : ""}`,
          role: "option",
          "aria-selected": String(index === cursor),
          onmouseenter: () => {
            cursor = index;
            paint();
          },
          onclick: () => run(item),
        },
        h("span", { class: "palette-group", text: item.group }),
        h("span", { class: "palette-label", text: item.label })
      )
    )
  );

  if (items.length === 0) {
    listEl.replaceChildren(h("li", { class: "palette-empty", text: "一致する項目がありません" }));
  }
  listEl.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
}
