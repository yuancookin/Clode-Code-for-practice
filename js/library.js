import { formatTime, formatBytes, el } from "./utils.js";
import {
  getState,
  addMedia,
  patchMedia,
  removeMedia,
  addClip,
  addAudio,
  createVideoClip,
  createAudioClip,
  updateProject,
  totalDuration,
} from "./store.js";
import { probeFile, attachSource, hasSource, kindOf, sourceUrl } from "./media.js";
import * as api from "./api.js";
import { showToast } from "./toast.js";

const list = document.getElementById("media-list");
const countPill = document.getElementById("library-count");
const relinkInput = document.createElement("input");
relinkInput.type = "file";
relinkInput.hidden = true;
document.body.appendChild(relinkInput);

const KIND_LABEL = { video: "🎞 動画", audio: "🎵 音声", image: "🖼 画像" };

/** mediaId -> { state: "uploading" | "downloading" | "error", progress, message } */
const transfers = new Map();

/** 取り込み → メディア登録 → タイムラインへ配置 → （設定していれば）サーバーへ保存 */
export async function importFiles(fileList, { autoPlace = true, upload = true } = {}) {
  const files = [...fileList].filter((file) => kindOf(file));
  if (!files.length) {
    showToast("対応していないファイル形式です");
    return [];
  }
  const added = [];
  for (const file of files) {
    try {
      const { url, meta } = await probeFile(file);
      const media = addMedia(meta);
      attachSource(media.id, url);
      added.push({ media, file });
      if (autoPlace) placeOnTimeline(media);
    } catch (error) {
      showToast(error.message || "読み込みに失敗しました");
    }
  }
  if (added.length) {
    const first = added[0].media;
    if (first.kind === "video" && first.width && first.height) matchProjectToMedia(first);
    showToast(`${added.length} 個のメディアを追加しました`);
  }
  render();
  if (upload && added.length && api.isAutoSync() && api.isOnline()) {
    uploadToServer(added); // 完了を待たずに編集を続けられるようにする
  }
  return added.map((entry) => entry.media);
}

/** 最初の動画に合わせて出力解像度を自動設定する */
function matchProjectToMedia(media) {
  const project = getState();
  if (project.clips.length > 1) return;
  const long = Math.max(media.width, media.height);
  const scale = long > 1920 ? 1920 / long : 1;
  updateProject(
    {
      width: Math.round((media.width * scale) / 2) * 2,
      height: Math.round((media.height * scale) / 2) * 2,
    },
    { label: "解像度を自動設定" }
  );
}

export function placeOnTimeline(media) {
  if (media.kind === "audio") {
    addAudio(createAudioClip(media, 0));
  } else {
    addClip(createVideoClip(media));
  }
}

/* ------------------------------------------------------------------ */
/* サーバー連携                                                        */
/* ------------------------------------------------------------------ */

/** 取り込んだファイルをまとめてアップロードし、保存先を覚える */
export async function uploadToServer(pairs) {
  const targets = pairs.filter(({ media }) => media && !media.remoteUrl);
  if (!targets.length) return;
  targets.forEach(({ media }) => transfers.set(media.id, { state: "uploading", progress: 0 }));
  render();

  try {
    const result = await api.uploadFiles(
      targets.map((entry) => entry.file),
      {
        onProgress: (ratio) => {
          targets.forEach(({ media }) => transfers.set(media.id, { state: "uploading", progress: ratio }));
          render();
        },
      }
    );

    // 同名ファイルがあっても取り違えないよう、順番を保った待ち行列で突き合わせる
    const queues = new Map();
    result.files.forEach((entry) => {
      const key = entry.original_name;
      if (!queues.has(key)) queues.set(key, []);
      queues.get(key).push(entry);
    });

    let saved = 0;
    targets.forEach(({ media, file }) => {
      const entry = queues.get(file.name)?.shift();
      transfers.delete(media.id);
      if (entry) {
        patchMedia(media.id, { remoteUrl: entry.url, remoteName: entry.name });
        saved += 1;
      } else {
        const rejected = result.rejected.find((item) => item.original_name === file.name);
        transfers.set(media.id, { state: "error", message: rejected?.reason || "サーバーに保存できませんでした" });
      }
    });

    if (saved) showToast(`${saved} 個の素材をサーバーに保存しました`);
    const failed = result.rejected.length;
    if (failed) showToast(`${failed} 個はサーバーに保存できませんでした（ローカルでは使えます）`);
  } catch (error) {
    targets.forEach(({ media }) =>
      transfers.set(media.id, { state: "error", message: error.message || "アップロードに失敗しました" })
    );
    showToast(error.message || "アップロードに失敗しました");
  }
  render();
}

