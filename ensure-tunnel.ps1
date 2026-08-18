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
# 2026-08-18 addendum - "tunnel up but dead": container IPs on the Coolify
# docker network are reassigned on every VPS reboot, so a tunnel forwarding to
# yesterday's IP still LISTENS locally (fast path passed) while every channel
# open is refused by sshd -> KnexTimeoutError on each poller tick. Now:
#   - Test-Tunnel does a real Postgres SSLRequest handshake through the tunnel
#     (a dead forward closes the socket without answering).
#   - Repair first resolves the live container IPs via `docker inspect` over
#     SSH, writes tunnel-targets.json (read by the ecosystem file), and
#     delete+starts the tunnel so the new -L targets take effect.
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
  # Deep check: connect to the forwarded port AND get a Postgres reply.
  # Postgres answers an SSLRequest (00 00 00 08 04 D2 16 2F) with 'S' or 'N'.
  # If sshd can't reach the target container it closes the channel instead,
  # so Read() returns 0 / throws -> tunnel is dead even though 5432 listens.
  $c = $null
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ar = $c.BeginConnect("127.0.0.1", 5432, $null, $null)
    if (-not $ar.AsyncWaitHandle.WaitOne(3000)) { return $false }
    $c.EndConnect($ar)
    $s = $c.GetStream(); $s.ReadTimeout = 5000; $s.WriteTimeout = 5000
    $req = [byte[]](0, 0, 0, 8, 4, 0xD2, 0x16, 0x2F)
    $s.Write($req, 0, 8)
    $buf = New-Object byte[] 1
    $n = $s.Read($buf, 0, 1)
    return ($n -eq 1 -and ($buf[0] -eq 83 -or $buf[0] -eq 78))
  } catch { return $false }
  finally { if ($c) { $c.Close() } }
}

$sshExe   = "C:\Windows\System32\OpenSSH\ssh.exe"
$vpsHost  = "root@100.65.8.93"
$targetsFile = Join-Path $scriptDir "tunnel-targets.json"

# Resolve the live docker IPs of the Doll Up Postgres + Redis containers over
# SSH and persist them for the ecosystem file. Returns $true if written.
function Update-TunnelTargets {
  $pgC = "w19wlamada7h8ioo7aihmb7u"; $rdC = "nryk9bn0kzf1vzuvxa4yykxk"
  try {
    $t = Get-Content $targetsFile -Raw | ConvertFrom-Json
    if ($t.pgContainer) { $pgC = $t.pgContainer }
    if ($t.redisContainer) { $rdC = $t.redisContainer }
  } catch {}
  $fmt = "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"
  $out = & $sshExe -o BatchMode=yes -o ConnectTimeout=15 $vpsHost "docker inspect -f '$fmt' $pgC $rdC" 2>$null
  $ips = @($out | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' })
  if ($ips.Count -ne 2) { Log "could not resolve container IPs over SSH (got: $out)"; return $false }
  $json = [ordered]@{
    _comment       = "Auto-written by ensure-tunnel.ps1 (docker inspect over SSH). Container IPs change on every VPS reboot - do not hand-edit, just re-run ensure-tunnel.ps1."
    pgContainer    = $pgC
    redisContainer = $rdC
    pgIp           = $ips[0]
    redisIp        = $ips[1]
    resolvedAt     = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK")
  } | ConvertTo-Json
  [IO.File]::WriteAllText($targetsFile, $json + "`n", (New-Object Text.UTF8Encoding $false))
  Log "resolved targets: pg=$($ips[0]) redis=$($ips[1])"
  return $true
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
#    Before that, refresh the container IPs - stale IPs after a VPS reboot are
#    the #1 reason we get here with the port listening but dead. If SSH itself
#    is unreachable we keep the last-known targets and still try.
Update-TunnelTargets | Out-Null
#    delete+start (not plain start) so PM2 re-reads the -L args from the
#    ecosystem file; a restart of an existing app keeps its old argv.
Log "recreating tunnel from ecosystem file"
Pm2 @("delete", "coolify-db-tunnel") | Out-Null
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
