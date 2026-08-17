import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createTask,
  describeRepeat,
  isOverdue,
  migrate,
  nextOccurrence,
  normalizeRepeat,
  normalizeTask,
  SCHEMA_VERSION,
  subtaskProgress,
} from "../src/model.js";

describe("normalizeTask", () => {
  it("欠けたフィールドを既定値で埋める", () => {
    const task = normalizeTask({ title: "テスト" });
    assert.equal(task.status, "todo");
    assert.equal(task.priority, 0);
    assert.deepEqual(task.tagIds, []);
    assert.deepEqual(task.subtasks, []);
    assert.equal(task.due, null);
    assert.equal(task.archived, false);
    assert.ok(task.id);
    assert.ok(task.createdAt);
  });

  it("不正な値を捨てる", () => {
    const task = normalizeTask({
      title: 123,
      status: "unknown",
      priority: 99,
      due: "2026/08/17",
      dueTime: "25:00",
      tagIds: "not-an-array",
      subtasks: [{ title: "a", done: "yes" }],
    });
    assert.equal(task.title, "");
    assert.equal(task.status, "todo");
    assert.equal(task.priority, 3);
    assert.equal(task.due, null);
    assert.equal(task.dueTime, null);
    assert.deepEqual(task.tagIds, []);
    assert.equal(task.subtasks[0].done, true);
    assert.ok(task.subtasks[0].id);
  });

  it("完了状態と完了日時の整合を取る", () => {
    const done = normalizeTask({ title: "x", status: "done" });
    assert.ok(done.completedAt);

    const reopened = normalizeTask({ title: "x", status: "todo", completedAt: 1000 });
    assert.equal(reopened.completedAt, null);
  });
});

describe("migrate", () => {
  it("旧 Todo アプリのデータを取り込む", () => {
    const state = migrate(null, {
      todos: [
        { id: "a", text: "牛乳を買う", completed: false, dueDate: "2026-08-20", tagId: "t1" },
        { id: "b", text: "掃除", completed: true },
      ],
      tags: [{ id: "t1", name: "買い物", color: "#ad1457" }],
    });

    assert.equal(state.version, SCHEMA_VERSION);
    assert.equal(state.tasks.length, 2);
    assert.equal(state.tasks[0].title, "牛乳を買う");
    assert.equal(state.tasks[0].due, "2026-08-20");
    assert.deepEqual(state.tasks[0].tagIds, ["t1"]);
    assert.equal(state.tasks[1].status, "done");
    assert.equal(state.tags.length, 1);
  });

  it("存在しないタグ・プロジェクト参照を取り除く", () => {
    const state = migrate({
      version: 3,
      tasks: [{ id: "a", title: "x", tagIds: ["missing"], projectId: "missing" }],
      projects: [],
      tags: [],
      completions: [],
    });
    assert.deepEqual(state.tasks[0].tagIds, []);
    assert.equal(state.tasks[0].projectId, null);
  });

  it("空データでも壊れない", () => {
    const state = migrate(null, null);
    assert.deepEqual(state.tasks, []);
    assert.ok(state.settings.pomodoro.work > 0);
  });
});

describe("nextOccurrence", () => {
  it("毎日 / N日ごと", () => {
    assert.equal(nextOccurrence({ type: "daily", every: 1 }, "2026-08-17"), "2026-08-18");
    assert.equal(nextOccurrence({ type: "daily", every: 3 }, "2026-08-30"), "2026-09-02");
  });

  it("平日は土日を飛ばす", () => {
    // 2026-08-21 は金曜 → 次は月曜
    assert.equal(nextOccurrence({ type: "weekday" }, "2026-08-21"), "2026-08-24");
    // 2026-08-17 は月曜 → 次は火曜
    assert.equal(nextOccurrence({ type: "weekday" }, "2026-08-17"), "2026-08-18");
  });

  it("毎週（曜日指定あり / なし）", () => {
    assert.equal(nextOccurrence({ type: "weekly", every: 1 }, "2026-08-17"), "2026-08-24");
    // 月曜起点で水・金指定 → 水曜
    assert.equal(
      nextOccurrence({ type: "weekly", every: 1, weekdays: [3, 5] }, "2026-08-17"),
      "2026-08-19"
    );
    // 金曜起点で水・金指定 → 翌週水曜
    assert.equal(
      nextOccurrence({ type: "weekly", every: 1, weekdays: [3, 5] }, "2026-08-21"),
      "2026-08-26"
    );
  });

  it("毎月・毎年", () => {
    assert.equal(nextOccurrence({ type: "monthly", every: 1 }, "2026-01-31"), "2026-02-28");
    assert.equal(nextOccurrence({ type: "yearly", every: 1 }, "2026-08-17"), "2027-08-17");
  });

  it("設定が不正なら null", () => {
    assert.equal(nextOccurrence(null, "2026-08-17"), null);
    assert.equal(nextOccurrence({ type: "bogus" }, "2026-08-17"), null);
    assert.equal(nextOccurrence({ type: "daily" }, "not-a-date"), null);
  });
});

describe("その他の派生値", () => {
  it("くり返しを日本語で説明する", () => {
    assert.equal(describeRepeat(null), "なし");
    assert.equal(describeRepeat({ type: "daily", every: 1 }), "毎日");
    assert.equal(describeRepeat({ type: "daily", every: 3 }), "3日ごと");
    assert.equal(describeRepeat({ type: "weekly", every: 1, weekdays: [1, 3] }), "毎週 月・水");
  });

  it("サブタスクの進捗を返す", () => {
    assert.equal(subtaskProgress(createTask({ title: "a" })), null);
    const task = normalizeTask({
      title: "a",
      subtasks: [{ title: "1", done: true }, { title: "2", done: false }],
    });
    assert.deepEqual(subtaskProgress(task), { done: 1, total: 2, ratio: 0.5 });
  });

  it("期限切れを判定する", () => {
    const task = normalizeTask({ title: "a", due: "2026-08-16" });
    assert.equal(isOverdue(task, "2026-08-17"), true);
    assert.equal(isOverdue(task, "2026-08-15"), false);
    assert.equal(isOverdue(normalizeTask({ title: "a", due: "2026-08-16", status: "done" }), "2026-08-17"), false);
  });

  it("くり返し設定を正規化する", () => {
    assert.equal(normalizeRepeat({ type: "unknown" }), null);
    assert.deepEqual(normalizeRepeat({ type: "weekly", every: "2", weekdays: [3, 3, 9, 1] }), {
      type: "weekly",
      every: 2,
      weekdays: [1, 3],
    });
  });
});
