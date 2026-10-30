"""体外受精スケジュール（通院予測カレンダー）  —  streamlit run app.py"""
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import streamlit as st

import schedule as S
import store

st.set_page_config(page_title="体外受精スケジュール", page_icon="📅", layout="centered")

JST = timezone(timedelta(hours=9))
TODAY = datetime.now(JST).date()
USE_DB = store.configured()

st.markdown(
    """<style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Zen+Kaku+Gothic+New:wght@300;400;500;700&display=swap');
    :root{--ink:#1E2A33;--mute:#5E7183;--line:rgba(30,42,51,.14);--accent:#E04A2C;--paper:rgba(255,255,255,.62)}
    header[data-testid="stHeader"]{display:none}
    .stApp{background:linear-gradient(180deg,#B9CDDC 0%,#C9D8E4 38%,#DCE6EE 100%) fixed}
    .block-container{padding-top:1.4rem;padding-bottom:4rem;max-width:680px}
    .ivf-bar .today b,.ivf-hero .big,.ivf-c .n{font-variant-numeric:lining-nums}
    .serif{font-family:'Cormorant Garamond',serif}
    /* 見出し：雑誌の表紙のように */
    .ivf-bar{position:relative;margin:0 0 18px;padding-bottom:12px;border-bottom:1px solid var(--line)}
    .ivf-bar .logo{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:46px;line-height:.95;letter-spacing:.01em;color:var(--ink)}
    .ivf-bar .logo em{font-style:italic;color:var(--accent)}
    .ivf-bar .meta{display:flex;justify-content:space-between;align-items:flex-end;margin-top:8px}
    .ivf-bar .ja{font-size:11px;letter-spacing:.32em;color:var(--mute);font-weight:500}
    .ivf-bar .today{font-size:11px;letter-spacing:.12em;color:var(--ink);text-align:right;line-height:1.5}
    .ivf-bar .today b{font-family:'Cormorant Garamond',serif;font-weight:400;font-size:22px;letter-spacing:0;display:block}
    .ivf-intro{font-size:13px;color:var(--mute);line-height:1.9;margin:-6px 0 16px;font-weight:400}
    /* タブ：細い下線だけ */
    div[data-testid="stTabs"] [data-baseweb="tab-list"]{gap:0;background:transparent;border-bottom:1px solid var(--line)}
    div[data-testid="stTabs"] [data-baseweb="tab"]{flex:1 1 0;justify-content:center;height:40px;padding:0 2px;background:transparent}
    div[data-testid="stTabs"] [data-baseweb="tab"] p{font-size:12.5px;font-weight:500;color:var(--mute);letter-spacing:.08em;white-space:nowrap}
    div[data-testid="stTabs"] [aria-selected="true"] p{color:var(--ink);font-weight:700}
    div[data-testid="stTabs"] [data-baseweb="tab-highlight"]{background:var(--accent);height:2px}
    div[data-testid="stTabs"] [data-baseweb="tab-border"]{display:none}
    /* カード：すりガラス */
    div[data-testid="stVerticalBlockBorderWrapper"]{background:var(--paper);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-color:rgba(255,255,255,.7)!important}
    .ivf-h{font-size:15px;font-weight:700;color:var(--ink);margin:2px 0 2px;letter-spacing:.04em}
    .ivf-sub{font-size:12px;color:var(--mute);margin:0 0 8px;line-height:1.7}
    div[data-testid="stCaptionContainer"],div[data-testid="stCaptionContainer"] p{color:var(--mute)!important}
    /* 次の予定 */
    .ivf-hero{margin:18px 0 6px;padding:0 0 14px;border-bottom:1px solid var(--line)}
    .ivf-hero .lbl{font-size:10.5px;letter-spacing:.32em;color:var(--mute);font-weight:500}
    .ivf-hero .row{display:flex;align-items:flex-end;gap:16px;margin-top:2px}
    .ivf-hero .big{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:64px;line-height:.9;color:var(--ink);letter-spacing:-.01em}
    .ivf-hero .big small{font-size:15px;letter-spacing:.2em;margin-left:6px;color:var(--mute);font-weight:400}
    .ivf-hero .side{padding-bottom:6px}
    .ivf-hero .badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;border-radius:999px;padding:2px 10px;color:#fff;background:var(--accent)}
    .ivf-hero .ttl{font-size:20px;font-weight:700;color:var(--ink);margin-top:4px;letter-spacing:.04em}
    .ivf-hero .until{font-size:12px;color:var(--mute)}
    .ivf-hero ul{list-style:none;margin:14px 0 0;padding:0}
    .ivf-hero li{display:flex;align-items:center;gap:10px;font-size:13px;line-height:2.1;color:var(--ink);margin:0;border-top:1px solid rgba(30,42,51,.07)}
    .ivf-hero li i{width:7px;height:7px;border-radius:50%;flex:none}
    .ivf-hero li .d{color:var(--mute);min-width:9em;font-variant-numeric:tabular-nums;font-size:12.5px}
    .ivf-hero li .t{font-weight:500}
    </style>""",
    unsafe_allow_html=True,
)

