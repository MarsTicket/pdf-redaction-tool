from __future__ import annotations

import json
import re
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


class SnapTextRequest(BaseModel):
    fileId: str
    page: int = Field(..., ge=1)
    rect: RectData
    mode: Literal["char", "word"] = "char"
    expandToWord: bool = False
    excludeDotLeader: bool = True
    excludePageNumber: bool = True


class SnapMatchedWord(BaseModel):
    text: str
    rect: RectData
    overlapRatio: float


class SnapTextResponse(BaseModel):
    requestRect: RectData
    candidateWordCount: int
    excludedDotLeaderCount: int
    excludedPageNumberCount: int
    matchedWords: list[SnapMatchedWord]
    redactions: list[RedactionItem]
    matchedWordCount: int


class TextMapRequest(BaseModel):
    fileId: str
    page: int = Field(..., ge=1)
    excludeDotLeader: bool = True
    excludePageNumber: bool = True


class TextMapItem(BaseModel):
    text: str
    rect: RectData
    lineIndex: int
    charIndex: int
    selectable: bool
    isDotLeader: bool
    isPageNumber: bool


class TextMapResponse(BaseModel):
    page: int
    chars: list[TextMapItem]


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
TEXT_REDACTION_EDGE_PROTECT_OVERLAP_RATIO = 0.45
TEXT_REDACTION_EDGE_PROTECT_GAP = 0.25
DOT_LEADER_PATTERN = re.compile(r"^[.\u00b7\u2022\u2027\u2219\u30fb\u318d\u2026\u2027\u30fb\-_]{3,}$")
DOT_LEADER_SEQUENCE_PATTERN = re.compile(r"[.\u00b7\u2022\u2027\u2219\u30fb\u318d\u2026\u2027\u30fb\-_]{3,}")
PAGE_NUMBER_PATTERN = re.compile(r"^\d{1,4}$")
DOT_LEADER_CHAR_PATTERN = re.compile(r"[.\u00b7\u318d\u2026\u2022\u2027\u2219\u30fb\-_]")
SNAP_WORD_OVERLAP_MIN_RATIO = 0.25


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


def _protect_text_rect_from_grazed_chars(page: fitz.Page, rect: fitz.Rect) -> fitz.Rect:
    """Trim text redactions away from adjacent glyphs that only graze the edge."""
    adjusted = fitz.Rect(rect)

    for _char_text, char_rect in _get_page_raw_chars(page):
        intersection = adjusted & char_rect
        char_area = char_rect.get_area()
        if intersection.is_empty or char_area <= 0:
            continue

        overlap_ratio = intersection.get_area() / char_area
        center_x = (char_rect.x0 + char_rect.x1) / 2
        center_y = (char_rect.y0 + char_rect.y1) / 2
        if (
            overlap_ratio >= TEXT_REDACTION_EDGE_PROTECT_OVERLAP_RATIO
            or _is_point_inside_rect(adjusted, center_x, center_y)
        ):
            continue

        if center_x < adjusted.x0:
            adjusted.x0 = max(adjusted.x0, char_rect.x1 + TEXT_REDACTION_EDGE_PROTECT_GAP)
        elif center_x > adjusted.x1:
            adjusted.x1 = min(adjusted.x1, char_rect.x0 - TEXT_REDACTION_EDGE_PROTECT_GAP)
        elif center_y < adjusted.y0:
            adjusted.y0 = max(adjusted.y0, char_rect.y1 + TEXT_REDACTION_EDGE_PROTECT_GAP)
        elif center_y > adjusted.y1:
            adjusted.y1 = min(adjusted.y1, char_rect.y0 - TEXT_REDACTION_EDGE_PROTECT_GAP)

        if adjusted.is_empty or adjusted.width <= 0.5 or adjusted.height <= 0.5:
            return fitz.Rect(rect)

    return adjusted


def _pdf_rect_to_fitz_query_rect(page: fitz.Page, rect: RectData) -> fitz.Rect:
    normalized = fitz.Rect(
        min(rect.x0, rect.x1),
        min(rect.y0, rect.y1),
        max(rect.x0, rect.x1),
        max(rect.y0, rect.y1),
    )
    transformed = normalized * page.transformation_matrix
    return transformed & page.rect


