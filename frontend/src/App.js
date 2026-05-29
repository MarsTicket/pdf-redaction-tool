import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

import { applyRedactions, toDownloadUrl, uploadPdf } from "./api.js";
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
const TEXT_REDACTION_HORIZONTAL_PADDING_MIN = 0.25;
const TEXT_REDACTION_HORIZONTAL_PADDING_MAX = 1.5;
const TEXT_SELECTION_ANCHOR_TOLERANCE = 4;
const TEXT_SELECTION_HOVER_TOLERANCE = 2;
const TEXT_RECT_ALIGNMENT_OFFSET_X = 1;
const TEXT_RECT_ALIGNMENT_OFFSET_Y = 1;
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

  const transformed = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const viewportScale = Number(viewport.scale) || 1;
  const itemWidth = Math.max(1, (Number(item.width) || text.length * 5) * viewportScale);
  const transformedHeight = Math.hypot(transformed[2], transformed[3]);
  const itemHeight = Math.max(1, (Number(item.height) || 0) * viewportScale, transformedHeight || 10);



  const safeIndex = clamp(index, 0, text.length);
  const safeLength = clamp(length ?? text.length, 0, text.length - safeIndex);
  const startRatio = safeIndex / text.length;
  const widthRatio = safeLength / text.length;
  const x0 = transformed[4] + (itemWidth * startRatio);
  const y1 = transformed[5];

  const viewportRect = normalizeRect({
    x0: x0 + TEXT_RECT_ALIGNMENT_OFFSET_X,
    y0: (y1 - itemHeight) + TEXT_RECT_ALIGNMENT_OFFSET_Y,
    x1: x0 + Math.max(TEXT_SELECTION_MIN_SIZE, itemWidth * widthRatio) + TEXT_RECT_ALIGNMENT_OFFSET_X,
    y1: y1 + 2 + TEXT_RECT_ALIGNMENT_OFFSET_Y,
  });

  return viewportRect;
}


/* ── Fallback: text-item based selection (used when native textLayer alignment fails) ── */

function getIntersectionArea(rectA, rectB) {
  const x0 = Math.max(rectA.x0, rectB.x0);
  const y0 = Math.max(rectA.y0, rectB.y0);
  const x1 = Math.min(rectA.x1, rectB.x1);
  const y1 = Math.min(rectA.y1, rectB.y1);

  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}


function isViewportRectSelected(selectionRect, candidateRect) {
  const candidateSize = rectSize(candidateRect);
  if (candidateSize.width <= 0 || candidateSize.height <= 0) {
    return false;
  }

  const verticalOverlap = Math.min(selectionRect.y1, candidateRect.y1) - Math.max(selectionRect.y0, candidateRect.y0);
  const horizontalOverlap = Math.min(selectionRect.x1, candidateRect.x1) - Math.max(selectionRect.x0, candidateRect.x0);

  if (verticalOverlap <= 0 || horizontalOverlap <= 0) {
    return false;
  }

  const verticalOverlapRatio = verticalOverlap / candidateSize.height;
  const horizontalOverlapRatio = horizontalOverlap / candidateSize.width;

  if (verticalOverlapRatio < 0.45) {
    return false;
  }

  if (candidateSize.width <= 14) {
    return horizontalOverlapRatio >= 0.18;
  }

  return horizontalOverlapRatio >= 0.35;
}


function expandViewportRect(rect, amount) {
  return {
    x0: rect.x0 - amount,
    y0: rect.y0 - amount,
    x1: rect.x1 + amount,
    y1: rect.y1 + amount,
  };
}


