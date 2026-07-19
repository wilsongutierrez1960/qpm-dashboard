@echo off
setlocal
cd /d %~dp0

REM ============================================================
REM  Launcher: Dashboard QPM (Flask + index.html)
REM  Paso 3 de la cadena: servidor local -> abre el dashboard
REM
REM  Estado del index.html servido por este .bat (2026-07-13):
REM  - g2 corregido (1.5) -- Blanchard-Kahn satisfecho
REM  - Fan chart Monte Carlo integrado, horizonte propio 16 trim.
REM    (rango 8-20), toggle de limite de ruido a N periodos
REM  - interpretacionPolitica.js integrado (panel debajo del semaforo)
REM  Si el index.html de esta carpeta es mas viejo que esto, reemplazalo
REM  por la version entregada en la sesion del 2026-07-13 antes de usar
REM  este .bat para nada que dependa de esas correcciones.
REM ============================================================

REM --- Verificar que Python este disponible ---
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] No se encontro "python" en el PATH.
    echo          Instala Python o agregalo al PATH antes de continuar.
    pause
    exit /b 1
)

REM --- Verificar que el servidor Flask este en esta carpeta ---
if not exist "servidor.py" (
    echo [ERROR] No se encuentra servidor.py en esta carpeta: %cd%
    echo          Este .bat tiene que estar junto a servidor.py e index.html.
    pause
    exit /b 1
)

REM --- Verificar que el index.html este en esta carpeta ---
if not exist "index.html" (
    echo [ERROR] No se encuentra index.html en esta carpeta: %cd%
    echo          Copia el index.html mas reciente antes de continuar.
    pause
    exit /b 1
)

echo Instalando dependencias (si faltan)...
pip install flask flask-cors requests --quiet
echo.
echo Iniciando servidor QPM en http://127.0.0.1:5000
echo Dejar esta ventana abierta mientras uses el dashboard.
echo.
start "" /b cmd /c "timeout /t 1 >nul && start http://127.0.0.1:5000"
python servidor.py
pause
