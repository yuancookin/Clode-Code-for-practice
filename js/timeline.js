import { clamp, formatTick, formatTime, el } from "./utils.js";
import {
  getState,
  getSelection,
  select,
  layout,
  clipDuration,
  totalDuration,
  videoDuration,
  moveClip,
  updateItem,
  beginBatch,
  endBatch,
  touch,
  getMedia,
  TRANSITIONS,
} from "./store.js";
import * as player from "./player.js";

const scroller = document.getElementById("timeline-scroll");
const inner = document.getElementById("timeline-inner");
const ruler = document.getElementById("ruler");
const playhead = document.getElementById("playhead");
const tracks = {
  video: document.getElementById("track-video"),
  audio: document.getElementById("track-audio"),
  text: document.getElementById("track-text"),
};
const zoomLabel = document.getElementById("zoom-label");
const snapToggle = document.getElementById("chk-snap");

const LABEL_WIDTH = 88; // .track-label の幅。目盛りとトラックの原点を揃える
const MIN_ZOOM = 6;
const MAX_ZOOM = 400;
const TICKS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

let zoom = 60;
let followPlayhead = true;

export function getZoom() {
  return zoom;
}

export function setZoom(value) {
  zoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
  zoomLabel.textContent = `${Math.round(zoom)}px/s`;
  render();
}

export function zoomBy(factor) {
  setZoom(zoom * factor);
}

export function zoomToFit() {
  const total = totalDuration();
  const width = scroller.clientWidth - 40;
  if (total > 0.2 && width > 0) setZoom(width / total);
  else setZoom(60);
}

function timeToX(time) {
  return time * zoom;
}

function xToTime(x) {
  return Math.max(0, x / zoom);
}

function pointerTime(event, element, offset = 0) {
  const rect = element.getBoundingClientRect();
  return xToTime(event.clientX - rect.left - offset);
}

/* ------------------------------------------------------------------ */
/* スナップ                                                            */
/* ------------------------------------------------------------------ */

function snapCandidates(excludeId) {
  const times = [0, player.getTime()];
  layout().forEach((item) => {
    times.push(item.start, item.end);
  });
  getState().audio.forEach((clip) => {
    if (clip.id === excludeId) return;
    times.push(clip.start, clip.start + clipDuration(clip));
  });
  getState().texts.forEach((t) => {
    if (t.id === excludeId) return;
    times.push(t.start, t.start + t.duration);
  });
  return times;
}

function snapTime(time, excludeId) {
  if (!snapToggle.checked) return Math.max(0, time);
  const threshold = 10 / zoom;
  let best = time;
  let bestDelta = threshold;
  snapCandidates(excludeId).forEach((candidate) => {
    const delta = Math.abs(candidate - time);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  });
  return Math.max(0, best);
}

/* ------------------------------------------------------------------ */
/* 描画                                                                */
/* ------------------------------------------------------------------ */

export function render() {
  const total = Math.max(totalDuration(), 5);
  const width = Math.max(timeToX(total) + LABEL_WIDTH + 240, scroller.clientWidth);
  inner.style.width = `${width}px`;
  renderRuler(total, width);
  renderVideoTrack();
  renderAudioTrack();
  renderTextTrack();
  updatePlayhead(player.getTime());
}

function renderRuler(total, width) {
  ruler.innerHTML = "";
  ruler.style.width = `${width}px`;
  const interval = TICKS.find((t) => t * zoom >= 64) || TICKS[TICKS.length - 1];
  for (let t = 0; t <= total + interval; t += interval) {
    const tick = el("div", "tick");
    tick.style.left = `${timeToX(t) + LABEL_WIDTH}px`;
    tick.appendChild(el("span", "tick-label", formatTick(t)));
    ruler.appendChild(tick);
  }
}

function clipThumbStyle(node, media) {
  if (media && media.thumbnail) {
    node.style.backgroundImage = `url("${media.thumbnail}")`;
    node.style.backgroundSize = "auto 100%";
    node.style.backgroundRepeat = "repeat-x";
  }
}

function addHandles(node, item, type) {
  ["left", "right"].forEach((side) => {
    const handle = el("div", `handle handle-${side}`);
    handle.dataset.side = side;
    handle.title = side === "left" ? "開始位置をトリム" : "終了位置をトリム";
    node.appendChild(handle);
    handle.addEventListener("pointerdown", (event) => startTrim(event, item, type, side));
  });
}

