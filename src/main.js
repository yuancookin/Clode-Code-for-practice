/**
 * エントリポイント。各モジュールを配線し、ストアの変更を 1 か所で描画に流す。
 */

import { formatDateJP, todayISO } from "./date.js";
import { exportCSV, exportJSON, importJSON } from "./features/backup.js";
import { initNotifications } from "./features/notifications.js";
import { initPomodoro } from "./features/pomodoro.js";
import { describeRepeat, priorityMeta } from "./model.js";
import { parseQuickAdd } from "./quickparse.js";
import { filterTasks } from "./query.js";
import { store } from "./store.js";
import { announce, debounce, h } from "./utils.js";
import { renderDetail } from "./ui/detail.js";
import { openHelp } from "./ui/help.js";
import { openPalette } from "./ui/palette.js";
import { openSettings } from "./ui/settings.js";
import { initShortcuts } from "./ui/shortcuts.js";
import { renderSidebar } from "./ui/sidebar.js";
import { applyTheme, cycleTheme, themeLabel } from "./ui/theme.js";
import { toast } from "./ui/toast.js";
import { renderToolbar } from "./ui/toolbar.js";
import { renderBoard } from "./views/board.js";
import { renderCalendar } from "./views/calendar.js";
import { renderList } from "./views/list.js";
import { renderStats } from "./views/stats.js";

const viewRoot = document.getElementById("view-root");
const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");
const quickAddForm = document.getElementById("quick-add");
const quickAddInput = document.getElementById("quick-add-input");
const quickAddHint = document.getElementById("quick-add-hint");
const statusbar = document.getElementById("statusbar");
const undoBtn = document.getElementById("btn-undo");
const redoBtn = document.getElementById("btn-redo");

const VIEW_RENDERERS = {
  list: renderList,
  board: renderBoard,
  calendar: renderCalendar,
  stats: renderStats,
};

/* ---------------- 描画 ---------------- */

let lastView = null;

function renderAll() {
  const { ui } = store;

  if (lastView !== ui.view) {
    viewRoot.replaceChildren();
    lastView = ui.view;
  }

  renderToolbar();
  renderSidebar();
  (VIEW_RENDERERS[ui.view] || renderList)(viewRoot);
  renderDetail();
  renderStatusbar();

  undoBtn.disabled = !store.canUndo;
  redoBtn.disabled = !store.canRedo;
  document.body.classList.toggle("has-selection", ui.selection.size > 0);
}

function renderStatusbar() {
  const today = todayISO();
  const visible = filterTasks(store.data, store.ui, today).length;
  const open = store.data.tasks.filter((t) => !t.deletedAt && !t.archived && t.status !== "done").length;

  statusbar.replaceChildren(
    h("span", { text: `表示 ${visible} 件 / 未完了 ${open} 件` }),
    h("span", { class: "status-sep", "aria-hidden": "true", text: "·" }),
    h("span", { text: formatDateJP(today) }),
    h("span", { class: "status-spacer" }),
    h("button", {
      type: "button",
      class: "status-command",
      text: "⌘K コマンドパレット",
      onclick: () => openPalette(paletteHooks),
    }),
    h("span", { class: "status-hint", text: "? でショートカット一覧" }),
    h("span", {
      class: "status-perf",
      title: "直近の描画にかかった時間",
      text: `${store.lastRenderMs.toFixed(1)}ms`,
    })
  );
}

/* ---------------- クイック入力 ---------------- */

function resolveProject(name) {
  if (!name) return null;
  const found = store.data.projects.find((p) => p.name === name);
  if (found) return found.id;
  return store.addProject({ name })?.id ?? null;
}

function resolveTags(names) {
  return names
    .map((name) => {
      const found = store.data.tags.find((t) => t.name === name);
      if (found) return found.id;
      return store.addTag({ name })?.id ?? null;
    })
    .filter(Boolean);
}

/** 現在のスコープを新規タスクの初期値に反映する */
function scopeDefaults() {
  const { scope } = store.ui;
  const defaults = {};
  if (scope.startsWith("project:")) defaults.projectId = scope.slice(8);
  if (scope.startsWith("tag:")) defaults.tagIds = [scope.slice(4)];
  if (scope === "today") defaults.due = todayISO();
  if (store.ui.view === "calendar" && store.ui.calendarDay) defaults.due = store.ui.calendarDay;
  return defaults;
}

