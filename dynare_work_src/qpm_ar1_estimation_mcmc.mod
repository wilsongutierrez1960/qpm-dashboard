// =============================================================================
// QPM — Estimacion bayesiana del bloque externo AR(1) — MCMC CORTO
// Reutiliza la moda ya calculada (mode_compute=0 + mode_file) para no volver
// a correr BFGS, y agrega mh_replic>0 para obtener la distribucion posterior
// completa (no solo el punto) con intervalos de credibilidad.
// =============================================================================

var L_GDP_RW_GAP RS_RW D4L_CPI_RW;
varexo eps_gdp eps_rs eps_cpi;

parameters rho_rw rho_rs_rw rho_cpi_rw;

rho_rw     = 0.8;
rho_rs_rw  = 0.8;
rho_cpi_rw = 0.8;

model;
    L_GDP_RW_GAP = rho_rw     * L_GDP_RW_GAP(-1) + eps_gdp;
    RS_RW        = rho_rs_rw  * RS_RW(-1)        + eps_rs;
    D4L_CPI_RW   = rho_cpi_rw * D4L_CPI_RW(-1)   + eps_cpi;
end;

initval;
    L_GDP_RW_GAP = 0;
    RS_RW        = 0;
    D4L_CPI_RW   = 0;
end;

steady;
check;

estimated_params;
    rho_rw,     beta_pdf, 0.8, 0.1;
    rho_rs_rw,  beta_pdf, 0.8, 0.1;
    rho_cpi_rw, beta_pdf, 0.8, 0.1;
    stderr eps_gdp, inv_gamma_pdf, 1.0, 2;
    stderr eps_rs,  inv_gamma_pdf, 0.5, 2;
    stderr eps_cpi, inv_gamma_pdf, 1.0, 2;
end;

varobs L_GDP_RW_GAP RS_RW D4L_CPI_RW;

// -----------------------------------------------------------------------------
// mode_compute=0 + mode_file: reutiliza la moda ya calculada en la corrida
// original en vez de recalcularla. AJUSTA LA RUTA si tu carpeta de salida
// quedo distinta (Dynare guarda esto por defecto en
// <nombre_mod_original>/Output/<nombre_mod_original>_mode.mat).
// Si el archivo no aparece, corre "dir /s /b qpm_ar1_estimation_mode.mat"
// desde la carpeta del proyecto y pega esa ruta aca (sin la extension .mat).
//
// mh_replic=20000, mh_nblocks=2: dos cadenas cortas, suficientes para ver
// forma de la posterior y credibilidad sin correr toda la noche. Si tarda
// demasiado en tu maquina, bajalo a 10000.
// mh_drop=0.5: descarta el primer 50% de cada cadena como burn-in.
// -----------------------------------------------------------------------------
estimation(
    datafile = fred_data_dynare,
    mode_compute = 0,
    mode_file = 'qpm_ar1_estimation/Output/qpm_ar1_estimation_mode',
    mh_replic = 20000,
    mh_nblocks = 2,
    mh_drop = 0.5,
    mh_jscale = 0.4,
    bayesian_irf,
    nograph
);
