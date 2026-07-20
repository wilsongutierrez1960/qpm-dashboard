@echo off
setlocal

REM ============================================================
REM  Launcher: Estimacion bayesiana bloque externo QPM (Dynare)
REM  Version ROBUSTA: 2020Q2 tratado como missing value (Kalman NaN)
REM  Motor: Octave
REM  Paso 2 de la cadena: Dynare .mod -> moda posterior AR(1)
REM
REM  CUANDO USAR ESTE .bat vs. start_estimacion.bat (2026-07-13):
REM  - Este (robust) es el que corresponde correr en el uso normal
REM    del proyecto de aca en mas -- el tratamiento del outlier de
REM    2020Q2 ya esta confirmado como necesario (sin el, la estimacion
REM    se distorsiona). Es la version que alimenta el index.html.
REM  - start_estimacion.bat (sin "robust") sirve solo como punto de
REM    comparacion pedagogico/diagnostico -- para mostrar cuanto
REM    cambia el resultado sin el tratamiento del outlier -- pero
REM    su resultado NUNCA deberia terminar calibrando el dashboard.
REM
REM  CORREGIDO 2026-07-13: este .bat verificaba la existencia de
REM  "qpm_ar1_estimation.robust.mod" pero despues corria por error
REM  "qpm_ar1_estimation.mod" (el archivo base, sin el tratamiento
REM  robusto) -- bug de copiar y pegar que hacia que cualquier corrida
REM  "robusta" en realidad fuera identica a la version base. Si
REM  corriste esto antes de esta fecha pensando que usabas la version
REM  robusta, conviene volver a correrla ahora que esta corregido.
REM ============================================================

REM --- CONFIGURA ESTA RUTA con tu instalacion real de Dynare ---
REM     Usa barras "/" (no "\") porque Octave las interpreta mejor.
set DYNARE_PATH=C:/dynare/matlab

REM --- Ruta completa al ejecutable de Octave (evita depender del PATH) ---
set OCTAVE_EXE=C:\Octave-11.3.0\mingw64\bin\octave-cli.exe

REM --- Verificar que el ejecutable de Octave exista en esa ruta ---
if not exist "%OCTAVE_EXE%" (
    echo [ERROR] No se encontro octave-cli.exe en: %OCTAVE_EXE%
    echo          Edita la variable OCTAVE_EXE al inicio de este .bat
    echo          con la ruta real ^(usa "dir /s /b C:\ruta\octave-cli.exe"^).
    pause
    exit /b 1
)

REM --- Verificar que exista la ruta de Dynare configurada arriba ---
if not exist "%DYNARE_PATH%" (
    echo [ERROR] No se encontro Dynare en: %DYNARE_PATH%
    echo          Edita la variable DYNARE_PATH al inicio de este .bat
    echo          con la ruta real donde tenes instalado Dynare.
    pause
    exit /b 1
)

REM --- Ir a la carpeta donde esta este .bat (debe contener el .mod y el .m) ---
cd /d "%~dp0"

REM --- Verificar que esten los archivos necesarios ---
if not exist "qpm_ar1_estimation.robust.mod" (
    echo [ERROR] No se encuentra qpm_ar1_estimation.robust.mod en esta carpeta.
    echo          Copia este .bat junto a los archivos del proyecto.
    pause
    exit /b 1
)
if not exist "fred_data_dynare.m" (
    echo [ERROR] No se encuentra fred_data_dynare.m en esta carpeta.
    echo          Copia este .bat junto a los archivos del proyecto.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Corriendo estimacion bayesiana AR(1) del bloque externo QPM
echo  VERSION ROBUSTA (2020Q2 tratado como missing value)
echo  mode_compute=4 (BFGS) / mh_replic=0 (solo moda, sin MCMC)
echo ============================================================
echo.

"%OCTAVE_EXE%" --no-gui --eval "addpath('%DYNARE_PATH%'); dynare qpm_ar1_estimation.robust.mod"

set DYNARE_EXIT=%errorlevel%

echo.
if %DYNARE_EXIT% neq 0 (
    echo [ATENCION] Octave/Dynare termino con codigo de error %DYNARE_EXIT%.
    echo            Revisa el log arriba: errores tipicos son ruta de
    echo            Dynare mal configurada o "check;" fallando por
    echo            raices unitarias ^(rho cercano a 1^).
) else (
    echo ============================================================
    echo  Estimacion finalizada sin errores.
    echo  Resultados en la carpeta:  qpm_ar1_estimation.robust\output\
    echo    - Graficos de priors ^(plot_priors=1^)
    echo    - Moda posterior de rho_rw, rho_rs_rw, rho_cpi_rw
    echo    - Desvios estimados de los shocks eps_gdp, eps_rs, eps_cpi
    echo    - Para el oo_ completo (posterior_mean, hpd, etc.) buscar:
    echo      qpm_ar1_estimation.robust\Output\qpm_ar1_estimation.robust_results.mat
    echo  El log completo queda en: qpm_ar1_estimation.robust.log
    echo ============================================================
)
echo.
pause
