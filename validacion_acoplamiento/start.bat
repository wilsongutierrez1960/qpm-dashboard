@echo off
REM Abre el validador de acoplamiento QPM (version local, sin red) en el navegador por defecto.
REM No requiere servidor: el HTML es autocontenido (sin CDN, sin fetch).

set "DIR=%~dp0"
start "" "%DIR%index.html"
