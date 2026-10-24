@echo off
setlocal
cd /d "%~dp0"
docker compose up -d --build
if errorlevel 1 exit /b 1
echo node26Supervisor est disponible sur http://localhost:8090
