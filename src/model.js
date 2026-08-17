/**
 * データモデル定義・正規化・スキーマ移行・繰り返し計算。
 * ここも DOM / localStorage に触れない純粋モジュール。
 */

import { addDays, addMonths, isISODate, todayISO, weekday } from "./date.js";

export const SCHEMA_VERSION = 3;

export const PRIORITIES = [
  { value: 3, label: "高", icon: "!!!", token: "critical" },
  { value: 2, label: "中", icon: "!!", token: "warning" },
  { value: 1, label: "低", icon: "!", token: "info" },
  { value: 0, label: "なし", icon: "-", token: "none" },
];

export function priorityMeta(value) {
  return PRIORITIES.find((p) => p.value === value) || PRIORITIES[3];
}

export const STATUSES = [
  { id: "todo", label: "未着手" },
  { id: "doing", label: "進行中" },
  { id: "done", label: "完了" },
];

export function statusLabel(id) {
  return (STATUSES.find((s) => s.id === id) || STATUSES[0]).label;
}

export const REPEAT_TYPES = [
  { id: "daily", label: "毎日" },
  { id: "weekday", label: "平日のみ" },
  { id: "weekly", label: "毎週" },
  { id: "monthly", label: "毎月" },
  { id: "yearly", label: "毎年" },
];

export const PROJECT_COLORS = [
  "#ad1457",
  "#2a78d6",
  "#1baf7a",
  "#eb6834",
  "#4a3aa7",
  "#eda100",
  "#e87ba4",
  "#008300",
];

let idCounter = 0;

export function makeId(prefix = "id") {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

/* ---------------- ファクトリ ---------------- */

export function createTask(patch = {}) {
  const now = Date.now();
  return normalizeTask({
    id: makeId("t"),
    title: "",
    notes: "",
    status: "todo",
    priority: 0,
    projectId: null,
    tagIds: [],
    due: null,
    dueTime: null,
    remindBefore: null,
    repeat: null,
    subtasks: [],
    estimate: null,
    pomodoros: 0,
    order: now,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    completedCount: 0,
    archived: false,
    deletedAt: null,
    ...patch,
  });
}

export function createProject(patch = {}) {
  return {
    id: makeId("p"),
    name: "新しいプロジェクト",
    color: PROJECT_COLORS[0],
    order: Date.now(),
    archived: false,
    ...patch,
  };
}

export function createTag(patch = {}) {
  return {
    id: makeId("g"),
    name: "新しいタグ",
    color: PROJECT_COLORS[1],
    ...patch,
  };
}

export function createSubtask(title) {
  return { id: makeId("s"), title, done: false };
}

export function defaultSettings() {
  return {
    theme: "auto",
    accent: "#ad1457",
    notifications: false,
    defaultReminder: 30,
    confirmDelete: true,
    pomodoro: { work: 25, short: 5, long: 15, longEvery: 4 },
  };
}

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    tasks: [],
    projects: [],
    tags: [],
    completions: [],
    settings: defaultSettings(),
  };
}

export function defaultUIState() {
  return {
    view: "list",
    scope: "today",
    search: "",
    groupBy: "none",
    sortBy: "manual",
    sortDir: "asc",
    filterPriority: "all",
    filterStatus: "all",
    showCompleted: false,
    selectedId: null,
    calendarMonth: null,
    calendarDay: null,
    limit: 300,
    // 一括操作用の選択（保存しない）
    selection: new Set(),
  };
}

/* ---------------- 正規化 ---------------- */

