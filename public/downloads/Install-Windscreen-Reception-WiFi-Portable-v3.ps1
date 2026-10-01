param(
    [switch]$RepairDatabasePermissions,
    [string]$ReceptionUserSid
)
$ErrorActionPreference = 'Stop'
$site = 'https://glass.visionpixels.autos'
$dir = Join-Path $env:LOCALAPPDATA 'VisionCo-WiFi-Connector'
$downloads = Join-Path $dir 'setup-downloads'

function Fetch-Verified([string]$name, [string]$sha256) {
    $target = Join-Path $downloads $name
    $bundled = Join-Path $PSScriptRoot $name
    if (Test-Path $bundled) {
        Copy-Item -LiteralPath $bundled -Destination $target -Force
    } else {
        Invoke-WebRequest -UseBasicParsing -Uri "$site/files/downloads/$name" -OutFile $target
    }
    $actual = (Get-FileHash -Path $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $sha256) { throw "The downloaded $name failed its integrity check. No new service was installed." }
    return $target
}

try {
    Write-Host 'WINDSCREEN RECEPTION WIFI SETUP' -ForegroundColor Cyan
    if (-not $env:LOCALAPPDATA -or -not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
        throw 'Run this on the Windows reception desktop.'
    }
    $db = @(
        'C:\Program Files (x86)\MyPublicWiFi\Data.db',
        'C:\Program Files\MyPublicWiFi\Data.db'
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $db) { throw 'Install and configure MyPublicWiFi first, then run this installer again.' }
    $wifiExe = Join-Path (Split-Path $db -Parent) 'MyPublicWiFi.exe'
    if (-not (Test-Path $wifiExe)) { throw 'MyPublicWiFi.exe was not found alongside its database.' }


    # Elevate only the database permission repair. Keep connector installation
    # and HKCU startup registration under the original reception user.
    if ($RepairDatabasePermissions) {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'Database permission repair requires administrator approval.'
        }
        if ($ReceptionUserSid -notmatch '^S-1-5-21-([0-9]+-){3}[0-9]+$') {
            throw 'Invalid reception user SID.'
        }
        $folder = Split-Path $db -Parent
        $files = @('Data.db','Data.db-journal','Data.db-wal','Data.db-shm') |
            ForEach-Object { Join-Path $folder $_ } |
            Where-Object { Test-Path -LiteralPath $_ }
        $backupDir = Join-Path $env:ProgramData 'VisionCo-WiFi-Setup-Backups'
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        $backup = Join-Path $backupDir ('permissions-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.xml')
        @($folder) + @($files) |
            ForEach-Object { Get-Acl -LiteralPath $_ } |
            Export-Clixml -LiteralPath $backup
        # No inheritance: existing program files remain protected.
        & icacls.exe $folder /grant ("*" + $ReceptionUserSid + ':(WD)')
        if ($LASTEXITCODE -ne 0) { throw 'Folder permission repair failed.' }
        foreach ($file in $files) {
            & icacls.exe $file /grant ("*" + $ReceptionUserSid + ':(M)')
            if ($LASTEXITCODE -ne 0) { throw "Database permission repair failed: $file" }
        }
        Write-Host '[PASS] Database permissions repaired.' -ForegroundColor Green
        exit 0
    }

    $receptionIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $receptionPrincipal = New-Object Security.Principal.WindowsPrincipal($receptionIdentity)
    if ($receptionPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Close this elevated setup and double-click the CMD normally. Setup requests administrator approval only for the database repair.'
    }
    $receptionSid = $receptionIdentity.User.Value
    Write-Host 'Approve the Windows administrator prompt to enable voucher saving.'
    $repairArguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -RepairDatabasePermissions -ReceptionUserSid "' + $receptionSid + '"'
    $repair = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -ArgumentList $repairArguments -Wait -PassThru
    if ($repair.ExitCode -ne 0) { throw 'Database permission repair was not completed. Setup has stopped.' }

    New-Item -ItemType Directory -Force -Path $downloads | Out-Null
    $runtime = Join-Path $dir 'runtime-python-3.13.13'
    $python = Join-Path $runtime 'python.exe'
    $pythonw = Join-Path $runtime 'pythonw.exe'
    if (-not (Test-Path $python) -or -not (Test-Path $pythonw)) {
        Write-Host 'Preparing the included Python runtime (no separate installation needed)...'
        $runtimeZip = Fetch-Verified 'python-3.13.13-embed-amd64.zip' '8766a8775746235e23cf5aee5027ab1060bb981d93110577adcf3508aa0cbd55'
        New-Item -ItemType Directory -Path $runtime -Force | Out-Null
        Expand-Archive -LiteralPath $runtimeZip -DestinationPath $runtime -Force
    }
    if (-not (Test-Path $python) -or -not (Test-Path $pythonw)) { throw 'The included Python runtime could not be prepared.' }
    & $python -c 'import sqlite3, socket, winreg, ctypes'
    if ($LASTEXITCODE -ne 0) { throw 'The included Python runtime failed its startup check.' }
    Write-Host '[PASS] Runtime ready.' -ForegroundColor Green

    $writeCheck = Join-Path $downloads 'verify-database-write.py'
    $writeCheckCode = @'
