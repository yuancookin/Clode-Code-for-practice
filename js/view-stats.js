import { getState } from "./store.js";
import { el, dueBadge } from "./dom-helpers.js";
import { todayISO, addDays, isoDate } from "./utils.js";
import { openTaskModal } from "./modal.js";

const gridEl = document.getElementById("stats-grid");

function summaryCard(label, value, className) {
  const card = el("div", "stat-card" + (className ? ` ${className}` : ""));
  card.appendChild(el("div", "stat-value", String(value)));
  card.appendChild(el("div", "stat-label", label));
  return card;
}

function completionRing(pct) {
  const card = el("div", "stat-card ring-card");
  const ring = el("div", "ring");
  ring.style.background = `conic-gradient(var(--primary) ${pct * 3.6}deg, var(--ring-bg) 0deg)`;
  const inner = el("div", "ring-inner", `${pct}%`);
  ring.appendChild(inner);
  card.appendChild(ring);
  card.appendChild(el("div", "stat-label", "完了率"));
  return card;
}

function barChart(title, entries, { horizontal = true } = {}) {
  const card = el("div", "stat-card wide");
  card.appendChild(el("h3", "stat-title", title));
  if (entries.length === 0) {
    card.appendChild(el("p", "muted", "データがありません"));
    return card;
  }
  const max = Math.max(...entries.map((e) => e.value), 1);
  const chart = el("div", horizontal ? "bar-chart horizontal" : "bar-chart vertical");
  entries.forEach((entry) => {
    const row = el("div", "bar-row");
    if (horizontal) {
      row.appendChild(el("span", "bar-name", entry.label));
      const track = el("div", "bar-track");
      const fill = el("div", "bar-fill");
      fill.style.width = `${(entry.value / max) * 100}%`;
      if (entry.color) fill.style.background = entry.color;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "bar-value", String(entry.value)));
    } else {
      row.appendChild(el("span", "bar-value", String(entry.value)));
      const track = el("div", "bar-track vertical");
      const fill = el("div", "bar-fill vertical");
      fill.style.height = `${(entry.value / max) * 100}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "bar-name", entry.label));
    }
    chart.appendChild(row);
  });
  card.appendChild(chart);
  return card;
}

function upcomingList(tasks) {
  const card = el("div", "stat-card wide");
  card.appendChild(el("h3", "stat-title", "直近の期限"));
  const upcoming = tasks
    .filter((t) => t.status !== "done" && t.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);
  if (upcoming.length === 0) {
    card.appendChild(el("p", "muted", "期限のあるタスクはありません"));
    return card;
  }
  const ul = el("ul", "upcoming-list");
  upcoming.forEach((t) => {
    const li = el("li");
    const btn = el("button", "link-btn", t.title);
    btn.type = "button";
    btn.addEventListener("click", () => openTaskModal(t));
    li.appendChild(btn);
    const badge = dueBadge(t);
    if (badge) li.appendChild(badge);
    ul.appendChild(li);
  });
  card.appendChild(ul);
  return card;
}

export function renderStats() {
  const { tasks, tags } = getState();
  gridEl.innerHTML = "";

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const active = total - done;
  const today = todayISO();
  const overdue = tasks.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < today).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  gridEl.appendChild(summaryCard("総タスク数", total));
  gridEl.appendChild(summaryCard("未完了", active));
  gridEl.appendChild(summaryCard("完了", done));
  gridEl.appendChild(summaryCard("期限切れ", overdue, overdue > 0 ? "danger" : ""));
  gridEl.appendChild(completionRing(pct));

  const priorityOrder = [
    { key: "high", label: "高", color: "var(--priority-high)" },
    { key: "medium", label: "中", color: "var(--priority-medium)" },
    { key: "low", label: "低", color: "var(--priority-low)" },
    { key: "none", label: "なし", color: "var(--muted)" },
  ];
  const priorityEntries = priorityOrder
    .map((p) => ({
      label: p.label,
      value: tasks.filter((t) => t.priority === p.key).length,
      color: p.color,
    }))
    .filter((e) => e.value > 0);
  gridEl.appendChild(barChart("優先度別タスク数", priorityEntries));

  const tagEntries = tags
    .map((tag) => ({
      label: tag.name,
      value: tasks.filter((t) => t.tagIds.includes(tag.id)).length,
      color: tag.color,
    }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  gridEl.appendChild(barChart("タグ別タスク数", tagEntries));

  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const iso = addDays(today, -i);
    const count = tasks.filter((t) => t.completedAt && isoDate(new Date(t.completedAt)) === iso).length;
    const label = iso.slice(5).replace("-", "/");
    trend.push({ label, value: count });
  }
  gridEl.appendChild(barChart("直近7日間の完了数", trend, { horizontal: false }));

  gridEl.appendChild(upcomingList(tasks));
}
