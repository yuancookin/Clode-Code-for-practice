import { getState, addTag, deleteTag } from "./store.js";
import { el } from "./dom-helpers.js";

const overlay = document.getElementById("tag-modal");
const closeBtn = document.getElementById("tag-modal-close");
const list = document.getElementById("tag-list");
const form = document.getElementById("tag-form");
const nameInput = document.getElementById("tag-name");
const colorInput = document.getElementById("tag-color");

export function renderTagManager() {
  const { tags, tasks } = getState();
  list.innerHTML = "";
  if (tags.length === 0) {
    list.appendChild(el("li", "tag-chip", "タグがまだありません"));
    return;
  }
  tags.forEach((tag) => {
    const count = tasks.filter((t) => t.tagIds.includes(tag.id)).length;
    const chip = el("li", "tag-chip");
    const dot = el("span", "dot");
    dot.style.background = tag.color;
    const name = el("span", null, `${tag.name} (${count})`);
    const removeBtn = el("button", "remove-tag", "✕");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `${tag.name} を削除`);
    removeBtn.addEventListener("click", () => deleteTag(tag.id));
    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(removeBtn);
    list.appendChild(chip);
  });
}

export function openTagModal() {
  renderTagManager();
  overlay.classList.remove("hidden");
}

export function closeTagModal() {
  overlay.classList.add("hidden");
}

closeBtn.addEventListener("click", closeTagModal);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeTagModal();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  addTag(name, colorInput.value);
  nameInput.value = "";
  renderTagManager();
});

export function isTagModalOpen() {
  return !overlay.classList.contains("hidden");
}
