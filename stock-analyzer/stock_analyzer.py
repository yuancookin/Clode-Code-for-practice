#!/usr/bin/env python3
"""75日線トレード分析ツール。

  python stock_analyzer.py buy 7203.T 6758.T            買いの判定・評価・逆指値の価格
  python stock_analyzer.py buy 7203.T --backtest        買いルールの過去検証
  python stock_analyzer.py position 7203.T --entry-date 2026-10-14 --entry-price 2378 --shares 100
                                                        保有銘柄の利益確定・ロスカットの判定
※ 投資判断の参考情報であり、将来の値動きを保証するものではありません。
"""

from __future__ import annotations

import argparse
import sys

from buy import (
    MIN_VOLUME, STATUS_ORDER, BuyAnalysis, analyze_buy, backtest_buy, fundamentals_check, position_size,
    summarize,
)
import pandas as pd

from common import DEMO_SCENARIOS, demo_prices, ensure_closed_bars, fetch_prices, fmt_date, fmt_price, is_japan
from inputs import load_positions, normalize_code
from position import ACTIONS, DEMO_POSITIONS, Position, PositionAnalysis, analyze_position, demo_position

DISCLAIMER = "※ 本ツールの判定は投資助言ではありません。最終判断はご自身で行ってください。"


def print_buy(a: BuyAnalysis, risk: float | None, capital: float | None = None) -> None:
    japan = is_japan(a.ticker)
    print(f"\n=== {a.ticker}  ({a.date:%Y-%m-%d} 終値 {fmt_price(a.close, japan)}) ===")
    print(f"  判定: {a.status_label}【{a.wave}】  評価: {a.grade}")
    if a.freshness:
        print(f"  {'⚠ ' if a.is_stale else ''}{a.freshness.text}")
    print(f"  {a.summary}")
    if a.elapsed_text:
        print(f"  {'⚠ ' if a.penalty else ''}経過: {a.elapsed_text}")
    for c in a.checks:
        mark = ("✓" if c.ok else "✗") if c.required else ("+" if c.ok else "・")
        print(f"   {mark} {c.text}")
    if not a.order:
        return
    o = a.order
    size = position_size(o, japan, risk, capital)
    print("  逆指値注文:")
    if a.stale_order_note:
        print(f"   ⚠ {a.stale_order_note}")
    print(f"   買い      : {fmt_price(o.trigger, japan)} 以上になったら {fmt_price(o.trigger, japan)} で買い"
          f"（{o.basis}、有効期限 {fmt_date(o.expires)} まで）")
    print(f"   ロスカット: {fmt_price(o.stop, japan)} 以下で売り（目安＝今日の75日線−1呼値。約定日の75日線で確定させる）")
    print(f"   リスク    : 1株 {fmt_price(size.per_share, japan)} → {size.unit}株で {fmt_price(size.per_share * size.unit, japan)}")
    if size.shares is not None:
        print(f"   株数の目安: {size.shares:,}株（{size.decided_by}で決定、投資額 {fmt_price(size.shares * o.trigger, japan)}）")
    if size.narrow_stop:
        hint = "" if capital else "。--capital で投資額の上限も決めておく"
        print(f"   ⚠ 損切り幅が {size.per_share / o.trigger:.1%} と狭い。窓を開けて下がると損失は想定より大きくなる{hint}")
    print("   ※ 75日線は毎日動くため、約定するまで注文価格を毎日見直す。「以上」と「以下」を逆にしない")


def print_backtest(df, ticker: str, min_volume: int) -> None:
    s = summarize(backtest_buy(df, ticker, min_volume))
    if not s:
        print("  過去検証: 期間内に約定した買いなし")
        return
    held = f"（ほかに保有中 {s['open']}件）" if s["open"] else ""
    if not s["trades"]:
        print(f"  過去検証: 決済済みの取引なし{held}")
        return
    payoff = "-" if s["payoff"] is None else f"{s['payoff']:.2f}"
    print(f"  過去検証: 取引 {s['trades']}回 / 勝率 {s['win_rate']:.0%} / 平均 {s['avg_return']:+.2%}"
          f" / 損益比 {payoff} / 最大ドローダウン {s['max_drawdown']:.1%} / ロスカット率 {s['stop_rate']:.0%}{held}")
    print("           （売りは利益確定・ロスカットのルールどおり。手数料・スリッページは含まない）")


def cmd_buy(args) -> int:
    if args.demo:
        sources = [(name, lambda name=name: demo_prices(name)) for name in DEMO_SCENARIOS]
    else:
        sources = [(t, lambda t=t: fetch_prices(t, args.period)) for t in args.tickers]

    results = []
    for name, load in sources:
        try:
            df, freshness = ensure_closed_bars(load(), name)
            a = analyze_buy(df, name, args.min_volume)
            a.freshness = freshness
            if args.fundamentals and not args.demo:
                try:
                    a.checks.append(fundamentals_check(name))
                except Exception as e:
                    print(f"  （{name} の業績データを取得できませんでした: {e}）", file=sys.stderr)
            print_buy(a, args.risk, args.capital)
            if args.backtest:
                print_backtest(df, name, args.min_volume)
            results.append(a)
        except Exception as e:  # 1銘柄の失敗で全体を止めない
            print(f"\n=== {name} ===\n  エラー: {e}", file=sys.stderr)

    if len(results) > 1:
        print("\n=== 買い候補（優先順） ===")
        for a in sorted(results, key=lambda a: (STATUS_ORDER.index(a.effective_status), a.grade)):
            price = f"  逆指値 {fmt_price(a.order.trigger, is_japan(a.ticker))}" if a.order else ""
            stale = f"  ⚠ {a.freshness.stale}営業日前のデータ" if a.is_stale else ""
            print(f"  {a.ticker:<16} {a.status_label:<10} 評価 {a.grade}{price}{stale}")
    print(f"\n{DISCLAIMER}")
    return 0 if results else 1


