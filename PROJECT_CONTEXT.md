# PDF Redaction Tool 프로젝트 컨텍스트

## 프로젝트 개요

- 목적: PDF를 업로드하고 사용자가 지정한 사각형 영역을 실제 PDF redaction으로 적용한 뒤 새 PDF로 다운로드하는 Windows용 도구.
- 작업 경로: `V:\dev\codex-ssam\pdf-editor-tool`
- 현재 버전: `0.1.0`
- Frontend: Vite + React + PDF.js
- Backend: FastAPI + PyMuPDF
- Windows 배포: PyInstaller `onedir` 방식

## 주요 기능 상태

- PDF 업로드 및 드래그 앤 드롭 업로드
- PDF.js 기반 페이지 렌더링
- 페이지 맞춤 모드와 스크롤 모드
- 확대/축소, Ctrl + 마우스휠 확대/축소
- 페이지 번호 이동, 썸네일 이동
- redaction 사각형 추가, 선택, 이동, 크기 조절
- Shift + resize 비율 유지
- 방향키 미세 이동: 방향키 1 단위, Shift + 방향키 10 단위
- 빈 PDF 영역 클릭 시 선택 객체 해제
- Undo/Redo: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z 및 상단 SVG 버튼
- 단어 검색, 검색 결과 이동, 현재 결과 하이라이트
- 검색 결과 패널은 상단 검색 영역 내부에 표시되며 외부 클릭/ESC/결과 선택 시 닫힘
- 작업 저장/불러오기 JSON
- PyMuPDF `add_redact_annot` + `apply_redactions` 기반 실제 redaction
- 다운로드 파일명: `Redacted_원본파일명.pdf`

## 주요 파일

- `frontend/src/App.js`
  - React UI의 대부분이 들어 있는 핵심 파일.
  - JSX가 아니라 `const h = React.createElement;` 패턴을 사용한다.
  - 페이지 렌더링, 가상 렌더링, redaction 객체 조작, 검색, undo/redo, view mode 로직이 포함되어 있다.
- `frontend/src/styles.css`
  - 전체 UI 스타일.
  - 좌측 패널, 상단 검색 영역, PDF 페이지, redaction box, 썸네일 스타일이 포함되어 있다.
- `frontend/src/api.js`
  - API 호출 래퍼.
  - 개발 모드에서는 `http://localhost:8000`, 빌드 결과물에서는 `window.location.origin`을 사용한다.
- `frontend/src/pdfCoordinates.js`
  - PDF.js viewport 좌표와 PDF 원본 좌표 변환 유틸.
  - redaction 좌표 구조와 직접 연결되므로 임의 수정 금지.
- `backend/app.py`
  - FastAPI 앱.
  - `/api/upload`, `/api/redact`, `/api/download/{id}` 제공.
  - PyInstaller frozen 실행 시 경로를 보정하고 `frontend/dist` 정적 파일을 서빙한다.
- `backend/coordinates.py`
  - PDF 원본 좌표를 PyMuPDF 좌표로 변환한다.
  - redaction 영역 확대 문제를 줄이기 위한 clipping/epsilon 로직이 있다.
- `launcher.py`
  - Windows 실행 파일 진입점.
  - 사용 가능한 localhost 포트를 찾고 브라우저를 자동으로 연다.
- `PDFRedactionTool.spec`
  - PyInstaller 설정.
  - 현재는 백신 오탐 가능성을 낮추기 위해 `onedir`, `upx=False`, `exclude_binaries=True` 구조를 사용한다.
- `build_exe.ps1`
  - 프론트엔드 빌드, Python 의존성 설치, PyInstaller 빌드, 결과물 정리를 수행한다.
- `WINDOWS_EXE.md`
  - Windows 실행 파일 빌드 및 사용 방법 문서.

## 현재 배포 결과물 구조

최종 배포 결과물은 `dist` 아래 버전 폴더 기준으로 관리한다.

```text
dist/
  v0.1.0/
    PDFRedactionTool/
      PDFRedactionTool.exe
      _internal/
    Run_Local.bat
```

- 직접 실행 권장 경로: `dist\v0.1.0\PDFRedactionTool\PDFRedactionTool.exe`
- 네트워크 공유/NAS에서 실행할 때는 `dist\v0.1.0\Run_Local.bat`을 사용한다.
- `latest` 폴더나 `PDFRedactionTool_latest.exe`는 사용하지 않는다.

## 배포 관련 주의사항

- PyInstaller 단일 exe는 Avast 등 백신에서 오탐될 수 있어 현재는 `onedir` 방식으로 변경되어 있다.
- 그래도 백신 격리가 발생하면 관리자 권한보다 다음 대응이 현실적이다.
  - Avast 예외 목록에 배포 폴더 추가
  - 배포 파일 오탐 신고
  - 코드 서명 인증서 적용
- NAS/네트워크 공유에서 직접 exe 실행이 막힐 수 있으므로 `Run_Local.bat` 또는 로컬 디스크 복사를 권장한다.

## 검증 명령

```powershell
cd V:\dev\codex-ssam\pdf-editor-tool
node --check frontend\src\App.js
node --check frontend\src\api.js
.\backend\.venv\Scripts\python.exe -m py_compile backend\app.py launcher.py backend\coordinates.py
powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
```

프론트엔드만 확인할 때:

```powershell
cd V:\dev\codex-ssam\pdf-editor-tool\frontend
npm run build
```

## 실제 실행 방식

개발 모드:

```powershell
cd V:\dev\codex-ssam\pdf-editor-tool\backend
.\.venv\Scripts\Activate.ps1
uvicorn app:app --reload --host 127.0.0.1 --port 8000

cd V:\dev\codex-ssam\pdf-editor-tool\frontend
npm run dev
```

배포 모드:

```text
dist\v0.1.0\PDFRedactionTool\PDFRedactionTool.exe
```

또는 네트워크 공유에서는:

```text
dist\v0.1.0\Run_Local.bat
```
