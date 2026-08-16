"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Indicadores de atendimento do chat — o equivalente ao TME/TMA do painel do RD.
// Identidade Murano, mesma paleta da tela de chat.
const M = {
  wine: "#621244", roxo: "#7b2d8b", roxoSoft: "#f1e6f4", azul: "#1a5fa8",
  laranja: "#dd4222", bg: "#f5edf4", surface: "#ffffff", border: "#e0cfdb",
  ink: "#241327", muted: "#9a8098", gray: "#6f5c6d", verde: "#1a6b3c",
};

type Linha = {
  vendedor: string; respostas: number; mediana_tipica_min: number | null;
  pior_p90_min: number; pct_ate_5min: number | null; pct_ate_30min: number | null;
  recebidas: number; enviadas: number; dias_com_atividade: number;
};
type Dados = {
  dias: number; vendedores: Linha[];
  resolvidas: { total: number; por_motivo: Record<string, number> };
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// minutos -> "4 min" / "1h20" / "2d 3h": número cru em minutos não se lê
const dur = (min: number | null) => {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h < 24) return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};
const corDoTempo = (min: number | null) =>
  min == null ? M.muted : min <= 5 ? M.verde : min <= 30 ? "#b8860b" : M.laranja;

const ROTULO_MOTIVO: Record<string, string> = {
  venda_realizada: "✅ Venda realizada", tentativa_contato: "📞 Tentativa de contato",
  follow_up: "🕗 Follow-up", sem_interesse: "🚫 Sem interesse",
  outro: "• Outro", sem_motivo: "— sem motivo informado",
};

export default function Indicadores() {
  const [dias, setDias] = useState(15);
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setD(null); setErro(null);
    fetch(`/api/chat/indicadores?dias=${dias}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.error ?? `erro ${r.status}`))))
      .then(setD)
      .catch((e) => setErro(e?.message ?? String(e)));
  }, [dias]);

  const th = { textAlign: "left" as const, fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
    textTransform: "uppercase" as const, color: M.muted, padding: "8px 10px", borderBottom: `2px solid ${M.border}` };
  const td = { padding: "9px 10px", fontSize: 13, borderBottom: `1px solid ${M.bg}`, fontVariantNumeric: "tabular-nums" as const };

  return (
    <div style={{ minHeight: "100vh", background: M.bg, color: M.ink, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${M.laranja}, ${M.wine}, ${M.roxo})` }} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 18px", background: M.surface, borderBottom: `1px solid ${M.border}` }}>
        <Link href="/chat" style={{ color: M.gray, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Chat</Link>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: M.wine }}>📊 Indicadores de atendimento</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {[7, 15, 30].map((n) => (
            <button key={n} onClick={() => setDias(n)}
              style={{ padding: "5px 12px", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                color: dias === n ? "#fff" : M.gray, background: dias === n ? M.roxo : M.bg,
                border: `1px solid ${dias === n ? M.roxo : M.border}`, borderRadius: 8 }}>
              {n} dias
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 18 }}>
        {erro && <div style={{ padding: 14, color: M.laranja, fontSize: 13 }}>{erro}</div>}
        {!d && !erro && <div style={{ padding: 14, color: M.muted, fontSize: 13 }}>Carregando…</div>}

        {d && (
          <>
            <div style={{ background: M.surface, border: `1px solid ${M.border}`, borderRadius: 14, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Vendedor</th>
                    <th style={{ ...th, textAlign: "right" }}>Respostas</th>
                    <th style={{ ...th, textAlign: "right" }}>Mediana típica</th>
                    <th style={{ ...th, textAlign: "right" }}>Até 5 min</th>
                    <th style={{ ...th, textAlign: "right" }}>Até 30 min</th>
                    <th style={{ ...th, textAlign: "right" }}>Pior dia (p90)</th>
                    <th style={{ ...th, textAlign: "right" }}>Recebidas</th>
                    <th style={{ ...th, textAlign: "right" }}>Enviadas</th>
                  </tr>
                </thead>
                <tbody>
                  {d.vendedores.map((v) => (
                    <tr key={v.vendedor}>
                      <td style={{ ...td, fontWeight: 700 }}>{cap(v.vendedor)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{v.respostas}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 800, color: corDoTempo(v.mediana_tipica_min) }}>
                        {dur(v.mediana_tipica_min)}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>{v.pct_ate_5min ?? "—"}%</td>
                      <td style={{ ...td, textAlign: "right" }}>{v.pct_ate_30min ?? "—"}%</td>
                      <td style={{ ...td, textAlign: "right", color: M.gray }}>{dur(v.pior_p90_min)}</td>
                      <td style={{ ...td, textAlign: "right", color: M.gray }}>{v.recebidas}</td>
                      <td style={{ ...td, textAlign: "right", color: M.gray }}>{v.enviadas}</td>
                    </tr>
                  ))}
                  {!d.vendedores.length && (
                    <tr><td colSpan={8} style={{ ...td, color: M.muted, textAlign: "center" }}>Sem atividade no período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 320px", background: M.surface, border: `1px solid ${M.border}`, borderRadius: 14, padding: "12px 16px" }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: M.muted, marginBottom: 8 }}>
                  Encerramentos por motivo — {d.resolvidas.total} no período
                </div>
                {Object.entries(d.resolvidas.por_motivo).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                    <span style={{ color: M.gray }}>{ROTULO_MOTIVO[k] ?? k}</span>
                    <b style={{ fontVariantNumeric: "tabular-nums" }}>{n}</b>
                  </div>
                ))}
                {!d.resolvidas.total && (
                  <div style={{ fontSize: 12.5, color: M.muted, lineHeight: 1.5 }}>
                    Nenhuma conversa encerrada ainda. O motivo do encerramento é a nossa tabulação —
                    quanto mais o time usar o botão <b>Resolver</b>, mais confiável fica a medição de venda.
                  </div>
                )}
              </div>

              <div style={{ flex: "1 1 320px", background: "rgba(221,66,34,.06)", border: "1px solid rgba(221,66,34,.18)",
                borderLeft: `3px solid ${M.laranja}`, borderRadius: "0 12px 12px 0", padding: "12px 16px", fontSize: 12.5, lineHeight: 1.55 }}>
                <b style={{ color: M.wine }}>Como ler estes números</b>
                <p style={{ margin: "6px 0 0" }}>
                  Uma <b>espera</b> é o par “cliente falou → vendedor respondeu”, contada uma vez por
                  rajada. Esperas acima de <b>24h</b> ficam de fora: ali a janela do WhatsApp já fechou
                  e o caso é reengajamento por template, não demora de atendimento.
                </p>
                <p style={{ margin: "6px 0 0" }}>
                  A coluna de destaque é a <b>mediana</b>, não a média: a média é dominada por poucas
                  esperas muito longas e engana. “Mediana típica” é a mediana dos dias do período —
                  a mediana exata do período exigiria as esperas uma a uma.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
