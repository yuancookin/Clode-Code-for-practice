/**
 * AI が返した編集オペレーションをタイムラインに適用する。
 * 操作の意味はバックエンド (backend/ai.py の OPERATIONS) と対になっている。
 */

import { clamp } from "./utils.js";
import {
  getState,
  getMedia,
  transaction,
  updateItem,
  updateProject,
  removeItem,
  moveClip,
  splitAt,
  addText,
  addClip,
  createText,
  createVideoClip,
  totalDuration,
  layout,
  clipDuration,
  DEFAULT_FILTERS,
  FILTER_PRESETS,
  TRANSITIONS,
} from "./store.js";

const POSITION_Y = { top: 0.14, center: 0.5, bottom: 0.82 };

function pick(list, index) {
  if (!Number.isFinite(index)) return null;
  return list[Math.round(index) - 1] || null; // AI 側は 1 始まり
}

function targetList(op) {
  const state = getState();
  if (op.target === "audio") return { type: "audio", list: state.audio };
  if (op.target === "text") return { type: "text", list: state.texts };
  return { type: "clip", list: state.clips };
}

function ok(op, message) {
  return { op: op.op, applied: true, message: message || op.note || "" };
}

function skip(op, message) {
  return { op: op.op, applied: false, message };
}

function applyOne(op) {
  const state = getState();

  switch (op.op) {
    case "trim": {
      const clip = pick(state.clips, op.index);
      if (!clip) return skip(op, "対象のクリップが見つかりません");
      const media = getMedia(clip.mediaId);
      const max = clip.kind === "image" ? Number.MAX_SAFE_INTEGER : media?.duration || clip.out;
      const start = op.source_start != null ? clamp(op.source_start, 0, max - 0.1) : clip.in;
      const end = op.source_end != null ? clamp(op.source_end, start + 0.1, max) : clip.out;
      if (end <= start) return skip(op, "トリム範囲が不正です");
      updateItem("clip", clip.id, { in: start, out: end }, { label: "AI: トリム" });
      return ok(op);
    }

    case "split": {
      if (op.timeline_time == null) return skip(op, "分割位置が指定されていません");
      return splitAt(op.timeline_time) ? ok(op) : skip(op, "その位置では分割できません");
    }

    case "delete": {
      const { type, list } = targetList(op);
      const item = pick(list, op.index);
      if (!item) return skip(op, "削除対象が見つかりません");
      removeItem(type, item.id);
      return ok(op);
    }

    case "reorder": {
      const from = Math.round(op.index) - 1;
      const to = Math.round(op.to_index) - 1;
      if (!state.clips[from] || to < 0 || to >= state.clips.length) {
        return skip(op, "並べ替えの範囲が不正です");
      }
      moveClip(from, to);
      return ok(op);
    }

    case "speed": {
      const clip = pick(state.clips, op.index);
      if (!clip || op.value == null) return skip(op, "対象のクリップが見つかりません");
      updateItem("clip", clip.id, { speed: clamp(op.value, 0.25, 4) }, { label: "AI: 速度" });
      return ok(op);
    }

    case "volume": {
      const { type, list } = targetList(op);
      const item = pick(list, op.index);
      if (!item || op.value == null) return skip(op, "対象が見つかりません");
      updateItem(type, item.id, { volume: clamp(op.value, 0, 1) }, { label: "AI: 音量" });
      return ok(op);
    }

    case "filter": {
      const clip = pick(state.clips, op.index);
      if (!clip) return skip(op, "対象のクリップが見つかりません");
      const preset = FILTER_PRESETS[op.preset];
      if (!preset) return skip(op, `知らない色調プリセットです (${op.preset})`);
      updateItem(
        "clip",
        clip.id,
        { preset: op.preset, filters: { ...DEFAULT_FILTERS, ...preset.values } },
        { label: "AI: 色調" }
      );
      return ok(op);
    }

    case "transition": {
      const clip = pick(state.clips, op.index);
      if (!clip) return skip(op, "対象のクリップが見つかりません");
      if (!TRANSITIONS[op.transition]) return skip(op, `知らないトランジションです (${op.transition})`);
      updateItem(
        "clip",
        clip.id,
        { transition: { type: op.transition, duration: clamp(op.duration ?? 0.5, 0.1, 3) } },
        { label: "AI: トランジション" }
      );
      return ok(op);
    }

    case "fade": {
      const clip = pick(state.clips, op.index);
      if (!clip) return skip(op, "対象のクリップが見つかりません");
      const patch = {};
      if (op.fade_in != null) patch.fadeIn = clamp(op.fade_in, 0, 5);
      if (op.fade_out != null) patch.fadeOut = clamp(op.fade_out, 0, 5);
      if (!Object.keys(patch).length) return skip(op, "フェードの値がありません");
      updateItem("clip", clip.id, patch, { label: "AI: フェード" });
      return ok(op);
    }

    case "add_text": {
      if (!op.text) return skip(op, "テロップの文字列がありません");
      const overlay = createText(Math.max(0, op.start ?? 0));
      overlay.text = op.text;
      overlay.duration = clamp(op.duration ?? 3, 0.3, 60);
      if (op.position) overlay.y = POSITION_Y[op.position] ?? overlay.y;
      if (op.color) overlay.color = op.color;
      if (op.size) overlay.size = clamp(op.size, 2, 25);
      if (op.animation) overlay.animation = op.animation;
      addText(overlay);
      return ok(op, op.note || `「${op.text}」を追加`);
    }

    case "update_text": {
      const overlay = pick(state.texts, op.index);
      if (!overlay) return skip(op, "対象のテロップが見つかりません");
      const patch = {};
      if (op.text != null) patch.text = op.text;
      if (op.start != null) patch.start = Math.max(0, op.start);
      if (op.duration != null) patch.duration = clamp(op.duration, 0.3, 60);
      if (op.position) patch.y = POSITION_Y[op.position] ?? overlay.y;
      if (op.color) patch.color = op.color;
      if (op.size) patch.size = clamp(op.size, 2, 25);
      if (op.animation) patch.animation = op.animation;
      if (!Object.keys(patch).length) return skip(op, "変更内容がありません");
      updateItem("text", overlay.id, patch, { label: "AI: テロップ" });
      return ok(op);
    }

    case "project": {
      const patch = {};
      if (op.width && op.height) {
        patch.width = clamp(Math.round(op.width), 64, 4096);
        patch.height = clamp(Math.round(op.height), 64, 4096);
      }
      if (op.fps) patch.fps = clamp(Math.round(op.fps), 1, 120);
      if (op.background) patch.background = op.background;
      if (!Object.keys(patch).length) return skip(op, "変更内容がありません");
      updateProject(patch, { label: "AI: 出力設定" });
      return ok(op);
    }

    default:
      return skip(op, `未対応の操作です (${op.op})`);
  }
}

