# Mastery rules + hoja de ruta — actualización 2026-07-09

Para pegar junto con `resumen_continuidad_2026-07-09.md` en el próximo chat. Agrega una capa de reglas de escalamiento y referencia el paradigma COMPASS del Bank of England como norte de largo plazo para los próximos sprints.

---

## Mastery rules — a quién le pregunto qué

Regla general: cada duda del proyecto tiene un nivel natural de resolución. Preguntarle al nivel equivocado (por ejemplo, pedirle al chat que "invente" un número que debería salir de una fuente primaria) es la forma más común de terminar con un dashboard que parece riguroso pero no lo es.

**Nivel 1 — Al experto (esta sesión / Claude):**
- Ajuste de hiperparámetros MCMC: `mh_jscale`, número de draws y burn-in, número de cadenas, criterio de auto-tune de aceptación.
- Revisión de priors: tipo de distribución, si son demasiado informativos o difusos para el tamaño de muestra disponible, coherencia con la literatura DSGE de economías pequeñas y abiertas.
- Diagnóstico de identificación: rank de la matriz de información / Hessiana en la moda, chequeo de multimodalidad con arranques dispersos, interpretación de R-hat / Geweke / ESS (ver Ejercicio 4 de puesta a punto para el playbook concreto).
- Diseño de la capa de incertidumbre (bandas por draws reales, fan charts) y de la arquitectura del código (`interpretacionPolitica.js`, sliders, solver).

**Nivel 2 — Al equipo técnico / literatura de bancos centrales:**
- Papers internos tipo *Staff Working Papers* y documentos técnicos de política monetaria (MTPs) que documentan metodologías DSGE, filtro de Kalman y técnicas avanzadas de muestreo bayesiano. Referencia paradigmática confirmada: Burgess, Fernandez-Corugedo, Groth, Harrison, Monti, Theodoridis y Waldron (2013), *"The Bank of England's Forecasting Platform: COMPASS, MAPS, EASE and the Suite of Models"*, BoE Working Paper No. 471.
- Es la fuente correcta quando la pregunta ya no es "¿cómo ajusto este parámetro?" sino "¿es razonable la estructura del modelo en sí?" — algo que ni el experto en el chat ni la calibración a mano pueden resolver sin apoyo en literatura primaria.

**Resultado esperado del proceso completo:** un nowcasting defendible — que reconoce su propia incertidumbre (bandas, fan charts, diagnósticos de convergencia expuestos, no escondidos) pero se apoya en evidencia técnica sólida y trazable a fuentes primarias, no en calibraciones a mano sin respaldo ni en resultados de MCMC aceptados sin auditoría.

---

## Por qué COMPASS como paradigma (y qué tomar de ahí concretamente)

COMPASS (*Central Organising Model for Projection Analysis and Scenario Simulation*) es el modelo DSGE Nueva-Keynesiano de economía abierta que el BoE usa desde fines de 2011 como núcleo de su plataforma de proyección para el Monetary Policy Committee. <cite index="9-1">Es un modelo DSGE de economía abierta que comparte muchas características con modelos antecedentes de otros bancos centrales, y su implicancia central es que, dado que precios y salarios son rígidos, la política monetaria puede influir sobre la demanda y por lo tanto sobre el producto y el empleo en el corto y mediano plazo, aunque en el largo plazo el producto queda determinado por tecnología y factores de producción.</cite>

Lo que hace a COMPASS relevante como paradigma para este proyecto no es su tamaño (es mucho más grande que el QPM simplificado que estás corriendo), sino su **arquitectura institucional**: <cite index="7-1">no es un modelo aislado sino una plataforma de cuatro componentes — COMPASS como modelo central organizador, una suite de modelos satélite que llena huecos de la economía de COMPASS y provee contrachequeos al pronóstico, MAPS como toolkit de modelado y proyección, y EASE como interfaz de usuario.</cite> Esa suite de modelos satélite existe explícitamente para dos cosas que hoy el QPM dashboard no tiene: (a) contrachequear el modelo central con alternativas más simples cuando el modelo grande da resultados dudosos, y (b) exponer el problema de mala especificación del modelo en vez de esconderlo detrás de un solo número.

