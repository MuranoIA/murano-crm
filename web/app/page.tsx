"use client";
import { useEffect, useMemo, useState } from "react";

type Msg = { c: string | null; e: string | null; t?: string | null }; // conteudo, enviada_por, criada_em
type Card = {
  cliente_id: string;
  cliente: string;
  vendedor: string;
  etapa: string;
  ultima_atividade: string | null;
  ultima_mensagem: string | null;
  ultima_enviada_por: string | null;
  telefone: string | null;
  ultimas_mensagens: Msg[] | null; // até 3, mais recente primeiro
  venda_valor: number | null;      // valor faturado no período (R$), nota fiscal WinThor
  venda_data: string | null;       // data da última compra
  periodo?: string;                // (pedido_emitido) período da linha: hoje/ontem/semana/quinzena/mes/todos
  pedidos?: number;                // (pedido_emitido) qtd de pedidos no período
  cliente_de_outra_carteira?: boolean; // vendeu p/ cliente de outro consultor
};

function moedaBR(v: number | null): string {
  if (v == null) return "";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

// cards sintéticos da fila de prospecção (WinThor) — nunca tiveram conversa no RD
// Conversas, não têm cliente_id real de lá, só telefone pra abrir WhatsApp direto.
function ehProspeccao(c: Card): boolean {
  return c.cliente_id.startsWith("winthor:");
}
// venda WinThor de cliente que nunca conversou (card sintético na coluna Pedido Emitido)
function ehVendaSemConversa(c: Card): boolean {
  return c.cliente_id.startsWith("venda:");
}
// qualquer card sintético (sem conversa no RD) — clique abre WhatsApp pelo telefone
function ehSintetico(c: Card): boolean {
  return ehProspeccao(c) || ehVendaSemConversa(c);
}

function limpaMsg(s: string | null): string {
  return String(s ?? "").replace(/^\*[^*]+\*\s*/, "").replace(/\s+/g, " ").trim();
}

const MIN_ALERTA = 10;  // cliente respondeu e vendedor está há >10 min sem responder
const SNOOZE_MIN = 20;  // clicar no card "reconhece" e silencia o alerta por ~1 ciclo de ETL
// ackMs = quando o vendedor abriu a conversa deste card (reconhecimento otimista).
function ehAlerta(c: Card, ackMs?: number): boolean {
  if (c.ultima_enviada_por !== "customer" || !c.ultima_atividade) return false;
  const atividade = new Date(c.ultima_atividade).getTime();
  if (Date.now() - atividade <= MIN_ALERTA * 60 * 1000) return false;
  // Se o vendedor abriu a conversa DEPOIS da última msg do cliente e ainda está na
  // janela de carência, silencia. Volta se: o cliente mandar msg nova (ack < atividade)
  // OU a carência expirar e a ETL ainda ver o cliente esperando (auto-cura).
  if (ackMs && ackMs > atividade && Date.now() - ackMs < SNOOZE_MIN * 60 * 1000) return false;
  return true;
}

const URL_CHAT = "https://app.tallos.com.br/app/chat"; // deep link do RD Conversas (por cliente_id)

// Paleta inspirada no RD Station CRM
const RD = {
  bg: "#eef0f4",
  surface: "#ffffff",
  colHeader: "#eae5f2",
  border: "#d3dae5",
  navy: "#111d33",
  gray: "#616b79",
  grayLight: "#7d8695",
  cyan: "#0ea3dc",
  cyanSoft: "#daeffb",
  wine: "#57163f",
  wineSoft: "#efe6eb",
  cream: "#e7d7dc",
};

function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }} aria-label="Murano">
      <rect width="100" height="100" rx="18" fill="#57163f" />
      <path d="M31 74 C 31 48, 33 36, 47 28" fill="none" stroke="#e7d7dc" strokeWidth="9.5" strokeLinecap="round" />
      <path d="M53 74 C 53 48, 55 36, 69 28" fill="none" stroke="#e7d7dc" strokeWidth="9.5" strokeLinecap="round" />
    </svg>
  );
}

const COLUNAS = [
  { key: "ociosos", titulo: "Ociosos", status: "Parado", cor: "#94a3b8", sub: "parado +24h ou nunca contatado", subLong: "cliente falou por último há +24h (só template reabre) ou nunca contatado" },
  { key: "tentativa_contato", titulo: "Tentativa de contato", status: "Nova", cor: "#1a7fee", sub: "template enviado, sem resposta", subLong: "você mandou template, aguardando a 1ª resposta do cliente" },
  { key: "negociacao", titulo: "Negociação", status: "Em andamento", cor: "#0e9fd6", sub: "conversa ativa (últimas 24h)", subLong: "troca ativa dentro da janela de 24h" },
  { key: "pedido_emitido", titulo: "Pedido emitido", status: "Vendida", cor: "#16a34a", sub: "venda no mês — zera dia 1º", subLong: "venda no mês corrente; zera no dia 1º de cada mês" },
] as const;

const CoresVendedor: Record<string, string> = {
  romulo: "#ea6a08",
  kamilly: "#9333ea",
  luana: "#0d9488",
  milene: "#2563eb",
};

