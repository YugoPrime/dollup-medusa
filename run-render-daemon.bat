@echo off
REM Tiny shim so PM2 can launch the daemon reliably on Windows.
REM PM2 7.x cannot pass an args array to powershell.exe without the
REM shell:true args-concatenation bug (Node DEP0190). cmd.exe handling
REM of a .bat is straightforward and survives PM2's spawn behavior.
REM
REM %~dp0 expands to this .bat's directory, so the .ps1 is always
REM resolved relative to the project regardless of PM2's cwd handling.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-render-daemon.ps1"
exit /b %ERRORLEVEL%
