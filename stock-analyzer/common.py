"""データ取得・呼値・指標など、買い / 利益確定 / ロスカットの各分析で共通に使う部品。"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

MA_DAYS = 75

# ---------------------------------------------------------------------------
# データ取得
# ---------------------------------------------------------------------------


def fetch_prices(ticker: str, period: str = "2y") -> pd.DataFrame:
    """Yahoo Finance から日足の OHLCV を取得する。日本株は "7203.T" のように .T を付ける。"""
    import yfinance as yf

    df = yf.download(ticker, period=period, interval="1d", progress=False, auto_adjust=True)
    if df.empty:
        raise RuntimeError(f"{ticker} のデータを取得できませんでした（銘柄コードやネット接続を確認してください）")
    if isinstance(df.columns, pd.MultiIndex):  # yfinance は単一銘柄でも MultiIndex を返すことがある
        df.columns = df.columns.get_level_values(0)
    return df[["Open", "High", "Low", "Close", "Volume"]].dropna()


def fetch_fundamentals(ticker: str) -> dict:
    """PER / PBR / 増収率 / 増益率。取得できない項目は None。"""
    import yfinance as yf

    info = yf.Ticker(ticker).info
    return {
        "per": info.get("trailingPE"),
        "pbr": info.get("priceToBook"),
        "revenue_growth": info.get("revenueGrowth"),
        "earnings_growth": info.get("earningsGrowth"),
    }


# ---------------------------------------------------------------------------
# 呼値（値段の刻み）
# ---------------------------------------------------------------------------

# 東証の標準的な呼値。TOPIX500 構成銘柄はこれより細かい刻みがある。
JP_TICKS = (
    (3_000, 1), (5_000, 5), (30_000, 10), (50_000, 50), (300_000, 100),
    (500_000, 500), (3_000_000, 1_000), (5_000_000, 5_000), (30_000_000, 10_000), (50_000_000, 50_000),
)


def is_japan(ticker: str) -> bool:
    # デモデータ（DEMO-…）は日本株を想定した疑似データなので、円の呼値で扱う
    return ticker.upper().endswith(".T") or ticker.startswith("DEMO-")


def tick_size(price: float, japan: bool) -> float:
    if not japan:
        return 0.01
    for limit, tick in JP_TICKS:
        if price <= limit:
            return tick
    return 100_000


def price_above(x: float, japan: bool) -> float:
    """x より 1 呼値だけ上の価格（x を超える最小の注文可能価格）。75日線 2,377円 → 2,378円。"""
    t = tick_size(x, japan)
    return round(math.floor(x / t + 1e-9) * t + t, 2)


def price_below(x: float, japan: bool) -> float:
    """x より 1 呼値だけ下の価格（x を下回る最大の注文可能価格）。75日線 2,378円 → 2,377円。"""
    t = tick_size(x, japan)
    return round(math.ceil(x / t - 1e-9) * t - t, 2)


def fmt_price(p: float, japan: bool) -> str:
    return f"{p:,.0f}円" if japan else f"{p:,.2f}"


def unit_shares(japan: bool) -> int:
    return 100 if japan else 1


# ---------------------------------------------------------------------------
# 指標
# ---------------------------------------------------------------------------


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def ma_slope(ma: pd.Series, days: int = 10) -> float:
    """移動平均線の days 日間の変化率。"""
    return float(ma.iloc[-1] / ma.iloc[-1 - days] - 1)


def body_top(df: pd.DataFrame) -> pd.Series:
    return df[["Open", "Close"]].max(axis=1)


def body_bottom(df: pd.DataFrame) -> pd.Series:
    return df[["Open", "Close"]].min(axis=1)


def candle_text(df: pd.DataFrame) -> str:
    """直近のローソク足の形（ルール集 1. ローソク足の読み方）。"""
    o, h, l, c = (float(df[k].iloc[-1]) for k in ("Open", "High", "Low", "Close"))
    rng = h - l
    if rng <= 0:
        return "値動きなし"
    body, upper, lower = abs(c - o), h - max(o, c), min(o, c) - l
    kind = "陽線" if c > o else "陰線" if c < o else "十字線"
    if body <= rng * 0.1:
        return "十字線（売買拮抗・迷い）"
    if c > o and lower >= body:
        return "下ヒゲの長い陽線（売られたが買い戻された）"
    if upper >= body:
        return f"上ヒゲの長い{kind}（上昇の勢いが弱まった）"
    if body >= rng * 0.7:
        return f"大きな{kind}（一方向に強い）"
    return kind


# ---------------------------------------------------------------------------
# 注文の有効期限
# ---------------------------------------------------------------------------


def order_expiry(today: pd.Timestamp) -> pd.Timestamp:
    """今日の終値を見て出す注文の有効期限 = 翌営業日が属する週の金曜日（執行条件「今週中」）。"""
    next_day = today + pd.offsets.BDay(1)
    return (next_day + pd.Timedelta(days=4 - next_day.weekday())).normalize()


# ---------------------------------------------------------------------------
# 動作確認用の疑似データ
# ---------------------------------------------------------------------------

DEMO_SCENARIOS = {
    # 上昇 → 3段下げ → 底打ちして75日線に接近（1回目の波の買い場）
    "DEMO-1回目の波": [(0, 1000), (120, 1400), (150, 1180), (160, 1250), (180, 1020), (190, 1090), (215, 820), (255, 950)],
    # 同じ形で、75日線を上抜ける直前（買い注文を出す場面）
    "DEMO-上抜け直前": [(0, 1000), (120, 1400), (150, 1180), (160, 1250), (180, 1020), (190, 1090), (215, 820), (248, 930)],
    # 75日線の上で上昇中 → 75日線に届かない調整 → 反発（2回目以降の波）
    "DEMO-2回目の波": [(0, 900), (200, 1500), (210, 1450), (216, 1510)],
    # 一本調子の下落（対象外）
    "DEMO-下落中": [(0, 1500), (255, 900)],
}


def demo_prices(name: str, seed: int = 0) -> pd.DataFrame:
    """折れ線の節 (日, 価格) から、少しノイズを乗せた疑似 OHLCV を作る。"""
    knots = DEMO_SCENARIOS[name]
    days = knots[-1][0] + 1
    rng = np.random.default_rng(seed)
    x, y = zip(*knots)
    close = np.interp(np.arange(days), x, y) * (1 + rng.normal(0, 0.004, days))
    open_ = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, 0.003, days))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.004, days)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.004, days)))
    idx = pd.bdate_range(end=pd.Timestamp("2026-10-09"), periods=days)
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": rng.integers(300_000, 800_000, days)},
        index=idx,
    )
