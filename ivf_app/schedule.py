"""体外受精スケジュールの計算・カレンダー描画・書き出し（Streamlitに依存しない部分）"""
from __future__ import annotations

import calendar as _cal
import html
import uuid
from dataclasses import asdict, dataclass, field, fields
from datetime import date, datetime, timedelta, timezone

import pandas as pd

WD = "月火水木金土日"
EN_WD = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
EN_MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
            "October", "November", "December"]

# 種類 → (背景色, 文字色)。並び順 = 同じ日に重なったときの優先度（上ほど優先）
KINDS: dict[str, tuple[str, str]] = {
    "採卵": ("#D85A30", "#FFFFFF"),
    "新鮮胚移植": ("#1D9E75", "#FFFFFF"),
    "妊娠判定": ("#D4537E", "#FFFFFF"),
    "生理開始": ("#378ADD", "#FFFFFF"),
    "トリガー": ("#FAC775", "#412402"),
    "受診・通院": ("#7FB2E8", "#042C53"),
    "予備日": ("#E6E3FA", "#3C3489"),
    "培養": ("#D3D1C7", "#2C2C2A"),
    "自宅で薬": ("#DCEBFA", "#042C53"),
    "メモ": ("#FFF3C4", "#5A4500"),
}
KIND_NAMES = list(KINDS)
LEGEND_ORDER = ["生理開始", "受診・通院", "自宅で薬", "トリガー", "採卵", "培養", "新鮮胚移植", "妊娠判定", "予備日", "メモ"]
COLS = ["日付", "種類", "メモ", "周期"]


def today_jst() -> date:
    return datetime.now(timezone(timedelta(hours=9))).date()


@dataclass
class Params:
    first_d1: date = field(default_factory=today_jst)
    cycle_len: int = 28
    n_cycles: int = 3
    rest_cycles: int = 0  # 周期の間に休む周期の数
    stim_day: int = 4  # 誘発開始は D何日目か
    egg_day: int = 14  # 採卵は D何日目か
    transfer_after: int = 5  # 採卵の何日後に移植
    test_from: int = 7  # 移植の何日後から判定
    test_to: int = 9
    include_alt: bool = True  # 遅れた場合の予備日を入れる
    check_before: int = 6  # 最初の卵胞チェック通院は採卵の何日前か（その翌日との「どちらか」）


def params_to_dict(p: Params) -> dict:
    d = asdict(p)
    d["first_d1"] = p.first_d1.isoformat()
    return d


def params_from_dict(d: dict | None) -> Params:
    p = Params()
    if not d:
        return p
    for f in fields(Params):
        if f.name not in d:
            continue
        v = d[f.name]
        try:
            if f.name == "first_d1":
                v = to_date(v) or p.first_d1
            elif f.name == "include_alt":
                v = bool(v)
            else:
                v = int(v)
        except (TypeError, ValueError):
            continue
        setattr(p, f.name, v)
    return p


def df_to_rows(df: pd.DataFrame) -> list[dict]:
    """Supabase の ivf_events に入れる形にする。"""
    return [
        {"date": d.isoformat(), "kind": k, "memo": m, "cycle": int(c)}
        for d, k, m, c in normalize(df)[COLS].itertuples(index=False)
    ]


def rows_to_df(rows: list[dict] | None) -> pd.DataFrame:
    recs = [{"日付": r.get("date"), "種類": r.get("kind"), "メモ": r.get("memo"), "周期": r.get("cycle")} for r in rows or []]
    return normalize(pd.DataFrame(recs, columns=COLS))


def wd(d: date) -> str:
    return f"{d.month}/{d.day}({WD[d.weekday()]})"


def default_cycles(p: Params) -> pd.DataFrame:
    rows = []
    step = p.cycle_len * (1 + p.rest_cycles)
    for i in range(p.n_cycles):
        d1 = p.first_d1 + timedelta(days=step * i)
        rows.append({"周期": i + 1, "生理開始日": d1, "採卵日": d1 + timedelta(days=p.egg_day - 1)})
    return pd.DataFrame(rows)


