"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

// paleta do dashboard (tema escuro, igual ao original)
const C = {
  bg: "#0F0F13", card: "#1E1E28", border: "#2A2A38", accent: "#7C5CFC", accent2: "#C084FC",
  green: "#34D399", red: "#F87171", yellow: "#FBBF24", text: "#E8E8F0", muted: "#8888A8",
};

type P = { bruto: number; dev: number; liq: number; clientes: number; itens: number; mix: number; preco: number | null; ticket: number | null };
type Linha = { slug: string; nome: string; novato: boolean; cor: string; meta: number; p: P[] };
type Dados = { atualizado: string; dias_movimento: number; periodos: { label: string }[]; mix_total: number; linhas: Linha[] };

const moeda = (n: number) => "R$ " + Math.round(n).toLocaleString("pt-BR");
const moeda2 = (n: number | null) => n == null ? "—" : "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moedaK = (n: number) => "R$ " + (n / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "k";
const inteiro = (n: number) => Math.round(n).toLocaleString("pt-BR");
const pct1 = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";

function delta(atual: number | null, ant: number | null) {
  if (atual == null || ant == null || ant === 0) return null;
  return ((atual - ant) / ant) * 100;
}
function DeltaCell({ d, novato }: { d: number | null; novato: boolean }) {
  if (novato) return <span style={{ color: C.muted }}>— estreia</span>;
  if (d == null) return <span style={{ color: C.muted }}>—</span>;
  const up = d >= 0;
  return <span style={{ color: up ? C.green : C.red }}>{up ? "▲" : "▼"} {up ? "+" : ""}{d.toFixed(1).replace(".", ",")}%</span>;
}

