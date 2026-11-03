@echo off
setlocal
cd /d "%~dp0"

set "PATH=C:\Users\Poisson\emsdk\node\24.19.0_64bit;%PATH%"

echo ========================================================
echo        OpenMU Browser Stack + WASM Web Client
echo ========================================================
echo.
echo [1/2] Starting WebSocket-TCP Proxy on port 7100...
start "OpenMU WS Proxy :7100" node src/proxy/index.js

echo [2/2] Starting Web Server on port 8085...
start "OpenMU Web Server :8085" node src/web/server.js

echo.
echo Stack is running!
findstr /b /c:"TLS_CERT_PATH=" .env >nul 2>&1
if not errorlevel 1 (
  echo Opening browser at https://localhost:8085 ...
  timeout /t 2 /nobreak > nul
  start https://localhost:8085
) else (
  echo Opening browser at http://localhost:8085 ...
  timeout /t 2 /nobreak > nul
  start http://localhost:8085
)

echo.
echo Keep the server windows open while playing.
pause
