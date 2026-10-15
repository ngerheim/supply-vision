@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sv.ps1" %*
exit /b %errorlevel%
