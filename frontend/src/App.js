import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

import { applyRedactions, fetchTextMap, snapTextRedactions, toDownloadUrl, uploadPdf } from "./api.js";
import {
  normalizeRect,
  pdfRectToViewportRect,
  rectSize,
  roundRect,
  viewportRectToPdfRect,
} from "./pdfCoordinates.js";


pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const h = React.createElement;
const MIN_SELECTION_SIZE = 4;
const MIN_EDIT_SIZE = 6;
const ZOOM_DEBOUNCE_MS = 180;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
const KEYBOARD_MOVE_STEP = 1;
const KEYBOARD_MOVE_FAST_STEP = 10;
const THUMBNAIL_WIDTH = 132;
const EMPTY_REDACTIONS = [];
const RESIZE_HANDLES = ["nw", "ne", "sw", "se"];
const HISTORY_LIMIT = 50;
const VIRTUAL_PAGE_BUFFER = 3;
const PAGE_TOOLBAR_HEIGHT = 32;
const PAGE_BOTTOM_GAP = 24;
const SEARCH_CONTEXT_LENGTH = 28;
const MARKING_MODE_TEXT = "text";
const MARKING_MODE_AREA = "area";
const TEXT_SELECTION_MIN_SIZE = 1;
const TEXT_SELECTION_LINE_CENTER_RATIO = 0.55;
const TEXT_SELECTION_MERGE_GAP_RATIO = 0.65;
const TEXT_SELECTION_MERGE_MIN_GAP = 3;
const TEXT_SELECTION_MERGE_MAX_GAP = 16;
const TEXT_SELECTION_VERTICAL_PADDING_RATIO = 0.06;
const TEXT_SELECTION_VERTICAL_PADDING_MIN = 0.5;
const TEXT_SELECTION_VERTICAL_PADDING_MAX = 2;
const TEXT_SELECTION_HORIZONTAL_PADDING_RATIO = 0.08;
const TEXT_SELECTION_HORIZONTAL_PADDING_MIN = 0.5;
const TEXT_SELECTION_HORIZONTAL_PADDING_MAX = 2.5;
const TEXT_REDACTION_VERTICAL_PADDING_RATIO = 0.02;
const TEXT_REDACTION_VERTICAL_PADDING_MIN = 0;
const TEXT_REDACTION_VERTICAL_PADDING_MAX = 0.8;
const TEXT_REDACTION_HORIZONTAL_PADDING_RATIO = 0.04;
const TEXT_REDACTION_HORIZONTAL_PADDING_MIN = 2;
const TEXT_REDACTION_HORIZONTAL_PADDING_MAX = 4;
const TEXT_LAYER_SCALE_TOLERANCE = 0.001;
const TEXT_LAYER_SIZE_TOLERANCE = 1.5;
const TEXT_LAYER_DEBUG_KEYWORDS = ["김현희", "현희", "사법처리", "폭파사건"];
const ENABLE_TEXT_LAYER_VISUAL_DEBUG = false;
const ENABLE_TEXT_LAYER_RECT_OVERLAY_DEBUG = false;
const TEXT_SELECTION_ANCHOR_TOLERANCE = 2;
const TEXT_SELECTION_HOVER_TOLERANCE = 2;
const TEXT_RECT_ALIGNMENT_OFFSET_X = 1;
const TEXT_RECT_ALIGNMENT_OFFSET_Y = 1;
const ENABLE_TEXT_X_WHITESPACE_TRIM = false;
const ENABLE_TEXT_ITEM_TABLE_DEBUG = false;
const TEXT = {
  appTitle: "PDF 블랙마킹",
  uploadPdf: "PDF 업로드",
  uploadHint: "파일 선택 또는 드롭",
  document: "문서",
  noFile: "문서 없음",
  waiting: "대기 중",
  pages: "쪽",
  zoom: "확대/축소",
  regions: "선택 영역",
  noRegions: "선택된 영역 없음",
  page: "페이지",
  rendering: "렌더링 중",
  renderFailed: "렌더링 실패",
  deleteRegion: "선택 영역 삭제",
  applyRedactions: "블랙마킹 적용",
  applying: "적용 중",
  downloadPdf: "PDF 다운로드",
  uploadPrompt: "PDF를 업로드하세요",
  uploading: "업로드 중",
  invalidPdfFile: "PDF 파일만 업로드할 수 있습니다.",
  uploadFirst: "PDF를 먼저 업로드하세요.",
  selectRegionFirst: "하나 이상의 영역을 선택하세요.",
  loadFailed: "PDF를 불러오지 못했습니다.",
  redactFailed: "블랙마킹 적용에 실패했습니다.",
  reset: "초기화",
  resetConfirm: "현재 PDF와 선택 영역, 저장된 작업 상태를 모두 초기화할까요?",
  pageMove: "페이지 이동",
  currentPage: "현재 페이지",
  goToPage: "이동",
  invalidPage: "존재하지 않는 페이지입니다.",
  thumbnails: "썸네일",
  saveWork: "작업 저장",
  loadWork: "작업 불러오기",
  savedWork: "작업",
  noPdfForSave: "저장할 PDF 작업이 없습니다.",
  noPdfForLoad: "먼저 원본 PDF를 업로드하세요.",
  invalidWorkFile: "작업 JSON 파일이 올바르지 않습니다.",
  workLoaded: "작업을 불러왔습니다.",
  workSaved: "작업 파일을 저장했습니다.",
  workMismatchConfirm: "현재 PDF와 작업 파일의 식별 정보가 일치하지 않습니다. 그래도 불러올까요?",
  workMismatchCancelled: "작업 불러오기를 취소했습니다.",
  undo: "실행 취소",
  redo: "다시 실행",
  search: "검색",
  searchPlaceholder: "단어 검색",
  searchButton: "검색",
  searchPrev: "이전",
  searchNext: "다음",
  searchNoPdf: "먼저 PDF를 업로드하세요.",
  searchEmpty: "검색어를 입력하세요.",
  searchRunning: "검색 중",
  searchNoResults: "검색 결과가 없습니다.",
  searchResults: "검색 결과",
  markingMode: "마킹 방식",
  textSelectionMode: "텍스트 선택",
  areaSelectionMode: "영역 선택",
  areaSelectionHelp: "스캔본/이미지 PDF용",
  redactionTypeText: "텍스트",
  redactionTypeArea: "영역",

  fileGroup: "파일",
  viewGroup: "보기",
  editGroup: "편집",
  fitMode: "페이지 맞춤",
  scrollMode: "스크롤 모드",
};

let renderQueueTail = Promise.resolve();
let thumbnailQueueTail = Promise.resolve();


function enqueueRender(task) {
  const run = renderQueueTail.catch(() => undefined).then(task);
  renderQueueTail = run.catch(() => undefined);

  return run;
}


function enqueueThumbnailRender(task) {
  const run = thumbnailQueueTail.catch(() => undefined).then(task);
  thumbnailQueueTail = run.catch(() => undefined);

  return run;
}


function clampZoom(value) {
  return clamp(Math.round(value * 10) / 10, ZOOM_MIN, ZOOM_MAX);
}


function getPdfFingerprint(document) {
  if (Array.isArray(document.fingerprints) && document.fingerprints[0]) {
    return document.fingerprints[0];
  }

  return document.fingerprint || "";
}


async function computeFileSha256(file) {
  if (!globalThis.crypto?.subtle) {
    return "";
  }

  const buffer = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}


function makeProjectFileName(fileName) {
  const baseName = fileName.replace(/\.pdf$/i, "") || "pdf-redaction";

  return `${baseName}.pdfredact.json`;
}


function normalizeImportedRedaction(redaction) {
  const type = redaction?.type === MARKING_MODE_TEXT || redaction?.type === MARKING_MODE_AREA
    ? redaction.type
    : "";

  if (
    !redaction
    || !type
    || !Number.isFinite(redaction.page)
    || !redaction.rect
  ) {
    return null;
  }

  const { x0, y0, x1, y1 } = redaction.rect;
  if (![x0, y0, x1, y1].every(Number.isFinite)) {
    return null;
  }

  return {
    id: makeId(),
    page: redaction.page,
    type,
    rect: { x0, y0, x1, y1 },
  };
}


function getProjectMismatchReasons(currentPdf, savedPdf) {
  const reasons = [];

  if (!currentPdf || !savedPdf) {
    return ["pdf"];
  }

  if (currentPdf.fileName !== savedPdf.fileName) {
    reasons.push("fileName");
  }

  if (currentPdf.fileSize !== savedPdf.fileSize) {
    reasons.push("fileSize");
  }

  if (currentPdf.pageCount !== savedPdf.pageCount) {
    reasons.push("pageCount");
  }

  if (savedPdf.fingerprint && currentPdf.fingerprint !== savedPdf.fingerprint) {
    reasons.push("fingerprint");
  }

  if (savedPdf.sha256 && currentPdf.sha256 !== savedPdf.sha256) {
    reasons.push("sha256");
  }

  if (!savedPdf.fingerprint && !savedPdf.sha256) {
    reasons.push("fingerprint");
  }

  return reasons;
}


function downloadJsonFile(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


function cloneRedactions(redactions) {
  return redactions.map((redaction) => ({
    ...redaction,
    rect: { ...redaction.rect },
  }));
}


function makeHistorySnapshot(redactions, selectedRedactionId) {
  return {
    redactions: cloneRedactions(redactions),
    selectedRedactionId,
  };
}


function pushLimitedHistory(stack, snapshot) {
  return [...stack, snapshot].slice(-HISTORY_LIMIT);
}


function getPageLayout(pageInfos, zoom) {
  const heights = pageInfos.map((pageInfo) => (
    Math.max(1, pageInfo.height * zoom) + PAGE_TOOLBAR_HEIGHT + PAGE_BOTTOM_GAP
  ));
  const offsets = [];
  let totalHeight = 0;

  for (const height of heights) {
    offsets.push(totalHeight);
    totalHeight += height;
  }

  return { heights, offsets, totalHeight };
}


function findPageIndexAtOffset(offsets, heights, scrollTop) {
  if (offsets.length === 0) {
    return 0;
  }

  let low = 0;
  let high = offsets.length - 1;
  let result = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= scrollTop) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (scrollTop >= offsets[result] + heights[result] && result < offsets.length - 1) {
    return result + 1;
  }

  return result;
}


function getVirtualRange(pageLayout, scrollTop, viewportHeight, pageCount) {
  if (pageCount < 1 || pageLayout.offsets.length === 0) {
    return { start: 1, end: 0 };
  }

  const firstIndex = findPageIndexAtOffset(pageLayout.offsets, pageLayout.heights, Math.max(0, scrollTop));
  const lastIndex = findPageIndexAtOffset(
    pageLayout.offsets,
    pageLayout.heights,
    Math.max(0, scrollTop + viewportHeight),
  );

  return {
    start: Math.max(1, firstIndex + 1 - VIRTUAL_PAGE_BUFFER),
    end: Math.min(pageCount, lastIndex + 1 + VIRTUAL_PAGE_BUFFER),
  };
}


function getPageBufferedRange(pageNumber, pageCount) {
  return {
    start: Math.max(1, pageNumber - VIRTUAL_PAGE_BUFFER),
    end: Math.min(pageCount, pageNumber + VIRTUAL_PAGE_BUFFER),
  };
}


function getScaledPageLocalY(pageLocalY, ratio) {
  if (pageLocalY <= PAGE_TOOLBAR_HEIGHT) {
    return pageLocalY;
  }

  return PAGE_TOOLBAR_HEIGHT + ((pageLocalY - PAGE_TOOLBAR_HEIGHT) * ratio);
}


function makeSearchPreview(text, index, length) {
  const start = Math.max(0, index - SEARCH_CONTEXT_LENGTH);
  const end = Math.min(text.length, index + length + SEARCH_CONTEXT_LENGTH);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${text.slice(start, end)}${suffix}`;
}


function getTextItemMatchRect(page, item, index, length) {
  const text = item.str || "";
  if (!text) {
    return null;
  }

  const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const viewportRect = getTextItemViewportRect(viewport, item, index, length);

  if (!viewportRect) {
    return null;
  }

  return viewportRectToPdfRect(viewport, viewportRect);
}


function getTextItemViewportRect(viewport, item, index = 0, length = null) {
  const text = item.str || "";
  if (!text) {
    return null;
  }

  const itemTransform = Array.isArray(item.transform) && item.transform.length >= 6
    ? item.transform
    : null;
  if (!itemTransform) {
    return null;
  }

  // item.transform is in PDF user-space. Convert through viewport APIs so
  // the output stays in page-stage local CSS coordinates (same basis as getLocalPoint).
  const itemWidth = Math.max(1, Number(item.width) || Math.hypot(itemTransform[0], itemTransform[1]) || text.length * 5);
  const itemHeight = Math.max(1, Number(item.height) || Math.hypot(itemTransform[2], itemTransform[3]) || 10);

  const safeIndex = clamp(index, 0, text.length);
  const safeLength = clamp(length ?? text.length, 0, text.length - safeIndex);
  const startRatio = safeIndex / text.length;
  const widthRatio = safeLength / text.length;
  const pdfX0 = itemTransform[4] + (itemWidth * startRatio);
  const pdfX1 = pdfX0 + Math.max(TEXT_SELECTION_MIN_SIZE, itemWidth * widthRatio);
  const pdfY0 = itemTransform[5];
  const pdfY1 = pdfY0 + itemHeight;
  const viewportBounds = viewport.convertToViewportRectangle([pdfX0, pdfY0, pdfX1, pdfY1]);

  if (!Array.isArray(viewportBounds) || viewportBounds.length < 4) {
    return null;
  }

  const viewportRect = normalizeRect({
    x0: viewportBounds[0] + TEXT_RECT_ALIGNMENT_OFFSET_X,
    y0: viewportBounds[1] + TEXT_RECT_ALIGNMENT_OFFSET_Y,
    x1: viewportBounds[2] + TEXT_RECT_ALIGNMENT_OFFSET_X,
    y1: viewportBounds[3] + 2 + TEXT_RECT_ALIGNMENT_OFFSET_Y,
  });

  return viewportRect;
}


function getTextItemViewportRectDebugInfo(viewport, item, index = 0, length = null) {
  const text = item.str || "";
  if (!text) {
    return null;
  }

  const itemTransform = Array.isArray(item.transform) && item.transform.length >= 6
    ? item.transform
    : null;
  if (!itemTransform) {
    return null;
  }

  const itemWidth = Math.max(1, Number(item.width) || Math.hypot(itemTransform[0], itemTransform[1]) || text.length * 5);
  const itemHeight = Math.max(1, Number(item.height) || Math.hypot(itemTransform[2], itemTransform[3]) || 10);
  const safeIndex = clamp(index, 0, text.length);
  const safeLength = clamp(length ?? text.length, 0, text.length - safeIndex);
  const startRatio = safeIndex / text.length;
  const widthRatio = safeLength / text.length;
  const pdfX0 = itemTransform[4] + (itemWidth * startRatio);
  const pdfX1 = pdfX0 + Math.max(TEXT_SELECTION_MIN_SIZE, itemWidth * widthRatio);
  const pdfY0 = itemTransform[5];
  const pdfY1 = pdfY0 + itemHeight;
  const viewportBounds = viewport.convertToViewportRectangle([pdfX0, pdfY0, pdfX1, pdfY1]);
  if (!Array.isArray(viewportBounds) || viewportBounds.length < 4) {
    return null;
  }

  const convertedRectRaw = normalizeRect({
    x0: viewportBounds[0],
    y0: viewportBounds[1],
    x1: viewportBounds[2],
    y1: viewportBounds[3],
  });
  const itemRectFinal = normalizeRect({
    x0: convertedRectRaw.x0 + TEXT_RECT_ALIGNMENT_OFFSET_X,
    y0: convertedRectRaw.y0 + TEXT_RECT_ALIGNMENT_OFFSET_Y,
    x1: convertedRectRaw.x1 + TEXT_RECT_ALIGNMENT_OFFSET_X,
    y1: convertedRectRaw.y1 + 2 + TEXT_RECT_ALIGNMENT_OFFSET_Y,
  });

  return {
    itemTransform,
    itemHeight,
    viewportScale: Number(viewport.scale) || 1,
    convertedRectRaw,
    itemRectFinal,
  };
}


/* ── Fallback: text-item based selection (used when native textLayer alignment fails) ── */


function expandViewportRect(rect, amount) {
  return {
    x0: rect.x0 - amount,
    y0: rect.y0 - amount,
    x1: rect.x1 + amount,
    y1: rect.y1 + amount,
  };
}


function estimateTextCharWeight(char) {
  if (!char) {
    return 0.6;
  }

  if (/\s/.test(char)) {
    return 0.42;
  }

  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(char)) {
    return 1.02;
  }

  if (/[A-Z]/.test(char)) {
    return 0.78;
  }

  if (/[a-z]/.test(char)) {
    return 0.68;
  }

  if (/\d/.test(char)) {
    return 0.62;
  }

  if (/[.\u00b7\u2022\u2027\u2219\u30fbㆍ·…]/.test(char)) {
    return 0.34;
  }

  if (/[,;:!'"`]/.test(char)) {
    return 0.36;
  }

  if (/[()\[\]{}]/.test(char)) {
    return 0.48;
  }

  return 0.64;
}


