"""ClipStudio の AI 機能。

- POST /ai/edit        自然言語の指示を編集オペレーションに変換する
- POST /ai/titles      タイトル・説明文・チャプター・ハッシュタグを生成する
- POST /ai/transcribe  動画を文字起こしして字幕（テロップ）を作る
- POST /ai/highlights  文字起こしから見どころを抽出する
- GET  /ai/status      AI 機能が使える状態かを返す

API キーはサーバー側 (ANTHROPIC_API_KEY) だけに置き、ブラウザには渡さない。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Literal

import anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/ai", tags=["ai"])

MODEL = os.environ.get("CLIPSTUDIO_CLAUDE_MODEL", "claude-opus-5-5")
WHISPER_MODEL = os.environ.get("CLIPSTUDIO_WHISPER_MODEL", "small")
MAX_PROJECT_CHARS = 200_000

_client: anthropic.Anthropic | None = None


NO_CREDENTIALS = (
    "Claude API の認証情報がありません。サーバー側で ANTHROPIC_API_KEY を設定してください"
)


def get_client() -> anthropic.Anthropic:
    """Anthropic クライアント。"""
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def has_credentials() -> bool:
    """SDK が使える認証情報を持っているか。

    SDK は生成時ではなく送信時に認証を解決するため、クライアントが解決済みの
    資格情報（API キー / トークン / OAuth など）を持っているかで判定する。
    """
    try:
        client = get_client()
    except Exception:
        return False
    return any(getattr(client, name, None) for name in ("api_key", "auth_token", "credentials"))


def ask(system: str, prompt: str, output_format: type[BaseModel], max_tokens: int = 8000):
    """構造化出力でモデルに問い合わせ、検証済みのオブジェクトを返す。"""
    client = get_client()
    try:
        response = client.messages.parse(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_format=output_format,
            thinking={"type": "adaptive"},
        )
    except anthropic.AuthenticationError as error:
        raise HTTPException(status_code=503, detail=f"API キーが正しくありません: {error}") from error
    except anthropic.RateLimitError as error:
        raise HTTPException(status_code=429, detail=f"レート制限に達しました: {error}") from error
    except anthropic.APIStatusError as error:
        raise HTTPException(status_code=502, detail=f"Claude API エラー ({error.status_code}): {error.message}") from error
    except anthropic.APIConnectionError as error:
        raise HTTPException(status_code=502, detail=f"Claude API に接続できません: {error}") from error
    except TypeError as error:  # 認証情報が解決できないときに SDK が送信前に投げる
        raise HTTPException(status_code=503, detail=f"{NO_CREDENTIALS}（{error}）") from error

    parsed = response.parsed_output
    if parsed is None:
        raise HTTPException(status_code=502, detail="モデルの応答を解釈できませんでした")
    return parsed


# ------------------------------------------------------------------ #
# 1. 自然言語での編集                                                  #
# ------------------------------------------------------------------ #

OPERATIONS = """
trim        クリップの使う範囲を変える。index と source_start / source_end（素材内の秒）
split       timeline_time（タイムライン上の秒）でクリップを分割する
delete      target と index で削除する
reorder     index のクリップを to_index の位置へ動かす
speed       index のクリップの再生速度。value は 0.25〜4
volume      index のクリップ（target が audio なら音声クリップ）の音量。value は 0〜1
filter      index のクリップの色調。preset は none/vivid/mono/sepia/vintage/cool/warm/dream
transition  index のクリップの直前の切り替え。transition は none/crossfade/fadeblack/wipe/slide/zoom、duration は秒
fade        index のクリップのフェード。fade_in / fade_out（秒）
add_text    テロップを追加する。text と start（秒）、duration（秒）、任意で position/color/size/animation
update_text index のテロップを変更する。text / start / duration / position / color / size / animation
project     出力設定を変える。width / height / fps / background
""".strip()

EDIT_SYSTEM = f"""あなたはブラウザ動画編集アプリ ClipStudio の編集アシスタントです。
ユーザーの日本語の指示を、アプリが実行できる編集オペレーションの列に変換します。

