import { h } from "../utils.js";

let current = null;

export function closeModal() {
  if (!current) return;
  const { backdrop, lastFocus, onClose } = current;
  current = null;
  backdrop.remove();
  document.removeEventListener("keydown", onKeydown, true);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  onClose?.();
}

function onKeydown(event) {
  if (!current) return;
  if (event.key === "Escape") {
    event.stopPropagation();
    closeModal();
    return;
  }
  if (event.key !== "Tab") return;

  const focusables = current.dialog.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function isModalOpen() {
  return Boolean(current);
}

/**
 * モーダルを開く。既に開いていれば置き換える。
 * @returns {() => void} 閉じる関数
 */
export function openModal(title, content, { wide = false, footer = null, onClose = null } = {}) {
  closeModal();

  const dialog = h(
    "div",
    { class: `modal${wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
    h(
      "header",
      { class: "modal-head" },
      h("h2", { text: title }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "閉じる", text: "✕", onclick: () => closeModal() })
    ),
    h("div", { class: "modal-body" }, content),
    footer ? h("footer", { class: "modal-foot" }, footer) : null
  );

  const backdrop = h(
    "div",
    {
      class: "modal-backdrop",
      onclick: (event) => {
        if (event.target === backdrop) closeModal();
      },
    },
    dialog
  );

  current = { backdrop, dialog, lastFocus: document.activeElement, onClose };
  document.getElementById("modal-root").appendChild(backdrop);
  document.addEventListener("keydown", onKeydown, true);

  const firstInput = dialog.querySelector("input, select, textarea, button");
  firstInput?.focus();

  return closeModal;
}
