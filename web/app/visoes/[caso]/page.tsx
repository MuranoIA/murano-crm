"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TEMAS, temaSalvo, type Paleta } from "../../../lib/tema";

const TITULOS: Record<string, { titulo: string; desc: string }> = {
  melhores: { titulo: "🏆 30 Melhores", desc: "Top 30 por frequência e monetização (F/M) — ativo/inativo pela regra dos 120 dias" },
  frequencia: { titulo: "📅 Frequência", desc: "3 meses seguidos de compra = frequente" },
  fidelizacao: { titulo: "🌱 Fidelização", desc: "Clientes novos rumo aos 3 meses de compra — ao fechar, passam para a Frequência" },
  mes: { titulo: "🛒 Compras do mês", desc: "Clientes que compraram no mês atual" },
  desativados: { titulo: "🚫 Desativados", desc: "Motivo e observação editáveis; restaurar devolve o cliente ao board" },
};

const moeda = (v: any) =>
  v == null ? "—" : (+v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dataBR = (d: any) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—");
const cap = (s: any) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");
const linkZap = (tel: any) => {
  const dig = String(tel ?? "").replace(/\D/g, "");
  if (dig.length < 8) return null;
  return `https://wa.me/${dig.length <= 11 ? "55" + dig : dig}`;
};

export default function VisaoCaso() {
  const params = useParams<{ caso: string }>();
  const caso = params?.caso ?? "";
  const meta = TITULOS[caso];

  const [C, setC] = useState<Paleta>(TEMAS.padrao);
  useEffect(() => { setC(TEMAS[temaSalvo()]); }, []);

  const [dados, setDados] = useState<any | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<number | null>(null);
  // edições locais da visão desativados (por id): motivo/observação antes de salvar
  const [edicao, setEdicao] = useState<Record<number, { motivo?: string; observacao?: string }>>({});

  const carregar = useCallback(() => {
    setErro(null);
    fetch(`/api/visoes?caso=${caso}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (r.status === 401) throw new Error("Sessão expirada — faça login no funil e volte.");
        if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
        setDados(j);
      })
      .catch((e) => setErro(e.message));
  }, [caso]);
  useEffect(() => { if (meta) carregar(); }, [meta, carregar]);

  async function salvarDesativado(id: number) {
    const e = edicao[id];
    if (!e) return;
    setSalvando(id);
    const r = await fetch("/api/descartados", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...e }),
    });
    setSalvando(null);
    if (r.ok) { setEdicao((m) => { const n = { ...m }; delete n[id]; return n; }); carregar(); }
    else alert("Não foi possível salvar: " + ((await r.json().catch(() => null))?.error ?? r.status));
  }

  async function restaurar(id: number, nome: string) {
    if (!confirm(`Restaurar "${nome}"? O cliente volta a aparecer no board.`)) return;
    setSalvando(id);
    const r = await fetch("/api/descartados", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setSalvando(null);
    if (r.ok) carregar();
    else alert("Não foi possível restaurar: " + ((await r.json().catch(() => null))?.error ?? r.status));
  }

  if (!meta) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: C.navy }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Visão não encontrada</div>
        <Link href="/visoes" style={{ color: C.cyan, fontSize: 14, textDecoration: "none" }}>← voltar às visões</Link>
      </div>
    );
  }

  const badge = (texto: string, cor: string, fundo: string) => (
    <span style={{ fontSize: 10.5, fontWeight: 800, color: cor, background: fundo, border: `1px solid ${cor}22`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
      {texto}
    </span>
  );

  // card no estilo do board do CRM (nome, meta, selos)
  const cardCliente = (c: any) => {
    const zap = linkZap(c.telefone);
    return (
      <div key={c.codcli} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", boxShadow: "0 1px 2px rgba(16,32,64,0.05)", display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          {c.posicao_rank != null && (
            <span style={{ fontSize: 12, fontWeight: 900, color: C.wine, background: C.wineSoft, borderRadius: 8, padding: "2px 7px", fontVariantNumeric: "tabular-nums" }}>#{c.posicao_rank}</span>
          )}
          <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.25, flex: 1 }}>{c.nome}</div>
          {zap && (
            <a href={zap} target="_blank" rel="noopener noreferrer" title="Abrir WhatsApp" style={{ textDecoration: "none", fontSize: 15, lineHeight: 1 }}>💬</a>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: C.grayLight, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {c.cidade && <span>{c.cidade}</span>}
          {c.telefone && <span style={{ fontVariantNumeric: "tabular-nums" }}>{c.telefone}</span>}
          {c.vendedor && <span style={{ color: C.wine, fontWeight: 700 }}>{cap(c.vendedor)}</span>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
          {caso === "melhores" && badge(
            (c.dias_sem_comprar ?? 9999) <= 120 ? "ATIVO" : `INATIVO · ${c.dias_sem_comprar}d`,
            (c.dias_sem_comprar ?? 9999) <= 120 ? "#1a6b3c" : "#c4370f",
            (c.dias_sem_comprar ?? 9999) <= 120 ? "#e3f2e9" : "#fdeae3",
          )}
          {caso === "frequencia" && c.sequencia >= 3 && badge(`${c.sequencia} MESES SEGUIDOS`, "#1a6b3c", "#e3f2e9")}
          {caso === "frequencia" && c.sequencia < 3 && badge(`SEQUÊNCIA ${c.sequencia}/3`, "#b45309", "#fdf3e3")}
          {caso === "fidelizacao" && badge(`${c.meses_total}/3 MESES`, "#1a5fa8", "#e3ecf7")}
          {c.valor_mes > 0 && badge(`MÊS ${moeda(c.valor_mes)}`, "#1a6b3c", "#e3f2e9")}
          {badge(`12M ${moeda(c.total_12m)} · ${c.meses_12m}x`, C.wine, C.wineSoft)}
          {badge(`ÚLT. ${dataBR(c.ultima_compra)}`, C.gray, C.bg)}
        </div>
      </div>
    );
  };

  // card da visão desativados: motivo (dropdown) + observação + salvar/restaurar
  const cardDesativado = (c: any) => {
    const e = edicao[c.id] ?? {};
    const motivo = e.motivo ?? c.motivo ?? "cliente final";
    const obs = e.observacao ?? c.observacao ?? "";
    const mudou = (e.motivo !== undefined && e.motivo !== c.motivo) || (e.observacao !== undefined && e.observacao !== (c.observacao ?? ""));
    const motivos: string[] = dados?.motivos ?? [];
    const opcoes = motivos.includes(motivo) ? motivos : [motivo, ...motivos];
    return (
      <div key={c.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", boxShadow: "0 1px 2px rgba(16,32,64,0.05)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}>{c.cliente ?? c.cliente_id ?? `codcli ${c.codcli}`}</div>
        <div style={{ fontSize: 11.5, color: C.grayLight, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {c.vendedor && <span style={{ color: C.wine, fontWeight: 700 }}>{cap(c.vendedor)}</span>}
          <span>desativado em {dataBR(c.criado_em)}</span>
          {c.descartado_por && <span>por {cap(c.descartado_por)}</span>}
        </div>
        <label style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray }}>
          Motivo da desativação
          <select
            value={motivo}
            onChange={(ev) => setEdicao((m) => ({ ...m, [c.id]: { ...m[c.id], motivo: ev.target.value } }))}
            style={{ display: "block", width: "100%", marginTop: 4, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", color: C.navy, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8 }}
          >
            {opcoes.map((m) => <option key={m} value={m}>{cap(m)}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray }}>
          Observação
          <textarea
            value={obs}
            rows={2}
            placeholder="Explique o motivo (opcional)…"
            onChange={(ev) => setEdicao((m) => ({ ...m, [c.id]: { ...m[c.id], observacao: ev.target.value } }))}
            style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", color: C.navy, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, resize: "vertical" }}
          />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => salvarDesativado(c.id)}
            disabled={!mudou || salvando === c.id}
            style={{ flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", color: mudou ? "#fff" : C.grayLight, background: mudou ? C.cyan : C.bg, border: `1px solid ${mudou ? C.cyan : C.border}`, borderRadius: 8, cursor: mudou ? "pointer" : "default" }}
          >
            {salvando === c.id ? "…" : "Salvar"}
          </button>
          <button
            onClick={() => restaurar(c.id, c.cliente ?? "cliente")}
            disabled={salvando === c.id}
            style={{ flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", color: C.wine, background: C.wineSoft, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer" }}
          >
            ↩ Restaurar
          </button>
        </div>
      </div>
    );
  };

  const grupos: any[] = dados?.grupos ?? [];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.navy, fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", background: C.surface, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <Link href="/visoes" style={{ color: C.gray, textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>← Visões</Link>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.wine, whiteSpace: "nowrap" }}>{meta.titulo}</div>
        <div style={{ fontSize: 12, color: C.grayLight }}>{meta.desc}</div>
      </div>

      {erro && (
        <div style={{ maxWidth: 720, margin: "40px auto", padding: 20, background: "#fdeae3", border: "1px solid #f0c4b0", borderRadius: 12, color: "#7c2d12", fontSize: 14 }}>
          {erro} — <Link href="/" style={{ color: "#7c2d12" }}>ir para o funil</Link>
        </div>
      )}
      {!erro && !dados && <div style={{ padding: 40, color: C.gray, fontSize: 14 }}>Carregando…</div>}

      {/* colunas no estilo do board */}
      {!erro && dados && (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "16px 20px 40px", overflowX: "auto" }}>
          {grupos.map((g) => (
            <div key={g.key} style={{ flex: "1 1 0", minWidth: 300, maxWidth: 520, background: C.colHeader, borderRadius: 12, padding: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 10px" }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: C.navy }}>{g.titulo}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: C.wine, background: C.surface, borderRadius: 999, padding: "1px 8px", fontVariantNumeric: "tabular-nums" }}>{g.cards.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "72vh", overflowY: "auto", paddingRight: 2 }}>
                {g.cards.length === 0 && <div style={{ padding: "18px 8px", fontSize: 12.5, color: C.grayLight, textAlign: "center" }}>Nenhum cliente aqui.</div>}
                {g.cards.map((c: any) => (caso === "desativados" ? cardDesativado(c) : cardCliente(c)))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