# タイムラインの構造
- 映像トラック: クリップが順番に並ぶ。クリップは素材の一部分（source_start〜source_end）を使う。
- 音声トラック: BGM などを任意の位置に置く。
- テキストトラック: テロップ。start から duration 秒表示される。
- 時間はすべて秒（小数可）。index はユーザーに見えている 1 始まりの番号。

# 使えるオペレーション
{OPERATIONS}

# ルール
- 与えられたプロジェクト情報に存在する index だけを使う。存在しないものは作らない。
- 指示があいまいなときは、最も自然な解釈を1つ選び、reply でどう解釈したかを説明する。
- 実行できない指示（対応していない機能、対象が無い）のときは operations を空にして、reply で理由と代案を伝える。
- 削除や分割で index がずれる場合は、後ろの要素から先に処理する順番で並べる。
- reply は日本語で 1〜3 文。何をしたかを簡潔に伝える。"""


class Operation(BaseModel):
    """アプリ側で実行する編集操作 1 つ。"""

    op: Literal[
        "trim", "split", "delete", "reorder", "speed", "volume",
        "filter", "transition", "fade", "add_text", "update_text", "project",
    ]
    target: Literal["clip", "audio", "text"] | None = Field(
        default=None, description="操作の対象トラック。省略時は clip"
    )
    index: int | None = Field(default=None, description="対象の 1 始まりの番号")
    to_index: int | None = Field(default=None, description="reorder の移動先")
    value: float | None = Field(default=None, description="speed / volume の値")
    source_start: float | None = Field(default=None, description="trim: 素材内の開始秒")
    source_end: float | None = Field(default=None, description="trim: 素材内の終了秒")
    timeline_time: float | None = Field(default=None, description="split: タイムライン上の秒")
    start: float | None = Field(default=None, description="テロップの開始秒")
    duration: float | None = Field(default=None, description="長さ（秒）")
    text: str | None = Field(default=None, description="テロップの文字列")
    preset: str | None = Field(default=None, description="色調プリセット")
    transition: str | None = Field(default=None, description="トランジションの種類")
    fade_in: float | None = Field(default=None, description="フェードイン秒")
    fade_out: float | None = Field(default=None, description="フェードアウト秒")
    position: Literal["top", "center", "bottom"] | None = Field(default=None, description="テロップの縦位置")
    color: str | None = Field(default=None, description="テロップの色 (#RRGGBB)")
    size: float | None = Field(default=None, description="テロップの文字サイズ（画面高さに対する%）")
    animation: str | None = Field(default=None, description="none/fade/slide/pop/typewriter")
    width: int | None = None
    height: int | None = None
    fps: int | None = None
    background: str | None = None
    note: str | None = Field(default=None, description="この操作の短い説明（日本語）")


class EditResult(BaseModel):
    reply: str = Field(description="ユーザーへの日本語の返答")
    operations: list[Operation] = Field(default_factory=list)


class EditRequest(BaseModel):
    instruction: str
    project: dict[str, Any]


@router.post("/edit", response_model=EditResult)
async def edit(request: EditRequest) -> EditResult:
    """自然言語の指示を編集オペレーションに変換する。"""
    instruction = request.instruction.strip()
    if not instruction:
        raise HTTPException(status_code=400, detail="指示を入力してください")
    project_json = _dump(request.project)
    prompt = f"# 現在のプロジェクト\n{project_json}\n\n# 指示\n{instruction}"
    return ask(EDIT_SYSTEM, prompt, EditResult)


# ------------------------------------------------------------------ #
# 2. タイトル・説明文                                                  #
# ------------------------------------------------------------------ #

TITLE_SYSTEM = """あなたは動画編集者を助けるコピーライターです。
与えられた動画の構成（クリップの並び、テロップ、字幕）から、公開用のタイトル案などを作ります。