Tres implicancias concretas para la hoja de ruta:

1. **El dashboard hoy es "solo COMPASS", sin suite.** No hay ningún chequeo cruzado independiente que contraste la salida del solver principal. El Ejercicio 2 y el Ejercicio 3 de arriba son, en espíritu, el tipo de pregunta que una suite de modelos satélite respondería automáticamente.
2. **`interpretacionPolitica.js` es un embrión de EASE**, no un accesorio — la capa de interfaz que traduce la salida técnica en una lectura interpretable es parte constitutiva de la arquitectura, no un añadido cosmético. Vale la pena tratarla con ese peso en el próximo sprint.
3. **La disciplina de exponer diagnósticos de convergencia como parte del resultado**, no como nota al pie en logs de Octave, es justamente lo que un banco central que se apoya en Staff Working Papers documentados haría distinto de un dashboard de uso personal.

---

## Hoja de ruta actualizada (reemplaza la sección "Próximos pasos" del resumen de continuidad)

1. Confirmar que `index.html` actualizado renderiza bien en el navegador. *(sin cambios)*
2. Alinear las bandas de `interpretacionPolitica.js` con los umbrales reales del semáforo (0.3/1.0 y 0.3/0.8) e integrarlo al `index.html` — tratándolo como la capa EASE del proyecto, no como módulo aparte.
3. Incertidumbre real con MCMC — bandas por draws reales (a) y fan charts de simulación estocástica hacia adelante (b). *(sin cambios en el contenido, ver resumen original)*
4. Conseguir la ecuación de Phillips completa (`a1,a2,a3`) para cerrar la explicación pendiente del canal cambiario→inflación — explotada a propósito en el Ejercicio 1 de puesta a punto.
5. Estimar también los parámetros domésticos con datos reales, en vez de calibración a mano — explotado en el Ejercicio 2.
6. **(nuevo)** Definir un protocolo mínimo de auditoría de convergencia MCMC (R-hat, Geweke, ESS, tasa de aceptación) que se corra *antes* de aceptar cualquier actualización de la tabla de medias posteriores — formalización del playbook del Ejercicio 3.
7. **(nuevo, largo plazo)** Evaluar un primer modelo satélite simple (por ejemplo, un AR/VAR reducido sobre las mismas series) como contrachequeo independiente del solver principal — primer paso concreto hacia una lógica de "suite" en vez de modelo único.
8. **(nuevo)** Rastrear el `oo_` nativo de la corrida MCMC (`oo_.posterior_mean`, `oo_.posterior_hpdinf`, `oo_.posterior_hpdsup`) que no apareció donde se esperaba en Dynare 7.1. No es bloqueante — la tabla de medias posteriores ya está reconstruida y validada a mano desde los draws crudos (`metropolis/*_mh1_blck*.mat`) — pero sirve como punto de control externo independiente, en la misma lógica con la que Wilson auditaba corridas de Dynare desde sus primeros DSGE (~2010). Antes de tacharlo, revisar si el `Output/*_results.mat` completo llegó a generarse en algún punto de la corrida MCMC — puede que esté guardado y simplemente no se haya consultado en el `oo_` vivo de esa sesión.

---

**Fuente citada:** Burgess, S., Fernandez-Corugedo, E., Groth, C., Harrison, R., Monti, F., Theodoridis, K. y Waldron, M. (2013). *The Bank of England's Forecasting Platform: COMPASS, MAPS, EASE and the Suite of Models*. Bank of England Working Paper No. 471. https://www.bankofengland.co.uk/working-paper/2013/the-boes-forecasting-platform-compass-maps-ease-and-the-suite-of-models
