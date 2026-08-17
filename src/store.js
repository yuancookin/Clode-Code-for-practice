/**
 * アプリ状態のシングルストア。
 * - localStorage への保存（デバウンス）
 * - 旧スキーマからの自動移行
 * - Undo / Redo（スナップショット方式）
 * - 変更通知は requestAnimationFrame でまとめる
 */

import { todayISO, currentMonthKey } from "./date.js";
import {
  createProject,
  createSubtask,
  createTag,
  createTask,
  defaultUIState,
  emptyState,
  migrate,
  nextOccurrence,
  normalizeSettings,
  SCHEMA_VERSION,
} from "./model.js";

const DATA_KEY = "taskflow.data.v3";
const UI_KEY = "taskflow.ui.v3";
const LEGACY_TODOS_KEY = "todos";
const LEGACY_TAGS_KEY = "tags";
const UNDO_LIMIT = 60;
const TRASH_RETENTION_DAYS = 30;
const COMPLETION_LOG_LIMIT = 2000;
const PERSISTED_UI_KEYS = [
  "view",
  "scope",
  "groupBy",
  "sortBy",
  "sortDir",
  "showCompleted",
  "filterPriority",
  "filterStatus",
];

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadData() {
  const stored = readJSON(DATA_KEY);
  if (stored) return migrate(stored);

  // 旧「Todo アプリ」のデータがあれば取り込む
  const todos = readJSON(LEGACY_TODOS_KEY);
  if (Array.isArray(todos)) {
    const tags = readJSON(LEGACY_TAGS_KEY);
    return migrate(null, { todos, tags: Array.isArray(tags) ? tags : [] });
  }
  return emptyState();
}

