/**
 * クイック入力の自然文パーサ。
 *
 * 例) 「資料をまとめる 明日 15:00 !高 @仕事 #会議 毎週」
 *   → 期限=明日 / 時刻=15:00 / 優先度=高 / プロジェクト=仕事 / タグ=会議 / 毎週くり返し
 *
 * 日付や繰り返しのキーワードは「空白で区切られた 1 語」のときだけ解釈する。
 * （「今日の予定を立てる」の "今日" を誤って食べないようにするため）
 */

import { addDays, addMonths, fromISODate, pad2, todayISO, weekday } from "./date.js";

const PRIORITY_TOKENS = { 高: 3, 中: 2, 低: 1, 3: 3, 2: 2, 1: 1 };
const WEEKDAY_TOKENS = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

function normalizeTime(token) {
  const [h, m] = token.split(":");
  return `${pad2(Number(h))}:${m}`;
}

/** 次にその曜日が来る日付（今日が該当日なら今日） */
function nextWeekday(target, today) {
  const delta = (target - weekday(today) + 7) % 7;
  return addDays(today, delta);
}

export function parseDateToken(token, today = todayISO()) {
  switch (token) {
    case "今日":
    case "きょう":
      return today;
    case "明日":
    case "あした":
    case "あす":
      return addDays(today, 1);
    case "明後日":
    case "あさって":
      return addDays(today, 2);
    case "昨日":
    case "きのう":
      return addDays(today, -1);
    case "来週":
      return addDays(today, 7);
    case "再来週":
      return addDays(today, 14);
    case "来月":
      return addMonths(today, 1);
    case "今週末":
    case "週末":
      return nextWeekday(6, today);
    default:
      break;
  }

  // 月曜 / 月曜日 / 来週月曜
  const weekdayMatch = /^(来週)?([日月火水木金土])曜(日)?$/.exec(token);
  if (weekdayMatch) {
    const base = nextWeekday(WEEKDAY_TOKENS[weekdayMatch[2]], today);
    return weekdayMatch[1] ? addDays(base, 7) : base;
  }

  // 3日後 / 2週間後 / 1ヶ月後
  const afterMatch = /^(\d{1,3})(日|週間|ヶ月|か月|カ月)後$/.exec(token);
  if (afterMatch) {
    const n = Number(afterMatch[1]);
    if (afterMatch[2] === "日") return addDays(today, n);
    if (afterMatch[2] === "週間") return addDays(today, n * 7);
    return addMonths(today, n);
  }

  // 2026-03-05
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(token);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${pad2(Number(m))}-${pad2(Number(d))}`;
  }

  // 3/5 （過ぎていれば翌年）/ 2026/3/5
  const slashMatch = /^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})$/.exec(token);
  if (slashMatch) {
    const [, y, m, d] = slashMatch;
    const month = Number(m);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const year = y ? Number(y) : fromISODate(today).getFullYear();
    const iso = `${year}-${pad2(month)}-${pad2(day)}`;
    if (!y && iso < today) return `${year + 1}-${pad2(month)}-${pad2(day)}`;
    return iso;
  }

  // 3月5日
  const jpMatch = /^(\d{1,2})月(\d{1,2})日$/.exec(token);
  if (jpMatch) {
    const year = fromISODate(today).getFullYear();
    const iso = `${year}-${pad2(Number(jpMatch[1]))}-${pad2(Number(jpMatch[2]))}`;
    return iso < today ? `${year + 1}-${iso.slice(5)}` : iso;
  }

  return null;
}

export function parseRepeatToken(token) {
  if (token === "毎日") return { type: "daily", every: 1, weekdays: [] };
  if (token === "平日" || token === "平日のみ") return { type: "weekday", every: 1, weekdays: [] };
  if (token === "毎月") return { type: "monthly", every: 1, weekdays: [] };
  if (token === "毎年") return { type: "yearly", every: 1, weekdays: [] };
  if (token === "毎週") return { type: "weekly", every: 1, weekdays: [] };

  const weeklyMatch = /^毎週([日月火水木金土])曜?(日)?$/.exec(token);
  if (weeklyMatch) {
    return { type: "weekly", every: 1, weekdays: [WEEKDAY_TOKENS[weeklyMatch[1]]] };
  }

  const everyMatch = /^(\d{1,3})日ごと$/.exec(token);
  if (everyMatch) return { type: "daily", every: Number(everyMatch[1]), weekdays: [] };

  return null;
}

/**
 * @returns {{title, due, dueTime, priority, projectName, tagNames, repeat}}
 */
export function parseQuickAdd(input, today = todayISO()) {
  const result = {
    title: "",
    due: null,
    dueTime: null,
    priority: 0,
    projectName: null,
    tagNames: [],
    repeat: null,
  };

  let text = String(input || "");

  // 記号つきトークンは位置に関係なく取り出す
  text = text.replace(/(^|\s)#([^\s#@!]+)/g, (_m, pre, name) => {
    result.tagNames.push(name);
    return pre;
  });
  text = text.replace(/(^|\s)@([^\s#@!]+)/g, (_m, pre, name) => {
    result.projectName = name;
    return pre;
  });
  text = text.replace(/(^|\s)!(高|中|低|[1-3])(?=\s|$)/g, (_m, pre, token) => {
    result.priority = PRIORITY_TOKENS[token] ?? 0;
    return pre;
  });

  const kept = [];
  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (!result.dueTime && /^([01]?\d|2[0-3]):[0-5]\d$/.test(token)) {
      result.dueTime = normalizeTime(token);
      continue;
    }
    if (!result.repeat) {
      const repeat = parseRepeatToken(token);
      if (repeat) {
        result.repeat = repeat;
        continue;
      }
    }
    if (!result.due) {
      const due = parseDateToken(token, today);
      if (due) {
        result.due = due;
        continue;
      }
    }
    kept.push(token);
  }

  result.title = kept.join(" ").trim();

  // 時刻だけ指定された場合は今日の予定とみなす
  if (result.dueTime && !result.due) result.due = today;

  return result;
}