function tempoRelativo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
function diasInativo(iso: string | null): number {
  if (!iso) return Infinity; // nunca contatado — "mais parado que qualquer outro"
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function ehHoje(iso: string | null): boolean {
  if (!iso) return false;
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10) === hoje;
}
function dataHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}
// data pura "YYYY-MM-DD" (ex: data_fat da nota) — formata direto, SEM shift de fuso
// (senão meia-noite UTC vira o dia anterior em BRT). Ex: 2026-07-23 -> "23/07".
function dataDiaISO(s: string | null): string {
  if (!s) return "—";
  const [, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}`;
}
const DIAS_RECONTATO = 4; // tentativa de contato parada há >= 4 dias -> recontactar
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const LOTE_INICIAL = 100;   // cards renderizados de cada coluna ao carregar
const LOTE_INCREMENTO = 100; // quanto libera a cada vez que chega perto do fim da lista
const CARD_ALTURA = 138;    // altura fixa do card (simétrico) — comporta até 2 bolhas compactas

// Períodos de atividade. "hoje/semana/quinzena/mês" são janelas cumulativas; "ontem"
// é o dia-calendário anterior (só no dropdown, não nos chips). "todos" = sem filtro.
// Cards de prospecção (ultima_atividade null) só aparecem em "todos".
type Periodo = "todos" | "hoje" | "ontem" | "semana" | "quinzena" | "mes";
const PERIODOS: { key: Exclude<Periodo, "todos" | "ontem">; label: string; dias: number }[] = [
  { key: "hoje", label: "hoje", dias: 0 },       // 0 = dia-calendário (via ehHoje), não 24h móveis
  { key: "semana", label: "semana", dias: 7 },
  { key: "quinzena", label: "quinzena", dias: 15 },
  { key: "mes", label: "mês", dias: 30 },
];
// data-calendário BRT de um ISO (YYYY-MM-DD)
function diaBRT(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function ehOntem(iso: string): boolean {
  const ontem = new Date(Date.now() - 3 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
  return diaBRT(iso) === ontem;
}
function dentroPeriodo(iso: string | null, periodo: Periodo): boolean {
  if (periodo === "todos") return true;
  if (!iso) return false; // prospecção sem data não entra em nenhuma janela
  if (periodo === "hoje") return ehHoje(iso);
  if (periodo === "ontem") return ehOntem(iso);
  const dias = periodo === "semana" ? 7 : periodo === "quinzena" ? 15 : 30;
  return Date.now() - new Date(iso).getTime() <= dias * 86400000;
}

export default function Page() {
  const [cards, setCards] = useState<Card[]>([]);
  type TplTot = { hoje: number; ontem: number; semana: number; quinzena: number; mes: number };
  const [templatesTotais, setTemplatesTotais] = useState<Record<string, TplTot>>({});
  const [templatesAutoTotais, setTemplatesAutoTotais] = useState<Record<string, TplTot>>({});
  const [disparos, setDisparos] = useState<Record<string, string>>({});
  // cores dos vendedores vindas da carteira_config (via API) — pra vendedor novo não exigir código
  const [vendCores, setVendCores] = useState<Record<string, string>>({});
  // totais do cabeçalho de Pedido Emitido: por carteira -> por período -> {total, vendas}
  const [vendasTotais, setVendasTotais] = useState<Record<string, Record<string, { total: number; vendas: number }>>>({});
  // cards de Pedido Emitido (vêm das views de faturamento, 1 linha por cliente por período)
  const [pedidoCards, setPedidoCards] = useState<Card[]>([]);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [atualizado, setAtualizado] = useState<string>("—");
  const [erro, setErro] = useState<string>("");
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [sessao, setSessao] = useState<{ role: string; carteira: string | null } | null>(null);
  const [checando, setChecando] = useState(true);
  // reconhecimento otimista: cliente_id -> quando o vendedor abriu a conversa (epoch ms)
  const [acks, setAcks] = useState<Record<string, number>>({});
  // scroll infinito: quantos cards renderizar por coluna (col.key -> quantidade)
  const [visiveisPorColuna, setVisiveisPorColuna] = useState<Record<string, number>>({});
  // filtro de período por coluna (col.key -> período). Ausente = "todos".
  const [periodoPorColuna, setPeriodoPorColuna] = useState<Record<string, Periodo>>({});
  const [syncRodando, setSyncRodando] = useState(false);
  const [syncUltimo, setSyncUltimo] = useState<string | null>(null);
  const [syncConclusao, setSyncConclusao] = useState<string | null>(null);
  const [disparandoSync, setDisparandoSync] = useState(false);
  const [agora, setAgora] = useState(Date.now());

  async function load() {
    try {
      const r = await fetch("/api/funil", { cache: "no-store" });
      const j = await r.json();
      if (j.error) { setErro(j.error); return; }
      setErro("");
      setCards(j.cards ?? []);
      setTemplatesTotais(j.templatesTotais ?? {});
      setTemplatesAutoTotais(j.templatesAutoTotais ?? {});
      setDisparos(j.disparos ?? {});
      setVendasTotais(j.vendasTotais ?? {});
      setPedidoCards(j.pedidoCards ?? []);
      setVendCores(Object.fromEntries((j.vendedores ?? []).map((v: any) => [v.slug, v.cor]).filter((e: any[]) => e[0] && e[1])));
      setAtualizado(new Date().toLocaleTimeString("pt-BR"));
    } catch (e: any) {
      setErro(String(e?.message ?? e));
    } finally {
      setCarregando(false);
    }
  }

  async function recontatar(clienteId: string, clienteNome: string) {
    // dispara direto ao clicar (sem confirmação); o botão já desativa após enviar
    setEnviando(clienteId);
    try {
      const r = await fetch("/api/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId }),
      });
      // lê como texto e tenta JSON — evita "Unexpected end of JSON input" em corpo vazio
      const txt = await r.text();
      let j: any = {};
      try { j = txt ? JSON.parse(txt) : {}; } catch { j = { error: txt || `HTTP ${r.status} (resposta vazia)` }; }
      if (!r.ok || j.error) alert("Falha ao enviar: " + (j.error ?? `HTTP ${r.status}`));
      else await load();
    } catch (e: any) {
      alert("Erro: " + (e?.message ?? e));
    } finally {
      setEnviando(null);
    }
  }

  async function sair() {
    await fetch("/api/logout", { method: "POST" });
    setSessao(null);
  }

  // resposta livre inline no card (só coluna Negociação — dentro da janela de 24h)
  const [respostaTexto, setRespostaTexto] = useState<Record<string, string>>({});
  // mensagens enviadas otimisticamente (aparecem na hora, antes do próximo sync do ETL
  // confirmar); somem sozinhas quando o mesmo texto chega pela sincronização real.
  const [pendentes, setPendentes] = useState<Record<string, Msg[]>>({});
  const [enviandoResposta, setEnviandoResposta] = useState<string | null>(null);
  async function enviarResposta(clienteId: string) {
    const texto = (respostaTexto[clienteId] ?? "").trim();
    if (!texto) return;
    setEnviandoResposta(clienteId);
    try {
      const r = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, texto }),
      });
      const txt = await r.text();
      let j: any = {};
      try { j = txt ? JSON.parse(txt) : {}; } catch { j = { error: txt || `HTTP ${r.status} (resposta vazia)` }; }
      if (!r.ok || j.error) { alert("Falha ao enviar: " + (j.error ?? `HTTP ${r.status}`)); return; }
      setRespostaTexto((prev) => ({ ...prev, [clienteId]: "" }));
      // mostra na hora, como última mensagem do chat, sem esperar o ETL confirmar
      setPendentes((prev) => ({
        ...prev,
        [clienteId]: [...(prev[clienteId] ?? []), { c: texto, e: "operator", t: new Date().toISOString() }],
      }));
      await load();
    } catch (e: any) {
      alert("Erro: " + (e?.message ?? e));
    } finally {
      setEnviandoResposta(null);
    }
  }

  async function checarSync() {
    try {
      const r = await fetch("/api/sync-etl", { cache: "no-store" });
      if (!r.ok) return; // 401/403 (não-admin) — ignora silenciosamente, botão nem aparece
      const j = await r.json();
      setSyncRodando(!!j.running);
      setSyncUltimo(j.lastRun?.createdAt ?? null);
      setSyncConclusao(j.lastRun?.conclusion ?? null);
    } catch {}
  }

  // "1:05" enquanto roda; usa o tempoRelativo (definido acima) pra quando já terminou
  function duracao(desdeIso: string): string {
    const s = Math.max(0, Math.floor((agora - new Date(desdeIso).getTime()) / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  async function dispararSync() {
    setDisparandoSync(true);
    try {
      const r = await fetch("/api/sync-etl", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { alert("Falha ao disparar sincronização: " + (j.error ?? `HTTP ${r.status}`)); return; }
      setSyncRodando(true);
      // o run leva ~2-3min pra aparecer como concluído; recarrega o board depois
      setTimeout(load, 60_000);
    } catch (e: any) {
      alert("Erro: " + (e?.message ?? e));
    } finally {
      setDisparandoSync(false);
    }
  }

  const ACKS_KEY = "crm_acks";
  // Cliente da fila de prospecção (nunca conversou) não tem conversa no RD Conversas
  // pra abrir — abre o WhatsApp direto pelo telefone. Cliente normal: abre o RD
  // Conversas E "reconhece" o card (silencia o alerta na hora).
  function abrirConversa(c: Card) {
    if (ehSintetico(c)) {
      if (c.telefone) window.open(`https://wa.me/${c.telefone.replace(/\D/g, "")}`, "whatsapp");
      return;
    }
    const agoraMs = Date.now();
    setAcks((prev) => {
      const prox = { ...prev, [c.cliente_id]: agoraMs };
      try { localStorage.setItem(ACKS_KEY, JSON.stringify(prox)); } catch {}
      return prox;
    });
    window.open(`${URL_CHAT}/${c.cliente_id}`, "rdconversas");
  }

  // checa a sessão ao montar + carrega acks salvos (limpa os antigos)
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(ACKS_KEY) || "{}");
      const corte = Date.now() - 24 * 3600 * 1000; // descarta acks com +24h
      const limpos: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && v > corte) limpos[k] = v;
      setAcks(limpos);
      localStorage.setItem(ACKS_KEY, JSON.stringify(limpos));
    } catch {}
    fetch("/api/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setSessao(s))
      .catch(() => setSessao(null))
      .finally(() => setChecando(false));
  }, []);

  // carrega o board só quando autenticado
  useEffect(() => {
    if (!sessao) return;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [sessao]);

  // status do ETL (só admin) — dá polling pra saber se já tem um run em andamento
  // (inclusive disparado por outra pessoa/via gh CLI), pra não deixar clicar à toa.
  useEffect(() => {
    if (sessao?.role !== "admin") return;
    checarSync();
    const t = setInterval(checarSync, 15000);
    return () => clearInterval(t);
  }, [sessao]);

  // relógio vivo só enquanto um run está rodando, pra mostrar "rodando há 0:47"
  useEffect(() => {
    if (!syncRodando) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [syncRodando]);

  const vendedores = useMemo(
    () => [...new Set(cards.map((c) => c.vendedor).filter(Boolean))].sort(),
    [cards]
  );
  const visiveis = useMemo(() => {
    let r = filtro === "todos" ? cards : cards.filter((c) => c.vendedor === filtro);
    const q = busca.trim().toLowerCase();
    if (q) r = r.filter((c) => (c.cliente ?? "").toLowerCase().includes(q));
    return r;
  }, [cards, filtro, busca]);
  // cards de pedido_emitido (das views de faturamento), filtrados por vendedor + busca.
  // Cada cliente tem 1 linha por período; a coluna escolhe pelo período ativo.
  const pedidoVisiveis = useMemo(() => {
    let r = filtro === "todos" ? pedidoCards : pedidoCards.filter((c) => c.vendedor === filtro);
    const q = busca.trim().toLowerCase();
    if (q) r = r.filter((c) => (c.cliente ?? "").toLowerCase().includes(q));
    return r;
  }, [pedidoCards, filtro, busca]);

  // troca de filtro/busca/período muda o conjunto exibido -> volta cada coluna pro lote inicial
  useEffect(() => { setVisiveisPorColuna({}); }, [filtro, busca, periodoPorColuna]);

  // clica num chip de período da coluna: liga aquele período; clicar de novo no ativo desliga (volta pra "todos")
  function toggleColuna(colKey: string, p: Periodo) {
    setPeriodoPorColuna((prev) => ({ ...prev, [colKey]: (prev[colKey] ?? "todos") === p ? "todos" : p }));
  }
  // dropdown global: aplica o mesmo período a TODAS as colunas de uma vez
  function setPeriodoGlobal(p: Periodo) {
    const next: Record<string, Periodo> = {};
    for (const col of COLUNAS) next[col.key] = p;
    setPeriodoPorColuna(next);
  }
  // valor exibido no dropdown: o período comum a todas as colunas, ou "misto" se divergem
  const periodoGlobal: Periodo | "misto" = useMemo(() => {
    const vals = COLUNAS.map((c) => periodoPorColuna[c.key] ?? "todos");
    return vals.every((v) => v === vals[0]) ? vals[0] : "misto";
  }, [periodoPorColuna]);

  // scroll infinito: perto do fim da coluna, libera mais um lote
  function aoRolarColuna(e: React.UIEvent<HTMLDivElement>, colKey: string, total: number) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 300) return;
    setVisiveisPorColuna((prev) => {
      const atual = prev[colKey] ?? LOTE_INICIAL;
      if (atual >= total) return prev;
      return { ...prev, [colKey]: Math.min(atual + LOTE_INCREMENTO, total) };
    });
  }
  // período dos contadores de template = o do dropdown global; "misto"/"todos" -> mês
  const perTpl: keyof TplTot = (periodoGlobal === "misto" || periodoGlobal === "todos") ? "mes" : periodoGlobal;
  const rotuloTpl = perTpl === "mes" ? "mês" : perTpl;
  const somaTpl = (m: Record<string, TplTot>) =>
    filtro === "todos"
      ? Object.values(m).reduce((a, v) => a + (v[perTpl] ?? 0), 0)
      : (m[filtro]?.[perTpl] ?? 0);
  const tplHoje = somaTpl(templatesTotais);
  const tplAutoHoje = somaTpl(templatesAutoTotais);

  const chip = (label: string, val: string, cor?: string) => {
    const ativo = filtro === val;
    return (
      <button
        key={val}
        onClick={() => setFiltro(val)}
        style={{
          display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
          background: ativo ? RD.cyanSoft : RD.surface,
          color: ativo ? "#0b7fb0" : RD.gray,
          border: `1px solid ${ativo ? "#bfe6f8" : RD.border}`,
          borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600,
        }}
      >
        {cor && <span style={{ width: 8, height: 8, borderRadius: 8, background: cor }} />}
        {label}
      </button>
    );
  };

  if (checando) return <div style={{ padding: 40, color: RD.gray, fontSize: 14 }}>Verificando sessão…</div>;
  if (!sessao) return <Login onLogin={setSessao} />;

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ height: 3, background: RD.wine }} />
      {/* Top bar */}
      <div style={{ background: RD.surface, borderBottom: `1px solid ${RD.border}`, padding: "0 26px" }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", minHeight: 56, padding: "6px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <Logo size={26} />
          <b style={{ fontSize: 16, letterSpacing: 0.2 }}>CRM</b>
          <span style={{ marginLeft: 8, color: RD.cyan, fontWeight: 700, fontSize: 14, borderBottom: `2px solid ${RD.cyan}`, paddingBottom: 18, marginTop: 20 }}>Negociações</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, background: RD.wineSoft, border: "1px solid #e8d8e1", borderRadius: 20, padding: "4px 13px 4px 5px" }}>
            <span style={{ width: 22, height: 22, borderRadius: 20, background: RD.wine, color: RD.cream, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>
              {sessao.role === "admin" ? "A" : cap(sessao.carteira ?? "?").charAt(0)}
            </span>
            <b style={{ fontSize: 12.5, color: RD.wine }}>{sessao.role === "admin" ? "Admin" : cap(sessao.carteira ?? "")}</b>
          </span>
          {sessao.role === "admin" && (
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <button
                onClick={dispararSync}
                disabled={disparandoSync || syncRodando}
                title="Dispara o ETL manualmente (RD Conversas → clientes/mensagens), sem esperar o cron de 20min"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  cursor: disparandoSync || syncRodando ? "wait" : "pointer",
                  background: syncRodando ? "#eaf6fd" : RD.surface,
                  color: syncRodando ? "#0b7fb0" : RD.gray,
                  border: `1px solid ${syncRodando ? "#bfe6f8" : RD.border}`,
                  borderRadius: 8, padding: "5px 12px", fontSize: 12.5, fontWeight: 600,
                }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: 7,
                  background: syncRodando ? "#0ea3dc" : RD.grayLight,
                  animation: syncRodando ? "pulse-alert 1.1s ease-in-out infinite" : "none",
                }} />
                {disparandoSync ? "Disparando…" : syncRodando ? "Sincronizando…" : "Sincronizar agora"}
              </button>
              {/* legenda pendurada abaixo do botão (absoluta, não empurra o botão do alinhamento) */}
              <span style={{ position: "absolute", top: "100%", left: 2, marginTop: 2, fontSize: 10, color: syncConclusao === "failure" ? "#dc2626" : RD.grayLight, whiteSpace: "nowrap" }}>
                RD Conversas → clientes e mensagens
                {syncRodando && syncUltimo ? ` · rodando há ${duracao(syncUltimo)}` : null}
                {!syncRodando && syncUltimo ? ` · última: ${tempoRelativo(syncUltimo)}` : null}
                {!syncRodando && syncConclusao === "failure" ? " · falhou" : null}
              </span>
            </div>
          )}
          <button
            onClick={sair}
            style={{ background: "transparent", border: `1px solid ${RD.border}`, color: RD.gray, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            Sair
          </button>
        </div>
      </div>

      <main style={{ padding: "18px 26px", maxWidth: 1440, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="🔍  Buscar negociação..."
            style={{
              width: 240, padding: "8px 12px", fontSize: 13, color: RD.navy,
              background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 8, outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {chip("Todos", "todos")}
            {vendedores.map((v) => chip(cap(v), v, vendCores[v] ?? CoresVendedor[v] ?? RD.grayLight))}
          </div>
          <select
            value={periodoGlobal}
            onChange={(e) => setPeriodoGlobal(e.target.value as Periodo)}
            title="Aplica o período a todas as etapas de uma vez"
            style={{
              padding: "7px 10px", fontSize: 12.5, fontWeight: 600, color: RD.gray,
              background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 8, cursor: "pointer", outline: "none",
            }}
          >
            <option value="todos">Período: todos</option>
            <option value="hoje">Período: hoje</option>
            <option value="ontem">Período: ontem</option>
            <option value="semana">Período: semana</option>
            <option value="quinzena">Período: quinzena</option>
            <option value="mes">Período: mês</option>
            {periodoGlobal === "misto" && <option value="misto" disabled>Período: misto</option>}
          </select>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: RD.cyanSoft, border: "1px solid #bfe6f8", borderRadius: 10, padding: "6px 14px" }}>
              <span style={{ fontSize: 10.5, color: "#0b7fb0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>
                Templates {rotuloTpl}
              </span>
              <b style={{ fontSize: 18, color: "#0b7fb0", lineHeight: 1 }}>{tplHoje}</b>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f8e6ec", border: "1px solid #ecc6d2", borderRadius: 10, padding: "6px 14px" }}>
              <span style={{ fontSize: 10.5, color: "#9c1f47", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>
                Automáticos {rotuloTpl}
              </span>
              <b style={{ fontSize: 18, color: "#9c1f47", lineHeight: 1 }}>{tplAutoHoje}</b>
            </div>
            <span style={{ color: RD.gray, fontSize: 12.5 }}>
              {erro ? <span style={{ color: "#e5484d" }}>erro: {erro}</span> : `${visiveis.length} conversas/clientes · ${atualizado}`}
            </span>
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, alignItems: "start" }}>
          {COLUNAS.map((col) => {
            const periodoAtivo = periodoPorColuna[col.key] ?? "todos";
            const ehPedido = col.key === "pedido_emitido";
            // pedido_emitido: cards vêm das views de faturamento (1 linha por período);
            // demais colunas: da vw_funil filtrada por atividade.
            const todosDaEtapa = ehPedido
              ? pedidoVisiveis.filter((c) => c.periodo === "todos")
              : visiveis.filter((c) => c.etapa === col.key);
            let doGrupo = ehPedido
              ? pedidoVisiveis.filter((c) => c.periodo === periodoAtivo)
              : todosDaEtapa.filter((c) => dentroPeriodo(c.ultima_atividade, periodoAtivo));
            if (busca.trim()) {
              // na busca: ordena por data da última mensagem (mais recente primeiro) p/ separar homônimos
              doGrupo = [...doGrupo].sort(
                (a, b) => (new Date(b.ultima_atividade ?? 0).getTime()) - (new Date(a.ultima_atividade ?? 0).getTime())
              );
            } else if (col.key === "tentativa_contato") {
              // botão TEMPLATE disponível = parado >= DIAS_RECONTATO e sem disparo recente.
              // Cards com template já enviado ("aguardando resposta") afundam pra BAIXO dos
              // que ainda dá pra disparar -> o topo é sempre um card pronto pra enviar template.
              const podeTemplate = (c: Card) => {
                const ud = disparos[c.cliente_id];
                const disparoRecente = !!ud && diasInativo(ud) < DIAS_RECONTATO;
                return diasInativo(c.ultima_atividade) >= DIAS_RECONTATO && !disparoRecente;
              };
              doGrupo = [...doGrupo].sort((a, b) => {
                const pa = podeTemplate(a), pb = podeTemplate(b);
                if (pa !== pb) return pa ? -1 : 1; // disponível no topo
                // dentro de cada grupo: mais dias parados no topo
                return (new Date(a.ultima_atividade ?? 0).getTime()) - (new Date(b.ultima_atividade ?? 0).getTime());
              });
            } else if (col.key === "ociosos") {
              // ordem decrescente de inatividade: mais dias parados (ou nunca contatado) no topo
              doGrupo = [...doGrupo].sort(
                (a, b) => (new Date(a.ultima_atividade ?? 0).getTime()) - (new Date(b.ultima_atividade ?? 0).getTime())
              );
            }
            // cards com alerta (cliente esperando >10 min, e não reconhecido) vão pro TOPO
            const emAlerta = (c: Card) => ehAlerta(c, acks[c.cliente_id]);
            doGrupo = [...doGrupo.filter(emAlerta), ...doGrupo.filter((c) => !emAlerta(c))];
            // contagem por período. pedido_emitido: nº de clientes com venda no período
            // (linhas daquele período na view); demais: por atividade.
            const contaPeriodo = (p: Periodo) => ehPedido
              ? pedidoVisiveis.filter((c) => c.periodo === p).length
              : todosDaEtapa.filter((c) => dentroPeriodo(c.ultima_atividade, p)).length;
            return (
              <section key={col.key} style={{ background: RD.colHeader, borderRadius: 10, border: `1px solid ${RD.border}`, overflow: "hidden" }}>
                <div style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 4, height: 15, borderRadius: 3, background: RD.wine }} />
                    <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.4, color: RD.wine, textTransform: "uppercase", textShadow: "0 1px 0 rgba(255,255,255,0.6)" }}>
                      {col.titulo}
                    </span>
                    <span style={{ color: RD.gray, fontSize: 13, fontWeight: 700 }}>({todosDaEtapa.length})</span>
                    {col.key === "pedido_emitido" && (() => {
                      // total R$ + qtd de vendas (bruto, "quem lançou") no período ativo.
                      // escopo pelo vendedor filtrado (Todos = soma das carteiras).
                      const per = periodoAtivo; // hoje/ontem/semana/quinzena/mes/todos
                      const vt = filtro === "todos" ? Object.values(vendasTotais) : (vendasTotais[filtro] ? [vendasTotais[filtro]] : []);
                      const totalR = vt.reduce((a, v) => a + (v[per]?.total ?? 0), 0);
                      const totalQ = vt.reduce((a, v) => a + (v[per]?.vendas ?? 0), 0);
                      return (
                        <span style={{ marginLeft: "auto", display: "inline-flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.15 }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: "#15803d", whiteSpace: "nowrap" }}>Total: {moedaBR(totalR)}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#15803d", whiteSpace: "nowrap" }}>{totalQ} vendas</span>
                        </span>
                      );
                    })()}
                  </div>
                  <div title={col.subLong} style={{ marginTop: 3, fontSize: 10, lineHeight: 1.3, color: RD.grayLight, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {col.sub}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 3 }}>
                    {PERIODOS.map((per) => {
                      const ativo = periodoAtivo === per.key;
                      return (
                        <button
                          key={per.key}
                          onClick={() => toggleColuna(col.key, per.key)}
                          title={ativo ? `Mostrando só ${per.label} — clique pra ver todos` : `Filtrar ${col.titulo} por ${per.label}`}
                          style={{
                            flex: 1, minWidth: 0, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
                            background: ativo ? col.cor : RD.surface,
                            color: ativo ? "#fff" : RD.gray,
                            border: `1px solid ${ativo ? col.cor : RD.border}`,
                            borderRadius: 6, padding: "3px 2px", fontWeight: 700,
                            whiteSpace: "nowrap", overflow: "hidden",
                            boxShadow: "0 1px 1px rgba(16,32,64,0.04)",
                          }}
                        >
                          <span style={{ fontSize: 8.5 }}>{cap(per.label)}</span>
                          <b style={{ fontSize: 10.5, lineHeight: 1, color: ativo ? "#fff" : RD.navy }}>{contaPeriodo(per.key)}</b>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  onScroll={(e) => aoRolarColuna(e, col.key, doGrupo.length)}
                  style={{ padding: "4px 8px 10px", display: "flex", flexDirection: "column", gap: 8, maxHeight: "76vh", overflowY: "auto" }}
                >
                  {carregando && doGrupo.length === 0 ? (
                    <p style={{ color: RD.grayLight, fontSize: 13, padding: 8 }}>carregando…</p>
                  ) : doGrupo.length === 0 ? (
                    <p style={{ color: RD.grayLight, fontSize: 13, padding: 8 }}>Nenhuma negociação</p>
                  ) : (
                    <>
                    {doGrupo.slice(0, visiveisPorColuna[col.key] ?? LOTE_INICIAL).map((c) => {
                      const prospeccao = ehProspeccao(c);
                      const vendaSemConversa = ehVendaSemConversa(c);
                      // ociosos: por definição já passou da janela de 24h, precisa de template — igual
                      // a tentativa_contato "parada", exceto pra prospecção (nunca teve cliente_id do RD,
                      // não dá pra disparar template automático, só abrir WhatsApp manual).
                      const recontactar = !prospeccao
                        && ((col.key === "tentativa_contato" && diasInativo(c.ultima_atividade) >= DIAS_RECONTATO)
                          || col.key === "ociosos");
                      const ultimoDisparo = (col.key === "tentativa_contato" || col.key === "ociosos") ? disparos[c.cliente_id] : undefined;
                      // disparo há MENOS de 4 dias => botão desativado (aguardando resposta).
                      // após 4 dias sem resposta, o botão TEMPLATE volta a liberar.
                      const disparoRecente = !!ultimoDisparo && diasInativo(ultimoDisparo) < DIAS_RECONTATO;
                      const alerta = ehAlerta(c, acks[c.cliente_id]);
                      // até 3 últimas mensagens (mais antiga em cima, recente embaixo). Fallback:
                      // se a coluna nova (migration 0005) ainda não veio, usa só a última.
                      const msgsRaw: Msg[] = (c.ultimas_mensagens && c.ultimas_mensagens.length)
                        ? c.ultimas_mensagens
                        : (c.ultima_mensagem ? [{ c: c.ultima_mensagem, e: c.ultima_enviada_por, t: c.ultima_atividade }] : []);
                      // pendentes (enviadas agora, aguardando o ETL confirmar) somem sozinhas
                      // quando o mesmo texto já chegou pela sincronização real (evita duplicar)
                      const pend = (pendentes[c.cliente_id] ?? []).filter(
                        (p) => !msgsRaw.some((m) => m.e === p.e && (m.c ?? "").trim() === (p.c ?? "").trim())
                      );
                      const msgsChrono = [...[...msgsRaw].reverse(), ...pend]; // cronológico, mais recente por último
                      return (
                        <article
                          key={c.cliente_id}
                          onClick={() => abrirConversa(c)}
                          title={prospeccao ? "Abrir WhatsApp com este número (cliente nunca contatado)" : "Abrir conversa no RD Conversas (reconhece e silencia o alerta)"}
                          style={{
                            cursor: "pointer", height: col.key === "negociacao" ? CARD_ALTURA + 34 : CARD_ALTURA, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden",
                            background: disparoRecente ? "#fffdf5" : recontactar ? "#fdf7fb" : RD.surface,
                            border: `1px solid ${disparoRecente ? "#f3ddad" : recontactar ? "#ecdae4" : RD.border}`,
                            borderLeft: `3px solid ${disparoRecente ? "#e08a00" : recontactar ? "#57163f" : RD.border}`,
                            borderRadius: 8, padding: "11px 13px", boxShadow: "0 1px 2px rgba(16,32,64,0.05)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                            <span style={{ width: 11, height: 11, borderRadius: 3, background: col.cor }} />
                            <span style={{ fontSize: 11.5, color: RD.gray, fontWeight: 600 }}>{col.status}</span>
                            {alerta && (
                              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, color: "#dc2626", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 8, background: "#dc2626", animation: "pulse-alert 1.1s ease-in-out infinite" }} />
                                AGUARDA RESPOSTA
                              </span>
                            )}
                            {disparoRecente ? (
                              <span
                                title={`Template enviado ${tempoRelativo(ultimoDisparo!)} atrás — botão liberado após ${DIAS_RECONTATO} dias sem resposta`}
                                style={{
                                  marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5,
                                  background: "#fff7e6", color: "#b76e00", border: "1px solid #f3ddad",
                                  borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800, letterSpacing: 0.2,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: 6, background: "#e08a00" }} />
                                AGUARDANDO RESPOSTA
                              </span>
                            ) : recontactar ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); recontatar(c.cliente_id, c.cliente); }}
                                disabled={enviando === c.cliente_id}
                                title="Enviar template (mensagem real no WhatsApp)"
                                style={{
                                  marginLeft: "auto", cursor: enviando === c.cliente_id ? "wait" : "pointer",
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  background: "#f8e6ec", color: "#9c1f47", border: "1px solid #ecc6d2",
                                  borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: 6, background: "#b02350" }} />
                                {enviando === c.cliente_id ? "ENVIANDO…" : "TEMPLATE"}
                              </button>
                            ) : col.key === "pedido_emitido" ? (
                              <span
                                title={`Faturado no período (nota fiscal, líquido)`}
                                style={{
                                  marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5,
                                  background: "#e7f6ec", color: "#15803d", border: "1px solid #bfe6cd",
                                  borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 800, letterSpacing: 0.2,
                                }}
                              >
                                {moedaBR(c.venda_valor ?? 0)}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: RD.navy, lineHeight: 1.3 }}>
                            {c.cliente}
                          </div>
                          {/* área de mensagens: rola tipo chat, sempre com a mais recente embaixo
                              à vista (auto-scroll pro fim a cada render — ref inline dispara sempre) */}
                          <div
                            ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
                            onClick={(e) => e.stopPropagation()}
                            onWheel={(e) => e.stopPropagation()}
                            style={{ flex: 1, minHeight: 0, marginTop: 6, display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" }}
                          >
                            {msgsChrono.length > 0 ? (
                              msgsChrono.map((m, i) => {
                                const doCliente = m.e === "customer";
                                const ultima = i === msgsChrono.length - 1;
                                return (
                                  <div key={i} style={{ display: "flex", justifyContent: doCliente ? "flex-start" : "flex-end" }}>
                                    <div
                                      style={{
                                        maxWidth: "94%",
                                        background: doCliente ? "#f2f4f7" : "#eaf6fd",
                                        border: `1px solid ${doCliente ? "#e4e8ee" : "#cfeafb"}`,
                                        borderRadius: 12,
                                        borderTopLeftRadius: doCliente ? 3 : 10,
                                        borderTopRightRadius: doCliente ? 10 : 3,
                                        padding: "3px 8px 2px",
                                        boxShadow: "0 1px 1.5px rgba(16,32,64,0.05)",
                                      }}
                                    >
                                      <div style={{ fontSize: 10.5, lineHeight: 1.25, color: RD.navy, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                        {limpaMsg(m.c)}
                                      </div>
                                      {ultima && (m.t ?? c.ultima_atividade) && (
                                        <div style={{ marginTop: 1, textAlign: "right", fontSize: 9, color: RD.grayLight, letterSpacing: 0.2 }}>
                                          {dataHora(m.t ?? c.ultima_atividade)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            ) : vendaSemConversa ? (
                              <div style={{ fontSize: 11, color: RD.grayLight }}>
                                venda faturada · sem conversa · {c.telefone ?? "s/ tel"}
                              </div>
                            ) : prospeccao ? (
                              <div style={{ fontSize: 11, color: RD.grayLight }}>
                                nunca contatado · {c.telefone ?? "sem telefone"}
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: RD.grayLight }}>
                                última msg · {dataHora(c.ultima_atividade)}
                              </div>
                            )}
                          </div>
                          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: RD.gray, fontWeight: 600 }}>
                              <span style={{ width: 7, height: 7, borderRadius: 7, background: vendCores[c.vendedor] ?? CoresVendedor[c.vendedor] ?? RD.grayLight }} />
                              {cap(c.vendedor)}
                            </span>
                            {!prospeccao && (
                              <span style={{ color: recontactar ? "#d92d20" : RD.grayLight, fontSize: 11, fontWeight: recontactar ? 700 : 400 }}>
                                · {tempoRelativo(c.ultima_atividade)}{recontactar ? " parado" : ""}
                              </span>
                            )}
                          </div>
                          {col.key === "negociacao" && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{ marginTop: 5, display: "flex", gap: 4 }}
                            >
                              <input
                                value={respostaTexto[c.cliente_id] ?? ""}
                                onChange={(e) => setRespostaTexto((prev) => ({ ...prev, [c.cliente_id]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarResposta(c.cliente_id); } }}
                                placeholder="Responder (msg livre, 24h)…"
                                disabled={enviandoResposta === c.cliente_id}
                                style={{
                                  flex: 1, minWidth: 0, fontSize: 11, padding: "5px 8px",
                                  border: `1px solid ${RD.border}`, borderRadius: 6, outline: "none", color: RD.navy,
                                }}
                              />
                              <button
                                onClick={() => enviarResposta(c.cliente_id)}
                                disabled={enviandoResposta === c.cliente_id || !(respostaTexto[c.cliente_id] ?? "").trim()}
                                title="Enviar mensagem livre (só funciona dentro da janela de 24h do WhatsApp)"
                                style={{
                                  cursor: enviandoResposta === c.cliente_id ? "wait" : "pointer",
                                  background: RD.cyan, color: "#fff", border: "none",
                                  borderRadius: 6, padding: "0 10px", fontSize: 11, fontWeight: 700,
                                }}
                              >
                                {enviandoResposta === c.cliente_id ? "…" : "➤"}
                              </button>
                            </div>
                          )}
                        </article>
                      );
                    })}
                    {(visiveisPorColuna[col.key] ?? LOTE_INICIAL) < doGrupo.length && (
                      <div style={{ textAlign: "center", color: RD.grayLight, fontSize: 11, fontWeight: 600, padding: "6px 0 2px" }}>
                        role pra ver mais ({doGrupo.length - (visiveisPorColuna[col.key] ?? LOTE_INICIAL)})
                      </div>
                    )}
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (s: { role: string; carteira: string | null }) => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function entrar(e: any) {
    e.preventDefault();
    setErro("");
    setEntrando(true);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, pass }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? "Falha no login"); return; }
      const s = await fetch("/api/session").then((x) => x.json());
      onLogin(s);
    } catch (err: any) {
      setErro(String(err?.message ?? err));
    } finally {
      setEntrando(false);
    }
  }

  const inp = { padding: "9px 12px", border: `1px solid ${RD.border}`, borderRadius: 8, fontSize: 13, outline: "none" } as const;

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 320, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 14, padding: 28, boxShadow: "0 8px 30px rgba(16,32,64,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <Logo size={32} />
          <b style={{ fontSize: 17 }}>CRM · Funil</b>
        </div>

        <button
          disabled
          title="Disponível após configurar o Google no Supabase Auth"
          style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${RD.border}`, background: "#f7f9fb", color: RD.grayLight, fontWeight: 600, fontSize: 13, cursor: "not-allowed", marginBottom: 6 }}
        >
          Entrar com Google (em breve)
        </button>
        <div style={{ textAlign: "center", color: RD.grayLight, fontSize: 11, margin: "12px 0" }}>— ou admin —</div>

        <form onSubmit={entrar} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Usuário" autoFocus style={inp} />
          <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Senha" type="password" style={inp} />
          {erro && <div style={{ color: "#e5484d", fontSize: 12 }}>{erro}</div>}
          <button type="submit" disabled={entrando} style={{ padding: 10, borderRadius: 8, border: "none", background: RD.wine, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            {entrando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
