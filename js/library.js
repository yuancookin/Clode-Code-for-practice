import { formatTime, formatBytes, el } from "./utils.js";
import {
  getState,
  addMedia,
  removeMedia,
  addClip,
  addAudio,
  createVideoClip,
  createAudioClip,
  updateProject,
  totalDuration,
} from "./store.js";
import { probeFile, attachSource, hasSource, kindOf } from "./media.js";
import { showToast } from "./toast.js";

const list = document.getElementById("media-list");
const countPill = document.getElementById("library-count");
const relinkInput = document.createElement("input");
relinkInput.type = "file";
relinkInput.hidden = true;
document.body.appendChild(relinkInput);

const KIND_LABEL = { video: "🎞 動画", audio: "🎵 音声", image: "🖼 画像" };

/** 取り込み → メディア登録 → タイムラインへ配置 */
export async function importFiles(fileList, { autoPlace = true } = {}) {
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
      added.push(media);
      if (autoPlace) placeOnTimeline(media);
    } catch (error) {
      showToast(error.message || "読み込みに失敗しました");
    }
  }
  if (added.length) {
    const first = added[0];
    if (first.kind === "video" && first.width && first.height) matchProjectToMedia(first);
    showToast(`${added.length} 個のメディアを追加しました`);
  }
  render();
  return added;
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

function relink(media) {
  relinkInput.accept = `${media.kind}/*`;
  relinkInput.onchange = async () => {
    const file = relinkInput.files?.[0];
    relinkInput.value = "";
    if (!file) return;
    try {
      const { url, meta } = await probeFile(file);
      attachSource(media.id, url);
      Object.assign(media, { ...meta, id: media.id, missing: false });
      showToast(`${meta.name} を再リンクしました`);
      render();
    } catch (error) {
      showToast(error.message || "再リンクに失敗しました");
    }
  };
  relinkInput.click();
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
    info.appendChild(el("span", "media-name", item.name));
    const meta = [];
    if (item.duration) meta.push(formatTime(item.duration));
    if (item.width) meta.push(`${item.width}×${item.height}`);
    if (!meta.length && item.size) meta.push(formatBytes(item.size));
    const metaEl = el("span", "media-meta", meta.join(" ・ "));
    metaEl.title = `${KIND_LABEL[item.kind] || item.kind} ・ ${formatBytes(item.size)}`;
    info.appendChild(metaEl);
    if (missing) info.appendChild(el("span", "media-warn", "ファイルを再リンクしてください"));
    node.appendChild(info);

    const actions = el("div", "media-actions");
    if (missing) {
      const relinkBtn = el("button", "icon-btn", "🔗");
      relinkBtn.type = "button";
      relinkBtn.title = "ファイルを再リンク";
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
      showToast(`${item.name} を削除しました`);
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
