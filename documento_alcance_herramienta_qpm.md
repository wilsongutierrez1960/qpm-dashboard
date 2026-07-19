# QPM Dashboard — Documento de alcance

## 0. Bitácora de cambios

Este documento se actualiza en ciclos cortos: una entrada de bitácora al cierre de cada sesión con avances de fondo, y una reescritura completa de las secciones afectadas cada 3-4 sesiones o al cerrar una fase. Objetivo: que nunca quede más de una sesión de atraso respecto del estado real del proyecto.

- **2026-07-15** — Auditoría de la corrida `qpm_ar1_estimation_mcmc_robust_v2`: `Output/` apareció vacío (el post-proceso de Dynare nunca corrió, solo el muestreo MCMC). Se reconstruyó la media posterior a mano desde los draws crudos (`x2` en `metropolis/*_mh1_blckN.mat`, burn-in 50% por cadena, dos cadenas concatenadas) y coincidió exactamente con los valores ya adoptados — confirmación cruzada de robustez. En el camino se detectó y documentó un error propio de mapeo de columnas (ver §7, nota técnica de Dynare). Se agregó el "paso 0" al protocolo de auditoría MCMC (§7) y se preparó `qpm_ar1_estimation_mcmc_load_mh_file.mod` para recuperar el `oo_` oficial sin re-correr el muestreo, pendiente de confirmar que el nombre de archivo/carpeta coincida con el proyecto real antes de ejecutarlo.

## 1. Qué es

Una herramienta de **diagnóstico didáctico de política monetaria** basada en una versión simplificada del framework QPM (Quarterly Projection Model) del FMI — Berg, Karam & Laxton (2006), "A Practical Model-Based Approach to Monetary Policy Analysis". No es un modelo de pronóstico operativo ni un sustituto de un QPM completo de banco central: es un **simulador de mecanismos de transmisión**, calibrado con datos reales para la parte externa y con parámetros fijados a mano para la parte doméstica.

## 2. Arquitectura técnica

| Componente | Qué hace | Estado |
|---|---|---|
| Solver lineal (Gauss) | Resuelve el sistema de ecuaciones stacked-time para un shock dado | Operativo, corregido de un Gauss-Seidel divergente anterior |
| Bloque externo AR(1) | `L_GDP_RW_GAP`, `RS_RW`, `D4L_CPI_RW` — 3 procesos independientes, cada uno con su propio ρ | Estimado por Bayes (Dynare, MCMC con R-hat≤1.0025), robustecido a outlier 2020Q2, **integrado al `index.html`** con la media posterior (ρ=0.8670/0.9535/0.8594) reemplazando el ρ único compartido que tenía antes |
| IS / Phillips / Taylor / UIP | 4 ecuaciones core del sistema doméstico | Calibradas a mano, no estimadas con datos |
| Identidad MCI | `MCI_t = b4·RR_t − (1−b4)·L_Z_t` | Operativa, con descomposición visual del canal tasa vs. canal cambiario |
| Panel de diagnóstico rápido | Clasifica 3 variables × 3 horizontes en Normal/Alerta/Crítico | Operativo — **umbrales confirmados en código**: 0.3/1.0 para inflación y brecha de producto, 0.3/0.8 para MCI (sobre valor absoluto del gap) |
| Validación estadística | Test de correlación MCI→brecha con signo esperado y p-valor (Fisher z) | Operativo, panel binario pass/fail |
| IRFs con banda de sensibilidad | Reproduce la IRF variando **cualquier parámetro de calibración elegible por dropdown** (no solo b3) ±0.15 | Operativo — **es sensibilidad paramétrica, no incertidumbre bayesiana** |
| Capa de interpretación (`interpretacionPolitica.js`) | Texto condicional según estado (matriz 3×3 output×inflación + severidad + contexto de shock) | Bandas de severidad **ya alineadas con los umbrales reales del semáforo** (0.3/1.0 y 0.3/0.8); **integración visual al `index.html` todavía pendiente** |
| Meta de inflación (`D4L_TAR`) | Referencia para `CPI_GAP` | Corregida de 3.0 (desactualizado) a **2.0**, valor confirmado del proyecto |

## 3. Funcionalidad actual

