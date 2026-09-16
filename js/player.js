import { clamp } from "./utils.js";
import {
  getState,
  totalDuration,
  clipsAt,
  audioAt,
} from "./store.js";
import { getClipElement, eachMediaElement, pauseAll } from "./media.js";
import { drawFrame, clipAlpha, audioLevel } from "./renderer.js";
import { setGain, resume as resumeAudio } from "./audio.js";

const canvas = document.getElementById("preview-canvas");
const ctx = canvas.getContext("2d", { alpha: false });

let playing = false;
let currentTime = 0;
let rate = 1;
let looping = false;
let anchorPerf = 0;
let anchorTime = 0;
let lastPausedDraw = 0;
const listeners = new Set();

export function getCanvas() {
  return canvas;
}

export function getTime() {
  return currentTime;
}

export function isPlaying() {
  return playing;
}

export function getRate() {
  return rate;
}

export function onTick(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn(currentTime, playing));
}

function anchor() {
  anchorPerf = performance.now();
  anchorTime = currentTime;
}

export function resize() {
  const project = getState();
  if (canvas.width !== project.width || canvas.height !== project.height) {
    canvas.width = project.width;
    canvas.height = project.height;
  }
  render();
}

export function play() {
  if (playing) return;
  const total = totalDuration();
  if (total <= 0) return;
  if (rate > 0 && currentTime >= total - 0.02) currentTime = 0;
  if (rate < 0 && currentTime <= 0.02) currentTime = total;
  resumeAudio();
  playing = true;
  anchor();
  syncMedia(true);
  notify();
}

export function pause() {
  if (!playing) return;
  playing = false;
  pauseAll();
  eachMediaElement((element) => setGain(element, 0));
  anchor();
  notify();
}

export function toggle() {
  if (playing) pause();
  else play();
}

export function seek(time) {
  currentTime = clamp(time, 0, Math.max(0, totalDuration()));
  anchor();
  syncMedia(true);
  render();
  notify();
}

export function step(frames) {
  const project = getState();
  seek(currentTime + frames / (project.fps || 30));
}

export function setRate(value) {
  rate = clamp(value, -8, 8);
  anchor();
  if (rate === 0) pause();
  notify();
}

export function setLooping(value) {
  looping = !!value;
}

export function isLooping() {
  return looping;
}

/* ------------------------------------------------------------------ */

function syncMedia(force) {
  const wanted = new Map();

  clipsAt(currentTime).forEach((item) => {
    const clip = item.clip;
    if (clip.kind === "image") return;
    const element = getClipElement(clip);
    if (!element) return;
    const speed = clip.speed || 1;
    const srcTime = clamp(clip.in + (currentTime - item.start) * speed, clip.in, clip.out);
    const level = (clip.volume ?? 1) * clipAlpha(item, currentTime);
    wanted.set(element, { srcTime, speed, level });
  });

  audioAt(currentTime).forEach((clip) => {
    const element = getClipElement(clip);
    if (!element) return;
    const speed = clip.speed || 1;
    const srcTime = clamp(clip.in + (currentTime - clip.start) * speed, clip.in, clip.out);
    wanted.set(element, { srcTime, speed, level: audioLevel(clip, currentTime) });
  });

  eachMediaElement((element) => {
    if (wanted.has(element)) return;
    if (!element.paused) element.pause();
    setGain(element, 0);
  });

  const forward = playing && rate > 0;
  const tolerance = forward ? 0.35 : 0.05;

  wanted.forEach((desired, element) => {
    setGain(element, playing && rate > 0 ? desired.level : 0);
    if (force || Math.abs(element.currentTime - desired.srcTime) > tolerance) {
      try {
        element.currentTime = desired.srcTime;
      } catch {
        /* メタデータ未読み込みのときは次のフレームで再試行 */
      }
    }
    if (forward) {
      const playbackRate = clamp(desired.speed * rate, 0.0625, 16);
      if (element.playbackRate !== playbackRate) element.playbackRate = playbackRate;
      if (element.paused) element.play().catch(() => {});
    } else if (!element.paused) {
      element.pause();
    }
  });
}

export function render() {
  drawFrame(ctx, currentTime, getState());
}

function frame(now) {
  if (playing) {
    const total = totalDuration();
    currentTime = anchorTime + ((now - anchorPerf) / 1000) * rate;
    if (currentTime >= total) {
      if (looping && total > 0) {
        currentTime = 0;
        anchor();
      } else {
        currentTime = total;
        pause();
      }
    } else if (currentTime <= 0) {
      currentTime = 0;
      anchor();
      if (rate < 0) pause();
    }
    syncMedia(rate < 0);
    render();
    notify();
  } else if (now - lastPausedDraw > 120) {
    // 一時停止中もデコード完了に追従して描き直す
    lastPausedDraw = now;
    render();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
