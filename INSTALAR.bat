@echo off
setlocal
title Supply Vision - Instalacao
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo Instalacao concluida com sucesso.) else (echo A instalacao terminou com erro.)
echo.
if not defined CI pause
exit /b %RC%