def generate(cycles: pd.DataFrame, p: Params) -> pd.DataFrame:
    """周期ごとの「生理開始日」「採卵日」から、その周期の予定を作る。"""
    ev: list[dict] = []

    def add(d, kind, label, n):
        ev.append({"日付": d, "種類": kind, "メモ": label, "周期": n})

    for _, r in cycles.iterrows():
        n = int(r["周期"])
        d1 = to_date(r["生理開始日"])
        if d1 is None:
            continue
        egg = to_date(r["採卵日"]) or d1 + timedelta(days=p.egg_day - 1)
        D = lambda k: egg + timedelta(days=k)  # 採卵日からの相対日

        add(d1, "生理開始", f"生理{n}", n)
        cb = max(3, p.check_before)
        v1 = D(-cb)  # 最初の卵胞チェック（v1 か翌日のどちらか）
        stim = d1 + timedelta(days=p.stim_day - 1)
        if stim < v1:
            add(stim, "受診・通院", "受診・誘発開始", n)
            d = stim + timedelta(days=1)
            while d < v1:
                add(d, "自宅で薬", "自宅で薬", n)
                d += timedelta(days=1)
        add(v1, "受診・通院", "通院(どちらか)", n)
        add(v1 + timedelta(days=1), "受診・通院", "通院(どちらか)", n)
        d = v1 + timedelta(days=2)
        while d < D(-2):
            add(d, "自宅で薬", "薬・通院は指示で", n)
            d += timedelta(days=1)
        add(D(-2), "トリガー", "トリガー夜(目安)", n)
        if p.include_alt:
            add(D(-1), "予備日", "予備通院", n)
        add(egg, "採卵", f"採卵{n}", n)
        for k in range(1, p.transfer_after):
            lab = "培養・採卵予備" if (p.include_alt and k <= 2) else "培養"
            add(D(k), "培養", lab, n)
        tr = D(p.transfer_after)
        add(tr, "新鮮胚移植", f"移植{n}", n)
        if p.include_alt:
            add(tr + timedelta(days=1), "予備日", "移植予備", n)
            add(tr + timedelta(days=2), "予備日", "移植予備", n)
        for k in range(p.test_from, p.test_to + 1):
            add(tr + timedelta(days=k), "妊娠判定", f"判定{n}", n)
    return normalize(pd.DataFrame(ev, columns=COLS))


def to_date(v) -> date | None:
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return pd.to_datetime(v).date()
    except Exception:
        return None


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """編集後の表を整える：空行を消す・型をそろえる・日付順に並べる。"""
    if df is None or len(df) == 0:
        return pd.DataFrame({c: pd.Series(dtype="object") for c in COLS})
    df = df.copy()
    for c in COLS:
        if c not in df.columns:
            df[c] = None
    df["日付"] = df["日付"].map(to_date)
    df = df[df["日付"].notna()]
    df["種類"] = df["種類"].where(df["種類"].isin(KIND_NAMES), "メモ")
    df["メモ"] = df["メモ"].fillna("").astype(str)
    df["周期"] = pd.to_numeric(df["周期"], errors="coerce").fillna(0).astype(int)
    prio = {k: i for i, k in enumerate(KIND_NAMES)}
    df["_p"] = df["種類"].map(prio)
    df = df.sort_values(["日付", "_p"]).drop(columns="_p").reset_index(drop=True)
    return df[COLS]


def shift(df: pd.DataFrame, start: date, days: int, cycle: int | None) -> pd.DataFrame:
    """start 以降の予定を days 日ずらす（cycle を指定するとその周期だけ）。"""
    df = df.copy()
    m = df["日付"].map(lambda d: d >= start)
    if cycle is not None:
        m &= df["周期"] == cycle
    df.loc[m, "日付"] = df.loc[m, "日付"].map(lambda d: d + timedelta(days=days))
    return normalize(df)


def set_day(df: pd.DataFrame, d: date, kind: str, label: str, cycle: int, mode: str) -> pd.DataFrame:
    """mode: add=この日に追加 / replace=この日の予定を置き換え / delete=この日の予定を消す"""
    df = df.copy()
    if mode in ("replace", "delete"):
        df = df[df["日付"] != d]
    if mode in ("add", "replace"):
        df = pd.concat([df, pd.DataFrame([{"日付": d, "種類": kind, "メモ": label, "周期": cycle}])], ignore_index=True)
    return normalize(df)


# ---------- 表示用 ----------

def by_day(df: pd.DataFrame) -> dict[date, list[dict]]:
    out: dict[date, list[dict]] = {}
    for r in df.to_dict("records"):
        out.setdefault(r["日付"], []).append(r)
    return out


