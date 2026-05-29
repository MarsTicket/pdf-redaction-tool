from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

import fitz
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from .coordinates import pdf_rect_to_fitz_rect
except ImportError:  # Allows `uvicorn app:app` from the backend directory.
    from coordinates import pdf_rect_to_fitz_rect


IS_FROZEN = getattr(sys, "frozen", False)
BASE_DIR = Path(sys.executable).resolve().parent if IS_FROZEN else Path(__file__).resolve().parent
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR.parent))
FRONTEND_DIST_DIR = RESOURCE_DIR / "frontend" / "dist"
STORAGE_DIR = BASE_DIR / "storage"
UPLOAD_DIR = STORAGE_DIR / "uploads"
RESULT_DIR = STORAGE_DIR / "results"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RESULT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="PDF Redaction MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PageInfo(BaseModel):
    page: int
    width: float
    height: float
    rotation: int


class UploadResponse(BaseModel):
    fileId: str
    pageCount: int
    pages: list[PageInfo]


class RectData(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float


class RedactionItem(BaseModel):
    page: int = Field(..., ge=1)
    type: Literal["area", "text"]
    rect: RectData


class RedactRequest(BaseModel):
    fileId: str
    redactions: list[RedactionItem]


class RedactResponse(BaseModel):
    downloadId: str
    downloadUrl: str
    redactionCount: int


def _safe_pdf_path(folder: Path, file_id: str) -> Path:
    try:
        UUID(file_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid file id") from exc
    return folder / f"{file_id}.pdf"


def _safe_metadata_path(folder: Path, file_id: str) -> Path:
    try:
        UUID(file_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid file id") from exc
    return folder / f"{file_id}.json"


def _safe_download_filename(filename: str) -> str:
    name = (filename or "document.pdf").replace("/", "_").replace("\\", "_").strip()
    if not name:
        name = "document.pdf"
    base_name = name[:-4] if name.lower().endswith(".pdf") else name
    return f"Redacted_{base_name}.pdf"


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


AREA_TEXT_PROTECT_OVERLAP_RATIO = 0.18
AREA_TEXT_PROTECT_GAP = 0.25


def _is_point_inside_rect(rect: fitz.Rect, x: float, y: float) -> bool:
    return rect.x0 <= x <= rect.x1 and rect.y0 <= y <= rect.y1


def _protect_area_rect_from_grazed_text(page: fitz.Page, rect: fitz.Rect) -> fitz.Rect:
    """Shrink area redactions away from text that is only grazed at the edge."""
    adjusted = fitz.Rect(rect)

    for word in page.get_text("words"):
        word_rect = fitz.Rect(word[:4])
        intersection = adjusted & word_rect
        word_area = word_rect.get_area()
        if intersection.is_empty or word_area <= 0:
            continue

        overlap_ratio = intersection.get_area() / word_area
        center_x = (word_rect.x0 + word_rect.x1) / 2
        center_y = (word_rect.y0 + word_rect.y1) / 2
        if (
            overlap_ratio > AREA_TEXT_PROTECT_OVERLAP_RATIO
            or _is_point_inside_rect(adjusted, center_x, center_y)
        ):
            continue

        if center_x < adjusted.x0:
            adjusted.x0 = max(adjusted.x0, word_rect.x1 + AREA_TEXT_PROTECT_GAP)
        elif center_x > adjusted.x1:
            adjusted.x1 = min(adjusted.x1, word_rect.x0 - AREA_TEXT_PROTECT_GAP)
        elif center_y < adjusted.y0:
            adjusted.y0 = max(adjusted.y0, word_rect.y1 + AREA_TEXT_PROTECT_GAP)
        elif center_y > adjusted.y1:
            adjusted.y1 = min(adjusted.y1, word_rect.y0 - AREA_TEXT_PROTECT_GAP)

        if adjusted.is_empty or adjusted.width <= 0.5 or adjusted.height <= 0.5:
            return fitz.Rect(rect)

    return adjusted


def _read_pdf_metadata(pdf_bytes: bytes) -> tuple[int, list[PageInfo]]:
    try:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid PDF file") from exc

    try:
        if document.page_count < 1:
            raise HTTPException(status_code=400, detail="PDF has no pages")

        pages = [
            PageInfo(
                page=index + 1,
                width=float(page.rect.width),
                height=float(page.rect.height),
                rotation=int(page.rotation),
            )
            for index, page in enumerate(document)
        ]
        return document.page_count, pages
    finally:
        document.close()


@app.post("/api/upload", response_model=UploadResponse)
async def upload_pdf(file: UploadFile = File(...)) -> UploadResponse:
    filename = file.filename or ""
    if filename and not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload")

    page_count, pages = _read_pdf_metadata(content)
    file_id = uuid4().hex
    upload_path = _safe_pdf_path(UPLOAD_DIR, file_id)
    upload_path.write_bytes(content)
    _write_json(
        _safe_metadata_path(UPLOAD_DIR, file_id),
        {"filename": filename or "document.pdf"},
    )

    return UploadResponse(fileId=file_id, pageCount=page_count, pages=pages)


@app.post("/api/redact", response_model=RedactResponse)
async def redact_pdf(payload: RedactRequest) -> RedactResponse:
    if not payload.redactions:
        raise HTTPException(status_code=400, detail="At least one redaction is required")

    source_path = _safe_pdf_path(UPLOAD_DIR, payload.fileId)
    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded PDF not found")

    result_id = uuid4().hex
    result_path = _safe_pdf_path(RESULT_DIR, result_id)
    source_metadata = _read_json(_safe_metadata_path(UPLOAD_DIR, payload.fileId))

    try:
        document = fitz.open(str(source_path))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unable to open uploaded PDF") from exc

    touched_pages: set[int] = set()
    try:
        for item in payload.redactions:
            page_index = item.page - 1
            if page_index < 0 or page_index >= document.page_count:
                raise HTTPException(status_code=400, detail=f"Invalid page: {item.page}")

            page = document[page_index]
            rect = pdf_rect_to_fitz_rect(
                page,
                x0=item.rect.x0,
                y0=item.rect.y0,
                x1=item.rect.x1,
                y1=item.rect.y1,
            )
            if item.type == "area":
                rect = _protect_area_rect_from_grazed_text(page, rect)
            if rect.is_empty or rect.get_area() <= 0:
                raise HTTPException(status_code=400, detail=f"Invalid redaction rectangle on page {item.page}")

            annot = page.add_redact_annot(rect, fill=(0, 0, 0), cross_out=False)
            annot.update(fill_color=(0, 0, 0), cross_out=False)
            touched_pages.add(page_index)

        for page_index in sorted(touched_pages):
            document[page_index].apply_redactions()

        document.save(str(result_path), garbage=4, deflate=True, clean=True)
        _write_json(
            _safe_metadata_path(RESULT_DIR, result_id),
            {
                "sourceFilename": source_metadata.get("filename") or "document.pdf",
                "downloadFilename": _safe_download_filename(source_metadata.get("filename") or ""),
            },
        )
    finally:
        document.close()

    return RedactResponse(
        downloadId=result_id,
        downloadUrl=f"/api/download/{result_id}",
        redactionCount=len(payload.redactions),
    )


@app.get("/api/download/{result_id}")
async def download_redacted_pdf(result_id: str) -> FileResponse:
    result_path = _safe_pdf_path(RESULT_DIR, result_id)
    if not result_path.exists():
        raise HTTPException(status_code=404, detail="Redacted PDF not found")

    result_metadata = _read_json(_safe_metadata_path(RESULT_DIR, result_id))
    download_filename = result_metadata.get("downloadFilename") or _safe_download_filename("")

    return FileResponse(
        path=result_path,
        media_type="application/pdf",
        filename=download_filename,
    )


if FRONTEND_DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="frontend")