ss = st.session_state


def bar():
    st.markdown(
        '<div class="ivf-bar"><div class="logo">IVF <em>schedule</em></div>'
        '<div class="meta"><div class="ja">体外受精スケジュール</div>'
        f'<div class="today">TODAY<b>{TODAY.month}.{TODAY.day:02d} {S.EN_WD[TODAY.weekday()]}</b></div></div></div>',
        unsafe_allow_html=True,
    )


# ---------- ログイン ----------
if USE_DB and not store.user():
    bar()
    st.caption("予定を見るには、ログインしてください。")
    with st.form("login"):
        email = st.text_input("メールアドレス", autocomplete="email")
        pw = st.text_input("パスワード", type="password", autocomplete="current-password")
        ok = st.form_submit_button("ログイン", type="primary", width="stretch")
    if ok:
        try:
            store.sign_in(email.strip(), pw)
        except Exception:
            st.error("ログインできませんでした。メールアドレスとパスワードを確認してください。")
        else:
            st.rerun()
    st.stop()

# ---------- 状態 ----------
if "base" not in ss:
    ss.ver = 0
    if USE_DB:
        try:
            loaded = store.load_events()
            ss.params = S.params_from_dict(store.load_params())
        except Exception as e:  # noqa: BLE001
            st.error(f"保存した予定を読み込めませんでした。少し待ってから再読み込みしてください。（{e}）")
            st.stop()
        ss.base = loaded
        ss.saved = loaded
    else:
        ss.params = S.Params()
        ss.base = S.generate(S.default_cycles(ss.params), ss.params)
if "events" not in ss:
    ss.events = ss.base


def set_base(df, msg=None):
    ss.base = S.normalize(df)
    ss.events = ss.base
    ss.ver += 1
    if msg:
        ss.flash = msg
    st.rerun()


def heading(title, sub=None):
    st.markdown(f'<div class="ivf-h">{title}</div>' + (f'<div class="ivf-sub">{sub}</div>' if sub else ""),
                unsafe_allow_html=True)


bar()
# 説明は予定がまだないとき（最初）だけ出す
if len(ss.base) == 0:
    st.markdown(
        '<div class="ivf-intro">通院・採卵・移植の予定を作って、カレンダーで見るためのアプリです。'
        "まず「作り直す」で1周期目の生理開始日と採卵日を入れて、予定を作ってください。"
        "日付はクリニックの指示に合わせて直せます。</div>",
        unsafe_allow_html=True,
    )
if not USE_DB:
    st.caption("お試しモード（保存先が未設定）：閉じると編集内容は消えます。")
if ss.get("flash"):
    st.toast(ss.pop("flash"), icon=":material/check_circle:")
save_status = st.empty()

tab_cal, tab_edit, tab_new, tab_out = st.tabs(["カレンダー", "予定を直す", "作り直す", "保存・共有"])

