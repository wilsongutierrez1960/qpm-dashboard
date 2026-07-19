# Protocolo de validación — Bloque externo QPM (Dynare)

**Estado previo (ya cerrado):** estimación puntual con `mode_compute=4`, `mh_replic=0`.

| Parámetro | Moda | Std (Hessiana) |
|---|---|---|
| rho_rw | 0.7029 | 0.0667 |
| rho_rs_rw | 0.9567 | 0.0175 |
| rho_cpi_rw | 0.8618 | 0.0421 |
| stderr eps_gdp | 1.0845 | 0.0764 |
| stderr eps_rs | 0.4083 | 0.0289 |
| stderr eps_cpi | 0.8077 | 0.0568 |

Autovalores (`check;`): `[0.7029, 0.8618, 0.9567]` — estacionario. `fval` = 320.26.

Lectura: `rho_rw` quedó lejos del prior FMI (0.8) por el outlier de 2020Q2 en `L_GDP_RW_GAP` (-8.55, fuera de rango respecto al resto de la serie). `RS_RW` y `D4L_CPI_RW` no muestran outliers de esa magnitud en el mismo trimestre.

---

## Paso 1 — Chequeo de robustez (2020Q2 como dato faltante)

**Objetivo:** ver si `rho_rw` sube hacia el prior cuando se remueve la influencia del outlier puntual, sin dummy estructural — usando el manejo nativo de Dynare para observaciones faltantes (NaN) en el filtro de Kalman.

**Archivos:** `qpm_ar1_estimation_robust.mod` + `fred_data_dynare_robust.m` (mismo formato que los originales, `L_GDP_RW_GAP` en 2020Q2 = `NaN`).

**Cómo correr:**
```octave
cd('C:/trabajo/dev/qpm-dashboard')
dynare qpm_ar1_estimation_robust.mod
```
(o copiando el `.bat` y cambiando el nombre del `.mod` adentro)

**Qué mirar en la salida:**
- Los 6 parámetros estimados (moda + std) — comparar `rho_rw` contra 0.7029 original.
- `check;` — que siga dando autovalores < 1.
- `fval` — comparar contra 320.26 (no es directamente comparable si cambió el N efectivo de observaciones, pero sirve de referencia).

**Qué pasarme:** la tabla de 6 parámetros + autovalores + `fval`, igual que la del estado previo.

---

## Paso 2 — MCMC corto (distribución posterior)

**Objetivo:** pasar de la moda puntual a la distribución posterior completa, con intervalos de credibilidad (HPD).

**Archivo:** `qpm_ar1_estimation_mcmc.mod` — reutiliza la moda ya calculada (`mode_compute=0` + `mode_file`), corre 2 cadenas de 20.000 réplicas cada una (`mh_nblocks=2`, `mh_drop=0.5`).

**Pre-requisito:** confirmar que la ruta del `mode_file` en el `.mod` (`qpm_ar1_estimation/Output/qpm_ar1_estimation_mode`) coincide con donde quedó guardado el `.mat` de la corrida original. Si no:
```cmd
dir /s /b qpm_ar1_estimation_mode.mat
```
y ajustar la línea `mode_file = '...'` con esa ruta (sin la extensión `.mat`).

**Cómo correr:** igual que los anteriores, apuntando a este `.mod`.

**Qué mirar en la salida:**
- **Acceptance rate** de cada cadena — Dynare lo imprime en consola; el ideal está entre 20%-40%. Si sale muy alto (>50%) o muy bajo (<15%), avisame para ajustar `mh_jscale`.
- **Diagnósticos de convergencia** (Brooks-Gelman-Rubin, si `mh_nblocks=2` Dynare los calcula/grafica automáticamente) — buscar que las dos cadenas converjan a la misma distribución.
- **Media/mediana posterior e intervalos de credibilidad al 90%** (HPD) para los 6 parámetros — están en `oo_.posterior_mean`/`oo_.posterior_hpdinf`/`oo_.posterior_hpdsup` dentro del `.mat` de resultados de esta corrida.

**Qué pasarme:** el/los `.mat` de resultados (`qpm_ar1_estimation_mcmc_results.mat` o como se llame según el nombre del `.mod`), o al menos tabla con media, std, HPD 90% de cada parámetro + acceptance rate. Los leo igual que hice con los `.mat` anteriores.

---

## Paso 3 — Recalibrar el dashboard con los parámetros estimados (reemplaza IRFs/FEVD aislados)

**Objetivo:** llevar los `rho` y `stderr` estimados (moda del paso 1, o media posterior del paso 2 una vez la tengas) al bloque externo AR(1) del artifact `qpm_diagnostico_politica_monetaria.jsx`, reemplazando el valor fijo de 0.8 que se usa hoy. Ahí es donde las IRFs y el FEVD tienen sentido, porque el shock externo se propaga por UIP/Phillips/Taylor hacia el resto del sistema.

**Qué necesito de vos cuando lleguemos acá:**
- Confirmar qué valor usar (moda puntual del paso 1 vs. media posterior del paso 2).
- Sería ideal tener a mano el código actual del `.jsx` (o al menos la sección donde está hardcodeado el 0.8) para editarlo con precisión en vez de asumir nombres de variables.

**Qué voy a entregar:** el artifact actualizado + comparación antes/después de las IRFs del sistema completo con calibración real vs. prior 0.8.

---

## Checklist rápido para reportar cada corrida

Para cada paso, lo mínimo que necesito de vos:
- [ ] Tabla de parámetros estimados (moda o media posterior + std/HPD)
- [ ] Autovalores del `check;`
- [ ] Cualquier warning en consola (Hessian, convergencia, acceptance rate)
- [ ] Los `.mat` si los tenés a mano (los leo directo, es más rápido que transcribir)