- Simular 8 tipos de shock (4 domésticos, 4 externos) con magnitud, persistencia y horizonte configurables.
- Ver la cadena de transmisión completa: shock → UIP → tipo de cambio → MCI → brecha de producto → inflación → tasa de política.
- Cargar datos reales de FRED (GDPC1, FEDFUNDS, CPIAUCSL) y alimentar el bloque externo con ellos en vez de series sintéticas.
- Validar estadísticamente si el mecanismo de transmisión "funciona" en una calibración dada.
- Explorar sensibilidad de un parámetro a la vez sobre el IRF resultante.

## 4. Limitaciones — para tener siempre presentes

Esta sección es la más importante del documento. Cada punto acá es algo que la herramienta **no** hace, aunque a primera vista el output se vea completo:

1. **Modelo totalmente backward-looking.** El chequeo de Dynare lo confirma explícitamente: *"0 eigenvalue(s) larger than 1 in modulus for 0 forward-looking variable(s)"*. No hay expectativas racionales ni forward guidance — el modelo no puede capturar el canal de credibilidad/anuncios, que en la práctica es una parte central de cómo opera la política monetaria moderna. El QPM completo del FMI sí tiene componente forward-looking; esta versión, no.

2. **Parámetros domésticos calibrados, no estimados.** Solo el bloque externo (3 `rho`, 3 `stderr`) salió de datos reales vía Bayes — y ahora está efectivamente conectado al `index.html` que corre en producción, no solo estimado y guardado aparte. Los coeficientes de IS, Phillips, Taylor y UIP (`a1,a2,a3,b1,b2,g1,g2,g3,e1`) siguen siendo valores fijados a mano — no tienen incertidumbre estadística asociada, aunque el panel los use con la misma confianza aparente que a los estimados. Esta asimetría es ahora más visible que antes: al mover los sliders de ρ ves un modelo con base empírica real; al mover los sliders de `b`/`a`/`g` estás moviendo un supuesto sin dato detrás.

3. **Las bandas de sensibilidad NO son intervalos de credibilidad.** Tu propia herramienta lo aclara en el pie de página: *"Bandas = sensibilidad paramétrica ±0.15, no intervalos bayesianos"*. Mover b3 ±0.15 muestra qué tan sensible es el resultado a ese supuesto puntual — no cuantifica la probabilidad de que el resultado real caiga en ese rango.

4. **Las IRFs son determinísticas, no estocásticas.** El propio código lo anota: *"R² = varianza compartida sobre un único IRF determinístico (no un FEVD estructural)"*. Es un solo camino simulado, no una distribución de caminos posibles.

5. **Muestra chica y con quiebres estructurales.** 98 trimestres, con al menos dos episodios extremos (2008-09, 2020) que ya vimos que distorsionan la estimación si no se tratan explícitamente. Cualquier extensión futura de la muestra (nuevos trimestres) puede traer nuevos outliers que requieran el mismo tratamiento ad-hoc que le dimos a 2020Q2 — no hay un mecanismo automático de detección todavía.

6. **Es un modelo de open economy chico con bloque externo desacoplado.** Las 3 series externas son AR(1) independientes entre sí — no hay contagio cruzado entre inflación externa, actividad externa y tasa externa dentro del modelo (aunque en la realidad esas tres cosas están correlacionadas).

## 5. Cómo explicarle el alcance a estudiantes de economía monetaria

Sugerencia de texto para poner al principio de una clase o guía de uso:

> *"Esta herramienta es un simulador didáctico de los mecanismos de transmisión de política monetaria, inspirado en el framework QPM del FMI. Sirve para entender **cualitativamente** cómo un shock se propaga por la economía — qué canal actúa primero, cuál después, en qué dirección. No sirve para pronosticar valores reales ni para replicar una decisión de tasa de un banco central: los parámetros domésticos están fijados a criterio, el modelo no incorpora expectativas, y las bandas que ven en los gráficos miden sensibilidad a un supuesto, no probabilidad. Úsenla para razonar sobre mecanismos, no para leer números como si fueran un pronóstico."*

## 6. Potencial — extensiones posibles, en orden de impacto

