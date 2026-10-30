#!/usr/bin/env python3
"""多数の銘柄に買いの判定をかけ、候補を Markdown の表にまとめる（スクリーニング）。

    python screen.py                     # 既定の主要60銘柄
    python screen.py 7203.T 6758.T --out screen.md

GitHub Actions（.github/workflows/stock-analyzer.yml）からも実行し、結果を Summary に出す。
"""

from __future__ import annotations

import argparse
import sys
import time

from buy import STATUS_ORDER, BuyAnalysis, analyze_buy, position_size, size_text
from common import ensure_closed_bars, fetch_prices, fmt_date, fmt_price, is_japan

# 東証プライムの主要銘柄（backtest_report の30銘柄＋30銘柄）
DEFAULT_TICKERS = [
    "7203.T", "6758.T", "9984.T", "8306.T", "6861.T", "9432.T", "8035.T", "6098.T", "4063.T", "9983.T",
    "7974.T", "8058.T", "8001.T", "6501.T", "6367.T", "4502.T", "4568.T", "6902.T", "7267.T", "8766.T",
    "9433.T", "6954.T", "6273.T", "4519.T", "8316.T", "9201.T", "9202.T", "7741.T", "6594.T", "2914.T",
    "6981.T", "6762.T", "6752.T", "6503.T", "7011.T", "7751.T", "4661.T", "4452.T", "2802.T", "3382.T",
    "8411.T", "8591.T", "8802.T", "8801.T", "9020.T", "9022.T", "5108.T", "5401.T", "4901.T", "6702.T",
    "6701.T", "6146.T", "6857.T", "7733.T", "4543.T", "8031.T", "8053.T", "2502.T", "4911.T", "9101.T",
]

# 一覧に載せる判定（対象外・ウォッチは件数だけ数える）
LISTED = ("order", "turn_wait", "filled", "late")


def detail(a: BuyAnalysis, risk: float, capital: float) -> list[str]:
    japan = is_japan(a.ticker)
    lines = [f"### {a.ticker}　{a.status_label}【{a.wave}】評価 {a.grade}", "", a.summary, ""]
    if a.elapsed_text:
        lines += [f"- 経過: {a.elapsed_text}"]
    for c in a.checks:
        mark = ("✅" if c.ok else "❌") if c.required else ("➕" if c.ok else "・")
        lines.append(f"- {mark} {c.text}")
    if a.order:
        o = a.order
        size = position_size(o, japan, risk, capital)
        lines += [
            "",
            f"- **逆指値（買い）: {fmt_price(o.trigger, japan)} 以上**で買い（{o.basis}）、有効期限 {fmt_date(o.expires)}",
            f"- **ロスカット目安: {fmt_price(o.stop, japan)} 以下**（約定日の75日線−1呼値で確定）",
            f"- 株数の目安: {size_text(size, o.trigger, japan)}" if size.shares is not None else "",
        ]
    return [line for line in lines if line != ""] + [""]


def build_report(results: list[BuyAnalysis], failed: dict[str, str], risk: float, capital: float) -> str:
    dates = sorted({a.date for a in results})
    last = fmt_date(dates[-1]) if dates else "-"
    counts = {s: sum(a.effective_status == s for a in results) for s in STATUS_ORDER}
    lines = [
        f"# 買い候補スクリーニング（{last} 終値・{len(results)}銘柄）",
        "",
        "| 判定 | 件数 |", "|---|---|",
        *[f"| {s} | {n} |" for s, n in (
            ("買い注文を出す", counts["order"]), ("トレンド転換待ち", counts["turn_wait"]),
            ("上抜け済み", counts["filled"]), ("見送り（時間経過）", counts["late"]),
            ("ウォッチリスト", counts["watch"]), ("対象外", counts["avoid"]),
        )],
        "",
    ]
    listed = sorted((a for a in results if a.effective_status in LISTED),
                    key=lambda a: (a.is_stale, STATUS_ORDER.index(a.effective_status), a.wave != "2回目以降の波", a.grade))
    if not listed:
        lines.append("買い注文・転換待ち・上抜け済みの銘柄はありませんでした。")
    else:
        lines += ["## 候補一覧", "",
                  "| 銘柄 | 判定 | 波 | 評価 | 終値 | 逆指値（買い） | ロスカット目安 | 有効期限 |",
                  "|---|---|---|---|---|---|---|---|"]
        for a in listed:
            j = is_japan(a.ticker)
            o = a.order
            lines.append(f"| {a.ticker} | {a.status_label} | {a.wave} | {a.grade} | {fmt_price(a.close, j)} | "
                         f"{fmt_price(o.trigger, j) if o else ''} | {fmt_price(o.stop, j) if o else ''} | "
                         f"{fmt_date(o.expires)[5:] if o else ''} |")
        lines += ["", "## 詳細", ""]
        for a in listed:
            lines += detail(a, risk, capital)
    stale = [a.ticker for a in results if a.is_stale]
    if stale:
        lines += ["", f"⚠ 最新の終値でないデータ: {', '.join(stale)}"]
    if failed:
        lines += ["", "## 取得できなかった銘柄", ""] + [f"- {t}: {e}" for t, e in failed.items()]
    lines += ["", "本レポートの判定は投資助言ではありません。最終判断はご自身で行ってください。"]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="多数の銘柄に買いの判定をかけて候補をまとめる")
    p.add_argument("tickers", nargs="*", default=DEFAULT_TICKERS, help="銘柄コード（省略時は主要60銘柄）")
    p.add_argument("--period", default="2y", help="取得期間 [既定: 2y]")
    p.add_argument("--risk", type=float, default=10_000, help="許容リスク額 [既定: 10,000]")
    p.add_argument("--capital", type=float, default=500_000, help="1銘柄の投資上限 [既定: 500,000]")
    p.add_argument("--out", help="Markdown のレポートを書き出すファイル")
    args = p.parse_args(argv)

    results, failed = [], {}
    for t in args.tickers:
        try:
            df, freshness = ensure_closed_bars(fetch_prices(t, args.period), t)
            a = analyze_buy(df, t)
            a.freshness = freshness
            results.append(a)
            print(f"{t}: {a.status_label}", file=sys.stderr)
        except Exception as e:  # 1銘柄の失敗で全体を止めない
            failed[t] = str(e)
            print(f"{t}: エラー {e}", file=sys.stderr)
        time.sleep(0.3)  # Yahoo への連続アクセスを控えめにする

    report = build_report(results, failed, args.risk, args.capital)
    print(report)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(report + "\n")
    return 0 if results else 1


if __name__ == "__main__":
    sys.exit(main())
