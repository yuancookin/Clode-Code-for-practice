/**
 * グローバルキーボードショートカット。
 */

import { store } from "../store.js";
import { closeDetail } from "./detail.js";
import { isModalOpen } from "./modal.js";
import { isPaletteOpen, openPalette } from "./palette.js";

const VIEW_KEYS = { 1: "list", 2: "board", 3: "calendar", 4: "stats" };

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function focusRow(direction) {
  const rows = [...document.querySelectorAll(".task-row")];
  if (rows.length === 0) return;
  const current = document.activeElement?.closest?.(".task-row");
  const index = current ? rows.indexOf(current) : -1;
  const next = rows[Math.max(0, Math.min(rows.length - 1, index + direction))] || rows[0];
  next.focus();
}

export function initShortcuts(hooks = {}) {
  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette(hooks);
      return;
    }

    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
      return;
    }

    if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      store.redo();
      return;
    }

    if (isPaletteOpen() || isModalOpen()) return;

    if (event.key === "Escape") {
      if (isEditable(document.activeElement) && document.activeElement.id === "search-input") {
        document.activeElement.value = "";
        store.patchUI({ search: "" });
        document.activeElement.blur();
        return;
      }
      if (store.ui.selection.size > 0) {
        store.clearSelection();
        return;
      }
      if (store.ui.selectedId) {
        closeDetail();
        return;
      }
      if (isEditable(document.activeElement)) document.activeElement.blur();
      return;
    }

    if (isEditable(document.activeElement) || mod || event.altKey) return;

    switch (event.key) {
      case "/":
        event.preventDefault();
        document.getElementById("search-input")?.focus();
        break;
      case "n":
      case "N":
        event.preventDefault();
        document.getElementById("quick-add-input")?.focus();
        break;
      case "?":
        event.preventDefault();
        hooks.openHelp?.();
        break;
      case "j":
        event.preventDefault();
        focusRow(1);
        break;
      case "k":
        event.preventDefault();
        focusRow(-1);
        break;
      case "1":
      case "2":
      case "3":
      case "4":
        event.preventDefault();
        store.patchUI({ view: VIEW_KEYS[event.key] });
        break;
      default:
        break;
    }
  });
}
