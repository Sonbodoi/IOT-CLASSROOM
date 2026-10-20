@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === IoT Classroom - ESP8266 / MQTT THUC ===
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
echo MQTT phai chay tai 192.168.137.1:1884
echo ESP8266 phai nap lai firmware\esp8266_iot.ino trong ban FIX nay.
echo Thu tu: Broker 1884 ^> ESP8266 ^> npm start ^> Web/Postman.
call npm start
pause
