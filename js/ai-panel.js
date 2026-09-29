/** AI アシスタントのダイアログ。 */

import { formatTime, el } from "./utils.js";
import { getState, getSelection, getMedia, undo, addText, createText, select, transaction } from "./store.js";
import * as ai from "./ai.js";
import { parseInstruction, SUPPORTED_EXAMPLES } from "./local-commands.js";
import { pickHighlights } from "./local-highlights.js";
import { applyOperations, appendHighlight, mediaTimelineOffset, projectSummary } from "./ops.js";
import * as player from "./player.js";
import { showToast } from "./toast.js";

const $ = (id) => document.getElementById(id);

const dialog = $("ai-dialog");
const statusLine = $("ai-status");
const instruction = $("ai-instruction");
const undoBtn = $("ai-undo");

const EXAMPLES = SUPPORTED_EXAMPLES;
const API_KEY_OPTIN = "clipstudio.ai-allow-api";

let busy = false;
let allowApi = localStorage.getItem(API_KEY_OPTIN) === "on";
let lastInstruction = "";

function apiAllowed() {
  return allowApi && ai.getStatus().available;
}

/** API を使うボタンの有効・無効をまとめて切り替える */
function syncApiButtons() {
  const enabled = apiAllowed();
  ["ai-run-titles", "ai-ask-claude", "ai-run-highlights-ai"].forEach((id) => {
    const button = $(id);
    button.disabled = !enabled;
    button.title = enabled ? "" : "「Claude API を使う」をオンにすると実行できます";
  });
  const polish = $("ai-polish");
  polish.disabled = !enabled;
  if (!enabled) polish.checked = false;
}

/* ---------------- 共通 ---------------- */

function setBusy(button, on, label) {
  busy = on;
  if (!button) return;
  button.disabled = on;
  if (on) {
    button.dataset.label = button.textContent;
    button.textContent = label || "実行中...";
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
}

function resultBox(target) {
  const box = $(target);
  box.innerHTML = "";
  return box;
}

function errorLine(box, message) {
  box.appendChild(el("p", "ai-error", message));
}

function copyButton(text) {
  const button = el("button", "btn ghost", "コピー");
  button.type = "button";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("コピーしました");
    } catch {
      showToast("コピーできませんでした");
    }
  });
  return button;
}

/* ---------------- 状態表示 ---------------- */

export async function refresh() {
  statusLine.textContent = "状態を確認しています...";
  statusLine.className = "server-status";
  const status = await ai.refreshStatus();

  const transcription = status.transcription
    ? "文字起こしはこの端末で実行できます（無料）"
    : "文字起こしは利用できません（ffmpeg と faster-whisper が必要）";

  if (!allowApi) {
    statusLine.textContent = `ローカル機能のみ使用中・API 課金なし ・ ${transcription}`;
    statusLine.className = "server-status";
  } else if (!status.available) {
    statusLine.textContent = status.reason || "Claude API を利用できません（サーバーに ANTHROPIC_API_KEY を設定してください）";
    statusLine.className = "server-status error";
  } else {
    statusLine.textContent = `${status.model} に接続できます ・ ${transcription}`;
    statusLine.className = "server-status online";
  }

  $("ai-run-transcribe").disabled = !status.transcription;
  syncApiButtons();
  fillMediaSelect();
}

function fillMediaSelect() {
  const select = $("ai-media");
  const current = select.value;
  select.innerHTML = "";
  const usable = getState().media.filter((media) => media.remoteName && media.kind !== "image");
  usable.forEach((media) => {
    const option = document.createElement("option");
    option.value = media.remoteName;
    option.dataset.mediaId = media.id;
    option.textContent = media.name;
    select.appendChild(option);
  });
  if (!usable.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "（サーバーに保存済みの動画・音声がありません）";
    select.appendChild(option);
  }
  if (current) select.value = current;
}

/* ---------------- 1. 自然言語で編集 ---------------- */

function renderOperations(box, reply, results) {
  box.appendChild(el("p", "ai-reply", reply));
  if (!results.length) return;
  const list = el("ul", "ai-ops");
  results.forEach((result) => {
    const item = el("li", result.applied ? "applied" : "skipped");
    item.appendChild(el("span", "ai-op-name", result.op));
    item.appendChild(el("span", "ai-op-note", result.message || (result.applied ? "適用しました" : "適用できませんでした")));
    list.appendChild(item);
  });
  box.appendChild(list);
}

