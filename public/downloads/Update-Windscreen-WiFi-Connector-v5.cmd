@echo off
setlocal
cls
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "setupFile=%TEMP%\Update-Windscreen-WiFi-Connector-v5.ps1"
echo ============================================================
echo WINDSCREEN WIFI - VOUCHER ENGINE UPDATE
echo ============================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing 'https://glass.visionpixels.autos/files/downloads/Update-Windscreen-WiFi-Connector-v5.ps1' -OutFile $env:setupFile; if((Get-FileHash -LiteralPath $env:setupFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'a9aab81fc2a81dea642e33b4d98a801ddcbb86be91699e87a6f91e9ef0346678'){throw 'Updater integrity check failed'}"
if errorlevel 1 (
  echo.
  echo Update could not be downloaded or verified. Existing WiFi was not changed.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%setupFile%"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
echo.
echo Update complete.
timeout /t 5 /nobreak >nul
exit /b 0
