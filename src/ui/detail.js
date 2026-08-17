/**
 * タスク詳細ドロワー。
 * 再描画で入力中のフォーカスが飛ばないよう、data-field をキーに復元している。
 */

import { formatTimestamp } from "../date.js";
import { describeRepeat, PRIORITIES, REPEAT_TYPES, STATUSES } from "../model.js";
import { store } from "../store.js";
import { debounce, h, readableTextColor } from "../utils.js";
import { toast } from "./toast.js";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const REMINDER_OPTIONS = [
  { value: "", label: "なし" },
  { value: "0", label: "期限時刻ちょうど" },
  { value: "10", label: "10分前" },
  { value: "30", label: "30分前" },
  { value: "60", label: "1時間前" },
  { value: "180", label: "3時間前" },
  { value: "1440", label: "1日前" },
];

export function openDetail(id) {
  store.patchUI({ selectedId: id });
  requestAnimationFrame(() => {
    document.querySelector('#detail [data-field="title"]')?.focus();
  });
}

export function closeDetail() {
  store.patchUI({ selectedId: null });
}

const commitTitle = debounce((id, value) => store.updateTask(id, { title: value }), 350);
const commitNotes = debounce((id, value) => store.updateTask(id, { notes: value }), 350);

export function renderDetail() {
  const panel = document.getElementById("detail");
  if (!panel) return;

  const task = store.ui.selectedId ? store.getTask(store.ui.selectedId) : null;
  if (!task) {
    panel.hidden = true;
    panel.replaceChildren();
    document.body.classList.remove("detail-open");
    return;
  }

  const active = document.activeElement;
  const focusedField = active && panel.contains(active) ? active.dataset.field : null;
  const selStart = focusedField ? active.selectionStart : null;
  const selEnd = focusedField ? active.selectionEnd : null;

  panel.hidden = false;
  document.body.classList.add("detail-open");
  panel.replaceChildren(buildPanel(task));

  if (focusedField) {
    const next = panel.querySelector(`[data-field="${CSS.escape(focusedField)}"]`);
    if (next) {
      next.focus();
      if (selStart != null && typeof next.setSelectionRange === "function") {
        try {
          next.setSelectionRange(selStart, selEnd);
        } catch {
          /* type によっては選択範囲を設定できない */
        }
      }
    }
  }
}

function field(label, control, hint) {
  return h(
    "label",
    { class: "field" },
    h("span", { class: "field-label", text: label }),
    control,
    hint ? h("span", { class: "field-hint", text: hint }) : null
  );
}

