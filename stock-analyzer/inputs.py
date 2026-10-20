"""アプリへの入力（銘柄コード・株価サイトのリンク・アップロードされた株価ファイル）を分析用の形に変換する。"""

from __future__ import annotations

import io
import re
from pathlib import PurePath
from urllib.parse import parse_qs, urlparse

import pandas as pd

# 東証の銘柄コードは4桁（2024年以降は英字を含む "130A" のような形もある）
JP_CODE = re.compile(r"^\d{3}[0-9A-Z]$")


def normalize_code(code: str) -> str:
    """"7203" → "7203.T"、"7203.T" / "AAPL" はそのまま。"""
    code = code.strip().upper()
    return f"{code}.T" if JP_CODE.match(code) else code


def parse_ticker(text: str) -> str | None:
    """銘柄コード、または株価サイトのリンクから Yahoo Finance の銘柄コードを取り出す。

    対応しているリンク:
      https://finance.yahoo.co.jp/quote/7203.T   https://finance.yahoo.com/quote/AAPL/
      https://kabutan.jp/stock/?code=7203        https://minkabu.jp/stock/7203
    """
    text = text.strip()
    if not text:
        return None
    if not re.match(r"^https?://", text):
        return normalize_code(text) if re.match(r"^[0-9A-Za-z.\-^=]+$", text) else None

    url = urlparse(text)
    host, parts = url.netloc.lower(), [p for p in url.path.split("/") if p]
    if "yahoo" in host and "quote" in parts and parts.index("quote") + 1 < len(parts):
        return normalize_code(parts[parts.index("quote") + 1])
    if "kabutan" in host and "code" in parse_qs(url.query):
        return normalize_code(parse_qs(url.query)["code"][0])
    if "minkabu" in host and "stock" in parts and parts.index("stock") + 1 < len(parts):
        return normalize_code(parts[parts.index("stock") + 1])
    return None


def parse_tickers(text: str) -> tuple[list[str], list[str]]:
    """改行・カンマ・空白区切りの入力を銘柄コードの一覧にする。読めなかったものは2つ目に返す。"""
    tickers, unknown = [], []
    for item in re.split(r"[\s,、]+", text):
        if not item:
            continue
        t = parse_ticker(item)
        if t is None:
            unknown.append(item)
        elif t not in tickers:
            tickers.append(t)
    return tickers, unknown


# ---------------------------------------------------------------------------
# 株価ファイル（CSV / Excel）
# ---------------------------------------------------------------------------

COLUMN_ALIASES = {
    "Date": ["date", "日付", "年月日", "日時"],
    "Open": ["open", "始値"],
    "High": ["high", "高値"],
    "Low": ["low", "安値"],
    "Close": ["close", "終値", "adj close", "調整後終値", "終値（調整後）"],
    "Volume": ["volume", "出来高"],
}


def _rename_columns(df: pd.DataFrame) -> pd.DataFrame:
    renamed = {}
    for col in df.columns:
        key = str(col).strip().lower()
        for std, aliases in COLUMN_ALIASES.items():
            if key in aliases and std not in renamed.values():
                renamed[col] = std
                break
    return df.rename(columns=renamed)


def _read_table(data: bytes, filename: str) -> pd.DataFrame:
    suffix = PurePath(filename).suffix.lower()
    if suffix in (".xlsx", ".xls"):
        return pd.read_excel(io.BytesIO(data))
    for enc in ("utf-8-sig", "cp932"):  # 日本の証券会社の CSV は Shift_JIS (cp932) が多い
        try:
            return pd.read_csv(io.BytesIO(data), encoding=enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("文字コードを判別できませんでした（UTF-8 か Shift_JIS で保存してください）")


def load_price_file(data: bytes, filename: str) -> pd.DataFrame:
    """日足の株価ファイルを読み込み、日付昇順の OHLCV にする。

    列名は英語（Date, Open, High, Low, Close, Volume）でも日本語（日付, 始値, 高値, 安値, 終値, 出来高）でもよい。
    """
    df = _rename_columns(_read_table(data, filename))
    missing = [c for c in COLUMN_ALIASES if c not in df.columns]
    if missing:
        raise ValueError(f"必要な列が見つかりません: {', '.join(missing)}（見つかった列: {', '.join(map(str, df.columns))}）")

    df = df[list(COLUMN_ALIASES)].copy()
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    for col in ("Open", "High", "Low", "Close", "Volume"):
        df[col] = pd.to_numeric(df[col].astype(str).str.replace(",", "").str.strip(), errors="coerce")
    df = df.dropna().drop_duplicates("Date").sort_values("Date").set_index("Date")
    if df.empty:
        raise ValueError("株価として読める行がありませんでした")
    return df


def ticker_from_filename(filename: str) -> str:
    """"7203_daily.csv" → "7203.T"。コードが見つからなければファイル名をそのまま使う。"""
    stem = PurePath(filename).stem
    m = re.search(r"(?<![0-9A-Za-z])(\d{3}[0-9A-Z])(?![0-9A-Za-z])", stem.upper())
    return normalize_code(m.group(1)) if m else stem
