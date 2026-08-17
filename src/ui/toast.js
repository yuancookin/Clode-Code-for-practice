import { h } from "../utils.js";

const MAX_TOASTS = 3;

function root() {
  return document.getElementById("toast-root");
}

/**
 * 画面下部の通知。取り消しボタンつきにもできる。
 * toast("削除しました", { actionLabel: "取り消す", onAction: () => store.undo() })
 */
export function toast(message, { actionLabel, onAction, duration = 5000, tone = "default" } = {}) {
  const container = root();
  if (!container) return () => {};

  while (container.children.length >= MAX_TOASTS) {
    container.firstElementChild.remove();
  }

  let timer = 0;
  const el = h("div", { class: `toast toast-${tone}`, role: "status" }, h("span", { class: "toast-message", text: message }));

  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 180);
  };

  if (actionLabel && onAction) {
    el.appendChild(
      h("button", {
        type: "button",
        class: "toast-action",
        text: actionLabel,
        onclick: () => {
          onAction();
          dismiss();
        },
      })
    );
  }

  el.appendChild(
    h("button", { type: "button", class: "toast-close", "aria-label": "閉じる", text: "✕", onclick: dismiss })
  );

  container.appendChild(el);
  timer = setTimeout(dismiss, duration);
  return dismiss;
}
