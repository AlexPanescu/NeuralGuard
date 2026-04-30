Param(
  [switch]$DryRun,
  [switch]$NormalizeExisting,
  [string]$EnvFile = ".env.incidents"
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$canonicalScript = Join-Path $projectRoot "powershell/sync/run-incidents-sync.ps1"

if (-not (Test-Path $canonicalScript)) {
  throw "Missing script: $canonicalScript"
}

& $canonicalScript `
  -EnvFile $EnvFile `
  -DryRun:$DryRun `
  -NormalizeExisting:$NormalizeExisting

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
