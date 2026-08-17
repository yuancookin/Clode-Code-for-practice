/**
 * データの書き出し・読み込みとデモデータ生成。
 */

import { addDays, todayISO } from "../date.js";
import { describeRepeat, PROJECT_COLORS, statusLabel, priorityMeta } from "../model.js";
import { store } from "../store.js";
import { csvCell, downloadFile, pickFile } from "../utils.js";
import { toast } from "../ui/toast.js";

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function exportJSON() {
  downloadFile(`taskflow-${stamp()}.json`, JSON.stringify(store.data, null, 2), "application/json");
  toast("JSON を書き出しました");
}

export function exportCSV() {
  const { data } = store;
  const header = [
    "タイトル",
    "状態",
    "優先度",
    "プロジェクト",
    "タグ",
    "期限",
    "時刻",
    "くり返し",
    "サブタスク完了",
    "サブタスク数",
    "メモ",
    "作成日時",
  ];

  const rows = data.tasks
    .filter((t) => !t.deletedAt)
    .map((task) => [
      task.title,
      statusLabel(task.status),
      priorityMeta(task.priority).label,
      data.projects.find((p) => p.id === task.projectId)?.name ?? "",
      task.tagIds.map((id) => data.tags.find((t) => t.id === id)?.name).filter(Boolean).join(" / "),
      task.due ?? "",
      task.dueTime ?? "",
      task.repeat ? describeRepeat(task.repeat) : "",
      task.subtasks.filter((s) => s.done).length,
      task.subtasks.length,
      task.notes.replace(/\r?\n/g, " "),
      new Date(task.createdAt).toISOString(),
    ]);

  // Excel で文字化けしないよう BOM を付ける
  const csv = `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  downloadFile(`taskflow-${stamp()}.csv`, csv, "text/csv");
  toast("CSV を書き出しました");
}

export async function importJSON({ merge = false } = {}) {
  const file = await pickFile("application/json,.json");
  if (!file) return;
  try {
    const parsed = JSON.parse(file.text);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      toast("このファイルには tasks が含まれていません", { tone: "danger" });
      return;
    }
    store.replaceData(parsed, { merge });
    toast(
      merge ? `${parsed.tasks.length} 件を読み込みました（追加）` : `${parsed.tasks.length} 件を読み込みました（置き換え）`,
      { actionLabel: "取り消す", onAction: () => store.undo() }
    );
  } catch {
    toast("JSON を解析できませんでした", { tone: "danger" });
  }
}

/* ---------------- デモデータ ---------------- */

const DEMO_VERBS = ["まとめる", "確認する", "レビューする", "準備する", "共有する", "設計する", "修正する", "打ち合わせる"];
const DEMO_NOUNS = ["提案書", "議事録", "見積り", "スケジュール", "デザイン案", "テスト計画", "請求書", "リリースノート", "会議資料", "アンケート"];
const DEMO_PROJECTS = ["仕事", "個人", "学習"];
const DEMO_TAGS = ["会議", "緊急", "アイデア", "レビュー待ち", "外出"];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * 動作確認・表示性能の確認用にタスクを大量生成する。
 */
export function generateDemoData(count = 200) {
  const today = todayISO();

  store.update((data) => {
    if (data.projects.length === 0) {
      DEMO_PROJECTS.forEach((name, index) => {
        data.projects.push({
          id: `p_demo_${index}`,
          name,
          color: PROJECT_COLORS[index % PROJECT_COLORS.length],
          order: index,
          archived: false,
        });
      });
    }
    if (data.tags.length === 0) {
      DEMO_TAGS.forEach((name, index) => {
        data.tags.push({
          id: `g_demo_${index}`,
          name,
          color: PROJECT_COLORS[(index + 3) % PROJECT_COLORS.length],
        });
      });
    }

    const baseOrder = data.tasks.reduce((max, t) => Math.max(max, t.order), 0);

    for (let i = 0; i < count; i += 1) {
      const hasDue = Math.random() < 0.75;
      const offset = Math.floor(Math.random() * 40) - 12;
      const done = Math.random() < 0.3;
      const subtaskCount = Math.random() < 0.4 ? 1 + Math.floor(Math.random() * 4) : 0;

      data.tasks.push({
        id: `t_demo_${Date.now().toString(36)}_${i}`,
        title: `${pick(DEMO_NOUNS)}を${pick(DEMO_VERBS)}`,
        notes: Math.random() < 0.2 ? "デモデータとして自動生成されたタスクです。" : "",
        status: done ? "done" : Math.random() < 0.2 ? "doing" : "todo",
        priority: Math.floor(Math.random() * 4),
        projectId: Math.random() < 0.8 ? pick(data.projects).id : null,
        tagIds: Math.random() < 0.5 ? [pick(data.tags).id] : [],
        due: hasDue ? addDays(today, offset) : null,
        dueTime: hasDue && Math.random() < 0.3 ? "10:00" : null,
        remindBefore: null,
        repeat: Math.random() < 0.1 ? { type: "weekly", every: 1, weekdays: [1] } : null,
        subtasks: Array.from({ length: subtaskCount }, (_, k) => ({
          id: `s_demo_${i}_${k}`,
          title: `手順 ${k + 1}`,
          done: Math.random() < 0.5,
        })),
        estimate: Math.random() < 0.3 ? 1 + Math.floor(Math.random() * 4) : null,
        pomodoros: Math.random() < 0.3 ? Math.floor(Math.random() * 5) : 0,
        order: baseOrder + i + 1,
        createdAt: Date.now() - Math.floor(Math.random() * 30) * 86400000,
        updatedAt: Date.now(),
        completedAt: done ? Date.now() : null,
        completedCount: done ? 1 : 0,
        archived: false,
        deletedAt: null,
      });
    }

    // 統計グラフが見えるように、直近 14 日の完了ログも作る
    for (let day = 0; day < 14; day += 1) {
      const at = Date.now() - day * 86400000;
      const times = Math.floor(Math.random() * 6);
      for (let k = 0; k < times; k += 1) {
        data.completions.push({
          at: at - k * 60000,
          taskId: null,
          title: `${pick(DEMO_NOUNS)}を${pick(DEMO_VERBS)}`,
          projectId: null,
          priority: Math.floor(Math.random() * 4),
        });
      }
    }
    data.completions.sort((a, b) => a.at - b.at);
    return true;
  });

  toast(`デモデータを ${count} 件追加しました`, { actionLabel: "取り消す", onAction: () => store.undo() });
}
