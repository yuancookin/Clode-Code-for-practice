import { clamp, download, safeFilename } from "./utils.js";
import { getState, totalDuration } from "./store.js";
import { drawFrame } from "./renderer.js";
import { captureAudioStream } from "./audio.js";
import * as player from "./player.js";

const FORMATS = [
  { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", ext: "mp4", label: "MP4 (H.264)" },
  { mime: "video/mp4", ext: "mp4", label: "MP4" },
  { mime: "video/webm;codecs=vp9,opus", ext: "webm", label: "WebM (VP9)" },
  { mime: "video/webm;codecs=vp8,opus", ext: "webm", label: "WebM (VP8)" },
  { mime: "video/webm", ext: "webm", label: "WebM" },
];

export function supportedFormats() {
  if (typeof MediaRecorder === "undefined") return [];
  return FORMATS.filter((format) =>
    MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported(format.mime) : false
  );
}

let cancelled = false;

export function cancelExport() {
  cancelled = true;
}

export function isExporting() {
  return exporting;
}

let exporting = false;

/**
 * タイムラインを実時間で再生しながらキャンバスを録画する。
 * 書き出しには動画と同じ長さの時間がかかる。
 */
export async function exportVideo({ mime, scale = 1, fps = 30, bitrate = 6000000, onProgress }) {
  if (exporting) throw new Error("すでに書き出し中です");
  const project = getState();
  const total = totalDuration();
  if (total <= 0.05) throw new Error("タイムラインが空です");
  if (typeof MediaRecorder === "undefined") throw new Error("このブラウザは書き出しに対応していません");

  exporting = true;
  cancelled = false;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round((project.width * scale) / 2) * 2);
  canvas.height = Math.max(2, Math.round((project.height * scale) / 2) * 2);
  const ctx = canvas.getContext("2d", { alpha: false });
  drawFrame(ctx, 0, project);

  const stream = canvas.captureStream(fps);
  const audioStream = captureAudioStream();
  if (audioStream) audioStream.getAudioTracks().forEach((track) => stream.addTrack(track));

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: bitrate,
    audioBitsPerSecond: 192000,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  const finished = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime.split(";")[0] }));
  });

  player.pause();
  player.setRate(1);
  player.setLooping(false);
  player.seek(0);
  await wait(500); // 先頭フレームのデコード待ち

  recorder.start(250);
  player.play();

  await new Promise((resolve) => {
    let idleFrames = 0;
    const loop = () => {
      const time = player.getTime();
      drawFrame(ctx, time, getState());
      if (onProgress) onProgress(clamp(time / total, 0, 1), time, total);
      if (cancelled || time >= total - 0.001) {
        resolve();
        return;
      }
      if (!player.isPlaying()) {
        idleFrames += 1;
        if (idleFrames > 30) {
          resolve();
          return;
        }
      } else {
        idleFrames = 0;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  player.pause();
  await wait(120);
  if (recorder.state !== "inactive") recorder.stop();
  const blob = await finished;
  exporting = false;

  if (cancelled) {
    cancelled = false;
    throw new Error("書き出しを中止しました");
  }
  return blob;
}

export async function exportAndDownload(options) {
  const format = FORMATS.find((f) => f.mime === options.mime) || FORMATS[0];
  const blob = await exportVideo(options);
  download(blob, `${safeFilename(getState().name)}.${format.ext}`);
  return blob;
}

/** 現在のフレームを PNG で保存 */
export function snapshotPNG() {
  const project = getState();
  const canvas = document.createElement("canvas");
  canvas.width = project.width;
  canvas.height = project.height;
  drawFrame(canvas.getContext("2d", { alpha: false }), player.getTime(), project);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) download(blob, `${safeFilename(project.name)}_${Math.round(player.getTime() * 100)}.png`);
      resolve(blob);
    }, "image/png");
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