# ---------- 予定を直す（カレンダーより先に計算して、編集をすぐ反映させる） ----------
with tab_edit:
    quick = st.container()
    with st.container(border=True):
        heading("すべての予定（表で編集）", "セルをタップして日付・種類・メモを直せます。下の空行で追加、行を選んでゴミ箱で削除できます。")
        edited = st.data_editor(
            ss.base,
            key=f"editor_{ss.ver}",
            num_rows="dynamic",
            hide_index=True,
            width="stretch",
            column_config={
                "日付": st.column_config.DateColumn("日付", format="YYYY/MM/DD", required=True),
                "種類": st.column_config.SelectboxColumn("種類", options=S.KIND_NAMES, required=True),
                "メモ": st.column_config.TextColumn("メモ（カレンダーに出る文字）", max_chars=20),
                "周期": st.column_config.NumberColumn("周期", min_value=0, max_value=20, step=1, help="何周期目の予定か"),
            },
        )
    ss.events = S.normalize(edited)
    ev = ss.events

    # 変更があれば Supabase に自動保存
    if USE_DB and not ev.equals(ss.get("saved")):
        try:
            store.save_events(ev)
        except Exception as e:  # noqa: BLE001
            save_status.error(f"保存できませんでした。通信状態を確認して、もう一度操作してください。（{e}）")
        else:
            ss.saved = ev
            st.toast("保存しました", icon=":material/cloud_done:")

    with quick:
        with st.container(border=True):
            heading("1日ずつ直す", "日付を選んで、予定を追加・置き換え・削除します。")
            c1, c2 = st.columns(2)
            q_date = c1.date_input("日付", value=TODAY if TODAY <= date(2027, 12, 31) else date(2026, 10, 21), key="q_date")
            q_kind = c2.selectbox("種類", S.KIND_NAMES, index=S.KIND_NAMES.index("受診・通院"), key="q_kind")
            c3, c4 = st.columns([3, 1])
            q_label = c3.text_input("メモ", placeholder="例：通院 9:00", max_chars=20, key="q_label")
            q_cycle = c4.number_input("周期", min_value=0, max_value=20, value=1, step=1, key="q_cycle")
            same_day = ev[ev["日付"] == q_date]
            if len(same_day):
                st.caption("この日の予定：" + "、".join((r["メモ"] or r["種類"]) for r in same_day.to_dict("records")))
            else:
                st.caption("この日の予定：なし")
            b1, b2, b3 = st.columns(3)
            if b1.button("追加", width="stretch", type="primary"):
                set_base(S.set_day(ev, q_date, q_kind, q_label.strip(), int(q_cycle), "add"), f"{S.wd(q_date)} に追加しました")
            if b2.button("置き換え", width="stretch", help="この日の予定を消して、入力した内容だけにします"):
                set_base(S.set_day(ev, q_date, q_kind, q_label.strip(), int(q_cycle), "replace"), f"{S.wd(q_date)} を置き換えました")
            if b3.button("この日を消す", width="stretch"):
                set_base(S.set_day(ev, q_date, q_kind, "", 0, "delete"), f"{S.wd(q_date)} の予定を消しました")

        with st.expander("予定をまとめて前後にずらす（例：採卵が1日遅れた）", icon=":material/swap_horiz:"):
            s1, s2 = st.columns(2)
            sh_from = s1.date_input("この日以降を", value=q_date, key="sh_from")
            sh_days = s2.number_input("何日ずらす（−で早める）", min_value=-30, max_value=30, value=1, step=1, key="sh_days")
            cycles = sorted(int(c) for c in ev["周期"].unique())
            sh_cyc = st.selectbox("対象", ["すべての周期"] + [f"{c}周期目だけ" for c in cycles if c], key="sh_cyc")
            if st.button("ずらす", key="sh_go", width="stretch"):
                cyc = None if sh_cyc == "すべての周期" else int(sh_cyc.replace("周期目だけ", ""))
                set_base(S.shift(ev, sh_from, int(sh_days), cyc), f"{S.wd(sh_from)} 以降を {int(sh_days)} 日ずらしました")

# ---------- カレンダー ----------
with tab_cal:
    if len(ev) == 0:
        st.info("まだ予定がありません。「作り直す」タブで予定を作ってください。", icon=":material/event_note:")
    else:
        st.markdown(S.next_html(ev, TODAY, 5), unsafe_allow_html=True)
        st.markdown(S.calendar_html(ev, TODAY), unsafe_allow_html=True)
        st.caption("黒い枠が今日です。同じ日に予定が重なったときは、採卵・移植などを優先した色になります。日付は目安です。")