/** 操作列をまとめて適用する（取り消しは 1 回で戻せる） */
export function applyOperations(operations) {
  const results = [];
  transaction("AI 編集", () => {
    operations.forEach((op) => {
      try {
        results.push(applyOne(op));
      } catch (error) {
        results.push(skip(op, error.message || "適用できませんでした"));
      }
    });
  });
  return results;
}

/** ハイライト区間を新しいクリップとしてタイムラインの末尾に足す */
export function appendHighlight(media, highlight) {
  const duration = media.duration || 0;
  const start = clamp(highlight.start, 0, Math.max(0, duration - 0.2));
  const end = clamp(highlight.end, start + 0.2, duration || highlight.end);
  let added = null;
  transaction("AI: ハイライトを追加", () => {
    const clipStart = totalDuration();
    const clip = createVideoClip(media);
    clip.in = start;
    clip.out = end;
    clip.fadeIn = 0.3;
    clip.fadeOut = 0.3;
    addClip(clip);
    if (highlight.title) {
      const overlay = createText(clipStart);
      overlay.text = highlight.title;
      overlay.duration = Math.min(3, end - start);
      overlay.y = POSITION_Y.top;
      overlay.animation = "slide";
      addText(overlay);
    }
    added = clip;
  });
  return added;
}

/** タイムライン上でその素材が最初に使われる位置（字幕の時間合わせに使う） */
export function mediaTimelineOffset(mediaId) {
  const item = layout().find((entry) => entry.clip.mediaId === mediaId);
  if (!item) return 0;
  // クリップが素材の途中から始まっている場合はその分を戻す
  return Math.max(0, item.start - item.clip.in / (item.clip.speed || 1));
}

/** 現在のプロジェクトを、AI に渡せる小さな JSON にまとめる */
export function projectSummary() {
  const state = getState();
  const items = layout();
  return {
    duration: Number(
      (items.length ? items[items.length - 1].end : 0).toFixed(2)
    ),
    width: state.width,
    height: state.height,
    fps: state.fps,
    clips: items.map((item) => {
      const media = getMedia(item.clip.mediaId);
      return {
        index: item.index + 1,
        name: media ? media.name : "(不明)",
        kind: item.clip.kind,
        timeline_start: Number(item.start.toFixed(2)),
        duration: Number(item.dur.toFixed(2)),
        source_start: Number(item.clip.in.toFixed(2)),
        source_end: Number(item.clip.out.toFixed(2)),
        source_duration: Number((media?.duration || 0).toFixed(2)),
        speed: item.clip.speed,
        volume: item.clip.volume,
        filter: item.clip.preset,
        transition: item.clip.transition?.type || "none",
        fade_in: item.clip.fadeIn,
        fade_out: item.clip.fadeOut,
      };
    }),
    audio: state.audio.map((clip, index) => ({
      index: index + 1,
      name: getMedia(clip.mediaId)?.name || "(不明)",
      start: Number(clip.start.toFixed(2)),
      duration: Number(clipDuration(clip).toFixed(2)),
      volume: clip.volume,
    })),
    texts: state.texts.map((overlay, index) => ({
      index: index + 1,
      text: overlay.text,
      start: Number(overlay.start.toFixed(2)),
      duration: Number(overlay.duration.toFixed(2)),
      animation: overlay.animation,
    })),
  };
}
