param(
    [switch]$DryRun,
    [switch]$Backfill,
    [switch]$ForceRefresh,
    [string]$EnvFile = ".env.news"
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backend = Join-Path $projectRoot "backend"

if (-not (Test-Path $backend)) {
    Write-Error "Nu gasesc folderul backend: $backend"
    exit 1
}

Push-Location $backend
try {
    $env:ENV_FILE = $EnvFile
    $env:PYTHONIOENCODING = "utf-8"

    $argsList = @("-m", "news_ingestion.runner")

    if ($Backfill) {
        Write-Host "Rulez backfill pentru traducerile Argos..." -ForegroundColor Cyan
        $argsList += "--backfill-translations"
    } else {
        Write-Host "Rulez news sync cu traduceri Argos locale..." -ForegroundColor Cyan
        $argsList += "--once"
    }

    if ($DryRun) {
        Write-Host "Mod dry-run: nu scrie in Mongo si nu traduce efectiv." -ForegroundColor Yellow
        $argsList += "--dry-run"
    }

    if ($ForceRefresh) {
        if (-not $Backfill) {
            Write-Warning "ForceRefresh se aplica doar cu -Backfill; il ignor pentru sync normal."
        } else {
            Write-Host "Force refresh activ: regenerez traducerile chiar daca exista cache valid." -ForegroundColor Yellow
            $argsList += "--force-translation-refresh"
        }
    }

    & python @argsList

    if ($LASTEXITCODE -ne 0) {
        throw "news_ingestion.runner exited with code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Host "Done." -ForegroundColor Green