CAL_CSS = """
<style>
.ivf-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:10px 0 4px}
.ivf-legend span{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#5E7183;letter-spacing:.04em}
.ivf-legend i{display:inline-block;width:7px;height:7px;border-radius:50%}
.ivf-cal{background:rgba(255,255,255,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.7);border-radius:18px;padding:14px 10px 10px;margin:12px 0}
.ivf-month{margin:0 4px 10px;display:flex;align-items:baseline;justify-content:space-between}
.ivf-month .en{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:30px;line-height:1;color:#1E2A33}
.ivf-month small{font-size:11px;letter-spacing:.24em;color:#5E7183}
.ivf-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.ivf-wd{font-size:10px;text-align:center;color:#5E7183;padding:0 0 3px;letter-spacing:.1em}
.ivf-wd.sun{color:#E04A2C}.ivf-wd.sat{color:#2F6DB5}
.ivf-c{min-height:54px;border-radius:10px;background:rgba(255,255,255,.6);padding:4px 2px;text-align:center;overflow:hidden}
.ivf-c.empty{background:transparent}
.ivf-c .n{font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:400;line-height:1.05}
.ivf-c .l{font-size:9px;line-height:1.2;margin-top:2px;word-break:break-all;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ivf-c.today{box-shadow:0 0 0 2px #fff,0 0 0 3.5px #1E2A33;position:relative;z-index:1}
.ivf-c.plain .n{color:#7D8E9C}
.ivf-c.past{opacity:.45}
@media (min-width:700px){.ivf-c{min-height:68px}.ivf-c .l{font-size:11px}.ivf-c .n{font-size:19px}}
</style>
"""


def legend_html(kinds=None) -> str:
    shown = [k for k in LEGEND_ORDER if kinds is None or k in kinds]
    items = "".join(f'<span><i style="background:{KINDS[k][0]}"></i>{k}</span>' for k in shown)
    return f'<div class="ivf-legend">{items}</div>'


def calendar_html(df: pd.DataFrame, today: date | None = None) -> str:
    if len(df) == 0:
        return "<p>予定がまだありません。</p>"
    days = by_day(df)
    first, last = min(days), max(days)
    y, m = first.year, first.month
    parts = [CAL_CSS, legend_html(set(df["種類"]))]
    while (y, m) <= (last.year, last.month):
        parts.append(f'<div class="ivf-cal"><div class="ivf-month"><span class="en">{EN_MONTH[m - 1]}</span>'
                     f'<small>{y}年{m}月</small></div><div class="ivf-grid">')
        for i, w in enumerate(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]):
            cls = " sun" if i == 0 else (" sat" if i == 6 else "")
            parts.append(f'<div class="ivf-wd{cls}">{w}</div>')
        lead = (date(y, m, 1).weekday() + 1) % 7
        ndays = _cal.monthrange(y, m)[1]
        # 予定のある期間の週だけを描く（前後の空の週は省く）
        week_start = first - timedelta(days=(first.weekday() + 1) % 7)
        week_end = last + timedelta(days=6 - (last.weekday() + 1) % 7)
        cells = [None] * lead + [date(y, m, d) for d in range(1, ndays + 1)]
        cells += [None] * ((7 - len(cells) % 7) % 7)
        weeks = [cells[i:i + 7] for i in range(0, len(cells), 7)]
        weeks = [w for w in weeks if any(c and week_start <= c <= week_end for c in w)]
        for dd in (c for w in weeks for c in w):
            if dd is None:
                parts.append('<div class="ivf-c empty"></div>')
                continue
            d = dd.day
            evs = days.get(dd, [])
            today_cls = " today" if dd == today else (" past" if today and dd < today else "")
            if evs:
                top = evs[0]  # normalize 済みなので優先度順
                bg, fg = KINDS[top["種類"]]
                labels = []
                for e in evs:
                    lab = e["メモ"] or e["種類"]
                    if lab not in labels:
                        labels.append(lab)
                lab_html = "<br>".join(html.escape(x) for x in labels[:2])
                parts.append(
                    f'<div class="ivf-c{today_cls}" style="background:{bg};color:{fg}">'
                    f'<div class="n">{d}</div><div class="l">{lab_html}</div></div>'
                )
            else:
                parts.append(f'<div class="ivf-c plain{today_cls}"><div class="n">{d}</div></div>')
        parts.append("</div></div>")
        y, m =(y + 1, 1) if m == 12 else (y, m + 1)
    return "".join(parts)


KEY_KINDS = ["生理開始", "受診・通院", "トリガー", "採卵", "新鮮胚移植", "妊娠判定"]


