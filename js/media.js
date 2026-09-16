import { getState, getMedia } from "./store.js";

const pool = document.getElementById("media-pool");

/** mediaId -> objectURL（ファイル本体はメモリ上だけに保持） */
const urls = new Map();
/** clipId -> HTMLMediaElement / HTMLImageElement */
const elements = new Map();
/** 要素が作られたときに呼ばれるフック（音声グラフ接続用） */
const elementHooks = new Set();

export function onElementCreated(fn) {
  elementHooks.add(fn);
  return () => elementHooks.delete(fn);
}

export function kindOf(file) {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  // 拡張子でのフォールバック
  const ext = file.name.split(".").pop().toLowerCase();
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(ext)) return "image";
  return null;
}

/** ファイルを解析してメタ情報とサムネイルを返す */
export function probeFile(file) {
  const kind = kindOf(file);
  if (!kind) return Promise.reject(new Error(`${file.name} は対応していない形式です`));
  const url = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const fail = (message) => {
      URL.revokeObjectURL(url);
      reject(new Error(message));
    };

    if (kind === "image") {
      const img = new Image();
      img.onload = () => {
        resolve({
          url,
          meta: {
            name: file.name,
            kind,
            duration: 0,
            width: img.naturalWidth,
            height: img.naturalHeight,
            size: file.size,
            type: file.type,
            thumbnail: url,
          },
        });
      };
      img.onerror = () => fail(`${file.name} を読み込めませんでした`);
      img.src = url;
      return;
    }

    const probe = document.createElement(kind === "audio" ? "audio" : "video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.playsInline = true;
    probe.onerror = () => fail(`${file.name} を読み込めませんでした`);
    probe.onloadedmetadata = async () => {
      const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
      const meta = {
        name: file.name,
        kind,
        duration,
        width: probe.videoWidth || 0,
        height: probe.videoHeight || 0,
        size: file.size,
        type: file.type,
        thumbnail: "",
      };
      if (kind === "video") {
        meta.thumbnail = await grabThumbnail(probe, duration).catch(() => "");
      }
      resolve({ url, meta });
    };
    probe.src = url;
  });
}

function grabThumbnail(video, duration) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 4000);
    const done = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        const ratio = video.videoWidth / Math.max(1, video.videoHeight) || 16 / 9;
        canvas.width = 160;
        canvas.height = Math.max(1, Math.round(160 / ratio));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      } catch (err) {
        reject(err);
      }
    };
    video.onseeked = done;
    try {
      video.currentTime = Math.min(0.3, duration / 2 || 0);
    } catch {
      reject(new Error("seek failed"));
    }
  });
}

export function attachSource(mediaId, url) {
  const previous = urls.get(mediaId);
  if (previous && previous !== url) URL.revokeObjectURL(previous);
  urls.set(mediaId, url);
  // 再リンク時は古い要素を捨てて作り直す
  getState().clips.concat(getState().audio).forEach((clip) => {
    if (clip.mediaId === mediaId) releaseClip(clip.id);
  });
}

export function hasSource(mediaId) {
  return urls.has(mediaId);
}

export function sourceUrl(mediaId) {
  return urls.get(mediaId) || "";
}

/** クリップ専用のメディア要素。クロスフェードで同じ素材が重なっても衝突しない */
export function getClipElement(clip) {
  const cached = elements.get(clip.id);
  if (cached) return cached;
  const media = getMedia(clip.mediaId);
  const url = urls.get(clip.mediaId);
  if (!media || !url) return null;

  let node;
  if (media.kind === "image") {
    node = new Image();
    node.src = url;
  } else {
    node = document.createElement(media.kind === "audio" ? "audio" : "video");
    node.src = url;
    node.preload = "auto";
    node.playsInline = true;
    node.muted = false;
    node.volume = 1;
    node.crossOrigin = "anonymous";
    pool.appendChild(node);
  }
  node.dataset.clipId = clip.id;
  elements.set(clip.id, node);
  if (media.kind !== "image") elementHooks.forEach((fn) => fn(node, clip));
  return node;
}

export function isReady(element) {
  if (!element) return false;
  if (element instanceof HTMLImageElement) return element.complete && element.naturalWidth > 0;
  return element.readyState >= 2;
}

export function releaseClip(clipId) {
  const node = elements.get(clipId);
  if (!node) return;
  if (node instanceof HTMLMediaElement) {
    node.pause();
    node.removeAttribute("src");
    node.load();
    node.remove();
  }
  elements.delete(clipId);
}

/** 不要になった要素を掃除する */
export function pruneElements() {
  const alive = new Set(getState().clips.concat(getState().audio).map((c) => c.id));
  [...elements.keys()].forEach((id) => {
    if (!alive.has(id)) releaseClip(id);
  });
}

export function pauseAll() {
  elements.forEach((node) => {
    if (node instanceof HTMLMediaElement) node.pause();
  });
}

export function eachMediaElement(fn) {
  elements.forEach((node, id) => {
    if (node instanceof HTMLMediaElement) fn(node, id);
  });
}

/* ------------------------------------------------------------------ */
/* サンプル素材の生成（素材が手元にないときの動作確認用）              */
/* ------------------------------------------------------------------ */

export async function createSampleClip({ seconds = 3, label = "SAMPLE", hue = 265 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(30);
  const mime = pickSampleMime();
  if (!mime) throw new Error("このブラウザは録画に対応していません");
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const finished = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });

  recorder.start();
  const started = performance.now();
  await new Promise((resolve) => {
    const frame = () => {
      const elapsed = (performance.now() - started) / 1000;
      const p = elapsed / seconds;
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, `hsl(${(hue + p * 90) % 360} 70% 45%)`);
      gradient.addColorStop(1, `hsl(${(hue + 120 + p * 90) % 360} 70% 25%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(p * Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(-60, -60, 120, 120);
      ctx.restore();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 44px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, canvas.width / 2, canvas.height - 40);
      if (elapsed >= seconds) {
        recorder.stop();
        resolve();
      } else {
        requestAnimationFrame(frame);
      }
    };
    requestAnimationFrame(frame);
  });

  const blob = await finished;
  const ext = mime.includes("mp4") ? "mp4" : "webm";
  return new File([blob], `${label.toLowerCase()}.${ext}`, { type: mime.split(";")[0] });
}

function pickSampleMime() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported?.(m)) || null;
}
