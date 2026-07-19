// =============================================================================
// interpretacionPolitica.js
// Motor de interpretaciones condicionales para el diagnóstico QPM.
// Enfoque "RAG liviano": tabla de reglas + plantillas de texto, sin embeddings
// ni servidor — corre 100% client-side dentro del artifact JS.
//
// Entrada esperada: un snapshot del estado del solver en un horizonte t
// (normalmente t=0 o el que elija el usuario), con esta forma:
//   {
//     L_GDP_GAP: number,   // brecha del producto, ya en gap (ref = 0)
//     D4L_CPI:   number,   // inflación interanual domestica (NO gap, nivel)
//     RS:        number,   // tasa de política nominal (NO gap, nivel)
//     RR:        number,   // tasa real (Fisher), NO gap, nivel
//     MCI:       number,   // índice de condiciones monetarias, ya en gap
//     shockType: string,   // uno de los 8 valores existentes en el .jsx
//     shockMeta: { group: 'Doméstico' | 'Externo', label: string }
//   }
// =============================================================================

// -----------------------------------------------------------------------------
// 1) Estado estacionario / referencias (confirmadas por el usuario)
// -----------------------------------------------------------------------------
export const REFERENCIAS = {
  outputGap:  0.0,   // % — producto potencial
  inflacion:  2.0,   // % interanual — meta de inflación
  tasaPolitica: 2.5, // % nominal — tasa de política en steady state
  tasaReal:   0.5,   // % — tasa real neutral (Fisher: 2.5% - 2.0%)
  mci:        0.0,   // condiciones monetarias neutrales
};

// Bandas alineadas EXACTAMENTE con los umbrales reales del semáforo del
// index.html (función trafficLight, líneas ~487-491 y tabla de umbrales
// ~524). Dos cortes por variable: |gap| <= alerta => Normal (verde),
// alerta < |gap| <= critico => Alerta (amarillo), |gap| > critico => Crítico
// (rojo). tasaReal NO tiene panel propio en el dashboard real — banda propia,
// sin fuente que confirmar (marcado explícitamente abajo).
export const BANDAS = {
  outputGap: { alerta: 0.3, critico: 1.0 },  // igual a CPI_GAP y L_GDP_GAP en index.html
  inflacion: { alerta: 0.3, critico: 1.0 },  // igual a CPI_GAP en index.html
  mci:       { alerta: 0.3, critico: 0.8 },  // igual a MCI en index.html
  tasaReal:  { alerta: 0.5, critico: 1.5 },  // SIN equivalente en el semáforo real -- criterio propio, no confirmado
};

// -----------------------------------------------------------------------------
// 2) Clasificación de cada gap en 3 estados (verde/amarillo/rojo → texto)
// -----------------------------------------------------------------------------
function clasificar(valor, referencia, banda) {
  const gap = valor - referencia;
  const abs = Math.abs(gap);
  const severidad = abs <= banda.alerta ? 'normal' : (abs <= banda.critico ? 'alerta' : 'critico');
  const estado = abs <= banda.alerta ? 'neutral' : (gap > 0 ? 'alto' : 'bajo');
  const color = severidad === 'normal' ? 'verde' : (severidad === 'alerta' ? 'amarillo' : 'rojo');
  return { estado, gap, severidad, color };
}

export function construirEstado(snapshot) {
  const outputGap = clasificar(snapshot.L_GDP_GAP, REFERENCIAS.outputGap, BANDAS.outputGap);
  const inflacion = clasificar(snapshot.D4L_CPI, REFERENCIAS.inflacion, BANDAS.inflacion);
  const tasaReal = clasificar(snapshot.RR, REFERENCIAS.tasaReal, BANDAS.tasaReal);
  const mci = clasificar(snapshot.MCI, REFERENCIAS.mci, BANDAS.mci);

  return { outputGap, inflacion, tasaReal, mci, shockType: snapshot.shockType, shockMeta: snapshot.shockMeta };
}