// spline cúbica estilo Chart.js (tension 0.3) — deixa a linha suave em vez de reta
function smoothPath(pts: { x: number; y: number }[], t = 0.3) {
  const n = pts.length;
  if (n < 2) return "";
  const cp = pts.map(() => ({ px: 0, py: 0, nx: 0, ny: 0, has: false }));
  for (let i = 1; i < n - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const d01 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const s = d01 + d12 || 1;
    const fa = (t * d01) / s, fb = (t * d12) / s;
    cp[i] = {
      px: p1.x - fa * (p2.x - p0.x), py: p1.y - fa * (p2.y - p0.y),
      nx: p1.x + fb * (p2.x - p0.x), ny: p1.y + fb * (p2.y - p0.y), has: true,
    };
  }
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const p1 = pts[i], p2 = pts[i + 1];
    const c1 = cp[i].has ? { x: cp[i].nx, y: cp[i].ny } : p1;
    const c2 = cp[i + 1].has ? { x: cp[i + 1].px, y: cp[i + 1].py } : p2;
    d += ` C ${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

// gráfico de linhas SVG — mesmo look do Chart.js do arquivo (linha suave, sem preenchimento,
// escala automática, grade em cruz, pontos e legenda em caixinha).
function LineChart({ series, labels, fmt }: { series: { nome: string; cor: string; pts: (number | null)[] }[]; labels: string[]; fmt: (n: number) => string }) {
  const W = 900, H = 270, padL = 66, padR = 18, padT = 18, padB = 40;
  const vals = series.flatMap((s) => s.pts.filter((v): v is number => v != null));
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const range = hi - lo || 1;
  const yMin = lo - range * 0.12, yMax = hi + range * 0.12; // escala auto (não força zero)
  const x = (i: number) => padL + (i * (W - padL - padR)) / (labels.length - 1);
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - yMin) / (yMax - yMin || 1));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => yMin + (yMax - yMin) * g);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 520, height: "auto", display: "block" }}>
        {/* grade horizontal + rótulos do eixo Y */}
        {grid.map((gv, i) => (
          <g key={"h" + i}>
            <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} stroke="rgba(255,255,255,0.045)" />
            <text x={padL - 10} y={y(gv) + 3.5} textAnchor="end" fontSize="10.5" fill={C.muted}>{fmt(gv)}</text>
          </g>
        ))}
        {/* grade vertical + rótulos do eixo X */}
        {labels.map((l, i) => (
          <g key={"v" + i}>
            <line x1={x(i)} x2={x(i)} y1={padT} y2={H - padB} stroke="rgba(255,255,255,0.045)" />
            <text x={x(i)} y={H - 14} textAnchor="middle" fontSize="11" fill={C.muted}>{l}</text>
          </g>
        ))}
        {/* linhas suaves + pontos */}
        {series.map((s) => {
          const real = s.pts.map((v, i) => (v == null ? null : { x: x(i), y: y(v) })).filter(Boolean) as { x: number; y: number }[];
          return (
            <g key={s.nome}>
              {real.length >= 2 && (
                <path d={smoothPath(real)} fill="none" stroke={s.cor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              )}
              {real.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4" fill={s.cor} />)}
            </g>
          );
        })}
      </svg>
      {/* legenda em caixinha colorida (estilo Chart.js) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", justifyContent: "center", marginTop: 10 }}>
        {series.map((s) => (
          <span key={s.nome} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: C.muted }}>
            <span style={{ width: 13, height: 9, background: s.cor, borderRadius: 2, flexShrink: 0 }} />{s.nome}
          </span>
        ))}
      </div>
    </div>
  );
}

const TABS: { id: string; ico: string; nome: string; soon?: boolean }[] = [
  { id: "fat", ico: "💰", nome: "Faturamento" },
  { id: "ticket", ico: "🎫", nome: "Ticket Médio" },
  { id: "clientes", ico: "👥", nome: "Clientes" },
  { id: "preco", ico: "💲", nome: "Preço Médio" },
  { id: "itens", ico: "📦", nome: "Itens" },
  { id: "mix", ico: "🧪", nome: "Mix" },
  { id: "evolucao", ico: "📈", nome: "Evolução" },
  { id: "opp", ico: "⚡", nome: "Oportunidades" },
  { id: "novatos", ico: "🔍", nome: "Perfil Novatos" },
];

export default function InsideSales() {
  const [role, setRole] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [dados, setDados] = useState<Dados | null>(null);
  const [narr, setNarr] = useState<Record<string, string[]> | null>(null);
  const [atualizado, setAtualizado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tab, setTab] = useState("fat");
  const [mes, setMes] = useState("atual"); // "atual" (snapshot ao vivo) ou "YYYY-MM" (mês encerrado)

  // mês atual + 3 anteriores (limite do espelho de 6 meses no banco)
  const opcoesMes = useMemo(() => {
    const nomes = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const agora = new Date();
    const ops = [{ value: "atual", label: "Mês atual (ao vivo)" }];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      ops.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: `${nomes[d.getMonth()]}/${d.getFullYear()} · fechado` });
    }
    return ops;
  }, []);
  const historico = mes !== "atual";

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setRole(j?.role)).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    setDados(null); setErro(null);
    const url = "/api/analises/inside-sales" + (mes === "atual" ? "" : `?mes=${mes}`);
    fetch(url, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!ok) setErro(j?.error ?? "erro"); else { setDados(j.dados); setNarr(j.narrativas ?? null); setAtualizado(j.atualizado_em); } })
      .catch((e) => setErro(String(e)));
  }, [mes]);

  const linhas = dados?.linhas ?? [];
  const periodos = dados?.periodos?.map((x) => x.label) ?? ["", "", "", ""];
  const mesAnt = (periodos[2] || "").split(" ")[0] || "ant.";

  const kpis = useMemo(() => {
    if (!linhas.length) return null;
    const totIS = linhas.reduce((a, l) => a + (l.p[3]?.liq ?? 0), 0);
    const metaTot = linhas.reduce((a, l) => a + l.meta, 0);
    const totDev = linhas.reduce((a, l) => a + (l.p[3]?.dev ?? 0), 0);
    const lider = [...linhas].sort((a, b) => (b.p[3]?.liq ?? 0) - (a.p[3]?.liq ?? 0))[0];
    return { totIS, metaTot, totDev, lider };
  }, [linhas]);

  if (loaded && role !== "admin") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: "Inter,system-ui,sans-serif" }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Inside Sales</div>
        <div style={{ color: C.muted }}>Acesso restrito ao administrador.</div>
        <Link href="/" style={{ color: C.accent2, textDecoration: "none" }}>← voltar ao funil</Link>
      </div>
    );
  }

  const sortBy = (fn: (l: Linha) => number) => [...linhas].sort((a, b) => fn(b) - fn(a));

  // valor de período por métrica (para prior months: "—" se novato)
  const cellMoney = (l: Linha, i: number, key: "liq") => l.novato && i < 3 ? "—" : moeda(l.p[i]?.[key] ?? 0);
  const cell2 = (l: Linha, i: number, key: "ticket" | "preco") => l.novato && i < 3 ? "—" : moeda2(l.p[i]?.[key] ?? null);
  const cellInt = (l: Linha, i: number, key: "clientes" | "itens" | "mix") => l.novato && i < 3 ? "—" : inteiro(l.p[i]?.[key] ?? 0);

  const chartSeries = (get: (p: P) => number | null) => linhas.map((l) => ({ nome: l.nome, cor: l.cor, pts: l.p.map((pp, i) => (l.novato && i < 3 ? null : get(pp))) }));

  const th: React.CSSProperties = { padding: "11px 14px", textAlign: "left", fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, whiteSpace: "nowrap" };
  const thr: React.CSSProperties = { ...th, textAlign: "right" };
  const td: React.CSSProperties = { padding: "11px 14px", fontSize: 12.5, borderTop: `1px solid ${C.border}` };
  const tdr: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const nm: React.CSSProperties = { ...td, fontWeight: 600 };

  const Analise = ({ id }: { id: string }) => {
    const ps = narr?.[id];
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`, borderRadius: 12, padding: "18px 22px", marginTop: 22 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.accent, marginBottom: 10 }}>📊 Análise</div>
        {ps?.length
          ? ps.map((p, i) => <p key={i} style={{ fontSize: 12, lineHeight: 1.7, color: "#C0C0D8", margin: "0 0 8px" }} dangerouslySetInnerHTML={{ __html: p }} />)
          : <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>{historico
            ? "A análise deste mês ainda está sendo gerada — ela é criada uma única vez por mês encerrado e fica disponível na próxima atualização automática (madrugada)."
            : "A análise interpretativa é gerada automaticamente toda madrugada (aparece aqui assim que o gerador de texto estiver ativo)."}</p>}
      </div>
    );
  };

  const tw = (children: React.ReactNode) => (
    <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>{children}</table>
    </div>
  );
  const secHead = (eye: string, title: string, sub: string) => (
    <>
      <div style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: C.accent, marginBottom: 5 }}>{eye}</div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em" }}>{title}</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 22 }}>{sub}</div>
    </>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "Inter,system-ui,sans-serif" }}>
      {/* header */}
      <div style={{ background: "linear-gradient(135deg,#1A1030,#0F0F1A 60%,#1A1030)", borderBottom: `1px solid ${C.border}`, padding: "18px 28px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 3 }}>
              <Link href="/analises" style={{ color: C.muted, textDecoration: "none", fontSize: 12, fontWeight: 600 }}>← Análises</Link>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: C.muted }}>Murano · Inside Sales</span>
            </div>
            <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.02em" }}>Dashboard de Desempenho</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, fontFamily: "monospace" }}>Filial 1 · F-Faturado · valor do pedido − devoluções · {dados?.dias_movimento ?? "—"} dias com movimento</div>
            {atualizado && !historico && <div style={{ background: "rgba(52,211,153,.12)", border: "1px solid rgba(52,211,153,.3)", color: C.green, fontSize: 10, fontFamily: "monospace", padding: "3px 10px", borderRadius: 20, marginTop: 6, display: "inline-block" }}>⟳ Atualizado {new Date(atualizado).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <select value={mes} onChange={(e) => setMes(e.target.value)}
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", outline: "none" }}>
              {opcoesMes.map((o) => <option key={o.value} value={o.value}>📅 {o.label}</option>)}
            </select>
            {historico && <div style={{ background: "rgba(251,191,36,.12)", border: "1px solid rgba(251,191,36,.35)", color: C.yellow, fontSize: 10, fontFamily: "monospace", padding: "3px 10px", borderRadius: 20 }}>mês encerrado · resultados finais</div>}
            {periodos[3] && <div style={{ background: "rgba(124,92,252,.15)", border: "1px solid rgba(124,92,252,.35)", color: C.accent2, fontSize: 10, fontFamily: "monospace", padding: "3px 10px", borderRadius: 20 }}>{periodos[3]} vs {periodos[0]} · {periodos[1]} · {periodos[2]}</div>}
          </div>
        </div>
        <div style={{ display: "flex", overflowX: "auto" }}>
          {TABS.map((t) => (
            <div key={t.id} onClick={() => !t.soon && setTab(t.id)}
              style={{ padding: "11px 16px", fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", cursor: t.soon ? "default" : "pointer", whiteSpace: "nowrap", color: tab === t.id ? C.accent2 : t.soon ? "#55556a" : C.muted, borderBottom: `2px solid ${tab === t.id ? C.accent : "transparent"}` }}>
              {t.ico} {t.nome}{t.soon ? " · em breve" : ""}
            </div>
          ))}
        </div>
      </div>

      <main style={{ padding: "28px 28px 60px", maxWidth: 1200, margin: "0 auto" }}>
        {erro && <div style={{ background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.3)", color: C.red, borderRadius: 10, padding: "12px 16px" }}>{erro}</div>}
        {!dados && !erro && <div style={{ color: C.muted }}>Carregando…</div>}

        {dados && tab === "fat" && (() => {
          const rows = sortBy((l) => l.p[3]?.liq ?? 0);
          return (
            <div>
              {secHead("Indicador 01", "Faturamento Líquido", `Valor do pedido (VENDA F-Faturado) − devoluções · Filial 1 · ${dados.dias_movimento} dias comparáveis`)}
              {kpis && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 24 }}>
                  {[
                    { l: `Total IS ${mesAtual(periodos)}`, v: moedaK(kpis.totIS), c: C.accent2, s: "líquido · período atual" },
                    { l: "Meta total mês", v: moedaK(kpis.metaTot), c: C.text, s: "soma das metas" },
                    { l: "Líder", v: kpis.lider?.nome ?? "—", c: C.green, s: moeda(kpis.lider?.p[3]?.liq ?? 0) },
                    { l: "Total devoluções", v: moedaK(kpis.totDev), c: C.red, s: "equipe · período" },
                  ].map((k, i) => (
                    <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${C.accent},${C.accent2})` }} />
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 7 }}>{k.l}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace", color: k.c }}>{k.v}</div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{k.s}</div>
                    </div>
                  ))}
                </div>
              )}
              {tw(<>
                <thead><tr style={{ background: "rgba(124,92,252,.12)" }}>
                  <th style={th}>Consultor</th>
                  <th style={thr}>{periodos[0]}</th><th style={thr}>{periodos[1]}</th><th style={thr}>{periodos[2]}</th>
                  <th style={thr}>Bruto</th><th style={thr}>Dev</th><th style={thr}>Líquido</th>
                  <th style={thr}>Meta</th><th style={th}>% Meta</th><th style={thr}>vs {mesAnt}</th>
                </tr></thead>
                <tbody>{rows.map((l) => {
                  const liq = l.p[3]?.liq ?? 0; const pctMeta = l.meta ? (liq / l.meta) * 100 : 0;
                  const barCol = pctMeta >= 50 ? C.green : pctMeta >= 35 ? C.yellow : C.red;
                  return (
                    <tr key={l.slug}>
                      <td style={nm}>{l.nome}{l.novato && <span style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", background: "rgba(52,211,153,.15)", color: C.green, border: "1px solid rgba(52,211,153,.3)", padding: "2px 6px", borderRadius: 8, marginLeft: 6 }}>novato</span>}</td>
                      <td style={tdr}>{cellMoney(l, 0, "liq")}</td><td style={tdr}>{cellMoney(l, 1, "liq")}</td><td style={tdr}>{cellMoney(l, 2, "liq")}</td>
                      <td style={tdr}>{moeda(l.p[3]?.bruto ?? 0)}</td>
                      <td style={{ ...tdr, color: C.red }}>-{moeda(l.p[3]?.dev ?? 0)}</td>
                      <td style={{ ...tdr, fontWeight: 700 }}>{moeda(liq)}</td>
                      <td style={tdr}>{moeda(l.meta)}</td>
                      <td style={td}><div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
                        <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,.08)", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(pctMeta, 100)}%`, background: barCol, borderRadius: 3 }} /></div>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: barCol, minWidth: 40, textAlign: "right" }}>{pct1(pctMeta)}</span>
                      </div></td>
                      <td style={tdr}><DeltaCell d={delta(l.p[3]?.liq ?? null, l.p[2]?.liq ?? null)} novato={l.novato} /></td>
                    </tr>
                  );
                })}</tbody>
              </>)}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 22px", marginTop: 22 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 14 }}>📈 Evolução do Faturamento Líquido</div>
                <LineChart labels={periodos} fmt={moedaK} series={chartSeries((p) => p.liq)} />
              </div>
              <Analise id="fat" />
            </div>
          );
        })()}

        {dados && (["ticket", "clientes", "preco", "itens", "mix"].includes(tab)) && (() => {
          const cfg: Record<string, any> = {
            ticket: { eye: "Indicador 02", title: "Ticket Médio por Cliente", sub: "Valor do pedido (VENDA F-Faturado) ÷ clientes únicos", key: "ticket", fmt: cell2, chart: (p: P) => p.ticket, cf: (n: number) => moedaK(n), extra: { label: "Clientes", val: (l: Linha) => inteiro(l.p[3]?.clientes ?? 0) } },
            clientes: { eye: "Indicador 03", title: "Clientes Atendidos", sub: "Clientes únicos com VENDA F-Faturado", key: "clientes", fmt: cellInt, chart: (p: P) => p.clientes, cf: (n: number) => inteiro(n) },
            preco: { eye: "Indicador 04", title: "Preço Médio por Produto", sub: "Valor dos itens ÷ quantidade (VENDA F-Faturado)", key: "preco", fmt: cell2, chart: (p: P) => p.preco, cf: (n: number) => moeda2(n) as string },
            itens: { eye: "Indicador 05", title: "Itens Vendidos", sub: "Quantidade de unidades (VENDA F-Faturado)", key: "itens", fmt: cellInt, chart: (p: P) => p.itens, cf: (n: number) => inteiro(n) },
            mix: { eye: "Indicador 06", title: "Positivação do Mix", sub: `Produtos distintos (VENDA F-Faturado) — ${dados.mix_total} produtos ativos`, key: "mix", fmt: cellInt, chart: (p: P) => p.mix, cf: (n: number) => inteiro(n) },
          };
          const g = cfg[tab];
          const rows = sortBy((l) => (l.p[3]?.[g.key as keyof P] as number) ?? 0);
          return (
            <div>
              {secHead(g.eye, g.title, `${g.sub} · ${dados.dias_movimento} dias comparáveis`)}
              {tw(<>
                <thead><tr style={{ background: "rgba(124,92,252,.12)" }}>
                  <th style={th}>Consultor</th>
                  <th style={thr}>{periodos[0]}</th><th style={thr}>{periodos[1]}</th><th style={thr}>{periodos[2]}</th><th style={thr}>{periodos[3]}</th>
                  {tab === "ticket" && <th style={thr}>Clientes</th>}
                  {tab === "mix" && <th style={thr}>% Mix</th>}
                  <th style={thr}>vs {mesAnt}</th>
                </tr></thead>
                <tbody>{rows.map((l) => (
                  <tr key={l.slug}>
                    <td style={nm}>{l.nome}{l.novato && <span style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", background: "rgba(52,211,153,.15)", color: C.green, border: "1px solid rgba(52,211,153,.3)", padding: "2px 6px", borderRadius: 8, marginLeft: 6 }}>novato</span>}</td>
                    <td style={tdr}>{g.fmt(l, 0, g.key)}</td><td style={tdr}>{g.fmt(l, 1, g.key)}</td><td style={tdr}>{g.fmt(l, 2, g.key)}</td>
                    <td style={{ ...tdr, fontWeight: 700 }}>{g.fmt(l, 3, g.key)}</td>
                    {tab === "ticket" && <td style={tdr}>{inteiro(l.p[3]?.clientes ?? 0)}</td>}
                    {tab === "mix" && <td style={tdr}>{dados.mix_total ? pct1(((l.p[3]?.mix ?? 0) / dados.mix_total) * 100) : "—"}</td>}
                    <td style={tdr}><DeltaCell d={delta((l.p[3]?.[g.key as keyof P] as number) ?? null, (l.p[2]?.[g.key as keyof P] as number) ?? null)} novato={l.novato} /></td>
                  </tr>
                ))}</tbody>
              </>)}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 22px", marginTop: 22 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 14 }}>📈 Evolução — {g.title}</div>
                <LineChart labels={periodos} fmt={g.cf} series={chartSeries(g.chart)} />
              </div>
              <Analise id={tab} />
            </div>
          );
        })()}

        {dados && tab === "opp" && (() => {
          const opp: any = (dados as any).oportunidades;
          if (!opp) return <div style={{ color: C.muted, padding: "40px 0", textAlign: "center" }}>{historico ? "Oportunidades estão disponíveis apenas no mês atual (dependem da recompra em andamento)." : "Sem dados de oportunidades ainda."}</div>;
          const tag = (s: string) => s === "urgente"
            ? { t: "🔴 Urgente", bg: "rgba(248,113,113,.15)", cl: C.red, bd: "rgba(248,113,113,.3)" }
            : { t: "🟡 Atenção", bg: "rgba(251,191,36,.12)", cl: C.yellow, bd: "rgba(251,191,36,.3)" };
          return (
            <div>
              {secHead("Ação Prioritária", "Oportunidades & Conversões", `Top 10 clientes de ${mesAnt} por consultor · recompra no mês atual`)}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 24 }}>
                {[
                  { l: "Convertidos", v: String(opp.convertidos ?? 0), c: C.green, s: `de ${opp.total_lista ?? 0} da lista` },
                  { l: "Taxa de conversão", v: String(opp.taxa ?? 0).replace(".", ",") + "%", c: C.accent2, s: "recompraram no mês" },
                  { l: "Ainda pendentes", v: String(opp.pendentes ?? 0), c: C.red, s: "não recompraram" },
                  { l: "Lista original", v: String(opp.total_lista ?? 0), c: C.text, s: "top 10 × consultor" },
                ].map((k, i) => (
                  <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${C.accent},${C.accent2})` }} />
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 7 }}>{k.l}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace", color: k.c }}>{k.v}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{k.s}</div>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.green, marginBottom: 12 }}>✅ Convertidos — clientes que voltaram a comprar</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginBottom: 24 }}>
                {(opp.convertidos_lista ?? []).map((c: any, i: number) => (
                  <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", display: "flex", gap: 12 }}>
                    <div style={{ fontSize: 20 }}>✅</div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.accent2, marginBottom: 2 }}>{c.consultor}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{c.cliente}</div>
                      <div style={{ fontSize: 11, color: C.muted }}><span style={{ color: C.green, fontWeight: 600 }}>{moeda(c.valor_atual ?? 0)}</span> · era {moeda(c.valor_ant ?? 0)} em {mesAnt}</div>
                    </div>
                  </div>
                ))}
              </div>

              {(opp.pendentes_por_consultor ?? []).map((g: any, gi: number) => (
                <div key={gi} style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: g.cor, marginBottom: 8 }}>● {g.consultor} — {g.itens.length} pendentes</p>
                  {tw(<>
                    <thead><tr style={{ background: "rgba(124,92,252,.12)" }}>
                      <th style={th}>#</th><th style={th}>Cliente</th><th style={thr}>Valor {mesAnt}</th><th style={th}>Status</th>
                    </tr></thead>
                    <tbody>{g.itens.map((it: any, ii: number) => { const tg = tag(it.status); return (
                      <tr key={ii}>
                        <td style={td}>{it.rank}</td>
                        <td style={nm}>{it.cliente}</td>
                        <td style={tdr}>{moeda(it.valor_ant ?? 0)}</td>
                        <td style={td}><span style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", background: tg.bg, color: tg.cl, border: `1px solid ${tg.bd}`, padding: "2px 7px", borderRadius: 8 }}>{tg.t}</span></td>
                      </tr>
                    ); })}</tbody>
                  </>)}
                </div>
              ))}
              <Analise id="opp" />
            </div>
          );
        })()}

        {dados && tab === "evolucao" && (() => {
          const iAtual = periodos.length - 1;
          const iAnt = iAtual - 1;
          const labAtual = periodos[iAtual] || "atual";
          const labAnt = periodos[iAnt] || "anterior";

          // agregados da equipe por mês (consultor sem o mês — ex. novato — conta 0)
          const teamP: P[] = periodos.map((_, m) => {
            const sum = (f: (p: P) => number) => linhas.reduce((a, l) => a + (l.p[m] ? f(l.p[m]) : 0), 0);
            const bruto = sum((p) => p.bruto), dev = sum((p) => p.dev), liq = sum((p) => p.liq);
            const clientes = sum((p) => p.clientes), itens = sum((p) => p.itens);
            return { bruto, dev, liq, clientes, itens, mix: 0, preco: itens ? bruto / itens : null, ticket: clientes ? bruto / clientes : null };
          });
          const bestIdx = (vals: (number | null)[]) => {
            let bi = 0, bv = -Infinity;
            vals.forEach((v, i) => { if (v != null && v > bv) { bv = v; bi = i; } });
            return bi;
          };
          const teamBest = bestIdx(teamP.map((p) => p.liq));

          const metricas: { k: keyof P; label: string; f: (n: number | null) => string }[] = [
            { k: "liq", label: "Faturamento líquido", f: (n) => moeda(n ?? 0) },
            { k: "bruto", label: "Faturamento bruto", f: (n) => moeda(n ?? 0) },
            { k: "clientes", label: "Clientes atendidos", f: (n) => inteiro(n ?? 0) },
            { k: "ticket", label: "Ticket médio", f: (n) => moeda2(n) },
            { k: "preco", label: "Preço médio", f: (n) => moeda2(n) },
            { k: "itens", label: "Itens vendidos", f: (n) => inteiro(n ?? 0) },
          ];
          const compTable = (refLabel: string, ref: P) => tw(<>
            <thead><tr style={{ background: "rgba(124,92,252,.12)" }}>
              <th style={th}>Métrica</th><th style={thr}>{refLabel}</th><th style={thr}>{labAtual}</th><th style={thr}>Δ%</th>
            </tr></thead>
            <tbody>{metricas.map((mt) => {
              const a = teamP[iAtual][mt.k] as number | null;
              const b = ref[mt.k] as number | null;
              return (
                <tr key={String(mt.k)}>
                  <td style={nm}>{mt.label}</td>
                  <td style={tdr}>{mt.f(b)}</td>
                  <td style={{ ...tdr, fontWeight: 700 }}>{mt.f(a)}</td>
                  <td style={tdr}><DeltaCell d={delta(a, b)} novato={false} /></td>
                </tr>
              );
            })}</tbody>
          </>);

          const rows = sortBy((l) => l.p[iAtual]?.liq ?? 0);
          return (
            <div>
              {secHead("Indicador 07", "Evolução de Desempenho", `${labAtual} vs ${labAnt} e vs melhor mês · equipe e por consultor`)}

              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.accent2, marginBottom: 12 }}>🏢 Equipe</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16, marginBottom: 26 }}>
                <div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Mês atual vs mês anterior ({labAnt})</div>
                  {compTable(labAnt, teamP[iAnt])}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Mês atual vs melhor mês ({periodos[teamBest]})</div>
                  {compTable(`Melhor · ${periodos[teamBest]}`, teamP[teamBest])}
                </div>
              </div>

              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.accent2, marginBottom: 12 }}>👤 Por consultor</p>
              {tw(<>
                <thead><tr style={{ background: "rgba(124,92,252,.12)" }}>
                  <th style={th}>Consultor</th>
                  <th style={thr}>Líquido {labAtual}</th>
                  <th style={thr}>vs {labAnt}</th>
                  <th style={th}>Melhor mês</th>
                  <th style={thr}>Pico</th>
                  <th style={thr}>vs melhor</th>
                </tr></thead>
                <tbody>{rows.map((l) => {
                  const atual = l.p[iAtual]?.liq ?? 0;
                  const bi = l.novato ? iAtual : bestIdx(l.p.map((p) => p?.liq ?? null));
                  const pico = l.p[bi]?.liq ?? 0;
                  const noPico = bi === iAtual;
                  return (
                    <tr key={l.slug}>
                      <td style={nm}>{l.nome}{l.novato && <span style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", background: "rgba(52,211,153,.15)", color: C.green, border: "1px solid rgba(52,211,153,.3)", padding: "2px 6px", borderRadius: 8, marginLeft: 6 }}>novato</span>}</td>
                      <td style={{ ...tdr, fontWeight: 700 }}>{moeda(atual)}</td>
                      <td style={tdr}><DeltaCell d={delta(l.p[iAtual]?.liq ?? null, l.p[iAnt]?.liq ?? null)} novato={l.novato} /></td>
                      <td style={td}>{l.novato ? <span style={{ color: C.muted }}>estreia</span> : periodos[bi]}</td>
                      <td style={tdr}>{moeda(pico)}</td>
                      <td style={tdr}>{l.novato ? <span style={{ color: C.muted }}>—</span> : noPico ? <span style={{ color: C.green }}>★ melhor mês</span> : <DeltaCell d={delta(atual, pico)} novato={false} />}</td>
                    </tr>
                  );
                })}</tbody>
              </>)}

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 22px", marginTop: 22 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 14 }}>📈 Evolução do Faturamento Líquido</div>
                <LineChart labels={periodos} fmt={moedaK} series={chartSeries((p) => p.liq)} />
              </div>
              <Analise id="evolucao" />
            </div>
          );
        })()}

        {dados && tab === "novatos" && (() => {
          const nv: any = (dados as any).novatos;
          if (!nv) return <div style={{ color: C.muted, padding: "40px 0", textAlign: "center" }}>{historico ? "Perfil de novatos está disponível apenas no mês atual." : "Sem dados de novatos ainda."}</div>;
          const k = nv.kpis ?? {}; const novs: any[] = nv.novatos ?? [];
          const pctNovos = k.total_clientes ? Math.round((k.clientes_novos / k.total_clientes) * 100) : 0;
          return (
            <div>
              {secHead("Análise de Carteira", "Perfil dos Clientes — Novatos", `Evolução semanal e faixas de inatividade · ${novs.map((n) => n.nome).join(" · ")}`)}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 24 }}>
                {[
                  { l: "Total clientes", v: String(k.total_clientes ?? 0), c: C.accent2, s: "no mês atual" },
                  { l: "Clientes novos", v: String(k.clientes_novos ?? 0), c: C.green, s: `${pctNovos}% — nunca compraram` },
                  { l: "Inativos 121–180d", v: String(k.inativos_121_180 ?? 0), c: C.accent, s: "faixa reativada" },
                  { l: "Inativos 181–365d", v: String(k.inativos_181_365 ?? 0), c: C.yellow, s: "maior fatia" },
                ].map((x, i) => (
                  <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${C.accent},${C.accent2})` }} />
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 7 }}>{x.l}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace", color: x.c }}>{x.v}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{x.s}</div>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.accent2, marginBottom: 14 }}>📅 Evolução Semanal — faturamento e clientes</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginBottom: 24 }}>
                {(nv.semanal ?? []).map((s: any, si: number) => (
                  <div key={si} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 12 }}>Semana {si + 1} · {s.label}</div>
                    {(s.linhas ?? []).map((l: any, li: number) => (
                      <div key={li} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingBottom: 8, borderBottom: li < (s.linhas.length - 1) ? `1px solid ${C.border}` : "none" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: l.cor }} />{l.nome}</div>
                        <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>{moeda(l.fat ?? 0)}</div><div style={{ fontSize: 10, color: C.muted }}>{l.clientes} clientes</div></div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.accent2, marginBottom: 14 }}>📊 Distribuição por faixa de inatividade</p>
              {tw(<>
                <thead><tr style={{ background: "rgba(124,92,252,.12)" }}>
                  <th style={th}>Faixa</th>
                  {novs.map((n) => <th key={n.slug} style={thr}>{n.nome}</th>)}
                  <th style={thr}>Total</th><th style={thr}>%</th><th style={th}>Distribuição</th>
                </tr></thead>
                <tbody>{(nv.faixas ?? []).map((f: any, fi: number) => (
                  <tr key={fi}>
                    <td style={{ ...nm, color: f.cor }}>{f.label}</td>
                    {novs.map((n) => <td key={n.slug} style={tdr}>{f.counts?.[n.slug] ?? 0}</td>)}
                    <td style={{ ...tdr, fontWeight: 700 }}>{f.total}</td>
                    <td style={{ ...tdr, color: f.cor }}>{pct1(f.pct ?? 0)}</td>
                    <td style={td}><div style={{ height: 8, background: "rgba(255,255,255,.06)", borderRadius: 4, overflow: "hidden" }}><div style={{ height: "100%", width: `${f.pct ?? 0}%`, background: f.cor }} /></div></td>
                  </tr>
                ))}</tbody>
              </>)}
              <Analise id="novatos" />
            </div>
          );
        })()}
      </main>
      <footer style={{ textAlign: "center", padding: "18px", fontSize: 10, color: C.muted, fontFamily: "monospace", borderTop: `1px solid ${C.border}` }}>
        Murano · Inside Sales · Filial 1 · F-Faturado · valor do pedido − devoluções · atualização automática diária
      </footer>
    </div>
  );
}

function mesAtual(periodos: string[]) { return (periodos[3] || "").split(" ")[0] || ""; }
