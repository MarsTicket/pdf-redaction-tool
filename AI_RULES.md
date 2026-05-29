# AI 작업 규칙

## 기본 원칙

- 작업 경로는 `V:\dev\codex-ssam\pdf-editor-tool`을 기준으로 한다.
- 기존 구조를 유지하고 필요한 최소 파일만 수정한다.
- 한국어 UI 문구와 문서 내용을 보존한다.
- 텍스트 파일은 UTF-8 without BOM을 유지한다.
- 터미널 출력의 한글 깨짐만 보고 파일 인코딩이 깨졌다고 판단하지 않는다.
- 전체 재작성, 대규모 리팩터링, 폴더 구조 변경은 명시 요청이 없으면 하지 않는다.
- PHP 실행 테스트는 시도하지 않는다.
- 실제 PDF 실행 검증은 사용자가 명시하지 않으면 하지 않는다.

## 파일 수정 규칙

- 파일 검색은 우선 `rg` 또는 `rg --files`를 사용한다.
- 수동 파일 수정은 `apply_patch`를 사용한다.
- 한국어가 포함된 파일은 수정 후 해당 영역을 다시 열어 확인한다.
- UTF-8 BOM 여부를 확인한다.
- 기존 사용자 변경을 되돌리지 않는다.
- 불필요한 formatting churn을 만들지 않는다.

## 프론트엔드 규칙

- `frontend/src/App.js`는 JSX가 아니라 `React.createElement` 별칭 `h`를 사용한다.
- 기존 함수명, 상태명, 컴포넌트 구조를 최대한 유지한다.
- 새 라이브러리는 꼭 필요한 경우가 아니면 추가하지 않는다.
- 대규모 상태관리 라이브러리를 도입하지 않는다.
- 사용자에게 보이는 문구는 한글로 작성한다.
- 검색 결과는 redaction 객체로 자동 추가하지 않는다.
- 검색 UI는 상단 검색 영역 내부 패널로 관리한다. 화면 위에 남는 absolute 팝업 형태로 되돌리지 않는다.
- redaction 객체 선택 해제는 빈 PDF 영역 클릭에서만 동작해야 한다.
- 객체 본문, resize 핸들, 좌측 선택영역 클릭과 선택 해제가 충돌하면 안 된다.
- 선택 해제는 Undo/Redo history에 기록하지 않는다.

## 좌표 및 redaction 규칙

- redaction 저장 데이터 구조는 유지한다.

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

- 화면 좌표와 PDF 원본 좌표 변환은 `frontend/src/pdfCoordinates.js`에서 관리한다.
- PyMuPDF 좌표 변환은 `backend/coordinates.py`에서 관리한다.
- 기존 좌표 변환 로직은 명시 요청 없이 변경하지 않는다.
- 단순 검은 박스 오버레이로 끝내면 안 된다.
- 실제 redaction은 PyMuPDF `add_redact_annot`와 `apply_redactions`를 사용해야 한다.
- 백엔드 redaction 저장 로직은 필요한 경우에만 최소 수정한다.

## 페이지/렌더링 규칙

- 페이지 수가 많은 PDF를 고려한다.
- 모든 페이지를 불필요하게 한 번에 렌더링하지 않는다.
- virtual rendering 구조를 유지한다.
- 페이지 맞춤 모드에서 Ctrl + wheel 전환 시 현재 페이지와 마우스 기준점을 잃지 않도록 한다.
- smooth scroll은 페이지 이동/썸네일 이동/검색 이동/선택영역 이동에 사용하지 않는다.
- 즉시 이동은 `scrollTop` 직접 설정 또는 `behavior: "auto"`만 사용한다.

## Windows 배포 규칙

- 최종 배포 결과물은 `dist` 아래 버전 폴더 기준으로 관리한다.

```text
dist/
  v0.1.0/
    PDFRedactionTool/
      PDFRedactionTool.exe
      _internal/
    Run_Local.bat
```

- `latest` 폴더나 `PDFRedactionTool_latest.exe`를 다시 만들지 않는다.
- 현재 PyInstaller는 `onedir` 방식이다. Avast 오탐 가능성 때문에 단일 exe 방식으로 되돌리지 않는다.
- `PDFRedactionTool.spec`에서 `upx=False`를 유지한다.
- NAS/네트워크 공유 실행은 `Run_Local.bat`을 권장한다.
- 빌드 후 `frontend/dist`, `build` 같은 임시 산출물은 정리한다.

## 검증 규칙

코드 변경 후 최소 검증:

```powershell
node --check frontend\src\App.js
node --check frontend\src\api.js
```

백엔드 또는 launcher 변경 시:

```powershell
.\backend\.venv\Scripts\python.exe -m py_compile backend\app.py launcher.py backend\coordinates.py
```

빌드 스크립트 변경 시:

```powershell
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'build_exe.ps1'), [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) { $errors | Format-List *; exit 1 }
```

최종 배포물 갱신 시:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
```

## Git 커밋 메시지 규칙

- `feat`: 새로운 기능 추가
- `fix`: 버그 수정
- `refactor`: 기능 변화 없이 코드 구조 개선
- `style`: 코드 스타일 수정
- `docs`: 문서 수정
- `test`: 테스트 코드 추가/수정
- `chore`: 빌드, 설정, 패키지 등 기타 작업

예:

```text
feat(login): 소셜 로그인 기능 추가
fix(redaction): 페이지 맞춤 확대 기준점 보정
docs(build): Windows 배포 방법 정리
```