// -----------------------------------------------------------------------------
// 3) Tabla de reglas: combinación (outputGap × inflación) → diagnóstico base
//    Es la matriz clásica de diagnóstico de política (3×3), pero calculada
//    en vivo a partir de los valores del solver en vez de venir de un panel
//    fijo. Las claves son "estadoOutputGap|estadoInflacion".
// -----------------------------------------------------------------------------
const MATRIZ_DIAGNOSTICO = {
  'alto|alto': {
    resumen: 'Economía recalentada con presión inflacionaria al alza',
    riesgo: 'La combinación de exceso de demanda e inflación por encima de la meta típicamente exige una respuesta contractiva; postergarla suele elevar el costo de desinflación futuro.',
    sesgo: 'contractivo',
  },
  'alto|neutral': {
    resumen: 'Producto por encima del potencial con inflación aún contenida',
    riesgo: 'La brecha positiva sin traslado inflacionario pleno puede reflejar rezagos de la curva de Phillips; vale monitorear si la presión se traslada a precios en los próximos trimestres.',
    sesgo: 'levemente contractivo',
  },
  'alto|bajo': {
    resumen: 'Producto por encima del potencial pero inflación por debajo de la meta',
    riesgo: 'Combinación poco común — puede señalar un shock de oferta positivo (mejora de productividad o términos de intercambio) más que exceso de demanda genuino.',
    sesgo: 'neutral, con seguimiento del origen del shock',
  },
  'neutral|alto': {
    resumen: 'Producto en línea con el potencial pero inflación por encima de la meta',
    riesgo: 'Sin holgura de demanda que explique la inflación, el origen es probablemente de costos o expectativas — la respuesta de tasa por sí sola puede ser menos efectiva y más costosa en términos de actividad.',
    sesgo: 'contractivo, evaluando la persistencia del shock',
  },
  'neutral|neutral': {
    resumen: 'Economía cerca de su equilibrio de largo plazo',
    riesgo: 'Escenario de "coincidencia divina": brecha de producto y de inflación simultáneamente controladas. El principal riesgo es de política, no de fundamentos: cambios de tasa en este punto pueden desanclar innecesariamente las expectativas.',
    sesgo: 'neutral',
  },
  'neutral|bajo': {
    resumen: 'Producto en línea con el potencial pero inflación por debajo de la meta',
    riesgo: 'Inflación baja sin holgura real de por medio sugiere expectativas ancladas a la baja o un shock desinflacionario transitorio (ej. términos de intercambio, tipo de cambio).',
    sesgo: 'levemente expansivo',
  },
  'bajo|alto': {
    resumen: 'Producto por debajo del potencial con inflación por encima de la meta',
    riesgo: 'El escenario más difícil para la autoridad monetaria — estanflación. La regla de Taylor estándar no da una respuesta única; requiere ponderar explícitamente el trade-off entre actividad e inflación.',
    sesgo: 'ambiguo, requiere juicio de política explícito',
  },
  'bajo|neutral': {
    resumen: 'Producto por debajo del potencial con inflación aún en meta',
    riesgo: 'Holgura de demanda sin presión inflacionaria dejaría espacio para una respuesta expansiva sin poner en riesgo la meta, si el shock que originó la brecha no es de oferta.',
    sesgo: 'expansivo',
  },
  'bajo|bajo': {
    resumen: 'Economía con holgura de demanda e inflación por debajo de la meta',
    riesgo: 'Cuadro clásico de brecha recesiva — ambos indicadores apuntan en la misma dirección, lo que da mayor confianza a una respuesta expansiva que en los cuadros mixtos.',
    sesgo: 'expansivo',
  },
};

// -----------------------------------------------------------------------------
// 4) Modificadores secundarios: coherencia entre la tasa real / MCI y el
//    sesgo sugerido por la matriz de arriba. Si divergen, se marca como
//    alerta en vez de reforzar el diagnóstico.
// -----------------------------------------------------------------------------
function evaluarConsistencia(estado, sesgoSugerido) {
  const tasaContractiva = estado.tasaReal.estado === 'alto';
  const tasaExpansiva = estado.tasaReal.estado === 'bajo';
  const sesgoEsContractivo = sesgoSugerido.includes('contractivo');
  const sesgoEsExpansivo = sesgoSugerido.includes('expansivo');

  if (sesgoEsContractivo && tasaExpansiva) {
    return 'La tasa real vigente está por debajo de la neutral, en sentido contrario al sesgo contractivo que sugiere el diagnóstico — el mecanismo de transmisión podría no estar operando con la fuerza necesaria.';
  }
  if (sesgoEsExpansivo && tasaContractiva) {
    return 'La tasa real vigente está por encima de la neutral, más restrictiva de lo que el diagnóstico sugeriría — hay espacio para relajar condiciones sin abandonar el ancla nominal.';
  }
  if (sesgoEsContractivo && tasaContractiva) {
    return 'La tasa real ya se encuentra en terreno contractivo, en línea con el diagnóstico — la pregunta relevante es de magnitud y persistencia, no de dirección.';
  }
  if (sesgoEsExpansivo && tasaExpansiva) {
    return 'La tasa real ya se encuentra en terreno expansivo, en línea con el diagnóstico.';
  }
  return 'La tasa real está cerca de su nivel neutral, sin sesgo claro desde la política monetaria vigente.';
}

