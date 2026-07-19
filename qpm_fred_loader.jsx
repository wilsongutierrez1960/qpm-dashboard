import { useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";

// ---------------------------------------------------------------------------
// FRED Data Loader + Transformación sección 5 del documento QPM
//
// Series externas:
//   GDPC1    — PIB real EE.UU. trimestral (miles de millones USD 2017)
//   FEDFUNDS — Federal Funds Rate efectivo (mensual → promedio trimestral)
//   CPIAUCSL — CPI EE.UU. todos los ítems (mensual → promedio trimestral)
//
// Transformaciones (sección 5):
//   L_X   = 100 × ln(X)
//   DLA_X = 4 × (L_X_t − L_X_{t-1})     trimestral anualizada
//   D4L_X = L_X_t − L_X_{t-4}            interanual
//   X_BAR = MA(L_X, 8)                   tendencia (8 trimestres)
//   X_GAP = L_X − X_BAR                  brecha
//
// El API key de FRED se ingresa en el campo de texto — nunca se almacena,
// solo vive en el estado React de esta sesión.
// ---------------------------------------------------------------------------

// Antes: "https://api.stlouisfed.org/fred/series/observations" (bloqueado por CORS en el navegador)
// Ahora: proxy local (servidor.py) que hace el fetch server-side.
// Requiere tener corriendo start.bat / start.sh antes de presionar "Cargar FRED".
const FRED_BASE = "http://localhost:5000/api/fred";

const SERIES_CONFIG = [
  {
    id: "GDPC1",
    label: "PIB real EE.UU. (GDPC1)",
    freq: "q",
    varName: "L_GDP_RW_GAP",
    color: "#378ADD",
    description: "Brecha de producto externo → entra en IS vía b3",
  },
  {
    id: "FEDFUNDS",
    label: "Federal Funds Rate (FEDFUNDS)",
    freq: "m→q",
    varName: "RS_RW",
    color: "#9a8ee0",
    description: "Tasa externa → entra en UIP vía diferencial RS−RS_RW",
  },
  {
    id: "CPIAUCSL",
    label: "CPI EE.UU. (CPIAUCSL)",
    freq: "m→q",
    varName: "D4L_CPI_RW",
    color: "#D4537E",
    description: "Inflación externa → entra en L_Z vía L_CPI_RW",
  },
];

// ---------------------------------------------------------------------------
// Fetch FRED
// ---------------------------------------------------------------------------
async function fetchFRED(seriesId, apiKey, startDate = "2000-01-01") {
  const url = `${FRED_BASE}/${seriesId}?api_key=${apiKey}&file_type=json` +
    `&observation_start=${startDate}&frequency=q&aggregation_method=avg`;
  const resp = await fetch(url);
  if (!resp.ok) {
    // El proxy devuelve {error: "..."} en vez de un HTML de error generico
    let detail = "";
    try { detail = (await resp.json()).error || ""; } catch (_) {}
    throw new Error(`FRED ${seriesId}: HTTP ${resp.status}${detail ? " — " + detail : ""}. ¿Está corriendo start.bat/start.sh?`);
  }
  const json = await resp.json();
  if (json.error_message) throw new Error(`FRED ${seriesId}: ${json.error_message}`);
  return json.observations
    .filter(o => o.value !== ".")
    .map(o => ({ date: o.date, value: parseFloat(o.value) }));
}

// ---------------------------------------------------------------------------
// Pipeline de transformación (sección 5)
// ---------------------------------------------------------------------------
function transformSeries(obs) {
  const n = obs.length;
  const dates  = obs.map(o => o.date);
  const values = obs.map(o => o.value);
  const L    = values.map(v => 100 * Math.log(v));
  const DLA  = L.map((v, i) => i === 0 ? null : 4 * (v - L[i-1]));
  const D4L  = L.map((v, i) => i < 4   ? null : v - L[i-4]);
  const BAR  = L.map((v, i) => {
    if (i < 7) return null;
    return L.slice(i-7, i+1).reduce((a, b) => a + b, 0) / 8;
  });
  const GAP  = L.map((v, i) => BAR[i] === null ? null : v - BAR[i]);
  return dates.map((date, i) => ({
    date, value: values[i], L: L[i],
    DLA: DLA[i], D4L: D4L[i], BAR: BAR[i], GAP: GAP[i],
  }));
}

// ---------------------------------------------------------------------------
// Empalme trimestral de las tres series (alinear por fecha)
// ---------------------------------------------------------------------------
function alignSeries(gdp, rate, cpi) {
  // Todas llegan como trimestres FRED (YYYY-MM-DD del inicio del trimestre)
  const gdpMap  = Object.fromEntries(gdp.map(r  => [r.date, r]));
  const rateMap = Object.fromEntries(rate.map(r => [r.date, r]));
  const cpiMap  = Object.fromEntries(cpi.map(r  => [r.date, r]));
  const dates   = gdp.map(r => r.date).filter(d => rateMap[d] && cpiMap[d]);
  return dates.map((d, i) => ({
    t: i,
    date: d,
    L_GDP_RW_GAP: gdpMap[d].GAP,
    RS_RW:        rateMap[d].D4L,   // usamos D4L para tasa (ya es tasa, no nivel)
    D4L_CPI_RW:   cpiMap[d].D4L,
    // niveles para referencia
    GDP_level:    gdpMap[d].value,
    FEDFUNDS_level: rateMap[d].value,
    CPI_level:    cpiMap[d].value,
  })).filter(r =>
    r.L_GDP_RW_GAP !== null && r.RS_RW !== null && r.D4L_CPI_RW !== null
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function round(v, d = 3) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  const f = Math.pow(10, d);
  return Math.round((v + Number.EPSILON) * f) / f;
}

function MiniLine({ data, series, height = 160 }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--text-muted)" }}
            axisLine={{ stroke: "var(--border)" }} tickLine={false}
            interval={Math.floor(data.length / 5)} />
          <YAxis tick={{ fontSize: 9, fill: "var(--text-muted)" }} axisLine={false}
            tickLine={false} width={38} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Tooltip formatter={v => round(v, 4)} labelFormatter={d => d}
            contentStyle={{ fontSize: 11, background: "var(--surface-2)", border: "0.5px solid var(--border)" }} />
          {series.map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name || s.key}
              stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false}
              strokeDasharray={s.dash} />
          ))}
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export default function FREDLoader() {
  const [apiKey,   setApiKey]   = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [rawData,  setRawData]  = useState(null);   // series transformadas individuales
  const [aligned,  setAligned]  = useState(null);   // serie alineada lista para solver
  const [startDate,setStartDate]= useState("2000-01-01");

  const loadData = useCallback(async () => {
    if (!apiKey.trim()) { setError("Ingresá tu API key de FRED (gratuita en fred.stlouisfed.org)"); return; }
    setLoading(true); setError(null); setRawData(null); setAligned(null);
    try {
      const [gdpObs, rateObs, cpiObs] = await Promise.all([
        fetchFRED("GDPC1",    apiKey, startDate),
        fetchFRED("FEDFUNDS", apiKey, startDate),
        fetchFRED("CPIAUCSL", apiKey, startDate),
      ]);
      const gdpT  = transformSeries(gdpObs);
      const rateT = transformSeries(rateObs);
      const cpiT  = transformSeries(cpiObs);
      const aln   = alignSeries(gdpT, rateT, cpiT);
      setRawData({ gdp: gdpT, rate: rateT, cpi: cpiT });
      setAligned(aln);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiKey, startDate]);

  const exportJSON = () => {
    if (!aligned) return;
    const blob = new Blob([JSON.stringify({
      metadata: {
        source: "FRED",
        series: ["GDPC1","FEDFUNDS","CPIAUCSL"],
        start_date: startDate,
        n_quarters: aligned.length,
        generated: new Date().toISOString(),
        specification_type: "calibrada",
        data_mode: "real_externo",
      },
      external_block: aligned,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `fred_bloque_externo_${startDate.slice(0,7)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const lastN = aligned ? aligned.slice(-8) : [];

  return (
    <div style={{ fontFamily: "var(--font-sans)" }}>
      <h2 style={{ marginTop: 0 }}>QPM — Carga de datos reales (bloque externo FRED)</h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: -8 }}>
        Paso 1 de validación con datos reales · series: GDPC1, FEDFUNDS, CPIAUCSL ·
        transformaciones sección 5 del documento QPM
      </p>

      {/* ── Controles de carga ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, margin: "1rem 0", alignItems: "end" }}>
        <div>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>
            API Key FRED (gratuita en fred.stlouisfed.org)
          </label>
          <input
            type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder="Tu API key de FRED..."
            style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, padding: "5px 8px", borderRadius: 4, border: "0.5px solid var(--border)", background: "var(--surface-2)", color: "var(--text-primary)" }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>Desde</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            style={{ fontSize: 12, padding: "5px 8px", borderRadius: 4, border: "0.5px solid var(--border)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
        </div>
        <button onClick={loadData} disabled={loading}
          style={{ padding: "6px 16px", fontSize: 13, borderRadius: 4, cursor: loading ? "wait" : "pointer",
            background: "var(--accent)", color: "#fff", border: "none", fontWeight: 600 }}>
          {loading ? "Cargando..." : "Cargar FRED"}
        </button>
      </div>

      {error && (
        <div style={{ background: "var(--bg-danger)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "var(--text-danger)" }}>
          {error}
        </div>
      )}

      {/* ── Descripción de las series ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: "1rem" }}>
        {SERIES_CONFIG.map(s => (
          <div key={s.id} style={{ background: "var(--surface-1)", borderRadius: "var(--radius)", padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, display: "inline-block" }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{s.id}</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>{s.label}</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>{s.description}</p>
            {aligned && (
              <p style={{ fontSize: 11, fontFamily: "var(--font-mono)", margin: "4px 0 0", color: "var(--text-primary)" }}>
                {aligned.length} trimestres · último: {aligned[aligned.length-1]?.date}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ── Gráficos de series brutas y transformadas ── */}
      {rawData && (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "1rem 0 0.5rem" }}>
            Series transformadas — brechas listas para el solver
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginBottom: "1rem" }}>
            <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius)", padding: "0.75rem" }}>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 4px" }}>
                L_GDP_RW_GAP — Brecha de producto EE.UU.
              </p>
              <MiniLine data={rawData.gdp.filter(r=>r.GAP!==null)}
                series={[{key:"GAP",name:"GAP",color:"#378ADD"},{key:"DLA",name:"DLA",color:"#378ADD",dash:"3 2"}]}/>
            </div>
            <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius)", padding: "0.75rem" }}>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 4px" }}>
                RS_RW — Tasa Fed (nivel y variación D4L)
              </p>
              <MiniLine data={rawData.rate.filter(r=>r.D4L!==null)}
                series={[{key:"value",name:"nivel",color:"#9a8ee0"},{key:"D4L",name:"D4L",color:"#c1547e",dash:"3 2"}]}/>
            </div>
            <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius)", padding: "0.75rem" }}>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 4px" }}>
                D4L_CPI_RW — Inflación interanual EE.UU.
              </p>
              <MiniLine data={rawData.cpi.filter(r=>r.D4L!==null)}
                series={[{key:"D4L",name:"D4L_CPI_RW",color:"#D4537E"}]}/>
            </div>
          </div>

          {/* ── Serie alineada ── */}
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "1rem 0 0.5rem" }}>
            Serie alineada — últimos 8 trimestres listos para el solver
          </h3>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginBottom: "1rem" }}>
            <thead>
              <tr style={{ borderBottom: "0.5px solid var(--border-strong)" }}>
                {["Trimestre","L_GDP_RW_GAP","RS_RW (D4L)","D4L_CPI_RW"].map(h => (
                  <th key={h} style={{ textAlign: h==="Trimestre"?"left":"right", padding: "5px 6px", color: "var(--text-secondary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lastN.map(r => (
                <tr key={r.date} style={{ borderBottom: "0.5px solid var(--border)" }}>
                  <td style={{ padding: "5px 6px", fontFamily: "var(--font-mono)" }}>{r.date}</td>
                  <td style={{ textAlign: "right", padding: "5px 6px", fontFamily: "var(--font-mono)" }}>{round(r.L_GDP_RW_GAP)}</td>
                  <td style={{ textAlign: "right", padding: "5px 6px", fontFamily: "var(--font-mono)" }}>{round(r.RS_RW)}</td>
                  <td style={{ textAlign: "right", padding: "5px 6px", fontFamily: "var(--font-mono)" }}>{round(r.D4L_CPI_RW)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── Estadísticas descriptivas ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: "1rem" }}>
            {[
              { label: "L_GDP_RW_GAP", key: "L_GDP_RW_GAP", color: "#378ADD" },
              { label: "RS_RW (D4L)",  key: "RS_RW",         color: "#9a8ee0" },
              { label: "D4L_CPI_RW",  key: "D4L_CPI_RW",    color: "#D4537E" },
            ].map(({ label, key, color }) => {
              const vals = aligned.map(r => r[key]).filter(v => v !== null && !isNaN(v));
              const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
              const std  = Math.sqrt(vals.map(v=>(v-mean)**2).reduce((a,b)=>a+b,0)/vals.length);
              const min  = Math.min(...vals), max = Math.max(...vals);
              return (
                <div key={key} style={{ background:"var(--surface-1)", borderRadius:"var(--radius)", padding:"10px 12px" }}>
                  <p style={{ fontSize:12, color:"var(--text-secondary)", margin:"0 0 6px" }}>
                    <span style={{ display:"inline-block",width:8,height:8,borderRadius:"50%",background:color,marginRight:5 }}/>
                    {label}
                  </p>
                  {[["Media",mean],["Std",std],["Mín",min],["Máx",max]].map(([l,v]) => (
                    <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:12 }}>
                      <span style={{ color:"var(--text-muted)" }}>{l}</span>
                      <span style={{ fontFamily:"var(--font-mono)" }}>{round(v)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* ── Exportar ── */}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={exportJSON}
              style={{ fontSize: 12, padding: "6px 14px", borderRadius: 4, cursor: "pointer",
                border: "0.5px solid var(--border)", background: "var(--surface-2)", color: "var(--text-primary)" }}>
              Exportar JSON (contrato sección 7)
            </button>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
            El JSON exportado sigue el contrato de la sección 7 del documento QPM con
            <code style={{ fontFamily:"var(--font-mono)" }}> data_mode: "real_externo"</code> —
            listo para alimentar el solver del diagnóstico de política monetaria.
          </p>
        </>
      )}

      {!aligned && !loading && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: "1rem" }}>
          Ingresá tu API key y presioná "Cargar FRED" para obtener las tres series del bloque externo.
          La key es gratuita en <strong>fred.stlouisfed.org/docs/api/api_key.html</strong>
        </p>
      )}
    </div>
  );
}
