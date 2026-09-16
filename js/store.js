import { makeId, clamp, deepClone } from "./utils.js";

const STORAGE_KEY = "clipstudio.project.v1";
const MAX_HISTORY = 60;

export const DEFAULT_FILTERS = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
};

export const FILTER_PRESETS = {
  none: { label: "なし", values: {} },
  vivid: { label: "ビビッド", values: { saturate: 150, contrast: 115 } },
  mono: { label: "モノクロ", values: { grayscale: 100, contrast: 110 } },
  sepia: { label: "セピア", values: { sepia: 80, saturate: 80 } },
  vintage: { label: "ヴィンテージ", values: { sepia: 40, contrast: 90, saturate: 85, brightness: 105 } },
  cool: { label: "クール", values: { hue: 190, saturate: 110 } },
  warm: { label: "ウォーム", values: { hue: 15, saturate: 115, brightness: 105 } },
  dream: { label: "ドリーム", values: { blur: 2, brightness: 110, saturate: 120 } },
};

export const TRANSITIONS = {
  none: "なし",
  crossfade: "クロスフェード",
  fadeblack: "黒フェード",
  wipe: "ワイプ",
  slide: "スライド",
  zoom: "ズーム",
};

export const ASPECT_PRESETS = [
  { label: "YouTube 16:9 (1280×720)", width: 1280, height: 720 },
  { label: "フル HD 16:9 (1920×1080)", width: 1920, height: 1080 },
  { label: "縦動画 9:16 (1080×1920)", width: 1080, height: 1920 },
  { label: "正方形 1:1 (1080×1080)", width: 1080, height: 1080 },
  { label: "SNS 4:5 (1080×1350)", width: 1080, height: 1350 },
];

function emptyProject() {
  return {
    version: 1,
    name: "無題のプロジェクト",
    width: 1280,
    height: 720,
    fps: 30,
    background: "#000000",
    media: [],
    clips: [],
    audio: [],
    texts: [],
  };
}

let state = emptyProject();
let selection = null; // { type: "clip" | "audio" | "text", id }
const listeners = new Set();
const undoStack = [];
const redoStack = [];
let pending = null; // バッチ編集中のスナップショット

export function getState() {
  return state;
}

