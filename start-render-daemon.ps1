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

  function Send-TelegramAlert {
    param([string]$Text)
    $token = $env:TELEGRAM_BOT_TOKEN
    $chatId = $env:TELEGRAM_CHAT_ID
    if (-not $token -or -not $chatId) { return }
    try {
      Invoke-RestMethod -Method Post `
        -Uri "https://api.telegram.org/bot$token/sendMessage" `
        -Body @{ chat_id = $chatId; text = $Text; parse_mode = "HTML" } `
        -TimeoutSec 10 | Out-Null
    } catch {
      Write-Host "[start-render-daemon] telegram alert failed: $($_.Exception.Message)"
    }
  }

  # Pre-flight: the renderer connects to Postgres + Redis via 127.0.0.1
  # forwarded by the SSH tunnel to Coolify. If the tunnel is down - or worse,
  # listening but pointed at container IPs that moved during a VPS reboot -
  # the renderer will spend 5 minutes timing out on KnexTimeoutError, fail
  # silently to disk, and tomorrow's stories won't be ready. Self-heal first
  # (ensure-tunnel.ps1 re-resolves the IPs and restarts ssh, and verifies with
  # a real SELECT 1 rather than a port probe); only abort+alert if that fails.
  $ensure = Join-Path $scriptDir "ensure-tunnel.ps1"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ensure
  if ($LASTEXITCODE -ne 0) {
    $msg = "[start-render-daemon] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') SSH tunnel down and auto-repair failed - aborting before knex timeout"
    Write-Host $msg
    $alertMsg = [char]0x26A0 + [char]0xFE0F + " <b>Stories render aborted</b>`n`nSSH tunnel to Coolify is down and auto-repair failed.`n`nManual fix: run <code>ensure-tunnel.ps1</code> and read its output - it names the blocking PID if a stale tunnel is squatting on port 5432. Check Tailscale + SSH to root@100.65.8.93."
    Send-TelegramAlert $alertMsg
    exit 2
  }

  Write-Host "[start-render-daemon] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') starting render run"

  & yarn medusa exec ./src/scripts/local-render-stories.ts
  $exitCode = $LASTEXITCODE

  Write-Host "[start-render-daemon] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') finished with exit code $exitCode"

  if ($exitCode -ne 0) {
    $failMsg = [char]0x274C + " <b>Stories render failed</b>`n`n<code>yarn medusa exec local-render-stories</code> exited with code $exitCode.`n`nCheck <code>logs/stories-render-task.log</code> on the laptop."
    Send-TelegramAlert $failMsg
  }

  exit $exitCode
}
finally {
  Stop-Transcript | Out-Null
}