function renderVideoTrack() {
  const track = tracks.video;
  track.innerHTML = "";
  const selection = getSelection();
  layout().forEach((item) => {
    const media = getMedia(item.clip.mediaId);
    const node = el("div", "clip clip-video");
    node.style.left = `${timeToX(item.start)}px`;
    node.style.width = `${Math.max(14, timeToX(item.dur))}px`;
    if (selection && selection.type === "clip" && selection.id === item.clip.id) {
      node.classList.add("selected");
    }
    if (!media || media.missing) node.classList.add("missing");
    clipThumbStyle(node, media);

    const label = el("div", "clip-label");
    label.appendChild(el("span", "clip-name", media ? media.name : "メディア未リンク"));
    const meta = el("span", "clip-meta", formatTime(item.dur));
    if (item.clip.speed !== 1) meta.textContent += ` ・ ${item.clip.speed}x`;
    label.appendChild(meta);
    node.appendChild(label);

    if (item.trans > 0) {
      const badge = el("div", "transition-badge", `⇄ ${TRANSITIONS[item.clip.transition.type]}`);
      badge.style.width = `${Math.max(16, timeToX(item.trans))}px`;
      node.appendChild(badge);
    }
    if (item.clip.fadeIn > 0) node.appendChild(el("div", "fade fade-in"));
    if (item.clip.fadeOut > 0) node.appendChild(el("div", "fade fade-out"));

    addHandles(node, item, "clip");
    node.addEventListener("pointerdown", (event) => startClipDrag(event, item, node));
    track.appendChild(node);
  });

  if (!getState().clips.length) {
    track.appendChild(el("div", "track-empty", "映像クリップをここに並べます"));
  }
}

function renderAudioTrack() {
  const track = tracks.audio;
  track.innerHTML = "";
  const selection = getSelection();
  getState().audio.forEach((clip) => {
    const media = getMedia(clip.mediaId);
    const dur = clipDuration(clip);
    const node = el("div", "clip clip-audio");
    node.style.left = `${timeToX(clip.start)}px`;
    node.style.width = `${Math.max(14, timeToX(dur))}px`;
    if (selection && selection.type === "audio" && selection.id === clip.id) {
      node.classList.add("selected");
    }
    if (!media || media.missing) node.classList.add("missing");
    const label = el("div", "clip-label");
    label.appendChild(el("span", "clip-name", media ? media.name : "音声未リンク"));
    label.appendChild(el("span", "clip-meta", `${formatTime(dur)} ・ ${Math.round(clip.volume * 100)}%`));
    node.appendChild(label);
    node.appendChild(el("div", "waveform"));
    addHandles(node, { clip, start: clip.start, dur }, "audio");
    node.addEventListener("pointerdown", (event) => startMoveDrag(event, clip, "audio", node));
    track.appendChild(node);
  });
  if (!getState().audio.length) {
    track.appendChild(el("div", "track-empty", "BGM やナレーションを配置"));
  }
}

function renderTextTrack() {
  const track = tracks.text;
  track.innerHTML = "";
  const selection = getSelection();
  getState().texts.forEach((overlay) => {
    const node = el("div", "clip clip-text");
    node.style.left = `${timeToX(overlay.start)}px`;
    node.style.width = `${Math.max(14, timeToX(overlay.duration))}px`;
    if (selection && selection.type === "text" && selection.id === overlay.id) {
      node.classList.add("selected");
    }
    const label = el("div", "clip-label");
    label.appendChild(el("span", "clip-name", overlay.text.split("\n")[0] || "テキスト"));
    label.appendChild(el("span", "clip-meta", formatTime(overlay.duration)));
    node.appendChild(label);
    addHandles(node, { clip: overlay, start: overlay.start, dur: overlay.duration }, "text");
    node.addEventListener("pointerdown", (event) => startMoveDrag(event, overlay, "text", node));
    track.appendChild(node);
  });
  if (!getState().texts.length) {
    track.appendChild(el("div", "track-empty", "T キーでテロップを追加"));
  }
}

/* ------------------------------------------------------------------ */
/* 再生ヘッド                                                          */
/* ------------------------------------------------------------------ */

export function updatePlayhead(time) {
  const x = timeToX(time) + LABEL_WIDTH;
  playhead.style.transform = `translateX(${x - LABEL_WIDTH}px)`;
  if (!followPlayhead || !player.isPlaying()) return;
  const left = scroller.scrollLeft;
  const right = left + scroller.clientWidth;
  if (x < left + 40 || x > right - 80) {
    scroller.scrollLeft = Math.max(0, x - scroller.clientWidth * 0.35);
  }
}

