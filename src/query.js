/**
 * 絞り込み・並べ替え・グループ化・統計の純粋関数。
 * すべて引数から結果を作るだけで、状態は持たない。
 */

import { addDays, diffDays, todayISO } from "./date.js";
import { isActive, isOverdue, priorityMeta, statusLabel, subtaskProgress } from "./model.js";

export const SCOPES = [
  { id: "today", label: "今日", icon: "☀" },
  { id: "overdue", label: "期限切れ", icon: "⚠" },
  { id: "upcoming", label: "今後7日間", icon: "🗓" },
  { id: "nodate", label: "期限なし", icon: "∅" },
  { id: "all", label: "すべて", icon: "▤" },
  { id: "completed", label: "完了済み", icon: "✓" },
  { id: "archived", label: "アーカイブ", icon: "📦" },
  { id: "trash", label: "ゴミ箱", icon: "🗑" },
];

export const GROUP_BY_OPTIONS = [
  { id: "none", label: "グループ化なし" },
  { id: "project", label: "プロジェクト別" },
  { id: "tag", label: "タグ別" },
  { id: "priority", label: "優先度別" },
  { id: "due", label: "期限別" },
  { id: "status", label: "ステータス別" },
];

export const SORT_OPTIONS = [
  { id: "manual", label: "手動（ドラッグ順）" },
  { id: "due", label: "期限" },
  { id: "priority", label: "優先度" },
  { id: "created", label: "作成日" },
  { id: "updated", label: "更新日" },
  { id: "title", label: "名前" },
];

export function scopeLabel(scope, data) {
  if (scope.startsWith("project:")) {
    const project = data.projects.find((p) => p.id === scope.slice(8));
    return project ? project.name : "プロジェクト";
  }
  if (scope.startsWith("tag:")) {
    const tag = data.tags.find((t) => t.id === scope.slice(4));
    return tag ? `#${tag.name}` : "タグ";
  }
  return SCOPES.find((s) => s.id === scope)?.label ?? "すべて";
}

/* ---------------- 検索 ---------------- */

