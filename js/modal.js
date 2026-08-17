import {
  getState,
  addTask,
  updateTask,
  deleteTask,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
} from "./store.js";
import { showToast } from "./toast.js";
import { el } from "./dom-helpers.js";

const overlay = document.getElementById("task-modal");
const titleLabel = document.getElementById("modal-title-label");
const fieldTitle = document.getElementById("field-title");
const fieldNotes = document.getElementById("field-notes");
const fieldStatus = document.getElementById("field-status");
const fieldPriority = document.getElementById("field-priority");
const fieldDueDate = document.getElementById("field-due-date");
const fieldDueTime = document.getElementById("field-due-time");
const fieldRecurrence = document.getElementById("field-recurrence");
const fieldPinned = document.getElementById("field-pinned");
const fieldTags = document.getElementById("field-tags");
const subtaskList = document.getElementById("subtask-list");
const subtaskForm = document.getElementById("subtask-form");
const subtaskInput = document.getElementById("subtask-input");
const subtaskProgress = document.getElementById("subtask-progress");
const modalMeta = document.getElementById("modal-meta");
const btnClose = document.getElementById("modal-close");
const btnCancel = document.getElementById("modal-cancel");
const btnSave = document.getElementById("modal-save");
const btnDelete = document.getElementById("modal-delete");

let currentId = null;

function selectedTagIds() {
  return [...fieldTags.querySelectorAll("input:checked")].map((i) => i.value);
}

function renderTagCheckboxes(activeIds) {
  fieldTags.innerHTML = "";
  const { tags } = getState();
  if (tags.length === 0) {
    fieldTags.appendChild(el("span", "muted", "タグがありません（メニューから追加できます）"));
    return;
  }
  tags.forEach((tag) => {
    const label = el("label", "tag-check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = tag.id;
    input.checked = activeIds.includes(tag.id);
    const dot = el("span", "dot");
    dot.style.background = tag.color;
    label.appendChild(input);
    label.appendChild(dot);
    label.appendChild(document.createTextNode(tag.name));
    fieldTags.appendChild(label);
  });
}

function renderSubtasks(task) {
  subtaskList.innerHTML = "";
  const subtasks = task ? task.subtasks : [];
  subtasks.forEach((s) => {
    const li = el("li", "subtask-row" + (s.done ? " done" : ""));
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = s.done;
    checkbox.addEventListener("change", () => {
      if (currentId) {
        toggleSubtask(currentId, s.id);
        renderSubtasks(getState().tasks.find((t) => t.id === currentId));
      }
    });
    const text = el("span", "subtask-text", s.text);
    const removeBtn = el("button", "remove-tag", "✕");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "サブタスクを削除");
    removeBtn.addEventListener("click", () => {
      if (currentId) {
        deleteSubtask(currentId, s.id);
        renderSubtasks(getState().tasks.find((t) => t.id === currentId));
      }
    });
    li.appendChild(checkbox);
    li.appendChild(text);
    li.appendChild(removeBtn);
    subtaskList.appendChild(li);
  });
  const done = subtasks.filter((s) => s.done).length;
  subtaskProgress.textContent = subtasks.length ? `(${done}/${subtasks.length})` : "";
}

export function openTaskModal(task, defaults = {}) {
  currentId = task ? task.id : null;
  titleLabel.textContent = task ? "タスクの詳細" : "新しいタスク";
  fieldTitle.value = task ? task.title : defaults.title || "";
  fieldNotes.value = task ? task.notes : "";
  fieldStatus.value = task ? task.status : "todo";
  fieldPriority.value = task ? task.priority : defaults.priority || "none";
  fieldDueDate.value = task ? task.dueDate || "" : defaults.dueDate || "";
  fieldDueTime.value = task ? task.dueTime || "" : "";
  fieldRecurrence.value = task && task.recurrence ? task.recurrence.freq : "";
  fieldPinned.checked = task ? !!task.pinned : false;
  renderTagCheckboxes(task ? task.tagIds : defaults.tagIds || []);
  renderSubtasks(task);
  subtaskInput.value = "";
  btnDelete.classList.toggle("hidden", !task);

  if (task) {
    const created = new Date(task.createdAt).toLocaleString("ja-JP");
    const updated = new Date(task.updatedAt).toLocaleString("ja-JP");
    modalMeta.textContent = `作成: ${created} / 更新: ${updated}`;
  } else {
    modalMeta.textContent = "";
  }

  overlay.classList.remove("hidden");
  fieldTitle.focus();
}

export function closeTaskModal() {
  overlay.classList.add("hidden");
  currentId = null;
}

function save() {
  const title = fieldTitle.value.trim();
  if (!title) {
    fieldTitle.focus();
    return;
  }
  const patch = {
    title,
    notes: fieldNotes.value,
    status: fieldStatus.value,
    priority: fieldPriority.value,
    dueDate: fieldDueDate.value || null,
    dueTime: fieldDueTime.value || null,
    recurrence: fieldRecurrence.value ? { freq: fieldRecurrence.value } : null,
    pinned: fieldPinned.checked,
    tagIds: selectedTagIds(),
  };
  if (fieldStatus.value === "done") {
    patch.completedAt = Date.now();
  } else {
    patch.completedAt = null;
  }

  if (currentId) {
    updateTask(currentId, patch);
  } else {
    const task = addTask({ title, dueDate: patch.dueDate, tagIds: patch.tagIds, priority: patch.priority });
    updateTask(task.id, patch);
  }
  closeTaskModal();
}

btnClose.addEventListener("click", closeTaskModal);
btnCancel.addEventListener("click", closeTaskModal);
btnSave.addEventListener("click", save);
btnDelete.addEventListener("click", () => {
  if (currentId) {
    deleteTask(currentId);
    showToast("タスクを削除しました", { undoable: true });
  }
  closeTaskModal();
});

overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeTaskModal();
});

subtaskForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = subtaskInput.value.trim();
  if (!value) return;
  if (!currentId) {
    // creating a brand-new task: save it first so subtasks have a home
    const title = fieldTitle.value.trim() || "無題のタスク";
    const task = addTask({ title });
    currentId = task.id;
    titleLabel.textContent = "タスクの詳細";
    btnDelete.classList.remove("hidden");
  }
  addSubtask(currentId, value);
  subtaskInput.value = "";
  renderSubtasks(getState().tasks.find((t) => t.id === currentId));
});

export function isModalOpen() {
  return !overlay.classList.contains("hidden");
}
