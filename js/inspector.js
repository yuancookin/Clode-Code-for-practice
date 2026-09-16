import { clamp, formatTime, el } from "./utils.js";
import {
  getState,
  getSelection,
  getSelected,
  getMedia,
  updateItem,
  updateProject,
  removeItem,
  duplicateItem,
  splitAt,
  layout,
  clipDuration,
  beginBatch,
  endBatch,
  DEFAULT_FILTERS,
  FILTER_PRESETS,
  TRANSITIONS,
  ASPECT_PRESETS,
} from "./store.js";
import * as player from "./player.js";

const title = document.getElementById("inspector-title");
const body = document.getElementById("inspector-body");

/** スライダー操作中はパネルを組み直さない（ドラッグが途切れるため） */
let editing = 0;

export function isEditing() {
  return editing > 0;
}

/* ---------------- フォーム部品 ---------------- */

function section(label) {
  const wrap = el("section", "insp-section");
  wrap.appendChild(el("h3", null, label));
  return wrap;
}

function row(labelText, control, valueText) {
  const wrap = el("label", "insp-row");
  const head = el("span", "insp-label", labelText);
  if (valueText != null) head.appendChild(el("b", "insp-value", valueText));
  wrap.appendChild(head);
  wrap.appendChild(control);
  return wrap;
}

function range({ label, value, min, max, step, format, onInput }) {
  const input = document.createElement("input");
  input.type = "range";
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  const wrap = row(label, input, format ? format(value) : value);
  const valueEl = wrap.querySelector(".insp-value");
  let active = false;
  const activate = () => {
    if (active) return;
    active = true;
    editing += 1;
    beginBatch(label);
  };
  input.addEventListener("pointerdown", activate);
  input.addEventListener("keydown", activate);
  input.addEventListener("input", () => {
    activate();
    const next = Number(input.value);
    valueEl.textContent = format ? format(next) : next;
    onInput(next);
  });
  const finish = () => {
    if (!active) return;
    active = false;
    editing = Math.max(0, editing - 1);
    endBatch();
  };
  input.addEventListener("change", finish);
  input.addEventListener("pointerup", finish);
  input.addEventListener("blur", finish);
  return wrap;
}

function selectBox({ label, value, options, onChange }) {
  const input = document.createElement("select");
  options.forEach(([val, text]) => {
    const option = document.createElement("option");
    option.value = val;
    option.textContent = text;
    if (String(val) === String(value)) option.selected = true;
    input.appendChild(option);
  });
  input.addEventListener("change", () => onChange(input.value));
  return row(label, input);
}

function colorBox({ label, value, onChange }) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  return row(label, input);
}

function textBox({ label, value, onChange, multiline = false, type = "text" }) {
  const input = document.createElement(multiline ? "textarea" : "input");
  if (!multiline) input.type = type;
  if (multiline) input.rows = 3;
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  return row(label, input);
}

function checkbox({ label, value, onChange }) {
  const wrap = el("label", "insp-check");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!value;
  input.addEventListener("change", () => onChange(input.checked));
  wrap.appendChild(input);
  wrap.appendChild(document.createTextNode(label));
  return wrap;
}

function buttonRow(buttons) {
  const wrap = el("div", "insp-buttons");
  buttons.forEach(({ label, onClick, className = "ghost" }) => {
    const button = el("button", `btn ${className}`, label);
    button.type = "button";
    button.addEventListener("click", onClick);
    wrap.appendChild(button);
  });
  return wrap;
}

function chips(values, current, onPick) {
  const wrap = el("div", "chips");
  values.forEach(([value, label]) => {
    const chip = el("button", "chip" + (String(value) === String(current) ? " active" : ""), label);
    chip.type = "button";
    chip.addEventListener("click", () => onPick(value));
    wrap.appendChild(chip);
  });
  return wrap;
}

/* ---------------- 各種インスペクタ ---------------- */