/** ローカル解釈を試し、無理なときだけ Claude に回す */
function runEdit() {
  if (busy) return;
  const text = instruction.value.trim();
  if (!text) {
    showToast("指示を入力してください");
    return;
  }
  lastInstruction = text;
  const box = resultBox("ai-edit-result");
  const parsed = parseInstruction(text, editorContext());

  if (!parsed.understood) {
    box.appendChild(el("p", "ai-reply", "この指示はローカルでは解釈できませんでした。"));
    box.appendChild(
      el(
        "p",
        "ai-note",
        apiAllowed()
          ? "「Claude に聞く」を押すと API を使って解釈します（1回あたり数円程度）。"
          : "言い方を変えてみてください（例: 「全体をセピアにして」）。Claude に任せる場合は上の「Claude API を使う」をオンにしてください。"
      )
    );
    $("ai-ask-claude").classList.remove("hidden");
    return;
  }

  const applied = applyOperations(parsed.operations);
  const count = applied.filter((r) => r.applied).length;
  box.appendChild(
    el("p", "ai-reply", `ローカルで解釈しました（API 不使用）: ${parsed.matched.map((m) => m.rule).join(" / ")}`)
  );
  renderOperations(box, "", applied);
  if (parsed.partial) {
    box.appendChild(el("p", "ai-note", `解釈できなかった部分: 「${parsed.leftover}」`));
    $("ai-ask-claude").classList.toggle("hidden", false);
  } else {
    $("ai-ask-claude").classList.add("hidden");
  }
  undoBtn.classList.toggle("hidden", count === 0);
  showToast(count ? `${count} 件の編集を適用しました（無料）` : "適用できる編集はありませんでした");
}

/** 現在のタイムラインの状態（ローカル解釈に渡す） */
function editorContext() {
  const summary = projectSummary();
  const selection = getState().clips.findIndex((clip) => clip.id === (getSelection()?.id || ""));
  return {
    clipCount: summary.clips.length,
    audioCount: summary.audio.length,
    textCount: summary.texts.length,
    selectedIndex: selection >= 0 ? selection + 1 : 0,
    playhead: player.getTime(),
    clips: summary.clips.map((clip) => ({
      sourceStart: clip.source_start,
      sourceEnd: clip.source_end,
      speed: clip.speed,
    })),
  };
}

/** ローカルで解釈できなかったときだけ Claude に投げる */
async function askClaude() {
  if (busy || !apiAllowed()) return;
  const button = $("ai-ask-claude");
  const box = resultBox("ai-edit-result");
  setBusy(button, true, "考えています...");
  box.appendChild(el("p", "ai-loading", "Claude が編集内容を考えています..."));
  try {
    const result = await ai.edit(lastInstruction || instruction.value.trim());
    const applied = applyOperations(result.operations || []);
    box.innerHTML = "";
    renderOperations(box, result.reply || "", applied);
    const count = applied.filter((r) => r.applied).length;
    undoBtn.classList.toggle("hidden", count === 0);
    button.classList.add("hidden");
    showToast(count ? `${count} 件の編集を適用しました` : "適用できる編集はありませんでした");
  } catch (error) {
    box.innerHTML = "";
    errorLine(box, error.message);
  } finally {
    setBusy(button, false);
  }
}

/* ---------------- 2. タイトル・説明文 ---------------- */

