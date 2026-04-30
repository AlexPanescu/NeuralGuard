param(
    [string]$TaskName = "NewsSyncAuto",
    [int]$IntervalMinutes = 15,
    [string]$EnvFile = ".env.news",
    [switch]$CurrentUserOnly
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$runScript = Join-Path $root "../../sync/run-news-sync.ps1"
if (-not (Test-Path $runScript)) {
    Write-Error "Missing script: $runScript"
    exit 1
}
$runScript = (Resolve-Path $runScript).Path

$interval = [Math]::Max(1, $IntervalMinutes)
$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`" -EnvFile `"$EnvFile`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $interval) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
} catch {
    # Ignore if task does not exist.
}

if ($CurrentUserOnly) {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Force | Out-Null
    Write-Host "Task installed for current user: $TaskName (every $interval minutes)." -ForegroundColor Green
    Write-Host "Run once now: Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Yellow
    exit 0
}

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -User "SYSTEM" `
        -RunLevel Highest `
        -Force | Out-Null
    Write-Host "Task installed: $TaskName (every $interval minutes, SYSTEM)." -ForegroundColor Green
    Write-Host "Run once now: Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Yellow
} catch {
    Write-Host "SYSTEM install failed (likely no admin rights). Falling back to current user..." -ForegroundColor Yellow
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Force | Out-Null
    Write-Host "Task installed for current user: $TaskName (every $interval minutes)." -ForegroundColor Green
    Write-Host "For SYSTEM mode, run this script from an elevated PowerShell." -ForegroundColor Yellow
}
