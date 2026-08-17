/**
 * 統計ダッシュボード。
 *
 * 配色は検証済みパレット由来の CSS 変数（--viz-*）を使う。
 * 1 系列のグラフなので凡例は置かず、見出しが系列名を兼ねる。
 * 色だけに頼らないよう、値は直接ラベル＋表ビューでも読めるようにしている。
 */

import { formatDateJP, todayISO } from "../date.js";
import { computeStats } from "../query.js";
import { store } from "../store.js";
import { h, s } from "../utils.js";

let showTable = false;

const PRIORITY_VAR = {
  3: "var(--viz-critical)",
  2: "var(--viz-warning)",
  1: "var(--viz-info)",
  0: "var(--viz-neutral)",
};

export function renderStats(container) {
  const stats = computeStats(store.data, todayISO(), 14);

  container.replaceChildren(
    h(
      "div",
      { class: "stats" },
      renderTiles(stats),
      h(
        "section",
        { class: "card chart-card" },
        h(
          "div",
          { class: "card-head" },
          h("h2", { text: "直近14日の完了数" }),
          h("button", {
            type: "button",
            class: "btn subtle",
            text: showTable ? "グラフで見る" : "表で見る",
            onclick: () => {
              showTable = !showTable;
              store.emit();
            },
          })
        ),
        showTable ? completionTable(stats) : completionChart(stats),
        h("p", {
          class: "card-note",
          text: `1日あたり平均 ${stats.avgPerDay.toFixed(1)} 件 ／ 直近7日で ${stats.last7} 件`,
        })
      ),
      h(
        "div",
        { class: "stats-columns" },
        h(
          "section",
          { class: "card" },
          h("div", { class: "card-head" }, h("h2", { text: "未完了タスクの優先度" })),
          priorityChart(stats)
        ),
        h(
          "section",
          { class: "card" },
          h("div", { class: "card-head" }, h("h2", { text: "プロジェクト別の進捗" })),
          projectList(stats)
        )
      ),
      h(
        "section",
        { class: "card" },
        h("div", { class: "card-head" }, h("h2", { text: "タグ別の未完了件数" })),
        tagList(stats)
      )
    )
  );
}

/* ---------------- 数値タイル ---------------- */

function tile(label, value, note, tone = "") {
  return h(
    "div",
    { class: `tile ${tone}` },
    h("span", { class: "tile-label", text: label }),
    h("strong", { class: "tile-value", text: String(value) }),
    note ? h("span", { class: "tile-note", text: note }) : null
  );
}

function renderTiles(stats) {
  return h(
    "div",
    { class: "tiles" },
    tile("未完了", stats.open, `全 ${stats.total} 件`),
    tile("完了率", `${Math.round(stats.completionRate * 100)}%`, `${stats.done} 件完了`),
    tile("期限切れ", stats.overdue, stats.overdue > 0 ? "対応が必要" : "問題なし", stats.overdue > 0 ? "alert" : "good"),
    tile("今日が期限", stats.dueToday, "残りタスク"),
    tile("連続達成", `${stats.streak}日`, stats.streak > 0 ? "継続中 🔥" : "今日から再開"),
    tile("ポモドーロ", stats.pomodoros, "累計セッション")
  );
}

/* ---------------- 完了数の推移（棒グラフ） ---------------- */

function barPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height);
  if (height <= 0) return "";
  return [
    `M${x},${y + height}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${y + height}`,
    "Z",
  ].join(" ");
}

