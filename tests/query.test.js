import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultUIState, normalizeTask } from "../src/model.js";
import { computeStats, filterTasks, groupTasks, scopeCounts, sortTasks } from "../src/query.js";

const TODAY = "2026-08-17";

function makeData() {
  const tasks = [
    { id: "1", title: "期限切れの仕事", due: "2026-08-10", priority: 3, projectId: "p1", order: 1 },
    { id: "2", title: "今日の買い物", due: TODAY, priority: 1, tagIds: ["g1"], order: 2 },
    { id: "3", title: "来週の準備", due: "2026-08-22", priority: 2, projectId: "p1", order: 3 },
    { id: "4", title: "いつかやる", due: null, priority: 0, order: 4 },
    { id: "5", title: "完了ずみ", due: "2026-08-15", status: "done", order: 5 },
    { id: "6", title: "アーカイブ済み", archived: true, order: 6 },
    { id: "7", title: "ゴミ箱の中", deletedAt: Date.now(), order: 7 },
    { id: "8", title: "ずっと先", due: "2026-12-01", order: 8 },
  ].map(normalizeTask);

  return {
    version: 3,
    tasks,
    projects: [{ id: "p1", name: "仕事", color: "#ad1457", order: 0, archived: false }],
    tags: [{ id: "g1", name: "買い物", color: "#2a78d6" }],
    completions: [],
    settings: {},
  };
}

function ui(patch = {}) {
  return { ...defaultUIState(), ...patch };
}

describe("filterTasks", () => {
  const data = makeData();

  it("既定ではゴミ箱・アーカイブ・完了を隠す", () => {
    const result = filterTasks(data, ui({ scope: "all" }), TODAY);
    const titles = result.map((t) => t.title);
    assert.ok(!titles.includes("ゴミ箱の中"));
    assert.ok(!titles.includes("アーカイブ済み"));
    assert.ok(!titles.includes("完了ずみ"));
    assert.equal(result.length, 5);
  });

  it("「完了も表示」で完了タスクが出る", () => {
    const result = filterTasks(data, ui({ scope: "all", showCompleted: true }), TODAY);
    assert.ok(result.map((t) => t.title).includes("完了ずみ"));
  });

  it("今日スコープは期限切れも含む", () => {
    const result = filterTasks(data, ui({ scope: "today" }), TODAY);
    assert.deepEqual(result.map((t) => t.id).sort(), ["1", "2"]);
  });

  it("期限切れスコープ", () => {
    const result = filterTasks(data, ui({ scope: "overdue" }), TODAY);
    assert.deepEqual(result.map((t) => t.id), ["1"]);
  });

  it("今後7日間スコープは範囲外を除く", () => {
    const result = filterTasks(data, ui({ scope: "upcoming" }), TODAY);
    assert.deepEqual(result.map((t) => t.id).sort(), ["1", "2", "3"].filter((id) => id !== "1"));
  });

  it("期限なしスコープ", () => {
    const result = filterTasks(data, ui({ scope: "nodate" }), TODAY);
    assert.deepEqual(result.map((t) => t.id), ["4"]);
  });

  it("ゴミ箱とアーカイブは専用スコープでのみ見える", () => {
    assert.deepEqual(filterTasks(data, ui({ scope: "trash" }), TODAY).map((t) => t.id), ["7"]);
    assert.deepEqual(filterTasks(data, ui({ scope: "archived" }), TODAY).map((t) => t.id), ["6"]);
  });

  it("プロジェクト / タグで絞り込める", () => {
    assert.deepEqual(filterTasks(data, ui({ scope: "project:p1" }), TODAY).map((t) => t.id), ["1", "3"]);
    assert.deepEqual(filterTasks(data, ui({ scope: "tag:g1" }), TODAY).map((t) => t.id), ["2"]);
  });

  it("検索は名前・プロジェクト名・タグ名を横断する", () => {
    assert.deepEqual(filterTasks(data, ui({ scope: "all", search: "買い物" }), TODAY).map((t) => t.id), ["2"]);
    assert.deepEqual(filterTasks(data, ui({ scope: "all", search: "仕事" }), TODAY).map((t) => t.id), ["1", "3"]);
    // 複数語は AND 検索
    assert.deepEqual(filterTasks(data, ui({ scope: "all", search: "仕事 期限" }), TODAY).map((t) => t.id), ["1"]);
  });

  it("優先度で絞り込める", () => {
    assert.deepEqual(filterTasks(data, ui({ scope: "all", filterPriority: 3 }), TODAY).map((t) => t.id), ["1"]);
  });
});

