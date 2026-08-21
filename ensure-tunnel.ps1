# Guarantees the Coolify DB tunnel is up AND actually carrying traffic
# (127.0.0.1:5432 -> Postgres, 127.0.0.1:6379 -> Redis).
#
# THE root-cause fix for "Stories render-poller tick failed / Knex timeout".
# Two bugs used to make this unfixable-by-retry:
#
#   1. The old health check was `Test-NetConnection 127.0.0.1 -Port 5432`,
#      which only proves the local ssh.exe is LISTENING. When the VPS reboots,
#      Coolify's docker subnet reshuffles container IPs; ssh keeps listening
#      while every forwarded channel dies on the far side with
#      "connect failed: Connection refused". The port check passed, so this
#      script reported "tunnel already up", and the renderer then died on a
#      Knex pool timeout five minutes later. All day. (2026-08-21)
#
#   2. The forwarded IPs were hardcoded in the PM2 ecosystem file, while
#      tunnel-targets.json - which held the CORRECT IPs - was read by nothing.
#
# So: health is now judged by really speaking Postgres and Redis through the
# tunnel (scripts/tunnel-healthcheck.mjs), and the IPs are re-resolved from
# the VPS via `docker inspect` as part of repair. Container NAMES are stable
# across reboots; IPs are not.
#
# PM2 is gone from this chain (2026-08-21). It supervised exactly one process
# - this ssh tunnel - and had wedged repeatedly: Node DEP0190, ghost PIDs,
# "Process 0 not found", and finally six competing daemons all failing
# "connect EPERM \\.\pipe\rpc.sock", which left no way to restart the tunnel
# at all. The ssh process is now launched detached via WMI and supervised by
# the same Task Scheduler entries that already call this script
# (DollUp-Stories-Render-Poller every 5 min, DollUp-Tunnel-Watchdog every
# 15 min). Launching via WMI rather than Start-Process matters: it reparents
# ssh away from us, so Task Scheduler does not count it as a child and leave
# the tick stuck in "Running".
#
# Shared by start-render-daemon.ps1, start-render-poller.ps1 and the watchdog.
# Exit 0 = tunnel healthy. Exit 1 = could not make it healthy.

param(
  [switch]$Quiet,
  [int]$TimeoutSec = 45
)

# Continue (not Stop): ssh and node write noise to stderr; success is judged
# purely by the health check, so a stray non-terminating error must not abort.
$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$SshExe      = "C:\Windows\System32\OpenSSH\ssh.exe"
$NodeExe     = "C:\Program Files\nodejs\node.exe"
$HealthCheck = Join-Path $scriptDir "scripts\tunnel-healthcheck.mjs"
$TargetsFile = Join-Path $scriptDir "tunnel-targets.json"
$ErrLog      = Join-Path $scriptDir "logs\ssh-tunnel-err.log"

# Fallbacks only - the live values are read from / written to tunnel-targets.json.
$DefaultSshHost        = "root@100.65.8.93"
$DefaultPgContainer    = "w19wlamada7h8ioo7aihmb7u"
$DefaultRedisContainer = "nryk9bn0kzf1vzuvxa4yykxk"

$logDir = Join-Path $scriptDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Log([string]$m) {
  if (-not $Quiet) { Write-Host "[ensure-tunnel] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" }
}

function Read-Targets {
  if (Test-Path $TargetsFile) {
    try { return Get-Content $TargetsFile -Raw | ConvertFrom-Json } catch { }
  }
  return $null
}

$targets        = Read-Targets
$sshHost        = if ($targets.sshHost)        { $targets.sshHost }        else { $DefaultSshHost }
$pgContainer    = if ($targets.pgContainer)    { $targets.pgContainer }    else { $DefaultPgContainer }
$redisContainer = if ($targets.redisContainer) { $targets.redisContainer } else { $DefaultRedisContainer }

# --- Health: really speak Postgres + Redis through the tunnel ----------------
function Test-TunnelHealthy {
  if (-not (Test-Path $HealthCheck)) {
    Log "healthcheck script missing at $HealthCheck - falling back to port probe"
    return (Test-NetConnection 127.0.0.1 -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue)
  }
  $out = & $NodeExe $HealthCheck 2>&1 | Out-String
  $ok = ($LASTEXITCODE -eq 0)
  if (-not $ok -and -not $Quiet -and $out) { Write-Host $out.Trim() }
  return $ok
}