const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export function normalizeTask(raw) {
  const now = Date.now();
  const task = raw && typeof raw === "object" ? { ...raw } : {};
  task.id = typeof task.id === "string" && task.id ? task.id : makeId("t");
  task.title = typeof task.title === "string" ? task.title.slice(0, 500) : "";
  task.notes = typeof task.notes === "string" ? task.notes.slice(0, 20000) : "";
  task.status = STATUSES.some((s) => s.id === task.status) ? task.status : "todo";
  task.priority = clampInt(task.priority, 0, 3, 0);
  task.projectId = typeof task.projectId === "string" ? task.projectId : null;
  task.tagIds = Array.isArray(task.tagIds) ? task.tagIds.filter((id) => typeof id === "string") : [];
  task.due = isISODate(task.due) ? task.due : null;
  task.dueTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(task.dueTime) ? task.dueTime : null;
  task.remindBefore = task.remindBefore == null ? null : clampInt(task.remindBefore, 0, 10080, null);
  task.repeat = normalizeRepeat(task.repeat);
  task.subtasks = Array.isArray(task.subtasks)
    ? task.subtasks
        .filter((s) => s && typeof s === "object")
        .map((s) => ({
          id: typeof s.id === "string" && s.id ? s.id : makeId("s"),
          title: typeof s.title === "string" ? s.title.slice(0, 300) : "",
          done: Boolean(s.done),
        }))
    : [];
  task.estimate = task.estimate == null ? null : clampInt(task.estimate, 0, 99, null);
  task.pomodoros = clampInt(task.pomodoros, 0, 9999, 0);
  task.order = Number.isFinite(task.order) ? task.order : now;
  task.createdAt = Number.isFinite(task.createdAt) ? task.createdAt : now;
  task.updatedAt = Number.isFinite(task.updatedAt) ? task.updatedAt : task.createdAt;
  task.completedAt = Number.isFinite(task.completedAt) ? task.completedAt : null;
  task.completedCount = clampInt(task.completedCount, 0, 99999, 0);
  task.archived = Boolean(task.archived);
  task.deletedAt = Number.isFinite(task.deletedAt) ? task.deletedAt : null;
  // status と completedAt の整合を取る
  if (task.status === "done" && !task.completedAt) task.completedAt = task.updatedAt;
  if (task.status !== "done") task.completedAt = null;
  return task;
}

export function normalizeRepeat(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = REPEAT_TYPES.some((t) => t.id === raw.type) ? raw.type : null;
  if (!type) return null;
  const repeat = {
    type,
    every: clampInt(raw.every, 1, 365, 1),
    weekdays: Array.isArray(raw.weekdays)
      ? [...new Set(raw.weekdays.map(Number).filter((n) => n >= 0 && n <= 6))].sort()
      : [],
  };
  if (type === "weekly" && repeat.weekdays.length === 0) {
    repeat.weekdays = [];
  }
  return repeat;
}

function normalizeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function normalizeProject(raw, index = 0) {
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    id: typeof p.id === "string" && p.id ? p.id : makeId("p"),
    name: typeof p.name === "string" && p.name.trim() ? p.name.slice(0, 60) : "無名プロジェクト",
    color: normalizeColor(p.color, PROJECT_COLORS[index % PROJECT_COLORS.length]),
    order: Number.isFinite(p.order) ? p.order : index,
    archived: Boolean(p.archived),
  };
}

export function normalizeTag(raw, index = 0) {
  const t = raw && typeof raw === "object" ? raw : {};
  return {
    id: typeof t.id === "string" && t.id ? t.id : makeId("g"),
    name: typeof t.name === "string" && t.name.trim() ? t.name.slice(0, 40) : "無名タグ",
    color: normalizeColor(t.color, PROJECT_COLORS[index % PROJECT_COLORS.length]),
  };
}

export function normalizeSettings(raw) {
  const base = defaultSettings();
  const s = raw && typeof raw === "object" ? raw : {};
  const pomodoro = s.pomodoro && typeof s.pomodoro === "object" ? s.pomodoro : {};
  return {
    theme: ["auto", "light", "dark"].includes(s.theme) ? s.theme : base.theme,
    accent: normalizeColor(s.accent, base.accent),
    notifications: Boolean(s.notifications),
    defaultReminder: s.defaultReminder == null ? null : clampInt(s.defaultReminder, 0, 10080, 30),
    confirmDelete: s.confirmDelete == null ? base.confirmDelete : Boolean(s.confirmDelete),
    pomodoro: {
      work: clampInt(pomodoro.work, 1, 180, base.pomodoro.work),
      short: clampInt(pomodoro.short, 1, 60, base.pomodoro.short),
      long: clampInt(pomodoro.long, 1, 120, base.pomodoro.long),
      longEvery: clampInt(pomodoro.longEvery, 2, 12, base.pomodoro.longEvery),
    },
  };
}

/**
 * 保存済みデータを現行スキーマへ変換する。
 * legacy には旧バージョン（todos / tags キー）のデータを渡せる。
 */
