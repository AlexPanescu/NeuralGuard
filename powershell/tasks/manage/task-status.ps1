param(
    [string]$NewsTaskName = "NewsSyncAuto",
    [string]$IncidentTaskName = "IncidentSyncAuto"
)

$ErrorActionPreference = "Stop"

function Get-TaskStatusRow {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskName
    )

    try {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop

        [PSCustomObject]@{
            TaskName   = $TaskName
            Exists     = $true
            State      = $task.State
            NextRun    = $info.NextRunTime
            LastRun    = $info.LastRunTime
            LastResult = $info.LastTaskResult
        }
    } catch {
        [PSCustomObject]@{
            TaskName   = $TaskName
            Exists     = $false
            State      = "NotFound"
            NextRun    = $null
            LastRun    = $null
            LastResult = $null
        }
    }
}

$rows = @(
    Get-TaskStatusRow -TaskName $NewsTaskName
    Get-TaskStatusRow -TaskName $IncidentTaskName
)

$rows | Format-Table -AutoSize
