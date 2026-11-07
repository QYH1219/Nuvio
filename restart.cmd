@echo off
setlocal
cd /d "%~dp0"

set "NODE_BIN=%~dp0runtime\node.exe"
if exist "%NODE_BIN%" goto have_node
set "NODE_BIN="
for %%N in (node.exe) do set "NODE_BIN=%%~$PATH:N"
if not defined NODE_BIN (
  echo [nuvio] Node.js 22 or newer is required.
  echo [nuvio] Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

:have_node
echo [nuvio] This will close Codex, reopen it with a debugging port, then inject the background.
"%NODE_BIN%" tools\restart.mjs %*
set "CXD_EXIT=%ERRORLEVEL%"
if not "%CXD_EXIT%"=="0" (
  echo.
  echo [nuvio] restart failed with exit code %CXD_EXIT%.
  pause
)
exit /b %CXD_EXIT%
