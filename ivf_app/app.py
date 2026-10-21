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
    .block-container{padding-top:1.6rem;padding-bottom:3rem}
    div[data-testid="stTabs"] button p{font-size:15px}
    .ivf-next{background:#F4F8FD;border:1px solid #D6E5F6;border-radius:10px;padding:10px 14px;margin:6px 0 4px;font-size:14px;line-height:1.75;color:#1f2b3a}
    .ivf-next b{color:#378ADD}
    </style>""",
    unsafe_allow_html=True,
)

ss = st.session_state

# ---------- ログイン ----------
if USE_DB and not store.user():
    st.title("体外受精スケジュール")
    st.caption("予定を見るには、ログインしてください。")
    with st.form("login"):
        email = st.text_input("メールアドレス", autocomplete="email")
        pw = st.text_input("パスワード", type="password", autocomplete="current-password")
        ok = st.form_submit_button("ログイン", type="primary", use_container_width=True)
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
        if len(loaded) == 0:
            ss.flash = "まだ予定がありません。「作り直す」で1周期目の生理開始日と採卵日を入れて、予定を作ってください。"
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


st.title("体外受精スケジュール")
st.caption("通院・採卵・移植の予定を作って、カレンダーで見るためのアプリです。日付はクリニックの指示に合わせて直してください。")
if not USE_DB:
    st.info("お試しモードです（保存先が未設定）。閉じると編集内容は消えます。")
if ss.get("flash"):
    st.success(ss.pop("flash"))
save_status = st.empty()

tab_cal, tab_edit, tab_new, tab_out = st.tabs(["カレンダー", "予定を直す", "作り直す", "書き出し・保存"])

# ---------- 予定を直す（カレンダーより先に計算して、編集をすぐ反映させる） ----------
with tab_edit:
    quick = st.container()
    st.markdown("##### すべての予定（表で直接編集）")
    st.caption("セルをタップして日付・種類・メモを直せます。下の空行で追加、行を選んでゴミ箱で削除できます。")
    edited = st.data_editor(
        ss.base,
        key=f"editor_{ss.ver}",
        num_rows="dynamic",
        hide_index=True,
        use_container_width=True,
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
            save_status.caption("✓ 保存しました")

    with quick:
        st.markdown("##### 1日ずつ直す")
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
        if b1.button("追加", use_container_width=True, type="primary"):
            set_base(S.set_day(ev, q_date, q_kind, q_label.strip(), int(q_cycle), "add"), f"{S.wd(q_date)} に追加しました")
        if b2.button("置き換え", use_container_width=True, help="この日の予定を消して、入力した内容だけにします"):
            set_base(S.set_day(ev, q_date, q_kind, q_label.strip(), int(q_cycle), "replace"), f"{S.wd(q_date)} を置き換えました")
        if b3.button("この日を消す", use_container_width=True):
            set_base(S.set_day(ev, q_date, q_kind, "", 0, "delete"), f"{S.wd(q_date)} の予定を消しました")

        with st.expander("予定をまとめて前後にずらす（例：採卵が1日遅れた）"):
            s1, s2 = st.columns(2)
            sh_from = s1.date_input("この日以降を", value=q_date, key="sh_from")
            sh_days = s2.number_input("何日ずらす（−で早める）", min_value=-30, max_value=30, value=1, step=1, key="sh_days")
            cycles = sorted(int(c) for c in ev["周期"].unique())
            sh_cyc = st.selectbox("対象", ["すべての周期"] + [f"{c}周期目だけ" for c in cycles if c], key="sh_cyc")
            if st.button("ずらす", key="sh_go"):
                cyc = None if sh_cyc == "すべての周期" else int(sh_cyc.replace("周期目だけ", ""))
                set_base(S.shift(ev, sh_from, int(sh_days), cyc), f"{S.wd(sh_from)} 以降を {int(sh_days)} 日ずらしました")
        st.divider()

# ---------- カレンダー ----------
with tab_cal:
    nxt = S.upcoming(ev, TODAY, 5)
    if nxt:
        st.markdown(
            '<div class="ivf-next"><b>次の予定</b><br>' + "<br>".join(nxt) + "</div>",
            unsafe_allow_html=True,
        )
    st.markdown(S.calendar_html(ev, TODAY), unsafe_allow_html=True)
    st.caption("黒い枠が今日です。同じ日に予定が重なったときは、採卵・移植などを優先した色になります。")

# ---------- 作り直す ----------
with tab_new:
    st.markdown("##### 条件から予定を自動で作る")
    st.caption("周期ごとの生理開始日と採卵日をもとに、通院・トリガー・培養・移植・判定の日を計算します。")
    p = ss.params
    c1, c2 = st.columns(2)
    first_d1 = c1.date_input("1周期目の生理開始日", value=p.first_d1)
    cycle_len = c2.number_input("生理周期（日）", 21, 45, p.cycle_len)
    c3, c4 = st.columns(2)
    n_cycles = c3.number_input("周期の数", 1, 6, p.n_cycles)
    rest = c4.number_input("周期の間に休む回数", 0, 3, p.rest_cycles, help="1にすると、1周期おきに治療する予定になります")
    with st.expander("細かい設定"):
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

    st.markdown("**周期ごとの日付**（クリニックで採卵日を言われたら、ここを直します）")
    cyc_key = f"cyc_{hash((newp.first_d1, newp.cycle_len, newp.n_cycles, newp.rest_cycles, newp.egg_day))}"
    cyc_df = st.data_editor(
        S.default_cycles(newp),
        key=cyc_key,
        hide_index=True,
        use_container_width=True,
        disabled=["周期"],
        column_config={
            "生理開始日": st.column_config.DateColumn("生理開始日", format="YYYY/MM/DD"),
            "採卵日": st.column_config.DateColumn("採卵日（予定）", format="YYYY/MM/DD"),
        },
    )
    preview = S.generate(cyc_df, newp)
    keys = preview[preview["種類"].isin(["採卵", "新鮮胚移植"])]
    st.caption("作られる予定：" + "／".join(f"{r['メモ']} {S.wd(r['日付'])}" for r in keys.to_dict("records")))
    st.warning("作り直すと、表で手直しした内容は置き換わります。必要なら先に「書き出し・保存」でCSVを保存してください。")
    if st.button("この条件で作り直す", type="primary"):
        ss.params = newp
        if USE_DB:
            try:
                store.save_params(newp)
            except Exception:  # 条件の保存に失敗しても予定は作る
                pass
        set_base(preview, "条件から予定を作り直しました")

# ---------- 書き出し・保存 ----------
with tab_out:
    st.markdown("##### iPhoneのカレンダーに入れる")
    skip = st.multiselect("入れない種類", S.KIND_NAMES, default=["自宅で薬", "培養", "予備日"])
    kinds = [k for k in S.KIND_NAMES if k not in skip]
    st.download_button(
        "カレンダー用ファイル（.ics）をダウンロード",
        data=S.to_ics(ev, kinds).encode("utf-8"),
        file_name="ivf_schedule.ics",
        mime="text/calendar",
        use_container_width=True,
        type="primary",
    )
    st.caption("Safariでダウンロードすると「カレンダーに追加」が出ます。終日の予定として入ります。")

    st.markdown("##### LINEで送る文面")
    st.code(S.line_text(ev), language=None)
    st.caption("右上のボタンでコピーできます。")

    st.markdown("##### バックアップ（CSV）")
    if USE_DB:
        st.caption("予定は自動で保存されています。念のための控えや、別のアカウントに移すときに使います。")
    else:
        st.caption("お試しモードでは閉じると編集内容が消えます。続きから使うときは、CSVを保存して読み込んでください。")
    st.download_button("予定をCSVで保存", data=S.to_csv(ev), file_name="ivf_schedule.csv", mime="text/csv",
                       use_container_width=True)
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
        st.divider()
        u = store.user() or {}
        st.caption(f"ログイン中：{u.get('email', '')}")
        if st.button("ログアウト"):
            store.sign_out()
            st.rerun()
