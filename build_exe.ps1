$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $Root "frontend"
$VenvPython = Join-Path $Root "backend\.venv\Scripts\python.exe"
$PackageJsonPath = Join-Path $FrontendDir "package.json"
$Package = Get-Content -Raw -Encoding UTF8 $PackageJsonPath | ConvertFrom-Json
$VersionName = if ([string]::IsNullOrWhiteSpace($Package.version)) { "v1.0.0" } else { "v$($Package.version)" }
$DistDir = Join-Path $Root "dist"
$VersionDistDir = Join-Path $DistDir $VersionName
$AppDistDir = Join-Path $VersionDistDir "PDFRedactionTool"
$WorkDir = Join-Path $Root "build"
$FrontendBuildDir = Join-Path $FrontendDir "dist"

if (-not (Test-Path $VenvPython)) {
  python -m venv (Join-Path $Root "backend\.venv")
  if ($LASTEXITCODE -ne 0) {
    throw "Python virtual environment creation failed."
  }
}

Push-Location $FrontendDir
try {
  npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed."
  }

  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed."
  }
}
finally {
  Pop-Location
}

& $VenvPython -m pip install -r (Join-Path $Root "backend\requirements.txt") "pyinstaller>=6,<7"
if ($LASTEXITCODE -ne 0) {
  throw "Python dependency installation failed."
}

if (Test-Path $VersionDistDir) {
  Remove-Item -LiteralPath $VersionDistDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $VersionDistDir | Out-Null

& $VenvPython -m PyInstaller `
  --clean `
  --noconfirm `
  --distpath $VersionDistDir `
  --workpath $WorkDir `
  (Join-Path $Root "PDFRedactionTool.spec")
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller build failed. Close the running PDFRedactionTool.exe for this version, then build again."
}

if (-not (Test-Path (Join-Path $AppDistDir "PDFRedactionTool.exe"))) {
  throw "PyInstaller output was not created at $AppDistDir"
}

$RunLocalPath = Join-Path $VersionDistDir "Run_Local.bat"
$RunLocalContent = @"
@echo off
setlocal
set "SRC_DIR=%~dp0PDFRedactionTool"
set "TARGET_DIR=%LOCALAPPDATA%\PDFRedactionTool\$VersionName\PDFRedactionTool"
set "TARGET=%TARGET_DIR%\PDFRedactionTool.exe"

if not exist "%SRC_DIR%\PDFRedactionTool.exe" (
  echo PDFRedactionTool app folder not found next to this launcher.
  pause
  exit /b 1
)

mkdir "%TARGET_DIR%" >nul 2>nul
robocopy "%SRC_DIR%" "%TARGET_DIR%" /E /NFL /NDL /NJH /NJS /NC /NS >nul
if errorlevel 8 (
  echo Failed to copy PDFRedactionTool to local app data.
  echo Copy this version folder to a local drive and run PDFRedactionTool.exe there.
  pause
  exit /b 1
)

start "" "%TARGET%"
endlocal
"@
Set-Content -LiteralPath $RunLocalPath -Value $RunLocalContent -Encoding ascii

if (Test-Path $WorkDir) {
  Remove-Item -LiteralPath $WorkDir -Recurse -Force
}

if (Test-Path $FrontendBuildDir) {
  Remove-Item -LiteralPath $FrontendBuildDir -Recurse -Force
}

Write-Host "Executable created: $(Join-Path $AppDistDir 'PDFRedactionTool.exe')"
Write-Host "Network-share launcher created: $RunLocalPath"