// -----------------------------------------------------------------------------
// 5) Contexto de shock: por qué se llegó a este estado
// -----------------------------------------------------------------------------
const CONTEXTO_SHOCK = {
  domestico_demanda: 'El origen es un shock de demanda agregada doméstica (IS curve) — la respuesta convencional de tasas suele ser la más directa.',
  domestico_precios: 'El origen es un shock de precios domésticos (Phillips curve, costos) — la política monetaria enfrenta un trade-off más costoso entre estabilizar precios y sostener actividad.',
  domestico_politica_monetaria: 'El origen es un shock a la propia regla de Taylor — vale distinguir si la brecha resultante es una desviación deliberada de la regla o un desvío no deseado.',
  domestico_tipo_cambio: 'El origen es un shock al premio de riesgo / tipo de cambio (UIP) — afecta precios domésticos vía el pass-through cambiario antes que por exceso de demanda.',
  externo_demanda_externa: 'El origen es un shock de actividad externa (canal b3, AR(1) L_GDP_RW_GAP) — se transmite a la demanda doméstica por el canal comercial más que por precios.',
  externo_tasa_externa: 'El origen es un shock de tasa de interés externa (AR(1) RS_RW vía UIP) — se transmite al tipo de cambio y de ahí a precios domésticos; la respuesta óptima depende del régimen cambiario.',
  externo_precios_externos: 'El origen es un shock de precios externos (AR(1) D4L_CPI_RW vía L_CPI_RW) — se transmite principalmente vía tipo de cambio real e inflación importada.',
  externo_rw_combinado: 'El origen es un shock combinado de las tres series del bloque externo (RW) simultáneamente — la lectura individual de canales pierde relevancia frente al efecto conjunto.',
};

function contextoDeShock(shockType, shockMeta) {
  const grupo = shockMeta?.group === 'Externo' ? 'externo' : 'domestico';
  const clave = `${grupo}_${shockType}`;
  return CONTEXTO_SHOCK[clave] || `Shock de tipo "${shockType}" (${shockMeta?.label || shockMeta?.group || 'sin clasificar'}).`;
}

// -----------------------------------------------------------------------------
// 6) Función principal: arma el bloque de texto final
// -----------------------------------------------------------------------------
export function interpretarDiagnostico(snapshot) {
  const estado = construirEstado(snapshot);
  const clave = `${estado.outputGap.estado}|${estado.inflacion.estado}`;
  const diagnostico = MATRIZ_DIAGNOSTICO[clave];

  const consistencia = evaluarConsistencia(estado, diagnostico.sesgo);
  const contexto = contextoDeShock(estado.shockType, estado.shockMeta);

  // Severidad global = la peor (más roja) entre output gap e inflación,
  // igual criterio que usaría alguien leyendo las dos celdas del semáforo
  // real a la vez.
  const rank = { normal: 0, alerta: 1, critico: 2 };
  const etiqueta = { normal: 'Normal', alerta: 'Alerta', critico: 'Crítico' };
  const peorSeveridad = rank[estado.outputGap.severidad] >= rank[estado.inflacion.severidad]
    ? estado.outputGap.severidad
    : estado.inflacion.severidad;

  return {
    estado,                      // por si el componente quiere pintar colores directo
    severidad: peorSeveridad,    // 'normal' | 'alerta' | 'critico', igual escala que el semáforo real
    resumen: diagnostico.resumen,
    riesgo: diagnostico.riesgo,
    sesgoSugerido: diagnostico.sesgo,
    consistenciaTasaReal: consistencia,
    contextoShock: contexto,
    // texto compuesto, listo para renderizar en un párrafo
    textoCompleto:
      `[${etiqueta[peorSeveridad]}] ${diagnostico.resumen} (brecha de producto: ${estado.outputGap.gap.toFixed(2)} pp, ` +
      `brecha de inflación: ${estado.inflacion.gap.toFixed(2)} pp respecto a la meta de ${REFERENCIAS.inflacion}%). ` +
      `${diagnostico.riesgo} ${consistencia} ${contexto}`,
  };
}
