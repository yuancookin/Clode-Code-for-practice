import { clamp } from "./utils.js";
import { eachMediaElement } from "./media.js";

let ctx = null;
let monitor = null;
let streamDest = null;
let supported = true;
const nodes = new Map(); // HTMLMediaElement -> { source, gain }
let masterVolume = 1;
let muted = false;

export function ensureContext() {
  if (ctx || !supported) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    supported = false;
    return null;
  }
  try {
    ctx = new Ctor();
    monitor = ctx.createGain();
    monitor.gain.value = muted ? 0 : masterVolume;
    monitor.connect(ctx.destination);
    eachMediaElement((element) => register(element));
  } catch {
    supported = false;
    ctx = null;
  }
  return ctx;
}

export function resume() {
  const context = ensureContext();
  if (context && context.state === "suspended") context.resume().catch(() => {});
}

export function register(element) {
  if (!ctx || nodes.has(element)) return;
  try {
    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(monitor);
    if (streamDest) gain.connect(streamDest);
    nodes.set(element, { source, gain });
    element.volume = 1;
  } catch {
    /* すでに別のコンテキストに接続済みなど。element.volume で制御する */
  }
}

/** クリップ単位の音量（0-1）を反映する */
export function setGain(element, value) {
  const level = clamp(value, 0, 1);
  const node = nodes.get(element);
  if (node) {
    node.gain.gain.value = level;
  } else {
    element.volume = clamp(level * (muted ? 0 : masterVolume), 0, 1);
  }
}

export function setMaster(volume, isMuted) {
  masterVolume = clamp(volume, 0, 1);
  muted = !!isMuted;
  if (monitor) monitor.gain.value = muted ? 0 : masterVolume;
}

export function isMuted() {
  return muted;
}

/** 書き出し用の音声ストリーム。取得できない場合は null */
export function captureAudioStream() {
  const context = ensureContext();
  if (!context) return null;
  if (!streamDest) {
    streamDest = context.createMediaStreamDestination();
    nodes.forEach(({ gain }) => gain.connect(streamDest));
  }
  return streamDest.stream;
}

export function hasAudioGraph() {
  return nodes.size > 0;
}