# --- Find / stop the ssh tunnel ---------------------------------------------
# Found by PORT OWNERSHIP first, not by command line. Win32_Process.CommandLine
# comes back NULL for a process whose token we cannot fully query, and that is
# exactly how the stale PM2-era tunnel (PID 17220) survived a "kill every
# ssh.exe matching -L 5432:" sweep on 2026-08-21: it kept holding 5432/6379,
# the freshly started tunnel could not bind, ExitOnForwardFailure killed the
# NEW one, and the broken old one carried on serving refused connections.
# Whoever holds the port is the tunnel that matters, readable command line or not.
function Get-TunnelProcesses {
  $ids = @()
  foreach ($port in 5432, 6379) {
    $ids += @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess)
  }
  # Also catch a tunnel that failed to bind but is still lingering.
  $ids += @(Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" -ErrorAction SilentlyContinue |
              Where-Object { $_.CommandLine -and $_.CommandLine -match '-L\s+5432:' } |
              Select-Object -ExpandProperty ProcessId)

  $ids | Where-Object { $_ } | Sort-Object -Unique | ForEach-Object {
    Get-Process -Id $_ -ErrorAction SilentlyContinue
  } | Where-Object { $_.ProcessName -eq 'ssh' }   # never kill a non-ssh port holder
}

function Stop-Tunnel {
  $procs = @(Get-TunnelProcesses)
  if ($procs.Count -eq 0) { return $true }
  $denied = @()
  # Remember who spawned each tunnel. If a replacement appears seconds after we
  # kill one, that parent is a supervisor respawning it from ITS OWN cached
  # config - which is how a surviving elevated PM2 daemon kept resurrecting the
  # tunnel with pre-reboot IPs on 2026-08-21, long after the ecosystem file was
  # deleted. Naming the supervisor beats another round of "why is it still broken".
  $parents = @{}
  foreach ($p in $procs) {
    $wmi = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction SilentlyContinue
    if ($wmi) { $parents[[int]$p.Id] = [int]$wmi.ParentProcessId }
    Log "stopping existing tunnel PID $($p.Id)"
    try {
      Stop-Process -Id $p.Id -Force -ErrorAction Stop
    } catch {
      $denied += $p.Id
      Log "could not kill PID $($p.Id): $($_.Exception.Message)"
    }
  }
  # Wait for the ports to actually free up, otherwise the replacement tunnel
  # hits ExitOnForwardFailure and dies on startup.
  $waitUntil = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $waitUntil) {
    if (@(Get-TunnelProcesses).Count -eq 0) {
      # Freed - but make sure nothing immediately takes the port back.
      Start-Sleep -Seconds 3
      $respawned = @(Get-TunnelProcesses)
      if ($respawned.Count -eq 0) { return $true }
      foreach ($r in $respawned) {
        $rw = Get-CimInstance Win32_Process -Filter "ProcessId=$($r.Id)" -ErrorAction SilentlyContinue
        $sup = if ($rw) { $rw.ParentProcessId } else { "unknown" }
        Log "ERROR: tunnel PID $($r.Id) was RESPAWNED by parent PID $sup - a supervisor is holding stale config"
        if ($sup -ne "unknown") {
          Log "ACTION REQUIRED: kill the supervisor tree from an ADMIN terminal ->  taskkill /PID $sup /T /F"
        }
      }
      return $false
    }
    Start-Sleep -Milliseconds 500
  }

  # Ports still held. The one case seen in the wild (2026-08-21): the squatter
  # was spawned by an ELEVATED PM2 daemon, so a normal-integrity run of this
  # script gets "Access is denied" and can never reclaim 5432. Say so plainly -
  # a generic "still down" here cost hours of confusion.
  $stuck = @(Get-TunnelProcesses)
  Log "ERROR: ports 5432/6379 still held by PID(s) $($stuck.Id -join ', ') - cannot bind replacement tunnel"
  if ($denied.Count -gt 0) {
    Log "ACTION REQUIRED: PID(s) $($denied -join ', ') refused to die (access denied - higher-integrity token)."
    Log "Fix: run in an ADMIN terminal ->  taskkill /PID $($denied -join ' /PID ') /F   then re-run ensure-tunnel.ps1"
  }
  return $false
}

