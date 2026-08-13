const TODOS_KEY = "todos";
const TAGS_KEY = "tags";

const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const dueInput = document.getElementById("todo-due");
const tagSelect = document.getElementById("todo-tag");
const list = document.getElementById("todo-list");
const itemsLeft = document.getElementById("items-left");
const clearCompletedBtn = document.getElementById("clear-completed");
const filterButtons = document.querySelectorAll(".filter-btn[data-filter]");
const tagFilterSelect = document.getElementById("tag-filter");
const toggleGroupViewBtn = document.getElementById("toggle-group-view");
const toggleTagPanelBtn = document.getElementById("toggle-tag-panel");
const tagPanel = document.getElementById("tag-panel");
const tagList = document.getElementById("tag-list");
const tagForm = document.getElementById("tag-form");
const tagNameInput = document.getElementById("tag-name");
const tagColorInput = document.getElementById("tag-color");

let todos = loadJSON(TODOS_KEY, []);
let tags = loadJSON(TAGS_KEY, []);
let currentFilter = "all";
let tagFilter = "all";
let groupView = false;

function loadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value || fallback;
  } catch {
    return fallback;
  }
}

function saveTodos() {
  localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
}

function saveTags() {
  localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
}

function getTag(id) {
  return tags.find((t) => t.id === id) || null;
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}`;
}

function dueStatus(iso, completed) {
  if (!iso || completed) return null;
  const due = new Date(iso + "T00:00:00");
  const today = todayISO();
  if (due.getTime() < today.getTime()) return "overdue";
  if (due.getTime() === today.getTime()) return "due-today";
  return null;
}

/* ---------- tag select / panel rendering ---------- */

function renderTagOptions() {
  const selectedValue = tagSelect.value;
  tagSelect.innerHTML = '<option value="">タグなし</option>';
  tags.forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag.id;
    opt.textContent = tag.name;
    tagSelect.appendChild(opt);
  });
  if (tags.some((t) => t.id === selectedValue)) {
    tagSelect.value = selectedValue;
  }

  const filterValue = tagFilterSelect.value;
  tagFilterSelect.innerHTML =
    '<option value="all">すべてのグループ</option><option value="none">タグなし</option>';
  tags.forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag.id;
    opt.textContent = tag.name;
    tagFilterSelect.appendChild(opt);
  });
  if (["all", "none", ...tags.map((t) => t.id)].includes(filterValue)) {
    tagFilterSelect.value = filterValue;
  }
}

function renderTagPanel() {
  tagList.innerHTML = "";
  if (tags.length === 0) {
    const empty = document.createElement("li");
    empty.className = "tag-chip";
    empty.textContent = "タグがまだありません";
    tagList.appendChild(empty);
    return;
  }
  tags.forEach((tag) => {
    const chip = document.createElement("li");
    chip.className = "tag-chip";

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = tag.color;

    const name = document.createElement("span");
    name.textContent = tag.name;

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-tag";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `${tag.name} を削除`);
    removeBtn.addEventListener("click", () => deleteTag(tag.id));

    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(removeBtn);
    tagList.appendChild(chip);
  });
}

function addTag(name, color) {
  tags.push({ id: makeId(), name, color });
  saveTags();
  renderTagOptions();
  renderTagPanel();
}

function deleteTag(id) {
  tags = tags.filter((t) => t.id !== id);
  todos.forEach((t) => {
    if (t.tagId === id) t.tagId = null;
  });
  saveTags();
  saveTodos();
  renderTagOptions();
  renderTagPanel();
  render();
}

/* ---------- todo list rendering ---------- */

function matchesFilters(todo) {
  if (currentFilter === "active" && todo.completed) return false;
  if (currentFilter === "completed" && !todo.completed) return false;
  if (tagFilter === "none" && todo.tagId) return false;
  if (tagFilter !== "all" && tagFilter !== "none" && todo.tagId !== tagFilter) return false;
  return true;
}

function dragReorderEnabled() {
  return !groupView && currentFilter === "all" && tagFilter === "all";
}

function render() {
  list.innerHTML = "";
  const filtered = todos.filter(matchesFilters);

  if (filtered.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "タスクがありません";
    list.appendChild(empty);
  } else if (groupView) {
    renderGrouped(filtered);
  } else {
    filtered.forEach((todo) => list.appendChild(createTodoElement(todo)));
  }

  const remaining = todos.filter((t) => !t.completed).length;
  itemsLeft.textContent = `${remaining} 件`;
}

function renderGrouped(filtered) {
  const groups = new Map();
  tags.forEach((tag) => groups.set(tag.id, []));
  groups.set(null, []);

  filtered.forEach((todo) => {
    const key = todo.tagId && groups.has(todo.tagId) ? todo.tagId : null;
    groups.get(key).push(todo);
  });

  tags.forEach((tag) => {
    const items = groups.get(tag.id);
    if (items.length === 0) return;
    list.appendChild(createGroupHeader(tag.name, tag.color));
    items.forEach((todo) => list.appendChild(createTodoElement(todo)));
  });

  const untagged = groups.get(null);
  if (untagged.length > 0) {
    list.appendChild(createGroupHeader("タグなし", "#c7c9d6"));
    untagged.forEach((todo) => list.appendChild(createTodoElement(todo)));
  }
}

function createGroupHeader(name, color) {
  const header = document.createElement("li");
  header.className = "group-header";
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = color;
  header.appendChild(dot);
  header.appendChild(document.createTextNode(name));
  return header;
}

function createTodoElement(todo) {
  const li = document.createElement("li");
  li.className = "todo-item" + (todo.completed ? " completed" : "");
  li.dataset.id = todo.id;

  const canDrag = dragReorderEnabled();
  const handle = document.createElement("span");
  handle.className = "drag-handle" + (canDrag ? "" : " disabled");
  handle.textContent = "☰";
  handle.title = canDrag
    ? "ドラッグして並び替え"
    : "並び替えは「すべて」表示中のみ利用できます";
  li.draggable = canDrag;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = todo.completed;
  checkbox.addEventListener("change", () => toggleTodo(todo.id));

  const main = document.createElement("div");
  main.className = "main";

  const text = document.createElement("span");
  text.className = "text";
  text.textContent = todo.text;
  text.addEventListener("dblclick", () => startEdit(li, todo));

  main.appendChild(text);

  const status = dueStatus(todo.dueDate, todo.completed);
  if (todo.dueDate || (todo.tagId && getTag(todo.tagId))) {
    const meta = document.createElement("div");
    meta.className = "meta";

    if (todo.dueDate) {
      const badge = document.createElement("span");
      badge.className = "due-badge" + (status ? ` ${status}` : "");
      badge.textContent = formatDate(todo.dueDate);
      meta.appendChild(badge);
    }

    const tag = todo.tagId && getTag(todo.tagId);
    if (tag) {
      const tagBadge = document.createElement("span");
      tagBadge.className = "tag-badge";
      tagBadge.style.background = tag.color;
      const dot = document.createElement("span");
      dot.className = "dot";
      tagBadge.appendChild(dot);
      tagBadge.appendChild(document.createTextNode(tag.name));
      meta.appendChild(tagBadge);
    }

    main.appendChild(meta);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "✕";
  deleteBtn.setAttribute("aria-label", "削除");
  deleteBtn.addEventListener("click", () => deleteTodo(todo.id));

  li.appendChild(handle);
  li.appendChild(checkbox);
  li.appendChild(main);
  li.appendChild(deleteBtn);

  if (canDrag) {
    li.addEventListener("dragstart", () => {
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      const newOrderIds = [...list.querySelectorAll(".todo-item")].map((el) => el.dataset.id);
      todos.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
      saveTodos();
    });
  }

  return li;
}

list.addEventListener("dragover", (e) => {
  const dragging = list.querySelector(".todo-item.dragging");
  if (!dragging) return;
  e.preventDefault();
  const afterElement = getDragAfterElement(list, e.clientY);
  if (afterElement == null) {
    list.appendChild(dragging);
  } else {
    list.insertBefore(dragging, afterElement);
  }
});

function getDragAfterElement(container, y) {
  const items = [...container.querySelectorAll(".todo-item:not(.dragging)")];
  return items.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function startEdit(li, todo) {
  const editInput = document.createElement("input");
  editInput.type = "text";
  editInput.className = "edit-input";
  editInput.value = todo.text;
  editInput.maxLength = 200;

  const textEl = li.querySelector(".text");
  textEl.replaceWith(editInput);
  editInput.focus();
  editInput.setSelectionRange(editInput.value.length, editInput.value.length);

  const commit = () => {
    const value = editInput.value.trim();
    if (value) {
      todo.text = value;
    }
    saveTodos();
    render();
  };

  editInput.addEventListener("blur", commit);
  editInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") editInput.blur();
    if (e.key === "Escape") {
      editInput.removeEventListener("blur", commit);
      render();
    }
  });
}

/* ---------- todo CRUD ---------- */

function addTodo(text, dueDate, tagId) {
  todos.push({
    id: makeId(),
    text,
    completed: false,
    dueDate: dueDate || null,
    tagId: tagId || null,
  });
  saveTodos();
  render();
}

function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (todo) {
    todo.completed = !todo.completed;
    saveTodos();
    render();
  }
}

function deleteTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  saveTodos();
  render();
}

function clearCompleted() {
  todos = todos.filter((t) => !t.completed);
  saveTodos();
  render();
}

/* ---------- events ---------- */

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = input.value.trim();
  if (!value) return;
  addTodo(value, dueInput.value, tagSelect.value);
  input.value = "";
  dueInput.value = "";
  tagSelect.value = "";
  input.focus();
});

clearCompletedBtn.addEventListener("click", clearCompleted);

filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    render();
  });
});

tagFilterSelect.addEventListener("change", () => {
  tagFilter = tagFilterSelect.value;
  render();
});

toggleGroupViewBtn.addEventListener("click", () => {
  groupView = !groupView;
  toggleGroupViewBtn.classList.toggle("active", groupView);
  render();
});

toggleTagPanelBtn.addEventListener("click", () => {
  tagPanel.classList.toggle("hidden");
  toggleTagPanelBtn.textContent = tagPanel.classList.contains("hidden")
    ? "タグを管理 ▾"
    : "タグを管理 ▴";
});

tagForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = tagNameInput.value.trim();
  if (!name) return;
  addTag(name, tagColorInput.value);
  tagNameInput.value = "";
});

renderTagOptions();
renderTagPanel();
render();
