@echo off
chcp 65001 >nul
setlocal
title LightClean Offline License Issuer

set "TOOL_DIR=%~dp0"
set "REPO_DIR=%~dp0.."

if not defined LIGHTCLEAN_LICENSE_DB (
  set "LIGHTCLEAN_LICENSE_DB=%~dp0data\licenses.db"
)

if not defined LIGHTCLEAN_PRIVATE_KEY (
  for /r "%~dp0..\.." %%F in (lightclean-ed25519-private.pem) do (
    if exist "%%~fF" if not defined LIGHTCLEAN_PRIVATE_KEY set "LIGHTCLEAN_PRIVATE_KEY=%%~fF"
  )
)

echo.
echo =================================
echo   LightClean Offline License Tool
echo =================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install it from https://nodejs.org/
  goto :failed
)

if not exist "%TOOL_DIR%offline-issuer.mjs" (
  echo ERROR: offline-issuer.mjs was not found.
  goto :failed
)

if not exist "%LIGHTCLEAN_LICENSE_DB%" (
  echo ERROR: License database was not found:
  echo %LIGHTCLEAN_LICENSE_DB%
  goto :failed
)

if not defined LIGHTCLEAN_PRIVATE_KEY (
  echo ERROR: lightclean-ed25519-private.pem was not found.
  goto :failed
)

if not exist "%LIGHTCLEAN_PRIVATE_KEY%" (
  echo ERROR: Private key was not found:
  echo %LIGHTCLEAN_PRIVATE_KEY%
  goto :failed
)

echo.
cd /d "%REPO_DIR%"
if defined PURCHASE_CODE if defined DEVICE_REQUEST (
  node "%TOOL_DIR%offline-issuer.mjs" --code "%PURCHASE_CODE%" --request "%DEVICE_REQUEST%" --copy
) else (
  node "%TOOL_DIR%offline-issuer.mjs" --interactive --copy
)
if errorlevel 1 goto :failed

echo.
echo SUCCESS: The activation code is now in the clipboard.
echo.
pause
exit /b 0

:failed
echo.
echo FAILED: Check the message above and try again.
echo.
pause
exit /b 1
