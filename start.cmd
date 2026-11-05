@echo off
setlocal
cd /d "%~dp0"
set "NUVIO_LOG=%TEMP%\nuvio-launch.log"

if defined NUVIO_HIDDEN call :rotate_log

where node >nul 2>nul
if errorlevel 1 (
  if defined NUVIO_HIDDEN (
    echo [nuvio] Node.js 22 or newer is required.>>"%NUVIO_LOG%"
    exit /b 1
  )
  echo [nuvio] Node.js 22 or newer is required.
  echo [nuvio] Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if defined NUVIO_HIDDEN (
  echo [nuvio] %DATE% %TIME% launch>>"%NUVIO_LOG%"
  node tools\start.mjs %* >>"%NUVIO_LOG%" 2>&1
) else (
  node tools\start.mjs %*
)
set "CXD_EXIT=%ERRORLEVEL%"
if not "%CXD_EXIT%"=="0" (
  if defined NUVIO_HIDDEN (
    echo [nuvio] start failed with exit code %CXD_EXIT%.>>"%NUVIO_LOG%"
    exit /b %CXD_EXIT%
  )
  echo.
  echo [nuvio] start failed with exit code %CXD_EXIT%.
  pause
)
exit /b %CXD_EXIT%

:rotate_log
if not exist "%NUVIO_LOG%" exit /b 0
for %%A in ("%NUVIO_LOG%") do if %%~zA GTR 262144 (
  if exist "%NUVIO_LOG%.1" del /q "%NUVIO_LOG%.1" >nul 2>nul
  move /Y "%NUVIO_LOG%" "%NUVIO_LOG%.1" >nul 2>nul
)
exit /b 0
