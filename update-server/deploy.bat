@echo off
REM ---------------------------------------------------------------------------
REM  N Cafe Auto - code-swap deploy launcher (double-click me)
REM
REM  Rebuilds dist-src, checks versions, and restarts the update server.
REM  Real logic lives in deploy.ps1 - this only picks a PowerShell host and
REM  keeps the console window open so you can read the result.
REM
REM  Keep this file ASCII-only (OEM codepage); Korean output comes from the .ps1.
REM ---------------------------------------------------------------------------

REM Prefer PowerShell 7 (pwsh): Windows PowerShell 5.1 mangles UTF-8 Korean.
where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
)

echo.
pause
