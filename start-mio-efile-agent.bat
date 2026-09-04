@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\playwright-core\package.json" (
  echo Installing the Mio eFile Browser Agent dependency...
  call npm install
  if errorlevel 1 goto :failed
)

echo Starting the Mio eFile Browser Agent...
echo Leave this window open while using the Texas eFile page in Mio.
call npm run efile-agent
goto :end

:failed
echo.
echo The eFile Browser Agent could not be started.
pause

:end
endlocal
