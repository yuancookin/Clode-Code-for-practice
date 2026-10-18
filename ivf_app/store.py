"""Supabase への保存・読み込みとログイン。

st.secrets に SUPABASE_URL と SUPABASE_KEY（anon / publishable key）があるときだけ使う。
ない場合はアプリは「保存なしのお試しモード」で動く。
"""
from __future__ import annotations

import pandas as pd
import streamlit as st

import schedule as S


def configured() -> bool:
    try:
        return bool(st.secrets.get("SUPABASE_URL")) and bool(st.secrets.get("SUPABASE_KEY"))
    except Exception:  # secrets.toml がないとき
        return False


def _client():
    # ログイン状態は利用者ごとに違うので、キャッシュせずセッションごとに作る
    if "sb" not in st.session_state:
        from supabase import create_client

        st.session_state.sb = create_client(st.secrets["SUPABASE_URL"], st.secrets["SUPABASE_KEY"])
    return st.session_state.sb


def sign_in(email: str, password: str) -> None:
    res = _client().auth.sign_in_with_password({"email": email, "password": password})
    if res.user is None:
        raise RuntimeError("ログインできませんでした")
    st.session_state.sb_user = {"id": res.user.id, "email": res.user.email}


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


def load_events() -> pd.DataFrame:
    _fresh()
    res = _client().table("ivf_events").select("date,kind,memo,cycle").order("date").execute()
    return S.rows_to_df(res.data)


def save_events(df: pd.DataFrame) -> None:
    """自分の予定をまるごと置き換える（SQL関数の中で1回のトランザクション）。"""
    _fresh()
    _client().rpc("replace_ivf_events", {"p_rows": S.df_to_rows(df)}).execute()


def load_params() -> dict | None:
    _fresh()
    res = _client().table("ivf_settings").select("params").limit(1).execute()
    return res.data[0]["params"] if res.data else None


def save_params(p: S.Params) -> None:
    _fresh()
    u = user()
    _client().table("ivf_settings").upsert({"user_id": u["id"], "params": S.params_to_dict(p)}).execute()
