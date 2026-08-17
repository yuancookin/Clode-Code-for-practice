/**
 * 期限リマインダー。
 * 通知が許可されていればデスクトップ通知、許可がなければアプリ内トーストで知らせる。
 */

import { dueTimestamp, todayISO } from "../date.js";
import { store } from "../store.js";
import { toast } from "../ui/toast.js";

const CHECK_INTERVAL_MS = 30000;
const notified = new Set();
let timer = 0;

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** デスクトップ通知（不可ならトーストに落とす） */
export function notify(title, body) {
  if (notificationsSupported() && Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: title, icon: undefined });
      return true;
    } catch {
      /* 一部ブラウザでは Notification 構築が失敗する */
    }
  }
  toast(`${title} — ${body}`, { duration: 8000 });
  return false;
}

function keyFor(task) {
  return `${task.id}:${task.due}:${task.dueTime || ""}:${task.remindBefore}`;
}

function check() {
  if (!store.data.settings.notifications) return;
  const now = Date.now();

  store.data.tasks.forEach((task) => {
    if (task.deletedAt || task.archived || task.status === "done") return;
    if (!task.due || task.remindBefore == null) return;

    const fireAt = dueTimestamp(task.due, task.dueTime) - task.remindBefore * 60000;
    // 通知予定を過ぎていて、かつ 1 時間以内なら知らせる（タブを開き直した直後の大量通知を防ぐ）
    if (now < fireAt || now - fireAt > 3600000) return;

    const key = keyFor(task);
    if (notified.has(key)) return;
    notified.add(key);
    notify("期限が近づいています", `${task.title}（${task.due}${task.dueTime ? ` ${task.dueTime}` : ""}）`);
  });
}

/** 起動時に期限切れをまとめて 1 回だけ知らせる */
function overdueDigest() {
  const today = todayISO();
  const overdue = store.data.tasks.filter(
    (t) => !t.deletedAt && !t.archived && t.status !== "done" && t.due && t.due < today
  );
  if (overdue.length === 0) return;
  toast(`期限切れのタスクが ${overdue.length} 件あります`, {
    actionLabel: "確認する",
    onAction: () => store.patchUI({ scope: "overdue", view: "list" }),
    duration: 9000,
  });
}

export function initNotifications() {
  clearInterval(timer);
  timer = setInterval(check, CHECK_INTERVAL_MS);
  setTimeout(overdueDigest, 800);
  check();
}
