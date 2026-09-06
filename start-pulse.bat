@echo off
setlocal
title Pulse Launcher
cd /d "%~dp0"

rem ---- Resolve Node.js ----
if exist "C:\Program Files\nodejs\node.exe" (
  set "PATH=C:\Program Files\nodejs;%PATH%"
  goto :node_ok
)
if exist "%USERPROFILE%\.node\current\node.exe" (
  set "PATH=%USERPROFILE%\.node\current;%PATH%"
  goto :node_ok
)
echo [Pulse] Node.js was not found.
echo         Install Node.js 20+ from https://nodejs.org/ or place a portable copy at
echo         %USERPROFILE%\.node\current\node.exe
pause
exit /b 1

:node_ok
rem ---- Check environment file ----
if not exist ".env.local" (
  echo [Pulse] .env.local is missing.
  echo         1. Copy .env.example to .env.local
  echo         2. Replace [YOUR-PASSWORD] in DATABASE_URL with the Supabase database password
  echo         3. Run this launcher again
  pause
  exit /b 1
)

rem ---- Install dependencies on first run ----
if not exist "node_modules" (
  echo [Pulse] Installing dependencies - first run...
  call npm install
  if errorlevel 1 (
    echo [Pulse] npm install failed.
    pause
    exit /b 1
  )
)

rem ---- Build once (production mode starts in ~1 s and is steadier than dev mode for a kiosk) ----
if not exist ".next\BUILD_ID" (
  echo [Pulse] Building the dashboard - first run, takes about a minute...
  call npm run build
  if errorlevel 1 (
    echo [Pulse] Build failed.
    pause
    exit /b 1
  )
)

rem ---- Start the dashboard ----
echo [Pulse] Starting dashboard on http://localhost:3000 ...
start "Pulse Dashboard" cmd /k "npm start"

rem ---- Wait for Next.js, then open the kiosk ----
timeout /t 6 /nobreak >nul

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo [Pulse] Chrome not found - open http://localhost:3000 in a browser manually.
  pause
  exit /b 0
)

start "" "%CHROME%" --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir="C:\PulseKiosk" http://localhost:3000
endlocal
