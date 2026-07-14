@echo off
REM bowling3d playtest. English-only, CRLF.
cd /d "%~dp0"
echo Starting 3D Bowling ...
if not exist "node_modules" call npm install
call npm run dev -- --open
pause
