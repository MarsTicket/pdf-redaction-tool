@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PDF_TOOL_ROOT=%ROOT%"

echo Stopping test servers...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=$env:PDF_TOOL_ROOT; $tmpDir=Join-Path $root 'tmp'; function Stop-Tree([int]$pidValue) { $children=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ParentProcessId -eq $pidValue }; foreach ($child in $children) { Stop-Tree ([int]$child.ProcessId) }; Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue }; foreach ($name in @('frontend.pid','backend.pid')) { $path=Join-Path $tmpDir $name; if (Test-Path $path) { $pidText=Get-Content -LiteralPath $path -ErrorAction SilentlyContinue | Select-Object -First 1; $pidValue=0; if ([int]::TryParse($pidText, [ref]$pidValue)) { Stop-Tree $pidValue; Write-Host ('Stopped PID from ' + $name + ': ' + $pidValue) }; Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue } }; foreach ($port in @(5173,8010)) { $conns=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; foreach ($conn in $conns) { if ($conn.OwningProcess -and $conn.OwningProcess -ne 0) { Stop-Tree ([int]$conn.OwningProcess); Write-Host ('Stopped port ' + $port + ' PID: ' + $conn.OwningProcess) } } }"
if errorlevel 1 exit /b 1

echo Done.
endlocal