function handleQuickAdd(event) {
  event.preventDefault();
  const raw = quickAddInput.value;
  const parsed = parseQuickAdd(raw);
  if (!parsed.title) {
    quickAddInput.focus();
    return;
  }

  const defaults = scopeDefaults();
  const projectId = resolveProject(parsed.projectName) ?? defaults.projectId ?? null;
  const tagIds = parsed.tagNames.length > 0 ? resolveTags(parsed.tagNames) : defaults.tagIds ?? [];

  const task = store.addTask({
    title: parsed.title,
    due: parsed.due ?? defaults.due ?? null,
    dueTime: parsed.dueTime,
    priority: parsed.priority,
    repeat: parsed.repeat,
    projectId,
    tagIds,
    remindBefore: parsed.dueTime ? store.data.settings.defaultReminder : null,
  });

  if (!task) return;
  quickAddInput.value = "";
  updateQuickAddHint();
  announce(`「${task.title}」を追加しました`);

  // 追加したタスクが現在の絞り込みに合わないと、黙って消えたように見えるので知らせる
  const visible = filterTasks(store.data, store.ui, todayISO()).some((t) => t.id === task.id);
  if (visible) {
    toast("追加しました", {
      actionLabel: "詳細を開く",
      onAction: () => store.patchUI({ selectedId: task.id }),
      duration: 3500,
    });
  } else {
    toast("追加しました（このビューの条件では表示されません）", {
      actionLabel: "表示する",
      onAction: () => {
        store.patchUI({ scope: "all", search: "", filterPriority: "all", filterStatus: "all" });
        searchInput.value = "";
        searchClear.hidden = true;
      },
      duration: 6000,
    });
  }
}

function updateQuickAddHint() {
  const raw = quickAddInput.value.trim();
  if (!raw) {
    quickAddHint.hidden = true;
    quickAddHint.replaceChildren();
    return;
  }

  const parsed = parseQuickAdd(raw);
  const chips = [];
  if (parsed.due) chips.push(`期限: ${formatDateJP(parsed.due)}`);
  if (parsed.dueTime) chips.push(`時刻: ${parsed.dueTime}`);
  if (parsed.priority) chips.push(`優先度: ${priorityMeta(parsed.priority).label}`);
  if (parsed.projectName) chips.push(`@${parsed.projectName}`);
  parsed.tagNames.forEach((name) => chips.push(`#${name}`));
  if (parsed.repeat) chips.push(describeRepeat(parsed.repeat));

  if (chips.length === 0) {
    quickAddHint.hidden = true;
    quickAddHint.replaceChildren();
    return;
  }

  quickAddHint.hidden = false;
  quickAddHint.replaceChildren(
    h("span", { class: "hint-title", text: `「${parsed.title || "（無題）"}」` }),
    ...chips.map((chip) => h("span", { class: "hint-chip", text: chip }))
  );
}

/* ---------------- 配線 ---------------- */

function initSearch() {
  const commit = debounce((value) => {
    store.patchUI({ search: value, limit: 300 });
  }, 140);

  searchInput.addEventListener("input", () => {
    searchClear.hidden = searchInput.value === "";
    commit(searchInput.value);
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.hidden = true;
    store.patchUI({ search: "" });
    searchInput.focus();
  });

  searchInput.value = store.ui.search || "";
  searchClear.hidden = searchInput.value === "";
}

function initTopbar() {
  document.getElementById("btn-menu").addEventListener("click", (event) => {
    const open = document.body.classList.toggle("sidebar-open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });

  document.getElementById("sidebar-scrim").addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
  });

  undoBtn.addEventListener("click", () => {
    if (!store.undo()) toast("元に戻せる操作がありません");
  });

  redoBtn.addEventListener("click", () => {
    if (!store.redo()) toast("やり直せる操作がありません");
  });

  document.getElementById("btn-theme").addEventListener("click", () => {
    toast(`テーマ: ${themeLabel(cycleTheme())}`, { duration: 2500 });
  });

  document.getElementById("btn-help").addEventListener("click", openHelp);
  document.getElementById("btn-settings").addEventListener("click", openSettings);
}

const paletteHooks = {
  openHelp,
  openSettings,
  toggleTheme: () => toast(`テーマ: ${themeLabel(cycleTheme())}`, { duration: 2500 }),
  exportJSON,
  exportCSV,
  importJSON: () => importJSON({ merge: true }),
};

function init() {
  applyTheme();
  initTopbar();
  initSearch();
  initShortcuts(paletteHooks);
  initPomodoro();
  initNotifications();

  quickAddForm.addEventListener("submit", handleQuickAdd);
  quickAddInput.addEventListener("input", updateQuickAddHint);
  quickAddInput.addEventListener("blur", () => {
    // 入力欄を離れたらヒントを閉じる（ボタンのクリックは先に処理させる）
    setTimeout(() => {
      if (document.activeElement !== quickAddInput) {
        quickAddHint.hidden = true;
      }
    }, 150);
  });
  quickAddInput.addEventListener("focus", updateQuickAddHint);

  window.addEventListener("beforeunload", () => store.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") store.flush();
  });

  // 検索欄で Enter を押したら結果の先頭へ移動する
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.querySelector(".task-row")?.focus();
    }
  });

  store.subscribe(renderAll);
  renderAll();
}

init();
