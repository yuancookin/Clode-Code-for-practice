import { todayISO, startOfWeek, endOfWeek } from "./utils.js";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2, none: 3 };

export function filterTasks(tasks, filter, { includeStatus = true } = {}) {
  const query = filter.query.trim().toLowerCase();
  const today = todayISO();
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);

  return tasks.filter((t) => {
    if (includeStatus) {
      if (filter.status === "active" && t.status === "done") return false;
      if (filter.status === "done" && t.status !== "done") return false;
    }

    if (filter.priority !== "all" && t.priority !== filter.priority) return false;

    if (filter.tagId === "none" && t.tagIds.length > 0) return false;
    if (
      filter.tagId !== "all" &&
      filter.tagId !== "none" &&
      !t.tagIds.includes(filter.tagId)
    )
      return false;

    if (filter.range !== "all") {
      if (!t.dueDate) return false;
      if (filter.range === "today" && t.dueDate !== today) return false;
      if (filter.range === "overdue" && !(t.dueDate < today && t.status !== "done"))
        return false;
      if (filter.range === "week" && !(t.dueDate >= weekStart && t.dueDate <= weekEnd))
        return false;
    }

    if (query) {
      const haystack = (t.title + " " + t.notes).toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export function sortTasks(tasks, sortBy) {
  const arr = [...tasks];
  const pinned = (t) => (t.pinned ? 0 : 1);
  switch (sortBy) {
    case "due":
      arr.sort(
        (a, b) =>
          pinned(a) - pinned(b) ||
          (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99") ||
          a.order - b.order
      );
      break;
    case "priority":
      arr.sort(
        (a, b) =>
          pinned(a) - pinned(b) ||
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
          a.order - b.order
      );
      break;
    case "created":
      arr.sort((a, b) => pinned(a) - pinned(b) || b.createdAt - a.createdAt);
      break;
    case "alpha":
      arr.sort((a, b) => pinned(a) - pinned(b) || a.title.localeCompare(b.title, "ja"));
      break;
    default:
      arr.sort((a, b) => pinned(a) - pinned(b) || a.order - b.order);
  }
  return arr;
}
