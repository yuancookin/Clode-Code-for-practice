import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDays,
  addMonths,
  diffDays,
  dueTimestamp,
  formatDateJP,
  formatDuration,
  formatDueLabel,
  fromISODate,
  monthGrid,
  shiftMonth,
  toISODate,
  weekday,
} from "../src/date.js";

describe("date", () => {
  it("ISO 文字列と Date を往復できる", () => {
    assert.equal(toISODate(new Date(2026, 7, 17)), "2026-08-17");
    assert.equal(fromISODate("2026-08-17").getMonth(), 7);
    assert.equal(fromISODate("2026-08-17").getDate(), 17);
  });

  it("日をまたいだ加算ができる", () => {
    assert.equal(addDays("2026-08-31", 1), "2026-09-01");
    assert.equal(addDays("2026-01-01", -1), "2025-12-31");
    assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  });

  it("月末をはみ出す月加算は末日へ丸める", () => {
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
    assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
    assert.equal(addMonths("2026-03-15", -1), "2026-02-15");
  });

  it("日数差を計算できる", () => {
    assert.equal(diffDays("2026-08-17", "2026-08-20"), 3);
    assert.equal(diffDays("2026-08-20", "2026-08-17"), -3);
    assert.equal(diffDays("2026-08-17", "2026-08-17"), 0);
    assert.equal(diffDays("2025-12-31", "2026-01-01"), 1);
  });

  it("曜日を取得できる", () => {
    assert.equal(weekday("2026-08-17"), 1); // 月曜
    assert.equal(formatDateJP("2026-08-17"), "8/17(月)");
  });

  it("期限ラベルを相対表記にする", () => {
    const today = "2026-08-17";
    assert.equal(formatDueLabel("2026-08-17", today), "今日");
    assert.equal(formatDueLabel("2026-08-18", today), "明日");
    assert.equal(formatDueLabel("2026-08-16", today), "昨日");
    assert.equal(formatDueLabel("2026-08-14", today), "3日超過");
    assert.equal(formatDueLabel("2026-08-22", today), "5日後");
    assert.equal(formatDueLabel("2026-09-30", today), "9/30(水)");
  });

  it("月グリッドは日曜始まりの 42 日", () => {
    const grid = monthGrid("2026-08");
    assert.equal(grid.length, 42);
    assert.equal(weekday(grid[0]), 0);
    assert.ok(grid.includes("2026-08-01"));
    assert.ok(grid.includes("2026-08-31"));
  });

  it("月を前後に動かせる", () => {
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
  });

  it("時刻がなければその日の終わりを期限時刻にする", () => {
    const withTime = new Date(dueTimestamp("2026-08-17", "09:30"));
    assert.equal(withTime.getHours(), 9);
    assert.equal(withTime.getMinutes(), 30);

    const withoutTime = new Date(dueTimestamp("2026-08-17", null));
    assert.equal(withoutTime.getHours(), 23);
    assert.equal(withoutTime.getMinutes(), 59);
  });

  it("秒数を mm:ss にする", () => {
    assert.equal(formatDuration(1500), "25:00");
    assert.equal(formatDuration(59), "00:59");
    assert.equal(formatDuration(-5), "00:00");
  });
});
