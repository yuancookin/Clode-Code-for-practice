import datetime as dt

import numpy as np
import pandas as pd
import pytest

import buy
import common


def bars(last: str, n: int = 150) -> pd.DataFrame:
    idx = pd.bdate_range(end=pd.Timestamp(last), periods=n)
    close = np.linspace(100, 120, n)
    return pd.DataFrame({"Open": close, "High": close + 1, "Low": close - 1, "Close": close, "Volume": 500_000}, index=idx)


TUE_MORNING = dt.datetime(2026, 10, 20, 10, 0)     # 東京時間・取引時間中
TUE_EVENING = dt.datetime(2026, 10, 20, 16, 30)    # 大引け後


@pytest.mark.parametrize("now, expected", [
    (TUE_MORNING, dt.date(2026, 10, 19)),                       # 取引時間中 → 前日の終値まで
    (dt.datetime(2026, 10, 20, 15, 45), dt.date(2026, 10, 19)),  # 大引け直後はまだ配信待ち
    (TUE_EVENING, dt.date(2026, 10, 20)),
    (dt.datetime(2026, 10, 13, 9, 0), dt.date(2026, 10, 9)),     # 10/12 はスポーツの日 → 前の金曜
    (dt.datetime(2026, 10, 18, 12, 0), dt.date(2026, 10, 16)),   # 日曜
    (dt.datetime(2027, 1, 4, 9, 0), dt.date(2026, 12, 30)),      # 年末年始の休場
])
def test_latest_session_japan(now, expected):
    assert common.latest_session(True, now) == expected


def test_latest_session_us_uses_new_york_time():
    assert common.latest_session(False, dt.datetime(2026, 10, 20, 10, 0)) == dt.date(2026, 10, 19)
    # 東京の 10/21 05:00 は ニューヨークの 10/20 16:00 なので、まだ配信待ち
    tokyo = pd.Timestamp("2026-10-21 05:00", tz="Asia/Tokyo").to_pydatetime()
    assert common.latest_session(False, tokyo) == dt.date(2026, 10, 19)


def test_fresh_data():
    df, f = common.ensure_closed_bars(bars("2026-10-19"), "7203.T", TUE_MORNING)
    assert f.stale == 0 and not f.dropped_partial and "（最新）" in f.text


def test_stale_data_counts_trading_days_only():
    # 10/15(木) までのデータ。直近の取引日 10/19(月) まで、10/16 と 10/19 の 2営業日古い
    _, f = common.ensure_closed_bars(bars("2026-10-15"), "7203.T", TUE_MORNING)
    assert f.stale == 2 and "2営業日古い" in f.text
    # 祝日（10/12）は数えない
    _, f = common.ensure_closed_bars(bars("2026-10-09"), "7203.T", dt.datetime(2026, 10, 13, 16, 30))
    assert f.stale == 1


def test_partial_bar_during_session_is_dropped():
    df, f = common.ensure_closed_bars(bars("2026-10-20"), "7203.T", TUE_MORNING)
    assert df.index[-1] == pd.Timestamp("2026-10-19") and f.dropped_partial and f.stale == 0
    # もう一度かけても、確定済みの足は消さない
    df2, f2 = common.ensure_closed_bars(df, "7203.T", TUE_MORNING)
    assert len(df2) == len(df) and not f2.dropped_partial


def test_bar_after_close_is_kept():
    df, f = common.ensure_closed_bars(bars("2026-10-20"), "7203.T", TUE_EVENING)
    assert df.index[-1] == pd.Timestamp("2026-10-20") and f.stale == 0


def test_order_expiry_skips_holidays():
    # 2025/12/29(月) に判定 → 翌取引日 12/30 の週。1/2(金) は年始の休場なので 12/30 が最後の取引日
    assert common.order_expiry(pd.Timestamp("2025-12-29")) == pd.Timestamp("2025-12-30")
    assert common.fmt_date(pd.Timestamp("2026-10-16")) == "2026-10-16(金)"


def test_stale_order_note():
    df = common.demo_prices("DEMO-上抜け直前")
    a = buy.analyze_buy(df, "1234.T")
    last = df.index[-1].date()
    a.freshness = common.Freshness(last, last, 0, False)
    assert a.stale_order_note is None
    a.freshness = common.Freshness(last, last + dt.timedelta(days=14), 10, False)
    assert "判定し直して" in a.stale_order_note and "すでに過ぎている" in a.stale_order_note


def test_stale_status_label():
    df = common.demo_prices("DEMO-上抜け直前")
    a = buy.analyze_buy(df, "1234.T")
    assert a.status_label == "買い注文を出す"
    last = df.index[-1].date()
    a.freshness = common.Freshness(last, last + dt.timedelta(days=3), 3, False)
    assert a.status_label == "買い注文を出す（要再判定）"
