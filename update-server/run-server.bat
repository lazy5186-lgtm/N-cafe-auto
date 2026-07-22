@echo off
REM ---------------------------------------------------------------------------
REM  N Cafe Auto - code-swap update server launcher (Windows / Task Scheduler)
REM
REM  Registered as a scheduled task that runs at system startup under SYSTEM,
REM  so the server comes up after a reboot WITHOUT anyone logging in.
REM  Register/unregister:  see update-server\Windows-setup.md
REM
REM  NOTE: keep this file ASCII-only. It is executed by SYSTEM with the OEM
REM  codepage, and non-ASCII bytes here can break command parsing.
REM  (The server's own Korean console output is fine - it just goes to the log.)
REM ---------------------------------------------------------------------------

set "PROJECT_DIR=C:\Users\coala\OneDrive\Desktop\ASC\N_cafe_auto"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "LOG_DIR=C:\ProgramData\n-cafe-auto-update"

REM Logs live OUTSIDE the project folder on purpose: the project sits in OneDrive,
REM and an always-appending log there would cause endless sync churn.
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

cd /d "%PROJECT_DIR%" || (
  echo [%date% %time%] FATAL: project dir not found: %PROJECT_DIR% >> "%LOG_DIR%\server.log"
  exit /b 1
)

echo. >> "%LOG_DIR%\server.log"
echo [%date% %time%] starting update server >> "%LOG_DIR%\server.log"

"%NODE_EXE%" update-server\server.js >> "%LOG_DIR%\server.log" 2>&1

echo [%date% %time%] server exited with code %errorlevel% >> "%LOG_DIR%\server.log"
exit /b %errorlevel%
