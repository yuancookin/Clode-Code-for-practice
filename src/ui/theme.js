import { store } from "../store.js";

/** 設定に応じて data-theme と アクセント色を反映する */
export function applyTheme() {
  const { theme, accent } = store.data.settings;
  const root = document.documentElement;

  if (theme === "auto") root.removeAttribute("data-theme");
  else root.dataset.theme = theme;

  root.style.setProperty("--accent", accent);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = accent;
}

/** 明→暗→自動 の順に切り替える */
export function cycleTheme() {
  const order = ["auto", "light", "dark"];
  const current = store.data.settings.theme;
  const next = order[(order.indexOf(current) + 1) % order.length];
  store.updateSettings({ theme: next });
  applyTheme();
  return next;
}

export function themeLabel(theme = store.data.settings.theme) {
  return { auto: "自動（OS に合わせる）", light: "ライト", dark: "ダーク" }[theme] ?? theme;
}
