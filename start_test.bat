@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND_DIR=%ROOT%\backend"
set "FRONTEND_DIR=%ROOT%\frontend"
set "TMP_DIR=%ROOT%\tmp"
set "BACKEND_PY=%BACKEND_DIR%\.venv\Scripts\python.exe"
set "BACKEND_PORT=8010"
set "FRONTEND_PORT=5173"
set "PDF_TOOL_ROOT=%ROOT%"

if not exist "%TMP_DIR%" mkdir "%TMP_DIR%"

if not exist "%BACKEND_DIR%\app.py" (
  echo Backend app.py not found: "%BACKEND_DIR%"
  exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
  echo Frontend package.json not found: "%FRONTEND_DIR%"
  exit /b 1
)

if not exist "%BACKEND_PY%" (
  echo Creating backend virtual environment...
  py -3 -m venv "%BACKEND_DIR%\.venv"
  if errorlevel 1 python -m venv "%BACKEND_DIR%\.venv"
  if errorlevel 1 (
    echo Failed to create backend virtual environment.
    exit /b 1
  )
)

echo Installing backend dependencies if needed...
"%BACKEND_PY%" -m pip install -r "%BACKEND_DIR%\requirements.txt" > "%TMP_DIR%\pip-install.log" 2> "%TMP_DIR%\pip-install.err.log"
if errorlevel 1 (
  echo Backend dependency install failed. See "%TMP_DIR%\pip-install.err.log".
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js first.
  exit /b 1
)

if not exist "%FRONTEND_DIR%\node_modules" (
  echo Installing frontend dependencies...
  pushd "%FRONTEND_DIR%"
  call npm install
  if errorlevel 1 (
    popd
    echo Frontend dependency install failed.
    exit /b 1
  )
  popd
)

echo Starting backend on http://127.0.0.1:%BACKEND_PORT% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=$env:PDF_TOOL_ROOT; $backendDir=Join-Path $root 'backend'; $tmpDir=Join-Path $root 'tmp'; $py=Join-Path $backendDir '.venv\Scripts\python.exe'; if (-not (Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue)) { $p=Start-Process -FilePath $py -ArgumentList @('-m','uvicorn','app:app','--reload','--host','127.0.0.1','--port','8010') -WorkingDirectory $backendDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $tmpDir 'backend-dev.log') -RedirectStandardError (Join-Path $tmpDir 'backend-dev.err.log') -PassThru; $p.Id | Set-Content -Encoding ascii (Join-Path $tmpDir 'backend.pid'); Write-Host ('Backend started: ' + $p.Id) } else { Write-Host 'Backend already running.' }"
if errorlevel 1 exit /b 1

echo Starting frontend on http://127.0.0.1:%FRONTEND_PORT% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=$env:PDF_TOOL_ROOT; $frontendDir=Join-Path $root 'frontend'; $tmpDir=Join-Path $root 'tmp'; if (-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) { $env:VITE_API_BASE_URL='http://127.0.0.1:8010'; $p=Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','dev','--','--host','127.0.0.1','--port','5173') -WorkingDirectory $frontendDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $tmpDir 'frontend-dev.log') -RedirectStandardError (Join-Path $tmpDir 'frontend-dev.err.log') -PassThru; $p.Id | Set-Content -Encoding ascii (Join-Path $tmpDir 'frontend.pid'); Write-Host ('Frontend started: ' + $p.Id) } else { Write-Host 'Frontend already running.' }"
if errorlevel 1 exit /b 1

echo Waiting for frontend response...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(40); do { try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo Frontend did not respond yet. Check "%TMP_DIR%\frontend-dev.err.log".
) else (
  echo Test server is ready.
)

start "" "http://127.0.0.1:%FRONTEND_PORT%/"
endlocal
