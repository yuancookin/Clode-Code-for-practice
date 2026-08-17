/**
 * 設定モーダル：テーマ・通知・ポモドーロ・データ管理。
 */

import { exportCSV, exportJSON, generateDemoData, importJSON } from "../features/backup.js";
import {
  notificationPermission,
  notificationsSupported,
  requestNotificationPermission,
} from "../features/notifications.js";
import { syncPomodoroSettings } from "../features/pomodoro.js";
import { PROJECT_COLORS } from "../model.js";
import { store } from "../store.js";
import { h } from "../utils.js";
import { closeModal, openModal } from "./modal.js";
import { applyTheme } from "./theme.js";
import { toast } from "./toast.js";

export function openSettings() {
  openModal("設定", buildBody(), { wide: true });
}

function refresh() {
  // 開いたまま内容だけ差し替える
  const body = document.querySelector(".modal .modal-body");
  if (body) body.replaceChildren(buildBody());
}

function group(title, ...children) {
  return h("section", { class: "settings-group" }, h("h3", { text: title }), ...children);
}

function buildBody() {
  const settings = store.data.settings;

  return h(
    "div",
    { class: "settings" },

    group(
      "外観",
      h(
        "div",
        { class: "radio-row", role: "radiogroup", "aria-label": "テーマ" },
        ...[
          { value: "auto", label: "自動" },
          { value: "light", label: "ライト" },
          { value: "dark", label: "ダーク" },
        ].map((option) =>
          h(
            "label",
            { class: `radio-chip${settings.theme === option.value ? " on" : ""}` },
            h("input", {
              type: "radio",
              name: "theme",
              value: option.value,
              checked: settings.theme === option.value,
              onchange: () => {
                store.updateSettings({ theme: option.value });
                applyTheme();
                refresh();
              },
            }),
            h("span", { text: option.label })
          )
        )
      ),
      h(
        "div",
        { class: "field" },
        h("span", { class: "field-label", text: "アクセントカラー" }),
        h(
          "div",
          { class: "swatches" },
          ...PROJECT_COLORS.map((color) =>
            h("button", {
              type: "button",
              class: `swatch${settings.accent === color ? " on" : ""}`,
              style: { background: color },
              "aria-label": `アクセント色 ${color}`,
              "aria-pressed": String(settings.accent === color),
              onclick: () => {
                store.updateSettings({ accent: color });
                applyTheme();
                refresh();
              },
            })
          )
        )
      )
    ),

    group("通知", buildNotificationRow(settings)),

    group(
      "ポモドーロ",
      h(
        "div",
        { class: "field-grid" },
        numberField("作業（分）", settings.pomodoro.work, 1, 180, (value) =>
          savePomodoro({ work: value })
        ),
        numberField("小休憩（分）", settings.pomodoro.short, 1, 60, (value) =>
          savePomodoro({ short: value })
        ),
        numberField("長休憩（分）", settings.pomodoro.long, 1, 120, (value) => savePomodoro({ long: value })),
        numberField("長休憩の間隔（回）", settings.pomodoro.longEvery, 2, 12, (value) =>
          savePomodoro({ longEvery: value })
        )
      )
    ),

    group(
      "操作",
      h(
        "label",
        { class: "check-row" },
        h("input", {
          type: "checkbox",
          checked: settings.confirmDelete,
          onchange: (event) => store.updateSettings({ confirmDelete: event.target.checked }),
        }),
        h("span", { text: "完全削除の前に確認する" })
      )
    ),

    group(
      "データ",
      h(
        "div",
        { class: "button-row" },
        h("button", { type: "button", class: "btn subtle", text: "JSON で書き出し", onclick: exportJSON }),
        h("button", { type: "button", class: "btn subtle", text: "CSV で書き出し", onclick: exportCSV }),
        h("button", {
          type: "button",
          class: "btn subtle",
          text: "JSON を読み込み（追加）",
          onclick: () => importJSON({ merge: true }),
        }),
        h("button", {
          type: "button",
          class: "btn subtle",
          text: "JSON を読み込み（置き換え）",
          onclick: () => {
            if (confirm("現在のデータを読み込んだ内容で置き換えます。よろしいですか？")) {
              importJSON({ merge: false });
            }
          },
        })
      ),
      h("p", { class: "field-hint", text: "データはこのブラウザの localStorage にのみ保存されます。" }),
      h(
        "div",
        { class: "button-row" },
        h("button", {
          type: "button",
          class: "btn subtle",
          text: "デモデータを200件追加",
          onclick: () => {
            generateDemoData(200);
            closeModal();
          },
        }),
        h("button", {
          type: "button",
          class: "btn danger subtle",
          text: "すべて削除",
          onclick: () => {
            if (confirm("すべてのタスク・プロジェクト・タグを削除します。よろしいですか？")) {
              store.resetAll();
              closeModal();
              toast("データを削除しました", { actionLabel: "取り消す", onAction: () => store.undo() });
            }
          },
        })
      )
    ),

    h("p", { class: "settings-foot", text: `保存件数: タスク ${store.data.tasks.length} 件 / 完了ログ ${store.data.completions.length} 件` })
  );
}

function savePomodoro(patch) {
  store.updateSettings({ pomodoro: { ...store.data.settings.pomodoro, ...patch } });
  syncPomodoroSettings();
}

function numberField(label, value, min, max, onChange) {
  return h(
    "label",
    { class: "field" },
    h("span", { class: "field-label", text: label }),
    h("input", {
      type: "number",
      min: String(min),
      max: String(max),
      value: String(value),
      onchange: (event) => onChange(Number(event.target.value)),
    })
  );
}

function buildNotificationRow(settings) {
  if (!notificationsSupported()) {
    return h("p", { class: "field-hint", text: "このブラウザは通知に対応していません（アプリ内トーストのみ表示します）。" });
  }

  const permission = notificationPermission();

  return h(
    "div",
    null,
    h(
      "label",
      { class: "check-row" },
      h("input", {
        type: "checkbox",
        checked: settings.notifications,
        onchange: async (event) => {
          if (event.target.checked) {
            const result = await requestNotificationPermission();
            store.updateSettings({ notifications: result === "granted" || result === "unsupported" });
            if (result !== "granted") {
              toast("ブラウザの通知が許可されませんでした。アプリ内トーストで知らせます", { duration: 7000 });
              store.updateSettings({ notifications: true });
            }
          } else {
            store.updateSettings({ notifications: false });
          }
          refresh();
        },
      }),
      h("span", { text: "期限のリマインダーを受け取る" })
    ),
    h("p", {
      class: "field-hint",
      text:
        permission === "granted"
          ? "デスクトップ通知が有効です。タスクごとに「リマインド」を設定してください。"
          : permission === "denied"
          ? "ブラウザ側で通知がブロックされています。アプリ内トーストのみ表示します。"
          : "有効にすると通知の許可を求めます。",
    })
  );
}
