import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Legend,
} from "recharts";

// ---------------------------------------------------------------------------
// Calibración base (sección 3 y 4 del documento de especificación)
// ---------------------------------------------------------------------------
const CALIB = {
  b1: 0.8, b2: 0.3, b3: 0.5, b4: 0.7,
  a1: 0.7, a2: 0.2, a3: 0.7,
  g1: 0.7, g2: 0.5, g3: 0.5,
  e1: 0.4,
};
const RHO_DEFAULT = 0.8;

const SHOCK_OPTIONS = [
  { value: "demanda",            label: "Demanda doméstica",               eq: "IS curve (SHK_L_GDP_GAP)",                       group: "Doméstico" },
  { value: "precios",            label: "Precios domésticos",              eq: "Phillips curve (SHK_DLA_CPI)",                   group: "Doméstico" },
  { value: "politica_monetaria", label: "Política monetaria",              eq: "Taylor rule (SHK_RS)",                           group: "Doméstico" },
  { value: "tipo_cambio",        label: "Premio de riesgo / tipo de cambio", eq: "UIP (PREMIO_RIESGO)",                          group: "Doméstico" },
  { value: "demanda_externa",    label: "Demanda externa (canal b3)",      eq: "AR(1) L_GDP_RW_GAP → IS vía b3",                group: "Externo"   },
  { value: "tasa_externa",       label: "Tasa de interés externa",         eq: "AR(1) RS_RW → UIP (diferencial RS − RS_RW)",     group: "Externo"   },
  { value: "precios_externos",   label: "Precios externos (RW)",           eq: "AR(1) D4L_CPI_RW → L_Z vía L_CPI_RW",          group: "Externo"   },
  { value: "rw_combinado",       label: "RW combinado (3 series simultáneas)", eq: "AR(1) L_GDP_RW_GAP + RS_RW + D4L_CPI_RW",  group: "Externo"   },
];

// ---------------------------------------------------------------------------
// Solver: SISTEMA LINEAL DIRECTO (Gauss con pivoteo parcial)
//
// CORRECCIÓN CRÍTICA (reemplaza el Gauss-Seidel anterior): el point Gauss-
// Seidel divergía exponencialmente en TODOS los shocks. Como el modelo es
// enteramente lineal (4 ecuaciones de transición + identidades, sin términos
// no lineales en ninguna ecuación de la sección 3 ni 4 del documento), la
// solución correcta es construir el sistema apilado completo — 11 incógnitas
// × (horizon+1) períodos — y resolverlo de una sola vez con eliminación
// gaussiana con pivoteo parcial. No hay necesidad de iterar.
//
// Las 11 incógnitas por período (VARS) son:
//   L_GDP_GAP, DLA_CPI, D4L_CPI, RS, L_S  ← variables "jump" (4 ecuaciones de transición)
//   L_CPI, L_CPI_RW, RR, L_Z, MCI, RMC    ← identidades (sección 4)
//
// Ecuaciones del sistema por período t:
//   (a) L_CPI_t   = L_CPI_{t-1}   + DLA_CPI_t/4          (pseudo-nivel de precios doméstico)
//   (b) L_CPI_RW_t = L_CPI_RW_{t-1} + D4L_CPI_RW_t/4    (pseudo-nivel de precios externo, RHS exógeno)
//   (c) L_Z_t     = L_S_t - L_CPI_t + L_CPI_RW_t         (tipo de cambio real, identidad sección 4)
//   (d) RMC_t     = a3·L_GDP_GAP_t + (1-a3)·L_Z_t        (costo marginal real, identidad)
//   (e) DLA_CPI_t = a1·DLA_CPI_{t-1} + (1-a1)·DLA_CPI_{t+1} + a2·RMC_t   (Phillips, sección 3.2)
//   (f) D4L_CPI_t = L_CPI_t - L_CPI_{t-4}                (inflación interanual, transformación sección 5)
//   (g) RR_t      = RS_t - D4L_CPI_{t+1}                 (Fisher, identidad)
//   (h) MCI_t     = b4·RR_t - (1-b4)·L_Z_t               (MCI, identidad sección 4)
//   (i) L_GDP_GAP_t = b1·L_GDP_GAP_{t-1} - b2·MCI_t + b3·L_GDP_RW_GAP_t  (IS, sección 3.1)
//   (j) RS_t      = g1·RS_{t-1} + (1-g1)·[g2·D4L_CPI_t + g3·L_GDP_GAP_t] (Taylor, sección 3.3)
//   (k) L_S_t     = L_S_{t+1} - (RS_t - RS_RW_t)/4 + e1·PREMIO_t          (UIP, sección 3.4) ←
//
// La ecuación (k) es la UIP — Uncovered Interest Parity — especificada sobre
// L_S nominal, con el diferencial de tasas (RS_t - RS_RW_t)/4 como mecanismo
// de transmisión entre política monetaria doméstica, tasas externas y tipo de
// cambio nominal. Es el canal central de apertura de la economía: sin (k),
// el modelo es equivalente a un NK cerrado. Ver sección 1 y 3.4 del documento.
// ---------------------------------------------------------------------------
const VARS = ["L_GDP_GAP","DLA_CPI","D4L_CPI","RS","L_S","L_CPI","L_CPI_RW","RR","L_Z","MCI","RMC"];
const K = VARS.length;

