$ErrorActionPreference = 'Stop'
$site = 'https://glass.visionpixels.autos'
$dir = Join-Path $env:LOCALAPPDATA 'VisionCo-WiFi-Connector'
$target = Join-Path $dir 'VisionCo-WiFi-Connector-FINAL.pyw'
$pairKey = Join-Path $dir 'pairing-key.txt'
$runtime = Join-Path $dir 'runtime-python-3.13.13'
$pythonw = Join-Path $runtime 'pythonw.exe'
$expected = '8ae1739bfda62406aee2288f301d9656b84a266b7ed51cfab96c7350203915fd'
$requiredBuild = '1.2.4'

function Start-Connector([string]$file,[string]$database) {
    Start-Process -FilePath $pythonw -ArgumentList ('"' + $file + '" --background --database "' + $database + '"') -WorkingDirectory $dir -WindowStyle Hidden
}

function Wait-Connector([string]$expectedBuild) {
    $token = (Get-Content -LiteralPath $pairKey -Raw).Trim()
    for ($i=0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 350
        try {
            $headers = @{ Origin='https://glass.visionpixels.autos'; Authorization=('Bearer ' + $token) }
            $snapshot = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:18763/vouchers' -Headers $headers -TimeoutSec 3
            if ($snapshot.buildVersion -eq $expectedBuild -and $snapshot.watchdogHealthy -eq $true) { return $snapshot }
        } catch {}
    }
    return $null
}

try {
    Write-Host 'WINDSCREEN WIFI - VOUCHER ENGINE UPDATE' -ForegroundColor Cyan
    Write-Host 'This keeps the current pairing and voucher history.'

    if (-not (Test-Path $target)) { throw 'Reception WiFi connector is not installed on this Windows user.' }
    if (-not (Test-Path $pairKey)) { throw 'Reception pairing identity is missing. Run Reception Setup from Settings.' }
    if (-not (Test-Path $pythonw)) { throw 'Reception runtime is missing. Run Reception Setup from Settings.' }

    $db = @(
        'C:\Program Files (x86)\MyPublicWiFi\Data.db',
        'C:\Program Files\MyPublicWiFi\Data.db'
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $db) { throw 'Reception WiFi voucher database was not found.' }

    $download = Join-Path $dir 'VisionCo-WiFi-Connector-FINAL.update.pyw'
    Invoke-WebRequest -UseBasicParsing -Uri "$site/files/downloads/VisionCo-WiFi-Connector-FINAL.pyw" -OutFile $download
    $actual = (Get-FileHash -Path $download -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        Remove-Item $download -Force -ErrorAction SilentlyContinue
        throw 'Update integrity check failed. The existing WiFi system was left unchanged.'
    }

    $listener = Get-NetTCPConnection -LocalPort 18763 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $info = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $listener.OwningProcess)
        if (-not $info -or $info.CommandLine -notlike '*VisionCo-WiFi-Connector-FINAL*') {
            throw 'The local connector port belongs to another program. Nothing was stopped.'
        }
        Stop-Process -Id $listener.OwningProcess -Force
        Start-Sleep -Milliseconds 700
    }

    $backup = Join-Path $dir ('VisionCo-WiFi-Connector-FINAL.before-v5-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.pyw')
    Copy-Item -LiteralPath $target -Destination $backup -Force
    Move-Item -LiteralPath $download -Destination $target -Force

    Start-Connector $target $db
    $snapshot = Wait-Connector $requiredBuild
    if (-not $snapshot) {
        $bad = Get-NetTCPConnection -LocalPort 18763 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($bad) { Stop-Process -Id $bad.OwningProcess -Force -ErrorAction SilentlyContinue }
        Copy-Item -LiteralPath $backup -Destination $target -Force
        Start-Connector $target $db
        throw 'The new connector did not pass its health check. The previous connector was restored.'
    }

    Write-Host ''
    Write-Host ('[PASS] Voucher engine build ' + $snapshot.buildVersion + ' is running.') -ForegroundColor Green
    Write-Host '[PASS] Existing pairing retained.' -ForegroundColor Green
    Write-Host '[PASS] Repeated voucher generation repair installed.' -ForegroundColor Green
    Write-Host '[PASS] Unused vouchers expire after 5 minutes.' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Return to WiFi Vouchers and press Refresh now once.'
} catch {
    Write-Host ''
    Write-Host ('[UPDATE STOPPED] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
