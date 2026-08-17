/**
 * 月間カレンダー。
 * 日付セルへタスクをドラッグすると期限が変わる。日をクリックするとその日の一覧が下に出る。
 */

import {
  currentMonthKey,
  formatDateLongJP,
  formatMonthJP,
  monthGrid,
  monthKey,
  shiftMonth,
  todayISO,
  WEEKDAY_NAMES,
} from "../date.js";
import { filterTasks } from "../query.js";
import { store } from "../store.js";
import { h } from "../utils.js";
import { metaRow } from "../ui/badges.js";
import { openDetail } from "../ui/detail.js";
import { toast } from "../ui/toast.js";

const CHIPS_PER_CELL = 3;

export function renderCalendar(container) {
  const { data, ui } = store;
  const today = todayISO();
  const month = ui.calendarMonth || currentMonthKey();

  const tasks = filterTasks(data, { ...ui, showCompleted: true }, today).filter(
    (t) => !t.deletedAt && !t.archived
  );

  const byDate = new Map();
  tasks.forEach((task) => {
    if (!task.due) return;
    if (!byDate.has(task.due)) byDate.set(task.due, []);
    byDate.get(task.due).push(task);
  });

  const grid = h(
    "div",
    { class: "calendar-grid", role: "grid" },
    ...WEEKDAY_NAMES.map((name, index) =>
      h("div", { class: `calendar-weekday${index === 0 ? " sun" : index === 6 ? " sat" : ""}`, text: name })
    ),
    ...monthGrid(month).map((date) => renderCell(date, byDate.get(date) || [], month, today, data))
  );

  container.replaceChildren(
    h(
      "div",
      { class: "calendar-head" },
      h("button", {
        type: "button",
        class: "icon-btn",
        "aria-label": "前の月",
        text: "‹",
        onclick: () => store.patchUI({ calendarMonth: shiftMonth(month, -1) }),
      }),
      h("h2", { class: "calendar-title", text: formatMonthJP(month) }),
      h("button", {
        type: "button",
        class: "icon-btn",
        "aria-label": "次の月",
        text: "›",
        onclick: () => store.patchUI({ calendarMonth: shiftMonth(month, 1) }),
      }),
      h("button", {
        type: "button",
        class: "btn subtle",
        text: "今月",
        onclick: () => store.patchUI({ calendarMonth: currentMonthKey(), calendarDay: todayISO() }),
      }),
      h("span", { class: "calendar-note", text: `${tasks.filter((t) => t.due).length} 件に期限あり` })
    ),
    grid,
    renderDayPanel(ui.calendarDay, byDate, data, today)
  );
}

function renderCell(date, tasks, month, today, data) {
  const isOtherMonth = monthKey(date) !== month;
  const isToday = date === today;
  const isSelected = store.ui.calendarDay === date;
  const day = Number(date.slice(8));
  const weekdayIndex = new Date(`${date}T00:00:00`).getDay();

  const cell = h("div", {
    class: [
      "calendar-cell",
      isOtherMonth ? "other-month" : "",
      isToday ? "today" : "",
      isSelected ? "selected" : "",
      weekdayIndex === 0 ? "sun" : "",
      weekdayIndex === 6 ? "sat" : "",
    ]
      .filter(Boolean)
      .join(" "),
    dataset: { date },
    role: "gridcell",
    tabIndex: 0,
    "aria-label": formatDateLongJP(date),
    onclick: () => store.patchUI({ calendarDay: date }),
    onkeydown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        store.patchUI({ calendarDay: date });
      }
    },
    ondragover: (event) => {
      event.preventDefault();
      cell.classList.add("drop-target");
    },
    ondragleave: () => cell.classList.remove("drop-target"),
    ondrop: (event) => {
      event.preventDefault();
      cell.classList.remove("drop-target");
      const id = event.dataTransfer.getData("text/plain");
      if (!store.getTask(id)) return;
      store.updateTask(id, { due: date });
      toast(`期限を ${date} に変更しました`, { actionLabel: "取り消す", onAction: () => store.undo() });
    },
  });

  cell.appendChild(
    h(
      "div",
      { class: "calendar-day" },
      h("span", { class: "day-number", text: String(day) }),
      tasks.length > 0 ? h("span", { class: "day-count", text: String(tasks.length) }) : null
    )
  );

  const ordered = [...tasks].sort((a, b) => b.priority - a.priority);
  ordered.slice(0, CHIPS_PER_CELL).forEach((task) => {
    const project = data.projects.find((p) => p.id === task.projectId);
    cell.appendChild(
      h("div", {
        class: `calendar-chip${task.status === "done" ? " done" : ""}`,
        draggable: true,
        title: task.title,
        text: task.title || "（無題）",
        style: project ? { borderLeftColor: project.color } : null,
        onclick: (event) => {
          event.stopPropagation();
          openDetail(task.id);
        },
        ondragstart: (event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", task.id);
        },
      })
    );
  });

  if (ordered.length > CHIPS_PER_CELL) {
    cell.appendChild(h("div", { class: "calendar-more", text: `+${ordered.length - CHIPS_PER_CELL} 件` }));
  }

  return cell;
}

function renderDayPanel(date, byDate, data, today) {
  if (!date) {
    return h("div", { class: "calendar-day-panel empty", text: "日付をクリックすると、その日のタスクを表示・追加できます" });
  }

  const tasks = byDate.get(date) || [];
  const input = h("input", {
    type: "text",
    class: "day-add-input",
    placeholder: "この日にタスクを追加…",
    maxLength: 500,
    "aria-label": "この日にタスクを追加",
  });

  const form = h(
    "form",
    {
      class: "day-add-form",
      onsubmit: (event) => {
        event.preventDefault();
        const title = input.value.trim();
        if (!title) return;
        store.addTask({ title, due: date });
        input.value = "";
        toast("追加しました");
      },
    },
    input,
    h("button", { type: "submit", class: "btn primary", text: "追加" })
  );

  return h(
    "div",
    { class: "calendar-day-panel" },
    h(
      "div",
      { class: "day-panel-head" },
      h("h3", { text: formatDateLongJP(date) }),
      h("span", { class: "day-panel-count", text: `${tasks.length} 件` })
    ),
    form,
    tasks.length === 0
      ? h("p", { class: "day-panel-empty", text: "この日のタスクはありません" })
      : h(
          "ul",
          { class: "day-panel-list" },
          ...tasks.map((task) =>
            h(
              "li",
              { class: `day-panel-item${task.status === "done" ? " done" : ""}` },
              h("input", {
                type: "checkbox",
                checked: task.status === "done",
                "aria-label": `${task.title} を完了にする`,
                onchange: () => store.toggleTask(task.id),
              }),
              h(
                "div",
                { class: "day-panel-body", onclick: () => openDetail(task.id) },
                h("span", { class: "day-panel-title", text: task.title || "（無題）" }),
                metaRow(task, data, today)
              )
            )
          )
        )
  );
}
