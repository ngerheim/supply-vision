@echo off
REM Pede elevacao sozinho. Clicar duas vezes aqui basta: o Windows vai
REM perguntar se autoriza, e o script roda como Administrador.
title Restringir acesso do Portal Suprimentos
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"%~dp0scripts\restringir-firewall.ps1\"' -Verb RunAs"