function splitTocTextItem(text) {
  const source = text || "";
  const leaderMatch = /[.\u00b7\u2022\u2027\u2219\u30fbㆍ·…]{3,}/.exec(source);
  const trailingNumberMatch = /(\d{1,4})\s*$/.exec(source);
  const leaderStartIndex = leaderMatch ? leaderMatch.index : -1;
  const leaderEndIndex = leaderMatch ? leaderMatch.index + leaderMatch[0].length : -1;
  const pageNumberStartIndex = trailingNumberMatch ? trailingNumberMatch.index : -1;
  const pageNumberEndIndex = trailingNumberMatch ? trailingNumberMatch.index + trailingNumberMatch[0].length : -1;
  const contentEndIndex = leaderStartIndex >= 0 ? leaderStartIndex : source.length;

  return {
    contentText: source.slice(0, contentEndIndex).trimEnd(),
    contentEndIndex,
    leaderStartIndex,
    leaderEndIndex,
    pageNumberStartIndex,
    pageNumberEndIndex,
  };
}


function buildTokenRects(itemRect, tokens, text) {
  if (!itemRect || !Array.isArray(tokens) || tokens.length === 0 || !text) {
    return {
      tokenRects: [],
      layout: {
        contentText: "",
        contentWidth: 0,
        leaderStartIndex: -1,
        tokenLayoutReason: "invalidInput",
      },
    };
  }

  const itemWidth = rectSize(itemRect).width;
  if (itemWidth <= 0) {
    return {
      tokenRects: [],
      layout: {
        contentText: "",
        contentWidth: 0,
        leaderStartIndex: -1,
        tokenLayoutReason: "invalidItemWidth",
      },
    };
  }

  const splitInfo = splitTocTextItem(text);
  const cumulativeWeights = new Array(text.length + 1).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    cumulativeWeights[i + 1] = cumulativeWeights[i] + estimateTextCharWeight(text[i]);
  }

  const totalWeight = cumulativeWeights[text.length];
  if (totalWeight <= 0) {
    return {
      tokenRects: [],
      layout: {
        contentText: splitInfo.contentText,
        contentWidth: 0,
        leaderStartIndex: splitInfo.leaderStartIndex,
        tokenLayoutReason: "invalidTotalWeight",
      },
    };
  }

  const contentEndIndex = clamp(splitInfo.contentEndIndex, 0, text.length);
  const contentWeight = cumulativeWeights[contentEndIndex] - cumulativeWeights[0];
  const hasLeader = splitInfo.leaderStartIndex >= 0;
  const usableWeight = hasLeader ? Math.max(0, contentWeight) : totalWeight;
  const usableWidth = hasLeader
    ? itemWidth * (usableWeight / totalWeight)
    : itemWidth;
  const scale = usableWeight > 0 ? usableWidth / usableWeight : 0;

  const tokenRects = tokens
    .filter((token) => {
      if (token.kind === "dotLeader" || token.kind === "pageNumber") {
        return false;
      }
      if (hasLeader && token.startIndex >= splitInfo.leaderStartIndex) {
        return false;
      }
      return true;
    })
    .map((token) => {
    const safeStart = clamp(token.startIndex, 0, text.length);
    const safeEnd = clamp(token.endIndex, safeStart, text.length);
    const startWeight = cumulativeWeights[safeStart] - cumulativeWeights[0];
    const endWeight = cumulativeWeights[safeEnd] - cumulativeWeights[0];
    const tokenX0 = itemRect.x0 + (startWeight * scale);
    const tokenX1 = itemRect.x0 + (endWeight * scale);

    return {
      ...token,
      tokenRect: normalizeRect({
        x0: tokenX0,
        y0: itemRect.y0,
        x1: Math.max(tokenX0 + TEXT_SELECTION_MIN_SIZE, tokenX1),
        y1: itemRect.y1,
      }),
    };
  });

  return {
    tokenRects,
    layout: {
      contentText: splitInfo.contentText,
      contentWidth: usableWidth,
      leaderStartIndex: splitInfo.leaderStartIndex,
      tokenLayoutReason: hasLeader ? "contentBeforeLeader" : "fullTextNoLeader",
    },
  };
}


function getAnchorTextSelectionRect(anchor, current) {
  const rect = normalizeRect({
    x0: anchor.x,
    y0: anchor.y,
    x1: current.x,
    y1: current.y,
  });

  return {
    x0: rect.x0 - TEXT_SELECTION_ANCHOR_TOLERANCE,
    x1: rect.x1 + TEXT_SELECTION_ANCHOR_TOLERANCE,
    y0: rect.y0 - 8,
    y1: rect.y1 + 8,
  };
}


function getViewportRectIntersectionArea(rectA, rectB) {
  const x0 = Math.max(rectA.x0, rectB.x0);
  const y0 = Math.max(rectA.y0, rectB.y0);
  const x1 = Math.min(rectA.x1, rectB.x1);
  const y1 = Math.min(rectA.y1, rectB.y1);

  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}


function isViewportGlyphSelected(selectionRect, glyphRect) {
  const glyphSize = rectSize(glyphRect);
  if (glyphSize.width <= 0 || glyphSize.height <= 0) {
    return false;
  }

  const centerX = (glyphRect.x0 + glyphRect.x1) / 2;
  const centerY = (glyphRect.y0 + glyphRect.y1) / 2;
  const centerInside = centerX >= selectionRect.x0
    && centerX <= selectionRect.x1
    && centerY >= selectionRect.y0
    && centerY <= selectionRect.y1;
  if (centerInside) {
    return true;
  }

  const overlapArea = getViewportRectIntersectionArea(selectionRect, glyphRect);
  const glyphArea = glyphSize.width * glyphSize.height;
  return glyphArea > 0 && (overlapArea / glyphArea) >= 0.25;
}


function unionRects(rects) {
  return normalizeRect({
    x0: Math.min(...rects.map((rect) => rect.x0)),
    y0: Math.min(...rects.map((rect) => rect.y0)),
    x1: Math.max(...rects.map((rect) => rect.x1)),
    y1: Math.max(...rects.map((rect) => rect.y1)),
  });
}


function shouldSplitTextGlyphRun(previousGlyph, currentGlyph) {
  if (previousGlyph.lineIndex !== currentGlyph.lineIndex) {
    return true;
  }

  const previousRect = previousGlyph.viewportRect;
  const currentRect = currentGlyph.viewportRect;
  const previousHeight = rectSize(previousRect).height;
  const currentHeight = rectSize(currentRect).height;
  const centerDistance = Math.abs(
    ((previousRect.y0 + previousRect.y1) / 2) - ((currentRect.y0 + currentRect.y1) / 2),
  );
  if (centerDistance > Math.max(previousHeight, currentHeight) * 0.7) {
    return true;
  }

  const gap = currentRect.x0 - previousRect.x1;
  const maxGap = Math.max(4, Math.max(previousHeight, currentHeight) * 0.8);
  return gap > maxGap;
}


function getSelectedTextGlyphRuns(viewportGlyphs, selectionRect) {
  const selectedGlyphs = viewportGlyphs
    .filter((glyph) => glyph.selectable && isViewportGlyphSelected(selectionRect, glyph.viewportRect))
    .sort((a, b) => (
      a.lineIndex - b.lineIndex
      || a.viewportRect.x0 - b.viewportRect.x0
      || a.charIndex - b.charIndex
    ));
  const runs = [];
  let current = [];

  const closeRun = () => {
    if (current.length === 0) {
      return;
    }

    runs.push({
      text: current.map((glyph) => glyph.text).join(""),
      viewportRect: unionRects(current.map((glyph) => glyph.viewportRect)),
      pdfRect: roundRect(unionRects(current.map((glyph) => glyph.rect))),
    });
    current = [];
  };

  for (const glyph of selectedGlyphs) {
    const previous = current[current.length - 1];
    if (previous && shouldSplitTextGlyphRun(previous, glyph)) {
      closeRun();
    }
    current.push(glyph);
  }

  closeRun();
  return runs;
}


function getTextItemOverlapRange(selectionRect, itemRect, textLength, text = "", viewport = null, item = null) {
  const logReject = () => {};

  if (!textLength || textLength <= 0) {
    logReject("invalidTextLength");
    return null;
  }

  const itemSize = rectSize(itemRect);
  if (itemSize.width <= 0 || itemSize.height <= 0) {
    logReject("invalidItemSize");
    return null;
  }

  const itemCenterY = (itemRect.y0 + itemRect.y1) / 2;
  const selectionCenterY = (selectionRect.y0 + selectionRect.y1) / 2;
  const centerDistance = Math.abs(selectionCenterY - itemCenterY);
  const maxCenterDistance = itemSize.height * 0.75;

  if (centerDistance > maxCenterDistance) {
    logReject("centerDistanceTooFar", {
      centerDistance,
      maxCenterDistance,
    });
    return null;
  }

  const verticalOverlap = Math.min(selectionRect.y1, itemRect.y1) - Math.max(selectionRect.y0, itemRect.y0);
  const horizontalOverlap = Math.min(selectionRect.x1, itemRect.x1) - Math.max(selectionRect.x0, itemRect.x0);

  if (verticalOverlap <= 0) {
    logReject("noVerticalOverlap", {
      verticalOverlap,
      horizontalOverlap,
      verticalOverlapRatio: itemSize.height > 0 ? verticalOverlap / itemSize.height : null,
    });
    return null;
  }

  if (horizontalOverlap <= 0) {
    logReject("noHorizontalOverlap", {
      verticalOverlap,
      horizontalOverlap,
      verticalOverlapRatio: itemSize.height > 0 ? verticalOverlap / itemSize.height : null,
    });
    return null;
  }

  const verticalOverlapRatio = verticalOverlap / itemSize.height;
  if (verticalOverlapRatio < 0.35) {
    logReject("verticalRatioTooSmall", {
      verticalOverlap,
      horizontalOverlap,
      verticalOverlapRatio,
    });
    return null;
  }

  const overlapX0 = clamp(Math.max(selectionRect.x0, itemRect.x0), itemRect.x0, itemRect.x1);
  const overlapX1 = clamp(Math.min(selectionRect.x1, itemRect.x1), itemRect.x0, itemRect.x1);
  let rawStartIndex = Math.floor(((overlapX0 - itemRect.x0) / itemSize.width) * textLength);
  let rawEndIndex = Math.ceil(((overlapX1 - itemRect.x0) / itemSize.width) * textLength);

  rawStartIndex = clamp(rawStartIndex, 0, textLength - 1);
  rawEndIndex = clamp(rawEndIndex, rawStartIndex + 1, textLength);
  const rawSegmentText = text.slice(rawStartIndex, rawEndIndex);

  let adjustedStartIndex = rawStartIndex;
  let adjustedEndIndex = rawEndIndex;
  let adjustedSegmentText = rawSegmentText;
  let xAdjustReason = ENABLE_TEXT_X_WHITESPACE_TRIM ? "rawIndex" : "rawIndex";
  let tokenHitText = null;
  let tokenHitStartIndex = null;
  let tokenHitEndIndex = null;
  let tokenHitOverlap = 0;
  let tokenHitRectX0 = null;
  let tokenHitRectX1 = null;
  let tokenHitReason = "tokenFallbackRaw";
  let contentText = null;
  let contentWidth = null;
  let leaderStartIndex = null;
  let tokenLayoutReason = null;

  if (viewport && item) {
    const tokens = tokenizeTextItem(text);
    const tokenLayout = buildTokenRects(itemRect, tokens, text);
    const tokenRects = tokenLayout.tokenRects;
    contentText = tokenLayout.layout.contentText;
    contentWidth = tokenLayout.layout.contentWidth;
    leaderStartIndex = tokenLayout.layout.leaderStartIndex;
    tokenLayoutReason = tokenLayout.layout.tokenLayoutReason;
    const tokenCandidates = [];

    for (const token of tokenRects) {
      const tokenRect = token.tokenRect;
      if (!tokenRect) {
        continue;
      }

      const tokenHorizontalOverlap = Math.min(selectionRect.x1, tokenRect.x1) - Math.max(selectionRect.x0, tokenRect.x0);
      const tokenVerticalOverlap = Math.min(selectionRect.y1, tokenRect.y1) - Math.max(selectionRect.y0, tokenRect.y0);
      if (tokenHorizontalOverlap <= 0 || tokenVerticalOverlap <= 0) {
        continue;
      }

      const tokenCenterX = (tokenRect.x0 + tokenRect.x1) / 2;
      const selectionCenterX = (selectionRect.x0 + selectionRect.x1) / 2;
      tokenCandidates.push({
        ...token,
        tokenRect,
        horizontalOverlap: tokenHorizontalOverlap,
        verticalOverlap: tokenVerticalOverlap,
        centerDistanceX: Math.abs(selectionCenterX - tokenCenterX),
      });
    }

    if (tokenCandidates.length > 0) {
      tokenCandidates.sort((a, b) => {
        if (Math.abs(b.horizontalOverlap - a.horizontalOverlap) > 0.001) {
          return b.horizontalOverlap - a.horizontalOverlap;
        }
        return a.centerDistanceX - b.centerDistanceX;
      });

      const maxOverlap = tokenCandidates[0].horizontalOverlap;
      const includedTokens = tokenCandidates
        .filter((candidate) => candidate.horizontalOverlap >= Math.max(1, maxOverlap * 0.28))
        .sort((a, b) => a.startIndex - b.startIndex);

      if (includedTokens.length > 0) {
        const firstToken = includedTokens[0];
        const lastToken = includedTokens[includedTokens.length - 1];
        adjustedStartIndex = firstToken.startIndex;
        adjustedEndIndex = lastToken.endIndex;
        adjustedSegmentText = text.slice(adjustedStartIndex, adjustedEndIndex);
        tokenHitText = includedTokens.map((token) => token.text).join(" ");
        tokenHitStartIndex = adjustedStartIndex;
        tokenHitEndIndex = adjustedEndIndex;
        tokenHitOverlap = maxOverlap;
        tokenHitRectX0 = Number(firstToken.tokenRect.x0.toFixed(2));
        tokenHitRectX1 = Number(lastToken.tokenRect.x1.toFixed(2));
        tokenHitReason = includedTokens.length > 1 ? "tokenMultiHit" : "tokenSingleHit";
        xAdjustReason = "tokenHit";
      }
    }
  }

  if (
    adjustedEndIndex <= adjustedStartIndex
    || !adjustedSegmentText.trim()
    || adjustedSegmentText.trim().length < 1
  ) {
    adjustedStartIndex = rawStartIndex;
    adjustedEndIndex = rawEndIndex;
    adjustedSegmentText = text.slice(adjustedStartIndex, adjustedEndIndex);
    xAdjustReason = "fallbackToRaw";
    tokenHitReason = "tokenFallbackRaw";
  }

  return {
    startIndex: adjustedStartIndex,
    endIndex: adjustedEndIndex,
    rawStartIndex,
    rawEndIndex,
    adjustedStartIndex,
    adjustedEndIndex,
    rawSegmentText,
    adjustedSegmentText,
    xAdjustReason,
    tokenHitText,
    tokenHitStartIndex,
    tokenHitEndIndex,
    tokenHitOverlap,
    tokenHitRectX0,
    tokenHitRectX1,
    tokenHitReason,
    contentText,
    contentWidth,
    leaderStartIndex,
    tokenLayoutReason,
  };
}


function getViewportRectCenterY(rect) {
  return (rect.y0 + rect.y1) / 2;
}


function getTextSegmentKind(text) {
  const normalized = (text || "").trim();
  if (!normalized) {
    return "empty";
  }

  if (/^[.\u00b7\u2022\u2027\u2219\u30fbㆍ·…]+$/.test(normalized)) {
    return "dotLeader";
  }

  if (/^\d{1,4}$/.test(normalized)) {
    return "pageNumber";
  }

  return "text";
}


function tokenizeTextItem(text) {
  const source = text || "";
  const tokens = [];
  const pattern = /[.\u00b7\u2022\u2027\u2219\u30fbㆍ·…]+|\d+|[^\s.\u00b7\u2022\u2027\u2219\u30fbㆍ·…]+/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const tokenText = match[0];
    const startIndex = match.index;
    const endIndex = match.index + tokenText.length;
    tokens.push({
      text: tokenText,
      startIndex,
      endIndex,
      kind: getTextSegmentKind(tokenText),
    });
  }

  return tokens;
}


function makeTextSelectionSegment(viewport, item, startIndex, endIndex, itemIndex) {
  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  const text = (item.str || "").slice(startIndex, endIndex);
  const viewportRect = getTextItemViewportRect(viewport, item, startIndex, endIndex - startIndex);
  if (!viewportRect) {
    return null;
  }

  const size = rectSize(viewportRect);
  if (size.width < TEXT_SELECTION_MIN_SIZE || size.height < TEXT_SELECTION_MIN_SIZE) {
    return null;
  }

  return {
    key: `${itemIndex}:${startIndex}:${endIndex}`,
    text,
    kind: getTextSegmentKind(text),
    viewportRect,
    centerY: getViewportRectCenterY(viewportRect),
    height: size.height,
  };
}


