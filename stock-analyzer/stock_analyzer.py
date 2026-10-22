#!/usr/bin/env python3
"""75日線トレード分析ツール。

  python stock_analyzer.py buy 7203.T 6758.T            買いの判定・評価・逆指値の価格
  python stock_analyzer.py buy 7203.T --backtest        買いルールの過去検証

利益確定 (profit) とロスカット (losscut) は今後追加する。
※ 投資判断の参考情報であり、将来の値動きを保証するものではありません。
"""

from __future__ import annotations

import argparse
import sys

from buy import (
    MIN_VOLUME, STATUS_ORDER, BuyAnalysis, analyze_buy, backtest_buy, fundamentals_check, position_size,
    summarize,
)
from common import DEMO_SCENARIOS, demo_prices, ensure_closed_bars, fetch_prices, fmt_date, fmt_price, is_japan

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


def print_backtest(df, ticker: str, hold: int, min_volume: int) -> None:
    s = summarize(backtest_buy(df, ticker, hold, min_volume))
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
    print(f"           （出口は仮: ロスカット or {hold}日後の終値。手数料・スリッページは含まない）")


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
                print_backtest(df, name, args.hold, args.min_volume)
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
    b.add_argument("--hold", type=int, default=20, help="検証での仮の保有日数 [既定: 20]")
    b.add_argument("--demo", action="store_true", help="ネット接続なしで疑似データを使って動作確認する")
    b.set_defaults(func=cmd_buy)

    args = p.parse_args(argv)
    if args.command == "buy" and not args.tickers and not args.demo:
        b.error("銘柄コードを指定するか --demo を付けてください")
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
