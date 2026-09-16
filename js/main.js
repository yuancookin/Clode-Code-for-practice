import { formatTime, clamp } from "./utils.js";
import {
  getState,
  getSelection,
  getSelected,
  subscribe,
  select,
  undo,
  redo,
  canUndo,
  canRedo,
  removeItem,
  duplicateItem,
  splitAt,
  addText,
  createText,
  updateItem,
  updateProject,
  totalDuration,
  loadFromStorage,
  flushPersist,
  serialize,
  deserialize,
  resetProject,
} from "./store.js";
import { pruneElements, onElementCreated, createSampleClip } from "./media.js";
import { register as registerAudioElement, setMaster, ensureContext } from "./audio.js";
import * as player from "./player.js";
import * as timeline from "./timeline.js";
import * as inspector from "./inspector.js";
import * as library from "./library.js";
import { supportedFormats, exportAndDownload, cancelExport, isExporting, snapshotPNG } from "./export.js";
import { showToast } from "./toast.js";

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* テーマ                                                              */
/* ------------------------------------------------------------------ */

const THEME_KEY = "clipstudio.theme";

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  document.querySelector('meta[name="theme-color"]').content =
    theme === "dark" ? "#12131a" : "#f4f4fa";
}

applyTheme(localStorage.getItem(THEME_KEY) || "dark");
$("btn-theme").addEventListener("click", () => {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});

/* ------------------------------------------------------------------ */
/* メディア読み込み                                                    */
/* ------------------------------------------------------------------ */

const fileInput = $("file-input");
const openPicker = () => fileInput.click();
$("btn-import").addEventListener("click", openPicker);
$("btn-import-2").addEventListener("click", openPicker);
fileInput.addEventListener("change", async () => {
  const files = fileInput.files;
  if (files?.length) await library.importFiles(files);
  fileInput.value = "";
});

const dropzone = $("dropzone");
["dragenter", "dragover"].forEach((type) => {
  window.addEventListener(type, (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dropzone.classList.add("active");
  });
});
["dragleave", "drop"].forEach((type) => {
  window.addEventListener(type, (event) => {
    if (type === "drop") event.preventDefault();
    if (event.relatedTarget) return;
    dropzone.classList.remove("active");
  });
});
window.addEventListener("drop", async (event) => {
  const files = event.dataTransfer?.files;
  if (files?.length) await library.importFiles(files);
});

onElementCreated((element) => registerAudioElement(element));

/* ------------------------------------------------------------------ */
/* トランスポート                                                      */
/* ------------------------------------------------------------------ */

const playBtn = $("btn-play");
playBtn.addEventListener("click", () => {
  ensureContext();
  player.setRate(1);
  player.toggle();
});
$("btn-to-start").addEventListener("click", () => player.seek(0));
$("btn-to-end").addEventListener("click", () => player.seek(totalDuration()));
$("btn-prev-frame").addEventListener("click", () => player.step(-1));
$("btn-next-frame").addEventListener("click", () => player.step(1));
$("btn-loop").addEventListener("click", (event) => {
  const next = !player.isLooping();
  player.setLooping(next);
  event.currentTarget.setAttribute("aria-pressed", String(next));
  event.currentTarget.classList.toggle("active", next);
});

const volumeSlider = $("master-volume");
const muteBtn = $("btn-mute");
let muted = false;
function applyVolume() {
  setMaster(Number(volumeSlider.value) / 100, muted);
  muteBtn.textContent = muted || Number(volumeSlider.value) === 0 ? "🔇" : "🔊";
  muteBtn.setAttribute("aria-pressed", String(muted));
}
volumeSlider.addEventListener("input", applyVolume);
muteBtn.addEventListener("click", () => {
  muted = !muted;
  applyVolume();
});
applyVolume();

/* ------------------------------------------------------------------ */
/* タイムライン操作                                                    */
/* ------------------------------------------------------------------ */

$("btn-split").addEventListener("click", () => {
  if (!splitAt(player.getTime())) showToast("再生位置に分割できるクリップがありません");
});
$("btn-duplicate").addEventListener("click", () => {
  const selection = getSelection();
  if (!selection) return showToast("複製するクリップを選択してください");
  duplicateItem(selection.type, selection.id);
});
$("btn-delete").addEventListener("click", deleteSelection);
$("btn-add-text").addEventListener("click", () => {
  addText(createText(player.getTime()));
  showToast("テロップを追加しました");
});
$("btn-add-transition").addEventListener("click", () => {
  const selected = getSelected();
  const selection = getSelection();
  if (!selection || selection.type !== "clip") {
    return showToast("映像クリップを選択してください");
  }
  const index = getState().clips.findIndex((c) => c.id === selection.id);
  if (index <= 0) return showToast("2番目以降のクリップに設定できます");
  const current = selected.transition?.type || "none";
  updateItem(
    "clip",
    selection.id,
    {
      transition: {
        type: current === "none" ? "crossfade" : "none",
        duration: selected.transition?.duration || 0.5,
      },
    },
    { label: "トランジション" }
  );
});
$("btn-zoom-in").addEventListener("click", () => timeline.zoomBy(1.3));
$("btn-zoom-out").addEventListener("click", () => timeline.zoomBy(1 / 1.3));
$("btn-zoom-fit").addEventListener("click", () => timeline.zoomToFit());

