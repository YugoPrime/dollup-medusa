@echo off
REM Tiny shim so PM2 can launch the daemon reliably on Windows.
REM PM2 7.x cannot pass an args array to powershell.exe without the
REM shell:true args-concatenation bug (Node DEP0190). cmd.exe handling
REM of a .bat is straightforward and survives PM2's spawn behavior.
REM
REM We also redirect stdout/stderr to a local log file because PM2's
REM own log capture is flaky for nested cmd -> powershell -> yarn -> node
REM chains on Windows (out.log / err.log come back empty otherwise).
REM
REM %~dp0 expands to this .bat's directory, so the .ps1 is always
REM resolved relative to the project regardless of PM2's cwd handling.

set "LOGFILE=%~dp0logs\stories-render.log"
if not exist "%~dp0logs" mkdir "%~dp0logs"

echo. >> "%LOGFILE%"
echo === %DATE% %TIME% START === >> "%LOGFILE%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-render-daemon.ps1" >> "%LOGFILE%" 2>&1
set EXITCODE=%ERRORLEVEL%
echo === %DATE% %TIME% END exit=%EXITCODE% === >> "%LOGFILE%"
exit /b %EXITCODE%
