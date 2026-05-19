# Loads .env.local-render into the current PowerShell process, then runs
# the local story renderer once and exits. Invoked by PM2 on a cron
# schedule — see ecosystem.stories-render.config.cjs.
#
# Run manually for ad-hoc catch-up:
#   .\start-render-daemon.ps1
#
# Values in .env.local-render MUST NOT be wrapped in quotes.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$envFile = Join-Path $scriptDir ".env.local-render"
if (-not (Test-Path $envFile)) {
  Write-Error "[start-render-daemon] .env.local-render not found at $envFile"
  exit 1
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match "^\s*([^#=]+?)\s*=\s*(.*)$") {
    [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2])
  }
}

# Force one-shot mode regardless of what's in the env file — this script is
# called by a PM2 cron, not by long-polling. Loop mode would defeat the
# entire point of the schedule.
$env:RENDER_ONCE = "true"

Write-Host "[start-render-daemon] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') starting render run"

& yarn medusa exec ./src/scripts/local-render-stories.ts
$exitCode = $LASTEXITCODE

Write-Host "[start-render-daemon] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') finished with exit code $exitCode"
exit $exitCode
