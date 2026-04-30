param(
    [switch]$DryRun,
    [switch]$NormalizeExisting,
    [switch]$InteractiveCaptcha,
    [int]$CaptchaWaitSeconds = 60,
    [string]$EnvFile = ".env.incidents"
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$backend = Join-Path $projectRoot "backend"
if (-not (Test-Path $backend)) {
    Write-Error "Missing backend folder: $backend"
    exit 1
}

Push-Location $backend
try {
    $env:ENV_FILE = $EnvFile
    $wazeSnapshot = Join-Path $backend "tmp/waze-georss-snapshot.json"

    if ($InteractiveCaptcha) {
        Write-Host "Starting interactive Waze capture (browser + CAPTCHA)..." -ForegroundColor Cyan
        if (-not $env:INCIDENTS_WAZE_GRID_SIZE) {
            $env:INCIDENTS_WAZE_GRID_SIZE = "3"
        }
        node scripts/capture-waze-live-map.js --out $wazeSnapshot --wait-seconds $CaptchaWaitSeconds
        if ($LASTEXITCODE -ne 0) {
            throw "capture-waze-live-map.js exited with code $LASTEXITCODE"
        }
        $env:WAZE_GEORSS_SNAPSHOT_FILE = $wazeSnapshot
        $env:INCIDENTS_INCLUDE_WAZE_IMPORTS = "false"
        Write-Host "Waze snapshot ready: $wazeSnapshot" -ForegroundColor Green
    } else {
        Remove-Item Env:INCIDENTS_INCLUDE_WAZE_IMPORTS -ErrorAction SilentlyContinue
    }

    if ($DryRun) {
        Write-Host "Running incident sync in dry-run mode..." -ForegroundColor Yellow
        python -m incident_ingestion.runner --once --dry-run
    } else {
        Write-Host "Running incident sync with MongoDB write..." -ForegroundColor Green
        python -m incident_ingestion.runner --once
    }

    if ($LASTEXITCODE -ne 0) {
        throw "incident_ingestion.runner exited with code $LASTEXITCODE"
    }

    if ($NormalizeExisting) {
        Write-Host "Normalizing existing incident text..." -ForegroundColor Cyan
        python scripts/normalize-incidents-text.py
        if ($LASTEXITCODE -ne 0) {
            throw "normalize-incidents-text.py exited with code $LASTEXITCODE"
        }
    }
}
finally {
    Pop-Location
}

Write-Host "Done." -ForegroundColor Green
