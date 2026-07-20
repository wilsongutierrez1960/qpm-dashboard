// =============================================================================
// QPM — Estimación bayesiana del bloque externo AR(1)
// Estima rho_rw, rho_rs_rw, rho_cpi_rw con datos reales de FRED (2001Q4-2026Q1)
// Prior: Berg-Karam-Laxton (FMI) sugiere rho ~ 0.8 como punto de partida
// =============================================================================

var L_GDP_RW_GAP RS_RW D4L_CPI_RW;
varexo eps_gdp eps_rs eps_cpi;

parameters rho_rw rho_rs_rw rho_cpi_rw;

// Valores iniciales (se usan solo para el cálculo de la moda posterior, no son el resultado)
rho_rw     = 0.8;
rho_rs_rw  = 0.8;
rho_cpi_rw = 0.8;

model;
    L_GDP_RW_GAP = rho_rw     * L_GDP_RW_GAP(-1) + eps_gdp;
    RS_RW        = rho_rs_rw  * RS_RW(-1)        + eps_rs;
    D4L_CPI_RW   = rho_cpi_rw * D4L_CPI_RW(-1)   + eps_cpi;
end;

// Estado estacionario: procesos centrados en 0 (series ya demeaned en fred_data_dynare.m)
initval;
    L_GDP_RW_GAP = 0;
    RS_RW        = 0;
    D4L_CPI_RW   = 0;
end;

steady;
check;

// -----------------------------------------------------------------------------
// Priors bayesianos
// -----------------------------------------------------------------------------
// rho: Beta(mean=0.8, std=0.1) — refleja el prior FMI (Berg-Karam-Laxton) con
// incertidumbre moderada. Beta está acotada en [0,1], apropiada para persistencia.
//
// sigma (desvío del shock): Inverse Gamma con moda cercana al desvío muestral
// observado en cada serie, grados de libertad bajos (2) para no ser demasiado
// informativo — dejamos que los datos hablen sobre la volatilidad.
// -----------------------------------------------------------------------------

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
// Estimación
// mode_compute=4: BFGS (rápido, bueno para punto de partida).
// Si no converge bien, probar mode_compute=6 (Monte Carlo, más lento pero robusto).
// mh_replic=0: primero corremos solo mode-finding (sin MCMC completo) para
// validar rápido. Subir a 20000+ cuando la moda se vea razonable.
// -----------------------------------------------------------------------------
estimation(
    datafile = fred_data_dynare,
    mode_compute = 4,
    mh_replic = 0,
    plot_priors = 1,
    nograph
);
