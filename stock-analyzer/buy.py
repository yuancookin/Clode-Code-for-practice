"""買い分析（75日線トレード ルール集 3〜7, 9, 10）。

- 1回目の波 : 2か月以上の下落・3段下げで底を確認 → 75日線に接近 → 「75日線＋1円以上」で逆指値買い
- 2回目以降の波: 75日線に届かない調整 → トレンド転換線を実体で上抜け → 「転換ローソク足の高値＋1円以上」で逆指値買い
- どちらもロスカットの目安は「約定日の75日線−1円以下」

判定は当日までの確定足だけで行う（翌営業日以降に出す注文を決める）。
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from common import (
    MA_DAYS, Freshness, body_bottom, body_top, candle_text, fetch_fundamentals, fmt_date, fmt_price, is_japan,
    ma_slope, order_expiry, price_above, price_below, sma, unit_shares,
)

MIN_DAYS = 120          # 75日線 + 傾きの計算 + 下落の確認に最低限必要な日数
DECLINE_DAYS = 40       # 「2〜3か月以上の下落」の下限（約2か月の営業日数）
LOWER_LOWS = 3          # 「安値を3回以上切り下げ」
NEAR_MA = 0.05          # 75日線まで 5% 以内なら「接近」
BREAKOUT_DAYS = 5       # この日数以内の上抜けを「上抜け済み」として表示
MIN_VOLUME = 100_000    # 25日平均出来高の下限（株）
SWING_WINDOW = 5        # 安値の山谷を判定する前後の日数

STATUS = {
    "order": "買い注文を出す",
    "filled": "上抜け済み（約定していれば保有中）",
    "turn_wait": "トレンド転換待ち",
    "watch": "ウォッチリスト",
    "avoid": "対象外",
}
STATUS_ORDER = list(STATUS)


@dataclass
class Check:
    ok: bool
    text: str
    required: bool = True


@dataclass
class Order:
    trigger: float          # 逆指値の価格（この価格以上になったら、この価格で買う）
    expires: pd.Timestamp
    stop: float             # ロスカットの目安（今日の75日線−1円。約定日の75日線で確定させる）
    basis: str              # 何を基準にした価格か


@dataclass
class BuyAnalysis:
    ticker: str
    date: pd.Timestamp
    close: float
    status: str
    wave: str
    summary: str
    checks: list[Check] = field(default_factory=list)
    order: Order | None = None
    freshness: Freshness | None = None     # データの鮮度（CLI / アプリで取得時に付ける）

    @property
    def is_stale(self) -> bool:
        return bool(self.freshness and self.freshness.stale)

    @property
    def status_label(self) -> str:
        return STATUS[self.status] + ("（要再判定）" if self.is_stale else "")

    @property
    def stale_order_note(self) -> str | None:
        """古いデータで出した注文への注意。最新データなら None。"""
        if not (self.order and self.is_stale):
            return None
        note = f"この注文価格は {fmt_date(self.freshness.last)} の75日線で計算したもの。最新データで判定し直してから注文する"
        if self.order.expires.date() < self.freshness.expected:
            note += f"（有効期限 {fmt_date(self.order.expires)} もすでに過ぎている）"
        return note

    @property
    def grade(self) -> str:
        """A: 必須条件すべて＋加点2つ以上 / B: 必須条件すべて / C: 必須条件に未達あり。対象外は「-」。"""
        if self.status == "avoid":
            return "-"
        if not all(c.ok for c in self.checks if c.required):
            return "C"
        return "A" if sum(c.ok for c in self.checks if not c.required) >= 2 else "B"


# ---------------------------------------------------------------------------
# 底値の確認（3段下げ）
# ---------------------------------------------------------------------------


def swing_lows(low: np.ndarray, w: int = SWING_WINDOW) -> list[int]:
    """前後 w 日の中で最安値になっている日（谷）。直近 w 日はまだ確定しないので含めない。"""
    return [i for i in range(w, len(low) - w) if low[i] == low[i - w : i + w + 1].min()]


@dataclass
class Decline:
    peak: int           # 下落前の高値の位置
    bottom: int         # 底（最安値）の位置
    days: int           # 下落期間（営業日）
    lower_lows: int     # 安値の切り下げ回数


def find_decline(df: pd.DataFrame, bottom_window: int = 120, peak_window: int = 250) -> Decline:
    low, high = df["Low"].to_numpy(), df["High"].to_numpy()
    n = len(df)
    bottom = n - bottom_window + int(np.argmin(low[-bottom_window:])) if n > bottom_window else int(np.argmin(low))
    start = max(0, bottom - peak_window)
    peak = start + int(np.argmax(high[start : bottom + 1]))

    count, running = 0, np.inf
    for i in [i for i in swing_lows(low) if peak < i <= bottom] + [bottom]:
        if low[i] < running:
            count, running = count + 1, low[i]
    return Decline(peak, bottom, bottom - peak, count)


# ---------------------------------------------------------------------------
# 共通のチェック
# ---------------------------------------------------------------------------


def volume_check(df: pd.DataFrame, min_volume: int) -> Check:
    avg = float(df["Volume"].iloc[-25:].mean())
    ok = avg >= min_volume
    return Check(ok, f"出来高 25日平均 {avg:,.0f}株/日" + ("" if ok else f"（{min_volume:,}株未満で少ない）"))


def candle_check(df: pd.DataFrame) -> Check:
    text = candle_text(df)
    return Check("陽線" in text and "上ヒゲ" not in text, f"直近のローソク足: {text}", required=False)


def make_order(trigger: float, ma_now: float, today: pd.Timestamp, japan: bool, basis: str) -> Order:
    return Order(trigger, order_expiry(today, japan), price_below(ma_now, japan), basis)


# ---------------------------------------------------------------------------
# 1回目の波（75日線上抜け）
# ---------------------------------------------------------------------------


def analyze_first_wave(df: pd.DataFrame, ma: pd.Series, ticker: str, min_volume: int) -> BuyAnalysis:
    japan = is_japan(ticker)
    close, low = df["Close"], df["Low"].to_numpy()
    today, price, ma_now = df.index[-1], float(close.iloc[-1]), float(ma.iloc[-1])
    n = len(df)
    dec = find_decline(df)
    since_bottom = n - 1 - dec.bottom
    gap = price / ma_now - 1
    slope = ma_slope(ma)

    checks = [
        Check(dec.days >= DECLINE_DAYS, f"下落期間 {dec.days}営業日（{df.index[dec.peak]:%Y-%m-%d} の高値から）"
              + ("" if dec.days >= DECLINE_DAYS else "：2か月未満")),
        Check(dec.lower_lows >= LOWER_LOWS, f"安値の切り下げ {dec.lower_lows}回"
              + ("（3段下げ完成）" if dec.lower_lows >= LOWER_LOWS else "（3回未満）")),
        Check(since_bottom >= 3, f"底 {fmt_price(low[dec.bottom], japan)}（{df.index[dec.bottom]:%Y-%m-%d}）から {since_bottom}営業日"
              + ("、安値更新なし" if since_bottom >= 3 else "：まだ底を確認できない")),
        Check(-NEAR_MA <= gap, f"株価は75日線の {-gap:.1%} 下" + ("（接近）" if -NEAR_MA <= gap else "（まだ遠い）")),
        volume_check(df, min_volume),
        Check(slope >= -0.005, f"75日線の傾き {slope:+.1%}/10日" + ("（下げ止まり）" if slope >= -0.005 else "（まだ下向き）"),
              required=False),
        candle_check(df),
    ]
    bottom_ok = checks[0].ok and checks[1].ok and checks[2].ok
    a = BuyAnalysis(ticker, today, price, "avoid", "1回目の波", "", checks)

    if all(c.ok for c in checks if c.required):
        a.status, a.summary = "order", "底を確認し75日線に接近。75日線の上抜けで買い"
        a.order = make_order(price_above(ma_now, japan), ma_now, today, japan, f"75日線 {ma_now:,.2f} ＋1呼値")
    elif bottom_ok:
        a.status, a.summary = "watch", "底値から1回目を準備中（75日線への接近・出来高を待つ）"
    elif slope < 0:
        a.summary = "75日線が下向きで株価がその下（下に膨らむ形）。底が確認できない"
    else:
        a.status, a.summary = "watch", "底の条件（下落期間・3段下げ）が未達"
    return a


def recent_breakout(close: pd.Series, ma: pd.Series, days: int = BREAKOUT_DAYS) -> int | None:
    """直近 days 日以内に終値が75日線を上抜けた日の位置（なければ None）。"""
    above = (close > ma).to_numpy()
    for i in range(len(close) - 1, max(len(close) - 1 - days, 0), -1):
        if above[i] and not above[i - 1]:
            return i
    return None


# ---------------------------------------------------------------------------
# 2回目以降の波（トレンド転換線）
# ---------------------------------------------------------------------------


@dataclass
class TurnLine:
    high_idx: int       # 調整期間の高値ローソク足
    low_idx: int        # 調整期間の安値ローソク足
    level: float        # トレンド転換線の価格
    turn_idx: int | None  # 実体が転換線を下から上に抜けた日


def find_turn_line(df: pd.DataFrame, ma: pd.Series, window: int = 40, min_pullback: float = 0.03) -> TurnLine | None:
    """75日線に届かない調整を探し、トレンド転換線を引く（ルール集 7）。

    高値ローソク足の実体上端から水平線を引き下ろし、安値ローソク足までの間で
    最初にぶつかる実体（＝間にあるローソク足の実体上端の最大値）で止めた線を転換線とする。
    """
    top, bot = body_top(df).to_numpy(), body_bottom(df).to_numpy()
    n = len(df)
    start = max(0, n - window)
    hi = start + int(np.argmax(top[start : n - 2]))
    lo = hi + 1 + int(np.argmin(bot[hi + 1 :]))
    if lo - hi < 2 or bot[lo] / top[hi] - 1 > -min_pullback:
        return None
    if (df["Low"].iloc[hi : lo + 1] <= ma.iloc[hi : lo + 1]).any():
        return None  # 75日線まで届いた調整は「2回目の波」ではない
    level = float(top[hi + 1 : lo].max())

    close, open_ = df["Close"].to_numpy(), df["Open"].to_numpy()
    turn = next((j for j in range(lo + 1, n)
                 if close[j] > level and min(open_[j], close[j - 1]) <= level), None)
    return TurnLine(hi, lo, level, turn)


def analyze_next_wave(df: pd.DataFrame, ma: pd.Series, ticker: str, min_volume: int) -> BuyAnalysis:
    japan = is_japan(ticker)
    today, price, ma_now = df.index[-1], float(df["Close"].iloc[-1]), float(ma.iloc[-1])
    slope = ma_slope(ma)
    trend_ok = slope > 0
    checks = [
        Check(trend_ok, f"75日線の傾き {slope:+.1%}/10日" + ("（上向き・株価はその上）" if trend_ok else "（上向きではない）")),
        volume_check(df, min_volume),
        candle_check(df),
    ]
    a = BuyAnalysis(ticker, today, price, "watch", "2回目以降の波", "", checks)
    if not trend_ok:
        a.summary = "株価は75日線の上だが、75日線が上向きではない"
        return a

    line = find_turn_line(df, ma)
    if line is None:
        a.summary = "上昇トレンド中。75日線に届かない調整がまだない（新しい買い場なし）"
        return a

    pullback = body_bottom(df).iloc[line.low_idx] / body_top(df).iloc[line.high_idx] - 1
    checks.insert(1, Check(True, f"調整 {pullback:.1%}（{df.index[line.high_idx]:%m/%d}〜{df.index[line.low_idx]:%m/%d}）、75日線に届かず反転"))
    level_text = fmt_price(line.level, japan)

    if line.turn_idx is None:
        a.status = "turn_wait"
        a.summary = f"トレンド転換線 {level_text} を実体で上抜けたら、その日の高値＋1呼値で逆指値買い"
        checks.insert(2, Check(False, f"トレンド転換線 {level_text}：まだ上抜けていない"))
        return a

    turn_high = float(df["High"].iloc[line.turn_idx])
    trigger = price_above(turn_high, japan)
    turn_day = df.index[line.turn_idx]
    checks.insert(2, Check(True, f"{turn_day:%Y-%m-%d} に実体がトレンド転換線 {level_text} を上抜け（転換成立）"))
    filled = (df["High"].iloc[line.turn_idx + 1 :] >= trigger).any()

    if filled:
        a.status, a.summary = "filled", f"転換ローソク足の高値＋1呼値 {fmt_price(trigger, japan)} に到達済み"
    elif len(df) - 1 - line.turn_idx < BREAKOUT_DAYS:
        a.status, a.summary = "order", "トレンド転換が成立。転換ローソク足の高値を超えたら買い"
        a.order = make_order(trigger, ma_now, today, japan, f"転換ローソク足の高値 {fmt_price(turn_high, japan)} ＋1呼値")
    else:
        a.summary = "転換成立から1週間以上たっても高値を超えない（注文期限切れ）"
    return a


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------


def analyze_buy(df: pd.DataFrame, ticker: str, min_volume: int = MIN_VOLUME) -> BuyAnalysis:
    if len(df) < MIN_DAYS:
        raise ValueError(f"分析には最低{MIN_DAYS}営業日分のデータが必要です（--period を長くしてください）")
    close = df["Close"]
    ma = sma(close, MA_DAYS)
    japan = is_japan(ticker)

    cross = recent_breakout(close, ma)
    if cross is not None:
        a = analyze_first_wave(df.iloc[:cross], ma.iloc[:cross], ticker, min_volume)
        if a.status == "order":  # 上抜けの前日に注文を出せる状態だった
            fill = max(float(df["Open"].iloc[cross]), a.order.trigger)
            return BuyAnalysis(
                ticker, df.index[-1], float(close.iloc[-1]), "filled", "1回目の波",
                f"{df.index[cross]:%Y-%m-%d} に75日線を上抜け。注文していれば約 {fmt_price(fill, japan)} で約定"
                f"（現在は75日線から {close.iloc[-1] / ma.iloc[-1] - 1:+.1%}）",
                a.checks,
            )
    if close.iloc[-1] > ma.iloc[-1]:
        return analyze_next_wave(df, ma, ticker, min_volume)
    return analyze_first_wave(df, ma, ticker, min_volume)


def fundamentals_check(ticker: str) -> Check:
    """ルール集 9: 売買の引き金にはしないフィルター。増収増益なら加点。"""
    f = fetch_fundamentals(ticker)
    pct = lambda v: "不明" if v is None else f"{v:+.1%}"
    num = lambda v: "不明" if v is None else f"{v:.1f}倍"
    growth = f["revenue_growth"] is not None and f["earnings_growth"] is not None \
        and f["revenue_growth"] > 0 and f["earnings_growth"] > 0
    return Check(growth, f"業績: 増収率 {pct(f['revenue_growth'])} / 増益率 {pct(f['earnings_growth'])}"
                 f" / PER {num(f['per'])} / PBR {num(f['pbr'])}（割高圏かは同業種と比較）", required=False)


@dataclass
class PositionSize:
    per_share: float            # 1株あたりのリスク（買値 − ロスカット価格）
    unit: int                   # 売買単位
    shares: int | None          # 株数の目安（risk も capital も無ければ None）
    decided_by: str             # 株数を決めた条件
    narrow_stop: bool           # 損切り幅が 1% 未満


def position_size(order: Order, japan: bool, risk: float | None = None, capital: float | None = None) -> PositionSize:
    """許容リスク額と投資額の上限のうち、少ない方の株数を採る。"""
    per_share = order.trigger - order.stop
    unit = unit_shares(japan)
    limits = []
    if risk:
        limits.append((int(risk // per_share // unit * unit), f"許容リスク {fmt_price(risk, japan)}"))
    if capital:
        limits.append((int(capital // order.trigger // unit * unit), f"投資上限 {fmt_price(capital, japan)}"))
    shares, by = min(limits) if limits else (None, "")
    return PositionSize(per_share, unit, shares, by, per_share / order.trigger < 0.01)


# ---------------------------------------------------------------------------
# 買いルールの検証（バックテスト）
# ---------------------------------------------------------------------------


OPEN = "保有中"


@dataclass
class Trade:
    entry_date: pd.Timestamp
    entry: float
    exit_date: pd.Timestamp
    exit: float
    reason: str
    wave: str

    @property
    def ret(self) -> float:
        return self.exit / self.entry - 1


def backtest_buy(df: pd.DataFrame, ticker: str, hold: int = 20, min_volume: int = MIN_VOLUME) -> list[Trade]:
    """買いルールを過去の各日に当てはめて売買を再現する。

    - その日の終値で「買い注文を出す」になったら、翌営業日に逆指値を置く（約定するまで毎日価格を見直す）
    - 高値が逆指値に届いたら約定（寄り付きで超えていたら始値で約定）
    - 出口は仮のもの: 約定日の75日線−1呼値を安値が割ったらロスカット、hold 日たったら終値で手仕舞い
      （利益確定のルールを作ったら置き換える）
    """
    japan = is_japan(ticker)
    o, h, l, c = (df[k].to_numpy() for k in ("Open", "High", "Low", "Close"))
    ma = sma(df["Close"], MA_DAYS).to_numpy()
    trades: list[Trade] = []
    pending = position = None   # pending: 前日の判定で置いた逆指値 (価格, 波)

    for i in range(MIN_DAYS, len(df)):
        day = df.index[i]
        if position:
            entry_i, entry, stop, wave = position
            if l[i] <= stop:
                trades.append(Trade(df.index[entry_i], entry, day, min(o[i], stop), "ロスカット", wave))
                position = None
            elif i - entry_i >= hold:
                trades.append(Trade(df.index[entry_i], entry, day, c[i], f"{hold}日経過", wave))
                position = None
        elif pending and h[i] >= pending[0]:
            # 約定日の75日線−1呼値がロスカット。判定は翌日から
            position = (i, max(o[i], pending[0]), price_below(ma[i], japan), pending[1])
        pending = None
        if not position:
            a = analyze_buy(df.iloc[: i + 1], ticker, min_volume)
            if a.status == "order":
                pending = (a.order.trigger, a.wave)
    if position:
        entry_i, entry, _, wave = position
        trades.append(Trade(df.index[entry_i], entry, df.index[-1], c[-1], OPEN, wave))
    return trades


def summarize(trades: list[Trade]) -> dict | None:
    """決済済みの取引の成績。保有中（未決済）の取引は open に数だけ入れる。"""
    closed = [t for t in trades if t.reason != OPEN]
    if not closed:
        return {"trades": 0, "open": len(trades)} if trades else None
    trades, open_count = closed, len(trades) - len(closed)
    r = np.array([t.ret for t in trades])
    wins, losses = r[r > 0], r[r <= 0]
    equity = np.cumprod(1 + r)
    peak = np.maximum.accumulate(np.r_[1.0, equity])[1:]
    return {
        "trades": len(r),
        "win_rate": float((r > 0).mean()),
        "avg_return": float(r.mean()),
        "payoff": float(wins.mean() / -losses.mean()) if len(wins) and len(losses) and losses.mean() < 0 else None,
        "max_drawdown": float((equity / peak - 1).min()),
        "stop_rate": sum(t.reason == "ロスカット" for t in trades) / len(trades),
        "open": open_count,
    }
