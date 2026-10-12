#!/usr/bin/env python3
"""株価分析ツール: Yahoo Finance から株価を取得し、3つのテクニカル分析を組み合わせて買いシグナルを判定する。

分析手法:
  1. 移動平均線 (トレンド)     : 短期/長期SMAのゴールデンクロス・並び
  2. RSI (オシレーター)        : 売られすぎからの反発
  3. MACD (モメンタム)         : MACDとシグナル線のクロス・ヒストグラムの向き

各手法が -2〜+2 のスコアを出し、合計 (-6〜+6) で総合判定する。
※ 投資判断の参考情報であり、将来の値動きを保証するものではありません。
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# データ取得
# ---------------------------------------------------------------------------


def fetch_prices(ticker: str, period: str = "1y") -> pd.DataFrame:
    """Yahoo Finance から日足の OHLCV を取得する。日本株は "7203.T" のように .T を付ける。"""
    import yfinance as yf

    df = yf.download(ticker, period=period, interval="1d", progress=False, auto_adjust=True)
    if df.empty:
        raise RuntimeError(f"{ticker} のデータを取得できませんでした（銘柄コードやネット接続を確認してください）")
    if isinstance(df.columns, pd.MultiIndex):  # yfinance は単一銘柄でも MultiIndex を返すことがある
        df.columns = df.columns.get_level_values(0)
    return df[["Open", "High", "Low", "Close", "Volume"]].dropna()


def demo_prices(seed: int = 0, days: int = 300) -> pd.DataFrame:
    """ネット接続なしで動作確認するための疑似株価（ランダムウォーク）。"""
    rng = np.random.default_rng(seed)
    close = 1000 * np.exp(np.cumsum(rng.normal(0.0004, 0.015, days)))
    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=days)
    return pd.DataFrame(
        {
            "Open": close * (1 + rng.normal(0, 0.003, days)),
            "High": close * 1.01,
            "Low": close * 0.99,
            "Close": close,
            "Volume": rng.integers(1_000_000, 5_000_000, days),
        },
        index=idx,
    )


# ---------------------------------------------------------------------------
# 指標計算
# ---------------------------------------------------------------------------


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    """Wilder の平滑化による RSI。"""
    diff = close.diff()
    gain = diff.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    loss = (-diff.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(100)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    line = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
    sig = line.ewm(span=signal, adjust=False).mean()
    return line, sig, line - sig


# ---------------------------------------------------------------------------
# 3つの分析手法（各 -2〜+2）
# ---------------------------------------------------------------------------


@dataclass
class MethodResult:
    name: str
    score: int
    reason: str


def crossed(above: pd.Series, lookback: int) -> tuple[bool, bool]:
    """直近 lookback 日以内に上抜け / 下抜けがあったか。above は「AがBより上か」の真偽系列。"""
    prev = above.shift(1, fill_value=above.iloc[0])
    up = (above & ~prev).iloc[-lookback:].any()
    down = (~above & prev).iloc[-lookback:].any()
    return bool(up), bool(down)


def analyze_moving_average(close: pd.Series, short: int = 25, long: int = 75, lookback: int = 5) -> MethodResult:
    s, l = sma(close, short), sma(close, long)
    above = s > l
    golden, dead = crossed(above, lookback)
    price = close.iloc[-1]

    if golden:
        return MethodResult("移動平均線", 2, f"直近{lookback}日以内にゴールデンクロス (SMA{short} が SMA{long} を上抜け)")
    if dead:
        return MethodResult("移動平均線", -2, f"直近{lookback}日以内にデッドクロス (SMA{short} が SMA{long} を下抜け)")
    if above.iloc[-1] and price > s.iloc[-1]:
        return MethodResult("移動平均線", 1, f"上昇トレンド (株価 > SMA{short} > SMA{long})")
    if not above.iloc[-1] and price < s.iloc[-1]:
        return MethodResult("移動平均線", -1, f"下降トレンド (株価 < SMA{short} < SMA{long})")
    return MethodResult("移動平均線", 0, "トレンド不明瞭")


def analyze_rsi(close: pd.Series, n: int = 14) -> MethodResult:
    r = rsi(close, n)
    now, prev = r.iloc[-1], r.iloc[-2]
    if r.iloc[-6:-1].min() < 30 and now > prev:
        return MethodResult("RSI", 2, f"売られすぎ(30未満)から反発中 (RSI {now:.1f})")
    if now < 30:
        return MethodResult("RSI", 1, f"売られすぎ圏 (RSI {now:.1f})、反発待ち")
    if now > 70:
        return MethodResult("RSI", -2, f"買われすぎ圏 (RSI {now:.1f})")
    if now > 60:
        return MethodResult("RSI", -1, f"やや過熱 (RSI {now:.1f})")
    return MethodResult("RSI", 0, f"中立 (RSI {now:.1f})")


def analyze_macd(close: pd.Series, lookback: int = 3) -> MethodResult:
    line, sig, hist = macd(close)
    above = line > sig
    crossed_up, crossed_down = crossed(above, lookback)
    rising = hist.iloc[-1] > hist.iloc[-2]

    if crossed_up:
        where = "0より下" if line.iloc[-1] < 0 else "0より上"
        return MethodResult("MACD", 2, f"直近{lookback}日以内にシグナル線を上抜け ({where}でのクロス)")
    if crossed_down:
        return MethodResult("MACD", -2, f"直近{lookback}日以内にシグナル線を下抜け")
    if above.iloc[-1]:
        return MethodResult("MACD", 1 if rising else 0, "MACD > シグナル" + ("、ヒストグラム拡大中" if rising else "、勢い鈍化"))
    return MethodResult("MACD", 0 if rising else -1, "MACD < シグナル" + ("、下げ止まりの兆し" if rising else "、下落の勢い継続"))


METHODS = (analyze_moving_average, analyze_rsi, analyze_macd)


# ---------------------------------------------------------------------------
# 総合判定
# ---------------------------------------------------------------------------


def verdict(total: int) -> str:
    if total >= 4:
        return "強い買い"
    if total >= 2:
        return "買い"
    if total <= -4:
        return "強い売り"
    if total <= -2:
        return "売り"
    return "様子見"


def analyze(close: pd.Series) -> tuple[list[MethodResult], int]:
    if len(close) < 80:
        raise ValueError("分析には最低80営業日分のデータが必要です（--period を長くしてください）")
    results = [m(close) for m in METHODS]
    return results, sum(r.score for r in results)


def backtest(close: pd.Series, hold: int = 20, threshold: int = 2) -> dict | None:
    """過去の各日で同じ判定をし、総合スコアが threshold 以上だった日の hold 日後リターンを集計する。"""
    rets = []
    for i in range(80, len(close) - hold):
        _, total = analyze(close.iloc[: i + 1])
        if total >= threshold:
            rets.append(close.iloc[i + hold] / close.iloc[i] - 1)
    if not rets:
        return None
    rets = np.array(rets)
    return {"signals": len(rets), "win_rate": float((rets > 0).mean()), "avg_return": float(rets.mean()), "hold": hold}


def report(ticker: str, df: pd.DataFrame, run_backtest: bool) -> int:
    close = df["Close"]
    results, total = analyze(close)
    print(f"\n=== {ticker}  ({df.index[-1]:%Y-%m-%d} 終値 {close.iloc[-1]:,.2f}) ===")
    for r in results:
        print(f"  [{r.score:+d}] {r.name}: {r.reason}")
    print(f"  総合スコア {total:+d} / ±6  →  判定: {verdict(total)}")
    if run_backtest:
        bt = backtest(close)
        if bt:
            print(
                f"  過去検証: 買いシグナル {bt['signals']} 回 / {bt['hold']}日後の勝率 {bt['win_rate']:.0%}"
                f" / 平均リターン {bt['avg_return']:+.2%}"
            )
        else:
            print("  過去検証: 期間内に買いシグナルなし")
    return total


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="3つのテクニカル分析で株の買いシグナルを判定します")
    p.add_argument("tickers", nargs="*", help='銘柄コード (例: 7203.T AAPL)')
    p.add_argument("--period", default="1y", help="取得期間 (例: 6mo, 1y, 2y, 5y) [既定: 1y]")
    p.add_argument("--backtest", action="store_true", help="過去データで買いシグナルの成績を検証する")
    p.add_argument("--demo", action="store_true", help="ネット接続なしで疑似データを使って動作確認する")
    args = p.parse_args(argv)

    if not args.tickers and not args.demo:
        p.error("銘柄コードを指定するか --demo を付けてください")

    ranking = []
    sources = [(f"DEMO-{i}", lambda i=i: demo_prices(seed=i)) for i in range(3)] if args.demo else [
        (t, lambda t=t: fetch_prices(t, args.period)) for t in args.tickers
    ]
    for name, load in sources:
        try:
            ranking.append((report(name, load(), args.backtest), name))
        except Exception as e:  # 1銘柄の失敗で全体を止めない
            print(f"\n=== {name} ===\n  エラー: {e}", file=sys.stderr)

    if len(ranking) > 1:
        print("\n=== 買い候補ランキング ===")
        for total, name in sorted(ranking, reverse=True):
            print(f"  {name:<10} {total:+d}  {verdict(total)}")
    print("\n※ 本ツールの判定は投資助言ではありません。最終判断はご自身で行ってください。")
    return 0 if ranking else 1


if __name__ == "__main__":
    sys.exit(main())