function collectSelectedTextSegments(viewport, textItems, selectionRect, debugContext = null) {
  const segments = [];
  const debugRows = import.meta.env.DEV && ENABLE_TEXT_ITEM_TABLE_DEBUG ? [] : null;
  const selectionCenterY = (selectionRect.y0 + selectionRect.y1) / 2;

  for (let itemIndex = 0; itemIndex < textItems.length; itemIndex += 1) {
    const item = textItems[itemIndex];
    const text = item.str || "";
    const visualLineText = text.trim();
    let itemRect = null;
    let itemDebugInfo = null;
    let verticalOverlapRatio = null;
    let overlapX0 = null;
    let overlapX1 = null;
    let debugStartIndex = null;
    let debugEndIndex = null;
    let selected = false;
    let overlapRange = null;
    let segment = null;
    let rejectReason = "selected";

    if (!text.trim()) {
      rejectReason = "emptyText";
      if (debugRows) {
        debugRows.push({
          text,
          itemRect: null,
          selectionRect: `${selectionRect.x0.toFixed(2)}, ${selectionRect.y0.toFixed(2)}, ${selectionRect.x1.toFixed(2)}, ${selectionRect.y1.toFixed(2)}`,
          verticalOverlapRatio: null,
          overlapX0: null,
          overlapX1: null,
          overlapRangeExists: false,
          overlapRangeStartIndex: null,
          overlapRangeEndIndex: null,
          debugStartIndex: null,
          debugEndIndex: null,
          segmentExists: false,
          segmentText: null,
          segmentKind: null,
          startIndex: null,
          endIndex: null,
          selected: false,
          rejectReason,
        });
      }
      continue;
    }

    itemDebugInfo = getTextItemViewportRectDebugInfo(viewport, item, 0, text.length);
    itemRect = itemDebugInfo?.itemRectFinal || null;
    if (!itemRect) {
      rejectReason = "noItemRect";
      if (debugRows) {
        debugRows.push({
          text,
          itemRect: null,
          selectionRect: `${selectionRect.x0.toFixed(2)}, ${selectionRect.y0.toFixed(2)}, ${selectionRect.x1.toFixed(2)}, ${selectionRect.y1.toFixed(2)}`,
          verticalOverlapRatio: null,
          overlapX0: null,
          overlapX1: null,
          overlapRangeExists: false,
          overlapRangeStartIndex: null,
          overlapRangeEndIndex: null,
          debugStartIndex: null,
          debugEndIndex: null,
          segmentExists: false,
          segmentText: null,
          segmentKind: null,
          startIndex: null,
          endIndex: null,
          selected: false,
          rejectReason,
        });
      }
      continue;
    }

    const itemCenterY = (itemRect.y0 + itemRect.y1) / 2;
    const centerDistance = Math.abs(selectionCenterY - itemCenterY);

    const itemSize = rectSize(itemRect);
    const verticalOverlap = Math.min(selectionRect.y1, itemRect.y1) - Math.max(selectionRect.y0, itemRect.y0);
    const horizontalOverlap = Math.min(selectionRect.x1, itemRect.x1) - Math.max(selectionRect.x0, itemRect.x0);
    verticalOverlapRatio = itemSize.height > 0 ? verticalOverlap / itemSize.height : null;

    if (text.length > 0 && itemSize.width > 0 && verticalOverlap > 0 && horizontalOverlap > 0) {
      overlapX0 = clamp(Math.max(selectionRect.x0, itemRect.x0), itemRect.x0, itemRect.x1);
      overlapX1 = clamp(Math.min(selectionRect.x1, itemRect.x1), itemRect.x0, itemRect.x1);
      debugStartIndex = Math.floor(((overlapX0 - itemRect.x0) / itemSize.width) * text.length);
      debugEndIndex = Math.ceil(((overlapX1 - itemRect.x0) / itemSize.width) * text.length);
      debugStartIndex = clamp(debugStartIndex, 0, text.length - 1);
      debugEndIndex = clamp(debugEndIndex, debugStartIndex + 1, text.length);
    }

    overlapRange = getTextItemOverlapRange(selectionRect, itemRect, text.length, text, viewport, item);
    if (overlapRange) {
      segment = makeTextSelectionSegment(
        viewport,
        item,
        overlapRange.startIndex,
        overlapRange.endIndex,
        itemIndex,
      );
      if (!segment) {
        rejectReason = "noSegment";
      } else if (segment.kind === "dotLeader" || segment.kind === "pageNumber") {
        rejectReason = `ignoredKind:${segment.kind}`;
      } else {
        segments.push(segment);
        selected = true;
        rejectReason = "selected";
      }
    } else {
      rejectReason = "noOverlapRange";
    }

    const horizontalNear = selectionRect.x1 >= (itemRect.x0 - 24) && selectionRect.x0 <= (itemRect.x1 + 24);
    const sameLineNear = centerDistance <= (Math.max(itemSize.height, 1) * 1.5);
    const shouldLogSelectionDecision = import.meta.env.DEV && horizontalNear && sameLineNear;

    if (shouldLogSelectionDecision) {
      console.log("[SEGMENT_DECISION_DEBUG]", {
        text,
        overlapRangeExists: !!overlapRange,
        overlapRangeStartIndex: overlapRange ? overlapRange.startIndex : null,
        overlapRangeEndIndex: overlapRange ? overlapRange.endIndex : null,
        rawStartIndex: overlapRange ? overlapRange.rawStartIndex : null,
        rawEndIndex: overlapRange ? overlapRange.rawEndIndex : null,
        adjustedStartIndex: overlapRange ? overlapRange.adjustedStartIndex : null,
        adjustedEndIndex: overlapRange ? overlapRange.adjustedEndIndex : null,
        rawSegmentText: overlapRange ? overlapRange.rawSegmentText : null,
        adjustedSegmentText: overlapRange ? overlapRange.adjustedSegmentText : null,
        xAdjustReason: overlapRange ? overlapRange.xAdjustReason : null,
        tokenHitText: overlapRange ? overlapRange.tokenHitText : null,
        tokenHitStartIndex: overlapRange ? overlapRange.tokenHitStartIndex : null,
        tokenHitEndIndex: overlapRange ? overlapRange.tokenHitEndIndex : null,
        tokenHitOverlap: overlapRange ? overlapRange.tokenHitOverlap : null,
        tokenHitRectX0: overlapRange ? overlapRange.tokenHitRectX0 : null,
        tokenHitRectX1: overlapRange ? overlapRange.tokenHitRectX1 : null,
        tokenHitReason: overlapRange ? overlapRange.tokenHitReason : null,
        contentText: overlapRange ? overlapRange.contentText : null,
        contentWidth: overlapRange ? overlapRange.contentWidth : null,
        leaderStartIndex: overlapRange ? overlapRange.leaderStartIndex : null,
        tokenLayoutReason: overlapRange ? overlapRange.tokenLayoutReason : null,
        segmentExists: !!segment,
        segmentText: segment ? segment.text : null,
        segmentKind: segment ? segment.kind : null,
        selected,
        rejectReason,
      });

      const rawStartIndexForDebug = overlapRange
        ? (Number.isFinite(overlapRange.rawStartIndex) ? overlapRange.rawStartIndex : overlapRange.startIndex)
        : debugStartIndex;
      const rawEndIndexForDebug = overlapRange
        ? (Number.isFinite(overlapRange.rawEndIndex) ? overlapRange.rawEndIndex : overlapRange.endIndex)
        : debugEndIndex;
      const rawSegmentTextForDebug = (
        Number.isFinite(rawStartIndexForDebug)
        && Number.isFinite(rawEndIndexForDebug)
        && rawEndIndexForDebug > rawStartIndexForDebug
      )
        ? text.slice(rawStartIndexForDebug, rawEndIndexForDebug)
        : null;

      console.log("[TEXT_X_HIT_DEBUG]", {
        text,
        selectionRect,
        itemRect,
        itemWidth: Number(item?.width) || null,
        itemRectWidth: rectSize(itemRect).width,
        itemTextLength: text.length,
        horizontalOverlap,
        overlapX0,
        overlapX1,
        rawStartIndex: rawStartIndexForDebug,
        rawEndIndex: rawEndIndexForDebug,
        rawSegmentText: rawSegmentTextForDebug,
        tokenHitText: overlapRange ? overlapRange.tokenHitText : null,
        tokenRectX0: overlapRange ? overlapRange.tokenHitRectX0 : null,
        tokenRectX1: overlapRange ? overlapRange.tokenHitRectX1 : null,
        contentText: overlapRange ? overlapRange.contentText : null,
        contentWidth: overlapRange ? overlapRange.contentWidth : null,
        leaderStartIndex: overlapRange ? overlapRange.leaderStartIndex : null,
        tokenLayoutReason: overlapRange ? overlapRange.tokenLayoutReason : null,
        rejectReason,
        dragStart: debugContext?.dragStart ?? null,
        dragCurrent: debugContext?.dragCurrent ?? null,
      });
    }

    if (debugRows) {
      debugRows.push({
        text,
        itemRect: `${itemRect.x0.toFixed(2)}, ${itemRect.y0.toFixed(2)}, ${itemRect.x1.toFixed(2)}, ${itemRect.y1.toFixed(2)}`,
        selectionRect: `${selectionRect.x0.toFixed(2)}, ${selectionRect.y0.toFixed(2)}, ${selectionRect.x1.toFixed(2)}, ${selectionRect.y1.toFixed(2)}`,
        verticalOverlapRatio: verticalOverlapRatio === null ? null : Number(verticalOverlapRatio.toFixed(4)),
        overlapX0: overlapX0 === null ? null : Number(overlapX0.toFixed(2)),
        overlapX1: overlapX1 === null ? null : Number(overlapX1.toFixed(2)),
        overlapRangeExists: !!overlapRange,
        overlapRangeStartIndex: overlapRange ? overlapRange.startIndex : null,
        overlapRangeEndIndex: overlapRange ? overlapRange.endIndex : null,
        rawStartIndex: overlapRange ? overlapRange.rawStartIndex : null,
        rawEndIndex: overlapRange ? overlapRange.rawEndIndex : null,
        adjustedStartIndex: overlapRange ? overlapRange.adjustedStartIndex : null,
        adjustedEndIndex: overlapRange ? overlapRange.adjustedEndIndex : null,
        rawSegmentText: overlapRange ? overlapRange.rawSegmentText : null,
        adjustedSegmentText: overlapRange ? overlapRange.adjustedSegmentText : null,
        xAdjustReason: overlapRange ? overlapRange.xAdjustReason : null,
        tokenHitText: overlapRange ? overlapRange.tokenHitText : null,
        tokenHitStartIndex: overlapRange ? overlapRange.tokenHitStartIndex : null,
        tokenHitEndIndex: overlapRange ? overlapRange.tokenHitEndIndex : null,
        tokenHitOverlap: overlapRange ? overlapRange.tokenHitOverlap : null,
        tokenHitRectX0: overlapRange ? overlapRange.tokenHitRectX0 : null,
        tokenHitRectX1: overlapRange ? overlapRange.tokenHitRectX1 : null,
        tokenHitReason: overlapRange ? overlapRange.tokenHitReason : null,
        contentText: overlapRange ? overlapRange.contentText : null,
        contentWidth: overlapRange ? overlapRange.contentWidth : null,
        leaderStartIndex: overlapRange ? overlapRange.leaderStartIndex : null,
        tokenLayoutReason: overlapRange ? overlapRange.tokenLayoutReason : null,
        debugStartIndex,
        debugEndIndex,
        segmentExists: !!segment,
        segmentText: segment ? segment.text : null,
        segmentKind: segment ? segment.kind : null,
        startIndex: debugStartIndex,
        endIndex: debugEndIndex,
        selected,
        rejectReason,
      });
    }
  }

  if (debugRows) {
    console.groupCollapsed("[TEXT_ITEM_OVERLAP_DEBUG]");
    console.table(debugRows);
    console.groupEnd();
  }

  return segments;
}


function groupTextSegmentsByLine(segments) {
  const lines = [];
  const sortedSegments = [...segments].sort((a, b) => (
    Math.abs(a.centerY - b.centerY) > 0.001
      ? a.centerY - b.centerY
      : a.viewportRect.x0 - b.viewportRect.x0
  ));

  for (const segment of sortedSegments) {
    const line = lines.find((candidate) => {
      const maxHeight = Math.max(candidate.averageHeight, segment.height);
      const heightDiff = Math.abs(candidate.averageHeight - segment.height);

      return Math.abs(candidate.centerY - segment.centerY) <= maxHeight * TEXT_SELECTION_LINE_CENTER_RATIO
        && heightDiff <= maxHeight * 0.75;
    });

    if (line) {
      line.segments.push(segment);
      const count = line.segments.length;
      line.centerY = ((line.centerY * (count - 1)) + segment.centerY) / count;
      line.averageHeight = ((line.averageHeight * (count - 1)) + segment.height) / count;
    } else {
      lines.push({
        centerY: segment.centerY,
        averageHeight: segment.height,
        segments: [segment],
      });
    }
  }

  return lines;
}


function shouldMergeTextSegments(previous, next, lineHeight) {
  if (!previous || !next) {
    return false;
  }

  const protectedKinds = new Set(["dotLeader", "pageNumber"]);
  if (
    previous.kind !== next.kind
    && (protectedKinds.has(previous.kind) || protectedKinds.has(next.kind))
  ) {
    return false;
  }

  const gap = next.viewportRect.x0 - previous.viewportRect.x1;
  if (gap <= 0) {
    return true;
  }

  const mergeGap = clamp(
    lineHeight * TEXT_SELECTION_MERGE_GAP_RATIO,
    TEXT_SELECTION_MERGE_MIN_GAP,
    TEXT_SELECTION_MERGE_MAX_GAP,
  );

  return gap <= mergeGap;
}


function mergeViewportRects(rects) {
  return normalizeRect({
    x0: Math.min(...rects.map((rect) => rect.x0)),
    y0: Math.min(...rects.map((rect) => rect.y0)),
    x1: Math.max(...rects.map((rect) => rect.x1)),
    y1: Math.max(...rects.map((rect) => rect.y1)),
  });
}


function makeMergedTextViewportRect(group, line, viewport) {
  const rawRect = mergeViewportRects(group.map((segment) => segment.viewportRect));
  const groupHeight = group.reduce((sum, segment) => sum + segment.height, 0) / group.length;
  const visualHeight = Math.max(groupHeight, line.averageHeight);
  const displayPaddingY = clamp(
    visualHeight * TEXT_SELECTION_VERTICAL_PADDING_RATIO,
    TEXT_SELECTION_VERTICAL_PADDING_MIN,
    TEXT_SELECTION_VERTICAL_PADDING_MAX,
  );
  const displayPaddingX = clamp(
    line.averageHeight * TEXT_SELECTION_HORIZONTAL_PADDING_RATIO,
    TEXT_SELECTION_HORIZONTAL_PADDING_MIN,
    TEXT_SELECTION_HORIZONTAL_PADDING_MAX,
  );
  const redactionPaddingY = clamp(
    visualHeight * TEXT_REDACTION_VERTICAL_PADDING_RATIO,
    TEXT_REDACTION_VERTICAL_PADDING_MIN,
    TEXT_REDACTION_VERTICAL_PADDING_MAX,
  );
  const redactionPaddingX = clamp(
    line.averageHeight * TEXT_REDACTION_HORIZONTAL_PADDING_RATIO,
    TEXT_REDACTION_HORIZONTAL_PADDING_MIN,
    TEXT_REDACTION_HORIZONTAL_PADDING_MAX,
  );
  const centerY = group.reduce((sum, segment) => sum + segment.centerY, 0) / group.length;



  return {
    displayRect: normalizeRect({
      x0: clamp(rawRect.x0 - displayPaddingX, 0, viewport.width),
      y0: clamp(centerY - (visualHeight / 2) - displayPaddingY, 0, viewport.height),
      x1: clamp(rawRect.x1 + displayPaddingX, 0, viewport.width),
      y1: clamp(centerY + (visualHeight / 2) + displayPaddingY, 0, viewport.height),
    }),
    redactionRect: normalizeRect({
      x0: clamp(rawRect.x0 - redactionPaddingX, 0, viewport.width),
      y0: clamp(rawRect.y0 - redactionPaddingY, 0, viewport.height),
      x1: clamp(rawRect.x1 + redactionPaddingX, 0, viewport.width),
      y1: clamp(rawRect.y1 + redactionPaddingY, 0, viewport.height),
    }),
  };
}


function mergeSelectedTextSegments(viewport, segments) {
  const mergedSelections = [];
  const lines = groupTextSegmentsByLine(segments);

  if (import.meta.env.DEV) {
    console.groupCollapsed("[SELECTED_SEGMENTS_DEBUG]");
    console.table(segments.map((segment, index) => {
      const size = rectSize(segment.viewportRect);
      return {
        index,
        text: segment.text,
        kind: segment.kind,
        x0: segment.viewportRect.x0.toFixed(2),
        y0: segment.viewportRect.y0.toFixed(2),
        x1: segment.viewportRect.x1.toFixed(2),
        y1: segment.viewportRect.y1.toFixed(2),
        width: size.width.toFixed(2),
        height: size.height.toFixed(2),
        centerY: segment.centerY.toFixed(2),
      };
    }));
    console.groupEnd();
  }

  for (const line of lines) {
    const lineSegments = [...line.segments].sort((a, b) => a.viewportRect.x0 - b.viewportRect.x0);
    let group = [];

    const closeGroup = () => {
      if (group.length === 0) {
        return;
      }

      mergedSelections.push(makeMergedTextViewportRect(group, line, viewport));
      group = [];
    };

    for (const segment of lineSegments) {
      const previous = group[group.length - 1];
      if (previous && !shouldMergeTextSegments(previous, segment, line.averageHeight)) {
        closeGroup();
      }

      group.push(segment);
    }

    closeGroup();
  }

  return mergedSelections;
}