import sqlite3
import sys
import uuid
from pathlib import Path
db = sqlite3.connect(Path(sys.argv[1]).resolve().as_uri() + "?mode=rw", uri=True, timeout=10)
try:
    db.execute("BEGIN IMMEDIATE")
    db.execute('CREATE TABLE "visionco_setup_check_' + uuid.uuid4().hex + '" (value INTEGER)')
    db.rollback()
    print("[PASS] Voucher database is writable by the reception user.")
finally:
    db.rollback()
    db.close()
'@
    [System.IO.File]::WriteAllText($writeCheck, $writeCheckCode, (New-Object System.Text.UTF8Encoding($false)))
    & $python $writeCheck $db
    if ($LASTEXITCODE -ne 0) {
        throw 'Database write test failed. Close MyPublicWiFi and retry setup. No test voucher was created.'
    }

    $connector = Fetch-Verified 'VisionCo-WiFi-Connector-FINAL.pyw' '8ae1739bfda62406aee2288f301d9656b84a266b7ed51cfab96c7350203915fd'
    $gatewayDownload = Fetch-Verified 'VisionCo-WiFi-Pairing-Gateway.pyw' 'a2bee081323090aa2f4b8347662541ac4077e90357659881e4ba0c89ef305d52'

    foreach ($port in @(18763, 18764)) {
        $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) {
            $processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $listener.OwningProcess)
            $expected = if ($port -eq 18763) { 'VisionCo-WiFi-Connector-FINAL' } else { 'VisionCo-WiFi-Pairing-Gateway' }
            if (-not $processInfo -or $processInfo.CommandLine -notlike ("*" + $expected + "*")) {
                throw "Local port $port belongs to another program. No process was stopped."
            }
            Stop-Process -Id $listener.OwningProcess -Force
        }
    }
    Start-Sleep -Milliseconds 500

    # The connector validates the installed database, creates a backup, and
    # installs only for the signed-in Windows user. Do not touch the hotspot key.
    & $python $connector --install --database $db
    if ($LASTEXITCODE -ne 0) { throw 'The connector did not install. MyPublicWiFi settings were not changed.' }

    $gateway = Join-Path $dir 'VisionCo-WiFi-Pairing-Gateway.pyw'
    Copy-Item -LiteralPath $gatewayDownload -Destination $gateway -Force
    [System.IO.File]::WriteAllText((Join-Path $dir 'allowed-origins.txt'), "$site`r`n", (New-Object System.Text.UTF8Encoding($false)))

    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $gatewayRun = '"' + $pythonw + '" "' + $gateway + '"'
    $wifiRun = '"' + $wifiExe + '"'
    New-ItemProperty -Path $runKey -Name VisionCoWiFiPairingGateway -Value $gatewayRun -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $runKey -Name WindscreenMyPublicWiFi -Value $wifiRun -PropertyType String -Force | Out-Null

    # A previous test installer may have started the hotspot automatically.
    # This reception flow deliberately lets staff press Start Hotspot.
    $oldTask = Get-ScheduledTask -TaskName 'Windscreen Reception WiFi Auto Start' -ErrorAction SilentlyContinue
    if ($oldTask) { Unregister-ScheduledTask -TaskName 'Windscreen Reception WiFi Auto Start' -Confirm:$false }

    Start-Process -FilePath $pythonw -ArgumentList ('"' + $gateway + '"') -WorkingDirectory $dir
    if (-not (Get-Process -Name MyPublicWiFi -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath $wifiExe
    }
    Start-Sleep -Seconds 2
    if (-not (Get-NetTCPConnection -LocalPort 18764 -State Listen -ErrorAction SilentlyContinue)) {
        throw 'The pairing gateway did not start. Check pairing-gateway.log in the VisionCo-WiFi-Connector folder.'
    }
    Write-Host '[PASS] Connector and pairing gateway installed.' -ForegroundColor Green
    Write-Host '[PASS] MyPublicWiFi will open visibly when this Windows user signs in.' -ForegroundColor Green
    Write-Host 'In MyPublicWiFi, press Start Hotspot. Then return to the dashboard and enter this one-time pairing code:'
    & $python $gateway --show-code
    Write-Host 'The setup code stays on the reception desktop. Do not share it in chat.'
    Start-Process "$site/studio"
} catch {
    Write-Host ('[SETUP STOPPED] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