function projectInspector() {
  const project = getState();
  title.textContent = "プロジェクト設定";
  const frag = document.createDocumentFragment();

  const basics = section("出力設定");
  basics.appendChild(
    selectBox({
      label: "解像度プリセット",
      value: `${project.width}x${project.height}`,
      options: [
        [`${project.width}x${project.height}`, `現在 (${project.width}×${project.height})`],
        ...ASPECT_PRESETS.map((p) => [`${p.width}x${p.height}`, p.label]),
      ],
      onChange: (value) => {
        const [width, height] = value.split("x").map(Number);
        updateProject({ width, height }, { label: "解像度を変更" });
      },
    })
  );
  basics.appendChild(
    selectBox({
      label: "フレームレート",
      value: project.fps,
      options: [[24, "24 fps"], [30, "30 fps"], [60, "60 fps"]],
      onChange: (value) => updateProject({ fps: Number(value) }, { label: "fps を変更" }),
    })
  );
  basics.appendChild(
    colorBox({
      label: "背景色",
      value: project.background,
      onChange: (value) => updateProject({ background: value }, { label: "背景色" }),
    })
  );
  frag.appendChild(basics);

  const stats = section("プロジェクト情報");
  const list = el("dl", "stat-list");
  const rows = [
    ["映像クリップ", `${project.clips.length} 個`],
    ["音声クリップ", `${project.audio.length} 個`],
    ["テロップ", `${project.texts.length} 個`],
    ["合計時間", formatTime(layout().length ? layout()[layout().length - 1].end : 0)],
  ];
  rows.forEach(([key, value]) => {
    list.appendChild(el("dt", null, key));
    list.appendChild(el("dd", null, value));
  });
  stats.appendChild(list);
  stats.appendChild(el("p", "hint", "クリップを選ぶと、ここで色調・速度・トランジションを調整できます。"));
  frag.appendChild(stats);
  return frag;
}