function getAnchorTextSelections(viewport, textItems, anchor, current, debugContext = null) {
  if (!viewport || !anchor || !current) {
    return [];
  }

  const selectionRect = getAnchorTextSelectionRect(anchor, current);
  const selectedSegments = collectSelectedTextSegments(
    viewport,
    textItems,
    selectionRect,
    debugContext,
  );

  const merged = mergeSelectedTextSegments(viewport, selectedSegments);

  return merged;
}


function getTextSelectionRedactions(viewport, textSelections, pageNumber) {
  return textSelections.map((selection) => ({
    id: makeId(),
    page: pageNumber,
    type: MARKING_MODE_TEXT,
    rect: viewportRectToPdfRect(viewport, selection.redactionRect),
  }));
}


function getLocalSelectionRectsFromTextLayer(textLayerElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !textLayerElement) {
    return [];
  }

  const bounds = textLayerElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return [];
  }

  const rects = [];
  for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
    const range = selection.getRangeAt(rangeIndex);
    const clientRects = Array.from(range.getClientRects());

    for (const clientRect of clientRects) {
      if (clientRect.width <= 0 || clientRect.height <= 0) {
        continue;
      }

      if (
        clientRect.right <= bounds.left
        || clientRect.left >= bounds.right
        || clientRect.bottom <= bounds.top
        || clientRect.top >= bounds.bottom
      ) {
        continue;
      }

      const localRect = normalizeRect({
        x0: clamp(clientRect.left - bounds.left, 0, bounds.width),
        y0: clamp(clientRect.top - bounds.top, 0, bounds.height),
        x1: clamp(clientRect.right - bounds.left, 0, bounds.width),
        y1: clamp(clientRect.bottom - bounds.top, 0, bounds.height),
      });
      const size = rectSize(localRect);

      if (size.width < TEXT_SELECTION_MIN_SIZE || size.height < TEXT_SELECTION_MIN_SIZE) {
        continue;
      }

      rects.push(localRect);
    }
  }

  return rects;
}


function getNativeTextSelections(viewport, textLayerElement, providedLocalRects = null) {
  const localRects = Array.isArray(providedLocalRects)
    ? providedLocalRects
    : getLocalSelectionRectsFromTextLayer(textLayerElement);
  if (localRects.length === 0) {
    return [];
  }

  const segments = localRects.map((viewportRect, index) => {
    const size = rectSize(viewportRect);

    return {
      key: `native:${index}`,
      text: "",
      kind: "text",
      viewportRect,
      centerY: getViewportRectCenterY(viewportRect),
      height: size.height,
    };
  });

  return mergeSelectedTextSegments(viewport, segments);
}


function getTextLayerKeywordSpanMatches(textLayerElement, keywords = TEXT_LAYER_DEBUG_KEYWORDS) {
  if (!textLayerElement) {
    return [];
  }

  const layerBounds = textLayerElement.getBoundingClientRect();
  const spans = Array.from(textLayerElement.querySelectorAll("span"));

  return spans
    .map((span) => {
      const text = span.textContent || "";
      if (!keywords.some((keyword) => text.includes(keyword))) {
        return null;
      }

      const rect = span.getBoundingClientRect();
      const left = rect.left - layerBounds.left;
      const right = rect.right - layerBounds.left;

      return {
        text,
        left: Number(left.toFixed(2)),
        right: Number(right.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
      };
    })
    .filter(Boolean);
}


function getTextLayerVisualDebugRects(textLayerElement, keywords = TEXT_LAYER_DEBUG_KEYWORDS) {
  if (!textLayerElement) {
    return [];
  }

  const layerBounds = textLayerElement.getBoundingClientRect();
  if (layerBounds.width <= 0 || layerBounds.height <= 0) {
    return [];
  }

  const spans = Array.from(textLayerElement.querySelectorAll("span"));

  return spans
    .map((span, index) => {
      const rect = span.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      const text = span.textContent || "";
      const localRect = normalizeRect({
        x0: clamp(rect.left - layerBounds.left, 0, layerBounds.width),
        y0: clamp(rect.top - layerBounds.top, 0, layerBounds.height),
        x1: clamp(rect.right - layerBounds.left, 0, layerBounds.width),
        y1: clamp(rect.bottom - layerBounds.top, 0, layerBounds.height),
      });
      const size = rectSize(localRect);
      if (size.width <= 0 || size.height <= 0) {
        return null;
      }

      const isKeyword = keywords.some((keyword) => text.includes(keyword));

      return {
        key: `${index}`,
        kind: isKeyword ? "keyword" : "line",
        rect: localRect,
        text,
      };
    })
    .filter(Boolean);
}


function isRectOnSelectionLine(rect, selectionRects) {
  if (!Array.isArray(selectionRects) || selectionRects.length === 0) {
    return false;
  }

  const rectCenterY = (rect.y0 + rect.y1) / 2;

  return selectionRects.some((selectionRect) => {
    const verticalOverlap = Math.min(rect.y1, selectionRect.y1) - Math.max(rect.y0, selectionRect.y0);
    if (verticalOverlap > 0) {
      return true;
    }

    const selectionCenterY = (selectionRect.y0 + selectionRect.y1) / 2;
    const tolerance = Math.max(2, rectSize(rect).height * 0.45);
    return Math.abs(rectCenterY - selectionCenterY) <= tolerance;
  });
}


function logTextLayerDomDebug(textLayerElement) {
  if (!import.meta.env.DEV || !textLayerElement) {
    return;
  }

  const spans = Array.from(textLayerElement.querySelectorAll("span"));
  const layerBounds = textLayerElement.getBoundingClientRect();
  const keywords = TEXT_LAYER_DEBUG_KEYWORDS;

  const toRow = (span, index) => {
    const rect = span.getBoundingClientRect();
    return {
      index,
      text: span.textContent || "",
      left: Number((rect.left - layerBounds.left).toFixed(2)),
      right: Number((rect.right - layerBounds.left).toFixed(2)),
      top: Number((rect.top - layerBounds.top).toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2)),
      transform: span.style.transform || "",
    };
  };

  const firstRows = spans.slice(0, 80).map((span, index) => toRow(span, index));
  const keywordRows = spans
    .map((span, index) => ({ span, index }))
    .filter(({ span }) => {
      const text = span.textContent || "";
      return keywords.some((keyword) => text.includes(keyword));
    })
    .map(({ span, index }) => toRow(span, index));

  console.log("[TEXT_LAYER_DOM_DEBUG]", {
    spanCount: spans.length,
    spans: firstRows,
    keywordSpans: keywordRows,
  });
}


function logTextSelectionRectDebug(viewport, textSelections, textRedactions, pageNumber) {
  if (!import.meta.env.DEV) {
    return;
  }

  console.groupCollapsed("[TEXT_SELECTION_RECT_DEBUG]");
  console.log("pageNumber:", pageNumber);
  console.log("viewport.scale:", viewport?.scale);
  console.table(textSelections.map((selection, index) => {
    const displaySize = rectSize(selection.displayRect);
    const redactionSize = rectSize(selection.redactionRect);
    const redaction = textRedactions[index];

    return {
      index,
      displayX: selection.displayRect.x0.toFixed(2),
      displayY: selection.displayRect.y0.toFixed(2),
      displayWidth: displaySize.width.toFixed(2),
      displayHeight: displaySize.height.toFixed(2),
      redactionX: selection.redactionRect.x0.toFixed(2),
      redactionY: selection.redactionRect.y0.toFixed(2),
      redactionWidth: redactionSize.width.toFixed(2),
      redactionHeight: redactionSize.height.toFixed(2),
      pdfX0: redaction ? redaction.rect.x0.toFixed(4) : "",
      pdfY0: redaction ? redaction.rect.y0.toFixed(4) : "",
      pdfX1: redaction ? redaction.rect.x1.toFixed(4) : "",
      pdfY1: redaction ? redaction.rect.y1.toFixed(4) : "",
      pdfHeight: redaction ? (redaction.rect.y1 - redaction.rect.y0).toFixed(4) : "",
    };
  }));
  console.groupEnd();
}


function useDebouncedValue(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [delay, value]);

  return debouncedValue;
}


function useNearViewport(targetRef, rootRef) {
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) {
      return undefined;
    }

    if (!("IntersectionObserver" in window)) {
      setIsNearViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsNearViewport(entry.isIntersecting),
      {
        root: rootRef.current,
        rootMargin: "900px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [rootRef, targetRef]);

  return isNearViewport;
}


function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function formatRect(rect) {
  return `${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}`;
}


function toBoxStyle(rect) {
  const normalized = normalizeRect(rect);

  return {
    left: `${normalized.x0}px`,
    top: `${normalized.y0}px`,
    width: `${normalized.x1 - normalized.x0}px`,
    height: `${normalized.y1 - normalized.y0}px`,
  };
}


function getRectDimensions(rect) {
  const normalized = normalizeRect(rect);

  return {
    width: normalized.x1 - normalized.x0,
    height: normalized.y1 - normalized.y0,
  };
}


function moveViewportRect(rect, dx, dy, bounds) {
  const normalized = normalizeRect(rect);
  const { width, height } = getRectDimensions(normalized);
  const left = clamp(normalized.x0 + dx, 0, Math.max(0, bounds.width - width));
  const top = clamp(normalized.y0 + dy, 0, Math.max(0, bounds.height - height));

  return {
    x0: left,
    y0: top,
    x1: left + width,
    y1: top + height,
  };
}


function normalizeRotation(rotation) {
  return ((Number(rotation) || 0) % 360 + 360) % 360;
}


function getPdfPageBounds(pageInfo) {
  const rotation = normalizeRotation(pageInfo.rotation);

  if (rotation === 90 || rotation === 270) {
    return {
      width: pageInfo.height,
      height: pageInfo.width,
    };
  }

  return {
    width: pageInfo.width,
    height: pageInfo.height,
  };
}


function getKeyboardMovePdfDelta(key, step, rotation) {
  const viewportDx = key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0;
  const viewportDy = key === "ArrowDown" ? step : key === "ArrowUp" ? -step : 0;

  if (viewportDx === 0 && viewportDy === 0) {
    return null;
  }

  switch (normalizeRotation(rotation)) {
    case 90:
      return { dx: viewportDy, dy: viewportDx };
    case 180:
      return { dx: -viewportDx, dy: viewportDy };
    case 270:
      return { dx: -viewportDy, dy: -viewportDx };
    default:
      return { dx: viewportDx, dy: -viewportDy };
  }
}


function movePdfRect(rect, dx, dy, bounds) {
  const normalized = normalizeRect(rect);
  const { width, height } = getRectDimensions(normalized);
  const left = clamp(normalized.x0 + dx, 0, Math.max(0, bounds.width - width));
  const bottom = clamp(normalized.y0 + dy, 0, Math.max(0, bounds.height - height));

  return roundRect({
    x0: left,
    y0: bottom,
    x1: left + width,
    y1: bottom + height,
  });
}


function areRectsEqual(rectA, rectB) {
  const a = normalizeRect(rectA);
  const b = normalizeRect(rectB);

  return Math.abs(a.x0 - b.x0) < 0.001
    && Math.abs(a.y0 - b.y0) < 0.001
    && Math.abs(a.x1 - b.x1) < 0.001
    && Math.abs(a.y1 - b.y1) < 0.001;
}


function isEditableEventTarget(target) {
  if (!target || typeof target !== "object") {
    return false;
  }

  const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";

  return tagName === "input"
    || tagName === "textarea"
    || tagName === "select"
    || Boolean(target.isContentEditable);
}


function isDeleteBlockedEventTarget(target) {
  if (!target || typeof target !== "object") {
    return false;
  }

  const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (tagName === "input") {
    const inputType = typeof target.type === "string" ? target.type.toLowerCase() : "";
    return inputType !== "range" && inputType !== "button";
  }

  return tagName === "textarea"
    || tagName === "select"
    || Boolean(target.isContentEditable);
}


function resizeViewportRect(rect, handle, point, bounds, preserveRatio) {
  const normalized = normalizeRect(rect);
  const anchorX = handle.includes("w") ? normalized.x1 : normalized.x0;
  const anchorY = handle.includes("n") ? normalized.y1 : normalized.y0;
  const signX = handle.includes("w") ? -1 : 1;
  const signY = handle.includes("n") ? -1 : 1;
  const maxWidth = Math.max(0, signX < 0 ? anchorX : bounds.width - anchorX);
  const maxHeight = Math.max(0, signY < 0 ? anchorY : bounds.height - anchorY);
  const minWidth = Math.min(MIN_EDIT_SIZE, maxWidth);
  const minHeight = Math.min(MIN_EDIT_SIZE, maxHeight);
  let width = clamp(Math.abs(point.x - anchorX), minWidth, maxWidth);
  let height = clamp(Math.abs(point.y - anchorY), minHeight, maxHeight);

  if (preserveRatio) {
    const startSize = getRectDimensions(normalized);
    const ratio = startSize.width > 0 && startSize.height > 0 ? startSize.width / startSize.height : 1;

    if (width / height > ratio) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }

    if (width > maxWidth) {
      width = maxWidth;
      height = width / ratio;
    }

    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
  }

  return normalizeRect({
    x0: anchorX,
    y0: anchorY,
    x1: anchorX + (signX * width),
    y1: anchorY + (signY * height),
  });
}


