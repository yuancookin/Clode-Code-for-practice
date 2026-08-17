import {
  getState,
  subscribe,
  addTask,
  updateSettings,
  updateFilter,
  clearCompleted,
  deleteTasks,
  bulkUpdate,
  exportData,
  importData,
  undo,
} from "./store.js";
import { renderList, selection, clearSelection } from "./view-list.js";
import { renderBoard } from "./view-board.js";
import { renderCalendar } from "./view-calendar.js";
import { renderStats } from "./view-stats.js";
import { openTaskModal, closeTaskModal, isModalOpen } from "./modal.js";
import { openTagModal, closeTagModal, isTagModalOpen } from "./tags-modal.js";
import { showToast } from "./toast.js";
import { debounce, todayISO } from "./utils.js";

/* ---------------- element refs ---------------- */

const quickAddForm = document.getElementById("quick-add-form");
const quickAddInput = document.getElementById("quick-add-input");
const quickAddPriority = document.getElementById("quick-add-priority");
const quickAddDue = document.getElementById("quick-add-due");

const searchBar = document.getElementById("search-bar");
const searchInput = document.getElementById("search-input");
const btnSearch = document.getElementById("btn-search");
const searchClose = document.getElementById("search-close");

const btnTheme = document.getElementById("btn-theme");
const btnShortcuts = document.getElementById("btn-shortcuts");
const shortcutsModal = document.getElementById("shortcuts-modal");
const shortcutsClose = document.getElementById("shortcuts-close");

const btnMenu = document.getElementById("btn-menu");
const menuPanel = document.getElementById("menu-panel");
const btnExport = document.getElementById("btn-export");
const btnExportCsv = document.getElementById("btn-export-csv");
const btnImport = document.getElementById("btn-import");
const importFile = document.getElementById("import-file");
const btnTags = document.getElementById("btn-tags");
const btnNotify = document.getElementById("btn-notify");

const viewTabs = document.querySelectorAll(".view-tab");
const viewPanels = {
  list: document.getElementById("view-list"),
  board: document.getElementById("view-board"),
  calendar: document.getElementById("view-calendar"),
  stats: document.getElementById("view-stats"),
};

const filterStatus = document.getElementById("filter-status");
const filterRange = document.getElementById("filter-range");
const filterPriority = document.getElementById("filter-priority");
const filterTag = document.getElementById("filter-tag");
const sortBy = document.getElementById("sort-by");
const toggleGroupTag = document.getElementById("toggle-group-tag");
const toggleSelectMode = document.getElementById("toggle-select-mode");
const btnClearCompleted = document.getElementById("btn-clear-completed");

const bulkToolbar = document.getElementById("bulk-toolbar");
const bulkPriority = document.getElementById("bulk-priority");

/* ---------------- rendering ---------------- */

function syncControls() {
  const { settings, tags } = getState();
  const f = settings.filter;

  [...filterStatus.children].forEach((b) =>
    b.classList.toggle("active", b.dataset.status === f.status)
  );
  [...filterRange.children].forEach((b) =>
    b.classList.toggle("active", b.dataset.range === f.range)
  );
  [...filterPriority.children].forEach((b) =>
    b.classList.toggle("active", b.dataset.priority === f.priority)
  );

  const tagValue = filterTag.value;
  filterTag.innerHTML = '<option value="all">すべてのタグ</option><option value="none">タグなし</option>';
  tags.forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag.id;
    opt.textContent = tag.name;
    filterTag.appendChild(opt);
  });
  filterTag.value = ["all", "none", ...tags.map((t) => t.id)].includes(f.tagId) ? f.tagId : "all";

  sortBy.value = settings.sortBy;
  toggleGroupTag.checked = settings.groupByTag;
  toggleSelectMode.checked = settings.selectMode;
  if (!settings.selectMode) clearSelection();

  viewTabs.forEach((tab) => {
    const active = tab.dataset.view === settings.view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  Object.entries(viewPanels).forEach(([key, panel]) => {
    panel.classList.toggle("hidden", key !== settings.view);
  });

  applyTheme();
}

function renderActiveView() {
  const { settings } = getState();
  switch (settings.view) {
    case "board":
      renderBoard();
      break;
    case "calendar":
      renderCalendar();
      break;
    case "stats":
      renderStats();
      break;
    default:
      renderList();
  }
}

function render() {
  syncControls();
  renderActiveView();
}

subscribe(render);

/* ---------------- theme ---------------- */

function resolvedTheme() {
  const { settings } = getState();
  if (settings.theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return settings.theme;
}

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getState().settings.theme === "system") applyTheme();
});

