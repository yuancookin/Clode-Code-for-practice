const toastEl = document.getElementById("toast");
const messageEl = document.getElementById("toast-message");
const actionBtn = document.getElementById("toast-undo");

let hideTimer = null;
let action = null;

export function showToast(message, { actionLabel = "", onAction = null, duration = 4000 } = {}) {
  messageEl.textContent = message;
  action = onAction;
  actionBtn.textContent = actionLabel || "元に戻す";
  actionBtn.classList.toggle("hidden", !onAction);
  toastEl.classList.remove("hidden");
  requestAnimationFrame(() => toastEl.classList.add("show"));
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideToast, duration);
}

export function hideToast() {
  toastEl.classList.remove("show");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toastEl.classList.add("hidden"), 200);
}

actionBtn.addEventListener("click", () => {
  if (action) action();
  hideToast();
});