def _runs(df: pd.DataFrame, kinds) -> list[tuple[date, date, str, str, int]]:
    """同じ種類・メモ・周期が連続する日をまとめる。"""
    runs = []
    for r in df[df["種類"].isin(kinds)].to_dict("records"):
        key = (r["種類"], r["メモ"], r["周期"])
        if runs and runs[-1][2:] == key and (r["日付"] - runs[-1][1]).days == 1:
            runs[-1] = (runs[-1][0], r["日付"], *key)
        else:
            runs.append((r["日付"], r["日付"], *key))
    return runs


def upcoming_runs(df: pd.DataFrame, today: date, n: int = 5) -> list[tuple[date, date, str, str, int]]:
    """今日以降の主な予定（連続する日はまとめる）。"""
    return [r for r in _runs(df, KEY_KINDS) if r[1] >= today][:n]


def span_text(a: date, b: date) -> str:
    return wd(a) if a == b else f"{wd(a)}〜{wd(b)}"


def upcoming(df: pd.DataFrame, today: date, n: int = 5) -> list[str]:
    return [f"{span_text(a, b)}　{lab or kind}" for a, b, kind, lab, _ in upcoming_runs(df, today, n)]


def next_html(df: pd.DataFrame, today: date, n: int = 5) -> str:
    """「次の予定」カード。いちばん近い予定を大きく、残りを一覧で出す。"""
    runs = upcoming_runs(df, today, n)
    if not runs:
        return ""
    a, b, kind, lab, _ = runs[0]
    days = (a - today).days
    when = "今日" if days <= 0 else ("明日" if days == 1 else f"あと{days}日")
    until = f'<div class="until">〜{wd(b)}</div>' if a != b else ""
    rows = "".join(
        f'<li><i style="background:{KINDS[k][0]}"></i><span class="d">{span_text(x, y)}</span>'
        f'<span class="t">{html.escape(l or k)}</span></li>'
        for x, y, k, l, _ in runs[1:]
    )
    return (
        '<div class="ivf-hero">'
        '<div class="lbl">NEXT — 次の予定</div>'
        f'<div class="row"><div class="big">{a.month}.{a.day:02d}<small>{EN_WD[a.weekday()]}</small></div>'
        f'<div class="side"><span class="badge">{when}</span>'
        f'<div class="ttl">{html.escape(lab or kind)}</div>{until}</div></div>'
        + (f'<ul>{rows}</ul>' if rows else "")
        + "</div>"
    )


def line_text(df: pd.DataFrame) -> str:
    lines = ["【体外受精スケジュール】", "※目安です。実際の予定は診察で決まります", ""]
    for cyc in sorted(df["周期"].unique()):
        sub = df[df["周期"] == cyc]
        lines.append(f"■{cyc}周期目" if cyc else "■その他")
        for a, b, kind, lab, _ in _runs(sub, KIND_NAMES):
            span = wd(a) if a == b else f"{wd(a)}〜{wd(b)}"
            lines.append(f"{span} {lab or kind}")
        lines.append("")
    return "\n".join(lines).strip()


def _ics_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def to_ics(df: pd.DataFrame, kinds) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ivf-schedule//JP", "CALSCALE:GREGORIAN",
           "X-WR-CALNAME:体外受精スケジュール"]
    for a, b, kind, lab, cyc in _runs(df, kinds):
        title = lab or kind
        if cyc and str(cyc) not in title:
            title = f"{title}（{cyc}周期目）"
        out += [
            "BEGIN:VEVENT",
            f"UID:{uuid.uuid4()}@ivf-schedule",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{a:%Y%m%d}",
            f"DTEND;VALUE=DATE:{b + timedelta(days=1):%Y%m%d}",
            f"SUMMARY:{_ics_escape(title)}",
            f"DESCRIPTION:{_ics_escape(kind + '（目安）')}",
            "TRANSP:TRANSPARENT",
            "END:VEVENT",
        ]
    out.append("END:VCALENDAR")
    return "\r\n".join(out) + "\r\n"


def to_csv(df: pd.DataFrame) -> bytes:
    d = df.copy()
    d["日付"] = d["日付"].map(lambda x: x.isoformat())
    return d.to_csv(index=False).encode("utf-8-sig")


def from_csv(file) -> pd.DataFrame:
    return normalize(pd.read_csv(file, encoding="utf-8-sig"))
