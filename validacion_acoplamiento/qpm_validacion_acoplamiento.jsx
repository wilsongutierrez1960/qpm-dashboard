import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";

// ---------------------------------------------------------------------------
// Calibración base (sección 3 y 4 del documento de especificación)
// ---------------------------------------------------------------------------
const CALIB = {
  b1: 0.8, b2: 0.3, b3: 0.5, b4: 0.7, // IS + MCI
  a1: 0.7, a2: 0.2, a3: 0.7,          // Phillips + RMC
  g1: 0.7, g2: 0.5, g3: 0.5,          // Taylor
  e1: 0.4,                            // UIP (premio de riesgo)
};

const RHO_DEFAULT = 0.8; // persistencia sugerida (sección 4) para los 3 AR(1) del bloque externo

const SHOCK_OPTIONS = [
  { value: "demanda", label: "Demanda doméstica", eq: "IS curve (SHK_L_GDP_GAP)", group: "Doméstico" },
  { value: "precios", label: "Precios domésticos", eq: "Phillips curve (SHK_DLA_CPI)", group: "Doméstico" },
  { value: "politica_monetaria", label: "Política monetaria", eq: "Taylor rule (SHK_RS)", group: "Doméstico" },
  { value: "tipo_cambio", label: "Premio de riesgo / tipo de cambio", eq: "UIP (PREMIO_RIESGO)", group: "Doméstico" },
  { value: "demanda_externa", label: "Demanda externa (canal b3)", eq: "AR(1) L_GDP_RW_GAP → IS vía b3", group: "Externo" },
  { value: "tasa_externa", label: "Tasa de interés externa", eq: "AR(1) RS_RW → UIP (diferencial)", group: "Externo" },
  { value: "precios_externos", label: "Precios externos (RW)", eq: "AR(1) D4L_CPI_RW → L_Z vía L_CPI_RW", group: "Externo" },
  { value: "rw_combinado", label: "RW combinado (3 series simultáneas)", eq: "AR(1) en L_GDP_RW_GAP + RS_RW + D4L_CPI_RW a la vez", group: "Externo" },
];

// ---------------------------------------------------------------------------
// Solver stacked-time (Fair-Taylor / Gauss-Seidel)
//
// Decisiones de implementación documentadas explícitamente (no silenciosas):
// - L_CPI y L_CPI_RW son variables auxiliares acumuladas, no listadas en el
//   documento como variables de estado propias, pero necesarias para
//   construir la identidad L_Z_t = L_S_t - L_CPI_t + L_CPI_RW_t (sección 4).
//   Se integran DLA_CPI_t/4 y D4L_CPI_RW_t/4 respectivamente, con
//   L_CPI=0, L_CPI_RW=0 en el período inicial (estado estacionario). Es el
//   atajo estándar de "pseudo-niveles" cuando no se modelan niveles de
//   precios explícitos como estado; la alternativa rigurosa (P_t, P_RW_t
//   como estados propios) infla el vector de estados sin ganancia para
//   este test.
// - D4L_CPI_t se calcula como L_CPI_t - L_CPI_{t-4} (tabla de transformación,
//   sección 5), usando 0 para t<4 (pre-muestra en estado estacionario).
// - Bloque externo ahora ACTIVO: L_GDP_RW_GAP, RS_RW, D4L_CPI_RW siguen
//   AR(1) con persistencia ρ (sección 4), alimentados por el shock externo
//   seleccionado. Si no se elige un shock externo, quedan en su trayectoria
//   AR(1) homogénea (decaen desde 0 = se mantienen en 0, sin sorpresas).
// - RR_t = RS_t - D4L_CPI_{t+1} usa el valor de la iteración anterior para
//   el liderazgo (lead), estándar en Gauss-Seidel sobre sistemas
//   forward-looking; converge porque todos los coeficientes de
//   retroalimentación son < 1.
// ---------------------------------------------------------------------------
function arForward(rho, shockArr) {
  const n = shockArr.length;
  const x = new Array(n).fill(0);
  for (let t = 0; t < n; t++) {
    const lag = t === 0 ? 0 : x[t - 1];
    x[t] = rho * lag + shockArr[t];
  }
  return x;
}

