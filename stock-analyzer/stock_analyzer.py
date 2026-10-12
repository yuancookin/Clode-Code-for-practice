#!/usr/bin/env python3
"""株価分析ツール: Yahoo Finance から株価を取得し、3つのテクニカル分析を組み合わせて買いシグナルを判定する。

買い分析の手法:
  1. ボリンジャーバンド (20日, ±2σ) : -2σ 付近からの反発、+2σ 超えの過熱
  2. 75日移動平均線 (中期トレンド)   : 75日線の傾きと株価の位置
  3. グランビルの法則 (25日線)       : 移動平均線と株価の関係による買い①〜④・売りの法則

MACD は買い判定には使わず、売り分析用に残している (analyze_macd)。

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


def bollinger(close: pd.Series, n: int = 20, k: float = 2.0):
    mid = sma(close, n)
    sd = close.rolling(n).std()
    return mid - k * sd, mid, mid + k * sd, sd


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    line = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
    sig = line.ewm(span=signal, adjust=False).mean()
    return line, sig, line - sig


# ---------------------------------------------------------------------------
# 分析手法（各 -2〜+2）
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


def analyze_bollinger(close: pd.Series, n: int = 20, lookback: int = 3) -> MethodResult:
    lower, mid, upper, sd = bollinger(close, n)
    price = close.iloc[-1]
    sigma = (price - mid.iloc[-1]) / sd.iloc[-1]  # 株価が中心線から何σ離れているか
    touched_lower = bool((close.iloc[-lookback - 1 : -1] <= lower.iloc[-lookback - 1 : -1]).any())
    label = f"{sigma:+.1f}σ"

    if touched_lower and price > lower.iloc[-1] and price > close.iloc[-2]:
        return MethodResult("ボリンジャーバンド", 2, f"-2σ にタッチ後、バンド内へ反発 ({label})")
    if sigma <= -2:
        return MethodResult("ボリンジャーバンド", 1, f"-2σ 割れの売られすぎ ({label})、反発待ち")
    if sigma <= -1:
        return MethodResult("ボリンジャーバンド", 1, f"-1σ〜-2σ の安値圏 ({label})")
    if sigma >= 2:
        return MethodResult("ボリンジャーバンド", -2, f"+2σ 超えで過熱 ({label})")
    if sigma >= 1:
        return MethodResult("ボリンジャーバンド", -1, f"+1σ〜+2σ の高値圏 ({label})")
    return MethodResult("ボリンジャーバンド", 0, f"バンド中央付近 ({label})")


def ma_slope(ma: pd.Series, days: int, end: int = -1) -> float:
    """移動平均線の days 日間の変化率。end で終点をずらせる。"""
    return ma.iloc[end] / ma.iloc[end - days] - 1


def analyze_ma75(close: pd.Series, n: int = 75, slope_days: int = 10, flat: float = 0.005) -> MethodResult:
    ma = sma(close, n)
    slope = ma_slope(ma, slope_days)
    above = close.iloc[-1] > ma.iloc[-1]
    trend = "上向き" if slope > flat else "下向き" if slope < -flat else "横ばい"
    pos = "上" if above else "下"
    reason = f"{n}日線は{trend} ({slope:+.1%}/{slope_days}日)、株価は{n}日線の{pos}"

    score = {("上向き", True): 2, ("横ばい", True): 1, ("上向き", False): 0,
             ("下向き", True): 0, ("横ばい", False): -1, ("下向き", False): -2}[(trend, above)]
    return MethodResult(f"{n}日移動平均線", score, reason)


def analyze_granville(close: pd.Series, n: int = 25, lookback: int = 3, slope_days: int = 5,
                      flat: float = 0.002, gap: float = 0.08) -> MethodResult:
    """グランビルの法則。移動平均線の向きと株価の位置・乖離から売買の8法則を判定する。"""
    ma = sma(close, n)
    slope_now = ma_slope(ma, slope_days)
    slope_prev = ma_slope(ma, slope_days, end=-1 - slope_days)
    dev = close / ma - 1
    cross_up, cross_down = crossed(close > ma, lookback)
    name = f"グランビル({n}日線)"

    if cross_up and slope_prev <= flat and slope_now >= -flat:
        return MethodResult(name, 2, "買い①: 下落していた移動平均線が横ばい〜上向きに転じ、株価が上抜け")
    if cross_up and slope_now > flat:
        return MethodResult(name, 2, "買い②: 上向きの移動平均線を一時割り込んだ後、再び上抜け")
    if slope_now > flat and (close.iloc[-5:] > ma.iloc[-5:]).all() and dev.iloc[-5:].min() < 0.02 \
            and close.iloc[-1] > close.iloc[-2]:
        return MethodResult(name, 1, "買い③: 上向きの移動平均線に近づいたが割り込まず反発")
    if slope_now < -flat and dev.iloc[-1] < -gap:
        return MethodResult(name, 1, f"買い④: 下向きの移動平均線から大きく下方乖離 ({dev.iloc[-1]:+.1%})、自律反発狙い")
    if cross_down and slope_prev >= -flat and slope_now <= flat:
        return MethodResult(name, -2, "売り①: 上昇していた移動平均線が横ばい〜下向きに転じ、株価が下抜け")
    if slope_now > flat and dev.iloc[-1] > gap:
        return MethodResult(name, -1, f"売り④: 上向きの移動平均線から大きく上方乖離 ({dev.iloc[-1]:+.1%})、過熱")
    if slope_now < -flat and close.iloc[-1] < ma.iloc[-1]:
        return MethodResult(name, -1, "下向きの移動平均線の下で推移 (売り②③の局面)")
    return MethodResult(name, 0, f"法則に該当なし (乖離 {dev.iloc[-1]:+.1%})")


def analyze_macd(close: pd.Series, lookback: int = 3) -> MethodResult:
    """売り分析用。買い判定 (BUY_METHODS) には含めない。"""
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


BUY_METHODS = (analyze_bollinger, analyze_ma75, analyze_granville)
MIN_DAYS = 90  # 75日線 + 傾き計算に必要な日数


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
    if len(close) < MIN_DAYS:
        raise ValueError(f"分析には最低{MIN_DAYS}営業日分のデータが必要です（--period を長くしてください）")
    results = [m(close) for m in BUY_METHODS]
    return results, sum(r.score for r in results)


def backtest(close: pd.Series, hold: int = 20, threshold: int = 2) -> dict | None:
    """過去の各日で同じ判定をし、総合スコアが threshold 以上だった日の hold 日後リターンを集計する。"""
    rets = []
    for i in range(MIN_DAYS, len(close) - hold):
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
    p = argparse.ArgumentParser(description="ボリンジャーバンド・75日移動平均線・グランビルの法則で株の買いシグナルを判定します")
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