const PdfPage = React.memo(function PdfPage({
  pdfDoc,
  fileId,
  pageInfo,
  pageNumber,
  zoom,
  markingMode,
  redactions,
  searchHighlight,
  selectedRedactionId,
  scrollRootRef,
  onAddRedaction,
  onAddRedactions,
  onBeginRedactionEdit,
  onClearRedactionSelection,
  onSelectRedaction,
  onUpdateRedaction,
}) {
  const pageRef = useRef(null);
  const canvasRef = useRef(null);
  const layerRef = useRef(null);
  const textLayerRef = useRef(null);
  const textLayerTaskRef = useRef(null);
  const [viewport, setViewport] = useState(null);
  const [drag, setDrag] = useState(null);
  const [editDrag, setEditDrag] = useState(null);
  const [textSelectionPreviewRects, setTextSelectionPreviewRects] = useState([]);
  const [textGlyphMap, setTextGlyphMap] = useState([]);
  const [isTextGlyphMapLoaded, setIsTextGlyphMapLoaded] = useState(false);
  const [textLayerVisualDebugRects, setTextLayerVisualDebugRects] = useState([]);
  const [nativeSelectionVisualDebugRects, setNativeSelectionVisualDebugRects] = useState([]);
  const [textSelectionDisplayDebugRects, setTextSelectionDisplayDebugRects] = useState([]);
  const [textSelectionRedactionDebugRects, setTextSelectionRedactionDebugRects] = useState([]);
  const [renderState, setRenderState] = useState("idle");
  const isNearViewport = useNearViewport(pageRef, scrollRootRef);

  useEffect(() => {
    let cancelled = false;
    let renderTask = null;
    let textLayerTask = null;
    let queuedRender = null;

    async function renderPage() {
      queuedRender = enqueueRender(async () => {
        if (cancelled) {
          return;
        }

        setRenderState("loading");

        try {
          const page = await pdfDoc.getPage(pageNumber);
          if (cancelled) {
            return;
          }

          const nextViewport = page.getViewport({
            scale: zoom,
            rotation: page.rotate,
          });
          const canvas = canvasRef.current;

          if (!canvas) {
            return;
          }

          const context = canvas.getContext("2d");
          const outputScale = window.devicePixelRatio || 1;
          canvas.width = Math.floor(nextViewport.width * outputScale);
          canvas.height = Math.floor(nextViewport.height * outputScale);
          canvas.style.width = `${nextViewport.width}px`;
          canvas.style.height = `${nextViewport.height}px`;
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.clearRect(0, 0, canvas.width, canvas.height);

          const renderContext = {
            canvasContext: context,
            viewport: nextViewport,
          };

          if (outputScale !== 1) {
            renderContext.transform = [outputScale, 0, 0, outputScale, 0, 0];
          }

          setViewport(nextViewport);
          renderTask = page.render(renderContext);
          await renderTask.promise;
          if (cancelled) {
            return;
          }

          const textLayerElement = textLayerRef.current;
          if (textLayerElement) {
            textLayerTaskRef.current?.cancel?.();
            textLayerTaskRef.current = null;
            textLayerElement.innerHTML = "";
            textLayerElement.style.width = `${nextViewport.width}px`;
            textLayerElement.style.height = `${nextViewport.height}px`;
            textLayerElement.style.setProperty("--scale-factor", String(nextViewport.scale));
            textLayerElement.dataset.scale = String(nextViewport.scale);
            textLayerElement.dataset.width = String(nextViewport.width);
            textLayerElement.dataset.height = String(nextViewport.height);
            textLayerElement.setAttribute("data-main-rotation", String(nextViewport.rotation));

            const textLayerViewport = nextViewport.clone
              ? nextViewport.clone({ dontFlip: true })
              : nextViewport;
            let cachedTextContent = null;
            const getTextContent = async () => {
              if (cachedTextContent) {
                return cachedTextContent;
              }

              cachedTextContent = await page.getTextContent({
                includeMarkedContent: true,
                disableNormalization: true,
              });

              return cachedTextContent;
            };
            const textContentSource = typeof page.streamTextContent === "function"
              ? page.streamTextContent({ includeMarkedContent: true, disableNormalization: true })
              : await getTextContent();
            if (cancelled) {
              return;
            }

            if (typeof pdfjsLib.TextLayer === "function") {
              textLayerTask = new pdfjsLib.TextLayer({
                textContentSource,
                container: textLayerElement,
                viewport: textLayerViewport,
              });
              textLayerTaskRef.current = textLayerTask;
              await textLayerTask.render();
              if (cancelled) {
                return;
              }
            }

            if (ENABLE_TEXT_LAYER_VISUAL_DEBUG) {
              logTextLayerDomDebug(textLayerElement);
            }
            if (ENABLE_TEXT_LAYER_VISUAL_DEBUG && ENABLE_TEXT_LAYER_RECT_OVERLAY_DEBUG) {
              setTextLayerVisualDebugRects(getTextLayerVisualDebugRects(textLayerElement, TEXT_LAYER_DEBUG_KEYWORDS));
            }
          }

          if (!cancelled) {
            setRenderState("ready");
          }
        } catch (error) {
          if (!cancelled && error?.name !== "RenderingCancelledException") {
            setRenderState("error");
          }
        }
      });

      await queuedRender;
    }

    if (!isNearViewport) {
      return () => {
        cancelled = true;
      };
    }

    renderPage();

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
      if (textLayerTask) {
        textLayerTask.cancel();
      }
      textLayerTaskRef.current?.cancel?.();
      textLayerTaskRef.current = null;
    };
  }, [isNearViewport, pdfDoc, pageNumber, zoom]);

  useEffect(() => {
    let cancelled = false;

    setTextGlyphMap([]);
    setIsTextGlyphMapLoaded(false);

    if (!isNearViewport || !fileId) {
      return () => {
        cancelled = true;
      };
    }

    async function loadTextMap() {
      try {
        const payload = await fetchTextMap({
          fileId,
          page: pageNumber,
          excludeDotLeader: true,
          excludePageNumber: true,
        });

        if (!cancelled) {
          setTextGlyphMap(Array.isArray(payload?.chars) ? payload.chars : []);
          setIsTextGlyphMapLoaded(true);
        }
      } catch (error) {
        if (!cancelled) {
          setTextGlyphMap([]);
          setIsTextGlyphMapLoaded(false);
        }
      }
    }

    loadTextMap();

    return () => {
      cancelled = true;
    };
  }, [fileId, isNearViewport, pageNumber]);

  useEffect(() => {
    setDrag(null);
    setTextSelectionPreviewRects([]);
    if (ENABLE_TEXT_LAYER_VISUAL_DEBUG && ENABLE_TEXT_LAYER_RECT_OVERLAY_DEBUG) {
      setNativeSelectionVisualDebugRects([]);
      setTextSelectionDisplayDebugRects([]);
      setTextSelectionRedactionDebugRects([]);
    }
  }, [markingMode]);

  const isTextDragging = drag?.mode === MARKING_MODE_TEXT;

  useEffect(() => {
    if (!isTextDragging) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        setDrag(null);
        setTextSelectionPreviewRects([]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTextDragging]);



  const isViewportCurrent = viewport
    && (typeof viewport.scale !== "number" || Math.abs(viewport.scale - zoom) < 0.001);
  const activeViewport = isViewportCurrent ? viewport : null;
  const viewportTextGlyphs = useMemo(() => (
    activeViewport
      ? textGlyphMap
        .map((glyph) => {
          if (
            !glyph?.rect
            || !Number.isFinite(glyph.rect.x0)
            || !Number.isFinite(glyph.rect.y0)
            || !Number.isFinite(glyph.rect.x1)
            || !Number.isFinite(glyph.rect.y1)
          ) {
            return null;
          }

          return {
            ...glyph,
            viewportRect: pdfRectToViewportRect(activeViewport, glyph.rect),
          };
        })
        .filter(Boolean)
      : []
  ), [activeViewport, textGlyphMap]);

  const getLocalPoint = useCallback((event) => {
    const bounds = layerRef.current.getBoundingClientRect();

    return {
      x: clamp(event.clientX - bounds.left, 0, bounds.width),
      y: clamp(event.clientY - bounds.top, 0, bounds.height),
    };
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (!activeViewport || event.button !== 0) {
      return;
    }

    // Clear selection unless clicking on redaction-related elements
    const target = event.target;
    const isRedactionTarget = !!(
      target.classList?.contains("redaction-box")
      || target.classList?.contains("resize-handle")
      || target.closest?.(".redaction-box")
    );
    if (!isRedactionTarget) {
      onClearRedactionSelection();
    }

    const point = getLocalPoint(event);
    if (markingMode === MARKING_MODE_TEXT) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      window.getSelection()?.removeAllRanges();
      setTextSelectionPreviewRects([]);
      setDrag({
        start: point,
        current: point,
        mode: MARKING_MODE_TEXT,
      });
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setTextSelectionPreviewRects([]);
    setDrag({ start: point, current: point, mode: MARKING_MODE_AREA });
  }, [activeViewport, getLocalPoint, markingMode, onClearRedactionSelection]);

  const startEditDrag = useCallback((event, redaction, mode, handle = "") => {
    if (!activeViewport || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    layerRef.current?.setPointerCapture(event.pointerId);
    const point = getLocalPoint(event);
    const startRect = pdfRectToViewportRect(activeViewport, redaction.rect);

    onSelectRedaction(redaction.id);
    setDrag(null);
    setEditDrag({
      id: redaction.id,
      mode,
      handle,
      startPoint: point,
      startRect,
      hasHistory: false,
    });
  }, [activeViewport, getLocalPoint, onSelectRedaction]);

  const handlePointerMove = useCallback((event) => {
    if (editDrag && activeViewport) {
      const point = getLocalPoint(event);
      const hasMoved = Math.abs(point.x - editDrag.startPoint.x) >= 1
        || Math.abs(point.y - editDrag.startPoint.y) >= 1;
      if (!hasMoved) {
        return;
      }

      if (!editDrag.hasHistory) {
        onBeginRedactionEdit();
        setEditDrag((current) => (
          current && current.id === editDrag.id
            ? { ...current, hasHistory: true }
            : current
        ));
      }

      const bounds = {
        width: activeViewport.width,
        height: activeViewport.height,
      };
      const nextRect = editDrag.mode === "move"
        ? moveViewportRect(
            editDrag.startRect,
            point.x - editDrag.startPoint.x,
            point.y - editDrag.startPoint.y,
            bounds,
          )
        : resizeViewportRect(
            editDrag.startRect,
            editDrag.handle,
            point,
            bounds,
            event.shiftKey,
          );

      onUpdateRedaction(editDrag.id, viewportRectToPdfRect(activeViewport, nextRect));
      return;
    }

    if (!drag) {
      return;
    }

    const point = getLocalPoint(event);
    if (drag.mode === MARKING_MODE_TEXT) {
      event.preventDefault();
      const selectionRect = getAnchorTextSelectionRect(drag.start, point);
      const selectedRuns = isTextGlyphMapLoaded
        ? getSelectedTextGlyphRuns(viewportTextGlyphs, selectionRect)
        : [];
      setTextSelectionPreviewRects(selectedRuns.map((run) => run.viewportRect));
      setDrag((currentDrag) => (
        currentDrag
          ? {
              ...currentDrag,
              current: point,
            }
          : currentDrag
      ));
      return;
    }

    setDrag((currentDrag) => (
      currentDrag
        ? {
            ...currentDrag,
            current: point,
          }
        : currentDrag
    ));
  }, [activeViewport, drag, editDrag, getLocalPoint, isTextGlyphMapLoaded, markingMode, onBeginRedactionEdit, onUpdateRedaction, viewportTextGlyphs]);

  const finishDrag = useCallback(async (event) => {
    if (editDrag) {
      setEditDrag(null);
      return;
    }

    if (!drag || !activeViewport) {
      setDrag(null);
      setTextSelectionPreviewRects([]);
      return;
    }

    const current = getLocalPoint(event);
    if (drag.mode === MARKING_MODE_TEXT) {
      if (!fileId) {
        setDrag(null);
        setTextSelectionPreviewRects([]);
        return;
      }

      const selectionViewportRect = getAnchorTextSelectionRect(drag.start, current);
      const selectionSize = rectSize(selectionViewportRect);
      if (selectionSize.width < TEXT_SELECTION_MIN_SIZE || selectionSize.height < TEXT_SELECTION_MIN_SIZE) {
        setDrag(null);
        setTextSelectionPreviewRects([]);
        return;
      }

      if (import.meta.env.DEV) {
        console.log("[TEXT_DRAG_RECT_DEBUG]", {
          dragStart: drag.start,
          dragCurrent: current,
          selectionRect: selectionViewportRect,
          viewportScale: activeViewport.scale,
          pageNumber,
        });
      }

      const requestRect = viewportRectToPdfRect(activeViewport, selectionViewportRect);
      const selectedRuns = isTextGlyphMapLoaded
        ? getSelectedTextGlyphRuns(viewportTextGlyphs, selectionViewportRect)
        : [];

      if (isTextGlyphMapLoaded) {
        const glyphRedactions = selectedRuns.map((run) => ({
          id: makeId(),
          page: pageNumber,
          type: MARKING_MODE_TEXT,
          rect: run.pdfRect,
        }));

        if (import.meta.env.DEV) {
          console.log("[TEXT_GLYPH_SELECTION_DEBUG]", {
            pageNumber,
            requestRect,
            selectedRunCount: selectedRuns.length,
            selectedTexts: selectedRuns.map((run) => run.text),
          });
        }

        if (glyphRedactions.length > 0) {
          onAddRedactions(glyphRedactions);
        }

        window.getSelection()?.removeAllRanges();
        setDrag(null);
        setTextSelectionPreviewRects([]);
        return;
      }

      let snappedPayload = null;

      try {
        snappedPayload = await snapTextRedactions({
          fileId,
          page: pageNumber,
          rect: requestRect,
          mode: "char",
          expandToWord: false,
          excludeDotLeader: true,
          excludePageNumber: true,
        });
      } catch (snapError) {
        if (import.meta.env.DEV) {
          console.warn("[SNAP_TEXT_DEBUG] request failed", snapError);
        }
      }

      const snappedRedactions = Array.isArray(snappedPayload?.redactions)
        ? snappedPayload.redactions
          .map((item) => {
            const rawRect = item?.rect;
            if (
              !rawRect
              || !Number.isFinite(rawRect.x0)
              || !Number.isFinite(rawRect.y0)
              || !Number.isFinite(rawRect.x1)
              || !Number.isFinite(rawRect.y1)
            ) {
              return null;
            }

            return {
              id: makeId(),
              page: Number.isFinite(item.page) ? item.page : pageNumber,
              type: item?.type === MARKING_MODE_AREA ? MARKING_MODE_AREA : MARKING_MODE_TEXT,
              rect: normalizeRect({
                x0: rawRect.x0,
                y0: rawRect.y0,
                x1: rawRect.x1,
                y1: rawRect.y1,
              }),
            };
          })
          .filter(Boolean)
        : [];

      if (import.meta.env.DEV) {
        console.log("[SNAP_TEXT_DEBUG]", {
          pageNumber,
          requestRect,
          snappedCount: snappedRedactions.length,
          matchedWordCount: snappedPayload?.matchedWordCount ?? 0,
        });
      }

      if (snappedRedactions.length > 0) {
        onAddRedactions(snappedRedactions);
      }

      window.getSelection()?.removeAllRanges();
      setDrag(null);
      setTextSelectionPreviewRects([]);
      return;
    }

    const viewportRect = normalizeRect({
      x0: drag.start.x,
      y0: drag.start.y,
      x1: current.x,
      y1: current.y,
    });
    const size = rectSize(viewportRect);

    if (size.width >= MIN_SELECTION_SIZE && size.height >= MIN_SELECTION_SIZE) {
      onAddRedaction({
        id: makeId(),
        page: pageNumber,
        type: MARKING_MODE_AREA,
        rect: viewportRectToPdfRect(activeViewport, viewportRect),
      });
    }

    setDrag(null);
    setTextSelectionPreviewRects([]);
  }, [activeViewport, drag, editDrag, fileId, getLocalPoint, isTextGlyphMapLoaded, onAddRedaction, onAddRedactions, pageNumber, viewportTextGlyphs]);

  const visibleRedactions = useMemo(() => (
    activeViewport
      ? redactions.map((redaction) => ({
        ...redaction,
        viewportRect: pdfRectToViewportRect(activeViewport, redaction.rect),
      }))
      : []
  ), [activeViewport, redactions]);

  const dragRect = drag && drag.mode === MARKING_MODE_AREA
    ? normalizeRect({
        x0: drag.start.x,
        y0: drag.start.y,
        x1: drag.current.x,
        y1: drag.current.y,
      })
    : null;
  const searchHighlightRect = activeViewport && searchHighlight
    ? pdfRectToViewportRect(activeViewport, searchHighlight.rect)
    : null;

  const fallbackSize = useMemo(() => {
    if (!pageInfo) {
      return null;
    }

    return {
      width: pageInfo.width * zoom,
      height: pageInfo.height * zoom,
    };
  }, [pageInfo, zoom]);
  const stageSize = activeViewport || fallbackSize || viewport;
  const stageClassName = [
    "page-stage",
    markingMode === MARKING_MODE_TEXT ? "is-text-mode" : "is-area-mode",
    import.meta.env.DEV && ENABLE_TEXT_LAYER_VISUAL_DEBUG ? "is-text-layer-content-debug" : "",
  ].filter(Boolean).join(" ");
  const shouldRenderVisualDebug = import.meta.env.DEV
    && ENABLE_TEXT_LAYER_VISUAL_DEBUG
    && ENABLE_TEXT_LAYER_RECT_OVERLAY_DEBUG;

  return h(
    "section",
    { ref: pageRef, className: "pdf-page", "data-page-number": pageNumber },
    h(
      "div",
      { className: "page-toolbar" },
      h("span", null, `${TEXT.page} ${pageNumber}`),
      renderState === "loading" ? h("span", { className: "muted" }, TEXT.rendering) : null,
      renderState === "error" ? h("span", { className: "error-text" }, TEXT.renderFailed) : null,
    ),
    h(
      "div",
      {
        ref: layerRef,
        className: stageClassName,
        style: stageSize ? { width: `${stageSize.width}px`, height: `${stageSize.height}px` } : null,
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: finishDrag,
        onPointerCancel: () => {
          setDrag(null);
          setEditDrag(null);
          setTextSelectionPreviewRects([]);
        },
        onPointerLeave: () => {
          // No-op for text mode
        },
      },
      h("canvas", { ref: canvasRef, className: "pdf-canvas" }),
      h("div", { ref: textLayerRef, className: "text-layer", "aria-hidden": true }),
      textSelectionPreviewRects.map((rect, index) => h("div", {
        key: `text-selection-preview-${index}`,
        className: "text-selection-preview",
        style: toBoxStyle(rect),
      })),
      shouldRenderVisualDebug ? h(
        "div",
        { className: "text-layer-visual-debug-overlay" },
        textLayerVisualDebugRects.map((item) => h(
          "div",
          {
            key: `text-layer-debug-${item.key}`,
            className: `text-layer-visual-debug-rect${item.kind === "keyword" ? " is-keyword" : " is-line"}`,
            style: toBoxStyle(item.rect),
          },
          (() => {
            const isKeyword = item.kind === "keyword";
            const isSelectionLine = isRectOnSelectionLine(item.rect, nativeSelectionVisualDebugRects);
            if (!isKeyword && !isSelectionLine) {
              return null;
            }

            const labelText = (item.text || "").trim().slice(0, 40);
            if (!labelText) {
              return null;
            }

            return h(
              "span",
              {
                className: `text-layer-visual-debug-label${isKeyword ? " is-keyword" : " is-line"}`,
              },
              labelText,
            );
          })(),
        )),
        nativeSelectionVisualDebugRects.map((rect, index) => h("div", {
          key: `text-layer-debug-selection-${index}`,
          className: "text-layer-visual-debug-rect is-selection",
          style: toBoxStyle(rect),
        })),
        textSelectionDisplayDebugRects.map((rect, index) => h("div", {
          key: `text-layer-debug-display-${index}`,
          className: "text-layer-visual-debug-rect is-display",
          style: toBoxStyle(rect),
        })),
        textSelectionRedactionDebugRects.map((rect, index) => h("div", {
          key: `text-layer-debug-redaction-${index}`,
          className: "text-layer-visual-debug-rect is-redaction",
          style: toBoxStyle(rect),
        })),
      ) : null,
      visibleRedactions.map((redaction) => {
        const isSelected = redaction.id === selectedRedactionId;

        return h(
          "div",
          {
            key: redaction.id,
            className: `redaction-box${isSelected ? " is-selected" : ""}`,
            style: toBoxStyle(redaction.viewportRect),
            onPointerDown: (event) => startEditDrag(event, redaction, "move"),
          },
          isSelected
            ? RESIZE_HANDLES.map((handle) => h("span", {
                key: handle,
                className: `resize-handle resize-handle-${handle}`,
                onPointerDown: (event) => startEditDrag(event, redaction, "resize", handle),
              }))
            : null,
        );
      }),
      searchHighlightRect ? h("div", {
        className: "search-highlight",
        style: toBoxStyle(searchHighlightRect),
      }) : null,
      dragRect ? h("div", { className: "selection-box", style: toBoxStyle(dragRect) }) : null,
    ),
  );
});


const ThumbnailPage = React.memo(function ThumbnailPage({
  pdfDoc,
  pageInfo,
  pageNumber,
  isActive,
  scrollRootRef,
  onSelectPage,
}) {
  const itemRef = useRef(null);
  const canvasRef = useRef(null);
  const [thumbnailSize, setThumbnailSize] = useState(() => {
    if (!pageInfo?.width || !pageInfo?.height) {
      return { width: THUMBNAIL_WIDTH, height: 170 };
    }

    return {
      width: THUMBNAIL_WIDTH,
      height: Math.round((pageInfo.height / pageInfo.width) * THUMBNAIL_WIDTH),
    };
  });
  const isNearViewport = useNearViewport(itemRef, scrollRootRef);

  useEffect(() => {
    let cancelled = false;
    let renderTask = null;

    if (!isNearViewport) {
      return () => {
        cancelled = true;
      };
    }

    enqueueThumbnailRender(async () => {
      if (cancelled) {
        return;
      }

      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) {
          return;
        }

        const baseViewport = page.getViewport({
          scale: 1,
          rotation: page.rotate,
        });
        const scale = THUMBNAIL_WIDTH / baseViewport.width;
        const viewport = page.getViewport({
          scale,
          rotation: page.rotate,
        });
        const canvas = canvasRef.current;

        if (!canvas) {
          return;
        }

        const context = canvas.getContext("2d");
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        setThumbnailSize({ width: viewport.width, height: viewport.height });

        const renderContext = {
          canvasContext: context,
          viewport,
        };

        if (outputScale !== 1) {
          renderContext.transform = [outputScale, 0, 0, outputScale, 0, 0];
        }

        renderTask = page.render(renderContext);
        await renderTask.promise;
      } catch (error) {
        if (!cancelled && error?.name !== "RenderingCancelledException") {
          const canvas = canvasRef.current;
          const context = canvas?.getContext("2d");
          if (canvas && context) {
            context.clearRect(0, 0, canvas.width, canvas.height);
          }
        }
      }
    });

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [isNearViewport, pageNumber, pdfDoc]);

  return h(
    "button",
    {
      ref: itemRef,
      type: "button",
      className: `thumbnail-item${isActive ? " is-active" : ""}`,
      "data-thumbnail-page": pageNumber,
      "aria-current": isActive ? "page" : undefined,
      onClick: () => onSelectPage(pageNumber),
      title: `${TEXT.page} ${pageNumber}`,
    },
    h(
      "span",
      {
        className: "thumbnail-canvas-wrap",
        style: {
          width: `${thumbnailSize.width}px`,
          height: `${thumbnailSize.height}px`,
        },
      },
      h("canvas", { ref: canvasRef, className: "thumbnail-canvas" }),
    ),
    h("span", { className: "thumbnail-label" }, `${TEXT.page} ${pageNumber}`),
  );
});


