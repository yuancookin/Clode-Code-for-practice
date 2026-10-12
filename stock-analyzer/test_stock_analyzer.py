import numpy as np
import pandas as pd

import stock_analyzer as sa


def series(values):
    return pd.Series(values, index=pd.bdate_range("2024-01-01", periods=len(values)), dtype=float)


def test_crossed_detects_recent_cross_only():
    above = pd.Series([False] * 10 + [True] * 3)
    assert sa.crossed(above, 5) == (True, False)
    assert sa.crossed(above, 2) == (False, False)


def test_bollinger_rebound_from_lower_band():
    base = 100 + np.sin(np.arange(60))
    close = series(np.r_[base, 90, 97])  # -2σ を割り込んだ翌日に反発
    assert sa.analyze_bollinger(close).score == 2


def test_bollinger_overheated():
    close = series(np.r_[100 + np.sin(np.arange(60)), 115])
    assert sa.analyze_bollinger(close).score == -2


def test_ma75_uptrend_and_downtrend():
    assert sa.analyze_ma75(series(np.linspace(100, 200, 120))).score == 2
    assert sa.analyze_ma75(series(np.linspace(200, 100, 120))).score == -2


def test_granville_buy1_on_turn_up():
    # 下落 → 底這い → 上抜け
    close = series(np.r_[np.linspace(150, 100, 60), np.full(25, 100.0), [101, 103]])
    result = sa.analyze_granville(close)
    assert result.score == 2 and result.reason.startswith("買い①")


def test_granville_buy2_after_temporary_dip():
    up = np.linspace(100, 150, 60)
    close = series(np.r_[up, 140, 152])  # 上昇中に一時的に25日線を割り込み → 回復
    result = sa.analyze_granville(close)
    assert result.score == 2 and result.reason.startswith("買い②")


def test_granville_buy4_large_negative_gap():
    close = series(np.r_[np.linspace(200, 150, 60), 120])
    result = sa.analyze_granville(close)
    assert result.score == 1 and result.reason.startswith("買い④")


def test_macd_not_used_for_buy():
    assert sa.analyze_macd not in sa.BUY_METHODS


def test_verdict_thresholds():
    assert [sa.verdict(t) for t in (6, 4, 3, 2, 1, -1, -2, -4)] == [
        "強い買い", "強い買い", "買い", "買い", "様子見", "様子見", "売り", "強い売り",
    ]


def test_demo_runs():
    assert sa.main(["--demo", "--backtest"]) == 0
