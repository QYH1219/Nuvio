@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [cxd] Node.js 22 or newer is required.
  echo [cxd] Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

echo [cxd] This will close Codex, reopen it with a debugging port, then inject the background.
node tools\restart.mjs %*
set "CXD_EXIT=%ERRORLEVEL%"
if not "%CXD_EXIT%"=="0" (
  echo.
  echo [cxd] restart failed with exit code %CXD_EXIT%.
  pause
)
exit /b %CXD_EXIT%