function RedactionList({
  redactions,
  selectedRedactionId,
  listRef,
  onActivateRedaction,
  onDeleteRedaction,
}) {
  if (redactions.length === 0) {
    return h("p", { className: "empty-note" }, TEXT.noRegions);
  }

  return h(
    "ol",
    { ref: listRef, className: "redaction-list" },
    redactions.map((redaction) => h(
      "li",
      {
        key: redaction.id,
        className: redaction.id === selectedRedactionId ? "is-selected" : "",
        "data-redaction-id": redaction.id,
        onClick: () => onActivateRedaction(redaction),
      },
      h(
        "div",
        null,
        h(
          "strong",
          null,
          `${TEXT.page} ${redaction.page} · ${
            redaction.type === MARKING_MODE_TEXT ? TEXT.redactionTypeText : TEXT.redactionTypeArea
          }`,
        ),
        h("span", null, formatRect(redaction.rect)),
      ),
      h(
        "button",
        {
          type: "button",
          className: "icon-button",
          title: TEXT.deleteRegion,
          "aria-label": TEXT.deleteRegion,
          onClick: (event) => {
            event.stopPropagation();
            onDeleteRedaction(redaction.id);
          },
        },
        "×",
      ),
    )),
  );
}


function SearchResultsList({ results, activeIndex, onSelectResult }) {
  if (results.length === 0) {
    return h("p", { className: "empty-note" }, TEXT.searchNoResults);
  }

  return h(
    "ol",
    { className: "search-results-list" },
    results.map((result, index) => h(
      "li",
      {
        key: result.id,
        className: index === activeIndex ? "is-selected" : "",
        onClick: () => onSelectResult(index),
      },
      h("strong", null, `${TEXT.page} ${result.page}`),
      h("span", null, result.preview),
    )),
  );
}


function UndoIcon() {
  return h(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: "24",
      height: "24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className: "lucide lucide-undo2-icon lucide-undo-2",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("path", {
      d: "M9 14 4 9l5-5",
    }),
    h("path", {
      d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11",
    }),
  );
}


function RedoIcon() {
  return h(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: "24",
      height: "24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className: "lucide lucide-redo2-icon lucide-redo-2",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("path", {
      d: "m15 14 5-5-5-5",
    }),
    h("path", {
      d: "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13",
    }),
  );
}


function ScrollModeIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" }, h("path", { d: "M3 2h18" }), h("rect", { x: "3", y: "6", width: "18", height: "12", rx: "2" }), h("path", { d: "M3 22h18" }));
}


function FitModeIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" }, h("path", { d: "M2 3v18" }), h("rect", { x: "6", y: "3", width: "12", height: "18", rx: "2" }), h("path", { d: "M22 3v18" }));
}


function SaveWorkIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" }, h("path", { d: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" }), h("path", { d: "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" }), h("path", { d: "M7 3v4a1 1 0 0 0 1 1h7" }));
}


function LoadWorkIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" }, h("path", { d: "M12 3v12" }), h("path", { d: "m8 11 4 4 4-4" }), h("path", { d: "M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" }));
}


function TextSelectionIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" }, h("path", { d: "M12 20h-1a2 2 0 0 1-2-2 2 2 0 0 1-2 2H6" }), h("path", { d: "M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7" }), h("path", { d: "M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1" }), h("path", { d: "M6 4h1a2 2 0 0 1 2 2 2 2 0 0 1 2-2h1" }), h("path", { d: "M9 6v12" }));
}


function AreaSelectionIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" }, h("path", { d: "M19.5 7a24 24 0 0 1 0 10" }), h("path", { d: "M4.5 7a24 24 0 0 0 0 10" }), h("path", { d: "M7 19.5a24 24 0 0 0 10 0" }), h("path", { d: "M7 4.5a24 24 0 0 1 10 0" }), h("rect", { x: "17", y: "17", width: "5", height: "5", rx: "1" }), h("rect", { x: "17", y: "2", width: "5", height: "5", rx: "1" }), h("rect", { x: "2", y: "17", width: "5", height: "5", rx: "1" }), h("rect", { x: "2", y: "2", width: "5", height: "5", rx: "1" }));
}


function SearchIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" }, h("path", { d: "m21 21-4.34-4.34" }), h("circle", { cx: "11", cy: "11", r: "8" }));
}


function SearchPrevIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" }, h("path", { d: "M10.793 19.793a.707.707 0 0 0 1.207-.5V16a1 1 0 0 1 1-1h6a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-6a1 1 0 0 1-1-1V4.707a.707.707 0 0 0-1.207-.5l-6.94 6.94a1.207 1.207 0 0 0 0 1.707z" }));
}


function SearchNextIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" }, h("path", { d: "M13.207 19.793a.707.707 0 0 1-1.207-.5V16a1 1 0 0 0-1-1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h6a1 1 0 0 0 1-1V4.707a.707.707 0 0 1 1.207-.5l6.94 6.94a1.207 1.207 0 0 1 0 1.707z" }));
}


