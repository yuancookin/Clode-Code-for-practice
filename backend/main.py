"""ClipStudio バックエンド。

動画・写真ファイルのアップロードを受け取り、uploads/ に保存する FastAPI アプリ。

    uvicorn backend.main:app --reload
"""

from __future__ import annotations

import os
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = Path(os.environ.get("CLIPSTUDIO_UPLOAD_DIR", BASE_DIR / "uploads")).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 1ファイルあたりの上限（既定 2GB）。動画を扱うので大きめに取る。
MAX_UPLOAD_BYTES = int(os.environ.get("CLIPSTUDIO_MAX_UPLOAD_MB", "2048")) * 1024 * 1024
CHUNK_SIZE = 1024 * 1024  # 1MB ずつ書き出してメモリを使い切らないようにする

# 受け付ける拡張子。音声 (BGM) も扱うときは AUDIO_EXTENSIONS を足して ALLOWED に含める。
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".ogv"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg"}
ALLOWED_EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS

ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CLIPSTUDIO_ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]

app = FastAPI(
    title="ClipStudio API",
    description="動画編集アプリ ClipStudio のアップロード API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 保存したファイルをそのまま配信する（レスポンスの url で参照できる）
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# AI 機能 (/ai/*)。anthropic が入っていない環境でも他の機能は動くようにする。
try:
    from .ai import router as ai_router

    app.include_router(ai_router)
    AI_ENABLED = True
except ImportError:  # pragma: no cover - 依存未インストール時
    AI_ENABLED = False


class StoredFile(BaseModel):
    """保存済みファイル 1件分の情報。"""

    name: str
    original_name: str
    kind: str  # "video" または "image"
    content_type: str
    size: int
    url: str
    uploaded_at: str


class RejectedFile(BaseModel):
    """受け付けられなかったファイルと、その理由。"""

    original_name: str
    reason: str


class UploadResponse(BaseModel):
    files: list[StoredFile]
    rejected: list[RejectedFile]


class FileListResponse(BaseModel):
    files: list[StoredFile]


def kind_of(extension: str) -> str | None:
    if extension in VIDEO_EXTENSIONS:
        return "video"
    if extension in IMAGE_EXTENSIONS:
        return "image"
    return None


def safe_stem(filename: str) -> str:
    """元のファイル名から、保存名に使える範囲の文字だけを取り出す。"""
    stem = Path(filename or "").name  # ディレクトリ部分を落としてパス操作を防ぐ
    stem = Path(stem).stem
    stem = unicodedata.normalize("NFKC", stem)
    stem = re.sub(r"[^\w\-]+", "_", stem, flags=re.UNICODE).strip("_")
    return stem[:60] or "file"


def storage_name(filename: str, extension: str) -> str:
    """衝突しない保存名を作る（例: 20260916-051530_a1b2c3d4_opening.mp4）。"""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{timestamp}_{uuid.uuid4().hex[:8]}_{safe_stem(filename)}{extension}"


def guess_content_type(upload: UploadFile, kind: str, extension: str) -> str:
    if upload.content_type and upload.content_type != "application/octet-stream":
        return upload.content_type
    return f"{kind}/{extension.lstrip('.')}"


# storage_name() が付けた "20260929-065018_6318353f_" の接頭辞
STORAGE_PREFIX = re.compile(r"^\d{8}-\d{6}_[0-9a-f]{8}_")


def display_name(stored: str) -> str:
    """保存名から日時・ランダム部分を外して、読みやすい名前に戻す。"""
    return STORAGE_PREFIX.sub("", stored) or stored


def describe(path: Path, *, original_name: str | None = None, content_type: str | None = None) -> StoredFile:
    stat = path.stat()
    extension = path.suffix.lower()
    kind = kind_of(extension) or "file"
    return StoredFile(
        name=path.name,
        original_name=original_name or display_name(path.name),
        kind=kind,
        content_type=content_type or f"{kind}/{extension.lstrip('.')}",
        size=stat.st_size,
        url=f"/uploads/{path.name}",
        uploaded_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    )


async def save_upload(upload: UploadFile, destination: Path) -> int:
    """アップロードを分割して書き出し、書き込んだバイト数を返す。"""
    written = 0
    with destination.open("wb") as buffer:
        while chunk := await upload.read(CHUNK_SIZE):
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                buffer.close()
                destination.unlink(missing_ok=True)
                raise ValueError(
                    f"サイズが上限 ({MAX_UPLOAD_BYTES // (1024 * 1024)}MB) を超えています"
                )
            buffer.write(chunk)
    return written


@app.get("/", include_in_schema=False)
async def root() -> FileResponse:
    """エディタ本体を返す（API の情報は /api）。"""
    index = BASE_DIR / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="index.html が見つかりません")
    return FileResponse(index)