1. **Estimar también el bloque doméstico** con datos reales (PIB, IPC, tasa de política domésticos) — hoy solo el externo pasó por Bayes. Viable en local, sin necesidad de más recursos que los actuales (ver sección 8).
2. **Agregar componente forward-looking** al estilo QPM completo — cambiaría la clase de modelo (de puramente backward a mixto), pero es el salto que más acercaría la herramienta al framework original del FMI. Viable en local, pero con corridas más lentas (minutos en vez de segundos).
3. **IRFs/trayectorias estocásticas genuinas** — *en curso*: dos features en desarrollo, (a) banda de incertidumbre construida con los draws reales del posterior MCMC en vez de la banda paramétrica ±0.15 fija, (b) simulación estocástica hacia adelante inyectando los `stderr eps_*` estimados en cada período, no solo en el impulso inicial. Computacionalmente trivial, corre en local sin problema.
4. **Sensibilidad multi-parámetro simultánea** (hoy es un parámetro a la vez, elegible por dropdown).
5. **Comparación de escenarios lado a lado** (correr dos shocks o dos calibraciones y ver las IRFs superpuestas).
6. **Detección automática de outliers** en cualquier nueva serie que se cargue desde FRED, en vez de tratarlos caso por caso manualmente como con 2020Q2.
7. **Filtros no lineales / barridos grandes de especificaciones** — acá sí conviene infraestructura en la nube (Compute Engine o Cloud Run con Octave+Dynare en contenedor, Flask local como orquestador, GCS como punto de entrega de resultados). No es necesario para nada de lo anterior — recién se vuelve relevante si se persigue el punto 2 con métodos no lineales (particle filters) o si se quieren correr muchas especificaciones en paralelo.

## 7. Reglas de gobernanza — guardarraíles antes de decisiones

Esto responde directamente a tu pregunta de fondo: qué tiene que revisar quien usa la herramienta **antes** de saltar a una conclusión de política. Tu ejemplo del acceptance rate MH es exactamente el modelo a seguir — un chequeo técnico que, si falla, invalida la confianza en el resultado aunque el número final "se vea bien". Propongo una lista de chequeos equivalentes, pensados para implementarse como semáforos de "pre-vuelo" que bloqueen o adviertan antes de mostrar la interpretación final:

| # | Chequeo | Umbral sugerido | Qué significa si falla |
|---|---|---|---|
| 0 | Post-proceso completo | `Output/*_results.mat` existe y `oo_.posterior_mean` (o equivalente) está poblado | El MCMC corrió pero Dynare no llegó a calcular el resumen posterior — la corrida no está cerrada aunque `metropolis/` tenga los draws. No dar por buena ninguna cadena hasta confirmar esto. Recuperable sin re-muestrear vía `mh_replic=0` + `load_mh_file` |
| 1 | Acceptance rate MH | 20%-40% por cadena | Posterior no confiable, repetir con jscale ajustado (ya lo vivimos) |
| 2 | Convergencia Brooks-Gelman-Rubin | < 1.1-1.2 | Las cadenas no convergieron a la misma distribución — no promediar los resultados |
| 3 | Inefficiency factor | idealmente < 20 | Draws efectivos insuficientes para HPD confiables |
| 4 | Autovalores (`check;`) | todos < 1 en módulo | Proceso no estacionario, la estimación entera pierde sentido |
| 5 | Outlier no tratado en la muestra | ningún dato > ~4-5 desvíos de su propia serie | Repetir el mismo tratamiento que a 2020Q2 antes de confiar en el `rho` resultante |
| 6 | Distancia prior-posterior | moda del `rho` no pegada a 0.99+ | Riesgo de casi-raíz-unitaria no capturado por el prior Beta |
| 7 | Calibración doméstica vs. última estimación externa | si el `rho` estimado cambia >0.05 respecto al usado en el dashboard | El dashboard puede estar corriendo con una calibración externa desactualizada |

**El punto más importante de esta lista, y el que conecta con tu pregunta sobre inflación vs. actividad:** el filtro de Kalman efectivamente combina múltiples señales ruidosas (en este caso, inflación y actividad) de forma **estadísticamente óptima** — pondera cada observable según su varianza de shock relativa, dado el modelo. Pero eso es optimalidad **estadística**, no optimalidad de **política**. Cuánto le importa a un banco central desviarse de la meta de inflación versus desviarse del producto potencial es una elección normativa (el peso λ de un mandato dual), no algo que el filtro de Kalman decida por vos — el filtro te da el mejor estimado del estado del mundo, no la mejor respuesta de política ante ese estado.

**Regla de gobernanza concreta que sugiero para la capa de interpretación:** que `interpretacionPolitica.js` (o el panel que la muestre) **nunca presente un solo veredicto de "sesgo sugerido" sin mostrar por separado la contribución de brecha de producto y de brecha de inflación** — exactamente como ya hace la matriz 3×3 que armé, que separa `outputGap` e `inflación` en vez de fundirlos en un solo número. Eso obliga a quien lee el panel a ver el trade-off explícitamente, en vez de que la herramienta se lo resuelva calladamente con un peso arbitrario.

