# QPM Dashboard — Resumen de continuidad (corte 2026-07-13, sesión 4)

Reemplaza a `resumen_continuidad_2026-07-10_sesion3.md` (sesión 3) para efectos de continuidad. Pegar este `.md` entero al abrir la sesión nueva — no hace falta releer el hilo completo, acá está todo lo necesario.

**Archivos entregados en esta sesión (todos como adjuntos de mensajes anteriores del hilo):** `index.html` (canónico, fusiona todo), `documento_alcance_herramienta_qpm.md` (actualizado), `protocolo_auditoria_mcmc_y_modelo_satelite_2026-07-13.md` (nuevo), `estado_herramienta_qpm_2026-07-13.md` (nuevo, foto de estado independiente del documento de alcance), y los tres `.bat` corregidos (`start.bat`, `start_estimacion.bat`, `start_estimacionrobust.bat`).

---

## LO MÁS IMPORTANTE DE ESTA SESIÓN

Esta sesión arrancó retomando el hallazgo de Blanchard-Kahn de sesión 3 (documentado pero no aplicado todavía) y terminó cerrando prácticamente todo el ciclo: fix aplicado y validado, feature MC llevado de "construido pero con bandas explosivas" a "operativo y legible", `interpretacionPolitica.js` integrado, documento de alcance puesto al día, y un hallazgo de gobernanza nuevo (bug en uno de los `.bat` de estimación) encontrado y corregido.

### 1. Fix de `g2` aplicado y confirmado (ya no es un pendiente)

`CALIB_DEFAULT.g2` pasó de `0.5` a `1.5` en el `index.html` canónico. Confirmado con el mismo test de horizonte-invariancia de sesión 3, corrido esta vez sobre la lógica real extraída del archivo (no sobre el álgebra simbólica): `L_S[0]` para horizontes 8/20/40/80/160 da **1.10/1.66/2.10/2.26/2.27** — converge limpio, reemplazando el rebote caótico de antes (1.31/2.20/8.54/5.82/2.88). Esto ya no es un hallazgo a re-confirmar — es un hecho aplicado y verificado dos veces con métodos distintos (sesión 3: álgebra simbólica; sesión 4: solver real).

### 2. Feature Monte Carlo: de "explosivo" a operativo, con dos decisiones de diseño nuevas

Con `g2` corregido, el ancho promedio de banda del fan chart bajó ~4-9× según la variable (ej. `CPI_GAP`: de 67.8 a 7.4 a horizonte 40). Aun así, seguía siendo ancho para horizontes largos — se tomaron dos decisiones, ambas ya implementadas:

- **Horizonte propio del fan chart**, desacoplado de la "Ventana" general (que sigue en 8-40, default 20, y ahora solo afecta a los gráficos determinísticos). Nuevo slider "Horizonte fan chart": rango 8-20 trim., **default 16**. Con esto el ancho promedio de banda baja a ~2.5-4 (perfectamente legible).
- **Límite opcional de ruido a los primeros N períodos** (checkbox + slider, apagado por default). En vez de un corte duro, deja de inyectar ruido nuevo después de t=N y deja que el ruido ya inyectado se propague/decaiga vía la persistencia ρ de cada bloque. A horizonte 16 el efecto es marginal (~15-20% de reducción adicional) — se dejó opt-in, no como corrección sino como recurso pedagógico para cuando se quiera argumentar "no estamos pronosticando shocks futuros, solo propagando lo ya ocurrido".

Ambos controles quedaron enganchados al sistema de persistencia de estado existente (el `forEach` que engancha `change`/`input` a `render()`).

### 3. `interpretacionPolitica.js` integrado al `index.html`

Se integró **embebido dentro del mismo `<script>`** (sin `export`, sin `<script type="module">` separado) — decisión deliberada para mantener el patrón de archivo único autocontenido que tiene el resto del dashboard, y para no depender de que el archivo se sirva vía Flask en vez de abrirse directo con `file://` (los módulos ES fallan por CORS en `file://`). El archivo `interpretacionPolitica.js` standalone se mantiene aparte solo como fuente testeable con Node — la fuente de verdad ahora vive dentro de `index.html`.

Panel nuevo en el HTML, debajo del semáforo, con snapshot de t=0 (impacto), recalculado en cada `render()`. Probado funcionalmente con los 4 tipos de shock (2 domésticos, 2 externos) contra `solve()` real — sin errores, texto contextual correcto según el tipo de shock y el grupo (doméstico/externo).

### 4. `documento_alcance_herramienta_qpm.md` actualizado — con una reconciliación importante