function startScrub(event) {
  if (event.button !== 0) return;
  const target = event.currentTarget;
  const offset = target === ruler ? LABEL_WIDTH : 0;
  const move = (e) => player.seek(snapTime(pointerTime(e, target, offset)));
  move(event);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

ruler.addEventListener("pointerdown", startScrub);
playhead.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
  const move = (e) => {
    const rect = inner.getBoundingClientRect();
    player.seek(snapTime(xToTime(e.clientX - rect.left - LABEL_WIDTH)));
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});

Object.entries(tracks).forEach(([, track]) => {
  track.addEventListener("pointerdown", (event) => {
    if (event.target !== track && !event.target.classList.contains("track-empty")) return;
    select(null, null);
    const move = (e) => player.seek(snapTime(pointerTime(e, track)));
    move(event);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
});

/* ------------------------------------------------------------------ */
/* ドラッグ操作                                                        */
/* ------------------------------------------------------------------ */

function startClipDrag(event, item, node) {
  if (event.button !== 0 || event.target.classList.contains("handle")) return;
  event.preventDefault();
  select("clip", item.clip.id);
  const startX = event.clientX;
  let dragging = false;
  let index = item.index;

  const move = (e) => {
    if (!dragging && Math.abs(e.clientX - startX) < 5) return;
    if (!dragging) {
      dragging = true;
      beginBatch("クリップを並べ替え");
      node.classList.add("dragging");
    }
    const rect = tracks.video.getBoundingClientRect();
    const time = xToTime(e.clientX - rect.left);
    const items = layout();
    let target = items.length - 1;
    for (let i = 0; i < items.length; i += 1) {
      if (time < items[i].start + items[i].dur / 2) {
        target = i;
        break;
      }
    }
    if (target !== index) {
      moveClip(index, target);
      index = target;
    }
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    node.classList.remove("dragging");
    if (dragging) endBatch();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startMoveDrag(event, clip, type, node) {
  if (event.button !== 0 || event.target.classList.contains("handle")) return;
  event.preventDefault();
  select(type, clip.id);
  const rect = tracks[type === "audio" ? "audio" : "text"].getBoundingClientRect();
  const grabOffset = xToTime(event.clientX - rect.left) - clip.start;
  let dragging = false;

  const move = (e) => {
    if (!dragging) {
      dragging = true;
      beginBatch("クリップを移動");
      node.classList.add("dragging");
    }
    const raw = xToTime(e.clientX - rect.left) - grabOffset;
    const start = snapTime(Math.max(0, raw), clip.id);
    updateItem(type, clip.id, { start }, { batch: true, label: "移動" });
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    node.classList.remove("dragging");
    if (dragging) endBatch();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startTrim(event, item, type, side) {
  event.preventDefault();
  event.stopPropagation();
  const clip = item.clip;
  select(type === "clip" ? "clip" : type, clip.id);
  const startX = event.clientX;
  const origin = {
    in: clip.in,
    out: clip.out,
    start: clip.start,
    duration: clip.duration,
  };
  let dragging = false;

  const move = (e) => {
    if (!dragging) {
      dragging = true;
      beginBatch("トリム");
    }
    const delta = (e.clientX - startX) / zoom;

    if (type === "text") {
      if (side === "left") {
        const start = Math.max(0, Math.min(origin.start + delta, origin.start + origin.duration - 0.2));
        updateItem("text", clip.id, {
          start,
          duration: origin.start + origin.duration - start,
        }, { batch: true });
      } else {
        updateItem("text", clip.id, {
          duration: Math.max(0.2, origin.duration + delta),
        }, { batch: true });
      }
      return;
    }

    const media = getMedia(clip.mediaId);
    const speed = clip.speed || 1;
    const max = clip.kind === "image" ? Number.MAX_SAFE_INTEGER : (media?.duration || origin.out);
    if (side === "left") {
      const nextIn = clamp(origin.in + delta * speed, 0, origin.out - 0.1);
      const patch = { in: nextIn };
      if (type === "audio") patch.start = Math.max(0, origin.start + (nextIn - origin.in) / speed);
      updateItem(type, clip.id, patch, { batch: true });
    } else {
      const nextOut = clamp(origin.out + delta * speed, origin.in + 0.1, max);
      updateItem(type, clip.id, { out: nextOut }, { batch: true });
    }
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (dragging) endBatch();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/* ------------------------------------------------------------------ */

scroller.addEventListener("wheel", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

snapToggle.addEventListener("change", () => touch({ snap: true }));

window.addEventListener("resize", () => render());

export function scrollToTime(time) {
  scroller.scrollLeft = Math.max(0, timeToX(time) + LABEL_WIDTH - scroller.clientWidth / 2);
}

export function setFollow(value) {
  followPlayhead = !!value;
}

export function videoEnd() {
  return videoDuration();
}