# --- Resolve the CURRENT container IPs from the VPS --------------------------
function Resolve-Targets {
  $fmt = '{{.Name}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}'
  $remote = "docker inspect -f '$fmt' $pgContainer $redisContainer"
  $raw = & $SshExe -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new $sshHost $remote 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Log "docker inspect over SSH failed: $($raw.Trim())"
    return $null
  }

  $pgIp = $null
  $redisIp = $null
  foreach ($line in ($raw -split "`r?`n")) {
    if ($line -match '^/?(\S+)\s+(\d+\.\d+\.\d+\.\d+)') {
      $name = $Matches[1].TrimStart('/')
      $ip = $Matches[2]
      if ($name -eq $pgContainer)    { $pgIp = $ip }
      if ($name -eq $redisContainer) { $redisIp = $ip }
    }
  }
  if (-not $pgIp -or -not $redisIp) {
    Log "could not parse container IPs from: $($raw.Trim())"
    return $null
  }
  return @{ pgIp = $pgIp; redisIp = $redisIp }
}

function Save-Targets($resolved) {
  $obj = [ordered]@{
    _comment       = "Auto-written by ensure-tunnel.ps1 (docker inspect over SSH). Container IPs change on every VPS reboot - do not hand-edit, just re-run ensure-tunnel.ps1."
    sshHost        = $sshHost
    pgContainer    = $pgContainer
    redisContainer = $redisContainer
    pgIp           = $resolved.pgIp
    redisIp        = $resolved.redisIp
    resolvedAt     = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
  }
  $obj | ConvertTo-Json | Set-Content -Path $TargetsFile -Encoding UTF8
}

# --- Start the tunnel, detached ---------------------------------------------
function Start-Tunnel($pgIp, $redisIp) {
  # The cmd.exe wrapper exists only to capture ssh's stderr; it exits with ssh.
  # Overwriting (not appending) the log is deliberate - the old append-forever
  # behaviour grew a 1.2 MB file of identical "connect failed" lines.
  $sshArgs = "-N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes " +
             "-o BatchMode=yes -o StrictHostKeyChecking=accept-new " +
             "-L 5432:${pgIp}:5432 -L 6379:${redisIp}:6379 $sshHost"
  $cmdLine = "cmd.exe /c `"`"$SshExe`" $sshArgs 2> `"$ErrLog`"`""

  Log "starting tunnel: 5432->${pgIp}:5432, 6379->${redisIp}:6379"
  $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
    -Arguments @{ CommandLine = $cmdLine; CurrentDirectory = $scriptDir } -ErrorAction SilentlyContinue
  if (-not $res -or $res.ReturnValue -ne 0) {
    Log "WMI process create failed (ReturnValue=$($res.ReturnValue))"
    return $false
  }
  return $true
}

# --- Fast path ---------------------------------------------------------------
if (Test-TunnelHealthy) { Log "tunnel healthy"; exit 0 }

Log "tunnel UNHEALTHY - repairing"

# --- Repair ------------------------------------------------------------------
# Re-resolve first: the overwhelmingly common cause is a VPS reboot moving the
# containers. Fall back to the cached values if the VPS is unreachable, so a
# transient SSH blip cannot wipe a good config.
$resolved = Resolve-Targets
if ($resolved) {
  if (($targets.pgIp -ne $resolved.pgIp) -or ($targets.redisIp -ne $resolved.redisIp)) {
    Log "container IPs moved: pg $($targets.pgIp) -> $($resolved.pgIp), redis $($targets.redisIp) -> $($resolved.redisIp)"
  }
  Save-Targets $resolved
} elseif ($targets.pgIp -and $targets.redisIp) {
  Log "using cached targets (VPS unreachable for docker inspect)"
  $resolved = @{ pgIp = $targets.pgIp; redisIp = $targets.redisIp }
} else {
  Log "no targets available and VPS unreachable - cannot repair"
  exit 1
}

if (-not (Stop-Tunnel)) { exit 1 }
if (-not (Start-Tunnel $resolved.pgIp $resolved.redisIp)) { exit 1 }

# --- Wait for the tunnel to actually carry traffic ---------------------------
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  if (Test-TunnelHealthy) { Log "tunnel UP and healthy after repair"; exit 0 }
}

Log "tunnel STILL UNHEALTHY after ${TimeoutSec}s repair window"
if (Test-Path $ErrLog) { Log "last ssh errors: $((Get-Content $ErrLog -Tail 3) -join ' | ')" }
exit 1
