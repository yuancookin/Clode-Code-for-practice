import numpy as np
import pandas as pd

import stock_analyzer as sa


def series(values):
    return pd.Series(values, index=pd.bdate_range("2024-01-01", periods=len(values)), dtype=float)


def test_crossed_detects_recent_cross_only():
    above = pd.Series([False] * 10 + [True] * 3)
    assert sa.crossed(above, 5) == (True, False)
    assert sa.crossed(above, 2) == (False, False)


def test_rsi_bounds():
    assert sa.rsi(series(np.arange(1, 50))).iloc[-1] == 100
    assert sa.rsi(series(np.arange(50, 1, -1))).iloc[-1] < 1


def test_golden_cross_after_downtrend_reversal():
    close = series(np.r_[np.linspace(200, 100, 100), np.linspace(100, 220, 40)])
    above = sa.sma(close, 25) > sa.sma(close, 75)
    cross_at = int(np.argmax(above.values))
    result = sa.analyze_moving_average(close.iloc[: cross_at + 2])
    assert result.score == 2


def test_verdict_thresholds():
    assert [sa.verdict(t) for t in (6, 4, 3, 2, 1, -1, -2, -4)] == [
        "強い買い", "強い買い", "買い", "買い", "様子見", "様子見", "売り", "強い売り",
    ]


def test_demo_runs():
    assert sa.main(["--demo"]) == 0
