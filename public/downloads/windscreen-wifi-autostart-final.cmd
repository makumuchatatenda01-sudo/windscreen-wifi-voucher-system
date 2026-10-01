@echo off
setlocal
cls

net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ============================================================
echo WINDSCREEN WIFI - AUTOMATIC START INSTALLER
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $d=Join-Path $env:LOCALAPPDATA 'VisionCo-WiFi-Connector'; New-Item -ItemType Directory -Path $d -Force | Out-Null; $helper=Join-Path $d 'Start_Reception_Guest_WiFi.ps1'; Invoke-WebRequest -UseBasicParsing 'https://glass.visionpixels.autos/files/downloads/windscreen-wifi-guest-start-helper-v2.ps1' -OutFile $helper; $wrapper=Join-Path $d 'Start_Windscreen_WiFi_At_Logon.ps1'; $content=@'
$ErrorActionPreference = "SilentlyContinue"
Start-Sleep -Seconds 20
$wifiExe = "C:\Program Files (x86)\MyPublicWiFi\MyPublicWiFi.exe"
if (Test-Path $wifiExe) {
  $p = Get-Process -Name "MyPublicWiFi" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) {
    Start-Process -FilePath $wifiExe
    Start-Sleep -Seconds 5
  }
}
$helper = Join-Path $env:LOCALAPPDATA "VisionCo-WiFi-Connector\Start_Reception_Guest_WiFi.ps1"
if (Test-Path $helper) {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper
}
'@; Set-Content -Path $wrapper -Value $content -Encoding UTF8; $id=[System.Security.Principal.WindowsIdentity]::GetCurrent(); $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$wrapper+'"'); $trigger=New-ScheduledTaskTrigger -AtLogOn -User $id.Name; $principal=New-ScheduledTaskPrincipal -UserId $id.Name -LogonType Interactive -RunLevel Highest; $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1); Register-ScheduledTask -TaskName 'Windscreen Reception WiFi Auto Start' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null; $manualAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$helper+'"'); Register-ScheduledTask -TaskName 'Windscreen Reception Guest WiFi Start' -Action $manualAction -Principal $principal -Settings $settings -Force | Out-Null; Start-ScheduledTask -TaskName 'Windscreen Reception WiFi Auto Start'; Write-Host '[PASS] Automatic Reception WiFi startup installed.' -ForegroundColor Green;"

if errorlevel 1 (
  echo.
  echo Automatic startup could not be installed.
  pause
  exit /b 1
)

echo.
echo [PASS] Automatic Reception WiFi startup is installed.
echo.
echo From now on:
echo Windows sign-in - Reception WiFi starts automatically - Dashboard detects it.
echo The dashboard Turn On Guest WiFi button remains only as a fallback.
echo.
echo IMPORTANT: Restart this laptop once before client handover and confirm the WiFi comes online.
timeout /t 6 /nobreak >nul
exit /b 0
