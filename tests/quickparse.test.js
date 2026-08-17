import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDateToken, parseQuickAdd, parseRepeatToken } from "../src/quickparse.js";

const TODAY = "2026-08-17"; // 月曜

describe("parseDateToken", () => {
  it("相対的な語を解釈する", () => {
    assert.equal(parseDateToken("今日", TODAY), TODAY);
    assert.equal(parseDateToken("明日", TODAY), "2026-08-18");
    assert.equal(parseDateToken("明後日", TODAY), "2026-08-19");
    assert.equal(parseDateToken("昨日", TODAY), "2026-08-16");
    assert.equal(parseDateToken("来週", TODAY), "2026-08-24");
    assert.equal(parseDateToken("来月", TODAY), "2026-09-17");
  });

  it("曜日を解釈する（今日が該当日ならその日）", () => {
    assert.equal(parseDateToken("月曜", TODAY), TODAY);
    assert.equal(parseDateToken("水曜日", TODAY), "2026-08-19");
    assert.equal(parseDateToken("来週水曜", TODAY), "2026-08-26");
    assert.equal(parseDateToken("週末", TODAY), "2026-08-22");
  });

  it("N日後などの相対表現", () => {
    assert.equal(parseDateToken("3日後", TODAY), "2026-08-20");
    assert.equal(parseDateToken("2週間後", TODAY), "2026-08-31");
    assert.equal(parseDateToken("1ヶ月後", TODAY), "2026-09-17");
  });

  it("具体的な日付", () => {
    assert.equal(parseDateToken("2026-03-05", TODAY), "2026-03-05");
    assert.equal(parseDateToken("9/1", TODAY), "2026-09-01");
    assert.equal(parseDateToken("2027/1/5", TODAY), "2027-01-05");
    assert.equal(parseDateToken("8月20日", TODAY), "2026-08-20");
  });

  it("過ぎた月日は翌年とみなす", () => {
    assert.equal(parseDateToken("3/5", TODAY), "2027-03-05");
    assert.equal(parseDateToken("1月5日", TODAY), "2027-01-05");
  });

  it("日付でない語は null", () => {
    assert.equal(parseDateToken("資料", TODAY), null);
    assert.equal(parseDateToken("99/99", TODAY), null);
  });
});

describe("parseRepeatToken", () => {
  it("くり返し語を解釈する", () => {
    assert.deepEqual(parseRepeatToken("毎日"), { type: "daily", every: 1, weekdays: [] });
    assert.deepEqual(parseRepeatToken("平日"), { type: "weekday", every: 1, weekdays: [] });
    assert.deepEqual(parseRepeatToken("毎週金"), { type: "weekly", every: 1, weekdays: [5] });
    assert.deepEqual(parseRepeatToken("3日ごと"), { type: "daily", every: 3, weekdays: [] });
    assert.equal(parseRepeatToken("たまに"), null);
  });
});

describe("parseQuickAdd", () => {
  it("全部入りの入力を分解する", () => {
    const result = parseQuickAdd("資料をまとめる 明日 15:00 !高 @仕事 #会議 毎週", TODAY);
    assert.equal(result.title, "資料をまとめる");
    assert.equal(result.due, "2026-08-18");
    assert.equal(result.dueTime, "15:00");
    assert.equal(result.priority, 3);
    assert.equal(result.projectName, "仕事");
    assert.deepEqual(result.tagNames, ["会議"]);
    assert.deepEqual(result.repeat, { type: "weekly", every: 1, weekdays: [] });
  });

  it("記号なしのタスクはそのままタイトルになる", () => {
    const result = parseQuickAdd("牛乳を買う", TODAY);
    assert.equal(result.title, "牛乳を買う");
    assert.equal(result.due, null);
    assert.equal(result.priority, 0);
  });

  it("単語の一部になっている日付語は食べない", () => {
    const result = parseQuickAdd("今日の予定を立てる", TODAY);
    assert.equal(result.title, "今日の予定を立てる");
    assert.equal(result.due, null);
  });

  it("タグは複数指定できる", () => {
    const result = parseQuickAdd("打ち合わせ #会議 #緊急", TODAY);
    assert.equal(result.title, "打ち合わせ");
    assert.deepEqual(result.tagNames, ["会議", "緊急"]);
  });

  it("時刻だけなら今日の予定にする", () => {
    const result = parseQuickAdd("朝会 09:30", TODAY);
    assert.equal(result.due, TODAY);
    assert.equal(result.dueTime, "09:30");
    assert.equal(result.title, "朝会");
  });

  it("優先度は数字でも指定できる", () => {
    assert.equal(parseQuickAdd("x !2", TODAY).priority, 2);
    assert.equal(parseQuickAdd("x !低", TODAY).priority, 1);
  });

  it("空文字は空のタイトルを返す", () => {
    const result = parseQuickAdd("   ", TODAY);
    assert.equal(result.title, "");
  });

  it("最初に現れた日付だけを使う", () => {
    const result = parseQuickAdd("旅行 明日 来週", TODAY);
    assert.equal(result.due, "2026-08-18");
    assert.equal(result.title, "旅行 来週");
  });
});