def _fitz_rect_to_pdf_rect(page: fitz.Page, rect: fitz.Rect) -> RectData:
    # Convert back to canonical PDF coordinates expected by existing frontend storage.
    pdf_rect = rect * ~page.transformation_matrix
    x0 = round(min(pdf_rect.x0, pdf_rect.x1), 2)
    y0 = round(min(pdf_rect.y0, pdf_rect.y1), 2)
    x1 = round(max(pdf_rect.x0, pdf_rect.x1), 2)
    y1 = round(max(pdf_rect.y0, pdf_rect.y1), 2)
    return RectData(x0=x0, y0=y0, x1=x1, y1=y1)


def _is_dot_leader_word(text: str) -> bool:
    normalized = (text or "").strip()
    if len(normalized) < 3:
        return False
    if DOT_LEADER_PATTERN.fullmatch(normalized):
        return True

    leader_chars = DOT_LEADER_CHAR_PATTERN.findall(normalized)
    leader_ratio = len(leader_chars) / max(1, len(normalized))
    return leader_ratio >= 0.7


def _has_dot_leader_sequence(text: str) -> bool:
    return bool(DOT_LEADER_SEQUENCE_PATTERN.search((text or "").strip()))


def _is_dot_leader_char(text: str) -> bool:
    return bool(DOT_LEADER_CHAR_PATTERN.fullmatch(text or ""))


def _is_page_number_word(text: str, page_width: float, word_rect: fitz.Rect) -> bool:
    if not PAGE_NUMBER_PATTERN.fullmatch((text or "").strip()):
        return False

    # Keep numeric text in main content, but exclude far-right toc-style page numbers.
    return word_rect.x0 >= (page_width * 0.6)


def _get_overlap_ratio(selection_rect: fitz.Rect, target_rect: fitz.Rect) -> float:
    intersection = target_rect & selection_rect
    target_area = target_rect.get_area()
    if intersection.is_empty or target_area <= 0:
        return 0.0
    return intersection.get_area() / target_area


def _is_snap_candidate(selection_rect: fitz.Rect, target_rect: fitz.Rect) -> tuple[bool, float]:
    overlap_ratio = _get_overlap_ratio(selection_rect, target_rect)
    center_x = (target_rect.x0 + target_rect.x1) / 2
    center_y = (target_rect.y0 + target_rect.y1) / 2
    center_inside = _is_point_inside_rect(selection_rect, center_x, center_y)
    return center_inside or overlap_ratio >= SNAP_WORD_OVERLAP_MIN_RATIO, overlap_ratio


def _get_page_raw_chars(page: fitz.Page) -> list[tuple[str, fitz.Rect]]:
    raw = page.get_text("rawdict")
    chars: list[tuple[str, fitz.Rect]] = []
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                for char in span.get("chars", []):
                    text = str(char.get("c") or "")
                    bbox = char.get("bbox")
                    if not text or not bbox:
                        continue
                    chars.append((text, fitz.Rect(bbox)))
    return chars


def _make_rect_from_char_rects(char_rects: list[fitz.Rect]) -> fitz.Rect:
    return fitz.Rect(
        min(rect.x0 for rect in char_rects),
        min(rect.y0 for rect in char_rects),
        max(rect.x1 for rect in char_rects),
        max(rect.y1 for rect in char_rects),
    )


def _get_non_leader_char_runs(
    raw_chars: list[tuple[str, fitz.Rect]],
    word_rect: fitz.Rect,
) -> list[tuple[str, fitz.Rect]]:
    runs: list[tuple[str, fitz.Rect]] = []
    current_text: list[str] = []
    current_rects: list[fitz.Rect] = []

    def close_run() -> None:
        if not current_text or not current_rects:
            return
        runs.append(("".join(current_text), _make_rect_from_char_rects(current_rects)))
        current_text.clear()
        current_rects.clear()

    for char_text, char_rect in raw_chars:
        if (char_rect & word_rect).is_empty:
            continue
        if not char_text.strip() or _is_dot_leader_char(char_text):
            close_run()
            continue
        current_text.append(char_text)
        current_rects.append(char_rect)

    close_run()
    return runs