function snapshot(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export class Store {
  constructor() {
    this.data = loadData();
    this.purgeExpiredTrash();

    const savedUI = readJSON(UI_KEY) || {};
    this.ui = { ...defaultUIState() };
    for (const key of PERSISTED_UI_KEYS) {
      if (savedUI[key] !== undefined) this.ui[key] = savedUI[key];
    }
    this.ui.calendarMonth = currentMonthKey();

    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.frame = 0;
    this.saveTimer = 0;
    this.lastRenderMs = 0;
  }

  /* ------------- 購読 ------------- */

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const started = performance.now();
      this.listeners.forEach((fn) => fn(this));
      this.lastRenderMs = performance.now() - started;
    });
  }

  /* ------------- 永続化 ------------- */

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.saveTimer);
    try {
      this.data.version = SCHEMA_VERSION;
      localStorage.setItem(DATA_KEY, JSON.stringify(this.data));
      const uiSubset = {};
      for (const key of PERSISTED_UI_KEYS) uiSubset[key] = this.ui[key];
      localStorage.setItem(UI_KEY, JSON.stringify(uiSubset));
      return true;
    } catch (error) {
      console.error("保存に失敗しました", error);
      return false;
    }
  }

  /* ------------- 変更 ------------- */

  /**
   * データを変更する唯一の入口。
   * mutator が false を返した場合は「変更なし」として扱う。
   */
  update(mutator, { undoable = true } = {}) {
    const before = undoable ? snapshot(this.data) : null;
    const result = mutator(this.data);
    if (result === false) return false;
    if (before) {
      this.undoStack.push(before);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.scheduleSave();
    this.emit();
    return result;
  }

  /** UI 状態のみの変更（Undo 対象外） */
  patchUI(patch) {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (this.ui[key] !== value) {
        this.ui[key] = value;
        changed = true;
      }
    }
    if (!changed) return false;
    this.scheduleSave();
    this.emit();
    return true;
  }

  /* ------------- 複数選択（保存しない） ------------- */

  toggleSelection(id) {
    if (this.ui.selection.has(id)) this.ui.selection.delete(id);
    else this.ui.selection.add(id);
    this.emit();
  }

  clearSelection() {
    if (this.ui.selection.size === 0) return false;
    this.ui.selection.clear();
    this.emit();
    return true;
  }

  selectAll(ids) {
    ids.forEach((id) => this.ui.selection.add(id));
    this.emit();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(snapshot(this.data));
    this.data = previous;
    this.scheduleSave();
    this.emit();
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(snapshot(this.data));
    this.data = next;
    this.scheduleSave();
    this.emit();
    return true;
  }

  /* ------------- 参照ヘルパー ------------- */

  getTask(id) {
    return this.data.tasks.find((t) => t.id === id) || null;
  }

  getProject(id) {
    return this.data.projects.find((p) => p.id === id) || null;
  }

  getTag(id) {
    return this.data.tags.find((t) => t.id === id) || null;
  }

  /* ------------- タスク操作 ------------- */

  addTask(patch = {}) {
    const maxOrder = this.data.tasks.reduce((max, t) => Math.max(max, t.order), 0);
    const task = createTask({ ...patch, order: maxOrder + 1 });
    if (!task.title.trim()) return null;
    this.update((data) => {
      data.tasks.push(task);
    });
    return task;
  }

  updateTask(id, patch) {
    return this.update((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task) return false;
      Object.assign(task, patch, { updatedAt: Date.now() });
      if (task.status === "done" && !task.completedAt) task.completedAt = Date.now();
      if (task.status !== "done") task.completedAt = null;
      return true;
    });
  }

  logCompletion(data, task) {
    data.completions.push({
      at: Date.now(),
      taskId: task.id,
      title: task.title,
      projectId: task.projectId,
      priority: task.priority,
    });
    if (data.completions.length > COMPLETION_LOG_LIMIT) {
      data.completions.splice(0, data.completions.length - COMPLETION_LOG_LIMIT);
    }
  }

  /**
   * 完了トグル。繰り返しタスクは完了扱いにせず、次回の期限へ送る。
   * @returns {"completed"|"repeated"|"reopened"|false}
   */
  toggleTask(id) {
    let outcome = false;
    this.update((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task) return false;

      if (task.status === "done") {
        task.status = "todo";
        task.completedAt = null;
        task.updatedAt = Date.now();
        outcome = "reopened";
        return true;
      }

      this.logCompletion(data, task);
      task.completedCount += 1;
      task.updatedAt = Date.now();

      if (task.repeat) {
        const base = task.due || todayISO();
        const next = nextOccurrence(task.repeat, base);
        if (next) {
          task.due = next;
          task.status = "todo";
          task.completedAt = null;
          task.subtasks.forEach((s) => {
            s.done = false;
          });
          outcome = "repeated";
          return true;
        }
      }

      task.status = "done";
      task.completedAt = Date.now();
      outcome = "completed";
      return true;
    });
    return outcome;
  }

  setStatus(id, status) {
    const task = this.getTask(id);
    if (!task || task.status === status) return false;
    if (status === "done") return this.toggleTask(id);
    return this.updateTask(id, { status });
  }

  deleteTask(id) {
    return this.update((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task) return false;
      task.deletedAt = Date.now();
      task.updatedAt = Date.now();
      return true;
    });
  }

  restoreTask(id) {
    return this.update((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task) return false;
      task.deletedAt = null;
      task.archived = false;
      task.updatedAt = Date.now();
      return true;
    });
  }

  purgeTask(id) {
    return this.update((data) => {
      const index = data.tasks.findIndex((t) => t.id === id);
      if (index === -1) return false;
      data.tasks.splice(index, 1);
      return true;
    });
  }

  emptyTrash() {
    return this.update((data) => {
      const before = data.tasks.length;
      data.tasks = data.tasks.filter((t) => !t.deletedAt);
      return data.tasks.length !== before;
    });
  }

  /** 起動時に 30 日を過ぎたゴミ箱を掃除する（Undo 対象外） */
  purgeExpiredTrash() {
    const limit = Date.now() - TRASH_RETENTION_DAYS * 86400000;
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter((t) => !t.deletedAt || t.deletedAt > limit);
    return this.data.tasks.length !== before;
  }

  setArchived(id, archived) {
    return this.update((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task || task.archived === archived) return false;
      task.archived = archived;
      task.updatedAt = Date.now();
      return true;
    });
  }

  duplicateTask(id) {
    const source = this.getTask(id);
    if (!source) return null;
    const copy = createTask({
      ...snapshot(source),
      id: undefined,
      title: `${source.title} のコピー`,
      status: "todo",
      completedAt: null,
      completedCount: 0,
      pomodoros: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
      order: source.order + 0.5,
    });
    copy.subtasks = copy.subtasks.map((s) => createSubtask(s.title));
    this.update((data) => {
      data.tasks.push(copy);
    });
    return copy;
  }

  /** 表示中のタスクだけを並べ替える。非表示タスクの位置関係は壊さない。 */
  reorderTasks(orderedIds) {
    return this.update((data) => {
      const tasks = orderedIds.map((id) => data.tasks.find((t) => t.id === id)).filter(Boolean);
      if (tasks.length < 2) return false;
      const slots = tasks.map((t) => t.order).sort((a, b) => a - b);
      tasks.forEach((task, index) => {
        task.order = slots[index];
      });
      return true;
    });
  }

  bulkUpdate(ids, patch) {
    return this.update((data) => {
      let changed = false;
      ids.forEach((id) => {
        const task = data.tasks.find((t) => t.id === id);
        if (!task) return;
        Object.assign(task, patch, { updatedAt: Date.now() });
        changed = true;
      });
      return changed;
    });
  }

  clearCompleted() {
    return this.update((data) => {
      let changed = false;
      data.tasks.forEach((task) => {
        if (task.status === "done" && !task.deletedAt && !task.archived) {
          task.archived = true;
          task.updatedAt = Date.now();
          changed = true;
        }
      });
      return changed;
    });
  }

  logPomodoro(taskId) {
    if (!taskId) return false;
    return this.update((data) => {
      const task = data.tasks.find((t) => t.id === taskId);
      if (!task) return false;
      task.pomodoros = (task.pomodoros || 0) + 1;
      task.updatedAt = Date.now();
      return true;
    });
  }

  /* ------------- サブタスク ------------- */

  addSubtask(taskId, title) {
    const trimmed = title.trim();
    if (!trimmed) return false;
    return this.update((data) => {
      const task = data.tasks.find((t) => t.id === taskId);
      if (!task) return false;
      task.subtasks.push(createSubtask(trimmed));
      task.updatedAt = Date.now();
      return true;
    });
  }

  updateSubtask(taskId, subtaskId, patch) {
    return this.update((data) => {
      const task = data.tasks.find((t) => t.id === taskId);
      const subtask = task?.subtasks.find((s) => s.id === subtaskId);
      if (!subtask) return false;
      Object.assign(subtask, patch);
      task.updatedAt = Date.now();
      return true;
    });
  }

  removeSubtask(taskId, subtaskId) {
    return this.update((data) => {
      const task = data.tasks.find((t) => t.id === taskId);
      if (!task) return false;
      const index = task.subtasks.findIndex((s) => s.id === subtaskId);
      if (index === -1) return false;
      task.subtasks.splice(index, 1);
      task.updatedAt = Date.now();
      return true;
    });
  }

  /* ------------- プロジェクト / タグ ------------- */

  addProject(patch) {
    const project = createProject({
      ...patch,
      order: this.data.projects.reduce((max, p) => Math.max(max, p.order), 0) + 1,
    });
    this.update((data) => {
      data.projects.push(project);
    });
    return project;
  }

  updateProject(id, patch) {
    return this.update((data) => {
      const project = data.projects.find((p) => p.id === id);
      if (!project) return false;
      Object.assign(project, patch);
      return true;
    });
  }

  deleteProject(id) {
    return this.update((data) => {
      const index = data.projects.findIndex((p) => p.id === id);
      if (index === -1) return false;
      data.projects.splice(index, 1);
      data.tasks.forEach((task) => {
        if (task.projectId === id) task.projectId = null;
      });
      return true;
    });
  }

  addTag(patch) {
    const tag = createTag(patch);
    this.update((data) => {
      data.tags.push(tag);
    });
    return tag;
  }

  updateTag(id, patch) {
    return this.update((data) => {
      const tag = data.tags.find((t) => t.id === id);
      if (!tag) return false;
      Object.assign(tag, patch);
      return true;
    });
  }

  deleteTag(id) {
    return this.update((data) => {
      const index = data.tags.findIndex((t) => t.id === id);
      if (index === -1) return false;
      data.tags.splice(index, 1);
      data.tasks.forEach((task) => {
        task.tagIds = task.tagIds.filter((tagId) => tagId !== id);
      });
      return true;
    });
  }

  toggleTaskTag(taskId, tagId) {
    return this.update((data) => {
      const task = data.tasks.find((t) => t.id === taskId);
      if (!task) return false;
      const index = task.tagIds.indexOf(tagId);
      if (index === -1) task.tagIds.push(tagId);
      else task.tagIds.splice(index, 1);
      task.updatedAt = Date.now();
      return true;
    });
  }

  /* ------------- 設定 / データ全体 ------------- */

  updateSettings(patch) {
    return this.update(
      (data) => {
        data.settings = normalizeSettings({ ...data.settings, ...patch });
        return true;
      },
      { undoable: false }
    );
  }

  replaceData(raw, { merge = false } = {}) {
    const incoming = migrate(raw);
    return this.update((data) => {
      if (!merge) {
        data.tasks = incoming.tasks;
        data.projects = incoming.projects;
        data.tags = incoming.tags;
        data.completions = incoming.completions;
        data.settings = incoming.settings;
        return true;
      }
      const taskIds = new Set(data.tasks.map((t) => t.id));
      const projectIds = new Set(data.projects.map((p) => p.id));
      const tagIds = new Set(data.tags.map((t) => t.id));
      incoming.projects.forEach((p) => {
        if (!projectIds.has(p.id)) data.projects.push(p);
      });
      incoming.tags.forEach((t) => {
        if (!tagIds.has(t.id)) data.tags.push(t);
      });
      incoming.tasks.forEach((t) => {
        if (!taskIds.has(t.id)) data.tasks.push(t);
      });
      data.completions = [...data.completions, ...incoming.completions].slice(-COMPLETION_LOG_LIMIT);
      return true;
    });
  }

  resetAll() {
    return this.update((data) => {
      const fresh = emptyState();
      data.tasks = fresh.tasks;
      data.projects = fresh.projects;
      data.tags = fresh.tags;
      data.completions = fresh.completions;
      return true;
    });
  }
}

export const store = new Store();