async function runTitles() {
  if (busy) return;
  const button = $("ai-run-titles");
  const box = resultBox("ai-titles-result");
  setBusy(button, true, "生成中...");
  box.appendChild(el("p", "ai-loading", "構成を読んでいます..."));
  try {
    const result = await ai.titles($("ai-tone").value.trim());
    box.innerHTML = "";

    const titles = el("div", "ai-block");
    titles.appendChild(el("h4", null, "タイトル案"));
    (result.titles || []).forEach((title) => {
      const row = el("div", "ai-row");
      row.appendChild(el("span", "ai-row-text", title));
      row.appendChild(copyButton(title));
      titles.appendChild(row);
    });
    box.appendChild(titles);

    if (result.description) {
      const description = el("div", "ai-block");
      description.appendChild(el("h4", null, "説明文"));
      description.appendChild(el("p", "ai-paragraph", result.description));
      description.appendChild(copyButton(result.description));
      box.appendChild(description);
    }

    if (result.hashtags?.length) {
      const tags = el("div", "ai-block");
      tags.appendChild(el("h4", null, "ハッシュタグ"));
      tags.appendChild(el("p", "ai-paragraph", result.hashtags.map((t) => `#${t}`).join(" ")));
      box.appendChild(tags);
    }

    if (result.chapters?.length) {
      const chapters = el("div", "ai-block");
      chapters.appendChild(el("h4", null, "チャプター"));
      const text = result.chapters.map((c) => `${formatTime(c.time)} ${c.label}`).join("\n");
      result.chapters.forEach((chapter) => {
        const row = el("div", "ai-row");
        const jump = el("button", "btn ghost", `${formatTime(chapter.time)} ${chapter.label}`);
        jump.type = "button";
        jump.addEventListener("click", () => player.seek(chapter.time));
        row.appendChild(jump);
        chapters.appendChild(row);
      });
      chapters.appendChild(copyButton(text));
      box.appendChild(chapters);
    }

    if (result.captions?.length) {
      const captions = el("div", "ai-block");
      captions.appendChild(el("h4", null, "テロップ案"));
      result.captions.forEach((caption) => {
        const row = el("div", "ai-row");
        row.appendChild(el("span", "ai-row-text", `${formatTime(caption.start)} ${caption.text}`));
        const add = el("button", "btn ghost", "＋ 追加");
        add.type = "button";
        add.addEventListener("click", () => {
          const overlay = createText(caption.start);
          overlay.text = caption.text;
          overlay.duration = caption.duration || 3;
          addText(overlay);
          showToast("テロップを追加しました");
        });
        row.appendChild(add);
        captions.appendChild(row);
      });
      box.appendChild(captions);
    }
  } catch (error) {
    box.innerHTML = "";
    errorLine(box, error.message);
  } finally {
    setBusy(button, false);
  }
}

/* ---------------- 3. 字幕 ---------------- */

async function runTranscribe() {
  if (busy) return;
  const select = $("ai-media");
  const remoteName = select.value;
  if (!remoteName) {
    showToast("先に素材をサーバーへアップロードしてください");
    return;
  }
  const mediaId = select.selectedOptions[0]?.dataset.mediaId || "";
  const offset = mediaId ? mediaTimelineOffset(mediaId) : 0;
  const button = $("ai-run-transcribe");
  const box = resultBox("ai-captions-result");
  setBusy(button, true, "文字起こし中...");
  box.appendChild(el("p", "ai-loading", "音声を書き起こしています（動画の長さによっては数分かかります）..."));

  try {
    const result = await ai.transcribe(remoteName, {
      language: $("ai-language").value || null,
      offset,
      polish: $("ai-polish").checked && apiAllowed(),
    });
    ai.setTranscript(mediaId, result.segments || [], result.captions || []);
    box.innerHTML = "";
    if (!result.captions?.length) {
      errorLine(box, "話し声を検出できませんでした");
      return;
    }
    box.appendChild(
      el(
        "p",
        "ai-reply",
        `${result.captions.length} 個の字幕を作成しました` +
          (result.polished ? "（Claude で整形）" : "（ローカル整形・API 不使用）")
      )
    );
    const list = el("ul", "ai-captions");
    result.captions.forEach((caption) => {
      const item = el("li");
      const time = el("button", "ai-time", formatTime(caption.start));
      time.type = "button";
      time.addEventListener("click", () => player.seek(caption.start));
      item.appendChild(time);
      item.appendChild(el("span", null, caption.text));
      list.appendChild(item);
    });
    box.appendChild(list);
    $("ai-add-captions").classList.remove("hidden");
  } catch (error) {
    box.innerHTML = "";
    errorLine(box, error.message);
  } finally {
    setBusy(button, false);
  }
}

function addCaptions() {
  const { captions } = ai.getTranscript();
  if (!captions.length) return;
  // まとめて 1 回の取り消しで戻せるようにする
  transaction("AI: 字幕を追加", () => {
    captions.forEach((caption) => {
      const overlay = createText(caption.start);
      overlay.text = caption.text;
      overlay.duration = caption.duration;
      overlay.size = 5.5;
      overlay.y = 0.86;
      overlay.animation = "none";
      overlay.background = "rgba(0,0,0,0.55)";
      addText(overlay);
    });
  });
  select(null, null);
  showToast(`${captions.length} 個の字幕をタイムラインに追加しました`, {
    actionLabel: "元に戻す",
    onAction: () => undo(),
  });
}

/* ---------------- 4. ハイライト ---------------- */

