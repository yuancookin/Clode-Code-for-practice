import { undo } from "./store.js";

const toastEl = document.getElementById("toast");
const messageEl = document.getElementById("toast-message");
const undoBtn = document.getElementById("toast-undo");

let hideTimer = null;

export function showToast(message, { undoable = false } = {}) {
  messageEl.textContent = message;
  undoBtn.classList.toggle("hidden", !undoable);
  toastEl.classList.remove("hidden");
  toastEl.classList.add("show");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  toastEl.classList.remove("show");
  setTimeout(() => toastEl.classList.add("hidden"), 200);
}

undoBtn.addEventListener("click", () => {
  undo();
  hideToast();
});