btnTheme.addEventListener("click", () => {
  const order = ["system", "light", "dark"];
  const current = getState().settings.theme;
  const next = order[(order.indexOf(current) + 1) % order.length];
  updateSettings({ theme: next });
  showToast(
    next === "system" ? "テーマ: システム設定" : next === "light" ? "テーマ: ライト" : "テーマ: ダーク"
  );
});

/* ---------------- quick add ---------------- */

quickAddForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = quickAddInput.value.trim();
  if (!title) return;
  addTask({
    title,
    dueDate: quickAddDue.value || null,
    priority: quickAddPriority.value,
  });
  quickAddInput.value = "";
  quickAddDue.value = "";
  quickAddPriority.value = "none";
  quickAddInput.focus();
});

/* ---------------- search ---------------- */

function openSearch() {
  searchBar.classList.remove("hidden");
  searchInput.focus();
}
function closeSearch() {
  searchBar.classList.add("hidden");
  searchInput.value = "";
  searchInput.blur();
  updateFilter({ query: "" });
}
btnSearch.addEventListener("click", () => {
  if (searchBar.classList.contains("hidden")) openSearch();
  else closeSearch();
});
searchClose.addEventListener("click", closeSearch);
searchInput.addEventListener(
  "input",
  debounce(() => updateFilter({ query: searchInput.value }), 120)
);

/* ---------------- menu ---------------- */

btnMenu.addEventListener("click", () => menuPanel.classList.toggle("hidden"));
document.addEventListener("click", (e) => {
  if (!menuPanel.contains(e.target) && e.target !== btnMenu) {
    menuPanel.classList.add("hidden");
  }
});

btnExport.addEventListener("click", () => {
  const data = exportData();
  downloadFile(
    `taskmax-export-${todayISO()}.json`,
    JSON.stringify(data, null, 2),
    "application/json"
  );
  menuPanel.classList.add("hidden");
});

btnExportCsv.addEventListener("click", () => {
  const { tasks } = getState();
  const header = ["title", "status", "priority", "dueDate", "dueTime", "tags", "notes"];
  const rows = tasks.map((t) => [
    t.title,
    t.status,
    t.priority,
    t.dueDate || "",
    t.dueTime || "",
    t.tagIds.join("|"),
    (t.notes || "").replace(/\n/g, " "),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  downloadFile(`taskmax-export-${todayISO()}.csv`, "﻿" + csv, "text/csv");
  menuPanel.classList.add("hidden");
});

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

btnImport.addEventListener("click", () => {
  importFile.click();
  menuPanel.classList.add("hidden");
});
importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const replace = confirm(
      "既存のタスクを置き換えますか？\nOK: 置き換え / キャンセル: 追加としてインポート"
    );
    importData(data, replace ? "replace" : "merge");
    showToast("インポートが完了しました");
  } catch {
    showToast("インポートに失敗しました（JSON形式を確認してください）");
  }
  importFile.value = "";
});

btnTags.addEventListener("click", () => {
  openTagModal();
  menuPanel.classList.add("hidden");
});

btnNotify.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showToast("このブラウザは通知に対応していません");
    return;
  }
  const permission = await Notification.requestPermission();
  showToast(permission === "granted" ? "通知を有効化しました" : "通知が許可されませんでした");
  menuPanel.classList.add("hidden");
});

/* ---------------- view tabs ---------------- */

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => updateSettings({ view: tab.dataset.view }));
});

/* ---------------- filters ---------------- */

