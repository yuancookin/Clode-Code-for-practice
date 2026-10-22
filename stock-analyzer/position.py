"""保有銘柄の判定（ルール集 6. ロスカット、8. 利益確定）。

約定した日から1日ずつ進めて、最初に出た売りのシグナルを探す。

ロスカット（場中・逆指値）
  - 約定日の75日線−1呼値「以下」で売り。値幅注文で STOP_SLIP_TICKS 呼値下まで約定を許す
利益確定
  - MACD: 約定後（約3日以内）にゴールデンクロスしたらトレンドが強いと確認 → 乖離（ヒストグラム）が縮んだら翌営業日に売り
    （約定時点ですでに MACD がシグナルの上にあるときは、新たなクロスが無いので「確認できず」になる）
    （デッドクロスはその先で起きるので、乖離の縮小で先に売ることになる）
  - ボリンジャーバンド（25日）:
      トレンド発生前 … +2σ に届いたら売り（場中の指値。前日の +2σ を指値の目安にする）
      トレンド発生中 … 終値が +1σ を割ったら翌営業日に売り（約定後に一度 +1σ の上に出てから割ったとき）
      「トレンド発生中」= ルール集 3 の上昇トレンド（75日線が上向き、かつ株価がその上）。
      1回目の波（底からの上抜け）は75日線がまだ下向きなので「発生前」、2回目以降の波は「発生中」になりやすい。
      約定日から判定し、一度トレンド発生中になったら売るまで続く
  - 利益確定のシグナルは含み益のときだけ使う。含み損のときはロスカットで管理する

判定はその日の終値までのデータだけで行う（翌日以降のデータは見ない）。
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from common import (
    MA_DAYS, Freshness, bollinger, fmt_date, fmt_price, is_japan, macd, next_trading_day, price_below, sma,
    tick_size,
)

GC_WINDOW = 5           # 約定からこの営業日数以内に MACD のゴールデンクロスを確認する（ルール集「約3日後」）
TREND_SLOPE_DAYS = 10   # 75日線の向きを、この営業日数前と比べて判定する
STOP_SLIP_TICKS = 5     # ロスカットの値幅注文: 逆指値からこの呼値数だけ下まで約定を許す

ACTIONS = {
    "losscut": "ロスカット",
    "take_profit": "利益確定",
    "hold": "保有継続",
}


@dataclass
class Position:
    ticker: str
    entry_date: pd.Timestamp
    entry_price: float
    shares: int | None = None


@dataclass
class ExitEvent:
    kind: str               # "losscut" / "take_profit"
    signal_idx: int         # シグナルが出た日の位置
    exec_idx: int | None    # 売る日の位置（翌営業日のデータがまだ無ければ None）
    price: float | None     # 売値の目安
    reason: str
    intraday: bool          # 場中の注文（逆指値・指値）で売れたか


@dataclass
class ExitScan:
    entry_idx: int
    stop: float             # ロスカットの逆指値
    stop_limit: float       # 値幅注文の下限
    ma_entry: float         # 約定日の75日線
    gc_idx: int | None      # MACD のゴールデンクロスを確認した日
    trend_idx: int | None   # ボリンジャーバンドで「トレンド発生中」になった日
    event: ExitEvent | None


def find_entry_idx(df: pd.DataFrame, entry_date) -> int:
    """買付日のローソク足の位置。休日なら次の取引日にする。"""
    entry_date = pd.Timestamp(entry_date).normalize()
    after = df.index[df.index.normalize() >= entry_date]
    if after.empty:
        raise ValueError(f"買付日 {fmt_date(entry_date)} 以降の株価データがありません")
    idx = df.index.get_loc(after[0])
    if idx < MA_DAYS - 1:
        raise ValueError(f"買付日の75日線を計算できません。買付日より前に{MA_DAYS}営業日分以上のデータが必要です（--period を長くしてください）")
    return idx


def scan_exit(df: pd.DataFrame, entry_idx: int, entry_price: float, japan: bool) -> ExitScan:
    o, h, l, c = (df[k].to_numpy() for k in ("Open", "High", "Low", "Close"))
    ma = sma(df["Close"], MA_DAYS).to_numpy()
    line, sig, hist = (x.to_numpy() for x in macd(df["Close"]))
    bb = {k: v.to_numpy() for k, v in bollinger(df["Close"]).items()}

    def trending(i: int) -> bool:
        return ma[i] > ma[i - TREND_SLOPE_DAYS] and c[i] > ma[i]

    stop = price_below(ma[entry_idx], japan)
    stop_limit = round(stop - STOP_SLIP_TICKS * tick_size(stop, japan), 2)
    gc_idx = None
    trend_idx = entry_idx if trending(entry_idx) else None
    above_1sigma = c[entry_idx] > bb["+1σ"][entry_idx]  # 約定後に終値が +1σ の上に出たか
    event = None
    n = len(df)

    for i in range(entry_idx + 1, n):
        # 1. ロスカット（場中の逆指値）。窓を開けて下げたら始値で約定したとみなす
        if l[i] <= stop:
            event = ExitEvent("losscut", i, i, min(o[i], stop), "安値が約定日の75日線−1呼値に到達", True)
            break
        # 2. トレンド発生前に +2σ に到達（前日の +2σ を指値の目安にした場中の売り）
        target = bb["+2σ"][i - 1]
        if trend_idx is None and target > entry_price and h[i] >= target:
            event = ExitEvent("take_profit", i, i, max(o[i], target), "トレンド発生前に +2σ に到達", True)
            break

        # その日の終値で状態を更新する
        if gc_idx is None and i <= entry_idx + GC_WINDOW and line[i] > sig[i] and line[i - 1] <= sig[i - 1]:
            gc_idx = i  # 約定後に MACD がシグナルを下から上に抜けた日
        if trend_idx is None and trending(i):
            trend_idx = i

        # 3. 終値で出るシグナル → 翌営業日の寄り付きで売り（含み益のときだけ）
        reasons = []
        if gc_idx is not None and i > gc_idx and hist[i - 1] > 0 and hist[i] < hist[i - 1]:
            reasons.append("MACD の乖離が縮小" + ("（デッドクロス）" if hist[i] <= 0 else ""))
        if trend_idx is not None and above_1sigma and c[i] < bb["+1σ"][i]:
            reasons.append("トレンド発生中に終値が +1σ を割った")
        above_1sigma = above_1sigma or c[i] > bb["+1σ"][i]
        if reasons and c[i] > entry_price:
            nxt = i + 1 if i + 1 < n else None
            event = ExitEvent("take_profit", i, nxt, o[nxt] if nxt else None, "・".join(reasons), False)
            break

    return ExitScan(entry_idx, stop, stop_limit, float(ma[entry_idx]), gc_idx, trend_idx, event)


# ---------------------------------------------------------------------------
# 判定結果
# ---------------------------------------------------------------------------


@dataclass
class PositionAnalysis:
    position: Position
    date: pd.Timestamp          # データの最終日
    close: float
    scan: ExitScan
    action: str                 # ACTIONS のキー
    action_text: str            # いつ・どう売るか
    losscut_lines: list[str]
    profit_lines: list[str]
    freshness: Freshness | None = None

    @property
    def sold(self) -> bool:
        """売りのシグナルがすでに約定している（はず）か。"""
        return bool(self.scan.event and self.scan.event.exec_idx is not None)

    @property
    def pnl(self) -> float:
        """損益率。売った（はずの）ときは売値、保有中は終値で計算する。"""
        price = self.scan.event.price if self.sold else self.close
        return price / self.position.entry_price - 1

    @property
    def is_stale(self) -> bool:
        return bool(self.freshness and self.freshness.stale)

    @property
    def action_label(self) -> str:
        return ACTIONS[self.action] + ("（要再判定）" if self.is_stale else "")


def analyze_position(df: pd.DataFrame, pos: Position) -> PositionAnalysis:
    japan = is_japan(pos.ticker)
    p = lambda v: fmt_price(v, japan)
    entry_idx = find_entry_idx(df, pos.entry_date)
    s = scan_exit(df, entry_idx, pos.entry_price, japan)
    last = len(df) - 1
    close = float(df["Close"].iloc[-1])
    day = lambda i: fmt_date(df.index[i])
    held = last - entry_idx

    # --- 何をするか ---------------------------------------------------------
    ev = s.event
    if ev is None:
        action, text = "hold", f"保有継続（約定から{held}営業日）。ロスカットの逆指値は置いたままにする"
    elif ev.kind == "losscut":
        action = "losscut"
        text = (f"本日 {day(ev.exec_idx)} にロスカットの逆指値に到達（約 {p(ev.price)} で約定）" if ev.exec_idx == last
                else f"{day(ev.exec_idx)} にロスカットの逆指値に到達済み（約 {p(ev.price)} で約定しているはず）")
    else:
        action = "take_profit"
        if ev.exec_idx is None:
            nxt = next_trading_day(df.index[last].date(), japan)
            text = f"翌営業日 {fmt_date(nxt)} の寄り付きで売る（{ev.reason}）"
        elif ev.intraday:
            text = (f"{'本日 ' if ev.exec_idx == last else ''}{day(ev.exec_idx)} に {ev.reason}"
                    f"（約 {p(ev.price)} で売り{'' if ev.exec_idx == last else '済みのはず'}）")
        else:
            text = (f"{day(ev.signal_idx)} に {ev.reason} → {day(ev.exec_idx)} の寄り付き（約 {p(ev.price)}）で"
                    "売る予定だった。まだ保有しているなら早めに売る")

    # --- ロスカット ---------------------------------------------------------
    per_share = pos.entry_price - s.stop
    losscut = [
        f"逆指値: {p(s.stop)} 以下になったら売り（値幅注文で {p(s.stop_limit)} まで。{STOP_SLIP_TICKS}呼値の幅）",
        f"基準: 約定日 {day(entry_idx)} の75日線 {s.ma_entry:,.2f} −1呼値（約定後は動かさない）",
        *([] if ev and ev.exec_idx is not None else [f"現在値 {p(close)} はロスカットまで {close / s.stop - 1:+.1%}"]),
        f"1株のリスク {p(per_share)}" + (f" × {pos.shares:,}株 = {p(per_share * pos.shares)}" if pos.shares else ""),
    ]

    # --- 利益確定 -----------------------------------------------------------
    line, sig, hist = macd(df["Close"])
    bb = bollinger(df["Close"])
    if s.gc_idx is not None:
        macd_state = f"ゴールデンクロスを確認（{day(s.gc_idx)}）"
        h_now, h_prev = hist.iloc[-1], hist.iloc[-2]
        macd_state += "。乖離は拡大中 → 保有" if h_now >= h_prev else "。乖離が縮小 → 利益確定のシグナル"
    elif held < GC_WINDOW:
        macd_state = f"ゴールデンクロス待ち（約定から{GC_WINDOW}営業日以内に確認。あと{GC_WINDOW - held}日）"
    else:
        macd_state = (f"約定から{GC_WINDOW}営業日以内にゴールデンクロスせず（トレンドを確認できない。"
                      "MACD の利益確定ルールは使わず、ボリンジャーバンドとロスカットで管理）")
    if s.trend_idx is None:
        bb_state = (f"トレンド発生前 → +2σ に届いたら利益確定。明日の指値の目安 {p(bb['+2σ'].iloc[-1])}"
                    "（75日線が上向きになり、株価がその上にあればトレンド発生中とみなす）")
    else:
        bb_state = (f"トレンド発生中（{day(s.trend_idx)} から）→ 終値が +1σ（今日 {p(bb['+1σ'].iloc[-1])}）を"
                    "割ったら翌営業日に利益確定")
    pnl_text = lambda price: (f"{price / pos.entry_price - 1:+.1%}"
                              + (f"、{p((price - pos.entry_price) * pos.shares)}" if pos.shares else ""))
    if ev and ev.exec_idx is not None:  # すでに売った（はずの）ポジション
        profit = [f"売却時の損益: 買値 {p(pos.entry_price)} → 約 {p(ev.price)}（{pnl_text(ev.price)}）"]
    else:
        profit = [f"損益: 買値 {p(pos.entry_price)} → 終値 {p(close)}（{pnl_text(close)}）",
                  f"MACD: {macd_state}", f"ボリンジャーバンド(25日): {bb_state}"]
        if close <= pos.entry_price:
            profit.append("現在は含み損のため、利益確定のシグナルは使わずロスカットで管理する")

    return PositionAnalysis(pos, df.index[-1], close, s, action, text, losscut, profit)


# ---------------------------------------------------------------------------
# 動作確認用
# ---------------------------------------------------------------------------

DEMO_POSITIONS = ("DEMO-保有中", "DEMO-利益確定", "DEMO-ロスカット")


def demo_position(name: str) -> tuple[Position, pd.DataFrame]:
    """疑似データの保有銘柄。DEMO_POSITION_SCENARIOS の買付日の始値で100株買ったことにする。"""
    import math

    from common import DEMO_POSITION_SCENARIOS, demo_prices

    df = demo_prices(name)
    entry_day = DEMO_POSITION_SCENARIOS[name][1]
    return Position(name, df.index[entry_day], math.ceil(df["Open"].iloc[entry_day]), 100), df
