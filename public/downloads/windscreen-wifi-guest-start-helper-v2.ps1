$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:LOCALAPPDATA 'VisionCo-WiFi-Connector'
$logPath = Join-Path $installDir 'guest-wifi-start.log'
$resultPath = Join-Path $installDir 'guest-wifi-start-result.json'
$wifiExe = 'C:\Program Files (x86)\MyPublicWiFi\MyPublicWiFi.exe'
$gatewayIp = '192.168.5.1'
$diagUrl = 'https://glass.visionpixels.autos/api/windscreen-wifi/diagnostic/8d31a9c4e7'

function LogLine([string]$text) {
  try {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    Add-Content -Path $logPath -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text) -Encoding UTF8
  } catch {}
}

function SendDiag([string]$stage,[bool]$ok,[string]$error='') {
  try {
    $tail = ''
    if (Test-Path $logPath) {
      $tail = (Get-Content $logPath -Tail 140 -ErrorAction SilentlyContinue) -join "`n"
    }
    $payload = @{
      version='guest-helper-v4'
      stage=$stage
      ok=$ok
      error=$error
      diagnostic=$tail
    } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Method Post -Uri $diagUrl -ContentType 'application/json' -Body $payload -TimeoutSec 10 | Out-Null
  } catch {}
}

function SaveResult([bool]$online,[string]$stage,[string]$message) {
  @{ online=$online; stage=$stage; message=$message; checkedAt=(Get-Date).ToString('o') } |
    ConvertTo-Json -Compress | Set-Content -Path $resultPath -Encoding UTF8
}

function TestGuestOnline {
  try {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -eq $gatewayIp })

    foreach ($ip in $ips) {
      $adapter = Get-NetAdapter -InterfaceIndex $ip.InterfaceIndex -IncludeHidden -ErrorAction SilentlyContinue
      if ($adapter -and [string]$adapter.Status -eq 'Up') {
        LogLine ("Guest interface online: " + $adapter.Name + " / " + $adapter.InterfaceDescription)
        return $true
      }
    }

    return $false
  } catch {
    LogLine ('Guest status check error: ' + $_.Exception.Message)
    return $false
  }
}

function TryStartWindowsHotspot {
  try {
    LogLine 'Trying Windows tethering API first.'

    $profileType = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]
    $managerType = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]

    $profile = $profileType::GetInternetConnectionProfile()
    if (-not $profile) {
      LogLine 'Windows tethering API: no active internet connection profile.'
      return $false
    }

    try {
      $name = [string]$profile.ProfileName
      LogLine ("Windows tethering API profile: " + $name)
    } catch {}

    $manager = $managerType::CreateFromConnectionProfile($profile)
    if (-not $manager) {
      LogLine 'Windows tethering API: manager could not be created.'
      return $false
    }

    LogLine ("Windows tethering state before start: " + [string]$manager.TetheringOperationalState)
    if ([string]$manager.TetheringOperationalState -eq 'On') {
      Start-Sleep -Seconds 2
      return (TestGuestOnline)
    }

    $op = $manager.StartTetheringAsync()
    for($i=0; $i -lt 60; $i++) {
      $asyncState = [string]$op.Status
      if ($asyncState -ne 'Started') { break }
      Start-Sleep -Milliseconds 250
    }

    LogLine ("Windows tethering async status: " + [string]$op.Status)

    if ([string]$op.Status -eq 'Completed') {
      try {
        $result = $op.GetResults()
        LogLine ("Windows tethering operation status: " + [string]$result.Status)
        if ($result.AdditionalErrorMessage) {
          LogLine ("Windows tethering message: " + [string]$result.AdditionalErrorMessage)
        }
      } catch {
        LogLine ('Windows tethering result read error: ' + $_.Exception.Message)
      }
    } elseif ([string]$op.Status -eq 'Error') {
      try { LogLine ("Windows tethering async error: " + [string]$op.ErrorCode) } catch {}
    }

    for($i=0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 500
      if (TestGuestOnline) {
        LogLine 'Windows tethering API brought Reception Guest WiFi online.'
        return $true
      }
    }

    LogLine ("Windows tethering state after start: " + [string]$manager.TetheringOperationalState)
    return $false
  } catch {
    LogLine ('Windows tethering API failed: ' + $_.Exception.Message)
    return $false
  }
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VisionCoWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

function RestoreAppWindow {
  param([System.Diagnostics.Process]$Process)
  try {
    $Process.Refresh()
    if ($Process.MainWindowHandle -ne 0) {
      [VisionCoWindow]::ShowWindowAsync($Process.MainWindowHandle, 9) | Out-Null
      [VisionCoWindow]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
      Start-Sleep -Milliseconds 500
      return $true
    }
  } catch {}
  return $false
}

