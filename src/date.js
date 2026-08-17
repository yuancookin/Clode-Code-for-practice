/**
 * 日付ユーティリティ。
 * 日付は "YYYY-MM-DD"（ローカルタイム）の文字列で扱い、
 * Date オブジェクトはローカル 0 時に正規化して使う。
 * 副作用を持たない純粋関数のみを置く（Node からテストできるようにするため）。
 */

export const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

export function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Date → "YYYY-MM-DD"（ローカル） */
export function toISODate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "YYYY-MM-DD" → ローカル 0 時の Date */
export function fromISODate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function addDays(iso, n) {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** 月末をはみ出す場合はその月の末日に丸める（1/31 +1ヶ月 → 2/28） */
export function addMonths(iso, n) {
  const d = fromISODate(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toISODate(d);
}

/** from から to までの日数（to - from）。夏時間があっても丸めで吸収する。 */
export function diffDays(fromIso, toIso) {
  const ms = fromISODate(toIso).getTime() - fromISODate(fromIso).getTime();
  return Math.round(ms / 86400000);
}

/** 0 = 日曜 */
export function weekday(iso) {
  return fromISODate(iso).getDay();
}

export function weekdayName(index) {
  return WEEKDAY_NAMES[index];
}

export function isWeekend(iso) {
  const w = weekday(iso);
  return w === 0 || w === 6;
}

/** "8/17(日)" */
export function formatDateJP(iso) {
  const d = fromISODate(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_NAMES[d.getDay()]})`;
}

/** "2026年8月17日(日)" */
export function formatDateLongJP(iso) {
  const d = fromISODate(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY_NAMES[d.getDay()]})`;
}

/** 期限バッジ用の相対表記 */
export function formatDueLabel(iso, todayIso = todayISO()) {
  const diff = diffDays(todayIso, iso);
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";
  if (diff === 2) return "明後日";
  if (diff === -1) return "昨日";
  if (diff < 0) return `${-diff}日超過`;
  if (diff <= 7) return `${diff}日後`;
  return formatDateJP(iso);
}

/** "YYYY-MM" */
export function monthKey(iso) {
  return String(iso).slice(0, 7);
}

export function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

export function shiftMonth(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function formatMonthJP(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}

/** 月カレンダー用に日曜始まりの 42 日分（6週）の ISO 日付を返す */
export function monthGrid(ym) {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push(toISODate(d));
  }
  return cells;
}

/** 日付 + "HH:MM" → エポックミリ秒。時刻がなければその日の終わり（23:59）を使う。 */
export function dueTimestamp(iso, time) {
  const d = fromISODate(iso);
  if (typeof time === "string" && /^\d{2}:\d{2}$/.test(time)) {
    const [h, min] = time.split(":").map(Number);
    d.setHours(h, min, 0, 0);
  } else {
    d.setHours(23, 59, 59, 999);
  }
  return d.getTime();
}

/** エポックミリ秒 → "2026/8/17 14:30" */
export function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 秒数 → "25:00" */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}
