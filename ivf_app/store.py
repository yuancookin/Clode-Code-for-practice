"""Supabase への保存・読み込みと、合言葉での入室。

st.secrets に SUPABASE_URL と SUPABASE_KEY（anon / publishable key）があるときだけ使う。
ない場合はアプリは「保存なしのお試しモード」で動く。

予定は「共有スペース」（ivf_groups）ごとに保存する。端末ごとに匿名でサインインし、
同じ合言葉を入れた人が同じ共有スペースに入って、同じ予定を見たり直したりできる。
"""
from __future__ import annotations

import unicodedata

import pandas as pd
import streamlit as st

import schedule as S


class Conflict(Exception):
    """パートナーが先に保存していた（版番号が合わない）。"""


def configured() -> bool:
    try:
        return bool(st.secrets.get("SUPABASE_URL")) and bool(st.secrets.get("SUPABASE_KEY"))
    except Exception:  # secrets.toml がないとき
        return False


def _client():
    # ログイン状態は利用者ごとに違うので、キャッシュせずセッションごとに作る
    if "sb" not in st.session_state:
        from supabase import ClientOptions, create_client

        # 裏でのトークン自動更新は止める。更新されるとリフレッシュトークンが変わり、
        # Cookie に保存した古いトークンで次回ログインし直せなくなるため。
        # 更新は操作のたびに _fresh() で行い、app.py の sync_cookie() が Cookie を書き換える。
        st.session_state.sb = create_client(st.secrets["SUPABASE_URL"], st.secrets["SUPABASE_KEY"],
                                            options=ClientOptions(auto_refresh_token=False, flow_type="implicit"))
    return st.session_state.sb


def _set_user(u) -> None:
    st.session_state.sb_user = {"id": u.id}


def _sign_in_anonymously() -> None:
    """この端末用の匿名ユーザーを用意する（合言葉を送るときに初めて作る）。"""
    if user():
        return
    res = _client().auth.sign_in_anonymously()
    if res.user is None:
        raise RuntimeError("サインインできませんでした")
    _set_user(res.user)


def restore(refresh_token: str) -> bool:
    """保存しておいたリフレッシュトークンでログインし直す。"""
    try:
        res = _client().auth.refresh_session(refresh_token)
    except Exception:
        return False
    if res.user is None:
        return False
    _set_user(res.user)
    return True


def refresh_token() -> str | None:
    """今のセッションのリフレッシュトークン（更新されるたびに変わる）。"""
    try:
        s = _client().auth.get_session()
    except Exception:
        return None
    return s.refresh_token if s else None


def sign_out() -> None:
    try:
        _client().auth.sign_out()
    except Exception:
        pass
    for k in list(st.session_state.keys()):
        del st.session_state[k]


def user() -> dict | None:
    return st.session_state.get("sb_user")


def _fresh():
    # アクセストークンの期限が切れていたら更新する
    try:
        _client().auth.get_session()
    except Exception:
        pass


# ---------- 共有スペース ----------

def normalize_phrase(phrase: str) -> str:
    """全角・半角、大文字・小文字、空白の違いで入れなくならないようにそろえる。"""
    return "".join(unicodedata.normalize("NFKC", phrase).split()).casefold()


def group_info() -> dict | None:
    """{"group_id", "version", "has_phrase"}。まだ入っていなければ None。"""
    _fresh()
    return _client().rpc("ivf_group_info").execute().data


def create_space(phrase: str) -> bool:
    """合言葉を決めて共有スペースを作る。すでに使われている合言葉なら False。"""
    _sign_in_anonymously()
    _fresh()
    return bool(_client().rpc("create_ivf_space", {"p_phrase": normalize_phrase(phrase)}).execute().data)


def join_space(phrase: str) -> bool:
    """合言葉で共有スペースに入る。合わなければ False。"""
    _sign_in_anonymously()
    _fresh()
    return bool(_client().rpc("join_ivf_space", {"p_phrase": normalize_phrase(phrase)}).execute().data)


def set_phrase(phrase: str) -> bool:
    """今の共有スペースの合言葉を決める・変える。すでに使われている合言葉なら False。"""
    _fresh()
    return bool(_client().rpc("set_ivf_phrase", {"p_phrase": normalize_phrase(phrase)}).execute().data)


def join_old_group(owner_email: str, pin: str) -> bool:
    """以前の共有スペース（作った人のメールアドレス＋暗証番号）に入る。違えば False。"""
    _sign_in_anonymously()
    _fresh()
    return bool(_client().rpc("join_ivf_group", {"p_owner_email": owner_email, "p_pin": pin}).execute().data)


# ---------- 予定 ----------

def load_events() -> pd.DataFrame:
    _fresh()
    res = _client().table("ivf_events").select("date,kind,memo,cycle").order("date").execute()
    return S.rows_to_df(res.data)


def save_events(df: pd.DataFrame, version: int | None) -> int:
    """共有スペースの予定をまるごと置き換え、新しい版番号を返す。
    version が古ければ Conflict（パートナーが先に保存していた）。"""
    _fresh()
    try:
        res = _client().rpc("replace_ivf_events", {"p_rows": S.df_to_rows(df), "p_version": version}).execute()
    except Exception as e:  # noqa: BLE001
        if "version conflict" in str(e):
            raise Conflict() from e
        raise
    return int(res.data)


def load_params() -> dict | None:
    _fresh()
    return _client().rpc("ivf_load_params").execute().data


def save_params(p: S.Params) -> None:
    _fresh()
    _client().rpc("ivf_save_params", {"p_params": S.params_to_dict(p)}).execute()
