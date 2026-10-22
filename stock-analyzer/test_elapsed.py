import datetime as dt

import pytest

import buy
import common


@pytest.mark.parametrize("days, gain, penalty", [
    (0, 0.00, 0), (1, 0.03, 0),       # 当日・翌日で +3% まで → そのまま
    (2, 0.00, 1), (1, 0.031, 1),      # 2営業日、または +3% 超 → 1段階下げ
    (3, 0.00, 2), (0, 0.051, 2),      # 3営業日以上、または +5% 超 → 見送り
])
def test_elapsed_penalty(days, gain, penalty):
    assert buy.elapsed_penalty(days, gain) == penalty


def wave1_after_breakout(extra_days: int):
    df = common.demo_prices("DEMO-1回目の波")
    cross = buy.recent_breakout(df["Close"], common.sma(df["Close"], 75), days=10)
    return buy.analyze_buy(df.iloc[: cross + 1 + extra_days], "1234.T")


def test_breakout_day_keeps_grade():
    a = wave1_after_breakout(0)
    assert a.status == "filled" and a.elapsed.days == 0
    assert a.penalty == 0 and a.grade == "B" and a.effective_status == "filled"


def test_grade_drops_then_skip_as_days_pass():
    a2, a3 = wave1_after_breakout(2), wave1_after_breakout(3)
    assert a2.elapsed.days == 2 and a2.penalty >= 1 and a2.grade == "C"
    assert a3.penalty == 2 and a3.effective_status == "late" and a3.status_label.startswith("見送り")
    assert "見送り" in a3.elapsed_text


def test_stale_data_adds_to_elapsed_days():
    a = wave1_after_breakout(0)
    last = a.date.date()
    a.freshness = common.Freshness(last, last + dt.timedelta(days=5), 3, False)
    assert a.elapsed_days == 3 and a.effective_status == "late"


def test_grade_a_drops_to_b():
    a = wave1_after_breakout(0)
    a.checks.append(buy.Check(True, "加点", required=False))   # 加点2つで A
    assert a.grade == "A"
    a.elapsed.days = 2
    assert a.grade == "B"


def test_order_status_has_no_elapsed():
    a = buy.analyze_buy(common.demo_prices("DEMO-上抜け直前"), "1234.T")
    assert a.elapsed is None and a.penalty == 0 and a.elapsed_text is None
