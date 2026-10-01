@echo off
setlocal
cls
echo WINDSCREEN RECEPTION WIFI SETUP
echo Run normally. Approve the administrator prompt for database permissions.
echo Python is included automatically. The Reception WiFi service is configured separately.
set "setupFile=%TEMP%\Install-Windscreen-Reception-WiFi-Portable-v3.ps1"
if exist "%~dp0Install-Windscreen-Reception-WiFi-Portable-v3.ps1" (
  set "setupFile=%~dp0Install-Windscreen-Reception-WiFi-Portable-v3.ps1"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing 'https://glass.visionpixels.autos/files/downloads/Install-Windscreen-Reception-WiFi-Portable-v3.ps1' -OutFile $env:setupFile"
  if errorlevel 1 (
    echo Setup could not be downloaded.
    pause
    exit /b 1
  )
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if((Get-FileHash -LiteralPath $env:setupFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne '522bd1b428f9cc4f57fa0382683a952de610262c4794ba893f08dbc9a337f86d'){throw 'Installer integrity check failed'}"
if errorlevel 1 (
  echo Setup could not be downloaded or verified.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%setupFile%"
if errorlevel 1 (
  echo Setup stopped. Check the message above.
  pause
  exit /b 1
)
echo Setup complete. Reception WiFi is ready for pairing with the Windscreen dashboard.
pause