function solveQPM({ shockType, shockSize, timingQuarter, horizon, rho = RHO_DEFAULT, calib = CALIB, tol = 1e-7, maxIter = 1000 }) {
  const { b1, b2, b3, b4, a1, a2, a3, g1, g2, g3, e1 } = calib;
  const n = horizon + 1;

  const SHK_GDP = new Array(n).fill(0);
  const SHK_DLA = new Array(n).fill(0);
  const SHK_RS = new Array(n).fill(0);
  const PREMIO = new Array(n).fill(0);
  const SHK_GDP_RW = new Array(n).fill(0);
  const SHK_RS_RW = new Array(n).fill(0);
  const SHK_CPI_RW = new Array(n).fill(0);

  const t0 = Math.min(timingQuarter, n - 1);
  if (shockType === "demanda") SHK_GDP[t0] = shockSize;
  if (shockType === "precios") SHK_DLA[t0] = shockSize;
  if (shockType === "politica_monetaria") SHK_RS[t0] = shockSize;
  if (shockType === "tipo_cambio") PREMIO[t0] = shockSize;
  if (shockType === "demanda_externa") SHK_GDP_RW[t0] = shockSize;
  if (shockType === "tasa_externa") SHK_RS_RW[t0] = shockSize;
  if (shockType === "precios_externos") SHK_CPI_RW[t0] = shockSize;
  if (shockType === "rw_combinado") {
    // Shock conjunto: mismo tamaño en las 3 series RW al mismo tiempo —
    // aproximación a un evento macro externo amplio (p. ej. un shock de
    // ciclo en EE.UU. que mueve PIB, tasa de política y precios a la vez),
    // más realista que aislar una sola serie RW cuando el objetivo es
    // comparar contra datos FRED reales (sección 5).
    SHK_GDP_RW[t0] = shockSize;
    SHK_RS_RW[t0] = shockSize;
    SHK_CPI_RW[t0] = shockSize;
  }

  // Bloque externo activo: AR(1) exógeno, calculado una sola vez (no hay
  // retroalimentación doméstica hacia estas tres variables en esta
  // especificación, son puramente exógenas).
  const L_GDP_RW_GAP = arForward(rho, SHK_GDP_RW);
  const RS_RW = arForward(rho, SHK_RS_RW);
  const D4L_CPI_RW = arForward(rho, SHK_CPI_RW);

  const L_GDP_GAP = new Array(n).fill(0);
  const DLA_CPI = new Array(n).fill(0);
  const D4L_CPI = new Array(n).fill(0);
  const RS = new Array(n).fill(0);
  const L_S = new Array(n).fill(0);
  const L_CPI = new Array(n).fill(0);
  const L_CPI_RW = new Array(n).fill(0);
  const RR = new Array(n).fill(0);
  const RR_GAP = new Array(n).fill(0);
  const L_Z = new Array(n).fill(0);
  const L_Z_GAP = new Array(n).fill(0);
  const MCI = new Array(n).fill(0);
  const RMC = new Array(n).fill(0);

  let iter = 0;
  let maxDiff = Infinity;

  while (maxDiff > tol && iter < maxIter) {
    maxDiff = 0;
    for (let t = 0; t < n; t++) {
      const lagGDP = t === 0 ? 0 : L_GDP_GAP[t - 1];
      const lagDLA = t === 0 ? 0 : DLA_CPI[t - 1];
      const leadDLA = t === n - 1 ? 0 : DLA_CPI[t + 1];
      const lagRS = t === 0 ? 0 : RS[t - 1];
      const leadLS = t === n - 1 ? 0 : L_S[t + 1];
      const lagLCPI = t === 0 ? 0 : L_CPI[t - 1];
      const lagLCPIRW = t === 0 ? 0 : L_CPI_RW[t - 1];
      const leadD4LCPI = t === n - 1 ? 0 : D4L_CPI[t + 1];

      const newLCPI = lagLCPI + DLA_CPI[t] / 4;
      const newLCPIRW = lagLCPIRW + D4L_CPI_RW[t] / 4;
      const LZ = L_S[t] - newLCPI + newLCPIRW;
      const LZGAP = LZ; // L_Z_BAR = 0
      const newRMC = a3 * L_GDP_GAP[t] + (1 - a3) * LZGAP;
      const newDLA = a1 * lagDLA + (1 - a1) * leadDLA + a2 * newRMC + SHK_DLA[t];

      const d4lCpiLag4 = t >= 4 ? L_CPI[t - 4] : 0;
      const newD4LCPI = newLCPI - d4lCpiLag4;

      const newRR = RS[t] - leadD4LCPI;
      const newRRGAP = newRR; // RR_BAR = 0
      const newMCI = b4 * newRRGAP + (1 - b4) * (-LZGAP);

      const newGDP = b1 * lagGDP - b2 * newMCI + b3 * L_GDP_RW_GAP[t] + SHK_GDP[t];

      const RSNEUTRAL = 0; // RR_BAR + D4L_CPI_TAR
      const newRS = g1 * lagRS + (1 - g1) * (RSNEUTRAL + g2 * (newD4LCPI - 0) + g3 * newGDP) + SHK_RS[t];
      const newLS = leadLS - (newRS - RS_RW[t]) / 4 + e1 * PREMIO[t];

      maxDiff = Math.max(
        maxDiff,
        Math.abs(newGDP - L_GDP_GAP[t]),
        Math.abs(newDLA - DLA_CPI[t]),
        Math.abs(newRS - RS[t]),
        Math.abs(newLS - L_S[t])
      );

      L_CPI[t] = newLCPI;
      L_CPI_RW[t] = newLCPIRW;
      L_Z[t] = LZ;
      L_Z_GAP[t] = LZGAP;
      RMC[t] = newRMC;
      DLA_CPI[t] = newDLA;
      D4L_CPI[t] = newD4LCPI;
      RR[t] = newRR;
      RR_GAP[t] = newRRGAP;
      MCI[t] = newMCI;
      L_GDP_GAP[t] = newGDP;
      RS[t] = newRS;
      L_S[t] = newLS;
    }
    iter++;
  }

  const data = [];
  for (let t = 0; t < n; t++) {
    data.push({
      t,
      L_GDP_GAP: L_GDP_GAP[t],
      DLA_CPI: DLA_CPI[t],
      D4L_CPI: D4L_CPI[t],
      RS: RS[t],
      L_S: L_S[t],
      L_Z: L_Z[t],
      MCI: MCI[t],
      RMC: RMC[t],
      RR: RR[t],
      L_GDP_RW_GAP: L_GDP_RW_GAP[t],
      RS_RW: RS_RW[t],
      D4L_CPI_RW: D4L_CPI_RW[t],
    });
  }

  return { data, iterations: iter, converged: maxDiff <= tol, maxDiff };
}