function InvokeStartButton {
  param([int]$ProcessId)
  try {
    Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $procCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$ProcessId)
    $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children,$procCond)
    if (-not $window) { $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$procCond) }
    if (-not $window) { LogLine 'UI window not found.'; return $false }

    try { LogLine ("UI window title: " + [string]$window.Current.Name) } catch {}

    $buttonCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    )
    $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$buttonCond)
    $names = @()
    foreach($b in $buttons) {
      $name = ([string]$b.Current.Name).Trim()
      if($name) { $names += $name }
    }
    if($names.Count) { LogLine ('Buttons detected: ' + (($names | Select-Object -Unique) -join ' | ')) }

    $candidates = @()
    foreach($b in $buttons) {
      $name = ([string]$b.Current.Name).Trim()
      if(-not $name) { continue }
      if($name -match '(?i)stop|settings|configure|close|cancel') { continue }
      if($name -match '(?i)(start|enable|activate).*(hotspot|wifi|virtual)|^(start|enable|activate)$') {
        $candidates += $b
      }
    }

    foreach($b in $candidates) {
      $name = ([string]$b.Current.Name).Trim()
      try {
        $pattern = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        LogLine ("Invoked start control: $name")
        return $true
      } catch {
        try {
          $legacy = $b.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
          $legacy.DoDefaultAction()
          LogLine ("Invoked legacy start control: $name")
          return $true
        } catch {
          LogLine ("Failed to invoke control '$name'")
        }
      }
    }
    LogLine 'No matching Start WiFi control was found.'
    return $false
  } catch {
    LogLine ('UI automation error: ' + $_.Exception.Message)
    return $false
  }
}

try {
  LogLine 'Start request received from Windscreen dashboard helper v4.'

  if (TestGuestOnline) {
    SaveResult $true 'already-online' 'Reception Guest WiFi is already online.'
    SendDiag 'already-online' $true ''
    exit 0
  }

  if (TryStartWindowsHotspot) {
    SaveResult $true 'online-windows-api' 'Reception Guest WiFi is online.'
    SendDiag 'online-windows-api' $true ''
    exit 0
  }

  LogLine 'Windows tethering API did not bring the configured Guest WiFi online. Falling back to the Reception WiFi application.'

  if (-not (Test-Path $wifiExe)) {
    SaveResult $false 'not-installed' 'Reception WiFi service is not installed.'
    SendDiag 'not-installed' $false 'Reception WiFi service is not installed.'
    exit 3
  }

  $existing = @(Get-Process -Name 'MyPublicWiFi' -ErrorAction SilentlyContinue)
  foreach($item in $existing) {
    try {
      if ($item.MainWindowHandle -eq 0) {
        LogLine ("Stopping hidden Reception WiFi application process PID " + $item.Id + " before clean relaunch.")
        Stop-Process -Id $item.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  Start-Sleep -Milliseconds 800

  $proc = Get-Process -Name 'MyPublicWiFi' -ErrorAction SilentlyContinue | Select-Object -First 1

  if (-not $proc) {
    LogLine 'Launching reception WiFi application with visible control window.'
    $proc = Start-Process -FilePath $wifiExe -PassThru
    for($i=0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 500
      if (TestGuestOnline) {
        SaveResult $true 'online-after-launch' 'Reception Guest WiFi is online.'
        SendDiag 'online-after-launch' $true ''
        exit 0
      }
      try {
        $proc.Refresh()
        if ($proc.MainWindowHandle -ne 0) { break }
      } catch {}
    }
  } else {
    LogLine ('Reception WiFi application already running, PID ' + $proc.Id)
  }

  [void](RestoreAppWindow -Process $proc)

  for($attempt=1; $attempt -le 6; $attempt++) {
    if (TestGuestOnline) {
      SaveResult $true 'online-before-start-control' 'Reception Guest WiFi is online.'
      SendDiag 'online-before-start-control' $true ''
      exit 0
    }

    LogLine ("Trying visible start control, attempt $attempt")
    [void](RestoreAppWindow -Process $proc)
    [void](InvokeStartButton -ProcessId $proc.Id)

    for($j=0; $j -lt 16; $j++) {
      Start-Sleep -Milliseconds 500
      if (TestGuestOnline) {
        SaveResult $true 'online-after-start-control' 'Reception Guest WiFi is online.'
        SendDiag 'online-after-start-control' $true ''
        exit 0
      }
    }
  }

  SaveResult $false 'start-not-confirmed' 'Reception WiFi opened, but Guest WiFi did not report online yet.'
  SendDiag 'start-not-confirmed' $false 'Guest WiFi did not report online after Windows API and application-control attempts.'
  exit 2
} catch {
  LogLine ('ERROR: ' + $_.Exception.Message)
  SaveResult $false 'error' 'Reception Guest WiFi could not be started automatically.'
  SendDiag 'error' $false $_.Exception.Message
  exit 1
}
