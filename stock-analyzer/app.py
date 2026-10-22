"""75日線トレード判定アプリ（Streamlit）。

    streamlit run app.py

ページ:
  - 買いの判定       … 銘柄コード・リンク・株価ファイルから買いの状況を判定（page_buy.py）
  - 保有銘柄の判定   … 保有銘柄の利益確定・ロスカットのタイミングを判定（page_position.py）
"""

import streamlit as st

st.set_page_config(page_title="75日線トレード判定", page_icon="📈", layout="wide")

st.navigation([
    st.Page("page_buy.py", title="買いの判定", icon="📈", default=True),
    st.Page("page_position.py", title="保有銘柄の判定", icon="💼"),
]).run()