El documento que llegó (versión de sesión 2) tenía una afirmación que a primera vista contradice el hallazgo de Blanchard-Kahn: el chequeo `check;` de Dynare decía *"0 forward-looking variables"*. **Se reconcilió explícitamente en el documento** (sección 4, punto 1): ese chequeo de Dynare aplica solo al `.mod` del bloque externo AR(1) (que efectivamente no tiene nada forward-looking, y sigue sin tenerlo) — el bloque doméstico **nunca se formalizó como `.mod` de Dynare**, así que el chequeo de Blanchard-Kahn ahí se hizo aparte, a mano, en sesión 3. No es una contradicción entre sesiones, son chequeos sobre objetos distintos. Quedó explicado en detalle en el documento para que no se vuelva a leer como inconsistencia.

También se actualizaron: la tabla de arquitectura (fila del solver con el fix, fila de interpretación ya integrada, fila nueva del fan chart MC), las limitaciones 3 y 4 (distinguiendo la banda paramétrica de la banda bayesiana genuina), la sección de extensiones (ítem forward-looking reencuadrado, ítem MC cerrado, ítem nuevo de modelo satélite), y la tabla de gobernanza (chequeo de autovalores separado en objeto (a) externo/Dynare y objeto (b) doméstico/manual, umbrales de convergencia endurecidos a estándar moderno, fila nueva de contrachequeo satélite).

### 5. Documentos nuevos: protocolo de auditoría MCMC + diseño de modelo satélite

`protocolo_auditoria_mcmc_y_modelo_satelite_2026-07-13.md` — pensado explícitamente para sostenerse ante un revisor técnico exigente (Nivel 2 del esquema de `mastery_rules`). Dos partes:

- **Protocolo formal de auditoría MCMC**: cinco chequeos con umbral numérico y referencia bibliográfica (R-hat ≤1.01 estándar moderno / ≤1.1 clásico, ESS ≥400, Geweke \|z\|<1.96, tasa de aceptación 20-44% según dimensionalidad, PSRF multivariado Brooks-Gelman ≤1.1), plantilla de reporte por parámetro, y regla de rechazo automático si cualquier parámetro falla cualquier chequeo.
- **Diseño del modelo satélite**: AR univariado por variable + VAR reducido con identificación Cholesky (orden CEE), protocolo de comparación de IRFs (signo/forma) y RMSFE fuera de muestra contra el QPM estructural. **Diseñado, no ejecutado** — depende de tener series reales, la misma dependencia que el ítem de estimar el bloque doméstico.

### 6. Paso a paso de recuperación de `oo_` — entregado, pendiente de ejecutar

Se entregó (en el chat, no como archivo aparte) el procedimiento completo para recuperar `oo_` de una estimación ya corrida: ubicar `<fname>/Output/<fname>_results.mat` (que Dynare guarda automático al terminar `estimation`), cargarlo en Octave, extraer `oo_.posterior_mean.parameters` / `oo_.posterior_hpdinf` / `oo_.posterior_hpdsup`, comparar contra los valores ya anotados a mano (`rho_rw=0.8670`, etc.), y qué hacer si el `_results.mat` no existe (buscar la carpeta `metropolis/` con los draws crudos y usar `load_mh_file` para reconsolidar sin re-correr desde cero). **Wilson lo va a ejecutar en una sesión aparte con su Dynare local y va a traer los resultados a la próxima sesión.**

### 7. Bug encontrado y corregido en `start_estimacionrobust.bat`

Se detectó que este `.bat` verificaba la existencia de `qpm_ar1_estimation.robust.mod` pero la línea que efectivamente invocaba a Dynare seguía apuntando a `qpm_ar1_estimation.mod` (el archivo base, sin el tratamiento del outlier 2020Q2) — bug de copiar y pegar. **Si se corrió este `.bat` antes de 2026-07-13 pensando que se usaba la versión robusta, en realidad se corrió la versión base las dos veces** — vale la pena volver a correr la estimación robusta ahora que está corregido, y tratar como sospechoso cualquier resultado "robusto" que se haya usado hasta ahora para calibrar el dashboard.

Se agregó además, en los tres `.bat` (`start.bat`, `start_estimacion.bat`, `start_estimacionrobust.bat`), comentarios explícitos de **cuándo usar cada uno**: `start_estimacion.bat` (base) es solo comparación pedagógica, nunca debería calibrar el `index.html`; `start_estimacionrobust.bat` es el que corresponde para uso normal del proyecto. `start.bat` (Flask) ahora valida que existan `python`, `servidor.py` e `index.html` antes de arrancar, con mensajes de error explícitos si falta algo — antes no tenía ningún chequeo.