- titles: 惹きつけるタイトルを3案。それぞれ全角30文字以内。
- description: 概要欄に貼れる説明文。3〜5文。
- hashtags: ハッシュタグを5個まで（# は付けない）。
- chapters: 内容が変わる区切りに time（秒）と label（全角20文字以内）。動画が30秒未満なら空でよい。
- captions: 動画に入れると良いテロップ案を3つまで。text と start（秒）、duration（秒）。
すべて日本語。内容から読み取れないことは書かない。"""


class Chapter(BaseModel):
    time: float
    label: str


class CaptionIdea(BaseModel):
    text: str
    start: float
    duration: float


class TitleResult(BaseModel):
    titles: list[str]
    description: str
    hashtags: list[str] = Field(default_factory=list)
    chapters: list[Chapter] = Field(default_factory=list)
    captions: list[CaptionIdea] = Field(default_factory=list)


class TitleRequest(BaseModel):
    project: dict[str, Any]
    transcript: str | None = None
    tone: str | None = Field(default=None, description="口調や方向性の指定")


@router.post("/titles", response_model=TitleResult)
async def titles(request: TitleRequest) -> TitleResult:
    """タイトル・説明文・チャプター・テロップ案を生成する。"""
    parts = [f"# 動画の構成\n{_dump(request.project)}"]
    if request.transcript:
        parts.append(f"# 文字起こし\n{request.transcript[:40000]}")
    if request.tone:
        parts.append(f"# 希望する雰囲気\n{request.tone}")
    return ask(TITLE_SYSTEM, "\n\n".join(parts), TitleResult)


# ------------------------------------------------------------------ #
# 3. 文字起こし → 字幕                                                 #
# ------------------------------------------------------------------ #

CAPTION_SYSTEM = """あなたは字幕編集者です。音声認識の結果を、動画に載せる字幕に整えます。

