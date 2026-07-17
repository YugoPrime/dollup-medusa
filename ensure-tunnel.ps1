# Guarantees the coolify-db-tunnel SSH tunnel is up (127.0.0.1:5432 + :6379).
#
# THE root-cause fix for "Stories render aborted / SSH tunnel down": the tunnel
# is a PM2-managed process, and PM2 on this box only self-restores at logon
# (\DollUp\pm2-resurrect). If the PM2 daemon dies while the machine stays
# logged in for days, nothing brings the tunnel back until the next reboot,
# and every render aborts. This script repairs it on demand:
#
#   1. Fast path - if 127.0.0.1:5432 is already listening, exit 0 immediately.
#   2. Repair - resurrect the PM2 daemon (spawns it if dead + restores the
#      saved dump), then start-from-ecosystem or restart the tunnel.
#   3. Wait for the port, up to -TimeoutSec. Exit 0 if up, 1 if not.
#
# Shared by start-render-daemon.ps1, start-render-poller.ps1, and the
# \DollUp\DollUp-Tunnel-Watchdog scheduled task (every 15 min, -Quiet).
#
# PM2 is invoked via node.exe + the pm2 bin (not the pm2.cmd shim) because
# that survives non-interactive S4U scheduled-task context - the exact
# pattern the working \DollUp\pm2-resurrect task already uses.

param(
  [switch]$Quiet,
  [int]$TimeoutSec = 45
)

# Continue (not Stop): PM2 writes noise to stderr; we judge success purely by
# whether the port comes up, so a stray non-terminating error must not abort.
$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Log([string]$m) {
  if (-not $Quiet) { Write-Host "[ensure-tunnel] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" }
}

function Test-Tunnel {
  Test-NetConnection 127.0.0.1 -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue
}

# --- Fast path ---------------------------------------------------------------
if (Test-Tunnel) { Log "tunnel already up"; exit 0 }

Log "tunnel DOWN - attempting repair"

$node = "C:\Program Files\nodejs\node.exe"
$pm2  = "C:\Users\rahvi\AppData\Roaming\npm\node_modules\pm2\bin\pm2"
$eco  = Join-Path $scriptDir "ecosystem.stories-render.config.cjs"

function Pm2([string[]]$a) { & $node $pm2 @a | Out-String }

# 1. Ensure the PM2 daemon is alive + saved processes restored. resurrect
#    spawns the daemon if it was dead (the usual cause) and restores the dump.
Log "pm2 resurrect"
$out = Pm2 @("resurrect")
if (-not $Quiet -and $out) { Write-Host $out.Trim() }
Start-Sleep -Seconds 2

# 2. Force the tunnel up from the ecosystem file (the source of truth). We only
#    reach here with the port DOWN, so state-detection is unnecessary: `pm2
#    start <ecosystem>` is idempotent - it starts the tunnel if absent and
#    restarts it if present (covers 'stopped/errored' AND 'zombie-online').
#    This deliberately avoids `pm2 jlist` | ConvertFrom-Json, which throws on
#    PowerShell 5.1 because pm2's JSON carries duplicate keys (username/USERNAME).
Log "starting/restarting tunnel from ecosystem file"
$out = Pm2 @("start", $eco); if (-not $Quiet -and $out) { Write-Host $out.Trim() }
Pm2 @("save") | Out-Null

# 3. Wait for the forwarded port to actually accept connections.
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  if (Test-Tunnel) { Log "tunnel UP after repair"; exit 0 }
  Start-Sleep -Seconds 3
}

Log "tunnel STILL DOWN after ${TimeoutSec}s repair window"
exit 1
