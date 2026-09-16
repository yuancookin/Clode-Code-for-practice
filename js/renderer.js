import { clamp } from "./utils.js";
import { clipsAt, textsAt, clipDuration, DEFAULT_FILTERS } from "./store.js";
import { getClipElement, isReady } from "./media.js";

export function filterCSS(filters = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const parts = [];
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
  if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
  if (f.blur) parts.push(`blur(${f.blur}px)`);
  if (f.grayscale) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.sepia) parts.push(`sepia(${f.sepia}%)`);
  return parts.length ? parts.join(" ") : "none";
}

/** フェードイン / フェードアウトを考慮した不透明度 */
export function clipAlpha(item, time) {
  const clip = item.clip;
  const t = time - item.start;
  let alpha = 1;
  if (clip.fadeIn > 0) alpha = Math.min(alpha, clamp(t / clip.fadeIn, 0, 1));
  if (clip.fadeOut > 0) alpha = Math.min(alpha, clamp((item.dur - t) / clip.fadeOut, 0, 1));
  return alpha;
}

/** 音声クリップの再生位置に応じた音量 */
export function audioLevel(clip, time) {
  const dur = clipDuration(clip);
  const t = time - clip.start;
  let level = clip.volume ?? 1;
  if (clip.fadeIn > 0) level *= clamp(t / clip.fadeIn, 0, 1);
  if (clip.fadeOut > 0) level *= clamp((dur - t) / clip.fadeOut, 0, 1);
  return clamp(level, 0, 1);
}

function sourceSize(element) {
  if (element instanceof HTMLImageElement) {
    return { w: element.naturalWidth, h: element.naturalHeight };
  }
  return { w: element.videoWidth, h: element.videoHeight };
}

function fitRect(sw, sh, cw, ch, fit) {
  if (!sw || !sh) return { w: cw, h: ch };
  if (fit === "stretch") return { w: cw, h: ch };
  const scale = fit === "cover" ? Math.max(cw / sw, ch / sh) : Math.min(cw / sw, ch / sh);
  return { w: sw * scale, h: sh * scale };
}

function drawClip(ctx, item, time, options = {}) {
  const { alpha = 1, dx = 0, scale = 1, clipRect = null } = options;
  if (alpha <= 0.001) return;
  const element = getClipElement(item.clip);
  if (!isReady(element)) return;
  const { w: sw, h: sh } = sourceSize(element);
  if (!sw || !sh) return;

  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const clip = item.clip;
  const tr = clip.transform || {};
  const base = fitRect(sw, sh, cw, ch, clip.fit || "contain");

  ctx.save();
  if (clipRect) {
    ctx.beginPath();
    ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
    ctx.clip();
  }
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.filter = filterCSS(clip.filters);
  ctx.translate(cw / 2 + (tr.offsetX || 0) * cw + dx, ch / 2 + (tr.offsetY || 0) * ch);
  if (tr.rotate) ctx.rotate(((tr.rotate || 0) * Math.PI) / 180);
  const zoom = (tr.scale || 1) * scale;
  ctx.scale(zoom * (tr.flipH ? -1 : 1), zoom * (tr.flipV ? -1 : 1));
  try {
    ctx.drawImage(element, -base.w / 2, -base.h / 2, base.w, base.h);
  } catch {
    /* デコード途中のフレームは描けないことがある */
  }
  ctx.restore();
}

function drawTransition(ctx, prev, cur, time) {
  const p = clamp((time - cur.start) / Math.max(0.0001, cur.trans), 0, 1);
  const type = cur.clip.transition?.type || "crossfade";
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const prevAlpha = clipAlpha(prev, time);
  const curAlpha = clipAlpha(cur, time);

  switch (type) {
    case "fadeblack": {
      if (p < 0.5) drawClip(ctx, prev, time, { alpha: prevAlpha * (1 - p * 2) });
      else drawClip(ctx, cur, time, { alpha: curAlpha * (p - 0.5) * 2 });
      break;
    }
    case "wipe": {
      drawClip(ctx, prev, time, { alpha: prevAlpha });
      drawClip(ctx, cur, time, {
        alpha: curAlpha,
        clipRect: { x: 0, y: 0, w: cw * p, h: ch },
      });
      break;
    }
    case "slide": {
      drawClip(ctx, prev, time, { alpha: prevAlpha, dx: -cw * p });
      drawClip(ctx, cur, time, { alpha: curAlpha, dx: cw * (1 - p) });
      break;
    }
    case "zoom": {
      drawClip(ctx, prev, time, { alpha: prevAlpha, scale: 1 + p * 0.25 });
      drawClip(ctx, cur, time, { alpha: curAlpha * p, scale: 0.7 + p * 0.3 });
      break;
    }
    default: {
      drawClip(ctx, prev, time, { alpha: prevAlpha });
      drawClip(ctx, cur, time, { alpha: curAlpha * p });
    }
  }
}

