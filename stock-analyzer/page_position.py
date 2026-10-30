"""アプリのページ: 保有銘柄の判定（利益確定・ロスカット）。

保有銘柄（銘柄・買付日・買値・株数）を入れると、ma75-trading のルールで
利益確定とロスカットのタイミングを判定する。
"""

from __future__ import annotations

import datetime as dt

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from app_common import cached_prices, sidebar_footer
from common import MA_DAYS, bollinger, ensure_closed_bars, fmt_date, fmt_price, is_japan, macd, sma
from inputs import load_positions, load_price_file, parse_ticker, ticker_from_filename
from position import ACTIONS, DEMO_POSITIONS, Position, PositionAnalysis, analyze_position, demo_position

ACTION_STYLE = {"losscut": st.error, "take_profit": st.success, "hold": st.info}

with st.sidebar:
    st.header("設定")
    period = st.selectbox("株価の取得期間", ["1y", "2y", "5y"], index=1,
                          help="買付日より前に75営業日以上のデータが必要です")
    sidebar_footer()

st.title("💼 保有銘柄の判定")
st.write("保有している銘柄を入れると、75日線トレードのルールで**利益確定**と**ロスカット**のタイミングを判定します。")

tab_edit, tab_file, tab_demo = st.tabs(["入力する", "一覧ファイル（CSV / Excel）", "デモデータ"])

with tab_edit:
    blank = pd.DataFrame({"銘柄": pd.Series(dtype="str"), "買付日": pd.Series(dtype="object"),
                          "買値": pd.Series(dtype="float"), "株数": pd.Series(dtype="float")})
    edited = st.data_editor(
        blank, num_rows="dynamic", width="stretch", key="positions_editor",
        column_config={
            "銘柄": st.column_config.TextColumn(help="7203 / 7203.T / Yahoo!ファイナンスのリンクなど"),
            "買付日": st.column_config.DateColumn(format="YYYY-MM-DD", help="約定した日"),
            "買値": st.column_config.NumberColumn(min_value=0.0, format="%.2f", help="約定単価"),
            "株数": st.column_config.NumberColumn(min_value=0, step=1, format="%d", help="省略可（損益額・リスク額に使う）"),
        },
    )
    run_edit = st.button("判定する", type="primary", key="run_edit")

with tab_file:
    pos_file = st.file_uploader("保有銘柄の一覧", type=["csv", "xlsx", "xls"], key="positions_file")
    st.caption("列: 銘柄・買付日・買値・株数（英語の ticker, entry_date, entry_price, shares でも可）。株数は省略できます。")
    run_file = st.button("判定する", type="primary", key="run_file")

with tab_demo:
    st.write("ネット接続なしで動作を確認できる疑似データです（保有継続・利益確定・ロスカットの3パターン）。")
    run_demo = st.button("デモで判定する", type="primary", key="run_demo")

with st.expander("株価を Yahoo Finance から取らずにファイルで渡す（任意）"):
    price_files = st.file_uploader("日足の株価ファイル（ファイル名に4桁の銘柄コードを入れる。例: 7203_daily.csv）",
                                   type=["csv", "xlsx", "xls"], accept_multiple_files=True, key="price_files")


def positions_from_editor(df: pd.DataFrame) -> list[Position]:
    positions = []
    for i, row in df.iterrows():
        if pd.isna(row["銘柄"]) or not str(row["銘柄"]).strip():
            continue
        ticker = parse_ticker(str(row["銘柄"]))
        if ticker is None:
            raise ValueError(f"{i + 1}行目: 銘柄を読み取れません（{row['銘柄']}）")
        if pd.isna(row["買付日"]) or pd.isna(row["買値"]):
            raise ValueError(f"{i + 1}行目（{ticker}）: 買付日と買値を入れてください")
        shares = None if pd.isna(row["株数"]) else int(row["株数"])
        positions.append(Position(ticker, pd.Timestamp(row["買付日"]), float(row["買値"]), shares))
    return positions


def load_jobs() -> list[tuple[Position, pd.DataFrame | None, str | None]] | None:
    """(保有銘柄, 株価, エラー) の一覧。ボタンが押されていなければ None。"""
    if run_demo:
        return [(*demo_position(name), None) for name in DEMO_POSITIONS]
    if not (run_edit or run_file):
        return None
    try:
        if run_file:
            if pos_file is None:
                st.error("保有銘柄の一覧ファイルを選んでください")
                return None
            positions = load_positions(pos_file.getvalue(), pos_file.name)
        else:
            positions = positions_from_editor(edited)
    except Exception as e:
        st.error(str(e))
        return None
    if not positions:
        st.error("保有銘柄を1つ以上入れてください")
        return None

    files = {ticker_from_filename(f.name): f for f in price_files or []}
    jobs = []
    with st.spinner("株価を取得しています…"):
        for pos in positions:
            try:
                f = files.get(pos.ticker)
                df = load_price_file(f.getvalue(), f.name) if f else cached_prices(pos.ticker, period)
                jobs.append((pos, df, None))
            except Exception as e:
                jobs.append((pos, None, str(e)))
    return jobs


new_jobs = load_jobs()
if new_jobs is not None:
    st.session_state["position_jobs"] = new_jobs
jobs = st.session_state.get("position_jobs", [])
if not jobs:
    st.stop()

results: list[tuple[PositionAnalysis, pd.DataFrame]] = []
for pos, df, error in jobs:
    if error is None:
        try:
            df, freshness = ensure_closed_bars(df, pos.ticker)
            r = analyze_position(df, pos)
            r.freshness = freshness
            results.append((r, df))
            continue
        except Exception as e:
            error = str(e)
    st.error(f"**{pos.ticker}**: {error}")

