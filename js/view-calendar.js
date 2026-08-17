import { getState, updateSettings } from "./store.js";
import { filterTasks } from "./filters.js";
import { el } from "./dom-helpers.js";
import { isoDate, todayISO, parseISO } from "./utils.js";
import { openTaskModal } from "./modal.js";

const titleEl = document.getElementById("cal-title");
const gridEl = document.getElementById("calendar-grid");
const prevBtn = document.getElementById("cal-prev");
const nextBtn = document.getElementById("cal-next");
const todayBtn = document.getElementById("cal-today");
const popover = document.getElementById("day-popover");

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function getCursor() {
  const { settings } = getState();
  return settings.calendarCursor || todayISO();
}

function shiftMonth(delta) {
  const d = parseISO(getCursor());
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  updateSettings({ calendarCursor: isoDate(d) });
  renderCalendar();
}

prevBtn.addEventListener("click", () => shiftMonth(-1));
nextBtn.addEventListener("click", () => shiftMonth(1));
todayBtn.addEventListener("click", () => {
  updateSettings({ calendarCursor: todayISO() });
  renderCalendar();
});

function showDayPopover(anchor, dateIso, tasks) {
  popover.innerHTML = "";
  popover.appendChild(el("h3", null, dateIso));
  if (tasks.length === 0) {
    popover.appendChild(el("p", "muted", "タスクはありません"));
  } else {
    const ul = el("ul", "popover-list");
    tasks.forEach((t) => {
      const li = el("li", null);
      const btn = el("button", "link-btn", t.title);
      btn.type = "button";
      btn.addEventListener("click", () => {
        popover.classList.add("hidden");
        openTaskModal(t);
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });
    popover.appendChild(ul);
  }
  const rect = anchor.getBoundingClientRect();
  popover.style.top = `${window.scrollY + rect.bottom + 4}px`;
  popover.style.left = `${window.scrollX + rect.left}px`;
  popover.classList.remove("hidden");
}

document.addEventListener("click", (e) => {
  if (popover.classList.contains("hidden")) return;
  if (!popover.contains(e.target) && !e.target.closest(".calendar-day")) {
    popover.classList.add("hidden");
  }
});

export function renderCalendar() {
  const { tasks, settings } = getState();
  const cursor = getCursor();
  const cursorDate = parseISO(cursor);
  const year = cursorDate.getFullYear();
  const month = cursorDate.getMonth();
  titleEl.textContent = `${year}年 ${month + 1}月`;

  const visible = filterTasks(tasks, settings.filter);
  const byDate = new Map();
  visible.forEach((t) => {
    if (!t.dueDate) return;
    if (!byDate.has(t.dueDate)) byDate.set(t.dueDate, []);
    byDate.get(t.dueDate).push(t);
  });

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  const today = todayISO();

  gridEl.innerHTML = "";
  WEEKDAYS.forEach((w) => gridEl.appendChild(el("div", "calendar-weekday", w)));

  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = isoDate(d);
    const inMonth = d.getMonth() === month;
    const dayTasks = (byDate.get(iso) || []).sort((a, b) =>
      (a.dueTime || "").localeCompare(b.dueTime || "")
    );

    const cell = el("div", "calendar-day" + (inMonth ? "" : " outside") + (iso === today ? " today" : ""));
    cell.appendChild(el("span", "day-num", String(d.getDate())));

    const chipsWrap = el("div", "day-chips");
    dayTasks.slice(0, 3).forEach((t) => {
      const chip = el("span", "day-chip" + (t.status === "done" ? " done" : "") + ` priority-${t.priority}`, t.title);
      chipsWrap.appendChild(chip);
    });
    if (dayTasks.length > 3) {
      chipsWrap.appendChild(el("span", "day-chip more", `+${dayTasks.length - 3}`));
    }
    cell.appendChild(chipsWrap);

    if (dayTasks.length > 0) {
      cell.addEventListener("click", () => showDayPopover(cell, iso, dayTasks));
    }

    gridEl.appendChild(cell);
  }
}
