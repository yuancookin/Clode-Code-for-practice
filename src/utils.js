/**
 * DOM 生成とちょっとした共通処理。
 */

/** 要素を作る。h("div", { class: "x", onclick: fn }, "text", child) */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** SVG 用（名前空間つき） */
export function s(tag, props = null, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        el.setAttribute(key, value === true ? "" : String(value));
      }
    }
  }
  append(el, children);
  return el;
}

function applyProps(el, props) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "text") el.textContent = value;
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
}

function append(el, children) {
  for (const child of children.flat(4)) {
    if (child == null || child === false) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * 子要素を差し替える。
 * 素の replaceChildren は null を文字列 "null" に変換してしまうので、
 * 条件付きの子要素を渡すときは必ずこちらを使う。
 */
export function setChildren(el, ...children) {
  el.replaceChildren(...children.flat(4).filter((child) => child != null && child !== false));
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function debounce(fn, wait = 150) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 望ましい子ノード列に合わせて親を並べ替える（キー付き差分更新）。
 * 既存ノードを使い回すので、大量の行があっても再生成が起きない。
 */
export function reconcile(parent, nodes) {
  let index = 0;
  for (const node of nodes) {
    const current = parent.childNodes[index];
    if (current !== node) {
      parent.insertBefore(node, current || null);
    }
    index += 1;
  }
  while (parent.childNodes.length > nodes.length) {
    parent.removeChild(parent.lastChild);
  }
}

/** ドラッグ中の位置から、挿入先となる要素を求める */
export function getDragAfterElement(container, y, selector) {
  const items = [...container.querySelectorAll(`${selector}:not(.dragging)`)];
  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;
  for (const child of items) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = child;
    }
  }
  return closest;
}

export function downloadFile(filename, content, mime = "application/json") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = "application/json") {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
    input.click();
  });
}

/** CSV の 1 セルを安全に囲む */
export function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 背景色に対して読みやすい文字色（白 or 黒）を返す */
export function readableTextColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#ffffff";
  const int = parseInt(m[1], 16);
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#151513" : "#ffffff";
}

/** hex を rgba() 文字列にする */
export function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(0,0,0,${alpha})`;
  const int = parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

let liveRegion = null;

/** スクリーンリーダー向けの通知 */
export function announce(message) {
  if (!liveRegion) {
    liveRegion = h("div", { class: "sr-only", role: "status", "aria-live": "polite" });
    document.body.appendChild(liveRegion);
  }
  liveRegion.textContent = message;
}
