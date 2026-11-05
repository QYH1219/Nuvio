@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  if defined NUVIO_HIDDEN (
    echo [nuvio] Node.js 22 or newer is required.>>"%TEMP%\nuvio-launch.log"
    exit /b 1
  )
  echo [nuvio] Node.js 22 or newer is required.
  echo [nuvio] Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if defined NUVIO_HIDDEN (
  node tools\start.mjs %* >>"%TEMP%\nuvio-launch.log" 2>&1
) else (
  node tools\start.mjs %*
)
set "CXD_EXIT=%ERRORLEVEL%"
if not "%CXD_EXIT%"=="0" (
  if defined NUVIO_HIDDEN (
    echo [nuvio] start failed with exit code %CXD_EXIT%.>>"%TEMP%\nuvio-launch.log"
    exit /b %CXD_EXIT%
  )
  echo.
  echo [nuvio] start failed with exit code %CXD_EXIT%.
  pause
)
exit /b %CXD_EXIT%