function deleteSelection() {
  const selection = getSelection();
  if (!selection) return showToast("削除するクリップを選択してください");
  removeItem(selection.type, selection.id);
  showToast("削除しました", { actionLabel: "元に戻す", onAction: () => undo() });
}

$("btn-undo").addEventListener("click", () => {
  if (!undo()) showToast("これ以上戻せません");
});
$("btn-redo").addEventListener("click", () => {
  if (!redo()) showToast("やり直す操作がありません");
});

/* ------------------------------------------------------------------ */
/* プロジェクト                                                        */
/* ------------------------------------------------------------------ */

const nameInput = $("project-name");
nameInput.addEventListener("change", () =>
  updateProject({ name: nameInput.value.trim() || "無題のプロジェクト" }, { label: "名前" })
);

const menuPanel = $("menu-panel");
$("btn-menu").addEventListener("click", (event) => {
  event.stopPropagation();
  menuPanel.classList.toggle("hidden");
});
document.addEventListener("click", () => menuPanel.classList.add("hidden"));

$("btn-project-new").addEventListener("click", () => {
  if (!confirm("現在のプロジェクトを破棄して新規作成しますか？")) return;
  resetProject();
  player.seek(0);
  showToast("新しいプロジェクトを作成しました", { actionLabel: "元に戻す", onAction: () => undo() });
});