export default function App() {
  const objectUrlRef = useRef(null);
  const pdfDocRef = useRef(null);
  const dragDepthRef = useRef(0);
  const documentPanelRef = useRef(null);
  const thumbnailPanelRef = useRef(null);
  const redactionListRef = useRef(null);
  const zoomAnchorRef = useRef(null);
  const workInputRef = useRef(null);
  const searchPanelRef = useRef(null);
  const redactionsRef = useRef([]);
  const selectedRedactionIdRef = useRef("");
  const [pdfDoc, setPdfDoc] = useState(null);
  const [viewMode, setViewMode] = useState("fit");
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [fileId, setFileId] = useState("");
  const [fileName, setFileName] = useState("");
  const [pdfMeta, setPdfMeta] = useState(null);
  const [pageInfos, setPageInfos] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [markingMode, setMarkingMode] = useState(MARKING_MODE_TEXT);
  const [redactions, setRedactions] = useState([]);
  const [selectedRedactionId, setSelectedRedactionId] = useState("");
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [searchStatus, setSearchStatus] = useState("idle");
  const [isSearchPanelOpen, setIsSearchPanelOpen] = useState(false);
  const [virtualRange, setVirtualRange] = useState({ start: 1, end: 0 });
  const [downloadUrl, setDownloadUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const [workFileName, setWorkFileName] = useState("");

  const lastWheelTimeRef = useRef(0);

  const resetSearchState = useCallback((clearInput = true) => {
    if (clearInput) {
      setSearchInput("");
    }

    setSearchTerm("");
    setSearchResults([]);
    setActiveSearchIndex(-1);
    setSearchStatus("idle");
    setIsSearchPanelOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    redactionsRef.current = redactions;
    selectedRedactionIdRef.current = selectedRedactionId;
  }, [redactions, selectedRedactionId]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const root = searchPanelRef.current;
      if (root && !root.contains(event.target)) {
        setIsSearchPanelOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsSearchPanelOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // ResizeObserver to track container client dimensions
  useEffect(() => {
    const element = documentPanelRef.current;
    if (!element) return undefined;

    setContainerSize({
      width: element.clientWidth,
      height: element.clientHeight,
    });

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => {
        setContainerSize({
          width: element.clientWidth,
          height: element.clientHeight,
        });
      };
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver(() => {
      setContainerSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [pdfDoc]);

  // Sync virtualRange in Page Fit mode
  useEffect(() => {
    if (viewMode === "fit" && pdfDoc) {
      setVirtualRange({ start: currentPage, end: currentPage });
    }
  }, [currentPage, viewMode, pdfDoc]);

  const pageNumbers = useMemo(() => {
    if (!pdfDoc) {
      return [];
    }

    return Array.from({ length: pdfDoc.numPages }, (_, index) => index + 1);
  }, [pdfDoc]);

  const pageInfoByPage = useMemo(() => {
    const pageMap = new Map();

    for (const pageInfo of pageInfos) {
      pageMap.set(pageInfo.page, pageInfo);
    }

    return pageMap;
  }, [pageInfos]);

  const calculateFitZoom = useCallback((pageNumber, containerWidth, containerHeight) => {
    if (!pageInfoByPage) return 1;
    const pageInfo = pageInfoByPage.get(pageNumber);
    if (!pageInfo) return 1;

    const bounds = getPdfPageBounds(pageInfo);
    if (!bounds.width || !bounds.height) return 1;

    const paddingX = 48;
    const paddingY = 48 + PAGE_TOOLBAR_HEIGHT + 12;

    const targetWidth = Math.max(100, containerWidth - paddingX);
    const targetHeight = Math.max(100, containerHeight - paddingY);

    const fitScale = Math.min(targetWidth / bounds.width, targetHeight / bounds.height);
    return clamp(Math.round(fitScale * 10) / 10, ZOOM_MIN, ZOOM_MAX);
  }, [pageInfoByPage]);

  const fitZoom = useMemo(() => {
    if (!pdfDoc || containerSize.width === 0 || containerSize.height === 0) {
      return 1;
    }
    return calculateFitZoom(currentPage, containerSize.width, containerSize.height);
  }, [currentPage, containerSize, pdfDoc, calculateFitZoom]);

  const currentZoom = viewMode === "fit" ? fitZoom : zoom;
  const renderZoom = useDebouncedValue(currentZoom, ZOOM_DEBOUNCE_MS);

  const pageLayout = useMemo(() => getPageLayout(pageInfos, renderZoom), [pageInfos, renderZoom]);

  const visiblePageNumbers = useMemo(() => {
    if (!pdfDoc || virtualRange.end < virtualRange.start) {
      return [];
    }

    return Array.from(
      { length: virtualRange.end - virtualRange.start + 1 },
      (_, index) => virtualRange.start + index,
    );
  }, [pdfDoc, virtualRange]);

  const virtualTopSpacer = viewMode === "fit" ? 0 : (pageLayout.offsets[virtualRange.start - 1] || 0);
  const virtualEndOffset = virtualRange.end > 0
    ? (pageLayout.offsets[virtualRange.end - 1] || 0) + (pageLayout.heights[virtualRange.end - 1] || 0)
    : 0;
  const virtualBottomSpacer = viewMode === "fit" ? 0 : Math.max(0, pageLayout.totalHeight - virtualEndOffset);

  const redactionsByPage = useMemo(() => {
    const pageMap = new Map();

    for (const redaction of redactions) {
      const pageRedactions = pageMap.get(redaction.page) || [];
      pageRedactions.push(redaction);
      pageMap.set(redaction.page, pageRedactions);
    }

    return pageMap;
  }, [redactions]);

  const updateCurrentPage = useCallback((pageNumber) => {
    setCurrentPage((previous) => (previous === pageNumber ? previous : pageNumber));
    setPageInput((previous) => (previous === String(pageNumber) ? previous : String(pageNumber)));
  }, []);

  const scrollToPage = useCallback((pageNumber, offsetY = 0) => {
    if (!pdfDoc || pageNumber < 1 || pageNumber > pdfDoc.numPages) {
      return false;
    }

    const root = documentPanelRef.current;

    if (viewMode === "fit") {
      if (root) {
        root.scrollTop = 0;
        root.scrollLeft = 0;
      }
      updateCurrentPage(pageNumber);
      setVirtualRange({ start: pageNumber, end: pageNumber });
      return true;
    }

    const targetTop = (pageLayout.offsets[pageNumber - 1] || 0) + offsetY;

    if (root) {
      root.scrollTop = Math.max(0, targetTop);
    }

    updateCurrentPage(pageNumber);
    setVirtualRange((current) => {
      const next = getPageBufferedRange(pageNumber, pdfDoc.numPages);

      return current.start === next.start && current.end === next.end ? current : next;
    });
    return true;
  }, [pageLayout, pdfDoc, updateCurrentPage, viewMode]);

  const activateRedaction = useCallback((redaction) => {
    setSelectedRedactionId(redaction.id);
    scrollToPage(redaction.page);
  }, [scrollToPage]);

  const clearRedactionSelection = useCallback(() => {
    setSelectedRedactionId("");
  }, []);

  useEffect(() => {
    const root = redactionListRef.current;
    if (!root || !selectedRedactionId) {
      return;
    }

    const target = root.querySelector(`[data-redaction-id="${selectedRedactionId}"]`);
    if (target) {
      root.scrollTop = target.offsetTop;
    }
  }, [selectedRedactionId, redactions]);

  useEffect(() => {
    const root = documentPanelRef.current;
    if (!root || !pdfDoc) {
      return undefined;
    }

    let frameId = 0;
    const updateViewportState = () => {
      frameId = 0;
      if (viewMode === "fit") {
        return;
      }
      const nextRange = getVirtualRange(pageLayout, root.scrollTop, root.clientHeight, pdfDoc.numPages);
      const pageIndex = findPageIndexAtOffset(pageLayout.offsets, pageLayout.heights, root.scrollTop + 1);

      setVirtualRange((current) => (
        current.start === nextRange.start && current.end === nextRange.end ? current : nextRange
      ));
      updateCurrentPage(Math.min(pdfDoc.numPages, pageIndex + 1));
    };

    const scheduleUpdate = () => {
      if (frameId) {
        return;
      }

      frameId = window.requestAnimationFrame(updateViewportState);
    };

    root.addEventListener("scroll", scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      root.removeEventListener("scroll", scheduleUpdate);
    };
  }, [pageLayout, pdfDoc, updateCurrentPage, viewMode]);

  const clearHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const recordHistory = useCallback(() => {
    setUndoStack((current) => pushLimitedHistory(
      current,
      makeHistorySnapshot(redactions, selectedRedactionId),
    ));
    setRedoStack([]);
  }, [redactions, selectedRedactionId]);

  const handleUndo = useCallback(() => {
    setUndoStack((current) => {
      if (current.length === 0) {
        return current;
      }

      const previous = current[current.length - 1];
      setRedoStack((redoCurrent) => pushLimitedHistory(
        redoCurrent,
        makeHistorySnapshot(redactions, selectedRedactionId),
      ));
      setRedactions(previous.redactions);
      setSelectedRedactionId(previous.selectedRedactionId || "");
      setDownloadUrl("");
      setNotice("");

      return current.slice(0, -1);
    });
  }, [redactions, selectedRedactionId]);

  const handleRedo = useCallback(() => {
    setRedoStack((current) => {
      if (current.length === 0) {
        return current;
      }

      const next = current[current.length - 1];
      setUndoStack((undoCurrent) => pushLimitedHistory(
        undoCurrent,
        makeHistorySnapshot(redactions, selectedRedactionId),
      ));
      setRedactions(next.redactions);
      setSelectedRedactionId(next.selectedRedactionId || "");
      setDownloadUrl("");
      setNotice("");

      return current.slice(0, -1);
    });
  }, [redactions, selectedRedactionId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        handleRedo();
      } else if (key === "z") {
        event.preventDefault();
        handleUndo();
      } else if (key === "y") {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleRedo, handleUndo]);

  const addRedactions = useCallback((nextRedactions) => {
    if (!Array.isArray(nextRedactions) || nextRedactions.length === 0) {
      return;
    }

    recordHistory();
    setRedactions((current) => [...current, ...nextRedactions]);
    setSelectedRedactionId(nextRedactions[0].id);
    setDownloadUrl("");
    setError("");
    setNotice("");
  }, [recordHistory]);

  const addRedaction = useCallback((redaction) => {
    addRedactions([redaction]);
  }, [addRedactions]);

  const deleteRedaction = useCallback((id) => {
    recordHistory();
    setRedactions((current) => current.filter((redaction) => redaction.id !== id));
    setSelectedRedactionId((current) => (current === id ? "" : current));
    setDownloadUrl("");
    setNotice("");
  }, [recordHistory]);

  const beginRedactionEdit = useCallback(() => {
    recordHistory();
  }, [recordHistory]);

  const updateRedaction = useCallback((id, rect) => {
    setRedactions((current) => current.map((redaction) => (
      redaction.id === id
        ? { ...redaction, rect }
        : redaction
    )));
    setDownloadUrl("");
    setNotice("");
  }, []);

  const moveSelectedRedactionByKeyboard = useCallback((key, step) => {
    const selectedId = selectedRedactionIdRef.current;
    if (!selectedId) {
      return false;
    }

    const currentRedactions = redactionsRef.current;
    const selectedRedaction = currentRedactions.find((redaction) => redaction.id === selectedId);
    if (!selectedRedaction) {
      return false;
    }

    const pageInfo = pageInfoByPage.get(selectedRedaction.page);
    if (!pageInfo) {
      return false;
    }

    const delta = getKeyboardMovePdfDelta(key, step, pageInfo.rotation);
    if (!delta) {
      return false;
    }

    const nextRect = movePdfRect(selectedRedaction.rect, delta.dx, delta.dy, getPdfPageBounds(pageInfo));
    if (areRectsEqual(selectedRedaction.rect, nextRect)) {
      return false;
    }

    const nextRedactions = currentRedactions.map((redaction) => (
      redaction.id === selectedId
        ? { ...redaction, rect: nextRect }
        : redaction
    ));

    redactionsRef.current = nextRedactions;
    selectedRedactionIdRef.current = selectedId;
    setUndoStack((current) => pushLimitedHistory(
      current,
      makeHistorySnapshot(currentRedactions, selectedId),
    ));
    setRedoStack([]);
    setRedactions(nextRedactions);
    setSelectedRedactionId(selectedId);
    setDownloadUrl("");
    setNotice("");
    return true;
  }, [pageInfoByPage]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isEditableEventTarget(event.target)) {
        return;
      }

      if (!event.key.startsWith("Arrow")) {
        return;
      }

      const step = event.shiftKey ? KEYBOARD_MOVE_FAST_STEP : KEYBOARD_MOVE_STEP;
      if (moveSelectedRedactionByKeyboard(event.key, step)) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [moveSelectedRedactionByKeyboard]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isDeleteBlockedEventTarget(event.target)) {
        return;
      }

      if (event.key !== "Delete") {
        return;
      }

      const selectedId = selectedRedactionIdRef.current;
      if (!selectedId) {
        return;
      }

      event.preventDefault();
      deleteRedaction(selectedId);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteRedaction]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isEditableEventTarget(event.target)) {
        return;
      }

      const code = event.code;
      if (code === "Digit1" || code === "Numpad1") {
        event.preventDefault();
        setMarkingMode(MARKING_MODE_TEXT);
        return;
      }

      if (code === "Digit2" || code === "Numpad2") {
        event.preventDefault();
        setMarkingMode(MARKING_MODE_AREA);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const loadPdfFile = useCallback(async (file) => {
    if (!file) {
      return;
    }

    const isPdfFile = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdfFile) {
      setNotice("");
      setError(TEXT.invalidPdfFile);
      return;
    }

    setStatus("uploading");
    setError("");
    setNotice("");
    setFileId("");
    setDownloadUrl("");
    setRedactions([]);
    setSelectedRedactionId("");
    clearHistory();
    setSearchInput("");
    setSearchTerm("");
    setSearchResults([]);
    setActiveSearchIndex(-1);
    setSearchStatus("idle");
    setIsSearchPanelOpen(false);
    setVirtualRange({ start: 1, end: 0 });
    setFileName(file.name);
    setPdfMeta(null);
    setPageInfos([]);
    updateCurrentPage(1);
    setZoom(1);
    setViewMode("fit");
    setMarkingMode(MARKING_MODE_TEXT);
    setWorkFileName("");

    if (pdfDocRef.current) {
      pdfDocRef.current.destroy();
      pdfDocRef.current = null;
    }

    setPdfDoc(null);

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    try {
      const sha256Promise = computeFileSha256(file).catch(() => "");
      const uploadResult = await uploadPdf(file);
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      const loadingTask = pdfjsLib.getDocument(objectUrl);
      const document = await loadingTask.promise;
      const sha256 = await sha256Promise;
      const fingerprint = getPdfFingerprint(document) || sha256;

      setFileId(uploadResult.fileId);
      setPageInfos(uploadResult.pages || []);
      setPdfMeta({
        fileName: file.name,
        fileSize: file.size,
        pageCount: document.numPages,
        fingerprint,
        sha256,
      });
      pdfDocRef.current = document;
      setPdfDoc(document);
      setStatus("ready");
    } catch (uploadError) {
      setStatus("error");
      setFileId("");
      setPdfDoc(null);
      setPdfMeta(null);
      setPageInfos([]);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setError(uploadError.message || TEXT.loadFailed);
      setNotice("");
    }
  }, [clearHistory, updateCurrentPage]);

  const handleFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];

    try {
      await loadPdfFile(file);
    } finally {
      event.target.value = "";
    }
  }, [loadPdfFile]);

  const handleUploadDragEnter = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }, []);

  const handleUploadDragOver = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleUploadDragLeave = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  }, []);

  const handleUploadDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragActive(false);

    const file = event.dataTransfer.files?.[0];
    loadPdfFile(file);
  }, [loadPdfFile]);

  const handleReset = useCallback(() => {
    if (!window.confirm(TEXT.resetConfirm)) {
      return;
    }

    if (pdfDocRef.current) {
      pdfDocRef.current.destroy();
      pdfDocRef.current = null;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    dragDepthRef.current = 0;
    setPdfDoc(null);
    setFileId("");
    setFileName("");
    setPdfMeta(null);
    setPageInfos([]);
    updateCurrentPage(1);
    setZoom(1);
    setViewMode("fit");
    setMarkingMode(MARKING_MODE_TEXT);
    setRedactions([]);
    setSelectedRedactionId("");
    clearHistory();
    setSearchInput("");
    setSearchTerm("");
    setSearchResults([]);
    setActiveSearchIndex(-1);
    setSearchStatus("idle");
    setIsSearchPanelOpen(false);
    setVirtualRange({ start: 1, end: 0 });
    setDownloadUrl("");
    setStatus("idle");
    setError("");
    setNotice("");
    setIsDragActive(false);
    setWorkFileName("");
  }, [clearHistory, updateCurrentPage]);

  const handlePageMove = useCallback(() => {
    const pageNumber = Number.parseInt(pageInput, 10);

    if (!pdfDoc || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDoc.numPages) {
      setNotice("");
      setError(TEXT.invalidPage);
      return;
    }

    setError("");
    scrollToPage(pageNumber);
  }, [pageInput, pdfDoc, scrollToPage]);

  const handlePageInputKeyDown = useCallback((event) => {
    if (event.key === "Enter") {
      handlePageMove();
    }
  }, [handlePageMove]);

  const handleViewerWheel = useCallback((event) => {
    if (event.ctrlKey) {
      event.preventDefault();
      const root = documentPanelRef.current;
      if (!root) {
        return;
      }

      const bounds = root.getBoundingClientRect();
      const localX = event.clientX - bounds.left;
      const localY = event.clientY - bounds.top;
      const direction = event.deltaY < 0 ? 1 : -1;

      if (viewMode === "fit") {
        const pageNumber = currentPage;
        const pageElement = root.querySelector(`[data-page-number="${pageNumber}"]`);
        const pageBounds = pageElement?.getBoundingClientRect();
        const pageLocalX = pageBounds
          ? clamp(event.clientX - pageBounds.left, 0, pageBounds.width)
          : localX;
        const pageLocalY = pageBounds
          ? clamp(event.clientY - pageBounds.top, 0, pageBounds.height)
          : localY;
        const nextZoom = clampZoom(fitZoom + (direction * ZOOM_STEP));

        zoomAnchorRef.current = {
          mode: "fit-to-scroll",
          pageNumber,
          oldZoom: fitZoom,
          nextZoom,
          localX,
          localY,
          pageLocalX,
          pageLocalY,
        };

        updateCurrentPage(pageNumber);
        setVirtualRange(getPageBufferedRange(pageNumber, pdfDoc.numPages));
        setViewMode("scroll");
        setZoom(nextZoom);
        return;
      }

      setZoom((current) => {
        const nextZoom = clampZoom(current + (direction * ZOOM_STEP));
        if (nextZoom === current) {
          return current;
        }

        zoomAnchorRef.current = {
          mode: "scroll",
          oldZoom: renderZoom,
          nextZoom,
          localX,
          localY,
          scrollLeft: root.scrollLeft,
          scrollTop: root.scrollTop,
        };

        return nextZoom;
      });
      return;
    }

    if (viewMode === "fit" && pdfDoc) {
      event.preventDefault();

      const now = Date.now();
      if (now - lastWheelTimeRef.current < 450) {
        return;
      }

      const direction = event.deltaY > 0 ? 1 : -1;
      const nextPage = clamp(currentPage + direction, 1, pdfDoc.numPages);
      if (nextPage !== currentPage) {
        lastWheelTimeRef.current = now;
        updateCurrentPage(nextPage);
        setVirtualRange({ start: nextPage, end: nextPage });
      }
    }
  }, [viewMode, pdfDoc, currentPage, renderZoom, fitZoom, updateCurrentPage]);

  useLayoutEffect(() => {
    const root = documentPanelRef.current;
    const anchor = zoomAnchorRef.current;
    if (!root || !anchor || anchor.oldZoom <= 0) {
      return;
    }

    if (anchor.mode === "fit-to-scroll") {
      const target = root.querySelector(`[data-page-number="${anchor.pageNumber}"]`);
      if (!target) {
        return;
      }

      const ratio = renderZoom / anchor.oldZoom;
      root.scrollLeft = target.offsetLeft + (anchor.pageLocalX * ratio) - anchor.localX;
      root.scrollTop = target.offsetTop + getScaledPageLocalY(anchor.pageLocalY, ratio) - anchor.localY;

      if (Math.abs(anchor.nextZoom - renderZoom) <= 0.001) {
        zoomAnchorRef.current = null;
      }
      return;
    }

    if (Math.abs(anchor.nextZoom - renderZoom) > 0.001) {
      return;
    }

    const ratio = renderZoom / anchor.oldZoom;
    root.scrollLeft = ((anchor.scrollLeft + anchor.localX) * ratio) - anchor.localX;
    root.scrollTop = ((anchor.scrollTop + anchor.localY) * ratio) - anchor.localY;
    zoomAnchorRef.current = null;
  }, [renderZoom, viewMode, virtualRange]);

  useEffect(() => {
    const root = documentPanelRef.current;
    if (!root) {
      return undefined;
    }

    root.addEventListener("wheel", handleViewerWheel, { passive: false });

    return () => {
      root.removeEventListener("wheel", handleViewerWheel);
    };
  }, [handleViewerWheel]);

  useEffect(() => {
    const root = thumbnailPanelRef.current;
    if (!root || !pdfDoc) {
      return;
    }

    const target = root.querySelector(`[data-thumbnail-page="${currentPage}"]`);
    if (!target) {
      return;
    }

    root.scrollTop = target.offsetTop;
    root.scrollLeft = target.offsetLeft;
  }, [currentPage, pdfDoc]);

  const handleSetViewMode = useCallback((mode) => {
    if (mode === "fit") {
      setViewMode("fit");
      const root = documentPanelRef.current;
      if (root) {
        root.scrollTop = 0;
        root.scrollLeft = 0;
      }
      setVirtualRange({ start: currentPage, end: currentPage });
    } else if (mode === "scroll") {
      const root = documentPanelRef.current;
      if (root && viewMode === "fit" && pdfDoc) {
        const rootBounds = root.getBoundingClientRect();
        const localX = rootBounds.width / 2;
        const localY = rootBounds.height / 2;
        const pageElement = root.querySelector(`[data-page-number="${currentPage}"]`);
        const pageBounds = pageElement?.getBoundingClientRect();

        zoomAnchorRef.current = {
          mode: "fit-to-scroll",
          pageNumber: currentPage,
          oldZoom: fitZoom,
          nextZoom: fitZoom,
          localX,
          localY,
          pageLocalX: pageBounds
            ? clamp((rootBounds.left + localX) - pageBounds.left, 0, pageBounds.width)
            : localX,
          pageLocalY: pageBounds
            ? clamp((rootBounds.top + localY) - pageBounds.top, 0, pageBounds.height)
            : localY,
        };
        setVirtualRange(getPageBufferedRange(currentPage, pdfDoc.numPages));
      }

      setViewMode("scroll");
      setZoom(fitZoom);
    }
  }, [currentPage, fitZoom, pdfDoc, viewMode]);

  const handleSaveWork = useCallback(() => {
    if (!pdfDoc || !pdfMeta) {
      setNotice("");
      setError(TEXT.noPdfForSave);
      return;
    }

    const fileNameForSave = makeProjectFileName(pdfMeta.fileName);
    const project = {
      version: 1,
      pdf: {
        fileName: pdfMeta.fileName,
        fileSize: pdfMeta.fileSize,
        pageCount: pdfMeta.pageCount,
        fingerprint: pdfMeta.fingerprint,
        sha256: pdfMeta.sha256,
      },
      view: {
        zoom,
        currentPage,
        viewMode,
      },
      redactions: redactions.map(({ page, type, rect }) => ({ page, type, rect })),
      createdAt: new Date().toISOString(),
    };

    downloadJsonFile(fileNameForSave, project);
    setWorkFileName(fileNameForSave);
    setError("");
    setNotice(TEXT.workSaved);
  }, [currentPage, pdfDoc, pdfMeta, redactions, zoom, viewMode]);

  const handleWorkFileButtonClick = useCallback(() => {
    workInputRef.current?.click();
  }, []);

  const handleWorkFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];

    try {
      if (!file) {
        return;
      }

      if (!pdfDoc || !pdfMeta) {
        setNotice("");
        setError(TEXT.noPdfForLoad);
        return;
      }

      const project = JSON.parse(await file.text());
      if (
        project?.version !== 1
        || !project.pdf
        || !Array.isArray(project.redactions)
      ) {
        throw new Error("Invalid work file");
      }

      const mismatchReasons = getProjectMismatchReasons(pdfMeta, project.pdf);
      if (mismatchReasons.length > 0 && !window.confirm(TEXT.workMismatchConfirm)) {
        setNotice("");
        setError(TEXT.workMismatchCancelled);
        return;
      }

      const importedRedactions = project.redactions.map(normalizeImportedRedaction);
      if (
        importedRedactions.some((redaction) => !redaction)
        || importedRedactions.some((redaction) => redaction.page < 1 || redaction.page > pdfDoc.numPages)
      ) {
        throw new Error("Invalid redactions");
      }

      const nextZoom = clampZoom(Number(project.view?.zoom) || 1);
      const nextPage = clamp(
        Number.parseInt(project.view?.currentPage, 10) || 1,
        1,
        pdfDoc.numPages,
      );
      const nextViewMode = project.view?.viewMode === "scroll" ? "scroll" : "fit";

      setRedactions(importedRedactions);
      setSelectedRedactionId(importedRedactions[0]?.id || "");
      clearHistory();
      setZoom(nextZoom);
      setViewMode(nextViewMode);
      setDownloadUrl("");
      setWorkFileName(file.name);
      setError("");
      setNotice(TEXT.workLoaded);
      updateCurrentPage(nextPage);
      window.setTimeout(() => {
        scrollToPage(nextPage);
      }, 0);
    } catch {
      setNotice("");
      setError(TEXT.invalidWorkFile);
    } finally {
      event.target.value = "";
    }
  }, [clearHistory, pdfDoc, pdfMeta, scrollToPage, updateCurrentPage]);

  const selectSearchResult = useCallback((index) => {
    const result = searchResults[index];
    if (!result) {
      return;
    }

    const pageInfo = pageInfoByPage.get(result.page);
    const offsetY = pageInfo
      ? Math.max(0, ((pageInfo.height - result.rect.y1) * renderZoom) - PAGE_TOOLBAR_HEIGHT)
      : 0;

    setActiveSearchIndex(index);
    setIsSearchPanelOpen(false);
    scrollToPage(result.page, offsetY);
  }, [pageInfoByPage, renderZoom, scrollToPage, searchResults]);

  const handleSearch = useCallback(async () => {
    const query = searchInput.trim();

    if (!pdfDoc) {
      setNotice("");
      setError(TEXT.searchNoPdf);
      setIsSearchPanelOpen(false);
      return;
    }

    if (!query) {
      setNotice("");
      setError(TEXT.searchEmpty);
      resetSearchState(false);
      return;
    }

    setError("");
    setNotice("");
    setSearchStatus("running");
    setSearchTerm(query);
    setSearchResults([]);
    setActiveSearchIndex(-1);
    setIsSearchPanelOpen(false);

    const normalizedQuery = query.toLocaleLowerCase();
    const nextResults = [];

    try {
      for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
        const page = await pdfDoc.getPage(pageNumber);
        const textContent = await page.getTextContent();

        for (let itemIndex = 0; itemIndex < textContent.items.length; itemIndex += 1) {
          const item = textContent.items[itemIndex];
          const text = item.str || "";
          const normalizedText = text.toLocaleLowerCase();
          let matchIndex = normalizedText.indexOf(normalizedQuery);

          while (matchIndex !== -1) {
            const rect = getTextItemMatchRect(page, item, matchIndex, query.length);
            if (rect) {
              nextResults.push({
                id: `${pageNumber}-${itemIndex}-${matchIndex}`,
                page: pageNumber,
                rect,
                preview: makeSearchPreview(text, matchIndex, query.length),
              });
            }

            matchIndex = normalizedText.indexOf(normalizedQuery, matchIndex + normalizedQuery.length);
          }
        }

        if (pageNumber % 10 === 0) {
          await Promise.resolve();
        }
      }

      setSearchResults(nextResults);
      setSearchStatus("ready");
      setIsSearchPanelOpen(true);

      if (nextResults.length > 0) {
        const firstResult = nextResults[0];
        const pageInfo = pageInfoByPage.get(firstResult.page);
        const offsetY = pageInfo
          ? Math.max(0, ((pageInfo.height - firstResult.rect.y1) * renderZoom) - PAGE_TOOLBAR_HEIGHT)
          : 0;

        setActiveSearchIndex(0);
        scrollToPage(firstResult.page, offsetY);
      }
    } catch {
      setSearchStatus("error");
      setSearchResults([]);
      setActiveSearchIndex(-1);
      setIsSearchPanelOpen(false);
      setError(TEXT.searchNoResults);
    }
  }, [pageInfoByPage, pdfDoc, renderZoom, resetSearchState, scrollToPage, searchInput]);

  const handleSearchKeyDown = useCallback((event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  }, [handleSearch]);

  const moveSearchResult = useCallback((delta) => {
    if (searchResults.length === 0) {
      return;
    }

    const nextIndex = activeSearchIndex < 0
      ? 0
      : (activeSearchIndex + delta + searchResults.length) % searchResults.length;
    selectSearchResult(nextIndex);
  }, [activeSearchIndex, searchResults.length, selectSearchResult]);

  const handleApplyRedactions = useCallback(async () => {
    if (!fileId) {
      setNotice("");
      setError(TEXT.uploadFirst);
      return;
    }

    if (redactions.length === 0) {
      setNotice("");
      setError(TEXT.selectRegionFirst);
      return;
    }

    setStatus("applying");
    setError("");
    setNotice("");
    setDownloadUrl("");

    try {
      const payload = redactions.map(({ page, type, rect }) => ({ page, type, rect }));
      const result = await applyRedactions(fileId, payload);
      setDownloadUrl(toDownloadUrl(result.downloadUrl));
      setStatus("ready");
    } catch (redactionError) {
      setStatus("error");
      setNotice("");
      setError(redactionError.message || TEXT.redactFailed);
    }
  }, [fileId, redactions]);

  const zoomOut = useCallback(() => {
    setViewMode("scroll");
    setZoom((current) => {
      const baseZoom = viewMode === "fit" ? fitZoom : current;
      return clampZoom(baseZoom - ZOOM_STEP);
    });
  }, [viewMode, fitZoom]);

  const zoomIn = useCallback(() => {
    setViewMode("scroll");
    setZoom((current) => {
      const baseZoom = viewMode === "fit" ? fitZoom : current;
      return clampZoom(baseZoom + ZOOM_STEP);
    });
  }, [viewMode, fitZoom]);

  const activeSearchResult = activeSearchIndex >= 0 ? searchResults[activeSearchIndex] : null;
  const searchCountLabel = searchResults.length > 0 && activeSearchIndex >= 0
    ? `${activeSearchIndex + 1} / ${searchResults.length}`
    : `0 / ${searchResults.length}`;

  return h(
    "main",
    { className: "app-shell" },
    h(
      "header",
      { className: "app-header" },
      h(
        "div",
        { className: "toolbar-group header-title-group" },
        h("h1", null, TEXT.appTitle),
        h(
          "div",
          { className: "header-history" },
          h(
            "button",
            {
              type: "button",
              className: "svg-icon-button",
              title: TEXT.undo,
              "aria-label": TEXT.undo,
              disabled: undoStack.length === 0,
              onClick: handleUndo,
            },
            h(UndoIcon),
          ),
          h(
            "button",
            {
              type: "button",
              className: "svg-icon-button",
              title: TEXT.redo,
              "aria-label": TEXT.redo,
              disabled: redoStack.length === 0,
              onClick: handleRedo,
            },
            h(RedoIcon),
          ),
        ),
      ),
      h(
        "div",
        { className: "toolbar-group header-edit" },
        h("span", { className: "toolbar-label" }, TEXT.editGroup),
        h(
          "div",
          { className: "marking-mode-buttons", role: "group", "aria-label": TEXT.markingMode },
          h(
            "button",
            {
              type: "button",
              className: `toolbar-icon-button marking-mode-btn${markingMode === MARKING_MODE_TEXT ? " is-active" : ""}`,
              title: TEXT.textSelectionMode,
              "aria-label": TEXT.textSelectionMode,
              onClick: () => setMarkingMode(MARKING_MODE_TEXT),
            },
            h(TextSelectionIcon),
          ),
          h(
            "button",
            {
              type: "button",
              className: `toolbar-icon-button marking-mode-btn${markingMode === MARKING_MODE_AREA ? " is-active" : ""}`,
              title: `${TEXT.areaSelectionMode} (${TEXT.areaSelectionHelp})`,
              "aria-label": TEXT.areaSelectionMode,
              onClick: () => setMarkingMode(MARKING_MODE_AREA),
            },
            h(AreaSelectionIcon),
          ),
        ),
      ),
      h(
        "div",
        { className: "toolbar-group header-view" },
        h("span", { className: "toolbar-label" }, TEXT.viewGroup),
        h(
          "div",
          { className: "header-view-modes" },
          h(
            "button",
            {
              type: "button",
              className: `toolbar-icon-button view-mode-btn${viewMode === "fit" ? " is-active" : ""}`,
              disabled: !pdfDoc,
              title: TEXT.fitMode,
              "aria-label": TEXT.fitMode,
              onClick: () => handleSetViewMode("fit"),
            },
            h(FitModeIcon),
          ),
          h(
            "button",
            {
              type: "button",
              className: `toolbar-icon-button view-mode-btn${viewMode === "scroll" ? " is-active" : ""}`,
              disabled: !pdfDoc,
              title: TEXT.scrollMode,
              "aria-label": TEXT.scrollMode,
              onClick: () => handleSetViewMode("scroll"),
            },
            h(ScrollModeIcon),
          ),
        ),
        h(
          "div",
          { className: "header-zoom" },
          h("button", { type: "button", className: "icon-button", onClick: zoomOut, disabled: !pdfDoc }, "-"),
          h("input", {
            type: "range",
            min: String(ZOOM_MIN),
            max: String(ZOOM_MAX),
            step: String(ZOOM_STEP),
            value: viewMode === "fit" ? fitZoom : zoom,
            disabled: !pdfDoc,
            "aria-label": TEXT.zoom,
            onChange: (event) => {
              setViewMode("scroll");
              setZoom(Number(event.target.value));
            },
          }),
          h("span", { className: "zoom-value" }, pdfDoc ? `${Math.round((viewMode === "fit" ? fitZoom : zoom) * 100)}%` : "100%"),
          h("button", { type: "button", className: "icon-button", onClick: zoomIn, disabled: !pdfDoc }, "+"),
        ),
      ),
      h(
        "div",
        { ref: searchPanelRef, className: "toolbar-group header-search" },
        h(
          "div",
          { className: "header-search-main" },
          h("input", {
            type: "search",
            value: searchInput,
            placeholder: TEXT.searchPlaceholder,
            onChange: (event) => {
              const nextValue = event.target.value;
              setSearchInput(nextValue);
              if (!nextValue.trim()) {
                resetSearchState(false);
              }
            },
            onFocus: () => {
              if (searchInput.trim() && searchTerm) {
                setIsSearchPanelOpen(true);
              }
            },
            onKeyDown: handleSearchKeyDown,
          }),
          h(
            "button",
            {
              type: "button",
              className: "toolbar-icon-button",
              disabled: !pdfDoc || searchStatus === "running",
              title: searchStatus === "running" ? TEXT.searchRunning : TEXT.searchButton,
              "aria-label": TEXT.searchButton,
              onClick: handleSearch,
            },
            h(SearchIcon),
          ),
        ),
        h(
          "div",
          { className: "header-search-nav" },
          h(
            "button",
            {
              type: "button",
              className: "toolbar-icon-button",
              disabled: searchResults.length === 0,
              title: TEXT.searchPrev,
              "aria-label": TEXT.searchPrev,
              onClick: () => moveSearchResult(-1),
            },
            h(SearchPrevIcon),
          ),
          h("span", null, searchCountLabel),
          h(
            "button",
            {
              type: "button",
              className: "toolbar-icon-button",
              disabled: searchResults.length === 0,
              title: TEXT.searchNext,
              "aria-label": TEXT.searchNext,
              onClick: () => moveSearchResult(1),
            },
            h(SearchNextIcon),
          ),
        ),
        isSearchPanelOpen && searchInput.trim() && searchTerm ? h(
          "div",
          { className: "header-search-panel" },
          h("p", { className: "muted" }, `${TEXT.searchResults}: ${searchResults.length}`),
          h(SearchResultsList, {
            results: searchResults,
            activeIndex: activeSearchIndex,
            onSelectResult: selectSearchResult,
          }),
        ) : null,
      ),
      h(
        "div",
        { className: "toolbar-group header-actions" },
        h("span", { className: "toolbar-label" }, TEXT.fileGroup),
        h(
          "button",
          {
            type: "button",
            className: "toolbar-icon-button",
            disabled: !pdfDoc,
            title: TEXT.saveWork,
            "aria-label": TEXT.saveWork,
            onClick: handleSaveWork,
          },
          h(SaveWorkIcon),
        ),
        h(
          "button",
          {
            type: "button",
            className: "toolbar-icon-button",
            disabled: !pdfDoc,
            title: TEXT.loadWork,
            "aria-label": TEXT.loadWork,
            onClick: handleWorkFileButtonClick,
          },
          h(LoadWorkIcon),
        ),
        h("input", {
          ref: workInputRef,
          className: "hidden-file-input",
          type: "file",
          accept: ".redact.json,.pdfredact.json,application/json",
          onChange: handleWorkFileChange,
        }),
        h(
          "label",
          {
            className: `upload-control${isDragActive ? " is-dragging" : ""}`,
            onDragEnter: handleUploadDragEnter,
            onDragOver: handleUploadDragOver,
            onDragLeave: handleUploadDragLeave,
            onDrop: handleUploadDrop,
          },
          h("span", null, TEXT.uploadPdf),
          h("small", null, TEXT.uploadHint),
          h("input", {
            type: "file",
            accept: "application/pdf,.pdf",
            onChange: handleFileChange,
          }),
        ),
        h(
          "button",
          {
            type: "button",
            className: "secondary-button",
            onClick: handleReset,
          },
          TEXT.reset,
        ),
      ),
    ),
    h(
      "div",
      { className: "workspace" },
      h(
        "aside",
        { className: "side-panel" },
        h(
          "section",
          { className: "panel-section" },
          h("h2", null, TEXT.document),
          h("p", { className: "file-name" }, fileName || TEXT.noFile),
          h("p", { className: "muted" }, pdfDoc ? `${pdfDoc.numPages}${TEXT.pages}` : TEXT.waiting),
          workFileName ? h("p", { className: "muted work-file-name" }, `${TEXT.savedWork}: ${workFileName}`) : null,
        ),
        h(
          "section",
          { className: "panel-section" },
          h("h2", null, TEXT.pageMove),
          h(
            "div",
            { className: "page-move-row" },
            h("input", {
              type: "number",
              min: "1",
              max: pdfDoc ? String(pdfDoc.numPages) : "1",
              value: pageInput,
              disabled: !pdfDoc,
              "aria-label": TEXT.currentPage,
              onChange: (event) => setPageInput(event.target.value),
              onKeyDown: handlePageInputKeyDown,
            }),
            h(
              "button",
              {
                type: "button",
                className: "secondary-button",
                disabled: !pdfDoc,
                onClick: handlePageMove,
              },
              TEXT.goToPage,
            ),
          ),
          h("p", { className: "muted" }, pdfDoc ? `${currentPage} / ${pdfDoc.numPages}` : `0 / 0`),
        ),
        h(
          "section",
          { className: "panel-section redaction-section" },
          h("h2", null, TEXT.regions),
          h(RedactionList, {
            redactions,
            selectedRedactionId,
            listRef: redactionListRef,
            onActivateRedaction: activateRedaction,
            onDeleteRedaction: deleteRedaction,
          }),
        ),
        h(
          "section",
          { className: "panel-section action-section" },
          h(
            "button",
            {
              type: "button",
              className: "primary-button",
              disabled: status === "applying" || redactions.length === 0,
              onClick: handleApplyRedactions,
            },
            status === "applying" ? TEXT.applying : TEXT.applyRedactions,
          ),
          downloadUrl
            ? h("a", { className: "download-link", href: downloadUrl }, TEXT.downloadPdf)
            : null,
          notice ? h("p", { className: "notice-text" }, notice) : null,
          error ? h("p", { className: "error-text" }, error) : null,
        ),
      ),
      h(
        "section",
        {
          ref: documentPanelRef,
          className: `document-panel${viewMode === "fit" && pdfDoc ? " is-page-fit" : ""}`,
        },
        pdfDoc
          ? h(
              React.Fragment,
              null,
              h("div", { className: "virtual-spacer", style: { height: `${virtualTopSpacer}px` } }),
              visiblePageNumbers.map((pageNumber) => h(PdfPage, {
                key: pageNumber,
                pdfDoc,
                fileId,
                pageInfo: pageInfoByPage.get(pageNumber),
                pageNumber,
                zoom: viewMode === "fit" ? fitZoom : renderZoom,
                markingMode,
                redactions: redactionsByPage.get(pageNumber) || EMPTY_REDACTIONS,
                searchHighlight: activeSearchResult?.page === pageNumber ? activeSearchResult : null,
                selectedRedactionId,
                scrollRootRef: documentPanelRef,
                onAddRedaction: addRedaction,
                onAddRedactions: addRedactions,
                onBeginRedactionEdit: beginRedactionEdit,
                onClearRedactionSelection: clearRedactionSelection,
                onSelectRedaction: setSelectedRedactionId,
                onUpdateRedaction: updateRedaction,
              })),
              h("div", { className: "virtual-spacer", style: { height: `${virtualBottomSpacer}px` } }),
            )
          : h("div", { className: "empty-document" }, status === "uploading" ? TEXT.uploading : TEXT.uploadPrompt),
      ),
      h(
        "aside",
        { className: "thumbnail-panel" },
        h("h2", null, TEXT.thumbnails),
        h(
          "div",
          { ref: thumbnailPanelRef, className: "thumbnail-list" },
          pdfDoc
            ? pageNumbers.map((pageNumber) => h(ThumbnailPage, {
                key: pageNumber,
                pdfDoc,
                pageInfo: pageInfoByPage.get(pageNumber),
                pageNumber,
                isActive: pageNumber === currentPage,
                scrollRootRef: thumbnailPanelRef,
                onSelectPage: scrollToPage,
              }))
            : h("p", { className: "empty-note" }, TEXT.noFile),
        ),
      ),
    ),
  );
}