@app.get("/api", tags=["meta"])
async def api_info() -> dict:
    return {
        "name": "ClipStudio API",
        "upload_dir": str(UPLOAD_DIR),
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
        "allowed_extensions": sorted(ALLOWED_EXTENSIONS),
        "ai_enabled": AI_ENABLED,
        "endpoints": {
            "upload": "POST /upload",
            "list": "GET /files",
            "editor": "GET /",
            "ai": "GET /ai/status",
        },
    }


@app.post("/upload", response_model=UploadResponse, tags=["upload"])
async def upload(files: list[UploadFile] = File(..., description="動画または写真ファイル")) -> UploadResponse:
    """動画・写真を複数まとめて受け取り、保存したファイルの一覧を返す。

    対応していない形式や大きすぎるファイルは `rejected` に理由付きで返し、
    残りのファイルの保存は続行する。1件も保存できなかった場合は 400。
    """
    stored: list[StoredFile] = []
    rejected: list[RejectedFile] = []

    for upload_file in files:
        original_name = Path(upload_file.filename or "").name or "(名称不明)"
        extension = Path(original_name).suffix.lower()
        kind = kind_of(extension)

        if kind is None:
            rejected.append(
                RejectedFile(
                    original_name=original_name,
                    reason=f"対応していない形式です ({extension or '拡張子なし'})",
                )
            )
            continue

        destination = UPLOAD_DIR / storage_name(original_name, extension)
        try:
            size = await save_upload(upload_file, destination)
        except ValueError as error:
            rejected.append(RejectedFile(original_name=original_name, reason=str(error)))
            continue
        except OSError as error:
            destination.unlink(missing_ok=True)
            rejected.append(
                RejectedFile(original_name=original_name, reason=f"保存に失敗しました: {error}")
            )
            continue
        finally:
            await upload_file.close()

        if size == 0:
            destination.unlink(missing_ok=True)
            rejected.append(RejectedFile(original_name=original_name, reason="中身が空のファイルです"))
            continue

        stored.append(
            describe(
                destination,
                original_name=original_name,
                content_type=guess_content_type(upload_file, kind, extension),
            )
        )

    if not stored:
        raise HTTPException(
            status_code=400,
            detail={"message": "保存できたファイルがありません", "rejected": [r.model_dump() for r in rejected]},
        )

    return UploadResponse(files=stored, rejected=rejected)


@app.get("/files", response_model=FileListResponse, tags=["upload"])
async def list_files() -> FileListResponse:
    """uploads/ に保存済みのファイル一覧を新しい順で返す。"""
    entries = [path for path in UPLOAD_DIR.iterdir() if path.is_file() and not path.name.startswith(".")]
    entries.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return FileListResponse(files=[describe(path) for path in entries])


# ------------------------------------------------------------------ #
# フロントエンド配信                                                   #
# ------------------------------------------------------------------ #
# 同じサーバーからエディタを配信すると、API と同一オリジンになり
# CORS もエンドポイントの設定も不要で動く。
# リポジトリ全体を公開しないよう、配信するファイルは明示的に限定する。

FRONTEND_FILES = {"index.html", "style.css", "sw.js", "manifest.json"}
FRONTEND_DIRS = ("js", "icons", "fonts")

for directory in FRONTEND_DIRS:
    path = BASE_DIR / directory
    if path.is_dir():
        app.mount(f"/{directory}", StaticFiles(directory=path), name=f"frontend-{directory}")


@app.get("/app", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
async def frontend_index() -> FileResponse:
    index = BASE_DIR / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="index.html が見つかりません")
    return FileResponse(index)


@app.get("/{filename}", include_in_schema=False)
async def frontend_asset(filename: str) -> FileResponse:
    if filename not in FRONTEND_FILES:
        raise HTTPException(status_code=404, detail="Not Found")
    return FileResponse(BASE_DIR / filename)
