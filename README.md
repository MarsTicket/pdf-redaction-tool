# PDF Redaction MVP

PDF.js로 페이지를 렌더링하고, 사용자가 지정한 사각형 영역을 PyMuPDF의 실제 redaction 기능으로 적용하는 1차 MVP입니다.

## Structure

- `backend/`: FastAPI + PyMuPDF API server
- `frontend/`: Vite + React + PDF.js UI

## Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

API:

- `POST /api/upload`: PDF 업로드 및 페이지 메타데이터 반환
- `POST /api/redact`: page/type/rect redaction 목록을 실제 PDF redaction으로 적용
- `GET /api/download/{id}`: 결과 PDF 다운로드

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

기본 API 주소는 `http://localhost:8000`입니다. 다른 주소를 쓰려면 `VITE_API_BASE_URL`을 설정합니다.

## Redaction Data

프론트엔드는 화면 좌표를 PDF.js viewport 변환 함수로 원본 PDF 좌표에 맞춘 뒤 다음 형태로 저장합니다.

```json
{
  "page": 1,
  "type": "area",
  "rect": {
    "x0": 120.5,
    "y0": 300.2,
    "x1": 250.8,
    "y1": 322.6
  }
}
```

백엔드는 PDF 원본 좌표를 PyMuPDF 좌표로 변환한 후 `add_redact_annot`와 `apply_redactions`를 호출합니다.

## Next Steps

- 텍스트 선택 기반 redaction을 별도 selector로 추가
- OCR 기반 영역 후보 추출 추가
- 자동 개인정보 탐지 결과를 같은 redaction 데이터 구조에 병합

