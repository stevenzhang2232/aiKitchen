@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install it from https://nodejs.org and try again. & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies, this only happens once...
  call npm install || goto :err
)
echo Building the app...
call npm run build || goto :err
call npm start -- --open
goto :eof
:err
echo Something went wrong. See the messages above.
pause
