"""アプリのページ: 買いの判定。

銘柄コード・株価サイトのリンク・株価ファイル（CSV / Excel）を入れると、
ma75-trading のルールで買いの状況を判定する。
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from app_common import cached_fundamentals, cached_prices, sidebar_footer
from buy import (
    MIN_DAYS, MIN_VOLUME, STATUS_ORDER, BuyAnalysis, analyze_buy, backtest_buy, find_decline, find_turn_line,
    position_size, summarize,
)
from common import DEMO_SCENARIOS, MA_DAYS, demo_prices, ensure_closed_bars, fmt_date, fmt_price, is_japan, sma
from inputs import load_price_file, parse_tickers, ticker_from_filename

STATUS_STYLE = {  # 判定ごとの表示色
    "order": st.success, "filled": st.info, "late": st.warning, "turn_wait": st.warning, "watch": st.info, "avoid": st.error,
}


@dataclass
class Source:
    name: str
    df: pd.DataFrame | None
    can_fetch_fundamentals: bool
    error: str | None = None


# ---------------------------------------------------------------------------
# サイドバー: 設定
# ---------------------------------------------------------------------------

with st.sidebar:
    st.header("設定")
    period = st.selectbox("株価の取得期間", ["1y", "2y", "5y"], index=1,
                          help="Yahoo Finance から取得する期間。3段下げの確認には2年以上を推奨")
    risk = st.number_input("許容リスク額（円）", min_value=0, value=10_000, step=1_000,
                           help="1回の取引で許容する損失。株数の目安に使う（0 で使わない）")
    capital = st.number_input("1銘柄の投資上限（円）", min_value=0, value=500_000, step=100_000,
                              help="損切り幅が狭いと株数が過大になるため、投資額でも上限をかける（0 で使わない）")
    min_volume = st.number_input("出来高の下限（25日平均・株）", min_value=0, value=MIN_VOLUME, step=10_000)
    fundamentals = st.checkbox("業績も確認する（増収増益・PER・PBR）", value=False)
    run_backtest = st.checkbox("売買ルールを過去データで検証する", value=False,
                               help="買い・利益確定・ロスカットのルールで売買を再現します。銘柄数が多いと時間がかかります")
    sidebar_footer()


# ---------------------------------------------------------------------------
# 入力
# ---------------------------------------------------------------------------

st.title("📈 買いの判定")
st.write("銘柄コード・株価サイトのリンク・株価ファイルを入れると、75日線トレードのルールで**買いの状況**を判定します。")

tab_code, tab_file, tab_demo = st.tabs(["銘柄コード・リンク", "株価ファイル（CSV / Excel）", "デモデータ"])

with tab_code:
    text = st.text_area(
        "銘柄コードまたはリンク（複数可、改行区切り）",
        placeholder="7203\n6758.T\nhttps://finance.yahoo.co.jp/quote/9201.T\nhttps://kabutan.jp/stock/?code=9202",
        height=130,
    )
    st.caption("対応リンク: Yahoo!ファイナンス、Yahoo Finance（米国）、株探、みんかぶ。4桁のコードには自動で .T を付けます。")
    run_code = st.button("判定する", type="primary", key="run_code")

with tab_file:
    files = st.file_uploader("日足の株価ファイル（複数可）", type=["csv", "xlsx", "xls"], accept_multiple_files=True)
    st.caption(
        "必要な列: 日付・始値・高値・安値・終値・出来高（英語の Date, Open, High, Low, Close, Volume でも可）。"
        f"最低 {MIN_DAYS} 営業日分。銘柄名はファイル名の4桁コードから付けます（例: 7203_daily.csv → 7203.T）。"
    )
    market = st.radio("市場", ["日本株（円・東証の呼値）", "米国株など（0.01刻み）"], horizontal=True)
    run_file = st.button("判定する", type="primary", key="run_file")

with tab_demo:
    st.write("ネット接続なしで動作を確認できる疑似データです（1回目の波・上抜け直前・2回目の波・下落中の4パターン）。")
    run_demo = st.button("デモで判定する", type="primary", key="run_demo")


def collect_sources() -> list[Source] | None:
    if run_code:
        tickers, unknown = parse_tickers(text)
        if unknown:
            st.warning(f"銘柄として読み取れなかった入力: {', '.join(unknown)}")
        if not tickers:
            st.error("銘柄コードかリンクを入力してください")
            return None
        sources = []
        with st.spinner("株価を取得しています…"):
            for t in tickers:
                try:
                    sources.append(Source(t, cached_prices(t, period), True))
                except Exception as e:
                    sources.append(Source(t, None, False, str(e)))
        return sources
    if run_file:
        if not files:
            st.error("株価ファイルを選んでください")
            return None
        sources = []
        for f in files:
            try:
                name = ticker_from_filename(f.name)
                if market.startswith("日本株") and not name.upper().endswith(".T"):
                    name += ".T"  # 日本株として円の呼値で注文価格を出す
                sources.append(Source(name, load_price_file(f.getvalue(), f.name), False))
            except Exception as e:
                sources.append(Source(f.name, None, False, str(e)))
        return sources
    if run_demo:
        return [Source(name, demo_prices(name), False) for name in DEMO_SCENARIOS]
    return None


new_sources = collect_sources()
if new_sources is not None:
    st.session_state["buy_sources"] = new_sources
sources: list[Source] = st.session_state.get("buy_sources", [])
if not sources:
    st.stop()


# ---------------------------------------------------------------------------
# 判定
# ---------------------------------------------------------------------------

results: list[tuple[Source, BuyAnalysis]] = []
for src in sources:
    if src.df is None:
        continue
    try:
        # 取引時間中の未確定の足を除き、データの鮮度を確認する（何度実行しても同じ結果になる）
        src.df, freshness = ensure_closed_bars(src.df, src.name)
        a = analyze_buy(src.df, src.name, int(min_volume))
        a.freshness = freshness
    except Exception as e:
        src.error = str(e)
        continue
    if fundamentals and src.can_fetch_fundamentals:
        try:
            a.checks.append(cached_fundamentals(src.name))
        except Exception as e:
            st.warning(f"{src.name} の業績データを取得できませんでした: {e}")
    results.append((src, a))

for src in sources:
    if src.error:
        st.error(f"**{src.name}**: {src.error}")

if not results:
    st.stop()

results.sort(key=lambda r: (r[1].is_stale, STATUS_ORDER.index(r[1].effective_status), r[1].grade))

stale = [a for _, a in results if a.is_stale]
if stale:
    st.warning(
        f"**{len(stale)}銘柄のデータが最新ではありません**（{', '.join(a.ticker for a in stale)}）。"
        "75日線や注文価格は日々変わるため、最新の終値で判定し直してください。"
        "株価ファイルの場合は最新のものをダウンロードし直し、銘柄コードの場合はサイドバーの「株価を取り直す」を押してください。"
    )

st.subheader("判定一覧")
rows = []
for _, a in results:
    japan = is_japan(a.ticker)
    rows.append({
        "銘柄": a.ticker,
        "日付": a.date.strftime("%Y-%m-%d"),
        "データ": f"⚠ {a.freshness.stale}営業日前" if a.is_stale else "最新",
        "終値": fmt_price(a.close, japan),
        "判定": a.status_label,
        "波": a.wave,
        "評価": a.grade,
        "経過": f"{a.elapsed_days}営業日・{a.elapsed.gain:+.1%}" if a.elapsed else "",
        "逆指値（買い）": fmt_price(a.order.trigger, japan) if a.order else "",
        "ロスカット目安": fmt_price(a.order.stop, japan) if a.order else "",
        "有効期限": fmt_date(a.order.expires)[5:] if a.order else "",
    })
table = pd.DataFrame(rows)
st.dataframe(table, hide_index=True, width="stretch")
st.download_button("一覧を CSV で保存", table.to_csv(index=False).encode("utf-8-sig"),
                   file_name="ma75_judgement.csv", mime="text/csv")


# ---------------------------------------------------------------------------
# 銘柄ごとの詳細
# ---------------------------------------------------------------------------


def price_chart(df: pd.DataFrame, a: BuyAnalysis, days: int = 250) -> go.Figure:
    japan = is_japan(a.ticker)
    ma = sma(df["Close"], MA_DAYS)
    view = df.iloc[-days:]
    fig = go.Figure()
    fig.add_trace(go.Candlestick(
        x=view.index, open=view["Open"], high=view["High"], low=view["Low"], close=view["Close"], name="株価",
        increasing_line_color="#d62728", decreasing_line_color="#1f77b4",  # 日本式: 陽線は赤、陰線は青
    ))
    fig.add_trace(go.Scatter(x=view.index, y=ma.iloc[-days:], name="75日線", line=dict(color="#ff7f0e", width=2)))

    if a.wave == "1回目の波":
        dec = find_decline(df)
        for idx, label, col, ay in ((dec.peak, "下落前の高値", "High", -35), (dec.bottom, "底", "Low", 35)):
            if df.index[idx] >= view.index[0]:
                fig.add_annotation(x=df.index[idx], y=df[col].iloc[idx], text=label, showarrow=True, arrowhead=2, ay=ay)
    else:
        line = find_turn_line(df, ma)
        if line is not None:
            fig.add_shape(type="line", x0=df.index[line.high_idx], x1=df.index[-1], y0=line.level, y1=line.level,
                          line=dict(color="#2ca02c", dash="dash"))
            fig.add_annotation(x=df.index[line.high_idx], y=line.level, text="トレンド転換線", showarrow=False,
                               yshift=10, xanchor="left")

    if a.order:
        # 買いとロスカットは1〜2呼値しか離れないので、ラベルを線の上と下に分ける
        for y, label, color, pos in ((a.order.trigger, "逆指値（買い）", "#2ca02c", "top left"),
                                     (a.order.stop, "ロスカット目安", "#d62728", "bottom left")):
            fig.add_hline(y=y, line=dict(color=color, dash="dot"),
                          annotation_text=f"{label} {fmt_price(y, japan)}", annotation_position=pos,
                          annotation_font_color=color)

    fig.update_layout(height=460, margin=dict(l=10, r=10, t=30, b=10), xaxis_rangeslider_visible=False,
                      legend=dict(orientation="h", y=1.05, x=0))
    fig.update_xaxes(rangebreaks=[dict(bounds=["sat", "mon"])])
    return fig


st.subheader("銘柄ごとの詳細")
for src, a in results:
    japan = is_japan(a.ticker)
    with st.expander(f"{a.ticker}　{a.status_label}【{a.wave}】　評価 {a.grade}", expanded=a.status == "order"):
        if a.freshness:
            (st.warning if a.is_stale else st.caption)(("⚠ " if a.is_stale else "") + a.freshness.text)
        # 古いデータの判定は「買い注文を出す」でも緑にせず、注意の色で出す
        (st.warning if a.is_stale else STATUS_STYLE[a.effective_status])(f"**{a.status_label}** — {a.summary}")
        if a.elapsed_text:
            (st.warning if a.penalty else st.caption)(f"経過: {a.elapsed_text}")

        left, right = st.columns([3, 2])
        with left:
            st.plotly_chart(price_chart(src.df, a), width="stretch")
        with right:
            st.markdown("**チェック項目**")
            for c in a.checks:
                mark = ("✅" if c.ok else "❌") if c.required else ("➕" if c.ok else "▫️")
                st.markdown(f"{mark} {c.text}" + ("" if c.required else "（加点）"))

            if a.order:
                o = a.order
                size = position_size(o, japan, risk or None, capital or None)
                st.markdown("**逆指値注文**")
                if a.stale_order_note:
                    st.error(a.stale_order_note)
                st.markdown(
                    f"- 買い: **{fmt_price(o.trigger, japan)} 以上**になったら {fmt_price(o.trigger, japan)} で買い"
                    f"（{o.basis}）\n"
                    f"- 有効期限: {fmt_date(o.expires)} まで\n"
                    f"- ロスカット目安: **{fmt_price(o.stop, japan)} 以下**で売り（約定日の75日線−1呼値で確定させる）\n"
                    f"- リスク: 1株 {fmt_price(size.per_share, japan)}（{size.unit}株で {fmt_price(size.per_share * size.unit, japan)}）"
                )
                if size.shares is not None:
                    st.metric("株数の目安", f"{size.shares:,}株", help=f"{size.decided_by}で決定")
                    st.caption(f"投資額 {fmt_price(size.shares * o.trigger, japan)}")
                if size.narrow_stop:
                    st.warning(f"損切り幅が {size.per_share / o.trigger:.1%} と狭いです。窓を開けて下がると、損失は想定より大きくなります。")
                st.caption("75日線は毎日動くため、約定するまで注文価格を毎日見直してください。「以上」と「以下」を逆にしないこと。")

        if run_backtest:
            with st.spinner("過去データで検証しています…"):
                trades = backtest_buy(src.df, a.ticker, int(min_volume))
            s = summarize(trades)
            st.markdown("**過去検証**（売りは利益確定・ロスカットのルールどおり。手数料・スリッページは含まない）")
            if not s or not s["trades"]:
                st.write("決済済みの取引はありません" + (f"（保有中 {s['open']}件）" if s and s["open"] else ""))
            else:
                cols = st.columns(5)
                cols[0].metric("取引回数", s["trades"])
                cols[1].metric("勝率", f"{s['win_rate']:.0%}")
                cols[2].metric("平均リターン", f"{s['avg_return']:+.2%}")
                cols[3].metric("損益比", "-" if s["payoff"] is None else f"{s['payoff']:.2f}")
                cols[4].metric("最大ドローダウン", f"{s['max_drawdown']:.1%}")
                st.dataframe(pd.DataFrame([{
                    "買い": t.entry_date.strftime("%Y-%m-%d"), "買値": fmt_price(t.entry, japan),
                    "決済": t.exit_date.strftime("%Y-%m-%d"), "決済値": fmt_price(t.exit, japan),
                    "損益": f"{t.ret:+.2%}", "理由": t.reason, "波": t.wave,
                } for t in trades]), hide_index=True, width="stretch")