function getAnchorTextSelectionRect(anchor, current) {
  return expandViewportRect(
    normalizeRect({
      x0: anchor.x,
      y0: anchor.y,
      x1: current.x,
      y1: current.y,
    }),
    TEXT_SELECTION_ANCHOR_TOLERANCE,
  );
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


function tokenizeTextItem(text) {
  const tokens = [];
  const source = text || "";
  const pattern = /[가-힣]+|[A-Za-z]+(?:[.'\u2019_-][A-Za-z]+)*|\d+(?:[.,:-]\d+)*|[.\u00b7\u2022\u2027\u2219\u30fbㆍ·…]+|\s+|./g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const value = match[0];
    tokens.push({
      text: value,
      startIndex: match.index,
      endIndex: match.index + value.length,
      kind: getTextSegmentKind(value),
      isWhitespace: !value.trim(),
    });
  }

  return tokens;
}


function getTextItemTokenRects(viewport, item, itemIndex) {
  const text = item.str || "";
  const tokens = tokenizeTextItem(text);
  const visibleTokens = tokens.filter((token) => !token.isWhitespace);

  return visibleTokens
    .map((token, tokenIndex) => {
      const viewportRect = getTextItemViewportRect(
        viewport,
        item,
        token.startIndex,
        token.endIndex - token.startIndex,
      );

      if (!viewportRect) {
        return null;
      }

      const size = rectSize(viewportRect);
      if (size.width < TEXT_SELECTION_MIN_SIZE || size.height < TEXT_SELECTION_MIN_SIZE) {
        return null;
      }

      return {
        key: `${itemIndex}:${token.startIndex}:${token.endIndex}:${tokenIndex}`,
        text: token.text,
        kind: token.kind,
        viewportRect,
        centerY: getViewportRectCenterY(viewportRect),
        height: size.height,
        itemIndex,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
      };
    })
    .filter(Boolean);
}


function collectSelectedTextSegments(viewport, textItems, isTextRectSelected) {
  const segments = [];

  for (let itemIndex = 0; itemIndex < textItems.length; itemIndex += 1) {
    const item = textItems[itemIndex];
    const tokenRects = getTextItemTokenRects(viewport, item, itemIndex);



    for (const tokenRect of tokenRects) {
      if (tokenRect.kind === "empty") {
        continue;
      }

      if (isTextRectSelected(tokenRect.viewportRect)) {
        segments.push(tokenRect);
      }
    }
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


function getAnchorTextSelections(viewport, textItems, anchor, current) {
  if (!viewport || !anchor || !current) {
    return [];
  }

  const selectionRect = getAnchorTextSelectionRect(anchor, current);
  const selectedSegments = collectSelectedTextSegments(
    viewport,
    textItems,
    (charRect) => isViewportRectSelected(selectionRect, charRect),
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
  const textItemsRef = useRef([]);
  const [viewport, setViewport] = useState(null);
  const [drag, setDrag] = useState(null);
  const [editDrag, setEditDrag] = useState(null);
  const [textSelectionPreviewRects, setTextSelectionPreviewRects] = useState([]);
  const [renderState, setRenderState] = useState("idle");
  const isNearViewport = useNearViewport(pageRef, scrollRootRef);

  useEffect(() => {
    let cancelled = false;
    let renderTask = null;
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
    };
  }, [isNearViewport, pdfDoc, pageNumber, zoom]);

  useEffect(() => {
    let cancelled = false;

    if (!isNearViewport || markingMode !== MARKING_MODE_TEXT) {
      return () => {
        cancelled = true;
      };
    }

    async function loadTextItems() {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) {
          return;
        }

        const textContent = await page.getTextContent();
        if (cancelled) {
          return;
        }

        textItemsRef.current = textContent.items || [];
      } catch {
        textItemsRef.current = [];
      }
    }

    loadTextItems();

    return () => {
      cancelled = true;
    };
  }, [isNearViewport, markingMode, pageNumber, pdfDoc]);

  useEffect(() => {
    setDrag(null);
    setTextSelectionPreviewRects([]);
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
      const nextDrag = {
        ...drag,
        current: point,
      };

      const textItems = textItemsRef.current;
      if (textItems.length > 0 && activeViewport) {
        const textSelections = getAnchorTextSelections(
          activeViewport,
          textItems,
          nextDrag.start,
          nextDrag.current,
        );
        setTextSelectionPreviewRects(textSelections.map((selection) => selection.displayRect));
      }

      setDrag(nextDrag);
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
  }, [activeViewport, drag, editDrag, getLocalPoint, markingMode, onBeginRedactionEdit, onUpdateRedaction]);

  const finishDrag = useCallback((event) => {
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
      const movedEnough = Math.abs(current.x - drag.start.x) >= MIN_SELECTION_SIZE
        || Math.abs(current.y - drag.start.y) >= MIN_SELECTION_SIZE;

      if (movedEnough) {
        const textItems = textItemsRef.current;
        if (textItems.length > 0) {
          const textSelections = getAnchorTextSelections(
            activeViewport,
            textItems,
            drag.start,
            current,
          );
          const textRedactions = getTextSelectionRedactions(
            activeViewport,
            textSelections,
            pageNumber,
          );

          // DEV: text selection debug logging
          if (import.meta.env.DEV) {
            console.groupCollapsed("[TEXT_SELECTION_DEBUG]");
            console.log("Zoom:", activeViewport.scale);
            console.log("Start:", drag.start);
            console.log("End:", current);
            console.log("TextItems:", textItems.length);
            console.log("Selections:", textSelections.length);
            console.log("Redactions:", textRedactions.length);
            console.groupEnd();

            logTextSelectionRectDebug(
              activeViewport,
              textSelections,
              textRedactions,
              pageNumber,
            );
          }

          if (textRedactions.length > 0) {
            onAddRedactions(textRedactions);
          }
        }
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
  }, [activeViewport, drag, editDrag, getLocalPoint, onAddRedaction, onAddRedactions, pageNumber]);

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
  ].filter(Boolean).join(" ");

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
      textSelectionPreviewRects.map((rect, index) => h("div", {
        key: `text-selection-preview-${index}`,
        className: "text-selection-preview",
        style: toBoxStyle(rect),
      })),
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
      if (event.ctrlKey || event.altKey || event.metaKey || isEditableEventTarget(event.target)) {
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
      setIsSearchPanelOpen(false);
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
  }, [pageInfoByPage, pdfDoc, renderZoom, scrollToPage, searchInput]);

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
              setSearchInput(event.target.value);
              if (!event.target.value.trim()) {
                setIsSearchPanelOpen(false);
              }
            },
            onFocus: () => {
              if (searchTerm) {
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
        isSearchPanelOpen && searchTerm ? h(
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