export function migrate(raw, legacy = null) {
  const state = emptyState();

  if (raw && typeof raw === "object" && Array.isArray(raw.tasks)) {
    state.projects = raw.projects?.map?.(normalizeProject) ?? [];
    state.tags = raw.tags?.map?.(normalizeTag) ?? [];
    state.tasks = raw.tasks.map(normalizeTask);
    state.completions = Array.isArray(raw.completions)
      ? raw.completions
          .filter((c) => c && Number.isFinite(c.at))
          .map((c) => ({
            at: c.at,
            taskId: typeof c.taskId === "string" ? c.taskId : null,
            title: typeof c.title === "string" ? c.title : "",
            projectId: typeof c.projectId === "string" ? c.projectId : null,
            priority: clampInt(c.priority, 0, 3, 0),
          }))
      : [];
    state.settings = normalizeSettings(raw.settings);
  } else if (legacy && Array.isArray(legacy.todos)) {
    // v1/v2（シンプルな Todo アプリ）からの取り込み
    state.tags = (legacy.tags || []).map(normalizeTag);
    state.tasks = legacy.todos.map((todo, index) =>
      normalizeTask({
        id: typeof todo?.id === "string" ? todo.id : makeId("t"),
        title: typeof todo?.text === "string" ? todo.text : "",
        status: todo?.completed ? "done" : "todo",
        due: isISODate(todo?.dueDate) ? todo.dueDate : null,
        tagIds: typeof todo?.tagId === "string" ? [todo.tagId] : [],
        order: index,
        completedAt: todo?.completed ? Date.now() : null,
      })
    );
  }

  // 参照切れの projectId / tagId を掃除する
  const projectIds = new Set(state.projects.map((p) => p.id));
  const tagIds = new Set(state.tags.map((t) => t.id));
  state.tasks.forEach((task) => {
    if (task.projectId && !projectIds.has(task.projectId)) task.projectId = null;
    task.tagIds = task.tagIds.filter((id) => tagIds.has(id));
  });

  state.version = SCHEMA_VERSION;
  return state;
}

/* ---------------- 繰り返し ---------------- */

/**
 * 繰り返し設定に対する baseISO の「次の日付」を返す。
 * 対応できない設定なら null。
 */
export function nextOccurrence(repeat, baseISO) {
  const rule = normalizeRepeat(repeat);
  if (!rule || !isISODate(baseISO)) return null;
  const every = rule.every || 1;

  switch (rule.type) {
    case "daily":
      return addDays(baseISO, every);

    case "weekday": {
      let next = addDays(baseISO, 1);
      let guard = 0;
      while ([0, 6].includes(weekday(next)) && guard < 10) {
        next = addDays(next, 1);
        guard += 1;
      }
      return next;
    }

    case "weekly": {
      if (rule.weekdays.length === 0) return addDays(baseISO, 7 * every);
      // base の翌日から数えて、最初に該当する曜日
      for (let i = 1; i <= 7 * every + 7; i += 1) {
        const candidate = addDays(baseISO, i);
        if (rule.weekdays.includes(weekday(candidate))) return candidate;
      }
      return addDays(baseISO, 7 * every);
    }

    case "monthly":
      return addMonths(baseISO, every);

    case "yearly":
      return addMonths(baseISO, 12 * every);

    default:
      return null;
  }
}

export function describeRepeat(repeat) {
  const rule = normalizeRepeat(repeat);
  if (!rule) return "なし";
  const every = rule.every || 1;
  switch (rule.type) {
    case "daily":
      return every === 1 ? "毎日" : `${every}日ごと`;
    case "weekday":
      return "平日のみ";
    case "weekly":
      if (rule.weekdays.length > 0) {
        const names = rule.weekdays.map((w) => ["日", "月", "火", "水", "木", "金", "土"][w]);
        return `毎週 ${names.join("・")}`;
      }
      return every === 1 ? "毎週" : `${every}週ごと`;
    case "monthly":
      return every === 1 ? "毎月" : `${every}ヶ月ごと`;
    case "yearly":
      return every === 1 ? "毎年" : `${every}年ごと`;
    default:
      return "なし";
  }
}

/* ---------------- 派生値 ---------------- */

export function subtaskProgress(task) {
  const total = task.subtasks?.length || 0;
  if (total === 0) return null;
  const done = task.subtasks.filter((s) => s.done).length;
  return { done, total, ratio: done / total };
}

export function isActive(task) {
  return !task.archived && !task.deletedAt;
}

export function isOverdue(task, today = todayISO()) {
  if (!task.due || task.status === "done") return false;
  return task.due < today;
}

export function isDueToday(task, today = todayISO()) {
  return Boolean(task.due) && task.due === today && task.status !== "done";
}
