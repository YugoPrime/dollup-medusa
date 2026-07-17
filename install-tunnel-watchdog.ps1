# One-time installer for \DollUp\DollUp-Tunnel-Watchdog.
#
# Registers a scheduled task that runs ensure-tunnel.ps1 every 15 minutes,
# all day, keeping the coolify-db-tunnel SSH tunnel continuously alive so the
# render daemon/poller never find it down. Self-heal in the render scripts is
# the safety net; this watchdog is the proactive layer.
#
# MUST be run from an ELEVATED PowerShell (Run as Administrator) - registering
# a task under \DollUp\ with an S4U principal requires admin. Run once:
#   powershell -ExecutionPolicy Bypass -File .\install-tunnel-watchdog.ps1
#
# Idempotent: re-running overwrites the existing task (-Force).

$ErrorActionPreference = "Stop"

$dir = "C:\Users\rahvi\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$dir\ensure-tunnel.ps1`" -Quiet" `
  -WorkingDirectory $dir

# Fire every 15 min, indefinitely. Build the repetition off a fresh trigger so
# the pattern is well-formed on PowerShell 5.1.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 15) `
  -RepetitionDuration (New-TimeSpan -Days 3650)).Repetition

# Match the sibling \DollUp\ tasks exactly: run as rahvi, S4U (whether logged
# on or not), Limited run level.
$principal = New-ScheduledTaskPrincipal -UserId "rahvi" -LogonType S4U -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskPath "\DollUp\" -TaskName "DollUp-Tunnel-Watchdog" `
  -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Registered \DollUp\DollUp-Tunnel-Watchdog:"
Get-ScheduledTask -TaskPath "\DollUp\" -TaskName "DollUp-Tunnel-Watchdog" |
  Select-Object TaskName, State | Format-Table -AutoSize

Write-Host "Running it once now to verify..."
Start-ScheduledTask -TaskPath "\DollUp\" -TaskName "DollUp-Tunnel-Watchdog"
Start-Sleep -Seconds 8
$info = Get-ScheduledTask -TaskPath "\DollUp\" -TaskName "DollUp-Tunnel-Watchdog" | Get-ScheduledTaskInfo
Write-Host ("LastRunTime={0}  LastTaskResult={1} (0 = success)" -f $info.LastRunTime, $info.LastTaskResult)
$portUp = Test-NetConnection 127.0.0.1 -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue
Write-Host ("Tunnel port 5432 listening: {0}" -f $portUp)