### Nota técnica de Dynare — orden de columnas en `x2` (draws crudos del MCMC)

Cuando se reconstruye la media posterior a mano desde `metropolis/*_mh1_blckN.mat` (sin pasar por `oo_`), las columnas de `x2` **no** siguen el orden textual en que aparecen los parámetros en el bloque `estimated_params` del `.mod`. Dynare las reordena internamente así:

1. Primero los `stderr` de los shocks estimados, en el orden en que se declararon entre sí.
2. Después las correlaciones estimadas, si las hay.
3. Recién al final los parámetros estructurales (los `rho`, coeficientes, etc.).

Ejemplo concreto de este proyecto (bloque `estimated_params` escrito con los `rho` primero y los `stderr` después): el orden real de columnas en `x2` es `stderr_eps_gdp, stderr_eps_rs, stderr_eps_cpi, rho_rw, rho_rs_rw, rho_cpi_rw` — invertido respecto al orden de declaración. Asumir el orden textual produce un mapeo cruzado que da valores numéricamente plausibles pero incorrectos (los `rho` toman los valores de los `stderr` y viceversa), sin que ningún chequeo automático lo detecte — hay que confirmarlo a mano cada vez, o preferir extraer la media posterior desde `oo_` (que ya viene con los campos correctamente nombrados) en vez de indexar `x2` manualmente.

## 8. Techo de cómputo local — qué entra en el hardware actual y qué no

Contexto: laptop HP 250 G7, dual boot, 8GB RAM con upgrade a 16GB pendiente, sin GPU dedicada.

**Corre bien en local, sin necesidad de más recursos:**
- Todo lo hecho hasta ahora (estimación Bayesiana del bloque externo, 6 parámetros, MCMC 20k×2 cadenas) — problema chico para cualquier laptop.
- Estimar también el bloque doméstico (~9 parámetros más) — el sistema sigue siendo lineal y pequeño, el Hessian escala con el cuadrado del número de parámetros pero sigue siendo trivial en memoria para ~15 parámetros.
- Las dos extensiones de incertidumbre real (bandas con draws del posterior, simulación estocástica de trayectorias) — resolver un sistema lineal chico cientos/miles de veces, trivial computacionalmente.

**Exige más tiempo (no necesariamente más RAM), pero sigue siendo viable en local:**
- Un QPM con expectativas racionales (forward-looking) — pasa de resolución lineal directa a métodos de punto fijo/perturbación, cada corrida tarda minutos en vez de segundos, pero corre en el laptop igual.

**Se escapa del laptop — no es un problema de RAM sino de otra naturaleza:**
- **Filtros no lineales (particle filters)** para modelos con no linealidades explícitas — escalan mal (muchas partículas × muchos períodos × muchos draws), pueden tardar horas incluso en una estación de trabajo. Acá ayuda más CPU/núcleos que RAM.
- **Barridos grandes de especificaciones** (20-30 variantes del modelo, cada una con estimación completa) — no por corrida pesada, sino por ser muchas corridas secuenciales. Es un problema "embarazosamente paralelo": ideal para varias máquinas en simultáneo, no para una sola.
- **Calidad del LLM local** (`qwen2.5:3b`/`7b` vía Ollama) — techo de capacidad del modelo en sí, no lo resuelve ni RAM ni tiempo; hace falta GPU o un modelo corriendo en otro lado.

**Sobre conectar infraestructura en la nube (Vertex AI / GCS / Cloud Run):** el patrón "Flask local dispara, GCS entrega resultados" es correcto para los dos primeros puntos de arriba — pero no es necesario todavía para nada del roadmap actual (ítems 1-6 de la sección 6). Vertex AI específicamente está pensado para entrenamiento/serving de ML (AutoML, Feature Store, registro de modelos) — Dynare/Octave no encajan naturalmente ahí; para este caso conviene más ir directo a Compute Engine o Cloud Run Jobs con un contenedor Octave+Dynare, sin la capa de abstracción de ML que no se va a usar. Vale la pena armar esa infraestructura recién cuando se persiga expectativas racionales con métodos no lineales o barridos grandes de especificaciones — ninguno de los dos está en el corto plazo del roadmap.
