export function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function deepClone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return isoDate(d);
}

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function formatDateTime(iso, time) {
  const date = formatDate(iso);
  return time ? `${date} ${time}` : date;
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function addMonths(iso, n) {
  const d = parseISO(iso);
  d.setMonth(d.getMonth() + n);
  return isoDate(d);
}

export function nextRecurringDate(iso, recurrence) {
  if (!recurrence) return iso;
  switch (recurrence.freq) {
    case "daily":
      return addDays(iso, 1);
    case "weekly":
      return addDays(iso, 7);
    case "monthly":
      return addMonths(iso, 1);
    default:
      return iso;
  }
}

export function dueStatus(iso, status) {
  if (!iso || status === "done") return null;
  const due = parseISO(iso).getTime();
  const today = parseISO(todayISO()).getTime();
  if (due < today) return "overdue";
  if (due === today) return "due-today";
  return null;
}

export function startOfWeek(iso) {
  const d = parseISO(iso);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return isoDate(d);
}

export function endOfWeek(iso) {
  return addDays(startOfWeek(iso), 6);
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