function completionChart(stats) {
  const W = 720;
  const H = 240;
  const padL = 34;
  const padR = 10;
  const padT = 18;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const series = stats.series;
  const max = Math.max(1, ...series.map((d) => d.count));
  const slot = plotW / series.length;
  const barW = Math.min(38, slot - 2); // 棒の間に 2px の余白を残す
  const peakIndex = series.reduce((best, d, i) => (d.count > series[best].count ? i : best), 0);

  const ticks = [0, Math.round(max / 2), max].filter((v, i, arr) => arr.indexOf(v) === i);

  const svg = s(
    "svg",
    {
      class: "chart",
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": `直近14日の1日あたり完了タスク数。最大 ${max} 件。`,
      preserveAspectRatio: "xMidYMid meet",
    },
    // 目盛り線（控えめに）
    ...ticks.map((value) => {
      const y = padT + plotH - (value / max) * plotH;
      return s(
        "g",
        null,
        s("line", { x1: padL, y1: y, x2: W - padR, y2: y, class: "chart-grid" }),
        s("text", { x: padL - 8, y: y + 4, class: "chart-tick", "text-anchor": "end" }, String(value))
      );
    }),
    // 棒
    ...series.map((point, index) => {
      const x = padL + index * slot + (slot - barW) / 2;
      const height = (point.count / max) * plotH;
      const y = padT + plotH - height;
      const isToday = index === series.length - 1;
      const label = `${formatDateJP(point.date)}: ${point.count} 件`;

      return s(
        "g",
        { class: "chart-bar-group" },
        s("title", null, label),
        point.count > 0
          ? s("path", {
              d: barPath(x, y, barW, height, 4),
              class: `chart-bar${isToday ? " today" : ""}`,
            })
          : s("line", {
              x1: x,
              y1: padT + plotH,
              x2: x + barW,
              y2: padT + plotH,
              class: "chart-zero",
            }),
        // 直接ラベルは「最大値」と「今日」だけ（全点に数字は置かない）
        (index === peakIndex || isToday) && point.count > 0
          ? s(
              "text",
              { x: x + barW / 2, y: y - 6, class: "chart-value", "text-anchor": "middle" },
              String(point.count)
            )
          : null,
        index % 2 === 0 || isToday
          ? s(
              "text",
              { x: x + barW / 2, y: H - 12, class: "chart-axis", "text-anchor": "middle" },
              point.date.slice(5).replace("-", "/")
            )
          : null
      );
    }),
    s("line", { x1: padL, y1: padT + plotH, x2: W - padR, y2: padT + plotH, class: "chart-axis-line" })
  );

  return h("div", { class: "chart-wrap" }, svg);
}

function completionTable(stats) {
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "data-table" },
      h("caption", { class: "sr-only", text: "直近14日の完了数" }),
      h("thead", null, h("tr", null, h("th", { scope: "col", text: "日付" }), h("th", { scope: "col", text: "完了数" }))),
      h(
        "tbody",
        null,
        ...stats.series.map((point) =>
          h("tr", null, h("th", { scope: "row", text: formatDateJP(point.date) }), h("td", { text: String(point.count) }))
        )
      )
    )
  );
}

/* ---------------- 優先度・プロジェクト・タグ ---------------- */

function horizontalBar(label, value, max, color, note) {
  const ratio = max === 0 ? 0 : value / max;
  return h(
    "div",
    { class: "hbar-row" },
    h("span", { class: "hbar-label", text: label }),
    h(
      "div",
      { class: "hbar-track" },
      h("div", { class: "hbar-fill", style: { width: `${Math.max(ratio * 100, value > 0 ? 2 : 0)}%`, background: color } })
    ),
    h("span", { class: "hbar-value", text: note ?? String(value) })
  );
}

function priorityChart(stats) {
  const max = Math.max(1, ...stats.priorityBreakdown.map((p) => p.count));
  if (stats.priorityBreakdown.every((p) => p.count === 0)) {
    return h("p", { class: "card-empty", text: "未完了のタスクはありません" });
  }
  return h(
    "div",
    { class: "hbars" },
    ...stats.priorityBreakdown.map((item) =>
      horizontalBar(item.label, item.count, max, PRIORITY_VAR[item.value], `${item.count} 件`)
    )
  );
}

function projectList(stats) {
  if (stats.projectBreakdown.length === 0) {
    return h("p", { class: "card-empty", text: "プロジェクトを作るとここに進捗が出ます" });
  }
  return h(
    "div",
    { class: "hbars" },
    ...stats.projectBreakdown.map((p) =>
      horizontalBar(p.name, p.done, p.total, p.color, `${p.done}/${p.total}（${Math.round(p.ratio * 100)}%）`)
    )
  );
}

function tagList(stats) {
  if (stats.tagBreakdown.length === 0) {
    return h("p", { class: "card-empty", text: "タグを付けるとここに集計が出ます" });
  }
  const max = Math.max(...stats.tagBreakdown.map((t) => t.count));
  return h(
    "div",
    { class: "hbars" },
    ...stats.tagBreakdown.map((t) => horizontalBar(`#${t.name}`, t.count, max, t.color, `${t.count} 件`))
  );
}