if not results:
    st.stop()
results.sort(key=lambda x: list(ACTIONS).index(x[0].action))

stale = [r for r, _ in results if r.is_stale]
if stale:
    st.warning(f"**{len(stale)}銘柄のデータが最新ではありません**（{', '.join(r.position.ticker for r in stale)}）。"
               "最新の終値で判定し直してください。")

# ---------------------------------------------------------------------------
# 一覧
# ---------------------------------------------------------------------------

st.subheader("判定一覧")
table = pd.DataFrame([{
    "銘柄": r.position.ticker,
    "判定": r.action_label,
    "損益": f"{r.pnl:+.1%}" + ("（売却時）" if r.sold else ""),
    "買付日": fmt_date(r.position.entry_date),
    "買値": fmt_price(r.position.entry_price, is_japan(r.position.ticker)),
    "ロスカット逆指値": fmt_price(r.scan.stop, is_japan(r.position.ticker)) + " 以下",
    "データ": f"⚠ {r.freshness.stale}営業日前" if r.is_stale else "最新",
    "次にすること": r.action_text,
} for r, _ in results])
st.dataframe(table, hide_index=True, width="stretch")
st.download_button("一覧を CSV で保存", table.to_csv(index=False).encode("utf-8-sig"),
                   file_name="ma75_positions.csv", mime="text/csv")


# ---------------------------------------------------------------------------
# 銘柄ごとの詳細
# ---------------------------------------------------------------------------


def position_chart(df: pd.DataFrame, r: PositionAnalysis, before: int = 60) -> go.Figure:
    japan = is_japan(r.position.ticker)
    s = r.scan
    view = df.iloc[max(0, s.entry_idx - before):]
    bb = bollinger(df["Close"])
    line, sig, hist = macd(df["Close"])
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True, row_heights=[0.72, 0.28], vertical_spacing=0.04)

    fig.add_trace(go.Candlestick(
        x=view.index, open=view["Open"], high=view["High"], low=view["Low"], close=view["Close"], name="株価",
        increasing_line_color="#d62728", decreasing_line_color="#1f77b4",  # 日本式: 陽線は赤、陰線は青
    ), row=1, col=1)
    fig.add_trace(go.Scatter(x=view.index, y=sma(df["Close"], MA_DAYS).loc[view.index], name="75日線",
                             line=dict(color="#ff7f0e", width=2)), row=1, col=1)
    for key, dash in (("+2σ", "dot"), ("+1σ", "dash")):
        fig.add_trace(go.Scatter(x=view.index, y=bb[key].loc[view.index], name=f"BB25 {key}",
                                 line=dict(color="#9467bd", width=1, dash=dash)), row=1, col=1)

    fig.add_hline(y=s.stop, line=dict(color="#d62728", dash="dot"), row=1, col=1,
                  annotation_text=f"ロスカット {fmt_price(s.stop, japan)}", annotation_position="bottom left",
                  annotation_font_color="#d62728")
    fig.add_trace(go.Scatter(x=[df.index[s.entry_idx]], y=[r.position.entry_price], mode="markers+text", name="買い",
                             text=["買い"], textposition="bottom center",
                             marker=dict(symbol="triangle-up", size=14, color="#2ca02c")), row=1, col=1)
    ev = s.event
    if ev and ev.exec_idx is not None:
        label = "ロスカット" if ev.kind == "losscut" else "利益確定"
        fig.add_trace(go.Scatter(x=[df.index[ev.exec_idx]], y=[ev.price], mode="markers+text", name=label,
                                 text=[label], textposition="top center",
                                 marker=dict(symbol="triangle-down", size=14, color="#111111")), row=1, col=1)

    colors = ["#d62728" if v >= 0 else "#1f77b4" for v in hist.loc[view.index]]
    fig.add_trace(go.Bar(x=view.index, y=hist.loc[view.index], name="MACD 乖離", marker_color=colors), row=2, col=1)
    fig.add_trace(go.Scatter(x=view.index, y=line.loc[view.index], name="MACD", line=dict(color="#111111", width=1)),
                  row=2, col=1)
    fig.add_trace(go.Scatter(x=view.index, y=sig.loc[view.index], name="シグナル", line=dict(color="#ff7f0e", width=1)),
                  row=2, col=1)

    fig.update_layout(height=560, margin=dict(l=10, r=10, t=30, b=10), xaxis_rangeslider_visible=False,
                      legend=dict(orientation="h", y=1.06, x=0))
    fig.update_xaxes(rangebreaks=[dict(bounds=["sat", "mon"])])
    return fig


st.subheader("銘柄ごとの詳細")
for r, df in results:
    pos = r.position
    with st.expander(f"{pos.ticker}　{r.action_label}　損益 {r.pnl:+.1%}", expanded=r.action != "hold"):
        if r.freshness:
            (st.warning if r.is_stale else st.caption)(("⚠ " if r.is_stale else "") + r.freshness.text)
        (st.warning if r.is_stale else ACTION_STYLE[r.action])(f"**{r.action_label}** — {r.action_text}")

        left, right = st.columns([3, 2])
        with left:
            st.plotly_chart(position_chart(df, r), width="stretch")
        with right:
            st.markdown("**ロスカット**")
            st.markdown("\n".join(f"- {line}" for line in r.losscut_lines))
            st.markdown("**利益確定**")
            st.markdown("\n".join(f"- {line}" for line in r.profit_lines))
            st.caption("ロスカットは「以下」、買いは「以上」。逆指値の条件を逆にしないこと。")

st.caption(f"判定日時: {dt.datetime.now():%Y-%m-%d %H:%M}")
