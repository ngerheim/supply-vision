@echo off
setlocal
set "SV_MIGRAR=%~dp0migrar.ps1"
if not exist "%SV_MIGRAR%" set "SV_MIGRAR=%~dp0scripts\migrar.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process ($env:SystemRoot+'\System32\WindowsPowerShell\v1.0\powershell.exe') -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -NoExit -File '+[char]34+$env:SV_MIGRAR+[char]34)"
