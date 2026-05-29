from __future__ import annotations

from dataclasses import dataclass

import fitz


RECT_CLIP_EPSILON = 0.01


@dataclass(frozen=True)
class NormalizedRect:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def area(self) -> float:
        return max(0.0, self.x1 - self.x0) * max(0.0, self.y1 - self.y0)


def normalize_rect(x0: float, y0: float, x1: float, y1: float) -> NormalizedRect:
    return NormalizedRect(
        x0=min(x0, x1),
        y0=min(y0, y1),
        x1=max(x0, x1),
        y1=max(y0, y1),
    )


def pdf_rect_to_fitz_rect(
    page: fitz.Page,
    *,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
) -> fitz.Rect:
    """Convert canonical PDF-space coordinates to PyMuPDF page coordinates."""
    rect = normalize_rect(x0, y0, x1, y1)
    pdf_rect = fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y1)
    fitz_rect = pdf_rect * page.transformation_matrix

    # Keep the applied fill inside the physical page and avoid tiny floating point
    # spillover from PDF.js -> PyMuPDF coordinate conversion.
    clipped_rect = fitz_rect & page.rect
    if clipped_rect.width <= (RECT_CLIP_EPSILON * 2) or clipped_rect.height <= (RECT_CLIP_EPSILON * 2):
        return clipped_rect

    return clipped_rect + (
        RECT_CLIP_EPSILON,
        RECT_CLIP_EPSILON,
        -RECT_CLIP_EPSILON,
        -RECT_CLIP_EPSILON,
    )
