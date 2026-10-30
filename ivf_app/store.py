"""Supabase への保存・読み込みとログイン。

st.secrets に SUPABASE_URL と SUPABASE_KEY（anon / publishable key）があるときだけ使う。
ない場合はアプリは「保存なしのお試しモード」で動く。

予定は「共有スペース」（ivf_groups）ごとに保存する。パートナーは相手のメールアドレスと
暗証番号で同じ共有スペースに参加し、同じ予定を見たり直したりできる。
"""
from __future__ import annotations

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
        from supabase import create_client

        st.session_state.sb = create_client(st.secrets["SUPABASE_URL"], st.secrets["SUPABASE_KEY"])
    return st.session_state.sb


def _set_user(u) -> None:
    st.session_state.sb_user = {"id": u.id, "email": u.email}


def sign_in(email: str, password: str) -> None:
    res = _client().auth.sign_in_with_password({"email": email, "password": password})
    if res.user is None:
        raise RuntimeError("ログインできませんでした")
    _set_user(res.user)


def sign_up(email: str, password: str, redirect_to: str | None = None) -> bool:
    """新規登録。そのままログインできたら True、確認メールの確認待ちなら False。"""
    opts = {"email_redirect_to": redirect_to} if redirect_to else {}
    res = _client().auth.sign_up({"email": email, "password": password, "options": opts})
    if res.user is None:
        raise RuntimeError("登録できませんでした")
    # すでに登録済みのアドレスだと、確認待ちに見える空のユーザーが返る
    if not res.user.identities:
        raise RuntimeError("User already registered")
    if res.session is None:
        return False
    _set_user(res.user)
    return True


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

def group_info() -> dict | None:
    """{"group_id", "version", "owner_email", "members"}。まだ入っていなければ None。"""
    _fresh()
    return _client().rpc("ivf_group_info").execute().data


def create_group(pin: str) -> None:
    _fresh()
    _client().rpc("create_ivf_group", {"p_pin": pin}).execute()


def join_group(owner_email: str, pin: str) -> bool:
    """参加できたら True。メールアドレスか暗証番号が違えば False。"""
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
    res = _client().table("ivf_settings").select("params").limit(1).execute()
    return res.data[0]["params"] if res.data else None


def save_params(p: S.Params) -> None:
    _fresh()
    u = user()
    _client().table("ivf_settings").upsert({"user_id": u["id"], "params": S.params_to_dict(p)}).execute()