def _rect_center_y(rect: fitz.Rect) -> float:
    return (rect.y0 + rect.y1) / 2


def _are_chars_on_same_line(previous_rect: fitz.Rect, current_rect: fitz.Rect) -> bool:
    previous_height = max(1.0, previous_rect.height)
    current_height = max(1.0, current_rect.height)
    tolerance = max(previous_height, current_height) * 0.7
    return abs(_rect_center_y(previous_rect) - _rect_center_y(current_rect)) <= tolerance


def _should_split_char_run(previous_rect: fitz.Rect, current_rect: fitz.Rect) -> bool:
    if not _are_chars_on_same_line(previous_rect, current_rect):
        return True

    gap = current_rect.x0 - previous_rect.x1
    height = max(1.0, previous_rect.height, current_rect.height)
    return gap > max(4.0, height * 0.8)


def _get_selected_char_runs(
    raw_chars: list[tuple[str, fitz.Rect]],
    selection_rect: fitz.Rect,
) -> tuple[list[tuple[str, fitz.Rect, float]], int]:
    runs: list[tuple[str, fitz.Rect, float]] = []
    current_text: list[str] = []
    current_rects: list[fitz.Rect] = []
    current_overlaps: list[float] = []
    excluded_dot_leader_count = 0

    def close_run() -> None:
        if not current_text or not current_rects:
            return
        run_text = "".join(current_text)
        run_rect = _make_rect_from_char_rects(current_rects)
        average_overlap = sum(current_overlaps) / max(1, len(current_overlaps))
        runs.append((run_text, run_rect, average_overlap))
        current_text.clear()
        current_rects.clear()
        current_overlaps.clear()

    for char_text, char_rect in sorted(raw_chars, key=lambda item: (_rect_center_y(item[1]), item[1].x0)):
        is_candidate, overlap_ratio = _is_snap_candidate(selection_rect, char_rect)
        if not is_candidate:
            continue

        if not char_text.strip():
            close_run()
            continue

        if _is_dot_leader_char(char_text):
            close_run()
            excluded_dot_leader_count += 1
            continue

        if current_rects and _should_split_char_run(current_rects[-1], char_rect):
            close_run()

        current_text.append(char_text)
        current_rects.append(char_rect)
        current_overlaps.append(overlap_ratio)

    close_run()
    return runs, excluded_dot_leader_count


def _get_page_text_map_items(
    page: fitz.Page,
    *,
    exclude_dot_leader: bool,
    exclude_page_number: bool,
) -> list[TextMapItem]:
    raw = page.get_text("rawdict")
    items: list[dict] = []
    line_index = 0

    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            line_items: list[dict] = []
            char_index = 0
            for span in line.get("spans", []):
                for char in span.get("chars", []):
                    text = str(char.get("c") or "")
                    bbox = char.get("bbox")
                    if not text or not bbox or not text.strip():
                        char_index += 1
                        continue

                    rect = fitz.Rect(bbox)
                    line_items.append(
                        {
                            "text": text,
                            "rect": rect,
                            "lineIndex": line_index,
                            "charIndex": char_index,
                            "isDotLeader": _is_dot_leader_char(text),
                            "isPageNumber": False,
                        }
                    )
                    char_index += 1

            number_run: list[dict] = []

            def close_number_run() -> None:
                if not number_run:
                    return
                run_text = "".join(item["text"] for item in number_run)
                run_rect = _make_rect_from_char_rects([item["rect"] for item in number_run])
                if _is_page_number_word(run_text, page.rect.width, run_rect):
                    for item in number_run:
                        item["isPageNumber"] = True
                number_run.clear()

            for item in line_items:
                if item["isDotLeader"]:
                    close_number_run()
                    continue
                if PAGE_NUMBER_PATTERN.fullmatch(item["text"]):
                    number_run.append(item)
                else:
                    close_number_run()
            close_number_run()

            items.extend(line_items)
            line_index += 1

    mapped: list[TextMapItem] = []
    for item in items:
        is_dot_leader = bool(item["isDotLeader"])
        is_page_number = bool(item["isPageNumber"])
        selectable = not (exclude_dot_leader and is_dot_leader) and not (exclude_page_number and is_page_number)
        mapped.append(
            TextMapItem(
                text=item["text"],
                rect=_fitz_rect_to_pdf_rect(page, item["rect"]),
                lineIndex=int(item["lineIndex"]),
                charIndex=int(item["charIndex"]),
                selectable=selectable,
                isDotLeader=is_dot_leader,
                isPageNumber=is_page_number,
            )
        )

    return mapped


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