export function buildSearchText(task, data) {
  const project = task.projectId ? data.projects.find((p) => p.id === task.projectId) : null;
  const tagNames = task.tagIds
    .map((id) => data.tags.find((t) => t.id === id)?.name)
    .filter(Boolean);
  return [
    task.title,
    task.notes,
    project?.name ?? "",
    tagNames.join(" "),
    task.subtasks.map((s) => s.title).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

export function matchesSearch(task, query, data) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = buildSearchText(task, data);
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

/* ---------------- 絞り込み ---------------- */

function matchesScope(task, scope, today) {
  if (scope === "trash") return Boolean(task.deletedAt);
  if (task.deletedAt) return false;
  if (scope === "archived") return task.archived;
  if (task.archived) return false;

  switch (scope) {
    case "all":
      return true;
    case "today":
      return task.status !== "done" && Boolean(task.due) && task.due <= today;
    case "overdue":
      return isOverdue(task, today);
    case "upcoming": {
      if (task.status === "done" || !task.due) return false;
      const d = diffDays(today, task.due);
      return d >= 0 && d <= 7;
    }
    case "nodate":
      return !task.due && task.status !== "done";
    case "completed":
      return task.status === "done";
    default:
      if (scope.startsWith("project:")) return task.projectId === scope.slice(8);
      if (scope.startsWith("tag:")) return task.tagIds.includes(scope.slice(4));
      return true;
  }
}

/** スコープ・検索・フィルタをすべて適用したタスク配列を返す */
export function filterTasks(data, ui, today = todayISO()) {
  const scope = ui.scope || "all";
  const hideDone =
    !ui.showCompleted && !["completed", "archived", "trash"].includes(scope);

  return data.tasks.filter((task) => {
    if (!matchesScope(task, scope, today)) return false;
    if (hideDone && task.status === "done") return false;
    if (ui.filterPriority !== "all" && task.priority !== Number(ui.filterPriority)) return false;
    if (ui.filterStatus !== "all" && task.status !== ui.filterStatus) return false;
    if (!matchesSearch(task, ui.search || "", data)) return false;
    return true;
  });
}

/* ---------------- 並べ替え ---------------- */

const collator = new Intl.Collator("ja");

export function sortTasks(tasks, sortBy = "manual", dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  const sorted = [...tasks];

  sorted.sort((a, b) => {
    switch (sortBy) {
      case "due": {
        // 期限なしは常に末尾
        if (!a.due && !b.due) return a.order - b.order;
        if (!a.due) return 1;
        if (!b.due) return -1;
        if (a.due !== b.due) return sign * a.due.localeCompare(b.due);
        return (a.dueTime || "99:99").localeCompare(b.dueTime || "99:99") * sign;
      }
      case "priority":
        if (a.priority !== b.priority) return sign * (b.priority - a.priority);
        return a.order - b.order;
      case "created":
        return sign * (a.createdAt - b.createdAt);
      case "updated":
        return sign * (b.updatedAt - a.updatedAt);
      case "title":
        return sign * collator.compare(a.title, b.title);
      case "manual":
      default:
        return sign * (a.order - b.order);
    }
  });

  return sorted;
}

/* ---------------- グループ化 ---------------- */

function dueBucket(task, today) {
  if (!task.due) return { key: "none", label: "期限なし", rank: 5, color: "#9a9a94" };
  const d = diffDays(today, task.due);
  if (d < 0) return { key: "overdue", label: "期限切れ", rank: 0, color: "#e34948" };
  if (d === 0) return { key: "today", label: "今日", rank: 1, color: "#eda100" };
  if (d === 1) return { key: "tomorrow", label: "明日", rank: 2, color: "#2a78d6" };
  if (d <= 7) return { key: "week", label: "今週中", rank: 3, color: "#1baf7a" };
  return { key: "later", label: "それ以降", rank: 4, color: "#4a3aa7" };
}

/**
 * [{ key, label, color, tasks }] を返す。groupBy が "none" なら単一グループ。
 */
export function groupTasks(tasks, groupBy, data, today = todayISO()) {
  if (!groupBy || groupBy === "none") {
    return [{ key: "all", label: "", color: null, tasks }];
  }

  const buckets = new Map();
  const ensure = (key, label, color, rank) => {
    if (!buckets.has(key)) buckets.set(key, { key, label, color, rank, tasks: [] });
    return buckets.get(key);
  };

  tasks.forEach((task) => {
    switch (groupBy) {
      case "project": {
        const project = data.projects.find((p) => p.id === task.projectId);
        const key = project ? project.id : "none";
        ensure(
          key,
          project ? project.name : "プロジェクトなし",
          project ? project.color : "#9a9a94",
          project ? project.order : Number.MAX_SAFE_INTEGER
        ).tasks.push(task);
        break;
      }
      case "tag": {
        if (task.tagIds.length === 0) {
          ensure("none", "タグなし", "#9a9a94", Number.MAX_SAFE_INTEGER).tasks.push(task);
          break;
        }
        // 複数タグを持つタスクは各タグのグループに現れる
        task.tagIds.forEach((tagId) => {
          const tag = data.tags.find((t) => t.id === tagId);
          if (!tag) return;
          ensure(tag.id, `#${tag.name}`, tag.color, data.tags.indexOf(tag)).tasks.push(task);
        });
        break;
      }
      case "priority": {
        const meta = priorityMeta(task.priority);
        ensure(
          `p${task.priority}`,
          `優先度: ${meta.label}`,
          priorityColor(task.priority),
          3 - task.priority
        ).tasks.push(task);
        break;
      }
      case "due": {
        const bucket = dueBucket(task, today);
        ensure(bucket.key, bucket.label, bucket.color, bucket.rank).tasks.push(task);
        break;
      }
      case "status": {
        const rank = { todo: 0, doing: 1, done: 2 }[task.status] ?? 3;
        ensure(task.status, statusLabel(task.status), statusColor(task.status), rank).tasks.push(task);
        break;
      }
      default:
        ensure("all", "", null, 0).tasks.push(task);
    }
  });

  return [...buckets.values()].sort((a, b) => a.rank - b.rank || collator.compare(a.label, b.label));
}

/* ---------------- 色（状態を表す予約色） ---------------- */

export function priorityColor(priority) {
  switch (priority) {
    case 3:
      return "#e34948"; // critical
    case 2:
      return "#eda100"; // warning
    case 1:
      return "#2a78d6"; // info
    default:
      return "#9a9a94"; // neutral
  }
}

export function statusColor(status) {
  switch (status) {
    case "doing":
      return "#eda100";
    case "done":
      return "#008300";
    default:
      return "#9a9a94";
  }
}

/* ---------------- 統計 ---------------- */

/**
 * ダッシュボード用の集計。日次系列は completions ログから作る。
 */
export function computeStats(data, today = todayISO(), days = 14) {
  const active = data.tasks.filter(isActive);
  const open = active.filter((t) => t.status !== "done");
  const done = active.filter((t) => t.status === "done");

  // 日ごとの完了数
  const byDay = new Map();
  data.completions.forEach((c) => {
    const d = new Date(c.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    byDay.set(key, (byDay.get(key) || 0) + 1);
  });

  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    series.push({ date, count: byDay.get(date) || 0 });
  }

  // 連続達成日数（今日に完了がなければ昨日から数える）
  let streak = 0;
  let cursor = byDay.get(today) ? today : addDays(today, -1);
  while (byDay.get(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const total = active.length;
  const completionRate = total === 0 ? 0 : done.length / total;

  const priorityBreakdown = [3, 2, 1, 0].map((value) => ({
    value,
    label: priorityMeta(value).label,
    color: priorityColor(value),
    count: open.filter((t) => t.priority === value).length,
  }));

  const projectBreakdown = data.projects
    .filter((p) => !p.archived)
    .map((project) => {
      const tasks = active.filter((t) => t.projectId === project.id);
      const finished = tasks.filter((t) => t.status === "done").length;
      return {
        id: project.id,
        name: project.name,
        color: project.color,
        total: tasks.length,
        done: finished,
        ratio: tasks.length === 0 ? 0 : finished / tasks.length,
      };
    })
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total);

  const tagBreakdown = data.tags
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      count: open.filter((t) => t.tagIds.includes(tag.id)).length,
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const last7 = series.slice(-7).reduce((sum, d) => sum + d.count, 0);
  const subtaskTotals = active.reduce(
    (acc, t) => {
      const p = subtaskProgress(t);
      if (p) {
        acc.total += p.total;
        acc.done += p.done;
      }
      return acc;
    },
    { total: 0, done: 0 }
  );

  return {
    total,
    open: open.length,
    done: done.length,
    completionRate,
    overdue: open.filter((t) => isOverdue(t, today)).length,
    dueToday: open.filter((t) => t.due === today).length,
    streak,
    series,
    completedToday: byDay.get(today) || 0,
    last7,
    avgPerDay: series.reduce((sum, d) => sum + d.count, 0) / days,
    priorityBreakdown,
    projectBreakdown,
    tagBreakdown,
    pomodoros: active.reduce((sum, t) => sum + (t.pomodoros || 0), 0),
    subtasks: subtaskTotals,
  };
}

/** サイドバーのバッジ用件数 */
export function scopeCounts(data, today = todayISO()) {
  const counts = {
    today: 0,
    overdue: 0,
    upcoming: 0,
    nodate: 0,
    all: 0,
    completed: 0,
    archived: 0,
    trash: 0,
    projects: new Map(),
    tags: new Map(),
  };

  data.tasks.forEach((task) => {
    if (task.deletedAt) {
      counts.trash += 1;
      return;
    }
    if (task.archived) {
      counts.archived += 1;
      return;
    }
    if (task.status === "done") {
      counts.completed += 1;
      counts.all += 1;
      return;
    }
    counts.all += 1;
    if (task.due && task.due <= today) counts.today += 1;
    if (isOverdue(task, today)) counts.overdue += 1;
    if (task.due) {
      const d = diffDays(today, task.due);
      if (d >= 0 && d <= 7) counts.upcoming += 1;
    } else {
      counts.nodate += 1;
    }
    if (task.projectId) {
      counts.projects.set(task.projectId, (counts.projects.get(task.projectId) || 0) + 1);
    }
    task.tagIds.forEach((id) => counts.tags.set(id, (counts.tags.get(id) || 0) + 1));
  });

  return counts;
}