$("btn-project-save").addEventListener("click", () => {
  const blob = new Blob([serialize()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${getState().name || "project"}.clipstudio.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast("プロジェクトを保存しました（素材ファイルは含まれません）");
});

const projectInput = $("project-input");
$("btn-project-load").addEventListener("click", () => projectInput.click());
projectInput.addEventListener("change", async () => {
  const file = projectInput.files?.[0];
  projectInput.value = "";
  if (!file) return;
  try {
    deserialize(await file.text());
    player.seek(0);
    showToast("プロジェクトを読み込みました。素材を再リンクしてください");
  } catch (error) {
    showToast(error.message || "読み込みに失敗しました");
  }
});

$("btn-snapshot").addEventListener("click", async () => {
  await snapshotPNG();
  showToast("現在のフレームを PNG で保存しました");
});

$("btn-sample").addEventListener("click", async () => {
  showToast("サンプル素材を生成しています...", { duration: 8000 });
  try {
    const files = [
      await createSampleClip({ label: "OPENING", hue: 265, seconds: 3 }),
      await createSampleClip({ label: "SCENE 2", hue: 165, seconds: 3 }),
    ];
    await library.importFiles(files);
    showToast("サンプル素材を追加しました");
  } catch (error) {
    showToast(error.message || "サンプル素材を生成できませんでした");
  }
});

/* ------------------------------------------------------------------ */
/* 書き出しダイアログ                                                  */
/* ------------------------------------------------------------------ */

const exportDialog = $("export-dialog");
const formatSelect = $("export-format");
const exportNote = $("export-note");
const exportProgress = $("export-progress");
const exportBar = $("export-bar");
const exportStatus = $("export-status");
const exportStart = $("export-start");
const exportCancel = $("export-cancel");

function fillFormats() {
  const formats = supportedFormats();
  formatSelect.innerHTML = "";
  formats.forEach((format) => {
    const option = document.createElement("option");
    option.value = format.mime;
    option.textContent = format.label;
    formatSelect.appendChild(option);
  });
  exportStart.disabled = formats.length === 0;
  if (!formats.length) {
    exportNote.textContent = "このブラウザは動画の書き出しに対応していません。Chrome / Edge / Firefox の最新版をお試しください。";
  }
}
fillFormats();

function updateExportNote() {
  const total = totalDuration();
  exportNote.textContent = `書き出しは実時間で行われます（約 ${formatTime(total)}）。完了までタブを開いたままにしてください。`;
}

$("btn-export").addEventListener("click", () => {
  updateExportNote();
  exportProgress.classList.add("hidden");
  exportBar.style.width = "0%";
  exportStart.disabled = supportedFormats().length === 0 || totalDuration() <= 0.05;
  if (totalDuration() <= 0.05) exportNote.textContent = "タイムラインにクリップを追加してください。";
  exportDialog.showModal();
});

exportCancel.addEventListener("click", () => {
  if (isExporting()) {
    cancelExport();
    exportStatus.textContent = "中止しています...";
    return;
  }
  exportDialog.close();
});

exportStart.addEventListener("click", async () => {
  if (isExporting()) return;
  ensureContext();
  exportProgress.classList.remove("hidden");
  exportStart.disabled = true;
  exportCancel.textContent = "中止";
  const total = totalDuration();
  try {
    await exportAndDownload({
      mime: formatSelect.value,
      scale: Number($("export-scale").value),
      fps: Number($("export-fps").value),
      bitrate: Number($("export-quality").value),
      onProgress: (ratio, time) => {
        exportBar.style.width = `${Math.round(ratio * 100)}%`;
        exportStatus.textContent = `書き出し中... ${formatTime(time)} / ${formatTime(total)}`;
      },
    });
    exportBar.style.width = "100%";
    exportStatus.textContent = "完了しました";
    showToast("動画を書き出しました");
  } catch (error) {
    exportStatus.textContent = error.message || "書き出しに失敗しました";
    showToast(error.message || "書き出しに失敗しました");
  } finally {
    exportStart.disabled = false;
    exportCancel.textContent = "閉じる";
  }
});

/* ------------------------------------------------------------------ */
/* ショートカット                                                      */
/* ------------------------------------------------------------------ */

$("btn-shortcuts").addEventListener("click", () => $("shortcuts-dialog").showModal());

function isTyping(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  );
}

let shuttle = 1;

window.addEventListener("keydown", (event) => {
  if (isTyping(event.target) || document.querySelector("dialog[open]")) return;
  const meta = event.ctrlKey || event.metaKey;

  if (meta && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (meta && event.key.toLowerCase() === "d") {
    event.preventDefault();
    const selection = getSelection();
    if (selection) duplicateItem(selection.type, selection.id);
    return;
  }
  if (meta) return;

  switch (event.key) {
    case " ":
      event.preventDefault();
      player.setRate(1);
      player.toggle();
      break;
    case "ArrowLeft":
      event.preventDefault();
      player.step(event.shiftKey ? -getState().fps : -1);
      break;
    case "ArrowRight":
      event.preventDefault();
      player.step(event.shiftKey ? getState().fps : 1);
      break;
    case "Home":
      player.seek(0);
      break;
    case "End":
      player.seek(totalDuration());
      break;
    case "Delete":
    case "Backspace":
      event.preventDefault();
      deleteSelection();
      break;
    case "Escape":
      select(null, null);
      break;
    case "+":
    case "=":
      timeline.zoomBy(1.3);
      break;
    case "-":
      timeline.zoomBy(1 / 1.3);
      break;
    case "?":
      $("shortcuts-dialog").showModal();
      break;
    default:
      handleLetterKey(event);
  }
});

function handleLetterKey(event) {
  switch (event.key.toLowerCase()) {
    case "s":
      if (!splitAt(player.getTime())) showToast("再生位置に分割できるクリップがありません");
      break;
    case "t":
      addText(createText(player.getTime()));
      break;
    case "m":
      muted = !muted;
      applyVolume();
      break;
    case "f":
      timeline.zoomToFit();
      break;
    case "l":
      shuttle = player.getRate() > 0 ? clamp(Math.abs(player.getRate()) * 2, 1, 8) : 1;
      player.setRate(shuttle);
      if (!player.isPlaying()) player.play();
      break;
    case "k":
      player.pause();
      player.setRate(1);
      break;
    case "j":
      shuttle = player.getRate() < 0 ? clamp(Math.abs(player.getRate()) * 2, 1, 8) : 1;
      player.setRate(-shuttle);
      if (!player.isPlaying()) player.play();
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* 再描画                                                              */
/* ------------------------------------------------------------------ */

const tcCurrent = $("tc-current");
const tcTotal = $("tc-total");
const stageEmpty = $("stage-empty");
const stage = $("stage");

function syncStageSize() {
  const project = getState();
  stage.style.aspectRatio = `${project.width} / ${project.height}`;
}

player.onTick((time, playing) => {
  tcCurrent.textContent = formatTime(time);
  timeline.updatePlayhead(time);
  playBtn.textContent = playing ? "❚❚" : "▶";
  playBtn.setAttribute("aria-label", playing ? "一時停止" : "再生");
});

subscribe(() => {
  const project = getState();
  if (document.activeElement !== nameInput) nameInput.value = project.name;
  syncStageSize();
  player.resize();
  pruneElements();
  library.render();
  timeline.render();
  inspector.render();
  tcTotal.textContent = formatTime(totalDuration());
  stageEmpty.classList.toggle("hidden", project.clips.length > 0 || project.texts.length > 0);
  $("btn-undo").disabled = !canUndo();
  $("btn-redo").disabled = !canRedo();
});

/* ------------------------------------------------------------------ */
/* 起動                                                                */
/* ------------------------------------------------------------------ */

const restored = loadFromStorage();
syncStageSize();
player.resize();
library.render();
timeline.render();
inspector.render();
timeline.setZoom(60);
tcTotal.textContent = formatTime(totalDuration());
$("btn-undo").disabled = true;
$("btn-redo").disabled = true;

if (restored) {
  showToast("前回のプロジェクトを復元しました。素材ファイルを再リンクしてください", { duration: 7000 });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

window.addEventListener("pagehide", flushPersist);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPersist();
});

window.addEventListener("beforeunload", (event) => {
  flushPersist();
  if (isExporting()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