export function getSelection() {
  return selection;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(detail = {}) {
  listeners.forEach((fn) => fn(state, detail));
  persistLater();
}

/** 取り消し履歴に残す単発の編集 */
export function commit(label, mutator) {
  pushUndo(label);
  mutator(state);
  emit({ label });
}

/** 履歴に残さない編集（選択やスクラブなど） */
export function touch(detail) {
  emit(detail || {});
}

/** ドラッグ操作など、開始〜終了をひとまとめに履歴へ入れる */
export function beginBatch(label) {
  if (pending) return;
  pending = { label, snapshot: snapshot() };
}

export function endBatch() {
  if (!pending) return;
  const before = pending.snapshot;
  pending = null;
  if (JSON.stringify(before) === JSON.stringify(snapshot())) return;
  undoStack.push(before);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  emit({ history: true });
}

export function cancelBatch() {
  pending = null;
}

function snapshot() {
  return deepClone({
    name: state.name,
    width: state.width,
    height: state.height,
    fps: state.fps,
    background: state.background,
    media: state.media,
    clips: state.clips,
    audio: state.audio,
    texts: state.texts,
  });
}

function restore(snap) {
  Object.assign(state, deepClone(snap));
}

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  ensureSelectionValid();
  emit({ history: true });
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  ensureSelectionValid();
  emit({ history: true });
  return true;
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

export function select(type, id) {
  const next = type && id ? { type, id } : null;
  const same = (!selection && !next) || (selection && next && selection.type === next.type && selection.id === next.id);
  if (same) return;
  selection = next;
  emit({ selection: true });
}

function ensureSelectionValid() {
  if (!selection) return;
  if (!getSelected()) selection = null;
}

export function getSelected() {
  if (!selection) return null;
  const list = listFor(selection.type);
  return list.find((item) => item.id === selection.id) || null;
}

export function listFor(type) {
  if (type === "clip") return state.clips;
  if (type === "audio") return state.audio;
  if (type === "text") return state.texts;
  return [];
}

/* ------------------------------------------------------------------ */
/* メディア                                                            */
/* ------------------------------------------------------------------ */

export function addMedia(entry) {
  const media = {
    id: makeId(),
    name: entry.name,
    kind: entry.kind,
    duration: entry.duration || 0,
    width: entry.width || 0,
    height: entry.height || 0,
    size: entry.size || 0,
    type: entry.type || "",
    thumbnail: entry.thumbnail || "",
    missing: false,
    ...entry.overrides,
  };
  commit("メディアを追加", (s) => s.media.push(media));
  return media;
}

export function getMedia(id) {
  return state.media.find((m) => m.id === id) || null;
}

export function removeMedia(id) {
  commit("メディアを削除", (s) => {
    s.media = s.media.filter((m) => m.id !== id);
    s.clips = s.clips.filter((c) => c.mediaId !== id);
    s.audio = s.audio.filter((c) => c.mediaId !== id);
  });
  ensureSelectionValid();
}

/* ------------------------------------------------------------------ */
/* クリップ生成                                                        */
/* ------------------------------------------------------------------ */

export const IMAGE_DEFAULT_DURATION = 4;

export function createVideoClip(media) {
  const duration = media.kind === "image" ? IMAGE_DEFAULT_DURATION : media.duration || 1;
  return {
    id: makeId(),
    mediaId: media.id,
    kind: media.kind,
    in: 0,
    out: duration,
    speed: 1,
    volume: 1,
    fit: "contain",
    filters: { ...DEFAULT_FILTERS },
    preset: "none",
    transform: { scale: 1, offsetX: 0, offsetY: 0, rotate: 0, flipH: false, flipV: false },
    fadeIn: 0,
    fadeOut: 0,
    transition: { type: "none", duration: 0.5 },
  };
}

export function createAudioClip(media, start = 0) {
  return {
    id: makeId(),
    mediaId: media.id,
    kind: "audio",
    start,
    in: 0,
    out: media.duration || 1,
    volume: 0.8,
    speed: 1,
    fadeIn: 0.5,
    fadeOut: 1,
  };
}

export function createText(start = 0) {
  return {
    id: makeId(),
    text: "テキストを入力",
    start,
    duration: 3,
    x: 0.5,
    y: 0.82,
    size: 7,
    color: "#ffffff",
    background: "rgba(0,0,0,0)",
    font: "sans-serif",
    weight: 700,
    align: "center",
    shadow: true,
    animation: "fade",
  };
}

export function addClip(clip, index = -1) {
  commit("クリップを追加", (s) => {
    if (index < 0 || index >= s.clips.length) s.clips.push(clip);
    else s.clips.splice(index, 0, clip);
  });
  select("clip", clip.id);
}

export function addAudio(clip) {
  commit("音声を追加", (s) => s.audio.push(clip));
  select("audio", clip.id);
}

export function addText(overlay) {
  commit("テキストを追加", (s) => s.texts.push(overlay));
  select("text", overlay.id);
}

export function removeItem(type, id) {
  commit("削除", (s) => {
    if (type === "clip") s.clips = s.clips.filter((c) => c.id !== id);
    if (type === "audio") s.audio = s.audio.filter((c) => c.id !== id);
    if (type === "text") s.texts = s.texts.filter((t) => t.id !== id);
  });
  ensureSelectionValid();
}

export function duplicateItem(type, id) {
  const list = listFor(type);
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const copy = deepClone(list[index]);
  copy.id = makeId();
  if (type === "audio") copy.start = copy.start + (copy.out - copy.in);
  if (type === "text") copy.start = copy.start + copy.duration;
  commit("複製", (s) => listForState(s, type).splice(index + 1, 0, copy));
  select(type, copy.id);
  return copy;
}

function listForState(s, type) {
  if (type === "clip") return s.clips;
  if (type === "audio") return s.audio;
  return s.texts;
}

export function updateItem(type, id, patch, { label = "変更", batch = false } = {}) {
  const apply = (s) => {
    const item = listForState(s, type).find((x) => x.id === id);
    if (item) Object.assign(item, patch);
  };
  if (batch) {
    apply(state);
    emit({ label });
  } else {
    commit(label, apply);
  }
}

export function updateProject(patch, { label = "プロジェクト設定", batch = false } = {}) {
  if (batch) {
    Object.assign(state, patch);
    emit({ label });
  } else {
    commit(label, (s) => Object.assign(s, patch));
  }
}

/* ------------------------------------------------------------------ */
/* レイアウト計算                                                      */
/* ------------------------------------------------------------------ */

export function clipDuration(clip) {
  return Math.max(0.05, (clip.out - clip.in) / (clip.speed || 1));
}

/**
 * 映像トラックのクリップ配置を求める。
 * トランジションを持つクリップは直前のクリップと重なる。
 */
export function layout(clips = state.clips) {
  const items = [];
  clips.forEach((clip, index) => {
    const dur = clipDuration(clip);
    let trans = 0;
    if (index > 0 && clip.transition && clip.transition.type !== "none") {
      const prev = items[index - 1];
      trans = clamp(clip.transition.duration || 0, 0, Math.min(dur, prev.dur) * 0.9);
    }
    const start = index === 0 ? 0 : items[index - 1].end - trans;
    items.push({ clip, index, start, end: start + dur, dur, trans });
  });
  return items;
}

export function videoDuration() {
  const items = layout();
  return items.length ? items[items.length - 1].end : 0;
}

export function totalDuration() {
  let total = videoDuration();
  state.audio.forEach((clip) => {
    total = Math.max(total, clip.start + clipDuration(clip));
  });
  state.texts.forEach((t) => {
    total = Math.max(total, t.start + t.duration);
  });
  return total;
}

/** time 時点で描画すべき映像クリップ（トランジション中は2つ返る） */
export function clipsAt(time) {
  return layout().filter((item) => time >= item.start - 0.0001 && time < item.end - 0.0001);
}

export function audioAt(time) {
  return state.audio.filter(
    (clip) => time >= clip.start && time < clip.start + clipDuration(clip)
  );
}

export function textsAt(time) {
  return state.texts.filter((t) => time >= t.start && time < t.start + t.duration);
}

/* ------------------------------------------------------------------ */
/* 分割                                                                */
/* ------------------------------------------------------------------ */

export function splitAt(time) {
  const items = layout();
  const target = items.find((item) => time > item.start + 0.05 && time < item.end - 0.05);
  if (!target) return false;
  const clip = target.clip;
  const speed = clip.speed || 1;
  const sourceCut = clip.in + (time - target.start) * speed;
  const head = deepClone(clip);
  const tail = deepClone(clip);
  head.out = sourceCut;
  head.fadeOut = 0;
  tail.id = makeId();
  tail.in = sourceCut;
  tail.fadeIn = 0;
  tail.transition = { type: "none", duration: 0.5 };
  commit("クリップを分割", (s) => {
    const index = s.clips.findIndex((c) => c.id === clip.id);
    s.clips.splice(index, 1, head, tail);
  });
  select("clip", tail.id);
  return true;
}

export function moveClip(fromIndex, toIndex) {
  const clips = state.clips;
  if (toIndex < 0 || toIndex >= clips.length || fromIndex === toIndex) return;
  const [moved] = clips.splice(fromIndex, 1);
  clips.splice(toIndex, 0, moved);
  emit({ reorder: true });
}

/* ------------------------------------------------------------------ */
/* 保存 / 読み込み                                                     */
/* ------------------------------------------------------------------ */

let persistTimer = null;

function persistNow() {
  clearTimeout(persistTimer);
  persistTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
  } catch {
    /* 容量超過などは無視（素材本体は保存しない） */
  }
}

/**
 * 末尾側スロットル。ドラッグ中のように更新が続いても
 * 一定間隔で必ず保存されるようにする（デバウンスだと保存が先送りされ続ける）。
 */
function persistLater() {
  if (persistTimer) return;
  persistTimer = setTimeout(persistNow, 800);
}

/** タブを閉じる直前などに確実に書き出す */
export function flushPersist() {
  persistNow();
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.media)) return false;
    restore({ ...emptyProject(), ...data });
    // ファイル本体はブラウザに保持できないため、再リンクが必要
    state.media.forEach((m) => {
      m.missing = true;
    });
    emit({ loaded: true });
    return state.media.length > 0 || state.clips.length > 0;
  } catch {
    return false;
  }
}

export function serialize() {
  return JSON.stringify({ app: "ClipStudio", ...snapshot() }, null, 2);
}

export function deserialize(json) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.clips)) throw new Error("プロジェクト形式が正しくありません");
  pushUndo();
  restore({ ...emptyProject(), ...data, media: data.media || [] });
  state.media.forEach((m) => {
    m.missing = true;
  });
  selection = null;
  emit({ loaded: true });
}

export function resetProject() {
  pushUndo();
  restore(emptyProject());
  selection = null;
  emit({ reset: true });
}
