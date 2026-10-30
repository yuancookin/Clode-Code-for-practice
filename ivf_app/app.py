"""体外受精スケジュール（通院予測カレンダー）  —  streamlit run app.py"""
import calendar
import json
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote, unquote

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
    /* ログイン後は1行の小さな見出しにして、カレンダーを広く見せる */
    .ivf-bar.compact{display:flex;justify-content:space-between;align-items:flex-end;margin:0 0 8px;padding-bottom:6px}
    .ivf-bar.compact .logo{font-size:30px;line-height:1}
    .ivf-bar.compact .ja{font-size:9px;letter-spacing:.3em;margin-top:3px}
    .ivf-bar.compact .today{font-size:9px}
    .ivf-bar.compact .today b{font-size:19px}
    .ivf-intro{font-size:13px;color:var(--mute);line-height:1.9;margin:-6px 0 16px;font-weight:400}
    /* 月の切り替えボタン */
    .st-key-calnav{gap:6px!important;margin-top:4px}
    .st-key-calnav button{min-height:32px;padding:0 12px;border-radius:999px;background:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.8);color:var(--ink)}
    .st-key-calnav button p{font-size:12.5px;letter-spacing:.06em}
    .st-key-calnav button:disabled{opacity:.45;background:transparent}
    /* 押せるカレンダー（1日＝1ボタン） */
    .st-key-calcard{background:rgba(255,255,255,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.7);border-radius:18px;padding:12px 8px 10px;gap:4px!important;margin:8px 0}
    .st-key-calcard .ivf-grid{margin-bottom:16px}
    .st-key-calcard [class*="st-key-wk"]{gap:4px!important;flex-wrap:nowrap!important}
    .st-key-calcard [class*="st-key-wk"]>div{flex:1 1 0!important;min-width:0!important;width:auto!important}
    .st-key-calcard [class*="st-key-wk"] button{width:100%;min-height:48px;height:48px;padding:4px 1px;border-radius:10px;border:none;background:rgba(255,255,255,.6);color:#7D8E9C;align-items:flex-start;box-shadow:none}
    .st-key-calcard [class*="st-key-wk"] button:hover{filter:brightness(.97)}
    .st-key-calcard [class*="st-key-wk"] button p{font-size:9px;line-height:1.2;word-break:break-all;text-align:center;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin:0}
    .st-key-calcard [class*="st-key-wk"] button strong{display:block;font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:400;line-height:1.05;font-variant-numeric:lining-nums}
    @media (min-width:700px){.st-key-calcard [class*="st-key-wk"] button{min-height:64px;height:64px}.st-key-calcard [class*="st-key-wk"] button p{font-size:11px}}
    /* タブ：細い下線だけ */
    div[data-testid="stTabs"] [data-baseweb="tab-list"]{gap:0;background:transparent;border-bottom:1px solid var(--line)}
    div[data-testid="stTabs"] [data-baseweb="tab"]{flex:1 1 0;justify-content:center;height:40px;padding:0 2px;background:transparent}
    div[data-testid="stTabs"] [data-baseweb="tab"] p{font-size:12.5px;font-weight:500;color:var(--mute);letter-spacing:.08em;white-space:nowrap}
    div[data-testid="stTabs"] [aria-selected="true"] p{color:var(--ink);font-weight:700}
    div[data-testid="stTabs"] [data-baseweb="tab-highlight"]{display:none}
    div[data-testid="stTabs"] [aria-selected="true"]{box-shadow:inset 0 -2px 0 var(--accent)}
    div[data-testid="stTabs"] [data-baseweb="tab-border"]{display:none}
    /* カード：すりガラス */
    div[data-testid="stVerticalBlockBorderWrapper"]{background:var(--paper);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-color:rgba(255,255,255,.7)!important}
    .ivf-h{font-size:15px;font-weight:700;color:var(--ink);margin:2px 0 2px;letter-spacing:.04em}
    .ivf-sub{font-size:12px;color:var(--mute);margin:0 0 8px;line-height:1.7}
    div[data-testid="stCaptionContainer"],div[data-testid="stCaptionContainer"] p{color:var(--mute)!important}
    /* 次の予定 */
    .ivf-hero{margin:10px 0 2px;padding:0 0 8px}
    .ivf-hero .lbl{font-size:10px;letter-spacing:.32em;color:var(--mute);font-weight:500}
    .ivf-hero .row{display:flex;align-items:flex-end;gap:16px;margin-top:2px}
    .ivf-hero .big{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:52px;line-height:.9;color:var(--ink);letter-spacing:-.01em}
    .ivf-hero .big small{font-size:15px;letter-spacing:.2em;margin-left:6px;color:var(--mute);font-weight:400}
    .ivf-hero .side{padding-bottom:6px}
    .ivf-hero .badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;border-radius:999px;padding:2px 10px;color:#fff;background:var(--accent)}
    .ivf-hero .ttl{font-size:20px;font-weight:700;color:var(--ink);margin-top:4px;letter-spacing:.04em}
    .ivf-hero .until{font-size:12px;color:var(--mute)}
    .ivf-hero ul{list-style:none;margin:8px 0 0;padding:0}
    .ivf-hero li{display:flex;align-items:center;gap:10px;font-size:13px;line-height:1.95;color:var(--ink);margin:0;border-top:1px solid rgba(30,42,51,.07)}
    .ivf-hero li i{width:7px;height:7px;border-radius:50%;flex:none}
    .ivf-hero li .d{color:var(--mute);min-width:9em;font-variant-numeric:tabular-nums;font-size:12.5px}
    .ivf-hero li .t{font-weight:500}
    </style>""",
    unsafe_allow_html=True,
)

ss = st.session_state


def bar(compact=True):
    today = f'<div class="today">TODAY<b>{TODAY.month}.{TODAY.day:02d} {S.EN_WD[TODAY.weekday()]}</b></div>'
    if compact:
        st.markdown(
            '<div class="ivf-bar compact"><div><div class="logo">IVF <em>schedule</em></div>'
            f'<div class="ja">体外受精スケジュール</div></div>{today}</div>',
            unsafe_allow_html=True,
        )
    else:  # ログイン画面は表紙のように大きく
        st.markdown(
            '<div class="ivf-bar"><div class="logo">IVF <em>schedule</em></div>'
            f'<div class="meta"><div class="ja">体外受精スケジュール</div>{today}</div></div>',
            unsafe_allow_html=True,
        )


def heading(title, sub=None):
    st.markdown(f'<div class="ivf-h">{title}</div>' + (f'<div class="ivf-sub">{sub}</div>' if sub else ""),
                unsafe_allow_html=True)


# ---------- ログインの保持（リフレッシュトークンを Cookie に入れておく） ----------
COOKIE = "ivf_rt"
KEEP_DAYS = 30


def write_cookie(value, max_age):
    host = st.context.headers.get("host", "")
    secure = "" if host.startswith(("localhost", "127.0.0.1")) else "; Secure"
    c = f"{COOKIE}={quote(value)}; Max-Age={max_age}; Path=/; SameSite=Lax{secure}"
    st.html(f"<script>document.cookie = {json.dumps(c)};</script>", unsafe_allow_javascript=True)


def sync_cookie():
    """「ログインしたままにする」なら、最新のトークンを Cookie に入れ直す（トークンは更新のたびに変わる）。"""
    if not (USE_DB and ss.get("remember") and store.user()):
        return
    rt = store.refresh_token()
    if rt and rt != ss.get("rt_saved"):
        write_cookie(rt, KEEP_DAYS * 86400)
        ss.rt_saved = rt


if USE_DB and not store.user() and not ss.get("restore_tried"):
    ss.restore_tried = True
    rt = st.context.cookies.get(COOKIE)
    if rt:
        if store.restore(unquote(rt)):
            ss.remember = True
        else:
            ss.clear_cookie = True

# ---------- ログイン ----------
if USE_DB and not store.user():
    if ss.pop("clear_cookie", False):
        write_cookie("", 0)
    bar(compact=False)
    st.caption("予定を見るには、ログインしてください。")
    with st.form("login"):
        email = st.text_input("メールアドレス", autocomplete="email")
        pw = st.text_input("パスワード", type="password", autocomplete="current-password")
        keep = st.checkbox(f"ログインしたままにする（{KEEP_DAYS}日間）", value=True,
                           help="この端末では、次から開いたときにログインしなくてすみます。共用の端末ではオフにしてください。")
        ok = st.form_submit_button("ログイン", type="primary", width="stretch")
    if ok:
        try:
            store.sign_in(email.strip(), pw)
        except Exception:
            st.error("ログインできませんでした。メールアドレスとパスワードを確認してください。")
        else:
            ss.remember = keep
            st.rerun()
    st.stop()

sync_cookie()


def logout_button(key="logout"):
    if st.button("ログアウト", icon=":material/logout:", key=key):
        store.sign_out()
        ss.restore_tried = True
        ss.clear_cookie = True
        st.rerun()


# ---------- 共有スペース（パートナーと同じ予定を見る） ----------
if USE_DB and "group" not in ss:
    try:
        ss.group = store.group_info()
    except Exception as e:  # noqa: BLE001
        st.error(f"共有の設定を読み込めませんでした。schema.sql を最新にしたか確認してください。（{e}）")
        st.stop()

if USE_DB and not ss.group:
    bar()
    with st.container(border=True):
        heading("パートナーと予定を共有する",
                "はじめに1回だけ設定します。片方が「新しく始める」で暗証番号を決め、"
                "もう片方が「パートナーに参加する」で相手のメールアドレスと暗証番号を入れると、"
                "2人で同じ予定を見て、どちらからでも直せるようになります。")
        how = st.segmented_control("どちらにしますか", ["新しく始める", "パートナーに参加する"],
                                   default="新しく始める", key="g_how") or "新しく始める"
        if how == "新しく始める":
            pin = st.text_input("暗証番号を決める（数字4〜12桁）", type="password", max_chars=12, key="g_pin")
            pin2 = st.text_input("もう一度入力", type="password", max_chars=12, key="g_pin2")
            st.caption("パートナーが参加するときに、あなたのメールアドレスと一緒に入力します。"
                       "今までに作った予定は、この共有スペースに引き継がれます。")
            if st.button("共有スペースを作る", type="primary", width="stretch"):
                if not (pin.isdigit() and 4 <= len(pin) <= 12):
                    st.error("暗証番号は数字4〜12桁にしてください。")
                elif pin != pin2:
                    st.error("2回入力した暗証番号が違います。")
                else:
                    try:
                        store.create_group(pin)
                    except Exception as e:  # noqa: BLE001
                        st.error(f"作れませんでした。（{e}）")
                    else:
                        ss.pop("group", None)
                        ss.flash = "共有スペースを作りました"
                        st.rerun()
        else:
            owner = st.text_input("パートナーのメールアドレス", key="g_owner")
            pin = st.text_input("パートナーが決めた暗証番号", type="password", max_chars=12, key="g_jpin")
            if st.button("参加する", type="primary", width="stretch"):
                try:
                    joined = store.join_group(owner.strip(), pin)
                except Exception as e:  # noqa: BLE001
                    if "too many attempts" in str(e):
                        st.error("まちがいが続いたので、1時間ほどたってからもう一度試してください。")
                    else:
                        st.error(f"参加できませんでした。（{e}）")
                else:
                    if joined:
                        ss.pop("group", None)
                        ss.flash = "パートナーの共有スペースに参加しました"
                        st.rerun()
                    st.error("メールアドレスか暗証番号が違います。")
    logout_button("logout_setup")
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
        ss.version = ss.group["version"]
    else:
        ss.params = S.Params()
        ss.base = S.generate(S.default_cycles(ss.params), ss.params)
if "events" not in ss:
    ss.events = ss.base


def reload(msg):
    """共有スペースの最新の予定を読み込み直す（パートナーの変更を反映する）。"""
    loaded = store.load_events()
    ss.group = store.group_info()
    ss.version = ss.group["version"]
    ss.saved = loaded
    set_base(loaded, msg)


def set_base(df, msg=None):
    ss.base = S.normalize(df)
    ss.events = ss.base
    ss.ver += 1
    if msg:
        ss.flash = msg
    st.rerun()


def _md(s):
    # ボタンの文字は Markdown として解釈されるので、記号を無効にする
    for ch in "\\*_`[]#~|<>":
        s = s.replace(ch, "\\" + ch)
    return s


def month_grid(ev, ym):
    """1か月分のカレンダー。日付のマスを押すと、その日の編集画面を開く。"""
    y, m = ym
    days = S.by_day(ev)
    lead = (date(y, m, 1).weekday() + 1) % 7
    cells = [None] * lead + [date(y, m, d) for d in range(1, calendar.monthrange(y, m)[1] + 1)]
    cells += [None] * ((7 - len(cells) % 7) % 7)
    css = []
    with st.container(key="calcard"):
        wds = "".join(
            f'<div class="ivf-wd{" sun" if i == 0 else (" sat" if i == 6 else "")}">{w}</div>'
            for i, w in enumerate(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"])
        )
        st.markdown(
            S.CAL_CSS + f'<div class="ivf-month"><span class="en">{S.EN_MONTH[m - 1]}</span>'
            f'<small>{y}年{m}月</small></div><div class="ivf-grid">{wds}</div>',
            unsafe_allow_html=True,
        )
        for wi in range(0, len(cells), 7):
            with st.container(horizontal=True, key=f"wk{wi // 7}"):
                for j, dd in enumerate(cells[wi:wi + 7]):
                    if dd is None:
                        st.markdown('<div class="ivf-pad"></div>', unsafe_allow_html=True)  # 空のマス
                        continue
                    labels = []
                    for e in days.get(dd, []):
                        lab = e["メモ"] or e["種類"]
                        if lab not in labels:
                            labels.append(lab)
                    k = f"cd{dd:%Y%m%d}"
                    st.button(f"**{dd.day}**" + (" " + _md("／".join(labels)) if labels else ""),
                              key=k, on_click=open_day, args=(dd,))
                    sel = f".st-key-calcard .st-key-{k} button"
                    if days.get(dd):
                        bg, fg = S.KINDS[days[dd][0]["種類"]]
                        css.append(f"{sel}{{background:{bg};color:{fg}}}")
                    if dd == TODAY:
                        css.append(f"{sel}{{box-shadow:0 0 0 2px #fff,0 0 0 3.5px #1E2A33}}")
                    elif dd < TODAY:
                        css.append(f"{sel}{{opacity:.45}}")
    st.markdown("<style>" + "".join(css) + "</style>", unsafe_allow_html=True)


def open_day(d):
    ss.day_open = d


def close_day():
    ss.pop("day_open", None)


# 開いている間は毎回呼び出す（×や枠の外で閉じたら close_day が呼ばれる）
@st.dialog("この日の予定", on_dismiss=close_day)
def edit_day(d):
    ev = ss.events
    cur = ev[ev["日付"] == d].to_dict("records")
    st.markdown(f'<div class="ivf-h">{S.wd(d)}</div>', unsafe_allow_html=True)
    items = []
    if cur:
        for i, r in enumerate(cur):
            with st.container(border=True):
                c1, c2 = st.columns([1, 1])
                kind = c1.selectbox("種類", S.KIND_NAMES, index=S.KIND_NAMES.index(r["種類"]), key=f"dk{d:%m%d}_{i}")
                cyc = c2.number_input("周期", 0, 20, int(r["周期"]), key=f"dc{d:%m%d}_{i}")
                memo = st.text_input("メモ（カレンダーに出る文字）", r["メモ"], max_chars=20, key=f"dm{d:%m%d}_{i}")
                drop = st.checkbox("この予定を消す", key=f"dx{d:%m%d}_{i}")
            if not drop:
                items.append({"種類": kind, "メモ": memo.strip(), "周期": int(cyc)})
    else:
        st.caption("この日の予定はまだありません。")

    with st.expander("予定・メモを追加", expanded=not cur, icon=":material/add:"):
        c1, c2 = st.columns([1, 1])
        nk = c1.selectbox("種類", ["（追加しない）"] + S.KIND_NAMES,
                          index=1 + S.KIND_NAMES.index("メモ") if not cur else 0, key="nk")
        nc = c2.number_input("周期", 0, 20, S.cycle_near(ev, d), key="nc")
        nm = st.text_input("メモ", placeholder="例：通院 9:00、採血あり", max_chars=20, key="nm")
    if nk != "（追加しない）":
        items.append({"種類": nk, "メモ": nm.strip(), "周期": int(nc)})

    b1, b2 = st.columns(2)
    if b1.button("保存", type="primary", width="stretch"):
        close_day()
        set_base(S.put_day(ev, d, items), f"{S.wd(d)} の予定を保存しました")
    if b2.button("閉じる", width="stretch"):
        close_day()
        st.rerun()


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
            ss.version = store.save_events(ev, ss.version)
        except store.Conflict:
            # パートナーが先に保存していたら、上書きせずに最新を読み込む
            reload("パートナーが予定を更新していたので、最新の予定を読み込みました。もう一度直してください。")
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
        st.markdown(S.next_html(ev, TODAY, 3), unsafe_allow_html=True)

        # 1か月ずつ表示。最初は今月（予定の期間外なら最初の月）
        lo, hi = S.month_range(ev)
        this_month = (TODAY.year, TODAY.month)
        home = this_month if lo <= this_month <= hi else lo
        if "cal_ym" not in ss or not (lo <= ss.cal_ym <= hi):
            ss.cal_ym = home

        def go(n):
            ss.cal_ym = S.add_month(ss.cal_ym, n) if n else home

        with st.container(horizontal=True, horizontal_alignment="distribute", key="calnav"):
            st.button("‹ 前の月", on_click=go, args=(-1,), disabled=ss.cal_ym <= lo)
            st.button("今月", on_click=go, args=(0,), disabled=ss.cal_ym == home)
            st.button("次の月 ›", on_click=go, args=(1,), disabled=ss.cal_ym >= hi)
        month_grid(ev, ss.cal_ym)
        if ss.get("day_open"):
            edit_day(ss.day_open)
        st.markdown(S.legend_html(set(ev["種類"])), unsafe_allow_html=True)
        st.caption("日付のマスを押すと、その日の予定を直したりメモを足したりできます。黒い枠が今日です。同じ日に予定が重なったときは、採卵・移植などを優先した色になります。日付は目安です。")

# ---------- 作り直す ----------
def detail_inputs(p):
    """誘発・採卵・移植・判定の日数などの細かい設定。"""
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
    return dict(stim_day=int(stim_day), egg_day=int(egg_day), transfer_after=int(transfer_after),
                test_from=int(test_from), test_to=int(test_from) + 2, include_alt=bool(include_alt),
                check_before=int(check_before))


def save_params(newp):
    ss.params = newp
    if USE_DB:
        try:
            store.save_params(newp)
        except Exception:  # 条件の保存に失敗しても予定は作る
            pass


def key_dates(df):
    keys = df[df["種類"].isin(["採卵", "新鮮胚移植", "妊娠判定"])]
    return "／".join(f"{a.month}/{a.day}" + (f"〜{b.month}/{b.day}" if a != b else "") + f" {lab or kind}"
                    for a, b, kind, lab, _ in S._runs(keys, S.KIND_NAMES))


with tab_new:
    p = ss.params
    cycles = sorted(int(c) for c in ev["周期"].unique() if c > 0)
    mode = st.segmented_control("作り直す範囲", ["1周期だけ", "全部まとめて"], key="regen_mode",
                                default="1周期だけ" if cycles else "全部まとめて")
    mode = mode or ("1周期だけ" if cycles else "全部まとめて")

    if mode == "1周期だけ":
        with st.container(border=True):
            heading("1周期だけ作り直す",
                    "生理が来た日や採卵日が決まったら、その周期（生理〜妊娠判定）だけを計算し直します。"
                    "ほかの周期と、自分で足したメモはそのまま残ります。")
            opts = cycles + [max(cycles, default=0) + 1]
            started = [c for c in cycles if (S.cycle_d1(ev, c) or date.max) <= TODAY]
            n = st.selectbox("周期", opts, index=opts.index(started[-1]) if started else 0,
                             format_func=lambda c: f"{c}周期目" + ("" if c in cycles else "（新しく追加）"))
            prev_d1 = S.cycle_d1(ev, n - 1)
            d1_default = S.cycle_d1(ev, n) or (prev_d1 + timedelta(days=p.cycle_len) if prev_d1 else TODAY)
            d1 = st.date_input("生理開始日（D1）", value=d1_default, key=f"rc_d1_{n}")
            egg_fixed = st.toggle("採卵日が決まっている", value=False, key=f"rc_fix_{n}")
            egg = None
            if egg_fixed:
                egg = st.date_input("採卵日", value=S.cycle_egg(ev, n) or d1 + timedelta(days=p.egg_day - 1),
                                    key=f"rc_egg_{n}")
            later = [c for c in cycles if c > n]
            shift_later = False
            if later and n in cycles:
                shift_later = st.checkbox(f"後ろの周期（{later[0]}周期目〜）も、生理開始日が動いた日数だけずらす",
                                          value=True, key=f"rc_shift_{n}")
            det = detail_inputs(p)
        newp = S.Params(p.first_d1, p.cycle_len, p.n_cycles, p.rest_cycles, **det)
        one = S.generate(pd.DataFrame([{"周期": n, "生理開始日": d1, "採卵日": egg}]), newp)
        st.caption("作られる予定：" + key_dates(one))
        if st.button(f"{n}周期目を作り直す", type="primary", width="stretch"):
            save_params(newp)
            set_base(S.regen_cycle(ev, n, d1, egg, newp, shift_later), f"{n}周期目を作り直しました")
    else:
        with st.container(border=True):
            heading("全部まとめて作る", "1周期目の生理開始日と周期の日数から、すべての周期の予定を計算します。")
            c1, c2 = st.columns(2)
            first_d1 = c1.date_input("1周期目の生理開始日", value=p.first_d1)
            cycle_len = c2.number_input("生理周期（日）", 21, 45, p.cycle_len)
            c3, c4 = st.columns(2)
            n_cycles = c3.number_input("周期の数", 1, 6, p.n_cycles)
            rest = c4.number_input("周期の間に休む回数", 0, 3, p.rest_cycles, help="1にすると、1周期おきに治療する予定になります")
            det = detail_inputs(p)
        newp = S.Params(first_d1, int(cycle_len), int(n_cycles), int(rest), **det)

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
        st.caption("⚠️ すべての予定が置き換わります（手直しやメモも消えます）。必要なら先に「保存・共有」でCSVを保存してください。")
        if st.button("この条件で作り直す", type="primary", width="stretch"):
            save_params(newp)
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
        with st.container(border=True):
            g = ss.group or {}
            members = g.get("members") or []
            heading("パートナーと共有",
                    "同じ共有スペースのメンバーは、同じ予定を見て、どちらからでも直せます。"
                    "相手が直した内容は、開き直すか下のボタンで読み込まれます。")
            st.markdown("<br>".join(f"・{m}" + ("（作った人）" if m == g.get("owner_email") else "") for m in members),
                        unsafe_allow_html=True)
            if len(members) < 2:
                st.caption(f"パートナーは、自分のアカウントでログインしたあと「パートナーに参加する」を選び、"
                           f"{g.get('owner_email', '')} と暗証番号を入力してください。")
            if st.button("最新の予定を読み込む", icon=":material/sync:", width="stretch"):
                reload("最新の予定を読み込みました")
        u = store.user() or {}
        st.caption(f"ログイン中：{u.get('email', '')}")
        logout_button()

sync_cookie()