/** remoteUrl を持つ素材をサーバーから取り直して再リンクする */
export async function restoreFromServer() {
  const targets = getState().media.filter((media) => media.remoteUrl && !hasSource(media.id));
  if (!targets.length) return 0;

  let restored = 0;
  for (const media of targets) {
    transfers.set(media.id, { state: "downloading" });
    render();
    try {
      const file = await api.downloadFile({
        url: media.remoteUrl,
        original_name: media.name,
        content_type: media.type,
      });
      const { url, meta } = await probeFile(file);
      attachSource(media.id, url);
      transfers.delete(media.id);
      patchMedia(media.id, {
        missing: false,
        thumbnail: meta.thumbnail || media.thumbnail,
        width: media.width || meta.width,
        height: media.height || meta.height,
      });
      restored += 1;
    } catch (error) {
      transfers.set(media.id, { state: "error", message: error.message || "サーバーから取得できません" });
    }
  }
  render();
  return restored;
}

/** サーバー上の素材をプロジェクトに読み込む */
export async function importFromServer(entry) {
  const existing = getState().media.find((media) => media.remoteName === entry.name);
  if (existing && hasSource(existing.id)) {
    placeOnTimeline(existing);
    showToast(`${existing.name} をタイムラインに追加しました`);
    return existing;
  }
  showToast(`${entry.original_name || entry.name} を読み込んでいます...`);
  try {
    const file = await api.downloadFile(entry);
    const { url, meta } = await probeFile(file);
    const media = addMedia({ ...meta, remoteUrl: entry.url, remoteName: entry.name });
    attachSource(media.id, url);
    placeOnTimeline(media);
    showToast(`${media.name} を読み込みました`);
    return media;
  } catch (error) {
    showToast(error.message || "読み込みに失敗しました");
    return null;
  }
}

/** 手元にあるがサーバー未保存の素材をまとめてアップロードする */
export async function syncPending() {
  const pending = getState().media.filter((media) => !media.remoteUrl && hasSource(media.id));
  if (!pending.length) {
    showToast("サーバーに未保存の素材はありません");
    return;
  }
  const entries = [];
  for (const media of pending) {
    try {
      // メモリ上の Blob URL から File を作り直してアップロードする
      const blob = await fetch(sourceUrl(media.id)).then((response) => response.blob());
      entries.push({ media, file: new File([blob], media.name, { type: media.type || blob.type }) });
    } catch {
      transfers.set(media.id, { state: "error", message: "ファイルを読み込めませんでした" });
    }
  }
  await uploadToServer(entries);
}

/* ------------------------------------------------------------------ */

function relink(media) {
  relinkInput.accept = `${media.kind}/*`;
  relinkInput.onchange = async () => {
    const file = relinkInput.files?.[0];
    relinkInput.value = "";
    if (!file) return;
    try {
      const { url, meta } = await probeFile(file);
      attachSource(media.id, url);
      patchMedia(media.id, { ...meta, id: media.id, missing: false });
      showToast(`${meta.name} を再リンクしました`);
      if (api.isAutoSync() && api.isOnline() && !media.remoteUrl) {
        uploadToServer([{ media, file }]);
      }
    } catch (error) {
      showToast(error.message || "再リンクに失敗しました");
    }
  };
  relinkInput.click();
}