# ---------- 作り直す ----------
with tab_new:
    p = ss.params
    with st.container(border=True):
        heading("条件から予定を自動で作る", "生理開始日と採卵日をもとに、通院・トリガー・培養・移植・判定の日を計算します。")
        c1, c2 = st.columns(2)
        first_d1 = c1.date_input("1周期目の生理開始日", value=p.first_d1)
        cycle_len = c2.number_input("生理周期（日）", 21, 45, p.cycle_len)
        c3, c4 = st.columns(2)
        n_cycles = c3.number_input("周期の数", 1, 6, p.n_cycles)
        rest = c4.number_input("周期の間に休む回数", 0, 3, p.rest_cycles, help="1にすると、1周期おきに治療する予定になります")
        with st.expander("細かい設定", icon=":material/tune:"):
            d1, d2 = st.columns(2)
            stim_day = d1.number_input("誘発開始（D何日目）", 2, 6, p.stim_day)
            egg_day = d2.number_input("採卵（D何日目の目安）", 10, 20, p.egg_day)
            d3, d4 = st.columns(2)
            transfer_after = d3.number_input("移植（採卵の何日後）", 2, 6, p.transfer_after)
            test_from = d4.number_input("判定（移植の何日後から）", 5, 14, p.test_from)
            check_before = st.number_input("最初の卵胞チェック（採卵の何日前）", 3, 8, p.check_before,
                                           help="6なら、採卵10/31に対して10/25か26の通院になります")
            include_alt = st.toggle("遅れた場合の予備日も入れる", value=p.include_alt)
    newp = S.Params(first_d1, int(cycle_len), int(n_cycles), int(rest), int(stim_day), int(egg_day),
                    int(transfer_after), int(test_from), int(test_from) + 2, bool(include_alt), int(check_before))

    with st.container(border=True):
        heading("周期ごとの日付", "クリニックで採卵日を言われたら、ここを直します。")
        cyc_key = f"cyc_{hash((newp.first_d1, newp.cycle_len, newp.n_cycles, newp.rest_cycles, newp.egg_day))}"
        cyc_df = st.data_editor(
            S.default_cycles(newp),
            key=cyc_key,
            hide_index=True,
            width="stretch",
            disabled=["周期"],
            column_config={
                "生理開始日": st.column_config.DateColumn("生理開始日", format="YYYY/MM/DD"),
                "採卵日": st.column_config.DateColumn("採卵日（予定）", format="YYYY/MM/DD"),
            },
        )
        preview = S.generate(cyc_df, newp)
        keys = preview[preview["種類"].isin(["採卵", "新鮮胚移植"])]
        st.caption("作られる予定：" + "／".join(f"{r['メモ']} {S.wd(r['日付'])}" for r in keys.to_dict("records")))
    st.caption("⚠️ 作り直すと、表で手直しした内容は置き換わります。必要なら先に「保存・共有」でCSVを保存してください。")
    if st.button("この条件で作り直す", type="primary", width="stretch"):
        ss.params = newp
        if USE_DB:
            try:
                store.save_params(newp)
            except Exception:  # 条件の保存に失敗しても予定は作る
                pass
        set_base(preview, "条件から予定を作り直しました")

# ---------- 保存・共有 ----------
with tab_out:
    with st.container(border=True):
        heading("iPhoneのカレンダーに入れる", "Safariでダウンロードすると「カレンダーに追加」が出ます。終日の予定として入ります。")
        skip = st.multiselect("入れない種類", S.KIND_NAMES, default=["自宅で薬", "培養", "予備日"])
        kinds = [k for k in S.KIND_NAMES if k not in skip]
        st.download_button(
            "カレンダー用ファイル（.ics）をダウンロード",
            data=S.to_ics(ev, kinds).encode("utf-8"),
            file_name="ivf_schedule.ics",
            mime="text/calendar",
            width="stretch",
            type="primary",
            icon=":material/event_available:",
        )

    with st.container(border=True):
        heading("LINEで送る文面", "右上のボタンでコピーできます。")
        st.code(S.line_text(ev), language=None)

    with st.container(border=True):
        if USE_DB:
            heading("バックアップ（CSV）", "予定は自動で保存されています。念のための控えや、別のアカウントに移すときに使います。")
        else:
            heading("バックアップ（CSV）", "お試しモードでは閉じると編集内容が消えます。続きから使うときは、CSVを保存して読み込んでください。")
        st.download_button("予定をCSVで保存", data=S.to_csv(ev), file_name="ivf_schedule.csv", mime="text/csv",
                           width="stretch", icon=":material/download:")
        up = st.file_uploader("保存したCSVを読み込む", type=["csv"])
        if up is not None and st.button("この内容に置き換える"):
            try:
                loaded = S.from_csv(up)
            except Exception as e:  # noqa: BLE001
                loaded = None
                st.error(f"読み込めませんでした。このアプリで保存したCSVか確認してください。（{e}）")
            if loaded is not None:
                set_base(loaded, "CSVを読み込みました")

    if USE_DB:
        u = store.user() or {}
        st.caption(f"ログイン中：{u.get('email', '')}")
        if st.button("ログアウト", icon=":material/logout:"):
            store.sign_out()
            st.rerun()
