# Loads .env.local-render into the current PowerShell process, then runs
# the local story renderer once and exits. Invoked by Windows Task
# Scheduler at 18:30 MU daily (\DollUp\DollUp-Stories-Render-Daemon)
# OR manually from a terminal for ad-hoc catch-up:
#   .\start-render-daemon.ps1
#
# All output is tee'd to logs/stories-render-task.log so both the
# scheduled run AND manual runs leave a readable trail.
#
# Values in .env.local-render MUST NOT be wrapped in quotes.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Ensure logs dir exists then start a transcript that captures everything
# written to the host AND the output of `yarn medusa exec`. Transcripts
# also capture native command stdout/stderr, which `Tee-Object` does not.
$logDir = Join-Path $scriptDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "stories-render-task.log"
Start-Transcript -Path $logFile -Append | Out-Null

try {
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

  # Force one-shot mode regardless of what's in the env file — this script
  # is called by a once-per-day scheduler, not by long-polling. Loop mode
  # would defeat the entire point of the schedule.
  $env:RENDER_ONCE = "true"

  Write-Host "[start-render-daemon] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') starting render run"

  & yarn medusa exec ./src/scripts/local-render-stories.ts
  $exitCode = $LASTEXITCODE

  Write-Host "[start-render-daemon] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') finished with exit code $exitCode"
  exit $exitCode
}
finally {
  Stop-Transcript | Out-Null
}
