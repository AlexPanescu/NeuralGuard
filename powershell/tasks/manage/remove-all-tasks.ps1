param(
    [string]$NewsTaskName = "NewsSyncAuto",
    [string]$IncidentTaskName = "IncidentSyncAuto"
)

$ErrorActionPreference = "Stop"

$base = $PSScriptRoot
$removeNews = Join-Path $base "../remove/remove-news-task.ps1"
$removeIncidents = Join-Path $base "../remove/remove-incidents-task.ps1"

if (-not (Test-Path $removeNews)) {
    throw "Missing script: $removeNews"
}
if (-not (Test-Path $removeIncidents)) {
    throw "Missing script: $removeIncidents"
}

$removeNews = (Resolve-Path $removeNews).Path
$removeIncidents = (Resolve-Path $removeIncidents).Path

Write-Host "Removing news sync task..." -ForegroundColor Cyan
& $removeNews -TaskName $NewsTaskName

Write-Host "Removing incident sync task..." -ForegroundColor Cyan
& $removeIncidents -TaskName $IncidentTaskName

Write-Host "All scheduled tasks processed." -ForegroundColor Green
