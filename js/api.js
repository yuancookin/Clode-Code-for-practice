/**
 * バックエンド (FastAPI) との通信。
 * 同じサーバーからエディタを配信している場合は設定不要で動く。
 */

const BASE_KEY = "clipstudio.api-base";
const SYNC_KEY = "clipstudio.api-sync";

let base = localStorage.getItem(BASE_KEY) ?? "";
let autoSync = localStorage.getItem(SYNC_KEY) !== "off";
let online = false;
let info = null;

export function getBase() {
  return base;
}

export function setBase(value) {
  base = String(value || "").trim().replace(/\/+$/, "");
  localStorage.setItem(BASE_KEY, base);
}

export function isAutoSync() {
  return autoSync;
}

export function setAutoSync(value) {
  autoSync = !!value;
  localStorage.setItem(SYNC_KEY, autoSync ? "on" : "off");
}

export function isOnline() {
  return online;
}

export function getInfo() {
  return info;
}

export function apiUrl(path) {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** サーバーが返す相対 URL を、取得できる絶対 URL に変換する */
export function assetUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return apiUrl(url);
}

/** 接続確認。成功すると /api の情報を返す */
export async function ping({ timeout = 4000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(apiUrl("/api"), { signal: controller.signal });
    if (!response.ok) throw new Error(`サーバーが ${response.status} を返しました`);
    info = await response.json();
    online = true;
    return info;
  } catch (error) {
    online = false;
    info = null;
    throw new Error(friendly(error));
  } finally {
    clearTimeout(timer);
  }
}

/** 複数ファイルをアップロードする。進捗を見るため XHR を使う */
export function uploadFiles(files, { onProgress } = {}) {
  const list = [...files];
  return new Promise((resolve, reject) => {
    if (!list.length) {
      resolve({ files: [], rejected: [] });
      return;
    }
    const form = new FormData();
    list.forEach((file) => form.append("files", file, file.name));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl("/upload"));
    xhr.responseType = "json";
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      const body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) {
        online = true;
        resolve({ files: body?.files || [], rejected: body?.rejected || [] });
        return;
      }
      reject(new Error(errorMessage(body, xhr.status)));
    });
    xhr.addEventListener("error", () => {
      online = false;
      reject(new Error("サーバーに接続できませんでした"));
    });
    xhr.addEventListener("abort", () => reject(new Error("アップロードを中止しました")));
    xhr.send(form);
  });
}

/** サーバーに保存されている素材の一覧 */
export async function listFiles() {
  const response = await fetch(apiUrl("/files"));
  if (!response.ok) throw new Error(`一覧を取得できませんでした (${response.status})`);
  online = true;
  const body = await response.json();
  return body.files || [];
}

/** サーバー上のファイルを File として取得する（エディタに読み込むため） */
export async function downloadFile(entry) {
  const response = await fetch(assetUrl(entry.url));
  if (!response.ok) throw new Error(`${entry.name} を取得できませんでした (${response.status})`);
  const blob = await response.blob();
  const type = blob.type || entry.content_type || "";
  return new File([blob], entry.original_name || entry.name, { type });
}

function errorMessage(body, status) {
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (detail?.message) {
    const reasons = (detail.rejected || []).map((r) => `${r.original_name}: ${r.reason}`);
    return reasons.length ? `${detail.message}（${reasons.join(" / ")}）` : detail.message;
  }
  return `アップロードに失敗しました (${status})`;
}

function friendly(error) {
  if (error.name === "AbortError") return "サーバーの応答がありません";
  return error.message || "サーバーに接続できませんでした";
}
