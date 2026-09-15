@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\ssh2\package.json" if not exist "node_modules\safer-buffer\package.json" (
  echo Installing dependencies...
  call npm install --no-audit --no-fund --prefer-offline
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
if not defined TREE_DATA_DIR set "TREE_DATA_DIR=%~dp0..\..\work\tree-data"
if not exist "%TREE_DATA_DIR%" mkdir "%TREE_DATA_DIR%"
echo Starting branchat...
node server.mjs
if errorlevel 1 (
  echo Service stopped with an error. Check "%TREE_DATA_DIR%\server-error.log".
  pause
)