/* ------------------------------------------------------------------ */
/* テキストオーバーレイ                                                */
/* ------------------------------------------------------------------ */

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  text.split("\n").forEach((raw) => {
    if (ctx.measureText(raw).width <= maxWidth) {
      lines.push(raw);
      return;
    }
    let current = "";
    for (const char of raw) {
      if (ctx.measureText(current + char).width > maxWidth && current) {
        lines.push(current);
        current = char;
      } else {
        current += char;
      }
    }
    if (current) lines.push(current);
  });
  return lines.length ? lines : [""];
}

const requestedFonts = new Set();

/** Web フォント (Yomogi) は使われたタイミングで読み込む */
function ensureFont(family, weight) {
  if (!family || requestedFonts.has(family) || !document.fonts?.load) return;
  if (!family.includes("Yomogi")) return;
  requestedFonts.add(family);
  document.fonts.load(`${weight || 700} 40px ${family}`).catch(() => {});
}

function drawText(ctx, overlay, time) {
  ensureFont(overlay.font, overlay.weight);
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const t = time - overlay.start;
  const dur = overlay.duration;
  const fontSize = Math.max(8, (overlay.size / 100) * ch);
  const inDur = Math.min(0.4, dur / 3);

  let alpha = 1;
  let offsetY = 0;
  let scale = 1;
  let content = overlay.text;

  switch (overlay.animation) {
    case "fade":
      alpha = Math.min(clamp(t / inDur, 0, 1), clamp((dur - t) / inDur, 0, 1));
      break;
    case "slide": {
      const p = clamp(t / inDur, 0, 1);
      offsetY = (1 - p) * fontSize * 0.9;
      alpha = Math.min(p, clamp((dur - t) / inDur, 0, 1));
      break;
    }
    case "pop": {
      const p = clamp(t / inDur, 0, 1);
      scale = 0.75 + 0.25 * p + Math.sin(p * Math.PI) * 0.08;
      alpha = Math.min(p, clamp((dur - t) / inDur, 0, 1));
      break;
    }
    case "typewriter": {
      const speed = Math.min(dur * 0.7, 2.2);
      const shown = Math.ceil(clamp(t / speed, 0, 1) * overlay.text.length);
      content = overlay.text.slice(0, shown);
      break;
    }
    default:
      break;
  }
  if (alpha <= 0.001) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${overlay.weight || 700} ${fontSize}px ${overlay.font || "sans-serif"}`;
  ctx.textAlign = overlay.align || "center";
  ctx.textBaseline = "middle";

  const lines = wrapLines(ctx, content, cw * 0.9);
  const lineHeight = fontSize * 1.25;
  const blockHeight = lines.length * lineHeight;
  const x = overlay.x * cw;
  const y = overlay.y * ch + offsetY;

  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (overlay.background && !/rgba\(.*,\s*0\)$/.test(overlay.background)) {
    const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
    const padX = fontSize * 0.45;
    const padY = fontSize * 0.3;
    let boxX = -widest / 2;
    if (ctx.textAlign === "left") boxX = 0;
    if (ctx.textAlign === "right") boxX = -widest;
    ctx.fillStyle = overlay.background;
    ctx.fillRect(boxX - padX, -blockHeight / 2 - padY, widest + padX * 2, blockHeight + padY * 2);
  }

  if (overlay.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = fontSize * 0.25;
    ctx.shadowOffsetY = fontSize * 0.06;
  }
  ctx.fillStyle = overlay.color || "#ffffff";
  lines.forEach((line, i) => {
    ctx.fillText(line, 0, -blockHeight / 2 + lineHeight * (i + 0.5));
  });
  ctx.restore();
}

/* ------------------------------------------------------------------ */

export function drawFrame(ctx, time, project) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.fillStyle = project.background || "#000000";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const items = clipsAt(time);
  if (items.length === 1) {
    drawClip(ctx, items[0], time, { alpha: clipAlpha(items[0], time) });
  } else if (items.length >= 2) {
    const cur = items[items.length - 1];
    const prev = items[items.length - 2];
    drawTransition(ctx, prev, cur, time);
  }

  textsAt(time).forEach((overlay) => drawText(ctx, overlay, time));
}
