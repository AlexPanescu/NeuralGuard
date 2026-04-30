param(
    [string]$NewsTaskName = "NewsSyncAuto",
    [string]$IncidentTaskName = "IncidentSyncAuto",
    [int]$NewsIntervalMinutes = 15,
    [int]$IncidentIntervalMinutes = 15,
    [string]$NewsEnvFile = ".env.news",
    [string]$IncidentEnvFile = ".env.incidents",
    [switch]$CurrentUserOnly
)

$ErrorActionPreference = "Stop"

$base = $PSScriptRoot
$installNews = Join-Path $base "../install/install-news-task.ps1"
$installIncidents = Join-Path $base "../install/install-incidents-task.ps1"

if (-not (Test-Path $installNews)) {
    throw "Missing script: $installNews"
}
if (-not (Test-Path $installIncidents)) {
    throw "Missing script: $installIncidents"
}

$installNews = (Resolve-Path $installNews).Path
$installIncidents = (Resolve-Path $installIncidents).Path

Write-Host "Installing news sync task..." -ForegroundColor Cyan
if ($CurrentUserOnly) {
    & $installNews `
        -TaskName $NewsTaskName `
        -IntervalMinutes $NewsIntervalMinutes `
        -EnvFile $NewsEnvFile `
        -CurrentUserOnly
} else {
    & $installNews `
        -TaskName $NewsTaskName `
        -IntervalMinutes $NewsIntervalMinutes `
        -EnvFile $NewsEnvFile
}

Write-Host "Installing incident sync task..." -ForegroundColor Cyan
if ($CurrentUserOnly) {
    & $installIncidents `
        -TaskName $IncidentTaskName `
        -IntervalMinutes $IncidentIntervalMinutes `
        -EnvFile $IncidentEnvFile `
        -CurrentUserOnly
} else {
    & $installIncidents `
        -TaskName $IncidentTaskName `
        -IntervalMinutes $IncidentIntervalMinutes `
        -EnvFile $IncidentEnvFile
}

Write-Host "All scheduled tasks installed." -ForegroundColor Green