- 1行は全角20文字程度まで。長い文は意味の切れ目で分割する。
- 「えー」「あのー」などのフィラー、言い直しは取り除く。
- 句読点を整え、読みやすくする。内容は変えない。話していないことは足さない。
- 認識が明らかに誤っている語は文脈から自然な語に直す。
- 各字幕には start（開始秒）と duration（表示秒数）を付ける。元のタイムスタンプから大きくずらさない。
- text は元の言語のまま（日本語なら日本語）。"""


class Caption(BaseModel):
    text: str
    start: float
    duration: float


class CaptionResult(BaseModel):
    captions: list[Caption]


class Segment(BaseModel):
    start: float
    end: float
    text: str


class TranscribeRequest(BaseModel):
    media: str = Field(description="uploads/ 内のファイル名")
    language: str | None = Field(default=None, description="ja / en など。省略で自動判定")
    polish: bool = Field(
        default=False,
        description="Claude で字幕として整えるか（API を使う。既定はローカル整形のみ）",
    )
    offset: float = Field(default=0.0, description="タイムライン上のクリップ開始位置（秒）")


class TranscribeResult(BaseModel):
    segments: list[Segment]
    captions: list[Caption]
    language: str | None = None
    polished: bool = False


class TranscriptionUnavailable(RuntimeError):
    pass


def ffmpeg_path() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise TranscriptionUnavailable(
            "ffmpeg が見つかりません。音声を取り出すために ffmpeg をインストールしてください"
            "（macOS: brew install ffmpeg / Ubuntu: apt install ffmpeg）"
        )
    return path


def extract_audio(source: Path, destination: Path) -> None:
    """動画から 16kHz モノラルの WAV を取り出す。"""
    command = [
        ffmpeg_path(), "-y", "-i", str(source),
        "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(destination),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=1800)
    if result.returncode != 0 or not destination.exists() or destination.stat().st_size == 0:
        tail = (result.stderr or "").strip().splitlines()[-3:]
        raise TranscriptionUnavailable("音声を取り出せませんでした: " + " / ".join(tail))


def transcribe_audio(audio: Path, language: str | None) -> tuple[list[Segment], str | None]:
    """faster-whisper でローカルに文字起こしする（API 料金はかからない）。"""
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise TranscriptionUnavailable(
            "faster-whisper が入っていません。`pip install faster-whisper` を実行してください"
        ) from error

    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(audio), language=language, vad_filter=True)
    found = [
        Segment(start=round(s.start, 2), end=round(s.end, 2), text=s.text.strip())
        for s in segments
        if s.text and s.text.strip()
    ]
    return found, getattr(info, "language", None)


def polish_captions(segments: list[Segment], offset: float) -> list[Caption]:
    """認識結果を字幕として読みやすく整える。"""
    lines = "\n".join(f"[{s.start:.2f}-{s.end:.2f}] {s.text}" for s in segments)
    result = ask(
        CAPTION_SYSTEM,
        f"次の音声認識結果を字幕に整えてください。\n\n{lines[:120000]}",
        CaptionResult,
        max_tokens=16000,
    )
    return [
        Caption(text=c.text, start=round(c.start + offset, 2), duration=max(0.4, round(c.duration, 2)))
        for c in result.captions
    ]


# ローカル整形で取り除くフィラー（API を使わない字幕づくり用）
FILLERS = (
    "えーと", "ええと", "えっと", "えー", "えっ", "あのー", "あのう", "あの、",
    "そのー", "うーん", "んーと", "まあ", "まぁ", "なんか、", "こう、",
)
SENTENCE_BREAKS = "。！？!?"
MAX_CAPTION_CHARS = 20


def clean_caption_text(text: str) -> str:
    """フィラーと余分な空白を取り除く（内容は変えない）。"""
    cleaned = text.strip()
    changed = True
    while changed:
        changed = False
        for filler in FILLERS:
            if cleaned.startswith(filler):
                cleaned = cleaned[len(filler) :].lstrip("、 　")
                changed = True
    for filler in FILLERS:
        cleaned = cleaned.replace(f"、{filler}、", "、").replace(f" {filler} ", " ")
    return " ".join(cleaned.split()).strip("、 　")


def split_caption(text: str, limit: int = MAX_CAPTION_CHARS) -> list[str]:
    """長い文を句読点で区切り、字幕の行にまとめる。

    単語の途中で切れるより多少長い行のほうが読みやすいので、
    句読点までなら limit を少し超えることを許す。
    """
    if len(text) <= limit:
        return [text] if text else []

    hard_limit = int(limit * 1.3)
    chunks: list[str] = []
    current = ""
    for char in text:
        current += char
        if char in SENTENCE_BREAKS or char == "、":
            chunks.append(current)
            current = ""
    if current:
        chunks.append(current)

    lines: list[str] = []
    for chunk in chunks:
        while len(chunk) > hard_limit:  # 句読点が無い長い塊は仕方なく割る
            lines.append(chunk[:limit])
            chunk = chunk[limit:]
        if not chunk:
            continue
        if lines and len(lines[-1]) + len(chunk) <= limit:
            lines[-1] += chunk
        else:
            lines.append(chunk)
    return [line for line in lines if line]


def local_captions(segments: list[Segment], offset: float) -> list[Caption]:
    """Claude を使わずに字幕を作る（フィラー除去・短い断片の結合・長文の分割）。"""
    merged: list[Segment] = []
    for segment in segments:
        text = clean_caption_text(segment.text)
        if not text:
            continue
        previous = merged[-1] if merged else None
        too_short = (segment.end - segment.start) < 1.0 or len(text) < 6
        close_enough = previous is not None and (segment.start - previous.end) < 0.6
        if previous and too_short and close_enough and len(previous.text) + len(text) <= MAX_CAPTION_CHARS * 2:
            previous.text = f"{previous.text}{text}"
            previous.end = segment.end
        else:
            merged.append(Segment(start=segment.start, end=segment.end, text=text))

    captions: list[Caption] = []
    for segment in merged:
        lines = split_caption(segment.text)
        if not lines:
            continue
        span = max(0.4, segment.end - segment.start)
        total = sum(len(line) for line in lines) or 1
        cursor = segment.start
        for line in lines:
            share = span * (len(line) / total)
            captions.append(
                Caption(
                    text=line,
                    start=round(cursor + offset, 2),
                    duration=max(0.5, round(share, 2)),
                )
            )
            cursor += share
    return captions


def fallback_captions(segments: list[Segment], offset: float) -> list[Caption]:
    """認識結果をそのまま字幕にする（最後の手段）。"""
    return [
        Caption(text=s.text, start=round(s.start + offset, 2), duration=max(0.4, round(s.end - s.start, 2)))
        for s in segments
    ]


@router.post("/transcribe", response_model=TranscribeResult)
async def transcribe(request: TranscribeRequest) -> TranscribeResult:
    """アップロード済みの動画・音声を文字起こしして字幕を作る。"""
    from .main import UPLOAD_DIR  # 循環インポートを避けるため遅延読み込み

    name = Path(request.media).name  # パス区切りを落として uploads/ の外を触らせない
    source = (UPLOAD_DIR / name).resolve()
    if source.parent != UPLOAD_DIR or not source.is_file():
        raise HTTPException(status_code=404, detail="対象のファイルが見つかりません")

    with tempfile.TemporaryDirectory() as workdir:
        audio = Path(workdir) / "audio.wav"
        try:
            extract_audio(source, audio)
            segments, language = transcribe_audio(audio, request.language)
        except TranscriptionUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except subprocess.TimeoutExpired as error:
            raise HTTPException(status_code=504, detail="音声の取り出しが時間内に終わりませんでした") from error

    if not segments:
        return TranscribeResult(segments=[], captions=[], language=language, polished=False)

    if request.polish:
        try:
            captions = polish_captions(segments, request.offset)
            return TranscribeResult(segments=segments, captions=captions, language=language, polished=True)
        except HTTPException:
            # Claude が使えなくてもローカル整形で字幕にできる
            pass

    return TranscribeResult(
        segments=segments,
        captions=local_captions(segments, request.offset) or fallback_captions(segments, request.offset),
        language=language,
        polished=False,
    )


# ------------------------------------------------------------------ #
# 4. ハイライト抽出                                                    #
# ------------------------------------------------------------------ #

HIGHLIGHT_SYSTEM = """あなたは動画編集者です。文字起こしから、短尺動画に向く「見どころ」を選びます。

