# One-time installer for the pre-order quote-scrape poller Task Scheduler entry.
#
# Run this ONCE in an ELEVATED PowerShell (Run as Administrator). After
# that, the task fires automatically every 5 minutes from 09:00 to 22:00 MU
# without needing PM2 or any long-running daemon.
#
# Re-running is safe — `-Force` overwrites the existing registration.

$ErrorActionPreference = "Stop"

# Verify we're elevated
$isElevated = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isElevated) {
  Write-Error "This script must be run from an ELEVATED PowerShell session (Run as Administrator)."
  exit 1
}

$xml = @'
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Polls pending pre-order quote-scrape jobs every 5 min from 09:00 to 22:00 MU. Browser-based SHEIN scrape claims up to QUOTE_SCRAPE_LIMIT jobs per tick. Wider window than the stories poller because clients submit quotes into the evening.</Description>
    <URI>\DollUp\DollUp-Quote-Scrape-Poller</URI>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-21-3180540747-2186663996-3657141921-1001</UserId>
      <LogonType>S4U</LogonType>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT15M</ExecutionTimeLimit>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>true</StartWhenAvailable>
    <IdleSettings>
      <Duration>PT10M</Duration>
      <WaitTimeout>PT1H</WaitTimeout>
      <StopOnIdleEnd>true</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
  </Settings>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-05-28T09:00:00+04:00</StartBoundary>
      <Repetition>
        <Interval>PT5M</Interval>
        <Duration>PT13H</Duration>
        <StopAtDurationEnd>true</StopAtDurationEnd>
      </Repetition>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -File "C:\Users\rahvi\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa\start-quote-daemon-poller.ps1"</Arguments>
      <WorkingDirectory>C:\Users\rahvi\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
'@

Register-ScheduledTask -TaskName "DollUp-Quote-Scrape-Poller" -TaskPath "\DollUp\" -Xml $xml -Force | Out-Null

Write-Host "DollUp-Quote-Scrape-Poller registered successfully."
Write-Host ""
Get-ScheduledTask -TaskName "DollUp-Quote-Scrape-Poller" -TaskPath "\DollUp\" | Format-Table TaskName, State, TaskPath
Write-Host "Next run:"
(Get-ScheduledTaskInfo -TaskName "DollUp-Quote-Scrape-Poller" -TaskPath "\DollUp\").NextRunTime