function buildPanel(task) {
  const data = store.data;

  const titleInput = h("textarea", {
    class: "detail-title",
    dataset: { field: "title" },
    rows: 2,
    maxLength: 500,
    value: task.title,
    "aria-label": "タスク名",
    oninput: (event) => commitTitle(task.id, event.target.value),
  });

  const statusSelect = h(
    "select",
    {
      dataset: { field: "status" },
      value: task.status,
      onchange: (event) => {
        const next = event.target.value;
        if (next === "done") store.toggleTask(task.id);
        else store.updateTask(task.id, { status: next });
      },
    },
    ...STATUSES.map((s) => h("option", { value: s.id, text: s.label, selected: s.id === task.status }))
  );

  const prioritySelect = h(
    "select",
    {
      dataset: { field: "priority" },
      onchange: (event) => store.updateTask(task.id, { priority: Number(event.target.value) }),
    },
    ...PRIORITIES.map((p) =>
      h("option", { value: String(p.value), text: p.label, selected: p.value === task.priority })
    )
  );

  const projectSelect = h(
    "select",
    {
      dataset: { field: "project" },
      onchange: (event) =>
        store.updateTask(task.id, { projectId: event.target.value === "" ? null : event.target.value }),
    },
    h("option", { value: "", text: "なし", selected: !task.projectId }),
    ...data.projects.map((p) =>
      h("option", { value: p.id, text: p.name, selected: p.id === task.projectId })
    )
  );

  const dueInput = h("input", {
    type: "date",
    dataset: { field: "due" },
    value: task.due || "",
    onchange: (event) => store.updateTask(task.id, { due: event.target.value || null }),
  });

  const timeInput = h("input", {
    type: "time",
    dataset: { field: "dueTime" },
    value: task.dueTime || "",
    onchange: (event) => store.updateTask(task.id, { dueTime: event.target.value || null }),
  });

  const reminderSelect = h(
    "select",
    {
      dataset: { field: "remind" },
      onchange: (event) =>
        store.updateTask(task.id, {
          remindBefore: event.target.value === "" ? null : Number(event.target.value),
        }),
    },
    ...REMINDER_OPTIONS.map((option) =>
      h("option", {
        value: option.value,
        text: option.label,
        selected: String(task.remindBefore ?? "") === option.value,
      })
    )
  );

  const estimateInput = h("input", {
    type: "number",
    min: "0",
    max: "99",
    dataset: { field: "estimate" },
    value: task.estimate ?? "",
    placeholder: "—",
    onchange: (event) =>
      store.updateTask(task.id, { estimate: event.target.value === "" ? null : Number(event.target.value) }),
  });

  const notesInput = h("textarea", {
    class: "detail-notes",
    dataset: { field: "notes" },
    rows: 5,
    placeholder: "メモ…",
    value: task.notes,
    "aria-label": "メモ",
    oninput: (event) => commitNotes(task.id, event.target.value),
  });

  return h(
    "div",
    { class: "detail-inner" },
    h(
      "header",
      { class: "detail-head" },
      h("label", { class: "detail-check" },
        h("input", {
          type: "checkbox",
          checked: task.status === "done",
          dataset: { field: "done" },
          onchange: () => store.toggleTask(task.id),
        }),
        h("span", { text: task.status === "done" ? "完了" : "完了にする" })
      ),
      h("button", {
        type: "button",
        class: "icon-btn",
        "aria-label": "詳細を閉じる",
        title: "閉じる (Esc)",
        text: "✕",
        onclick: closeDetail,
      })
    ),

    titleInput,

    h(
      "div",
      { class: "field-grid" },
      field("ステータス", statusSelect),
      field("優先度", prioritySelect),
      field("プロジェクト", projectSelect),
      field("期限", dueInput),
      field("時刻", timeInput),
      field("リマインド", reminderSelect),
      field("見積り（ポモドーロ）", estimateInput)
    ),

    buildRepeatSection(task),
    buildTagSection(task, data),
    field("メモ", notesInput),
    buildSubtaskSection(task),
    buildFooter(task)
  );
}

/* ---------------- くり返し ---------------- */

function buildRepeatSection(task) {
  const repeat = task.repeat;

  const typeSelect = h(
    "select",
    {
      dataset: { field: "repeatType" },
      onchange: (event) => {
        const type = event.target.value;
        if (!type) {
          store.updateTask(task.id, { repeat: null });
          return;
        }
        store.updateTask(task.id, {
          repeat: { type, every: repeat?.every || 1, weekdays: repeat?.weekdays || [] },
        });
      },
    },
    h("option", { value: "", text: "くり返さない", selected: !repeat }),
    ...REPEAT_TYPES.map((r) => h("option", { value: r.id, text: r.label, selected: repeat?.type === r.id }))
  );

  const children = [field("くり返し", typeSelect)];

  if (repeat) {
    children.push(
      field(
        "間隔",
        h("input", {
          type: "number",
          min: "1",
          max: "365",
          dataset: { field: "repeatEvery" },
          value: repeat.every,
          onchange: (event) =>
            store.updateTask(task.id, {
              repeat: { ...repeat, every: Math.max(1, Number(event.target.value) || 1) },
            }),
        })
      )
    );
  }

  const section = h("div", { class: "field-grid" }, ...children);

  if (repeat?.type === "weekly") {
    return h(
      "div",
      { class: "repeat-block" },
      section,
      h(
        "div",
        { class: "weekday-picker", role: "group", "aria-label": "くり返す曜日" },
        ...WEEKDAYS.map((name, index) =>
          h("button", {
            type: "button",
            class: `weekday-chip${repeat.weekdays.includes(index) ? " on" : ""}`,
            text: name,
            "aria-pressed": String(repeat.weekdays.includes(index)),
            onclick: () => {
              const weekdays = repeat.weekdays.includes(index)
                ? repeat.weekdays.filter((w) => w !== index)
                : [...repeat.weekdays, index].sort();
              store.updateTask(task.id, { repeat: { ...repeat, weekdays } });
            },
          })
        )
      ),
      h("p", { class: "field-hint", text: `完了すると「${describeRepeat(repeat)}」の次回へ自動で送られます` })
    );
  }

  if (repeat) {
    return h(
      "div",
      { class: "repeat-block" },
      section,
      h("p", { class: "field-hint", text: `完了すると「${describeRepeat(repeat)}」の次回へ自動で送られます` })
    );
  }

  return section;
}

/* ---------------- タグ ---------------- */

