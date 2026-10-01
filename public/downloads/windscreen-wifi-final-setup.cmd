@echo off
setlocal
cls

net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ============================================================
echo WINDSCREEN WIFI - FINAL RECEPTION SETUP
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $d=Join-Path $env:LOCALAPPDATA 'VisionCo-WiFi-Connector'; New-Item -ItemType Directory -Path $d -Force | Out-Null; $h=Join-Path $d 'Start_Reception_Guest_WiFi.ps1'; Invoke-WebRequest -UseBasicParsing 'https://glass.visionpixels.autos/files/downloads/windscreen-wifi-guest-start-helper-v2.ps1' -OutFile $h; $id=[System.Security.Principal.WindowsIdentity]::GetCurrent(); $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"'+$h+'\"'); $principal=New-ScheduledTaskPrincipal -UserId $id.Name -LogonType Interactive -RunLevel Highest; $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2); Register-ScheduledTask -TaskName 'Windscreen Reception Guest WiFi Start' -Action $action -Principal $principal -Settings $settings -Force | Out-Null; Start-ScheduledTask -TaskName 'Windscreen Reception Guest WiFi Start'; $r=Join-Path $d 'guest-wifi-start-result.json'; $online=$false; for($i=0;$i -lt 60;$i++){Start-Sleep -Milliseconds 750; if(Test-Path $r){try{$j=Get-Content $r -Raw | ConvertFrom-Json; if($j.online -eq $true){$online=$true; break}; if($j.stage -in @('start-not-confirmed','error','not-installed')){break}}catch{}}}; if(!$online){throw 'Reception Guest WiFi could not be confirmed online. The dashboard will keep the Turn On Guest WiFi button available.'}; Write-Host ''; Write-Host '[PASS] Reception Guest WiFi is ONLINE.' -ForegroundColor Green;"

if errorlevel 1 (
  echo.
  echo Final setup completed, but Guest WiFi is still OFF.
  echo Return to the Windscreen dashboard and press Turn On Guest WiFi once more.
  timeout /t 5 /nobreak >nul
  exit /b 1
)

echo.
echo [PASS] Final Reception WiFi setup complete.
echo Staff flow is now:
echo Pair once - Turn On Guest WiFi if needed - Use WiFi Vouchers dashboard.
timeout /t 5 /nobreak >nul
exit /b 0
