// =============================================================================
// QPM — Estimacion bayesiana del bloque externo AR(1) — CHEQUEO DE ROBUSTEZ
// Identico al .mod original, salvo que usa fred_data_dynare_robust.m, donde
// L_GDP_RW_GAP en 2020Q2 se marco como NaN (observacion faltante) en vez de
// usar el valor real -8.545751. El resto de la muestra queda intacto.
//
// Objetivo: ver si rho_rw sube hacia el prior FMI (0.8) cuando se remueve
// la influencia del outlier pandemico puntual, sin alterar la dinamica del
// resto de la serie ni introducir un dummy estructural en el modelo.
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

// Misma metodologia que la corrida original (solo moda, sin MCMC) para que
// la comparacion moda-vs-moda sea directa. Dynare marginaliza el NaN de
// 2020Q2 automaticamente al evaluar la verosimilitud via filtro de Kalman.
estimation(
    datafile = fred_data_dynare_robust,
    mode_compute = 4,
    mh_replic = 0,
    plot_priors = 1,
    nograph
);