describe("sortTasks", () => {
  const data = makeData();
  const open = filterTasks(data, ui({ scope: "all" }), TODAY);

  it("期限順は期限なしを末尾に置く", () => {
    const sorted = sortTasks(open, "due", "asc");
    assert.equal(sorted[0].id, "1");
    assert.equal(sorted[sorted.length - 1].id, "4");
  });

  it("優先度順は高い順", () => {
    const sorted = sortTasks(open, "priority", "asc");
    assert.equal(sorted[0].priority, 3);
  });

  it("手動順は order に従う", () => {
    const sorted = sortTasks(open, "manual", "asc");
    assert.deepEqual(sorted.map((t) => t.id), ["1", "2", "3", "4", "8"]);
  });

  it("元の配列を書き換えない", () => {
    const before = open.map((t) => t.id);
    sortTasks(open, "title", "asc");
    assert.deepEqual(open.map((t) => t.id), before);
  });
});

describe("groupTasks", () => {
  const data = makeData();
  const open = filterTasks(data, ui({ scope: "all" }), TODAY);

  it("グループ化なしなら 1 グループ", () => {
    const groups = groupTasks(open, "none", data, TODAY);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].tasks.length, open.length);
  });

  it("プロジェクト別（なしは最後）", () => {
    const groups = groupTasks(open, "project", data, TODAY);
    assert.equal(groups[0].label, "仕事");
    assert.equal(groups[groups.length - 1].label, "プロジェクトなし");
  });

  it("期限別は期限切れ→今日→…の順", () => {
    const groups = groupTasks(open, "due", data, TODAY);
    assert.deepEqual(groups.map((g) => g.label), ["期限切れ", "今日", "今週中", "それ以降", "期限なし"]);
  });
});

describe("computeStats", () => {
  it("完了ログから系列と連続日数を作る", () => {
    const data = makeData();
    const now = new Date(2026, 7, 17, 12, 0, 0).getTime();
    data.completions = [
      { at: now, taskId: "5", title: "完了ずみ", projectId: null, priority: 0 },
      { at: now - 86400000, taskId: "x", title: "きのう", projectId: null, priority: 0 },
      { at: now - 2 * 86400000, taskId: "y", title: "おととい", projectId: null, priority: 0 },
      { at: now - 5 * 86400000, taskId: "z", title: "5日前", projectId: null, priority: 0 },
    ];

    const stats = computeStats(data, TODAY, 14);
    assert.equal(stats.series.length, 14);
    assert.equal(stats.series[13].date, TODAY);
    assert.equal(stats.series[13].count, 1);
    assert.equal(stats.streak, 3);
    assert.equal(stats.completedToday, 1);
    assert.equal(stats.overdue, 1);
    assert.equal(stats.dueToday, 1);
  });

  it("完了ログがなければ連続日数は 0", () => {
    const stats = computeStats(makeData(), TODAY, 14);
    assert.equal(stats.streak, 0);
    assert.equal(stats.series.every((d) => d.count === 0), true);
  });

  it("プロジェクト別の進捗を集計する", () => {
    const stats = computeStats(makeData(), TODAY, 14);
    const project = stats.projectBreakdown.find((p) => p.id === "p1");
    assert.equal(project.total, 2);
    assert.equal(project.done, 0);
  });
});

describe("scopeCounts", () => {
  it("サイドバー用の件数を数える", () => {
    const counts = scopeCounts(makeData(), TODAY);
    assert.equal(counts.overdue, 1);
    assert.equal(counts.today, 2);
    assert.equal(counts.nodate, 1);
    assert.equal(counts.completed, 1);
    assert.equal(counts.archived, 1);
    assert.equal(counts.trash, 1);
    assert.equal(counts.projects.get("p1"), 2);
    assert.equal(counts.tags.get("g1"), 1);
  });
});