// ---------------------------------------------------------------------------
// Estadística para el criterio de acoplamiento (sección 1)
//
// Se reemplazó el umbral fijo de correlación por:
// - Test de significancia: transformación de Fisher sobre r, z = atanh(r)*
//   sqrt(n-3), p-valor bilateral con la CDF normal (aproximación de
//   Abramowitz-Stegun para erf). Válido como aproximación asintótica;
//   con n≈20-60 es razonable pero no exacto (no es un t-test con grados
//   de libertad pequeños corregidos).
// - Chequeo de signo estructural: el canal -b2·MCI_t en la IS implica que
//   un MCI más restrictivo hoy debe ir asociado a un L_GDP_GAP menor el
//   período siguiente, independientemente de qué shock lo originó. Por
//   tanto el signo esperado de corr(MCI_t, L_GDP_GAP_{t+1}) es NEGATIVO
//   en todos los tipos de shock de esta especificación.
// - R² (= r²) como proxy de "varianza explicada", NO un FEVD verdadero:
//   un FEVD de Cholesky/estructural requiere la covarianza completa de
//   shocks estocásticos, no un único IRF determinístico. Se etiqueta
//   explícitamente como aproximación a lo largo de la trayectoria del
//   impulso, no como descomposición de varianza del modelo estimado.
// ---------------------------------------------------------------------------
function erf(x) {
  // Abramowitz-Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
    a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function validateCoupling(data) {
  const eps = 1e-4;
  const maxAbsLS = Math.max(...data.map((d) => Math.abs(d.L_S)));
  const maxAbsMCI = Math.max(...data.map((d) => Math.abs(d.MCI)));
  const maxAbsRW = Math.max(...data.map((d) => Math.abs(d.L_GDP_RW_GAP)));

  const lsResponds = maxAbsLS > eps;
  const mciResponds = maxAbsMCI > eps;

  let num = 0, denA = 0, denB = 0;
  const n = data.length - 1;
  for (let t = 0; t < n; t++) {
    const mci = data[t].MCI;
    const gdpNext = data[t + 1].L_GDP_GAP;
    num += mci * gdpNext;
    denA += mci * mci;
    denB += gdpNext * gdpNext;
  }
  const r = denA > 0 && denB > 0 ? num / Math.sqrt(denA * denB) : 0;

  let pValue = 1;
  if (n > 3 && Math.abs(r) < 1) {
    const z = Math.atanh(r) * Math.sqrt(n - 3);
    pValue = 2 * (1 - normCdf(Math.abs(z)));
  }
  const significant = pValue < 0.05;
  const correctSign = r < -0.02; // signo estructural esperado: negativo
  const r2 = r * r;

  const pass = lsResponds && mciResponds && significant && correctSign;
  return { pass, lsResponds, mciResponds, maxAbsLS, maxAbsMCI, maxAbsRW, r, pValue, significant, correctSign, r2, n };
}

function round(v, d = 3) {
  const f = Math.pow(10, d);
  return Math.round((v + Number.EPSILON) * f) / f;
}
function fmtP(p) {
  if (p < 0.0001) return "< 0.0001";
  return round(p, 4);
}

const SERIES = [
  { key: "L_GDP_GAP", label: "Brecha de producto", color: "#378ADD" },
  { key: "L_S", label: "Tipo de cambio nominal", color: "#1D9E75" },
  { key: "MCI", label: "MCI (condiciones monetarias)", color: "#D85A30" },
  { key: "RS", label: "Tasa de política", color: "#7F77DD" },
  { key: "DLA_CPI", label: "Inflación trimestral anualizada", color: "#D4537E" },
  { key: "D4L_CPI", label: "Inflación interanual", color: "#BA7517" },
  { key: "RR", label: "Tasa real (Fisher)", color: "#888780" },
  { key: "L_Z", label: "Tipo de cambio real", color: "#639922" },
  { key: "L_GDP_RW_GAP", label: "Brecha de producto RW (externo)", color: "#0C447C" },
  { key: "RS_RW", label: "Tasa de interés RW (externo)", color: "#993556" },
];

function MiniChart({ data, seriesKey, label, color }) {
  return (
    <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius)", padding: "0.75rem" }}>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 4px" }}>{label}</p>
      <div style={{ width: "100%", height: 140 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 2" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={40} />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <Tooltip
              formatter={(v) => round(v, 4)}
              labelFormatter={(t) => `t = ${t}`}
              contentStyle={{ fontSize: 12, background: "var(--surface-2)", border: "0.5px solid var(--border)" }}
            />
            <Line type="monotone" dataKey={seriesKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function QPMCouplingValidator() {
  const [shockType, setShockType] = useState("demanda_externa");
  const [shockSize, setShockSize] = useState(1.0);
  const [horizon, setHorizon] = useState(40);
  const [windowSize, setWindowSize] = useState(16);
  const [rho, setRho] = useState(RHO_DEFAULT);

  const result = useMemo(
    () => solveQPM({ shockType, shockSize, timingQuarter: 0, horizon, rho }),
    [shockType, shockSize, horizon, rho]
  );
  const validation = useMemo(() => validateCoupling(result.data), [result.data]);
  const windowed = result.data.slice(0, Math.min(windowSize, result.data.length));
  const chainRows = result.data.slice(0, 9);

  const shockMeta = SHOCK_OPTIONS.find((o) => o.value === shockType);
  const isExternal = shockMeta.group === "Externo";

  return (
    <div style={{ fontFamily: "var(--font-sans)" }}>
      <h2 style={{ marginTop: 0 }}>Validación de acoplamiento QPM</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: -8 }}>
        Stacked-time / Gauss-Seidel · bloque externo activo (AR(1), canal b3) · UIP sobre L_S nominal
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, margin: "1.25rem 0" }}>
        <div>
          <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Tipo de shock</label>
          <select value={shockType} onChange={(e) => setShockType(e.target.value)} style={{ width: "100%" }}>
            <optgroup label="Doméstico">
              {SHOCK_OPTIONS.filter((o) => o.group === "Doméstico").map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
            <optgroup label="Externo (bloque RW)">
              {SHOCK_OPTIONS.filter((o) => o.group === "Externo").map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
            Magnitud del shock: {round(shockSize, 1)}
          </label>
          <input type="range" min="-3" max="3" step="0.1" value={shockSize}
            onChange={(e) => setShockSize(parseFloat(e.target.value))} style={{ width: "100%" }} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
            ρ persistencia externa: {round(rho, 2)}
          </label>
          <input type="range" min="0" max="0.95" step="0.05" value={rho}
            onChange={(e) => setRho(parseFloat(e.target.value))} style={{ width: "100%" }}
            disabled={!isExternal} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
            Horizonte: {horizon} trim.
          </label>
          <input type="range" min="20" max="60" step="4" value={horizon}
            onChange={(e) => setHorizon(parseInt(e.target.value))} style={{ width: "100%" }} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
            Ventana de gráficos: {windowSize} trim.
          </label>
          <input type="range" min="8" max={horizon} step="4" value={windowSize}
            onChange={(e) => setWindowSize(parseInt(e.target.value))} style={{ width: "100%" }} />
        </div>
      </div>

      <div style={{
        background: validation.pass ? "var(--bg-success)" : "var(--bg-danger)",
        borderRadius: "var(--radius)", padding: "1rem 1.25rem", marginBottom: "1.25rem",
      }}>
        <p style={{ margin: "0 0 6px", fontWeight: 500, color: validation.pass ? "var(--text-success)" : "var(--text-danger)" }}>
          {validation.pass ? "Acoplamiento validado" : "Acoplamiento no se observa (o no es estadísticamente robusto)"}
        </p>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          Shock: {shockMeta.label} ({shockMeta.eq}) · convergencia en {result.iterations} iteraciones, max|Δ| = {result.maxDiff.toExponential(2)}
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 13, flexWrap: "wrap" }}>
          <span>max|L_S| = {round(validation.maxAbsLS, 4)} {validation.lsResponds ? "✓" : "✗"}</span>
          <span>max|MCI| = {round(validation.maxAbsMCI, 4)} {validation.mciResponds ? "✓" : "✗"}</span>
          {isExternal && <span>max|L_GDP_RW_GAP| = {round(validation.maxAbsRW, 4)}</span>}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 13, flexWrap: "wrap" }}>
          <span>r = corr(MCI_t, L_GDP_GAP_t+1) = {round(validation.r, 3)}</span>
          <span>signo esperado (−): {validation.correctSign ? "✓" : "✗"}</span>
          <span>p-valor (Fisher z, n={validation.n}) = {fmtP(validation.pValue)} {validation.significant ? "✓" : "✗"}</span>
          <span>R² (proxy, no FEVD) = {round(validation.r2, 3)}</span>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: "-0.5rem", marginBottom: "1.25rem" }}>
        Nota: el R² de arriba es la varianza compartida a lo largo de un único IRF determinístico, no un FEVD
        estructural (que requeriría la covarianza completa de shocks estocásticos del modelo estimado). El p-valor
        usa la transformación de Fisher con aproximación normal asintótica, razonable para n≈20–60 pero no exacta.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 500 }}>Cadena de transmisión, primeros 8 trimestres</h3>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginBottom: "1.5rem" }}>
        <thead>
          <tr style={{ borderBottom: "0.5px solid var(--border-strong)" }}>
            <th style={{ textAlign: "left", padding: "6px 4px", color: "var(--text-secondary)" }}>t</th>
            {isExternal && <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--text-secondary)" }}>L_GDP_RW_GAP</th>}
            <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--text-secondary)" }}>L_GDP_GAP</th>
            <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--text-secondary)" }}>L_S</th>
            <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--text-secondary)" }}>MCI</th>
            <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--text-secondary)" }}>L_GDP_GAP(t+1)</th>
          </tr>
        </thead>
        <tbody>
          {chainRows.map((row, i) => (
            <tr key={row.t} style={{ borderBottom: "0.5px solid var(--border)" }}>
              <td style={{ padding: "6px 4px" }}>{row.t}</td>
              {isExternal && <td style={{ textAlign: "right", padding: "6px 4px", fontFamily: "var(--font-mono)" }}>{round(row.L_GDP_RW_GAP, 4)}</td>}
              <td style={{ textAlign: "right", padding: "6px 4px", fontFamily: "var(--font-mono)" }}>{round(row.L_GDP_GAP, 4)}</td>
              <td style={{ textAlign: "right", padding: "6px 4px", fontFamily: "var(--font-mono)" }}>{round(row.L_S, 4)}</td>
              <td style={{ textAlign: "right", padding: "6px 4px", fontFamily: "var(--font-mono)" }}>{round(row.MCI, 4)}</td>
              <td style={{ textAlign: "right", padding: "6px 4px", fontFamily: "var(--font-mono)" }}>
                {i + 1 < result.data.length ? round(result.data[i + 1].L_GDP_GAP, 4) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ fontSize: 16, fontWeight: 500 }}>IRFs por variable</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {SERIES.filter((s) => isExternal || (s.key !== "L_GDP_RW_GAP" && s.key !== "RS_RW")).map((s) => (
          <MiniChart key={s.key} data={windowed} seriesKey={s.key} label={s.label} color={s.color} />
        ))}
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: "1.5rem" }}>
        Calibración: b=({CALIB.b1}, {CALIB.b2}, {CALIB.b3}, {CALIB.b4}) · a=({CALIB.a1}, {CALIB.a2}, {CALIB.a3}) ·
        g=({CALIB.g1}, {CALIB.g2}, {CALIB.g3}) · e1={CALIB.e1} · ρ externo = {round(rho, 2)} (las 3 AR(1) del bloque
        externo comparten ρ en este test; en datos reales sección 4 indica estimarlas por separado).
      </p>
    </div>
  );
}
