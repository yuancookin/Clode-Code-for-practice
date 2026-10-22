import numpy as np
import pandas as pd
import pytest

import buy
import common
import stock_analyzer


def frame(close, open_=None):
    close = np.asarray(close, dtype=float)
    open_ = close if open_ is None else np.asarray(open_, dtype=float)
    idx = pd.bdate_range("2024-01-01", periods=len(close))
    return pd.DataFrame({"Open": open_, "High": np.maximum(open_, close) + 1, "Low": np.minimum(open_, close) - 1,
                         "Close": close, "Volume": 500_000}, index=idx)


# --- 呼値・注文価格 ---------------------------------------------------------

@pytest.mark.parametrize("ma, above, below", [(2377, 2378, 2376), (2377.4, 2378, 2377), (2378, 2379, 2377)])
def test_one_tick_above_and_below_ma(ma, above, below):
    assert common.price_above(ma, japan=True) == above
    assert common.price_below(ma, japan=True) == below


def test_tick_size_bands():
    assert common.tick_size(2_999, True) == 1
    assert common.tick_size(4_000, True) == 5
    assert common.price_above(4_002, True) == 4_005
    assert common.price_above(10.004, False) == 10.01


def test_order_expires_on_friday_of_next_trading_week():
    assert common.order_expiry(pd.Timestamp("2026-10-07")) == pd.Timestamp("2026-10-09")  # 水 → 同じ週の金
    assert common.order_expiry(pd.Timestamp("2026-10-09")) == pd.Timestamp("2026-10-16")  # 金 → 翌週の金


# --- 底値の確認（3段下げ） ---------------------------------------------------

def test_three_step_decline_is_counted():
    df = common.demo_prices("DEMO-1回目の波")
    dec = buy.find_decline(df)
    assert dec.days >= buy.DECLINE_DAYS and dec.lower_lows >= 3


def test_swing_lows_ignore_unconfirmed_recent_days():
    low = np.array([5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3])
    assert buy.swing_lows(low, w=3) == [4]


# --- 1回目の波 ---------------------------------------------------------------

def test_first_wave_order_before_breakout():
    df = common.demo_prices("DEMO-1回目の波")
    ma = common.sma(df["Close"], 75)
    cross = buy.recent_breakout(df["Close"], ma, days=10)
    a = buy.analyze_buy(df.iloc[:cross], "1234.T")
    assert a.status == "order" and a.wave == "1回目の波"
    ma_before = ma.iloc[cross - 1]
    assert a.order.trigger == common.price_above(ma_before, True) > ma_before
    assert a.order.stop == common.price_below(ma_before, True) < ma_before


def test_first_wave_reports_breakout_after_cross():
    a = buy.analyze_buy(common.demo_prices("DEMO-1回目の波"), "1234.T")
    assert a.status == "filled" and "75日線を上抜け" in a.summary


def test_steady_downtrend_is_avoided():
    a = buy.analyze_buy(common.demo_prices("DEMO-下落中"), "1234.T")
    assert a.status == "avoid" and a.grade == "-"


def test_low_volume_blocks_order():
    df = common.demo_prices("DEMO-1回目の波")
    cross = buy.recent_breakout(df["Close"], common.sma(df["Close"], 75), days=10)
    a = buy.analyze_buy(df.iloc[:cross], "1234.T", min_volume=10_000_000)
    assert a.status == "watch" and a.grade == "C"


# --- 2回目以降の波（トレンド転換線） ---------------------------------------

def test_turn_line_is_highest_body_between_high_and_low():
    rise = np.linspace(100, 200, 130)
    # 高値 210 → 下落の途中で実体上端 205 → 安値 190 → 206 で転換線 205 を上抜け
    close = np.r_[rise, 210, 205, 198, 192, 190, 195, 206]
    open_ = np.r_[rise, 200, 208, 204, 197, 192, 191, 196]
    df = frame(close, open_)
    line = buy.find_turn_line(df, common.sma(df["Close"], 75))
    assert line.level == 208  # 高値の次の陰線の実体上端（始値 208）
    assert line.turn_idx is None  # 206 は 208 を超えていない

    df2 = frame(np.r_[close, 209], np.r_[open_, 205])
    line2 = buy.find_turn_line(df2, common.sma(df2["Close"], 75))
    assert line2.turn_idx == len(df2) - 1
    a = buy.analyze_buy(df2, "1234.T")
    assert a.status == "order" and a.order.trigger == common.price_above(df2["High"].iloc[-1], True)


def test_pullback_touching_ma_is_not_second_wave():
    df = frame(np.r_[np.linspace(100, 200, 100), 200, 150, 140, 160])
    assert buy.find_turn_line(df, common.sma(df["Close"], 75)) is None


# --- 過去検証・CLI ------------------------------------------------------------

def test_backtest_fills_at_or_above_trigger_and_stops_below_ma():
    df = common.demo_prices("DEMO-1回目の波")
    trades = buy.backtest_buy(df, "1234.T")
    assert trades
    ma = common.sma(df["Close"], 75)
    for t in trades:
        assert t.entry > ma.loc[t.entry_date] - 1
        if t.reason == "ロスカット":
            assert t.exit < ma.loc[t.entry_date]


def test_summarize_separates_open_positions():
    t = lambda r, reason: buy.Trade(pd.Timestamp("2024-01-01"), 100, pd.Timestamp("2024-02-01"), 100 * (1 + r), reason, "")
    s = buy.summarize([t(0.1, "20日経過"), t(-0.05, "ロスカット"), t(0.2, buy.OPEN)])
    assert s["trades"] == 2 and s["open"] == 1 and s["win_rate"] == 0.5 and s["payoff"] == pytest.approx(2)


def test_position_size_is_capped_by_capital(capsys):
    df = common.demo_prices("DEMO-1回目の波")
    cross = buy.recent_breakout(df["Close"], common.sma(df["Close"], 75), days=10)
    stock_analyzer.print_buy(buy.analyze_buy(df.iloc[:cross], "1234.T"), risk=10_000, capital=500_000)
    out = capsys.readouterr().out
    assert "500株（投資上限" in out and "損切り幅" in out


def test_cli_demo_runs():
    assert stock_analyzer.main(["buy", "--demo", "--backtest", "--risk", "10000", "--capital", "500000"]) == 0


def test_demo_before_breakout_is_order():
    assert buy.analyze_buy(common.demo_prices("DEMO-上抜け直前"), "1234.T").status == "order"


def test_demo_data_uses_yen_ticks():
    a = buy.analyze_buy(common.demo_prices("DEMO-上抜け直前"), "DEMO-上抜け直前")
    assert a.order.trigger == int(a.order.trigger) and a.order.stop == int(a.order.stop)
