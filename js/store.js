import { makeId, deepClone, debounce, nextRecurringDate } from "./utils.js";

const TASKS_KEY = "tmx.tasks";
const TAGS_KEY = "tmx.tags";
const SETTINGS_KEY = "tmx.settings";

const DEFAULT_SETTINGS = {
  theme: "system",
  view: "list",
  sortBy: "manual",
  groupByTag: false,
  selectMode: false,
  filter: {
    status: "all",
    tagId: "all",
    priority: "all",
    query: "",
    range: "all",
  },
  calendarCursor: null,
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function migrateTask(t, index) {
  return {
    id: t.id || makeId(),
    title: t.title ?? t.text ?? "",
    notes: t.notes ?? "",
    status: t.status || (t.completed ? "done" : "todo"),
    priority: t.priority || "none",
    tagIds: t.tagIds || (t.tagId ? [t.tagId] : []),
    dueDate: t.dueDate || null,
    dueTime: t.dueTime || null,
    subtasks: t.subtasks || [],
    recurrence: t.recurrence || null,
    pinned: !!t.pinned,
    order: t.order ?? index,
    createdAt: t.createdAt || Date.now(),
    updatedAt: t.updatedAt || Date.now(),
    completedAt: t.completedAt || (t.completed ? Date.now() : null),
  };
}

const listeners = new Set();
const undoStack = [];
const MAX_UNDO = 25;

const state = {
  tasks: load(TASKS_KEY, []).map(migrateTask),
  tags: load(TAGS_KEY, []),
  settings: Object.assign(deepClone(DEFAULT_SETTINGS), load(SETTINGS_KEY, {})),
};
state.settings.filter = Object.assign(
  deepClone(DEFAULT_SETTINGS.filter),
  state.settings.filter || {}
);

const persistTasks = debounce(() => {
  localStorage.setItem(TASKS_KEY, JSON.stringify(state.tasks));
}, 150);
const persistTags = debounce(() => {
  localStorage.setItem(TAGS_KEY, JSON.stringify(state.tags));
}, 150);
const persistSettings = debounce(() => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}, 150);

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot() {
  undoStack.push({
    tasks: deepClone(state.tasks),
    tags: deepClone(state.tags),
  });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

export function undo() {
  const prev = undoStack.pop();
  if (!prev) return false;
  state.tasks = prev.tasks;
  state.tags = prev.tags;
  persistTasks();
  persistTags();
  notify();
  return true;
}

export function canUndo() {
  return undoStack.length > 0;
}

function touch(task) {
  task.updatedAt = Date.now();
}

/* ---------------- selectors ---------------- */

export function getState() {
  return state;
}

export function getTag(id) {
  return state.tags.find((t) => t.id === id) || null;
}

export function getTasks() {
  return state.tasks;
}

/* ---------------- task actions ---------------- */

export function addTask({ title, dueDate, dueTime, tagIds, priority }) {
  snapshot();
  const maxOrder = state.tasks.reduce((m, t) => Math.max(m, t.order), -1);
  const task = {
    id: makeId(),
    title: title.trim(),
    notes: "",
    status: "todo",
    priority: priority || "none",
    tagIds: tagIds || [],
    dueDate: dueDate || null,
    dueTime: dueTime || null,
    subtasks: [],
    recurrence: null,
    pinned: false,
    order: maxOrder + 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
  };
  state.tasks.push(task);
  persistTasks();
  notify();
  return task;
}

export function updateTask(id, patch) {
  snapshot();
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, patch);
  touch(task);
  persistTasks();
  notify();
}

export function setTaskStatus(id, status) {
  snapshot();
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.status = status;
  task.completedAt = status === "done" ? Date.now() : null;
  touch(task);

  if (status === "done" && task.recurrence && task.dueDate) {
    const clone = {
      ...deepClone(task),
      id: makeId(),
      status: "todo",
      completedAt: null,
      pinned: false,
      dueDate: nextRecurringDate(task.dueDate, task.recurrence),
      subtasks: task.subtasks.map((s) => ({ ...s, done: false })),
      order: state.tasks.reduce((m, t) => Math.max(m, t.order), -1) + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.tasks.push(clone);
  }

  persistTasks();
  notify();
}

export function toggleDone(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  setTaskStatus(id, task.status === "done" ? "todo" : "done");
}

export function deleteTask(id) {
  snapshot();
  state.tasks = state.tasks.filter((t) => t.id !== id);
  persistTasks();
  notify();
}

export function deleteTasks(ids) {
  snapshot();
  const set = new Set(ids);
  state.tasks = state.tasks.filter((t) => !set.has(t.id));
  persistTasks();
  notify();
}

export function bulkUpdate(ids, patch) {
  snapshot();
  const set = new Set(ids);
  state.tasks.forEach((t) => {
    if (set.has(t.id)) {
      Object.assign(t, patch);
      touch(t);
    }
  });
  persistTasks();
  notify();
}

export function clearCompleted() {
  snapshot();
  state.tasks = state.tasks.filter((t) => t.status !== "done");
  persistTasks();
  notify();
}

export function reorderTasks(orderedIds) {
  snapshot();
  orderedIds.forEach((id, index) => {
    const task = state.tasks.find((t) => t.id === id);
    if (task) task.order = index;
  });
  persistTasks();
  notify();
}

export function addSubtask(taskId, text) {
  snapshot();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.subtasks.push({ id: makeId(), text: text.trim(), done: false });
  touch(task);
  persistTasks();
  notify();
}

export function toggleSubtask(taskId, subtaskId) {
  snapshot();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const sub = task.subtasks.find((s) => s.id === subtaskId);
  if (!sub) return;
  sub.done = !sub.done;
  touch(task);
  persistTasks();
  notify();
}

export function deleteSubtask(taskId, subtaskId) {
  snapshot();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.subtasks = task.subtasks.filter((s) => s.id !== subtaskId);
  touch(task);
  persistTasks();
  notify();
}

/* ---------------- tag actions ---------------- */

export function addTag(name, color) {
  snapshot();
  const tag = { id: makeId(), name: name.trim(), color };
  state.tags.push(tag);
  persistTags();
  notify();
  return tag;
}

export function updateTag(id, patch) {
  snapshot();
  const tag = state.tags.find((t) => t.id === id);
  if (!tag) return;
  Object.assign(tag, patch);
  persistTags();
  notify();
}

export function deleteTag(id) {
  snapshot();
  state.tags = state.tags.filter((t) => t.id !== id);
  state.tasks.forEach((t) => {
    t.tagIds = t.tagIds.filter((tid) => tid !== id);
  });
  persistTags();
  persistTasks();
  notify();
}

/* ---------------- settings ---------------- */

export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  persistSettings();
  notify();
}

export function updateFilter(patch) {
  Object.assign(state.settings.filter, patch);
  persistSettings();
  notify();
}

/* ---------------- import / export ---------------- */

export function exportData() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: state.tasks,
    tags: state.tags,
  };
}

export function importData(data, mode = "replace") {
  snapshot();
  const tasks = (data.tasks || []).map(migrateTask);
  const tags = data.tags || [];
  if (mode === "replace") {
    state.tasks = tasks;
    state.tags = tags;
  } else {
    const existingTagIds = new Set(state.tags.map((t) => t.id));
    tags.forEach((t) => {
      if (!existingTagIds.has(t.id)) state.tags.push(t);
    });
    const existingTaskIds = new Set(state.tasks.map((t) => t.id));
    tasks.forEach((t) => {
      if (existingTaskIds.has(t.id)) t.id = makeId();
      state.tasks.push(t);
    });
  }
  persistTasks();
  persistTags();
  notify();
}
