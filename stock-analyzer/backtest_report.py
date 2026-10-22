#!/usr/bin/env python3
"""複数の実銘柄で売買ルールを過去検証し、ロスカット率などを Markdown の表にまとめる。

    python backtest_report.py                       # 既定の主要30銘柄・5年
    python backtest_report.py 7203.T 6758.T --period 10y --out report.md

GitHub Actions（.github/workflows/stock-analyzer.yml）からも実行し、結果を Summary に出す。
"""

from __future__ import annotations

import argparse
import sys
import time

import numpy as np
import pandas as pd

from buy import OPEN, backtest_buy
from common import ensure_closed_bars, fetch_prices

# 東証プライムの主要銘柄（業種が偏らないように選んだもの）
DEFAULT_TICKERS = [
    "7203.T", "6758.T", "9984.T", "8306.T", "6861.T", "9432.T", "8035.T", "6098.T", "4063.T", "9983.T",
    "7974.T", "8058.T", "8001.T", "6501.T", "6367.T", "4502.T", "4568.T", "6902.T", "7267.T", "8766.T",
    "9433.T", "6954.T", "6273.T", "4519.T", "8316.T", "9201.T", "9202.T", "7741.T", "6594.T", "2914.T",
]


def trade_rows(ticker: str, df: pd.DataFrame) -> list[dict]:
    rows = []
    for t in backtest_buy(df, ticker):
        entry_i, exit_i = df.index.get_loc(t.entry_date), df.index.get_loc(t.exit_date)
        rows.append({
            "ticker": ticker, "wave": t.wave, "entry_date": t.entry_date, "exit_date": t.exit_date,
            "entry": t.entry, "exit": t.exit, "ret": t.ret, "days": exit_i - entry_i,
            "kind": "保有中" if t.reason == OPEN else "ロスカット" if t.reason == "ロスカット" else "利益確定",
            "reason": t.reason,
        })
    return rows


def pct(x: float) -> str:
    return "-" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:+.1%}"


def build_report(trades: pd.DataFrame, per_ticker: list[dict], failed: dict[str, str], period: str) -> str:
    lines = [f"# 75日線トレード 過去検証レポート（{period}・{len(per_ticker)}銘柄）", ""]
    closed = trades[trades["kind"] != "保有中"] if len(trades) else trades
    if closed.empty:
        lines.append("決済済みの取引がありませんでした。")
    else:
        r = closed["ret"]
        wins, losses = r[r > 0], r[r <= 0]
        stops = closed[closed["kind"] == "ロスカット"]
        lines += [
            "## 全体",
            "",
            "| 項目 | 値 |",
            "|---|---|",
            f"| 取引回数（決済済み） | {len(closed)} |",
            f"| 勝率 | {(r > 0).mean():.0%} |",
            f"| 平均リターン | {pct(r.mean())} |",
            f"| 平均利益 / 平均損失 | {pct(wins.mean() if len(wins) else np.nan)} / {pct(losses.mean() if len(losses) else np.nan)} |",
            f"| 損益比 | {wins.mean() / -losses.mean():.2f} |" if len(wins) and len(losses) and losses.mean() < 0 else "| 損益比 | - |",
            f"| **ロスカット率** | **{len(stops) / len(closed):.0%}** |",
            f"| ロスカットまでの日数（中央値） | {stops['days'].median():.0f}営業日 |" if len(stops) else "| ロスカットまでの日数 | - |",
            f"| 買った翌営業日にロスカット | {(stops['days'] <= 1).sum()}回（ロスカットの {(stops['days'] <= 1).mean():.0%}） |" if len(stops) else "",
            f"| 保有日数（中央値） | {closed['days'].median():.0f}営業日 |",
            f"| 保有中（未決済） | {(trades['kind'] == '保有中').sum()} |",
            "",
            "## 売った理由",
            "",
            "| 理由 | 回数 | 勝率 | 平均リターン | 保有日数（中央値） |",
            "|---|---|---|---|---|",
        ]
        for reason, g in closed.groupby("reason"):
            lines.append(f"| {reason} | {len(g)} | {(g['ret'] > 0).mean():.0%} | {pct(g['ret'].mean())} | {g['days'].median():.0f} |")
        lines += ["", "## 買いの種類", "", "| 波 | 回数 | 勝率 | 平均リターン | ロスカット率 |", "|---|---|---|---|---|"]
        for wave, g in closed.groupby("wave"):
            lines.append(f"| {wave} | {len(g)} | {(g['ret'] > 0).mean():.0%} | {pct(g['ret'].mean())} | {(g['kind'] == 'ロスカット').mean():.0%} |")

    lines += ["", "## 銘柄別", "", "| 銘柄 | 期間 | 取引 | 勝率 | 平均リターン | ロスカット率 |", "|---|---|---|---|---|---|"]
    for row in per_ticker:
        lines.append(f"| {row['ticker']} | {row['span']} | {row['trades']} | {row['win_rate']} | {row['avg']} | {row['stop_rate']} |")
    if failed:
        lines += ["", "## 取得できなかった銘柄", ""] + [f"- {t}: {e}" for t, e in failed.items()]
    lines += ["", "手数料・スリッページ・配当は含みません。過去の検証であり、将来の利益を保証するものではありません。"]
    return "\n".join(line for line in lines if line is not None)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="複数の実銘柄で売買ルールを過去検証する")
    p.add_argument("tickers", nargs="*", default=DEFAULT_TICKERS, help="銘柄コード（省略時は主要30銘柄）")
    p.add_argument("--period", default="5y", help="取得期間 [既定: 5y]")
    p.add_argument("--out", help="Markdown のレポートを書き出すファイル")
    p.add_argument("--csv", help="全取引の一覧を書き出す CSV ファイル")
    args = p.parse_args(argv)

    all_rows, per_ticker, failed = [], [], {}
    for t in args.tickers:
        try:
            df, _ = ensure_closed_bars(fetch_prices(t, args.period), t)
            rows = trade_rows(t, df)
        except Exception as e:  # 1銘柄の失敗で全体を止めない
            failed[t] = str(e)
            print(f"{t}: エラー {e}", file=sys.stderr)
            continue
        closed = [r for r in rows if r["kind"] != "保有中"]
        rets = np.array([r["ret"] for r in closed])
        per_ticker.append({
            "ticker": t, "span": f"{df.index[0]:%Y-%m}〜{df.index[-1]:%Y-%m}", "trades": len(closed),
            "win_rate": f"{(rets > 0).mean():.0%}" if len(rets) else "-",
            "avg": pct(rets.mean()) if len(rets) else "-",
            "stop_rate": f"{np.mean([r['kind'] == 'ロスカット' for r in closed]):.0%}" if closed else "-",
        })
        all_rows += rows
        print(f"{t}: 取引 {len(closed)}回", file=sys.stderr)
        time.sleep(0.5)  # Yahoo への連続アクセスを控えめにする

    trades = pd.DataFrame(all_rows)
    report = build_report(trades, per_ticker, failed, args.period)
    print(report)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(report + "\n")
    if args.csv and len(trades):
        trades.to_csv(args.csv, index=False, encoding="utf-8-sig")
    return 0 if per_ticker else 1


if __name__ == "__main__":
    sys.exit(main())