function syncBadge(media, missing) {
  const transfer = transfers.get(media.id);
  if (transfer?.state === "uploading") {
    return el("span", "sync-badge uploading", `↑ ${Math.round((transfer.progress || 0) * 100)}%`);
  }
  if (transfer?.state === "downloading") {
    return el("span", "sync-badge uploading", "↓ 取得中");
  }
  if (transfer?.state === "error") {
    const badge = el("span", "sync-badge error", "⚠ 未同期");
    badge.title = transfer.message || "";
    return badge;
  }
  if (media.remoteUrl) {
    const badge = el("span", "sync-badge synced", "☁");
    badge.title = missing ? "サーバーに保存済み（読み込み待ち）" : "サーバーに保存済み";
    return badge;
  }
  if (api.isOnline()) {
    const badge = el("span", "sync-badge local", "端末のみ");
    badge.title = "このファイルはサーバーに保存されていません";
    return badge;
  }
  return null;
}

export function render() {
  const media = getState().media;
  countPill.textContent = String(media.length);
  list.innerHTML = "";

  media.forEach((item) => {
    const missing = item.missing || !hasSource(item.id);
    const node = el("li", "media-item" + (missing ? " missing" : ""));

    const thumb = el("div", "media-thumb");
    if (item.thumbnail && !missing) thumb.style.backgroundImage = `url("${item.thumbnail}")`;
    else thumb.textContent = item.kind === "audio" ? "🎵" : item.kind === "image" ? "🖼" : "🎞";
    node.appendChild(thumb);

    const info = el("div", "media-info");
    const nameRow = el("div", "media-name-row");
    nameRow.appendChild(el("span", "media-name", item.name));
    const badge = syncBadge(item, missing);
    if (badge) nameRow.appendChild(badge);
    info.appendChild(nameRow);

    const meta = [];
    if (item.duration) meta.push(formatTime(item.duration));
    if (item.width) meta.push(`${item.width}×${item.height}`);
    if (!meta.length && item.size) meta.push(formatBytes(item.size));
    const metaEl = el("span", "media-meta", meta.join(" ・ "));
    metaEl.title = `${KIND_LABEL[item.kind] || item.kind} ・ ${formatBytes(item.size)}`;
    info.appendChild(metaEl);
    if (missing && !item.remoteUrl) info.appendChild(el("span", "media-warn", "ファイルを再リンクしてください"));
    node.appendChild(info);

    const actions = el("div", "media-actions");
    if (missing) {
      const relinkBtn = el("button", "icon-btn", "🔗");
      relinkBtn.type = "button";
      relinkBtn.title = item.remoteUrl ? "サーバーから取得できないときは手動で再リンク" : "ファイルを再リンク";
      relinkBtn.addEventListener("click", () => relink(item));
      actions.appendChild(relinkBtn);
    } else {
      const addBtn = el("button", "icon-btn", "＋");
      addBtn.type = "button";
      addBtn.title = "タイムラインの末尾に追加";
      addBtn.addEventListener("click", () => {
        if (item.kind === "audio") addAudio(createAudioClip(item, totalDuration()));
        else addClip(createVideoClip(item));
        showToast(`${item.name} を追加しました`);
      });
      actions.appendChild(addBtn);
    }
    const removeBtn = el("button", "icon-btn danger", "🗑");
    removeBtn.type = "button";
    removeBtn.title = "ライブラリから削除（使用中のクリップも消えます）";
    removeBtn.addEventListener("click", () => {
      removeMedia(item.id);
      transfers.delete(item.id);
      showToast(`${item.name} を削除しました（サーバー上のファイルは残ります）`);
    });
    actions.appendChild(removeBtn);
    node.appendChild(actions);

    node.addEventListener("dblclick", () => {
      if (!missing) placeOnTimeline(item);
      else relink(item);
    });
    list.appendChild(node);
  });
}
