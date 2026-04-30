param(
    [switch]$DryRun,
    [string]$EnvFile = ".env.news"
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

    if ($DryRun) {
        Write-Host "Running news sync in dry-run mode..." -ForegroundColor Yellow
        python -m news_ingestion.runner --once --dry-run
    } else {
        Write-Host "Running news sync with MongoDB write..." -ForegroundColor Green
        python -m news_ingestion.runner --once
    }

    if ($LASTEXITCODE -ne 0) {
        throw "news_ingestion.runner exited with code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Host "Done." -ForegroundColor Green