function arForward(rho, shockArr) {
  const n = shockArr.length;
  const x = new Array(n).fill(0);
  for (let t = 0; t < n; t++) { x[t] = rho * (t === 0 ? 0 : x[t - 1]) + shockArr[t]; }
  return x;
}

function gaussSolve(A, b) {
  const n = A.length;
  for (let i = 0; i < n; i++) A[i].push(b[i]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) { const tmp = A[col]; A[col] = A[piv]; A[piv] = tmp; }
    const pivVal = A[col][col];
    if (Math.abs(pivVal) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / pivVal;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

function solveQPM({ shockType, shockSize, timingQuarter, horizon, rho = RHO_DEFAULT, calib = CALIB }) {
  const { b1, b2, b3, b4, a1, a2, a3, g1, g2, g3, e1 } = calib;
  const n = horizon + 1;
  const N = n * K;
  const A = Array.from({ length: N }, () => new Array(N).fill(0));
  const b = new Array(N).fill(0);
  const idx = (t, name) => t * K + VARS.indexOf(name);
  const set = (row, t, name, coef) => { A[row][idx(t, name)] += coef; };

  const SHK_GDP = new Array(n).fill(0), SHK_DLA = new Array(n).fill(0),
        SHK_RS  = new Array(n).fill(0), PREMIO   = new Array(n).fill(0),
        SHK_GDP_RW = new Array(n).fill(0), SHK_RS_RW = new Array(n).fill(0),
        SHK_CPI_RW = new Array(n).fill(0);
  const t0 = Math.min(timingQuarter, n - 1);
  if (shockType === "demanda")            SHK_GDP[t0]    = shockSize;
  if (shockType === "precios")            SHK_DLA[t0]    = shockSize;
  if (shockType === "politica_monetaria") SHK_RS[t0]     = shockSize;
  if (shockType === "tipo_cambio")        PREMIO[t0]     = shockSize;
  if (shockType === "demanda_externa")    SHK_GDP_RW[t0] = shockSize;
  if (shockType === "tasa_externa")       SHK_RS_RW[t0]  = shockSize;
  if (shockType === "precios_externos")   SHK_CPI_RW[t0] = shockSize;
  if (shockType === "rw_combinado") {
    SHK_GDP_RW[t0] = shockSize; SHK_RS_RW[t0] = shockSize; SHK_CPI_RW[t0] = shockSize;
  }

  const L_GDP_RW_GAP = arForward(rho, SHK_GDP_RW);
  const RS_RW        = arForward(rho, SHK_RS_RW);
  const D4L_CPI_RW   = arForward(rho, SHK_CPI_RW);

  for (let t = 0; t < n; t++) {
    // (a) L_CPI
    let row = idx(t, "L_CPI");
    set(row, t, "L_CPI", 1); if (t > 0) set(row, t - 1, "L_CPI", -1);
    set(row, t, "DLA_CPI", -0.25); b[row] = 0;
    // (b) L_CPI_RW
    row = idx(t, "L_CPI_RW");
    set(row, t, "L_CPI_RW", 1); if (t > 0) set(row, t - 1, "L_CPI_RW", -1);
    b[row] = D4L_CPI_RW[t] / 4;
    // (c) L_Z
    row = idx(t, "L_Z");
    set(row, t, "L_Z", 1); set(row, t, "L_S", -1); set(row, t, "L_CPI", 1); set(row, t, "L_CPI_RW", -1);
    b[row] = 0;
    // (d) RMC
    row = idx(t, "RMC");
    set(row, t, "RMC", 1); set(row, t, "L_GDP_GAP", -a3); set(row, t, "L_Z", -(1 - a3));
    b[row] = 0;
    // (e) Phillips
    row = idx(t, "DLA_CPI");
    set(row, t, "DLA_CPI", 1);
    if (t > 0)     set(row, t - 1, "DLA_CPI", -a1);
    if (t < n - 1) set(row, t + 1, "DLA_CPI", -(1 - a1));
    set(row, t, "RMC", -a2); b[row] = SHK_DLA[t];
    // (f) D4L_CPI
    row = idx(t, "D4L_CPI");
    set(row, t, "D4L_CPI", 1); set(row, t, "L_CPI", -1);
    if (t >= 4) set(row, t - 4, "L_CPI", 1); b[row] = 0;
    // (g) RR (Fisher)
    row = idx(t, "RR");
    set(row, t, "RR", 1); set(row, t, "RS", -1);
    if (t < n - 1) set(row, t + 1, "D4L_CPI", 1); b[row] = 0;
    // (h) MCI
    row = idx(t, "MCI");
    set(row, t, "MCI", 1); set(row, t, "RR", -b4); set(row, t, "L_Z", (1 - b4)); b[row] = 0;
    // (i) IS
    row = idx(t, "L_GDP_GAP");
    set(row, t, "L_GDP_GAP", 1); if (t > 0) set(row, t - 1, "L_GDP_GAP", -b1);
    set(row, t, "MCI", b2); b[row] = SHK_GDP[t] + b3 * L_GDP_RW_GAP[t];
    // (j) Taylor
    row = idx(t, "RS");
    set(row, t, "RS", 1); if (t > 0) set(row, t - 1, "RS", -g1);
    set(row, t, "D4L_CPI", -(1 - g1) * g2); set(row, t, "L_GDP_GAP", -(1 - g1) * g3);
    b[row] = SHK_RS[t];
    // (k) UIP — L_S_t = L_S_{t+1} - (RS_t - RS_RW_t)/4 + e1·PREMIO_t
    row = idx(t, "L_S");
    set(row, t, "L_S", 1); if (t < n - 1) set(row, t + 1, "L_S", -1);
    set(row, t, "RS", 0.25);
    b[row] = e1 * PREMIO[t] + RS_RW[t] / 4;
  }

  const sol = gaussSolve(A, b);
  const data = [];
  for (let t = 0; t < n; t++) {
    const row = { t };
    VARS.forEach((v) => { row[v] = sol[idx(t, v)]; });
    row.L_GDP_RW_GAP = L_GDP_RW_GAP[t];
    row.RS_RW        = RS_RW[t];
    row.D4L_CPI_RW   = D4L_CPI_RW[t];
    row.DIFF_RS      = row.RS - row.RS_RW; // diferencial de tasas (canal UIP)
    data.push(row);
  }
  return { data, iterations: 1, converged: true, maxDiff: 0 };
}

// ---------------------------------------------------------------------------
// Validación estadística del acoplamiento (sección 1 del documento)
// ---------------------------------------------------------------------------
function erf(x) {
  const sign = x < 0 ? -1 : 1, ax = Math.abs(x);
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const t = 1 / (1 + p * ax);
  return sign * (1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-ax*ax));
}
function normCdf(x) { return 0.5 * (1 + erf(x / Math.sqrt(2))); }

function validateCoupling(data) {
  const eps = 1e-4;
  const maxAbsLS  = Math.max(...data.map((d) => Math.abs(d.L_S)));
  const maxAbsMCI = Math.max(...data.map((d) => Math.abs(d.MCI)));
  const maxAbsRW  = Math.max(...data.map((d) => Math.abs(d.L_GDP_RW_GAP)));
  const lsResponds = maxAbsLS > eps, mciResponds = maxAbsMCI > eps;
  let num=0, denA=0, denB=0;
  const n = data.length - 1;
  for (let t=0; t<n; t++) {
    const mci=data[t].MCI, gdpNext=data[t+1].L_GDP_GAP;
    num += mci*gdpNext; denA += mci*mci; denB += gdpNext*gdpNext;
  }
  const r = (denA>0 && denB>0) ? num/Math.sqrt(denA*denB) : 0;
  let pValue = 1;
  if (n > 3 && Math.abs(r) < 1) { const z = Math.atanh(r)*Math.sqrt(n-3); pValue = 2*(1-normCdf(Math.abs(z))); }
  const significant = pValue < 0.05, correctSign = r < -0.02, r2 = r*r;
  return { pass: lsResponds && mciResponds && significant && correctSign,
           lsResponds, mciResponds, maxAbsLS, maxAbsMCI, maxAbsRW, r, pValue, significant, correctSign, r2, n };
}

function round(v, d=3) { const f=Math.pow(10,d); return Math.round((v+Number.EPSILON)*f)/f; }
function fmtP(p) { return p < 0.0001 ? "< 0.0001" : round(p, 4); }
function sgn(v) { return v >= 0 ? "+" : ""; }

const SERIES_IRF = [
  { key: "L_GDP_GAP", label: "Brecha de producto",          color: "#378ADD" },
  { key: "MCI",       label: "MCI (condiciones monetarias)", color: "#D85A30" },
  { key: "RS",        label: "Tasa de política (RS)",        color: "#7F77DD" },
  { key: "DLA_CPI",  label: "Inflación trimestral",         color: "#D4537E" },
  { key: "D4L_CPI",  label: "Inflación interanual",         color: "#BA7517" },
  { key: "RR",        label: "Tasa real (Fisher)",           color: "#888780" },
  { key: "L_GDP_RW_GAP", label: "Brecha de producto RW",   color: "#0C447C" },
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
            <Tooltip formatter={(v) => round(v, 4)} labelFormatter={(t) => `t = ${t}`}
              contentStyle={{ fontSize: 12, background: "var(--surface-2)", border: "0.5px solid var(--border)" }} />
            <Line type="monotone" dataKey={seriesKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Panel dedicado UIP: RS, RS_RW, diferencial, L_S y L_Z en una sola vista
function UIPPanel({ data, label }) {
  const d0 = data[0] || {};
  const d1 = data.length > 1 ? data[1] : {};
  const uipLhs  = round(d0.L_S ?? 0, 4);
  const uipLead = round(d1.L_S ?? 0, 4);
  const uipDiff = round(((d0.RS ?? 0) - (d0.RS_RW ?? 0)) / 4, 4);
  const uipPrem = round(0, 4); // PREMIO ya está capturado en el shock tipo_cambio
  const uipRhs  = round(uipLead - uipDiff + uipPrem, 4);

  return (
    <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius)", padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
      <p style={{ fontWeight: 600, margin: "0 0 4px", fontSize: 15 }}>Canal UIP — Uncovered Interest Parity</p>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 10px" }}>
        Ecuación (k) del sistema · sección 3.4 del documento
      </p>

      {/* Ecuación formal */}
      <div style={{ background: "var(--surface-2)", borderRadius: 6, padding: "10px 14px", marginBottom: 12,
                    fontFamily: "var(--font-mono)", fontSize: 13 }}>
        L_S_t = L_S_&#123;t+1&#125; − (RS_t − RS_RW_t) / 4 + e1 · PREMIO_t
      </div>

      {/* Ecuación instanciada en t=0 con los valores numéricos reales */}
      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
        Instancia en t = 0 (valores resueltos del shock "{label}"):
      </p>
      <div style={{ background: "var(--surface-2)", borderRadius: 6, padding: "10px 14px", marginBottom: 14,
                    fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-primary)" }}>
        L_S[0] = L_S[1] − (RS[0] − RS_RW[0]) / 4<br/>
        <span style={{ color: "#5b9bd5" }}>{uipLhs}</span>
        {" = "}
        <span style={{ color: "#5dcaa5" }}>{uipLead}</span>
        {" − ("}
        <span style={{ color: "#9a8ee0" }}>{round(d0.RS ?? 0, 4)}</span>
        {" − "}
        <span style={{ color: "#c1547e" }}>{round(d0.RS_RW ?? 0, 4)}</span>
        {") / 4 = "}
        <span style={{ color: "#5b9bd5" }}>{uipRhs}</span>
      </div>

      {/* Lectura de política */}
      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        Canal de transmisión: RS_t ↑ → diferencial (RS − RS_RW) ↑ → L_S_t ↓ (apreciación) → L_Z_t ↓ → MCI_t ↑ (restrictivo)
      </p>

      {/* Gráfico triple: RS, RS_RW, diferencial y L_S, L_Z */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 4px" }}>
            Tasas nominales y diferencial (RS − RS_RW)
          </p>
          <div style={{ width: "100%", height: 160 }}>
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={40} />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Tooltip formatter={(v) => round(v, 4)} labelFormatter={(t) => `t = ${t}`}
                  contentStyle={{ fontSize: 11, background: "var(--surface-2)", border: "0.5px solid var(--border)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="RS"      name="RS (política)"  stroke="#9a8ee0" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="RS_RW"   name="RS_RW (externo)" stroke="#c1547e" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="DIFF_RS" name="RS − RS_RW"     stroke="#e0c050" strokeWidth={2} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 4px" }}>
            Tipos de cambio nominal (L_S) y real (L_Z)
          </p>
          <div style={{ width: "100%", height: 160 }}>
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={40} />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Tooltip formatter={(v) => round(v, 4)} labelFormatter={(t) => `t = ${t}`}
                  contentStyle={{ fontSize: 11, background: "var(--surface-2)", border: "0.5px solid var(--border)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="L_S" name="L_S (nominal)" stroke="#5dcaa5" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="L_Z" name="L_Z (real)"    stroke="#8fc24a" strokeWidth={2} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function QPMDiagnostico() {
  const [shockType, setShockType] = useState("tasa_externa");
  const [shockSize, setShockSize] = useState(1.0);
  const [horizon, setHorizon]     = useState(40);
  const [windowSize, setWindowSize] = useState(20);
  const [rho, setRho]             = useState(RHO_DEFAULT);

  const result     = useMemo(() => solveQPM({ shockType, shockSize, timingQuarter: 0, horizon, rho }), [shockType, shockSize, horizon, rho]);
  const validation = useMemo(() => validateCoupling(result.data), [result.data]);
  const windowed   = result.data.slice(0, Math.min(windowSize, result.data.length));
  const chainRows  = result.data.slice(0, 9);
  const shockMeta  = SHOCK_OPTIONS.find((o) => o.value === shockType);
  const isExternal = shockMeta.group === "Externo";

  return (
    <div style={{ fontFamily: "var(--font-sans)" }}>
      <h2 style={{ marginTop: 0 }}>QPM — Diagnóstico de Política Monetaria</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: -8 }}>
        Modelo de economía pequeña y abierta (Berg-Karam-Laxton / FMI) · solver lineal directo ·
        bloque externo activo (AR(1)) · UIP sobre L_S nominal (ec. k)
      </p>

      {/* Controles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12, margin: "1.25rem 0" }}>
        <div>
          <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Tipo de shock</label>
          <select value={shockType} onChange={(e) => setShockType(e.target.value)} style={{ width: "100%" }}>
            <optgroup label="Doméstico">
              {SHOCK_OPTIONS.filter((o) => o.group === "Doméstico").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
            <optgroup label="Externo (bloque RW)">
              {SHOCK_OPTIONS.filter((o) => o.group === "Externo").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Magnitud: {round(shockSize, 1)}</label>
          <input type="range" min="-3" max="3" step="0.1" value={shockSize} onChange={(e) => setShockSize(parseFloat(e.target.value))} style={{ width: "100%" }} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>ρ externo: {round(rho, 2)}</label>
          <input type="range" min="0" max="0.95" step="0.05" value={rho} onChange={(e) => setRho(parseFloat(e.target.value))} style={{ width: "100%" }} disabled={!isExternal} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Horizonte: {horizon} trim.</label>
          <input type="range" min="20" max="60" step="4" value={horizon} onChange={(e) => setHorizon(parseInt(e.target.value))} style={{ width: "100%" }} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Ventana gráficos: {windowSize} trim.</label>
          <input type="range" min="8" max={horizon} step="4" value={windowSize} onChange={(e) => setWindowSize(parseInt(e.target.value))} style={{ width: "100%" }} />
        </div>
      </div>

      {/* Panel UIP — siempre visible, instanciado en t=0 */}
      <UIPPanel data={windowed} label={shockMeta.label} />

      {/* Panel de estado del acoplamiento */}
      <div style={{ background: validation.pass ? "var(--bg-success)" : "var(--bg-danger)",
                    borderRadius: "var(--radius)", padding: "1rem 1.25rem", marginBottom: "0.75rem" }}>
        <p style={{ margin: "0 0 4px", fontWeight: 500, color: validation.pass ? "var(--text-success)" : "var(--text-danger)" }}>
          {validation.pass ? "Cadena de transmisión activa y estadísticamente robusta" : "Cadena de transmisión no se observa (o no es estadísticamente robusta)"}
        </p>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          Shock: <strong>{shockMeta.label}</strong> ({shockMeta.eq})
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
          <span>R² (IRF, no FEVD) = {round(validation.r2, 3)}</span>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "1.25rem" }}>
        R² = varianza compartida sobre un único IRF determinístico (no un FEVD estructural). p-valor: Fisher z, aproximación normal asintótica.
      </p>

      {/* Tabla cadena de transmisión */}
      <h3 style={{ fontSize: 15, fontWeight: 600 }}>Cadena de transmisión — primeros 8 trimestres</h3>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginBottom: "1.5rem" }}>
        <thead>
          <tr style={{ borderBottom: "0.5px solid var(--border-strong)" }}>
            <th style={{ textAlign: "left",  padding: "6px 4px", color: "var(--text-secondary)" }}>t</th>
            {isExternal && <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--text-secondary)" }}>L_GDP_RW_GAP</th>}
            <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--text-secondary)" }}>L_GDP_GAP</th>
            <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--text-secondary)" }}>RS − RS_RW</th>
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
              <td style={{ textAlign: "right", padding: "6px 4px", fontFamily: "var(--font-mono)" }}>{round(row.DIFF_RS, 4)}</td>
              <td style={{ textAlign: "right", padding: "6px 4px", fontFamily: "var(--font-mono)" }}>{round(row.L_S, 4)}</td>
              <td style={{ textAlign: "right", padding: "6px 4px", fontFamily: "var(--font-mono)" }}>{round(row.MCI, 4)}</td>
              <td style={{ textAlign: "right", padding: "6px 4px", fontFamily: "var(--font-mono)" }}>
                {i + 1 < result.data.length ? round(result.data[i + 1].L_GDP_GAP, 4) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* IRFs */}
      <h3 style={{ fontSize: 15, fontWeight: 600 }}>IRFs — respuestas al impulso</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {SERIES_IRF
          .filter((s) => isExternal || (s.key !== "L_GDP_RW_GAP"))
          .map((s) => <MiniChart key={s.key} data={windowed} seriesKey={s.key} label={s.label} color={s.color} />)}
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: "1.5rem" }}>
        Calibración: b=({CALIB.b1},{CALIB.b2},{CALIB.b3},{CALIB.b4}) · a=({CALIB.a1},{CALIB.a2},{CALIB.a3}) ·
        g=({CALIB.g1},{CALIB.g2},{CALIB.g3}) · e1={CALIB.e1} · ρ externo={round(rho,2)}.
        Las 3 AR(1) del bloque externo comparten ρ en datos sintéticos; en datos reales se estiman por separado (sección 4).
      </p>
    </div>
  );
}