filterStatus.addEventListener("click", (e) => {
  if (e.target.dataset.status) updateFilter({ status: e.target.dataset.status });
});
filterRange.addEventListener("click", (e) => {
  if (e.target.dataset.range) updateFilter({ range: e.target.dataset.range });
});
filterPriority.addEventListener("click", (e) => {
  if (e.target.dataset.priority) updateFilter({ priority: e.target.dataset.priority });
});
filterTag.addEventListener("change", () => updateFilter({ tagId: filterTag.value }));
sortBy.addEventListener("change", () => updateSettings({ sortBy: sortBy.value }));
toggleGroupTag.addEventListener("change", () =>
  updateSettings({ groupByTag: toggleGroupTag.checked })
);
toggleSelectMode.addEventListener("change", () => {
  clearSelection();
  updateSettings({ selectMode: toggleSelectMode.checked });
});

btnClearCompleted.addEventListener("click", () => {
  const { tasks } = getState();
  if (!tasks.some((t) => t.status === "done")) return;
  clearCompleted();
  showToast("完了済みタスクを削除しました", { undoable: true });
});

/* ---------------- bulk toolbar ---------------- */

bulkToolbar.addEventListener("click", (e) => {
  const action = e.target.dataset.bulk;
  if (!action) return;
  const ids = [...selection];
  if (ids.length === 0) return;
  if (action === "done") bulkUpdate(ids, { status: "done", completedAt: Date.now() });
  if (action === "todo") bulkUpdate(ids, { status: "todo", completedAt: null });
  if (action === "delete") {
    deleteTasks(ids);
    showToast(`${ids.length}件のタスクを削除しました`, { undoable: true });
  }
  clearSelection();
  renderList();
});

document.getElementById("bulk-cancel").addEventListener("click", () => {
  clearSelection();
  updateSettings({ selectMode: false });
});

bulkPriority.addEventListener("change", () => {
  const value = bulkPriority.value;
  if (!value) return;
  const ids = [...selection];
  if (ids.length) bulkUpdate(ids, { priority: value });
  bulkPriority.value = "";
});

/* ---------------- shortcuts modal ---------------- */

btnShortcuts.addEventListener("click", () => shortcutsModal.classList.remove("hidden"));
shortcutsClose.addEventListener("click", () => shortcutsModal.classList.add("hidden"));
shortcutsModal.addEventListener("click", (e) => {
  if (e.target === shortcutsModal) shortcutsModal.classList.add("hidden");
});

/* ---------------- keyboard shortcuts ---------------- */

function isTyping(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (isModalOpen()) return closeTaskModal();
    if (isTagModalOpen()) return closeTagModal();
    if (!shortcutsModal.classList.contains("hidden")) return shortcutsModal.classList.add("hidden");
    if (!searchBar.classList.contains("hidden")) return closeSearch();
    document.getElementById("day-popover").classList.add("hidden");
    if (document.activeElement) document.activeElement.blur();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (undo()) showToast("元に戻しました");
    return;
  }

  if (isTyping(e.target)) return;

  if (e.key === "n") {
    e.preventDefault();
    quickAddInput.focus();
  } else if (e.key === "/") {
    e.preventDefault();
    openSearch();
  } else if (e.key === "?") {
    shortcutsModal.classList.remove("hidden");
  } else if (["1", "2", "3", "4"].includes(e.key)) {
    const views = ["list", "board", "calendar", "stats"];
    updateSettings({ view: views[Number(e.key) - 1] });
  }
});

/* ---------------- due-date notifications ---------------- */

const notified = new Set();
function checkDueNotifications() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const { tasks } = getState();
  const today = todayISO();
  tasks.forEach((t) => {
    if (t.status === "done" || !t.dueDate || t.dueDate > today) return;
    if (notified.has(t.id)) return;
    notified.add(t.id);
    const label = t.dueDate < today ? "期限切れ" : "本日期限";
    new Notification(`${label}: ${t.title}`, { body: t.notes || "" });
  });
}
setInterval(checkDueNotifications, 60000);

/* ---------------- service worker ---------------- */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

/* ---------------- init ---------------- */

render();
setTimeout(checkDueNotifications, 1000);
