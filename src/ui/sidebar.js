/**
 * 左サイドバー：スマートビュー・プロジェクト・タグ。
 */

import { PROJECT_COLORS } from "../model.js";
import { SCOPES, scopeCounts } from "../query.js";
import { store } from "../store.js";
import { h } from "../utils.js";
import { openModal, closeModal } from "./modal.js";
import { toast } from "./toast.js";

export function renderSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  const { data, ui } = store;
  const counts = scopeCounts(data);

  sidebar.replaceChildren(
    h(
      "nav",
      { class: "nav" },
      section(
        "ビュー",
        null,
        SCOPES.map((scope) =>
          navItem({
            active: ui.scope === scope.id,
            icon: scope.icon,
            label: scope.label,
            count: counts[scope.id],
            danger: scope.id === "overdue" && counts.overdue > 0,
            onClick: () => selectScope(scope.id),
          })
        )
      ),
      section(
        "プロジェクト",
        () => editProject(null),
        data.projects.length === 0
          ? [h("li", { class: "nav-empty", text: "「＋」から作成できます" })]
          : data.projects.map((project) =>
              navItem({
                active: ui.scope === `project:${project.id}`,
                dot: project.color,
                label: project.name,
                count: counts.projects.get(project.id) || 0,
                onClick: () => selectScope(`project:${project.id}`),
                onEdit: () => editProject(project),
              })
            )
      ),
      section(
        "タグ",
        () => editTag(null),
        data.tags.length === 0
          ? [h("li", { class: "nav-empty", text: "「＋」から作成できます" })]
          : data.tags.map((tag) =>
              navItem({
                active: ui.scope === `tag:${tag.id}`,
                dot: tag.color,
                label: `#${tag.name}`,
                count: counts.tags.get(tag.id) || 0,
                onClick: () => selectScope(`tag:${tag.id}`),
                onEdit: () => editTag(tag),
              })
            )
      )
    )
  );
}

function selectScope(scope) {
  store.patchUI({ scope, limit: 300 });
  store.clearSelection();
  if (window.matchMedia("(max-width: 900px)").matches) {
    document.body.classList.remove("sidebar-open");
  }
}

function section(title, onAdd, items) {
  return h(
    "section",
    { class: "nav-section" },
    h(
      "div",
      { class: "nav-section-head" },
      h("h2", { text: title }),
      onAdd
        ? h("button", {
            type: "button",
            class: "icon-btn small",
            "aria-label": `${title}を追加`,
            title: `${title}を追加`,
            text: "＋",
            onclick: onAdd,
          })
        : null
    ),
    h("ul", { class: "nav-list" }, ...items)
  );
}

function navItem({ active, icon, dot, label, count, onClick, onEdit, danger }) {
  return h(
    "li",
    { class: `nav-item${active ? " active" : ""}` },
    h(
      "button",
      { type: "button", class: "nav-link", onclick: onClick, "aria-current": active ? "page" : null },
      dot ? h("span", { class: "dot", style: { background: dot }, "aria-hidden": "true" }) : null,
      icon ? h("span", { class: "nav-icon", "aria-hidden": "true", text: icon }) : null,
      h("span", { class: "nav-label", text: label }),
      count ? h("span", { class: `nav-count${danger ? " danger" : ""}`, text: String(count) }) : null
    ),
    onEdit
      ? h("button", {
          type: "button",
          class: "icon-btn small nav-edit",
          "aria-label": `${label} を編集`,
          title: "編集",
          text: "✎",
          onclick: onEdit,
        })
      : null
  );
}

/* ---------------- 編集モーダル ---------------- */

function colorPicker(current, onPick) {
  let selected = current;
  const swatches = PROJECT_COLORS.map((color) =>
    h("button", {
      type: "button",
      class: `swatch${color === selected ? " on" : ""}`,
      style: { background: color },
      "aria-label": `色 ${color}`,
      "aria-pressed": String(color === selected),
      onclick: (event) => {
        selected = color;
        onPick(color);
        event.currentTarget.parentNode.querySelectorAll(".swatch").forEach((el) => el.classList.remove("on"));
        event.currentTarget.classList.add("on");
      },
    })
  );
  return h("div", { class: "swatches", role: "group", "aria-label": "色を選択" }, ...swatches);
}

function editEntity({ title, entity, defaultColor, onSave, onDelete, deleteNote }) {
  let color = entity?.color || defaultColor;
  const nameInput = h("input", {
    type: "text",
    class: "modal-input",
    value: entity?.name || "",
    maxLength: 60,
    placeholder: "名前",
    "aria-label": "名前",
  });

  const save = () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    onSave({ name, color });
    closeModal();
  };

  const body = h(
    "div",
    { class: "modal-form" },
    h("label", { class: "field" }, h("span", { class: "field-label", text: "名前" }), nameInput),
    h(
      "div",
      { class: "field" },
      h("span", { class: "field-label", text: "色" }),
      colorPicker(color, (next) => {
        color = next;
      })
    )
  );

  const footer = h(
    "div",
    { class: "modal-actions" },
    entity && onDelete
      ? h("button", {
          type: "button",
          class: "btn danger subtle",
          text: "削除",
          onclick: () => {
            if (!store.data.settings.confirmDelete || confirm(deleteNote)) {
              onDelete();
              closeModal();
            }
          },
        })
      : null,
    h("span", { class: "spacer" }),
    h("button", { type: "button", class: "btn subtle", text: "キャンセル", onclick: () => closeModal() }),
    h("button", { type: "button", class: "btn primary", text: "保存", onclick: save })
  );

  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    }
  });

  openModal(title, body, { footer });
  requestAnimationFrame(() => nameInput.focus());
}

function editProject(project) {
  editEntity({
    title: project ? "プロジェクトを編集" : "プロジェクトを追加",
    entity: project,
    defaultColor: PROJECT_COLORS[store.data.projects.length % PROJECT_COLORS.length],
    onSave: (patch) => {
      if (project) store.updateProject(project.id, patch);
      else store.addProject(patch);
      toast(project ? "プロジェクトを更新しました" : "プロジェクトを追加しました");
    },
    onDelete: project
      ? () => {
          if (store.ui.scope === `project:${project.id}`) store.patchUI({ scope: "all" });
          store.deleteProject(project.id);
          toast("プロジェクトを削除しました", { actionLabel: "取り消す", onAction: () => store.undo() });
        }
      : null,
    deleteNote: "プロジェクトを削除します。含まれるタスクは「プロジェクトなし」になります。よろしいですか？",
  });
}

function editTag(tag) {
  editEntity({
    title: tag ? "タグを編集" : "タグを追加",
    entity: tag,
    defaultColor: PROJECT_COLORS[(store.data.tags.length + 1) % PROJECT_COLORS.length],
    onSave: (patch) => {
      if (tag) store.updateTag(tag.id, patch);
      else store.addTag(patch);
      toast(tag ? "タグを更新しました" : "タグを追加しました");
    },
    onDelete: tag
      ? () => {
          if (store.ui.scope === `tag:${tag.id}`) store.patchUI({ scope: "all" });
          store.deleteTag(tag.id);
          toast("タグを削除しました", { actionLabel: "取り消す", onAction: () => store.undo() });
        }
      : null,
    deleteNote: "タグを削除します。タスクからも外れます。よろしいですか？",
  });
}
