# Windows 실행 파일 빌드 및 사용 방법

이 프로젝트는 React 프론트엔드를 정적 파일로 빌드한 뒤 FastAPI 백엔드가 함께 서빙하도록 구성되어 있습니다.

## 실행 파일 만들기

PowerShell에서 프로젝트 루트로 이동한 뒤 아래 명령을 실행합니다.

```powershell
cd V:\dev\codex-ssam\pdf-editor-tool
.\build_exe.ps1
```

PowerShell 실행 정책 때문에 스크립트가 차단되면 아래처럼 이번 실행에만 우회 옵션을 적용합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
```

빌드가 끝나면 아래 파일이 생성됩니다.

```text
dist\v0.1.0\PDFRedactionTool\PDFRedactionTool.exe
```

기존 실행 파일이 열려 있으면 같은 버전 결과물을 덮어쓸 수 없습니다. 빌드 전에 실행 중인 `PDFRedactionTool.exe` 콘솔 창을 먼저 닫습니다.

최종 배포 파일은 `dist\v버전명` 폴더에서만 관리합니다. 앞으로 `latest` 폴더나 `PDFRedactionTool_latest.exe` 파일은 사용하지 않습니다.

## 실행 파일 사용 방법

`dist\v0.1.0\PDFRedactionTool\PDFRedactionTool.exe`를 더블클릭하면 로컬 서버가 실행되고 기본 브라우저가 자동으로 열립니다.

NAS 또는 네트워크 공유 폴더에서 실행 파일에 접근할 수 없다는 Windows 네트워크 오류가 발생하면, `dist\v0.1.0` 폴더 전체를 로컬 디스크로 복사한 뒤 실행합니다.

```text
C:\PDFRedactionTool\v0.1.0\PDFRedactionTool.exe
```

네트워크 공유에서 직접 실행해야 한다면 `Run_Local.bat`을 실행합니다. 이 파일은 같은 폴더의 `PDFRedactionTool` 앱 폴더를 `%LOCALAPPDATA%\PDFRedactionTool\v0.1.0`으로 복사한 뒤 로컬 복사본을 실행합니다.

브라우저가 자동으로 열리지 않으면 실행 창에 표시된 주소 또는 아래 형식의 주소로 접속합니다.

```text
http://127.0.0.1:8000
```

8000번 포트가 이미 사용 중이면 실행 파일이 가까운 빈 포트를 찾아 실행합니다.

## 종료 방법

실행 파일과 함께 열린 콘솔 창을 닫거나 `Ctrl + C`를 누르면 로컬 서버가 종료됩니다.

## 사용 흐름

1. PDF를 업로드합니다.
2. 페이지 위에서 블랙마킹 영역을 사각형으로 지정합니다.
3. 필요한 경우 영역을 이동하거나 크기를 조정합니다.
4. `블랙마킹 적용`을 누릅니다.
5. 생성된 `Redacted_원본파일명.pdf` 파일을 다운로드합니다.

실제 PDF 내부 데이터 제거는 PyMuPDF의 redaction 기능으로 처리되며, 화면 위에 검은 박스를 덮는 방식이 아닙니다.