---

## Estado de archivos — snapshot exacto de esta entrega

| Archivo | Estado |
|---|---|
| **`index.html`** | ✅ **Canónico, reemplaza a todas las versiones anteriores** (el `index.html` sin MC de sesión 3, y el `index_MC_g2corregido.html` intermedio de esta sesión quedan obsoletos). Contiene: `g2=1.5`, fan chart MC con horizonte propio (16, rango 8-20) y límite de ruido opcional, `interpretacionPolitica.js` embebido con panel propio. Sintaxis validada (`node --check`) y funcionalidad probada (`solve()` + `monteCarloTrayectorias()` + `interpretarDiagnostico()` corridos en Node con datos reales del posterior). |
| `documento_alcance_herramienta_qpm.md` | ✅ Actualizado esta sesión. Incorpora la reconciliación Dynare-check vs. Blanchard-Kahn, y todos los avances de esta sesión. Es ahora la versión vigente — la de sesión 2 que llegó al principio de esta sesión queda obsoleta. |
| `interpretacionPolitica.js` (standalone) | ✅ Sigue existiendo como archivo aparte, solo para testeo con Node — la versión que corre en producción está embebida dentro de `index.html`. |
| `protocolo_auditoria_mcmc_y_modelo_satelite_2026-07-13.md` | ✅ Nuevo, entregado esta sesión. No reemplaza nada anterior — es el primer documento de este tipo. |
| `estado_herramienta_qpm_2026-07-13.md` | ✅ Nuevo, entregado esta sesión (antes de subir el `documento_alcance` actualizado — hoy hay cierta superposición de contenido entre ambos, es esperable, cumplen roles distintos: uno es la foto de estado de una sesión puntual, el otro es el documento de alcance formal y vigente del proyecto). |
| `start.bat` | ✅ Corregido esta sesión — agregados chequeos de `python`/`servidor.py`/`index.html`, sin cambios de fondo en la lógica de arranque. |
| `start_estimacion.bat` | ✅ Sin cambios de fondo — agregado comentario de cuándo usarlo (comparación pedagógica, no para calibrar el dashboard) y la ruta al `oo_` completo en el mensaje final. |
| `start_estimacionrobust.bat` | ✅ **Bug corregido** (ver punto 7 arriba) — ahora sí corre `qpm_ar1_estimation.robust.mod`. |

---

## Roadmap por delante (reordenado, lo que sigue)

1. **Ejecutar el paso a paso de recuperación de `oo_`** (entregado en esta sesión) sobre la estimación ya corrida — idealmente re-corriendo primero `start_estimacionrobust.bat` ya corregido, dado el bug encontrado. Wilson lo trae a la próxima sesión.
2. **Auditar esa estimación con el protocolo formal** (`protocolo_auditoria_mcmc_y_modelo_satelite_2026-07-13.md`, Parte 1) — los cinco chequeos con la plantilla de reporte por parámetro, usando el `oo_` recuperado en el punto 1 como fuente primaria (no la transcripción manual que se usa hoy).
3. **Conseguir series reales** para estimar el bloque doméstico (ítem que en el documento de alcance pasó a ser más urgente: el caso de `g2` mostró que calibrar a mano puede romper una condición necesaria del modelo, no solo "ser menos preciso").
4. **Con datos reales disponibles:** estimar el bloque doméstico y correr el modelo satélite (AR/VAR) en paralelo — cerrar el contrachequeo diseñado en esta sesión (Parte 2 del documento de protocolo).
5. Evaluar el modo "reporte" exportable (PDF/Word con estado semáforo + IRFs + fan chart + tabla de auditoría) como extensión de mediano plazo, mencionada en `estado_herramienta_qpm_2026-07-13.md`.
6. Resolver el componente forward-looking con el aparato completo de perturbación/punto fijo (ítem reencuadrado esta sesión — ya no es "agregar" forward-looking, es resolver con las herramientas correctas los dos canales que ya existían).
7. Cloud/Vertex/GCS — sigue sin ser necesario para nada del roadmap actual.

## Nota de entorno (sin cambios, seguir respetando)

`C:\trabajo\` sincronizado con Google Drive rompe Dynare (`filesystem_error`). Usar `C:\dynare-work\` sin sync, o pausar Google Drive antes de correr Dynare/Octave. Los `.bat` de estimación (`start_estimacion.bat`, `start_estimacionrobust.bat`) viven en `C:\dynare-work\`; el `start.bat` del dashboard vive en `C:\trabajo\dev\qpm-dashboard\` — son cadenas de trabajo distintas, no confundir cuál corregir si aparece un problema de cada lado.
