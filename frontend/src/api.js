export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? "http://localhost:8000" : window.location.origin);

const ERROR_MESSAGES = {
  "Only PDF files are supported": "PDF 파일만 업로드할 수 있습니다.",
  "Empty upload": "빈 파일은 업로드할 수 없습니다.",
  "Invalid PDF file": "올바른 PDF 파일이 아닙니다.",
  "PDF has no pages": "페이지가 없는 PDF입니다.",
  "At least one redaction is required": "하나 이상의 영역을 선택하세요.",
  "Invalid file id": "파일 식별자가 올바르지 않습니다.",
  "Uploaded PDF not found": "업로드된 PDF를 찾을 수 없습니다.",
  "Unable to open uploaded PDF": "업로드된 PDF를 열 수 없습니다.",
  "Redacted PDF not found": "블랙마킹 결과 PDF를 찾을 수 없습니다.",
};


function getErrorMessage(payload, status) {
  const detail = payload?.detail;

  if (typeof detail === "string") {
    return ERROR_MESSAGES[detail] || "요청을 처리하지 못했습니다.";
  }

  if (Array.isArray(detail)) {
    return "요청 데이터가 올바르지 않습니다.";
  }

  return `요청 실패 (${status})`;
}


async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = getErrorMessage(payload, response.status);
    throw new Error(message);
  }

  return payload;
}


export async function uploadPdf(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: formData,
  });

  return parseJsonResponse(response);
}


export async function applyRedactions(fileId, redactions) {
  const response = await fetch(`${API_BASE_URL}/api/redact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fileId, redactions }),
  });

  return parseJsonResponse(response);
}


export async function snapTextRedactions({
  fileId,
  page,
  rect,
  mode = "char",
  expandToWord = false,
  excludeDotLeader = true,
  excludePageNumber = true,
}) {
  const response = await fetch(`${API_BASE_URL}/redactions/snap-text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileId,
      page,
      rect,
      mode,
      expandToWord,
      excludeDotLeader,
      excludePageNumber,
    }),
  });

  return parseJsonResponse(response);
}


export async function fetchTextMap({
  fileId,
  page,
  excludeDotLeader = true,
  excludePageNumber = true,
}) {
  const response = await fetch(`${API_BASE_URL}/redactions/text-map`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileId,
      page,
      excludeDotLeader,
      excludePageNumber,
    }),
  });

  return parseJsonResponse(response);
}


export function toDownloadUrl(downloadUrl) {
  if (!downloadUrl) {
    return "";
  }

  if (/^https?:\/\//i.test(downloadUrl)) {
    return downloadUrl;
  }

  return `${API_BASE_URL}${downloadUrl}`;
}