function buildTagSection(task, data) {
  const chips = data.tags.map((tag) => {
    const on = task.tagIds.includes(tag.id);
    return h("button", {
      type: "button",
      class: `tag-chip${on ? " on" : ""}`,
      style: on ? { background: tag.color, color: readableTextColor(tag.color), borderColor: tag.color } : null,
      text: `#${tag.name}`,
      "aria-pressed": String(on),
      onclick: () => store.toggleTaskTag(task.id, tag.id),
    });
  });

  return h(
    "div",
    { class: "detail-section" },
    h("span", { class: "field-label", text: "タグ" }),
    data.tags.length === 0
      ? h("p", { class: "field-hint", text: "サイドバーの「＋」からタグを作れます" })
      : h("div", { class: "tag-chips" }, ...chips)
  );
}

/* ---------------- サブタスク ---------------- */

function buildSubtaskSection(task) {
  const total = task.subtasks.length;
  const done = task.subtasks.filter((s) => s.done).length;

  const newInput = h("input", {
    type: "text",
    class: "subtask-new",
    dataset: { field: "subtask-new" },
    placeholder: "サブタスクを追加…",
    maxLength: 300,
    "aria-label": "サブタスクを追加",
  });

  const form = h(
    "form",
    {
      class: "subtask-form",
      onsubmit: (event) => {
        event.preventDefault();
        if (store.addSubtask(task.id, newInput.value)) newInput.value = "";
      },
    },
    newInput,
    h("button", { type: "submit", class: "btn subtle", text: "追加" })
  );

  return h(
    "div",
    { class: "detail-section" },
    h(
      "div",
      { class: "section-head" },
      h("span", { class: "field-label", text: "サブタスク" }),
      total > 0 ? h("span", { class: "section-count", text: `${done}/${total}` }) : null
    ),
    h(
      "ul",
      { class: "subtask-list" },
      ...task.subtasks.map((subtask) =>
        h(
          "li",
          { class: `subtask${subtask.done ? " done" : ""}` },
          h("input", {
            type: "checkbox",
            checked: subtask.done,
            "aria-label": `${subtask.title} を完了にする`,
            onchange: (event) => store.updateSubtask(task.id, subtask.id, { done: event.target.checked }),
          }),
          h("input", {
            type: "text",
            class: "subtask-title",
            dataset: { field: `subtask-${subtask.id}` },
            value: subtask.title,
            maxLength: 300,
            onchange: (event) => store.updateSubtask(task.id, subtask.id, { title: event.target.value }),
          }),
          h("button", {
            type: "button",
            class: "icon-btn small",
            "aria-label": "サブタスクを削除",
            text: "✕",
            onclick: () => store.removeSubtask(task.id, subtask.id),
          })
        )
      )
    ),
    form
  );
}

/* ---------------- フッター ---------------- */

function buildFooter(task) {
  return h(
    "footer",
    { class: "detail-foot" },
    h(
      "dl",
      { class: "detail-meta" },
      h("div", null, h("dt", { text: "作成" }), h("dd", { text: formatTimestamp(task.createdAt) })),
      h("div", null, h("dt", { text: "更新" }), h("dd", { text: formatTimestamp(task.updatedAt) })),
      task.completedCount > 0
        ? h("div", null, h("dt", { text: "完了回数" }), h("dd", { text: `${task.completedCount} 回` }))
        : null,
      task.pomodoros > 0
        ? h("div", null, h("dt", { text: "ポモドーロ" }), h("dd", { text: `${task.pomodoros} 回` }))
        : null
    ),
    h(
      "div",
      { class: "detail-actions" },
      h("button", {
        type: "button",
        class: "btn subtle",
        text: "複製",
        onclick: () => {
          const copy = store.duplicateTask(task.id);
          if (copy) {
            openDetail(copy.id);
            toast("複製しました");
          }
        },
      }),
      h("button", {
        type: "button",
        class: "btn subtle",
        text: task.archived ? "アーカイブ解除" : "アーカイブ",
        onclick: () => {
          store.setArchived(task.id, !task.archived);
          toast(task.archived ? "アーカイブから戻しました" : "アーカイブしました", {
            actionLabel: "取り消す",
            onAction: () => store.undo(),
          });
        },
      }),
      h("button", {
        type: "button",
        class: "btn danger",
        text: "削除",
        onclick: () => {
          store.deleteTask(task.id);
          closeDetail();
          toast("ゴミ箱へ移動しました", { actionLabel: "取り消す", onAction: () => store.undo() });
        },
      })
    )
  );
}
