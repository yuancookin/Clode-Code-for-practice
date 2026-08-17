/**
 * ショートカットとクイック入力の書き方。
 */

import { h } from "../utils.js";
import { openModal } from "./modal.js";

const SHORTCUTS = [
  ["N", "タスク入力欄にフォーカス"],
  ["/", "検索にフォーカス"],
  ["Ctrl / ⌘ + K", "コマンドパレット"],
  ["Ctrl / ⌘ + Z", "元に戻す"],
  ["Ctrl / ⌘ + Shift + Z", "やり直す"],
  ["1 / 2 / 3 / 4", "リスト・ボード・カレンダー・統計に切り替え"],
  ["J / ↓", "次のタスクへ"],
  ["K / ↑", "前のタスクへ"],
  ["Enter", "詳細を開く"],
  ["Space", "完了を切り替え"],
  ["X", "複数選択に追加"],
  ["Delete", "ゴミ箱へ移動"],
  ["Ctrl / ⌘ + クリック", "複数選択"],
  ["ダブルクリック", "タイトルをその場で編集"],
  ["Esc", "詳細・モーダルを閉じる"],
  ["?", "このヘルプ"],
];

const SYNTAX = [
  ["明日 / 今日 / 明後日 / 来週", "期限をその日に設定"],
  ["月曜 / 金曜日", "次のその曜日"],
  ["3日後 / 2週間後 / 1ヶ月後", "相対的な期限"],
  ["3/5 / 2026-03-05 / 3月5日", "日付を直接指定"],
  ["15:00", "時刻（日付がなければ今日）"],
  ["!高 / !中 / !低（!3 / !2 / !1）", "優先度"],
  ["@プロジェクト名", "既存のプロジェクトに割り当て"],
  ["#タグ名", "既存のタグを付ける"],
  ["毎日 / 平日 / 毎週 / 毎週月 / 毎月 / 毎年 / 3日ごと", "くり返し設定"],
];

function table(caption, rows, keyHeader) {
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "data-table" },
      h("caption", { text: caption }),
      h("thead", null, h("tr", null, h("th", { scope: "col", text: keyHeader }), h("th", { scope: "col", text: "動作" }))),
      h(
        "tbody",
        null,
        ...rows.map(([key, description]) =>
          h("tr", null, h("th", { scope: "row" }, h("kbd", { text: key })), h("td", { text: description }))
        )
      )
    )
  );
}

export function openHelp() {
  openModal(
    "使い方とショートカット",
    h(
      "div",
      { class: "help" },
      table("キーボードショートカット", SHORTCUTS, "キー"),
      table("クイック入力の書き方", SYNTAX, "入力例"),
      h("p", {
        class: "field-hint",
        text: "例）「提案書をまとめる 明日 15:00 !高 @仕事 #会議」と入力すると、期限・時刻・優先度・プロジェクト・タグが自動で設定されます。日付やくり返しの語は、前後に空白があるときだけ解釈されます。",
      })
    ),
    { wide: true }
  );
}
