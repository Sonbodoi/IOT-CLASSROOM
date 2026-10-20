@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === IoT Classroom - Che do MO PHONG ===
where node >nul 2>&1
if errorlevel 1 (
  echo Chua cai Node.js. Cai tai https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules\express\package.json (
  echo Dang cai thu vien Node.js...
  call npm install
  if errorlevel 1 (pause & exit /b 1)
)
echo Mo http://localhost:3000/login.html trong Chrome sau khi server chay.
call npm run demo
pause
