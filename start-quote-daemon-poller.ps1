# One-shot polling tick for the local pre-order quote-scrape daemon.
#
# Invoked by Windows Task Scheduler every 5 minutes from 09:00 to 22:00 MU
# (\DollUp\DollUp-Quote-Scrape-Poller). Each fire:
#   1. Loads .env.local-render
#   2. Verifies the SSH tunnel is up
#   3. Acquires a lock file so two ticks can't race
#   4. Runs `yarn medusa exec ./src/scripts/scrape-quote-jobs.ts` ONCE
#   5. Exits — Task Scheduler fires us again 5 min later
#
# Why one-shot instead of a long-running poller: PM2 on Windows is
# unreliable for this chain (Node DEP0190, ghost PIDs, .bat path lookup).
# Task Scheduler already handles the stories render path reliably; reusing it
# for the quote-scrape poll path keeps the supervision story to one tool.
#
# Why the 09:00-22:00 window: clients submit quote requests throughout the
# day into the evening, so we sweep pending jobs across a wider window than
# the stories renderer (which stops at 17:00).
#
# Note: the quote daemon has no ONCE flag — it runs one tick per invocation
# by design (claims up to QUOTE_SCRAPE_LIMIT jobs then exits).
#
# Concurrency guard: a lock file ($scriptDir/.quote-daemon-poller.lock) holds
# the PID of the running scraper. If the lock file exists AND the
# referenced PID is alive, we exit immediately so two ticks never run
# yarn at the same time.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$logDir = Join-Path $scriptDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$logFile = Join-Path $logDir "quote-scrape-poller-task.log"
Start-Transcript -Path $logFile -Append | Out-Null

try {
  # --- Concurrency guard via lock file -----------------------------------
  $lockFile = Join-Path $scriptDir ".quote-daemon-poller.lock"
  if (Test-Path $lockFile) {
    $existingPid = Get-Content $lockFile -ErrorAction SilentlyContinue
    if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
      Write-Host "[quote-poller-tick] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') lock held by PID $existingPid - skipping this tick"
      exit 0
    }
    # Stale lock - holder is gone. Reclaim it.
    Write-Host "[quote-poller-tick] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') stale lock for PID $existingPid - reclaiming"
    Remove-Item $lockFile -Force
  }
  Set-Content -Path $lockFile -Value $PID

  try {
    # --- Env loading -----------------------------------------------------
    $envFile = Join-Path $scriptDir ".env.local-render"
    if (-not (Test-Path $envFile)) {
      Write-Error "[quote-poller-tick] .env.local-render not found at $envFile"
      exit 1
    }

    Get-Content $envFile | ForEach-Object {
      if ($_ -match "^\s*([^#=]+?)\s*=\s*(.*)$") {
        [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2])
      }
    }

    # Claim up to 5 pending quote jobs per tick. The quote daemon has no ONCE
    # flag - it runs one tick per invocation by design (we're called once
    # every 5 min by Task Scheduler, not as a long-poll loop).
    $env:QUOTE_SCRAPE_LIMIT = "5"

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
        Write-Host "[quote-poller-tick] telegram alert failed: $($_.Exception.Message)"
      }
    }

    # --- Tunnel pre-flight ----------------------------------------------
    $tunnelOk = Test-NetConnection 127.0.0.1 -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue
    if (-not $tunnelOk) {
      Write-Host "[quote-poller-tick] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') SSH tunnel down - skipping tick (next fire in 5 min)"
      # Don't telegram-alert on every 5min tick - too noisy.
      exit 2
    }

    Write-Host "[quote-poller-tick] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') starting quote-scrape tick"

    & yarn medusa exec ./src/scripts/scrape-quote-jobs.ts
    $exitCode = $LASTEXITCODE

    Write-Host "[quote-poller-tick] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') finished with exit code $exitCode"

    if ($exitCode -ne 0) {
      $failMsg = [char]0x274C + " <b>Quote-scrape poller tick failed</b>`n`n<code>yarn medusa exec scrape-quote-jobs</code> exited with code $exitCode. Next tick in 5 min."
      Send-TelegramAlert $failMsg
    }

    exit $exitCode
  } finally {
    # Always release the lock, even on error
    if (Test-Path $lockFile) {
      Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    }
  }
}
finally {
  Stop-Transcript | Out-Null
}
