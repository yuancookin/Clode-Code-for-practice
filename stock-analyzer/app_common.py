"""アプリの各ページで共通に使う部品（株価の取得とキャッシュ、サイドバーの共通部分）。"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from buy import fundamentals_check
from common import fetch_prices

DISCLAIMER = "本アプリの判定は投資助言ではありません。最終判断はご自身で行ってください。"


@st.cache_data(ttl=900, show_spinner=False)
def cached_prices(ticker: str, period: str) -> pd.DataFrame:
    return fetch_prices(ticker, period)


@st.cache_data(ttl=3600, show_spinner=False)
def cached_fundamentals(ticker: str):
    return fundamentals_check(ticker)


def sidebar_footer() -> None:
    """サイドバーの下に「株価を取り直す」ボタンと注意書きを出す。"""
    if st.button("株価を取り直す", help="取得した株価は15分間保存しています。大引け後すぐなどに最新の終値を取り直します"):
        st.cache_data.clear()
        st.toast("保存していた株価を消去しました。もう一度「判定する」を押してください")
    st.divider()
    st.caption(DISCLAIMER)
