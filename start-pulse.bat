@echo off
REM Pulse launcher — starts the HMI bridge, the dashboard, and opens the kiosk view.
REM Prerequisite: FortiClient "PLC" VPN connected, and NO other browser tab on 192.168.0.51.
cd /d %~dp0

echo Starting Pulse bridge (HMI reader) ...
start "Pulse Bridge" cmd /k "node bridge\server.js"

timeout /t 4 >nul

echo Starting Pulse dashboard ...
start "Pulse Dashboard" cmd /k "npm run dev"

timeout /t 10 >nul

echo Opening kiosk view ...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir="C:\PulseKiosk" http://localhost:3000

echo.
echo Pulse is starting. Bridge: http://localhost:4000/api/plc  Dashboard: http://localhost:3000
echo Close this window when done, then close the two Pulse windows.
