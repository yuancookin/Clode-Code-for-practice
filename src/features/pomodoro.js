/**
 * ポモドーロタイマー。
 * 1 秒ごとにアプリ全体を再描画すると重いので、自分のウィジェットだけを更新する。
 */

import { formatDuration } from "../date.js";
import { store } from "../store.js";
import { h, setChildren } from "../utils.js";
import { toast } from "../ui/toast.js";
import { notify } from "./notifications.js";

const state = {
  mode: "work", // work | short | long
  remaining: 0,
  running: false,
  workDone: 0,
  taskId: null,
  timer: 0,
};

const MODE_LABEL = { work: "作業", short: "小休憩", long: "長休憩" };

function durationFor(mode) {
  const config = store.data.settings.pomodoro;
  return (mode === "work" ? config.work : mode === "short" ? config.short : config.long) * 60;
}

function widget() {
  return document.getElementById("pomodoro-widget");
}

export function initPomodoro() {
  state.remaining = durationFor("work");
  renderPomodoro();
}

export function renderPomodoro() {
  const el = widget();
  if (!el) return;

  const task = state.taskId ? store.getTask(state.taskId) : null;

  setChildren(
    el,
    h("span", { class: `pomo-mode ${state.mode}`, text: MODE_LABEL[state.mode] }),
    h("span", { class: "pomo-time", text: formatDuration(state.remaining) }),
    h("button", {
      type: "button",
      class: "icon-btn small",
      title: state.running ? "一時停止" : "開始",
      "aria-label": state.running ? "一時停止" : "開始",
      text: state.running ? "⏸" : "▶",
      onclick: toggleTimer,
    }),
    h("button", {
      type: "button",
      class: "icon-btn small",
      title: "リセット",
      "aria-label": "タイマーをリセット",
      text: "⟳",
      onclick: resetTimer,
    }),
    state.workDone > 0 ? h("span", { class: "pomo-count", title: "本日のセッション数", text: `×${state.workDone}` }) : null,
    task ? h("span", { class: "pomo-task", title: task.title, text: task.title }) : null
  );
}

function updateTimeOnly() {
  const el = widget()?.querySelector(".pomo-time");
  if (el) el.textContent = formatDuration(state.remaining);
}

function toggleTimer() {
  if (state.running) {
    pauseTimer();
    return;
  }
  // 開始時に選択中のタスクへ結びつける
  if (!state.taskId && store.ui.selectedId) state.taskId = store.ui.selectedId;
  state.running = true;
  state.timer = setInterval(tick, 1000);
  renderPomodoro();
}

function pauseTimer() {
  state.running = false;
  clearInterval(state.timer);
  state.timer = 0;
  renderPomodoro();
}

function resetTimer() {
  pauseTimer();
  state.remaining = durationFor(state.mode);
  state.taskId = null;
  renderPomodoro();
}

function tick() {
  state.remaining -= 1;
  if (state.remaining > 0) {
    updateTimeOnly();
    return;
  }
  finishSession();
}

function finishSession() {
  pauseTimer();
  beep();

  if (state.mode === "work") {
    state.workDone += 1;
    if (state.taskId) store.logPomodoro(state.taskId);
    const longEvery = store.data.settings.pomodoro.longEvery;
    state.mode = state.workDone % longEvery === 0 ? "long" : "short";
    notify("作業セッション完了", `お疲れさま！${MODE_LABEL[state.mode]}に入りましょう。`);
    toast(`ポモドーロ完了 🍅 ${MODE_LABEL[state.mode]}へ`, { duration: 6000 });
  } else {
    state.mode = "work";
    notify("休憩終了", "次の作業を始めましょう。");
    toast("休憩終了。次のセッションを始めましょう", { duration: 6000 });
  }

  state.remaining = durationFor(state.mode);
  renderPomodoro();
}

/** 短いビープ音（音声ファイルを持たずに鳴らす） */
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.62);
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* 音が出せない環境では無視する */
  }
}

/** 設定変更後に停止中のタイマーを新しい長さへ合わせる */
export function syncPomodoroSettings() {
  if (!state.running) {
    state.remaining = durationFor(state.mode);
    renderPomodoro();
  }
}
