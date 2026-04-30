param(
    [string]$TaskName = "IncidentSyncAuto"
)

$ErrorActionPreference = "Stop"

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    Write-Host "Task removed: $TaskName" -ForegroundColor Green
} catch {
    Write-Host "Task not found: $TaskName" -ForegroundColor Yellow
}