- 指定された本数だけ、重ならない区間を選ぶ。
- 各区間は話の切れ目から始めて切れ目で終わる（文の途中で切らない）。
- 目安の長さに近づける。短すぎる断片は選ばない。
- title は全角20文字以内のキャッチーな見出し、reason は選んだ理由を1文で。
- score は 0〜1 で、短尺動画としての強さ。
すべて日本語。文字起こしに無い内容は書かない。"""


class Highlight(BaseModel):
    start: float
    end: float
    title: str
    reason: str
    score: float = 0.5


class HighlightResult(BaseModel):
    highlights: list[Highlight]


class HighlightRequest(BaseModel):
    segments: list[Segment]
    count: int = Field(default=3, ge=1, le=10)
    target_duration: float = Field(default=30.0, gt=1)


@router.post("/highlights", response_model=HighlightResult)
async def highlights(request: HighlightRequest) -> HighlightResult:
    """文字起こしから見どころを抽出する。"""
    if not request.segments:
        raise HTTPException(status_code=400, detail="先に文字起こしを実行してください")
    lines = "\n".join(f"[{s.start:.2f}-{s.end:.2f}] {s.text}" for s in request.segments)
    prompt = (
        f"目安 {request.target_duration:.0f} 秒の見どころを {request.count} 本選んでください。\n\n"
        f"{lines[:120000]}"
    )
    result = ask(HIGHLIGHT_SYSTEM, prompt, HighlightResult, max_tokens=8000)
    result.highlights = [h for h in result.highlights if h.end > h.start]
    return result


# ------------------------------------------------------------------ #
# 状態                                                                #
# ------------------------------------------------------------------ #


class AIStatus(BaseModel):
    available: bool
    model: str
    reason: str | None = None
    transcription: bool
    transcription_reason: str | None = None


@router.get("/status", response_model=AIStatus)
async def status() -> AIStatus:
    """AI 機能が使えるかどうか（キーやツールの有無）を返す。"""
    available = has_credentials()
    reason = None if available else NO_CREDENTIALS

    transcription, transcription_reason = True, None
    try:
        ffmpeg_path()
        import faster_whisper  # noqa: F401
    except TranscriptionUnavailable as error:
        transcription, transcription_reason = False, str(error)
    except ImportError:
        transcription = False
        transcription_reason = "faster-whisper が入っていません。`pip install faster-whisper` を実行してください"

    return AIStatus(
        available=available,
        model=MODEL,
        reason=reason,
        transcription=transcription,
        transcription_reason=transcription_reason,
    )


def _dump(data: Any) -> str:
    import json

    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(text) > MAX_PROJECT_CHARS:
        raise HTTPException(status_code=413, detail="プロジェクトが大きすぎます")
    return text
