@echo off
setlocal

REM ============================================================
REM  Launcher: MCMC robusto (2020Q2 tratado) con auto-tune jscale
REM  Motor: Octave
REM  Requiere que ya exista qpm_ar1_estimation_robust/Output/
REM  con la moda calculada (mode_compute=4 corrido antes)
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
if not exist "qpm_ar1_estimation_mcmc_robust_v2.mod" (
    echo [ERROR] No se encuentra qpm_ar1_estimation_mcmc_robust_v2.mod en esta carpeta.
    echo          Copia este .bat junto a los archivos del proyecto.
    pause
    exit /b 1
)
if not exist "fred_data_dynare_robust.m" (
    echo [ERROR] No se encuentra fred_data_dynare_robust.m en esta carpeta.
    echo          Copia este .bat junto a los archivos del proyecto.
    pause
    exit /b 1
)

REM --- Verificar que exista la moda robusta previa (mode_compute=4) ---
if not exist "qpm_ar1_estimation_robust\Output\qpm_ar1_estimation_robust_mode.mat" (
    echo [ERROR] No se encuentra qpm_ar1_estimation_robust\Output\qpm_ar1_estimation_robust_mode.mat
    echo          Este MCMC reutiliza la moda de esa corrida ^(mode_compute=0 + mode_file^).
    echo          Corre primero qpm_ar1_estimation_robust.mod antes que este .bat.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Corriendo estimacion bayesiana AR(1) del bloque externo QPM
echo  mode_compute=4 (BFGS) / mh_replic=0 (solo moda, sin MCMC)
echo ============================================================
echo.

"%OCTAVE_EXE%" --no-gui --eval "addpath('%DYNARE_PATH%'); dynare qpm_ar1_estimation_mcmc_robust_v2.mod"

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
    echo  Resultados en la carpeta:  qpm_ar1_estimation\output\
    echo    - Graficos de priors ^(plot_priors=1^)
    echo    - Moda posterior de rho_rw, rho_rs_rw, rho_cpi_rw
    echo    - Desvios estimados de los shocks eps_gdp, eps_rs, eps_cpi
    echo  El log completo queda en: qpm_ar1_estimation.log
    echo ============================================================
)
echo.
pause
