@echo off
setlocal
cd /d "%~dp0"
echo.
echo  CHEX launcher - starts the backend and the frontend in two windows.
echo.
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org ^(version 18 or newer^), then run this again. & pause & exit /b 1)
findstr /c:"nexa-backend" backend\package.json >nul 2>nul || (echo backend\package.json is missing or is not the CHEX one. Extract the zip again into an empty folder, ideally C:\chex. & pause & exit /b 1)
if not exist backend\node_modules (echo Installing backend packages - first run only, a few minutes... & pushd backend & call npm install & popd)
if not exist frontend\node_modules (echo Installing frontend packages - first run only, a few minutes... & pushd frontend & call npm install & popd)
start "CHEX backend (port 4000)" cmd /k "cd /d %~dp0backend && npm start"
start "CHEX frontend (port 5173)" cmd /k "cd /d %~dp0frontend && npm run dev"
echo.
echo  Wait about 10 seconds, then open http://localhost:5173
timeout /t 8 >nul
start http://localhost:5173
endlocal