def print_position(r: PositionAnalysis) -> None:
    pos = r.position
    japan = is_japan(pos.ticker)
    shares = f" {pos.shares:,}株" if pos.shares else ""
    print(f"\n=== {pos.ticker}  保有{shares}（{fmt_date(pos.entry_date)} に {fmt_price(pos.entry_price, japan)} で買付） ===")
    print(f"  判定: {r.action_label}")
    if r.freshness:
        print(f"  {'⚠ ' if r.is_stale else ''}{r.freshness.text}")
    print(f"  {r.action_text}")
    print("  【ロスカット】")
    for line in r.losscut_lines:
        print(f"   ・{line}")
    print("  【利益確定】")
    for line in r.profit_lines:
        print(f"   ・{line}")


def cmd_position(args) -> int:
    if args.demo:
        jobs = [(lambda name=name: demo_position(name)) for name in DEMO_POSITIONS]
    else:
        if args.file:
            with open(args.file, "rb") as f:
                positions = load_positions(f.read(), args.file)
        else:
            positions = [Position(normalize_code(args.ticker), pd.Timestamp(args.entry_date), args.entry_price, args.shares)]
        jobs = [(lambda pos=pos: (pos, fetch_prices(pos.ticker, args.period))) for pos in positions]

    results = []
    for job in jobs:
        try:
            pos, df = job()
            df, freshness = ensure_closed_bars(df, pos.ticker)
            r = analyze_position(df, pos)
            r.freshness = freshness
            print_position(r)
            results.append(r)
        except Exception as e:  # 1銘柄の失敗で全体を止めない
            print(f"\n  エラー: {e}", file=sys.stderr)

    if len(results) > 1:
        print("\n=== 保有銘柄のまとめ ===")
        for r in sorted(results, key=lambda r: list(ACTIONS).index(r.action)):
            print(f"  {r.position.ticker:<16} {r.action_label:<8} 損益 {r.pnl:+.1%}{'（売却時）' if r.sold else ''}")
    print(f"\n{DISCLAIMER}")
    return 0 if results else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="75日線トレードのルールで株を分析します")
    sub = p.add_subparsers(dest="command", required=True)

    b = sub.add_parser("buy", help="買いの判定・評価と逆指値の価格を出す")
    b.add_argument("tickers", nargs="*", help="銘柄コード (例: 7203.T 6758.T)。日本株は .T を付ける")
    b.add_argument("--period", default="2y", help="取得期間 (例: 1y, 2y, 5y) [既定: 2y]")
    b.add_argument("--risk", type=float, help="1回の取引で許容する損失額。株数の目安を出す")
    b.add_argument("--capital", type=float, help="1銘柄あたりの投資額の上限。株数の目安を出す")
    b.add_argument("--min-volume", type=int, default=MIN_VOLUME, help=f"25日平均出来高の下限 [既定: {MIN_VOLUME:,}株]")
    b.add_argument("--fundamentals", action="store_true", help="業績（増収率・増益率・PER・PBR）も確認する")
    b.add_argument("--backtest", action="store_true", help="買いルールを過去データで検証する")
    b.add_argument("--demo", action="store_true", help="ネット接続なしで疑似データを使って動作確認する")
    b.set_defaults(func=cmd_buy)

    h = sub.add_parser("position", help="保有銘柄の利益確定・ロスカットのタイミングを判定する")
    h.add_argument("ticker", nargs="?", help="銘柄コード (例: 7203.T)")
    h.add_argument("--entry-date", help="買付日（約定日） 例: 2026-10-14")
    h.add_argument("--entry-price", type=float, help="買値（約定単価）")
    h.add_argument("--shares", type=int, help="株数（損益・リスク額の計算に使う）")
    h.add_argument("--file", help="保有銘柄の一覧（CSV / Excel。列: 銘柄, 買付日, 買値, 株数）")
    h.add_argument("--period", default="2y", help="取得期間 [既定: 2y]")
    h.add_argument("--demo", action="store_true", help="ネット接続なしで疑似データを使って動作確認する")
    h.set_defaults(func=cmd_position)

    args = p.parse_args(argv)
    if args.command == "buy" and not args.tickers and not args.demo:
        b.error("銘柄コードを指定するか --demo を付けてください")
    if args.command == "position" and not (args.demo or args.file or (args.ticker and args.entry_date and args.entry_price)):
        h.error("銘柄コードと --entry-date・--entry-price、または --file か --demo を指定してください")
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
