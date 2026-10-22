"""データ取得・呼値・指標など、買い / 利益確定 / ロスカットの各分析で共通に使う部品。"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass

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


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    """MACD = 12EMA − 26EMA、シグナル = MACD の 9EMA、ヒストグラム（乖離）= MACD − シグナル。"""
    line = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
    sig = line.ewm(span=signal, adjust=False).mean()
    return line, sig, line - sig


def bollinger(close: pd.Series, n: int = 25) -> dict[str, pd.Series]:
    """ボリンジャーバンド（25日）。中心線と ±1σ・±2σ。"""
    mid, sd = sma(close, n), close.rolling(n).std()
    return {"mid": mid, "+1σ": mid + sd, "+2σ": mid + 2 * sd, "-1σ": mid - sd, "-2σ": mid - 2 * sd}


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
# 取引日・データの鮮度
# ---------------------------------------------------------------------------

# 取引所のタイムゾーンと大引けの時刻。データの配信が遅れることがあるので、少し余裕を見る
MARKETS = {True: ("Asia/Tokyo", dt.time(15, 30)), False: ("America/New_York", dt.time(16, 0))}
PUBLISH_DELAY = dt.timedelta(minutes=30)
WEEKDAYS_JP = "月火水木金土日"


def is_trading_day(d: dt.date, japan: bool) -> bool:
    """土日・祝日・年末年始（12/31〜1/3）を除いた日。米国株は土日だけ除く（米国の祝日は考慮しない）。"""
    if d.weekday() >= 5:
        return False
    if not japan:
        return True
    if (d.month, d.day) in ((12, 31), (1, 1), (1, 2), (1, 3)):
        return False
    try:
        import jpholiday
    except ImportError:  # 未インストールなら祝日は考慮しない
        return True
    return not jpholiday.is_holiday(d)


def market_now(japan: bool, now: dt.datetime | None = None) -> dt.datetime:
    """取引所の現地時刻。now にタイムゾーンが無ければ現地時刻とみなす（テスト用）。"""
    tz = MARKETS[japan][0]
    if now is None:
        return pd.Timestamp.now(tz=tz).to_pydatetime()
    ts = pd.Timestamp(now)
    return (ts.tz_localize(tz) if ts.tzinfo is None else ts.tz_convert(tz)).to_pydatetime()


def session_closed(d: dt.date, japan: bool, now: dt.datetime | None = None) -> bool:
    """d の終値が確定して配信されているか。"""
    t = market_now(japan, now)
    if d != t.date():
        return d < t.date()
    close = dt.datetime.combine(d, MARKETS[japan][1], tzinfo=t.tzinfo) + PUBLISH_DELAY
    return t >= close


def latest_session(japan: bool, now: dt.datetime | None = None) -> dt.date:
    """終値が確定している直近の取引日。"""
    d = market_now(japan, now).date()
    while not (is_trading_day(d, japan) and session_closed(d, japan, now)):
        d -= dt.timedelta(days=1)
    return d


def trading_days_between(start: dt.date, end: dt.date, japan: bool) -> int:
    """start の翌日から end までの取引日の数（start が end 以降なら 0）。"""
    days, d = 0, start + dt.timedelta(days=1)
    while d <= end:
        days += is_trading_day(d, japan)
        d += dt.timedelta(days=1)
    return days


@dataclass
class Freshness:
    last: dt.date               # データの最終日
    expected: dt.date           # 終値が確定している直近の取引日
    stale: int                  # 何取引日分古いか（0 なら最新）
    dropped_partial: bool       # 取引時間中の未確定の足を除いたか

    @property
    def text(self) -> str:
        note = "（取引時間中のため当日の未確定の足は除外）" if self.dropped_partial else ""
        if self.stale == 0:
            return f"データ: {fmt_date(self.last)} の終値まで（最新）{note}"
        return (f"データは {fmt_date(self.last)} まで。直近の取引日 {fmt_date(self.expected)} から"
                f" {self.stale}営業日古いため、最新データで判定し直してください{note}")


def ensure_closed_bars(df: pd.DataFrame, ticker: str, now: dt.datetime | None = None) -> tuple[pd.DataFrame, Freshness]:
    """未確定の当日の足を除き（判定は確定足だけで行う）、データがどれだけ新しいかを返す。"""
    japan = is_japan(ticker)
    dropped = False
    if len(df) and not session_closed(df.index[-1].date(), japan, now):
        df, dropped = df.iloc[:-1], True
    expected = latest_session(japan, now)
    last = df.index[-1].date()
    return df, Freshness(last, expected, trading_days_between(last, expected, japan), dropped)


def fmt_date(d) -> str:
    """2026-10-16(金) の形式。"""
    d = pd.Timestamp(d)
    return f"{d:%Y-%m-%d}({WEEKDAYS_JP[d.weekday()]})"


# ---------------------------------------------------------------------------
# 注文の有効期限
# ---------------------------------------------------------------------------


def next_trading_day(d: dt.date, japan: bool) -> dt.date:
    d += dt.timedelta(days=1)
    while not is_trading_day(d, japan):
        d += dt.timedelta(days=1)
    return d


def order_expiry(today: pd.Timestamp, japan: bool = True) -> pd.Timestamp:
    """今日の終値を見て出す注文の有効期限（執行条件「今週中」）。

    翌取引日が属する週の最後の取引日（通常は金曜日、祝日ならその前の取引日）。
    """
    next_day = next_trading_day(pd.Timestamp(today).date(), japan)
    d = next_day + dt.timedelta(days=4 - next_day.weekday())
    while not is_trading_day(d, japan):
        d -= dt.timedelta(days=1)
    return pd.Timestamp(d)


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

# 保有銘柄の判定用: 名前 → (折れ線の節, 買付日)
DEMO_POSITION_SCENARIOS = {
    # 2回目の波で買い、上昇トレンドが続いている
    "DEMO-保有中": ([(0, 900), (200, 1300), (212, 1250), (240, 1400)], 236),
    # 2回目の波で買い、上昇した後に勢いが鈍って +1σ を割る
    "DEMO-利益確定": ([(0, 900), (200, 1300), (212, 1250), (235, 1420), (242, 1390)], 216),
    # 底から75日線を上抜けて買ったが、すぐに75日線を割る
    "DEMO-ロスカット": ([(0, 1000), (120, 1400), (150, 1180), (180, 1020), (215, 820), (250, 935), (254, 945), (262, 880)], 245),
}



def demo_prices(name: str, seed: int = 0) -> pd.DataFrame:
    """折れ線の節 (日, 価格) から、少しノイズを乗せた疑似 OHLCV を作る。

    保有銘柄用のデモは、ロスカット（約定日の75日線−1円）がノイズだけで発動しないよう値動きを小さくする。
    """
    knots = DEMO_SCENARIOS[name] if name in DEMO_SCENARIOS else DEMO_POSITION_SCENARIOS[name][0]
    noise = 0.001 if name in DEMO_POSITION_SCENARIOS else 0.004
    days = knots[-1][0] + 1
    rng = np.random.default_rng(seed)
    x, y = zip(*knots)
    close = np.interp(np.arange(days), x, y) * (1 + rng.normal(0, noise, days))
    open_ = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, noise * 0.75, days))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, noise, days)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, noise, days)))
    # 最終日を「終値が確定している直近の取引日」にして、デモがいつでも最新データとして扱われるようにする
    idx = pd.bdate_range(end=pd.Timestamp(latest_session(True)), periods=days)
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": rng.integers(300_000, 800_000, days)},
        index=idx,
    )