function renderHighlights(box, list, media, source) {
  box.innerHTML = "";
  if (!list.length) {
    errorLine(box, "見どころを抽出できませんでした");
    return;
  }
  box.appendChild(el("p", "ai-note", source));
  list.forEach((highlight) => {
    const card = el("div", "ai-highlight");
    const head = el("div", "ai-highlight-head");
    head.appendChild(el("strong", null, highlight.title));
    head.appendChild(
      el("span", "ai-highlight-time", `${formatTime(highlight.start)} - ${formatTime(highlight.end)}`)
    );
    card.appendChild(head);
    card.appendChild(el("p", "ai-paragraph", highlight.reason));
    const actions = el("div", "ai-row");
    const preview = el("button", "btn ghost", "▶ ここから再生");
    preview.type = "button";
    preview.addEventListener("click", () => {
      player.seek(highlight.start);
      player.play();
    });
    actions.appendChild(preview);
    if (media) {
      const add = el("button", "btn ghost", "＋ クリップとして追加");
      add.type = "button";
      add.addEventListener("click", () => {
        appendHighlight(media, highlight);
        showToast(`「${highlight.title}」を追加しました`);
      });
      actions.appendChild(add);
    }
    card.appendChild(actions);
    box.appendChild(card);
  });
}

/** ローカル抽出（発話量から機械的に選ぶ・無料） */
function runLocalHighlights() {
  const { segments, mediaId } = ai.getTranscript();
  const box = resultBox("ai-highlights-result");
  if (!segments.length) {
    errorLine(box, "先に「字幕」タブで文字起こしを実行してください");
    return;
  }
  const list = pickHighlights(segments, {
    count: Number($("ai-highlight-count").value),
    targetDuration: Number($("ai-highlight-duration").value),
  });
  renderHighlights(box, list, getMedia(mediaId), "ローカル抽出（発話量から選定・API 不使用）");
}

/** Claude に内容を読んで選んでもらう（API 使用） */
async function runHighlights() {
  if (busy || !apiAllowed()) return;
  const { segments, mediaId } = ai.getTranscript();
  const box = resultBox("ai-highlights-result");
  if (!segments.length) {
    errorLine(box, "先に「字幕」タブで文字起こしを実行してください");
    return;
  }
  const button = $("ai-run-highlights-ai");
  setBusy(button, true, "抽出中...");
  box.appendChild(el("p", "ai-loading", "見どころを探しています..."));
  try {
    const result = await ai.highlights({
      count: Number($("ai-highlight-count").value),
      targetDuration: Number($("ai-highlight-duration").value),
    });
    renderHighlights(box, result.highlights || [], getMedia(mediaId), "Claude による抽出");
  } catch (error) {
    box.innerHTML = "";
    errorLine(box, error.message);
  } finally {
    setBusy(button, false);
  }
}

/* ---------------- 初期化 ---------------- */

export function init() {
  EXAMPLES.forEach((example) => {
    const chip = el("button", "chip", example);
    chip.type = "button";
    chip.addEventListener("click", () => {
      instruction.value = example;
      instruction.focus();
    });
    $("ai-examples").appendChild(chip);
  });

  document.querySelectorAll(".ai-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".ai-tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".ai-pane").forEach((pane) => {
        pane.classList.toggle("hidden", pane.dataset.pane !== tab.dataset.tab);
      });
    });
  });

  $("btn-ai").addEventListener("click", () => {
    dialog.showModal();
    refresh();
  });
  const optin = $("ai-allow-api");
  optin.checked = allowApi;
  optin.addEventListener("change", () => {
    allowApi = optin.checked;
    localStorage.setItem(API_KEY_OPTIN, allowApi ? "on" : "off");
    showToast(allowApi ? "Claude API を使う設定にしました（課金されます）" : "API を使わない設定にしました");
    refresh();
  });

  $("ai-run-edit").addEventListener("click", runEdit);
  $("ai-ask-claude").addEventListener("click", askClaude);
  $("ai-run-titles").addEventListener("click", runTitles);
  $("ai-run-transcribe").addEventListener("click", runTranscribe);
  $("ai-add-captions").addEventListener("click", addCaptions);
  $("ai-run-highlights").addEventListener("click", runLocalHighlights);
  $("ai-run-highlights-ai").addEventListener("click", runHighlights);
  undoBtn.addEventListener("click", () => {
    undo();
    undoBtn.classList.add("hidden");
    showToast("AI の編集を取り消しました");
  });
  instruction.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runEdit();
  });
}