function clipInspector(clip) {
  const media = getMedia(clip.mediaId);
  const item = layout().find((entry) => entry.clip.id === clip.id);
  title.textContent = media ? media.name : "クリップ";
  const frag = document.createDocumentFragment();

  const basics = section("基本");
  const info = el("p", "hint");
  info.textContent = `${formatTime(clipDuration(clip))} / 素材 ${formatTime(media?.duration || 0)}`;
  basics.appendChild(info);
  basics.appendChild(
    range({
      label: "再生速度",
      value: clip.speed,
      min: 0.25,
      max: 4,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}x`,
      onInput: (v) => updateItem("clip", clip.id, { speed: v }, { batch: true }),
    })
  );
  basics.appendChild(
    chips(
      [[0.5, "0.5x"], [1, "1x"], [1.5, "1.5x"], [2, "2x"], [4, "4x"]],
      clip.speed,
      (v) => updateItem("clip", clip.id, { speed: Number(v) }, { label: "速度" })
    )
  );
  if (clip.kind !== "image") {
    basics.appendChild(
      range({
        label: "音量",
        value: clip.volume,
        min: 0,
        max: 1,
        step: 0.01,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => updateItem("clip", clip.id, { volume: v }, { batch: true }),
      })
    );
  }
  basics.appendChild(
    selectBox({
      label: "表示方法",
      value: clip.fit,
      options: [["contain", "全体を表示 (余白あり)"], ["cover", "画面いっぱい (切り取り)"], ["stretch", "引き伸ばし"]],
      onChange: (value) => updateItem("clip", clip.id, { fit: value }, { label: "表示方法" }),
    })
  );
  frag.appendChild(basics);

  const fade = section("フェード / トランジション");
  fade.appendChild(
    range({
      label: "フェードイン",
      value: clip.fadeIn,
      min: 0,
      max: 3,
      step: 0.1,
      format: (v) => `${v.toFixed(1)}s`,
      onInput: (v) => updateItem("clip", clip.id, { fadeIn: v }, { batch: true }),
    })
  );
  fade.appendChild(
    range({
      label: "フェードアウト",
      value: clip.fadeOut,
      min: 0,
      max: 3,
      step: 0.1,
      format: (v) => `${v.toFixed(1)}s`,
      onInput: (v) => updateItem("clip", clip.id, { fadeOut: v }, { batch: true }),
    })
  );
  if (item && item.index > 0) {
    fade.appendChild(
      selectBox({
        label: "前のクリップとの切り替え",
        value: clip.transition?.type || "none",
        options: Object.entries(TRANSITIONS),
        onChange: (value) =>
          updateItem(
            "clip",
            clip.id,
            { transition: { type: value, duration: clip.transition?.duration || 0.5 } },
            { label: "トランジション" }
          ),
      })
    );
    if ((clip.transition?.type || "none") !== "none") {
      fade.appendChild(
        range({
          label: "切り替え時間",
          value: clip.transition.duration,
          min: 0.1,
          max: 3,
          step: 0.1,
          format: (v) => `${v.toFixed(1)}s`,
          onInput: (v) =>
            updateItem(
              "clip",
              clip.id,
              { transition: { ...clip.transition, duration: v } },
              { batch: true }
            ),
        })
      );
    }
  } else {
    fade.appendChild(el("p", "hint", "2番目以降のクリップでトランジションを設定できます。"));
  }
  frag.appendChild(fade);

  const color = section("色調");
  color.appendChild(
    chips(
      Object.entries(FILTER_PRESETS).map(([key, preset]) => [key, preset.label]),
      clip.preset,
      (key) => {
        const preset = FILTER_PRESETS[key];
        updateItem(
          "clip",
          clip.id,
          { preset: key, filters: { ...DEFAULT_FILTERS, ...preset.values } },
          { label: "フィルタープリセット" }
        );
      }
    )
  );
  const filterDefs = [
    ["brightness", "明るさ", 0, 200, 1, "%"],
    ["contrast", "コントラスト", 0, 200, 1, "%"],
    ["saturate", "彩度", 0, 300, 1, "%"],
    ["hue", "色相", 0, 360, 1, "°"],
    ["blur", "ぼかし", 0, 20, 0.5, "px"],
    ["grayscale", "モノクロ", 0, 100, 1, "%"],
    ["sepia", "セピア", 0, 100, 1, "%"],
  ];
  filterDefs.forEach(([key, label, min, max, step, unit]) => {
    color.appendChild(
      range({
        label,
        value: clip.filters[key] ?? DEFAULT_FILTERS[key],
        min,
        max,
        step,
        format: (v) => `${v}${unit}`,
        onInput: (v) =>
          updateItem(
            "clip",
            clip.id,
            { preset: "custom", filters: { ...clip.filters, [key]: v } },
            { batch: true }
          ),
      })
    );
  });
  frag.appendChild(color);

  const transform = section("変形");
  const tr = clip.transform || {};
  transform.appendChild(
    range({
      label: "拡大",
      value: tr.scale ?? 1,
      min: 0.2,
      max: 3,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) =>
        updateItem("clip", clip.id, { transform: { ...tr, scale: v } }, { batch: true }),
    })
  );
  transform.appendChild(
    range({
      label: "左右位置",
      value: tr.offsetX ?? 0,
      min: -0.5,
      max: 0.5,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) =>
        updateItem("clip", clip.id, { transform: { ...tr, offsetX: v } }, { batch: true }),
    })
  );
  transform.appendChild(
    range({
      label: "上下位置",
      value: tr.offsetY ?? 0,
      min: -0.5,
      max: 0.5,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) =>
        updateItem("clip", clip.id, { transform: { ...tr, offsetY: v } }, { batch: true }),
    })
  );
  transform.appendChild(
    range({
      label: "回転",
      value: tr.rotate ?? 0,
      min: -180,
      max: 180,
      step: 1,
      format: (v) => `${v}°`,
      onInput: (v) =>
        updateItem("clip", clip.id, { transform: { ...tr, rotate: v } }, { batch: true }),
    })
  );
  const flips = el("div", "insp-check-row");
  flips.appendChild(
    checkbox({
      label: "左右反転",
      value: tr.flipH,
      onChange: (v) => updateItem("clip", clip.id, { transform: { ...tr, flipH: v } }, { label: "反転" }),
    })
  );
  flips.appendChild(
    checkbox({
      label: "上下反転",
      value: tr.flipV,
      onChange: (v) => updateItem("clip", clip.id, { transform: { ...tr, flipV: v } }, { label: "反転" }),
    })
  );
  transform.appendChild(flips);
  transform.appendChild(
    buttonRow([
      {
        label: "変形をリセット",
        onClick: () =>
          updateItem(
            "clip",
            clip.id,
            { transform: { scale: 1, offsetX: 0, offsetY: 0, rotate: 0, flipH: false, flipV: false } },
            { label: "変形リセット" }
          ),
      },
    ])
  );
  frag.appendChild(transform);

  const actions = section("操作");
  actions.appendChild(
    buttonRow([
      { label: "✂ 分割", onClick: () => splitAt(player.getTime()) },
      { label: "⧉ 複製", onClick: () => duplicateItem("clip", clip.id) },
      { label: "🗑 削除", className: "ghost danger", onClick: () => removeItem("clip", clip.id) },
    ])
  );
  frag.appendChild(actions);
  return frag;
}

function audioInspector(clip) {
  const media = getMedia(clip.mediaId);
  title.textContent = media ? media.name : "音声クリップ";
  const frag = document.createDocumentFragment();

  const basics = section("音声");
  basics.appendChild(el("p", "hint", `${formatTime(clip.start)} から ${formatTime(clipDuration(clip))}`));
  basics.appendChild(
    range({
      label: "音量",
      value: clip.volume,
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => updateItem("audio", clip.id, { volume: v }, { batch: true }),
    })
  );
  basics.appendChild(
    range({
      label: "フェードイン",
      value: clip.fadeIn,
      min: 0,
      max: 5,
      step: 0.1,
      format: (v) => `${v.toFixed(1)}s`,
      onInput: (v) => updateItem("audio", clip.id, { fadeIn: v }, { batch: true }),
    })
  );
  basics.appendChild(
    range({
      label: "フェードアウト",
      value: clip.fadeOut,
      min: 0,
      max: 5,
      step: 0.1,
      format: (v) => `${v.toFixed(1)}s`,
      onInput: (v) => updateItem("audio", clip.id, { fadeOut: v }, { batch: true }),
    })
  );
  basics.appendChild(
    range({
      label: "開始位置",
      value: clip.start,
      min: 0,
      max: Math.max(10, clip.start + 30),
      step: 0.1,
      format: (v) => formatTime(v),
      onInput: (v) => updateItem("audio", clip.id, { start: v }, { batch: true }),
    })
  );
  frag.appendChild(basics);

  const actions = section("操作");
  actions.appendChild(
    buttonRow([
      { label: "▶ ここから再生", onClick: () => { player.seek(clip.start); player.play(); } },
      { label: "⧉ 複製", onClick: () => duplicateItem("audio", clip.id) },
      { label: "🗑 削除", className: "ghost danger", onClick: () => removeItem("audio", clip.id) },
    ])
  );
  frag.appendChild(actions);
  return frag;
}

function textInspector(overlay) {
  title.textContent = "テロップ";
  const frag = document.createDocumentFragment();

  const content = section("内容");
  content.appendChild(
    textBox({
      label: "テキスト",
      value: overlay.text,
      multiline: true,
      onChange: (value) => updateItem("text", overlay.id, { text: value }, { label: "テキスト" }),
    })
  );
  content.appendChild(
    selectBox({
      label: "フォント",
      value: overlay.font,
      options: [
        ["sans-serif", "ゴシック"],
        ["serif", "明朝"],
        ["Yomogi, sans-serif", "手書き (Yomogi)"],
        ["monospace", "等幅"],
      ],
      onChange: (value) => updateItem("text", overlay.id, { font: value }, { label: "フォント" }),
    })
  );
  content.appendChild(
    range({
      label: "文字サイズ",
      value: overlay.size,
      min: 2,
      max: 25,
      step: 0.5,
      format: (v) => `${v}%`,
      onInput: (v) => updateItem("text", overlay.id, { size: v }, { batch: true }),
    })
  );
  content.appendChild(
    selectBox({
      label: "太さ",
      value: overlay.weight,
      options: [[400, "標準"], [700, "太字"], [900, "極太"]],
      onChange: (value) => updateItem("text", overlay.id, { weight: Number(value) }, { label: "太さ" }),
    })
  );
  content.appendChild(
    colorBox({
      label: "文字色",
      value: overlay.color,
      onChange: (value) => updateItem("text", overlay.id, { color: value }, { label: "文字色" }),
    })
  );
  content.appendChild(
    selectBox({
      label: "背景",
      value: overlay.background,
      options: [
        ["rgba(0,0,0,0)", "なし"],
        ["rgba(0,0,0,0.55)", "黒 (半透明)"],
        ["rgba(0,0,0,0.85)", "黒 (濃い)"],
        ["rgba(255,255,255,0.85)", "白"],
        ["rgba(124,77,255,0.8)", "パープル"],
      ],
      onChange: (value) => updateItem("text", overlay.id, { background: value }, { label: "背景" }),
    })
  );
  content.appendChild(
    checkbox({
      label: "影をつける",
      value: overlay.shadow,
      onChange: (value) => updateItem("text", overlay.id, { shadow: value }, { label: "影" }),
    })
  );
  frag.appendChild(content);

  const position = section("位置と動き");
  position.appendChild(
    selectBox({
      label: "揃え",
      value: overlay.align,
      options: [["left", "左"], ["center", "中央"], ["right", "右"]],
      onChange: (value) => updateItem("text", overlay.id, { align: value }, { label: "揃え" }),
    })
  );
  position.appendChild(
    range({
      label: "横位置",
      value: overlay.x,
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => updateItem("text", overlay.id, { x: v }, { batch: true }),
    })
  );
  position.appendChild(
    range({
      label: "縦位置",
      value: overlay.y,
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => updateItem("text", overlay.id, { y: v }, { batch: true }),
    })
  );
  position.appendChild(
    selectBox({
      label: "アニメーション",
      value: overlay.animation,
      options: [
        ["none", "なし"],
        ["fade", "フェード"],
        ["slide", "スライドイン"],
        ["pop", "ポップ"],
        ["typewriter", "タイプライター"],
      ],
      onChange: (value) => updateItem("text", overlay.id, { animation: value }, { label: "アニメーション" }),
    })
  );
  position.appendChild(
    range({
      label: "表示時間",
      value: overlay.duration,
      min: 0.3,
      max: 20,
      step: 0.1,
      format: (v) => `${v.toFixed(1)}s`,
      onInput: (v) => updateItem("text", overlay.id, { duration: v }, { batch: true }),
    })
  );
  frag.appendChild(position);

  const actions = section("操作");
  actions.appendChild(
    buttonRow([
      { label: "⟲ 再生位置へ移動", onClick: () => updateItem("text", overlay.id, { start: clamp(player.getTime(), 0, Number.MAX_SAFE_INTEGER) }, { label: "位置を合わせる" }) },
      { label: "⧉ 複製", onClick: () => duplicateItem("text", overlay.id) },
      { label: "🗑 削除", className: "ghost danger", onClick: () => removeItem("text", overlay.id) },
    ])
  );
  frag.appendChild(actions);
  return frag;
}

let lastKey = "";

export function render() {
  if (editing > 0) return;
  const selection = getSelection();
  const selected = getSelected();
  const key = selection ? `${selection.type}:${selection.id}` : "project";
  const scrollTop = key === lastKey ? body.scrollTop : 0;
  lastKey = key;
  body.innerHTML = "";
  if (!selection || !selected) {
    body.appendChild(projectInspector());
  } else if (selection.type === "clip") {
    body.appendChild(clipInspector(selected));
  } else if (selection.type === "audio") {
    body.appendChild(audioInspector(selected));
  } else {
    body.appendChild(textInspector(selected));
  }
  body.scrollTop = scrollTop;
}
