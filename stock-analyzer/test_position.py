import numpy as np
import pandas as pd
import pytest

import buy
import common
import position as P
import stock_analyzer
from inputs import load_positions


def frame(close, low=None):
    close = np.asarray(close, dtype=float)
    low = close - 0.5 if low is None else np.asarray(low, dtype=float)
    idx = pd.bdate_range("2024-01-01", periods=len(close))
    return pd.DataFrame({"Open": close, "High": close + 0.5, "Low": low, "Close": close, "Volume": 500_000}, index=idx)


@pytest.mark.parametrize("name, action", [
    ("DEMO-保有中", "hold"), ("DEMO-利益確定", "take_profit"), ("DEMO-ロスカット", "losscut"),
])
def test_demo_positions(name, action):
    pos, df = P.demo_position(name)
    assert P.analyze_position(df, pos).action == action


def test_stop_is_one_tick_below_ma_on_entry_day_and_fixed():
    pos, df = P.demo_position("DEMO-保有中")
    r = P.analyze_position(df, pos)
    ma_entry = common.sma(df["Close"], 75).iloc[r.scan.entry_idx]
    assert r.scan.stop == common.price_below(ma_entry, True)
    assert r.scan.stop_limit == r.scan.stop - P.STOP_SLIP_TICKS


def test_losscut_fills_at_open_on_gap_down():
    close = np.r_[np.linspace(100, 130, 100), 131, 132, 110]  # 75日線（約119円）を大きく割って寄り付く
    df = frame(close)
    s = P.scan_exit(df, 100, 131, True)
    assert s.stop > 110
    assert s.event.kind == "losscut" and s.event.exec_idx == 102
    assert s.event.price == 110  # 逆指値より下で寄り付いたので始値


def test_profit_signal_waits_for_profit():
    # 含み損のときは MACD・+1σ のシグナルでは売らない
    close = np.r_[np.linspace(100, 130, 100), 131, 130.8, 130.6, 130.4]
    s = P.scan_exit(frame(close), 100, 140, True)
    assert s.event is None


def test_close_signal_sells_next_open():
    pos, df = P.demo_position("DEMO-利益確定")
    ev = P.analyze_position(df, pos).scan.event
    assert not ev.intraday and ev.exec_idx == ev.signal_idx + 1
    assert ev.price == df["Open"].iloc[ev.exec_idx]


def test_signal_on_last_day_means_sell_tomorrow():
    pos, df = P.demo_position("DEMO-利益確定")
    ev = P.analyze_position(df, pos).scan.event
    r = P.analyze_position(df.iloc[: ev.signal_idx + 1], pos)
    assert r.action == "take_profit" and not r.sold and "翌営業日" in r.action_text


def test_no_look_ahead():
    # 途中までのデータで出た判定は、その後のデータを足しても変わらない
    pos, df = P.demo_position("DEMO-ロスカット")
    full = P.analyze_position(df, pos).scan.event
    cut = P.analyze_position(df.iloc[: full.exec_idx + 1], pos).scan.event
    assert (cut.kind, cut.exec_idx, cut.price) == (full.kind, full.exec_idx, full.price)


def test_entry_date_on_holiday_uses_next_bar_and_needs_history():
    df = frame(np.linspace(100, 130, 120))
    sat = df.index[99] + pd.Timedelta(days=(5 - df.index[99].weekday()) % 7 or 7)
    assert df.index[P.find_entry_idx(df, sat)] > sat
    with pytest.raises(ValueError, match="75日線を計算できません"):
        P.find_entry_idx(df, df.index[10])


def test_backtest_uses_rule_exits():
    df = common.demo_prices("DEMO-1回目の波")
    trades = buy.backtest_buy(df, "1234.T")
    assert trades and all(t.reason == "ロスカット" or t.reason.startswith("利益確定") or t.reason == buy.OPEN
                          for t in trades)


def test_load_positions_japanese_columns():
    csv = "銘柄,買付日,買値,株数\n7203,2026/10/14,\"2,378\",100\nhttps://finance.yahoo.co.jp/quote/6758.T,2026-10-15,3500,\n"
    positions = load_positions(csv.encode("cp932"), "positions.csv")
    assert [(p.ticker, p.entry_price, p.shares) for p in positions] == [("7203.T", 2378, 100), ("6758.T", 3500, None)]


def test_cli_position_demo(capsys):
    assert stock_analyzer.main(["position", "--demo"]) == 0
    out = capsys.readouterr().out
    assert "【ロスカット】" in out and "【利益確定】" in out and "保有銘柄のまとめ" in out


def test_size_text_when_one_unit_exceeds_capital():
    order = buy.Order(79_100, pd.Timestamp("2026-10-30"), 79_000, "")
    size = buy.position_size(order, True, risk=10_000, capital=500_000)
    assert size.shares == 0
    assert "1単元（100株・7,910,000円）も買えない" in buy.size_text(size, order.trigger, True)
