export function normalizeRect(rect) {
  return {
    x0: Math.min(rect.x0, rect.x1),
    y0: Math.min(rect.y0, rect.y1),
    x1: Math.max(rect.x0, rect.x1),
    y1: Math.max(rect.y0, rect.y1),
  };
}


export function rectSize(rect) {
  const normalized = normalizeRect(rect);

  return {
    width: normalized.x1 - normalized.x0,
    height: normalized.y1 - normalized.y0,
  };
}


export function roundRect(rect, precision = 2) {
  const multiplier = 10 ** precision;

  return {
    x0: Math.round(rect.x0 * multiplier) / multiplier,
    y0: Math.round(rect.y0 * multiplier) / multiplier,
    x1: Math.round(rect.x1 * multiplier) / multiplier,
    y1: Math.round(rect.y1 * multiplier) / multiplier,
  };
}


export function viewportRectToPdfRect(viewport, viewportRect) {
  const rect = normalizeRect(viewportRect);
  const pointA = viewport.convertToPdfPoint(rect.x0, rect.y0);
  const pointB = viewport.convertToPdfPoint(rect.x1, rect.y1);

  return roundRect(
    normalizeRect({
      x0: pointA[0],
      y0: pointA[1],
      x1: pointB[0],
      y1: pointB[1],
    }),
  );
}


export function pdfRectToViewportRect(viewport, pdfRect) {
  const rect = normalizeRect(pdfRect);
  const viewportRect = viewport.convertToViewportRectangle([
    rect.x0,
    rect.y0,
    rect.x1,
    rect.y1,
  ]);

  return normalizeRect({
    x0: viewportRect[0],
    y0: viewportRect[1],
    x1: viewportRect[2],
    y1: viewportRect[3],
  });
}