@app.post("/redactions/text-map", response_model=TextMapResponse)
async def text_map(payload: TextMapRequest) -> TextMapResponse:
    source_path = _safe_pdf_path(UPLOAD_DIR, payload.fileId)
    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded PDF not found")

    try:
        document = fitz.open(str(source_path))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unable to open uploaded PDF") from exc

    try:
        page_index = payload.page - 1
        if page_index < 0 or page_index >= document.page_count:
            raise HTTPException(status_code=400, detail=f"Invalid page: {payload.page}")

        page = document[page_index]
        return TextMapResponse(
            page=payload.page,
            chars=_get_page_text_map_items(
                page,
                exclude_dot_leader=payload.excludeDotLeader,
                exclude_page_number=payload.excludePageNumber,
            ),
        )
    finally:
        document.close()


@app.post("/redactions/snap-text", response_model=SnapTextResponse)
async def snap_text_redactions(payload: SnapTextRequest) -> SnapTextResponse:
    source_path = _safe_pdf_path(UPLOAD_DIR, payload.fileId)
    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded PDF not found")

    try:
        document = fitz.open(str(source_path))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unable to open uploaded PDF") from exc

    try:
        page_index = payload.page - 1
        if page_index < 0 or page_index >= document.page_count:
            raise HTTPException(status_code=400, detail=f"Invalid page: {payload.page}")

        page = document[page_index]
        selection_rect = _pdf_rect_to_fitz_query_rect(page, payload.rect)
        request_rect_pdf = _fitz_rect_to_pdf_rect(page, selection_rect) if not selection_rect.is_empty else RectData(
            x0=round(min(payload.rect.x0, payload.rect.x1), 2),
            y0=round(min(payload.rect.y0, payload.rect.y1), 2),
            x1=round(max(payload.rect.x0, payload.rect.x1), 2),
            y1=round(max(payload.rect.y0, payload.rect.y1), 2),
        )
        if selection_rect.is_empty or selection_rect.get_area() <= 0:
            return SnapTextResponse(
                requestRect=request_rect_pdf,
                candidateWordCount=0,
                excludedDotLeaderCount=0,
                excludedPageNumberCount=0,
                matchedWords=[],
                redactions=[],
                matchedWordCount=0,
            )

        snapped_redactions: list[RedactionItem] = []
        matched_words: list[SnapMatchedWord] = []
        excluded_page_number_count = 0

        raw_chars = _get_page_raw_chars(page)
        char_runs, excluded_dot_leader_count = _get_selected_char_runs(raw_chars, selection_rect)
        candidate_word_count = len(char_runs)

        for run_text, run_rect, overlap_ratio in char_runs:
            if payload.excludePageNumber and _is_page_number_word(run_text, page.rect.width, run_rect):
                excluded_page_number_count += 1
                continue

            run_rect_pdf = _fitz_rect_to_pdf_rect(page, run_rect)
            matched_words.append(
                SnapMatchedWord(
                    text=run_text,
                    rect=run_rect_pdf,
                    overlapRatio=round(overlap_ratio, 4),
                )
            )
            snapped_redactions.append(
                RedactionItem(
                    page=payload.page,
                    type="text",
                    rect=run_rect_pdf,
                )
            )

        return SnapTextResponse(
            requestRect=request_rect_pdf,
            candidateWordCount=candidate_word_count,
            excludedDotLeaderCount=excluded_dot_leader_count,
            excludedPageNumberCount=excluded_page_number_count,
            matchedWords=matched_words,
            redactions=snapped_redactions,
            matchedWordCount=len(matched_words),
        )
    finally:
        document.close()


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
            elif item.type == "text":
                rect = _protect_text_rect_from_grazed_chars(page, rect)
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
