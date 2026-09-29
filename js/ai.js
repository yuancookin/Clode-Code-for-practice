/** AI 機能 (/ai/*) のクライアント。API キーはサーバー側にだけ置く。 */

import { apiUrl } from "./api.js";
import { projectSummary } from "./ops.js";

let status = { available: false, transcription: false, model: "" };
/** 直近の文字起こし結果（タイトル生成やハイライト抽出で使い回す） */
let transcript = { mediaId: "", segments: [], captions: [] };

export function getStatus() {
  return status;
}

export function getTranscript() {
  return transcript;
}

export function setTranscript(mediaId, segments, captions) {
  transcript = { mediaId, segments, captions };
}

const NO_BACKEND =
  "AI 機能に接続できません。バックエンド (uvicorn) を起動し、ANTHROPIC_API_KEY を設定してください";

async function call(path, body) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(NO_BACKEND);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // バックエンドが無い（静的配信だけ）の場合は 404 や 501 が返る
    if (!data && [404, 405, 501].includes(response.status)) throw new Error(NO_BACKEND);
    const detail = data?.detail;
    throw new Error(
      typeof detail === "string" ? detail : detail?.message || `AI の呼び出しに失敗しました (${response.status})`
    );
  }
  return data;
}

export async function refreshStatus() {
  try {
    status = await call("/ai/status");
  } catch {
    status = { available: false, transcription: false, model: "" };
  }
  return status;
}

export function edit(instruction) {
  return call("/ai/edit", { instruction, project: projectSummary() });
}

export function titles(tone) {
  return call("/ai/titles", {
    project: projectSummary(),
    tone: tone || null,
    transcript: transcript.segments.map((s) => s.text).join(" ") || null,
  });
}

export function transcribe(media, { language = null, offset = 0, polish = false } = {}) {
  return call("/ai/transcribe", { media, language, offset, polish });
}

export function highlights({ count = 3, targetDuration = 30 } = {}) {
  return call("/ai/highlights", {
    segments: transcript.segments,
    count,
    target_duration: targetDuration,
  });
}
