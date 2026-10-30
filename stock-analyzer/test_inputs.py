import pandas as pd
import pytest

from inputs import load_price_file, parse_ticker, parse_tickers, ticker_from_filename


@pytest.mark.parametrize("text, expected", [
    ("7203", "7203.T"),
    ("7203.t", "7203.T"),
    ("130a", "130A.T"),
    ("AAPL", "AAPL"),
    ("https://finance.yahoo.co.jp/quote/7203.T", "7203.T"),
    ("https://finance.yahoo.co.jp/quote/7203.T/chart?styl=cndl", "7203.T"),
    ("https://finance.yahoo.com/quote/AAPL/", "AAPL"),
    ("https://kabutan.jp/stock/?code=9202", "9202.T"),
    ("https://minkabu.jp/stock/6758", "6758.T"),
    ("https://example.com/foo", None),
    ("買い候補", None),
])
def test_parse_ticker(text, expected):
    assert parse_ticker(text) == expected


def test_parse_tickers_splits_and_dedupes():
    tickers, unknown = parse_tickers("7203\n7203.T, 6758、https://example.com/x")
    assert tickers == ["7203.T", "6758.T"] and unknown == ["https://example.com/x"]


def test_load_japanese_cp932_csv_with_commas():
    csv = "日付,始値,高値,安値,終値,出来高\n2024/01/05,\"2,510\",\"2,530\",\"2,500\",\"2,520\",\"1,000\"\n2024/01/04,2500,2520,2490,2510,900\n"
    df = load_price_file(csv.encode("cp932"), "7203.csv")
    assert list(df.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert df.index[0] == pd.Timestamp("2024-01-04")  # 日付の昇順に並べ替える
    assert df["Close"].iloc[-1] == 2520 and df["Volume"].iloc[-1] == 1000


def test_load_english_excel(tmp_path):
    src = pd.DataFrame({"Date": pd.bdate_range("2024-01-01", periods=3), "Open": [1, 2, 3], "High": [2, 3, 4],
                        "Low": [0, 1, 2], "Close": [1.5, 2.5, 3.5], "Volume": [10, 20, 30]})
    path = tmp_path / "AAPL.xlsx"
    src.to_excel(path, index=False)
    assert len(load_price_file(path.read_bytes(), "AAPL.xlsx")) == 3


def test_missing_columns_are_reported():
    with pytest.raises(ValueError, match="必要な列が見つかりません: .*Volume"):
        load_price_file("Date,Open,High,Low,Close\n2024-01-01,1,1,1,1\n".encode(), "x.csv")


def test_ticker_from_filename():
    assert ticker_from_filename("7203_daily.csv") == "7203.T"
    assert ticker_from_filename("prices.csv") == "prices"
