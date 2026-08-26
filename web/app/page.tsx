"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import OrcamentoFlutuante from "./OrcamentoFlutuante";
import { Conversa } from "./conversa";
import { TEMAS, temaSalvo, salvarTema, type TemaId } from "../lib/tema";
import { prepararTrecho, segundosFmt, SEGUNDOS_PARABENS } from "../lib/musicaParabens";

type Msg = { c: string | null; e: string | null; t?: string | null }; // conteudo, enviada_por, criada_em
type Card = {
  cliente_id: string;
  cliente: string;
  vendedor: string | null;   // NULO = sem dono (fila de não atribuídos, 0100)
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
  sem_cadastro?: boolean;          // só existe no RD Conversas, sem cadastro no WinThor (lead de marketing)
  rd_cliente_id?: string | null;   // (prospecção) id do contato no RD, se já existir lá — abre o RD em vez do WhatsApp
  codcli?: number | null;          // código do cliente no WinThor — abre a Consulta Clientes (botão "C")
  rca_num?: number | null;         // quem FATURA: RCA oficial no WinThor (migration 0093)
  carteira_rd?: string | null;     // quem ATENDE: carteira no RD Conversas (migration 0093)
  ciclo?: {                            // motor preditivo (análise de ciclo de compra)
    tipo: string | null;               // RECOMPRA/ATRASO/EXPANSAO/RECUPERACAO/REATIVACAO
    pct_ciclo: number | null;          // % do ciclo decorrido (100 = na hora, >110 = atrasado)
    score: number | null;             // urgência 0-100
    ciclo_medio: number | null;        // dias médios entre compras
    dias_ausente: number | null;
    tendencia: string | null;
    acao: string | null;              // LIGAR HOJE / WHATSAPP
  } | null;
};

function moedaBR(v: number | null): string {
  if (v == null) return "";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

// --- Selo de atribuição: quem ATENDE x quem FATURA -------------------------------
// São conceitos distintos (§25.3) e podem divergir de forma legítima: o IS/ISR atende
// cliente cujo RCA pertence ao GC ou a um vendedor de fora. Medido em 22/08/2026: das
// 445 divergências, só 116 são entre pessoas do MESMO time — essas sim quase sempre
// são transferência feita de um lado só. Alarmar nas 445 treinaria a equipe a ignorar
// o selo, então o vermelho é reservado ao caso acionável.
// O card já é posicionado pelo RCA (a vw_funil é RCA-first); o selo não move nada,
// só torna visível a discordância que antes só existia numa view que ninguém abria.
type SeloAtrib = { texto: string; title: string; cor: string; bg: string; borda: string };
type VendMeta = Record<string, { rca: number | null; time: string | null }>;

function seloAtribuicao(c: Card, vendMeta: VendMeta): SeloAtrib | null {
  const rca = c.rca_num ?? null;
  const rd = c.carteira_rd ?? null;
  if (rca == null && !rd) return null; // nada a comparar (ex.: card de venda pura)

  const NEUTRO = { cor: "#64748b", bg: "#f1f5f9", borda: "#dbe3ec" };
  const AVISO = { cor: "#b45309", bg: "#fff7ed", borda: "#f0c987" };
  const ALERTA = { cor: "#b91c1c", bg: "#fef2f2", borda: "#f3b4b4" };
  const texto = `RCA ${rca ?? "—"} · RD ${rd ?? "—"}`;

  // sem vínculo com o WinThor: a compra deste cliente não credita RCA nenhum
  if (rca == null) {
    return { texto, ...AVISO, title: `Atendido por ${rd} no RD Conversas, mas sem vínculo com o WinThor (sem CPF ou sem cadastro). A compra dele não credita RCA nenhum — pedir o CPF na conversa resolve.` };
  }
  // sem carteira no RD: contato de prospecção, nunca atendido
  if (!rd) {
    return { texto, ...NEUTRO, title: `RCA ${rca} no WinThor. Ainda sem carteira no RD Conversas — este contato nunca teve atendimento.` };
  }

  const donoDoRca = Object.entries(vendMeta).find(([, m]) => m.rca === rca);
  const slugRca = donoDoRca?.[0] ?? null;
  if (slugRca === rd) {
    return { texto, ...NEUTRO, title: `Quem atende no RD (${rd}) e quem fatura no WinThor (RCA ${rca}) são a mesma pessoa.` };
  }

  const timeRd = vendMeta[rd]?.time ?? null;
  const timeRca = donoDoRca?.[1].time ?? null;
  if (timeRd && timeRca && timeRd === timeRca) {
    return { texto, ...ALERTA, title: `DIVERGÊNCIA A CORRIGIR — ${rd} atende no RD Conversas, mas o RCA oficial é ${slugRca} (${rca}). Os dois são do mesmo time (${timeRd}), então quase sempre é transferência feita de um lado só. Avisar a supervisão.` };
  }
  return { texto, ...NEUTRO, title: `${rd} atende no RD Conversas; quem fatura é o RCA ${rca}${slugRca ? ` (${slugRca})` : " — de outro time ou de fora do CRM"}. Comum quando o cliente pertence a outra equipe; não exige correção.` };
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

// O board abre a conversa NO NOSSO CHAT (25/08/2026). Antes mandava para
// `app.tallos.com.br/app/chat/<id>`, o que tirava o vendedor do sistema no
// gesto mais frequente da tela — e, com o RD sendo aposentado, mandava para o
// lugar errado. `/chat?cliente=<id>` seleciona a conversa ao abrir.
const URL_CONSULTA = "https://consultaclientes.muranoprofessional.com.br"; // Consulta Clientes (deep link por ?codcli=)
// código WinThor do cliente (pro botão "C"): coluna codcli, ou parse do cliente_id sintético
function codcliDe(c: Card): number | null {
  if (c.codcli != null && !isNaN(Number(c.codcli))) return Number(c.codcli);
  const id = c.cliente_id ?? "";
  if (typeof id === "string" && (id.startsWith("winthor:") || id.startsWith("venda:"))) {
    const n = Number(id.slice(id.indexOf(":") + 1));
    return isNaN(n) ? null : n;
  }
  return null;
}

// Paleta inspirada no RD Station CRM
// Paleta ativa. Objeto MUTÁVEL de propósito: todo o arquivo lê RD.x na hora de
// renderizar, então trocar o tema é Object.assign(RD, TEMAS[tema]) + re-render
// (feito no início do Page) — sem refatorar as centenas de estilos inline.
// As paletas moram em web/lib/tema.ts ("padrao" = esta de sempre; "murano" =
// Tema 1, identidade visual Murano Professional).
const RD = { ...TEMAS.padrao };

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
  { key: "prospeccao", titulo: "Lista de prospecção", status: "A prospectar", cor: "#8b5cf6", sub: "carteira nunca contatada", subLong: "cliente da carteira (WinThor) que nunca foi atendido por este RCA no RD Conversas",
    regras: "Um card cai aqui quando é cliente da sua carteira (WinThor, pelo RCA atual) que:\n• NUNCA teve conversa com operador no RD Conversas — nunca foi contatado, ou entrou na sua carteira por troca de RCA e ainda não foi abordado por você;\n• E não comprou no mês corrente.\n\nAqui está o resto da carteira que ainda não virou conversa. O selo de ciclo de compra (Na hora / Atrasado…) ajuda a priorizar quem ligar primeiro.\n\nAutomação: ao disparar o 1º template ele vira conversa e migra pra Tentativa de contato; se o cliente responder → Negociação; se comprar no mês → Pedido emitido." },
  { key: "ociosos", titulo: "Ociosos", status: "Parado", cor: "#94a3b8", sub: "parado +24h", subLong: "cliente falou por último há +24h — só um template reabre a conversa",
    regras: "Um card cai aqui quando:\n• o cliente já conversou e falou por último há +24h sem novo template (a janela de 24h do WhatsApp fechou — só um template reabre a conversa);\n• uma venda de mês anterior expirou e não houve nada depois.\n\n(Quem nunca foi contatado agora fica na Lista de prospecção, não aqui.)\n\nAutomação: sai daqui sozinho quando você dispara um template (→ Tentativa de contato) ou o cliente responde (→ Negociação)." },
  { key: "tentativa_contato", titulo: "Tentativa de contato", status: "Nova", cor: "#1a7fee", sub: "template enviado, sem resposta", subLong: "você mandou template, aguardando a 1ª resposta do cliente",
    regras: "Um card cai aqui quando:\n• a última mensagem real é do operador E é um template (você disparou e aguarda a 1ª resposta).\n\nAutomações:\n• cliente responde → Negociação;\n• passou +24h sem resposta → Ociosos;\n• parado +4 dias → o botão TEMPLATE reaparece pra reenviar." },
  { key: "negociacao", titulo: "Negociação", status: "Em andamento", cor: "#0e9fd6", sub: "conversa ativa (últimas 24h)", subLong: "troca ativa dentro da janela de 24h",
    regras: "Um card cai aqui quando:\n• há troca ativa nas últimas 24h (o cliente falou por último há menos de 24h, ou você falou fora de template).\n\nAutomações:\n• alerta vermelho 'AGUARDA RESPOSTA' se o cliente falou por último e você está +10 min sem responder (some ao clicar no card, volta se ele mandar msg nova);\n• passou 24h sem novo template → Ociosos;\n• fechou venda no mês → Pedido Emitido." },
  { key: "pedido_emitido", titulo: "Pedido emitido", status: "Vendida", cor: "#16a34a", sub: "comprou nos últimos 7 dias", subLong: "venda nos últimos 7 dias; depois o card volta a se mover",
    regras: "Um card cai aqui quando há nota fiscal faturada no WinThor nos ÚLTIMOS 7 DIAS (fuso de Brasília).\n\nAutomações:\n• 7 dias após a compra o card SAI daqui sozinho e volta a se mover como os outros — Lista de prospecção, ou a etapa que a conversa dele indicar;\n• o total R$ do cabeçalho continua sendo o do MÊS (é o número comercial que o time acompanha), então ele não coincide com esta coluna de propósito." },
] as const;

// categorias do motor de ciclo de compra (análise preditiva, tipo_oportunidade)
const CICLO_CATS: { key: string; label: string; cor: string; bg: string; desc: string }[] = [
  { key: "RECOMPRA",    label: "Na hora",      cor: "#b91c1c", bg: "#fdecec", desc: "no ponto de comprar de novo (ciclo ~ cumprido)" },
  { key: "ATRASO",      label: "Atrasado",     cor: "#b45309", bg: "#fdf0dc", desc: "passou do ciclo de compra" },
  { key: "EXPANSAO",    label: "Expansão",     cor: "#0e7490", bg: "#dcf3f7", desc: "comprando mais — hora de ofertar" },
  { key: "RECUPERACAO", label: "Recuperação",  cor: "#7c3aed", bg: "#efe8fd", desc: "caindo — resgatar antes de perder" },
  { key: "REATIVACAO",  label: "Reativação",   cor: "#475569", bg: "#eef2f6", desc: "parou de comprar — reativar" },
];
const CICLO_LABEL: Record<string, { label: string; cor: string; bg: string }> =
  Object.fromEntries(CICLO_CATS.map((c) => [c.key, { label: c.label, cor: c.cor, bg: c.bg }]));

// filtro por TEMPO PARADO (dias de inatividade efetiva do card). Infinity = nunca contatado.
const PARADO_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: "0-3",   label: "Até 3 dias",       min: 0,        max: 3 },
  { key: "4-7",   label: "4 a 7 dias",       min: 4,        max: 7 },
  { key: "8-15",  label: "8 a 15 dias",      min: 8,        max: 15 },
  { key: "16-30", label: "16 a 30 dias",     min: 16,       max: 30 },
  { key: "30+",   label: "Mais de 30 dias",  min: 31,       max: Infinity },
  { key: "nunca", label: "Nunca contatado",  min: Infinity, max: Infinity },
];

const PROD_PER_LABEL: Record<string, string> = {
  hoje: "hoje", ontem: "ontem", semana: "última semana", quinzena: "última quinzena",
  mes: "último mês", "2m": "últimos 2 meses", "3m": "últimos 3 meses", "4m": "últimos 4 meses",
  "5m": "últimos 5 meses", "6m": "últimos 6 meses", ano: "último ano",
};

// Produto da vw_produtos_venda: nome + quantos clientes já compraram + o
// agrupamento do WinThor, que é o que define a "linha" no filtro cross-sell.
type Produto = {
  codprod: number; produto: string; clientes: number;
  departamento: string | null; secao: string | null; marca: string | null;
};
type EscopoLinha = "departamento" | "secao" | "marca";
const ESCOPO_LABEL: Record<EscopoLinha, string> = {
  departamento: "Linha (departamento)", secao: "Seção", marca: "Marca",
};
// períodos da compra DA LINHA (o alvo é sempre "nunca", no histórico inteiro).
// wth_itens começa em jan/2025 — é esse o alcance de "todo o histórico".
const NC_PERIODOS: [string, string][] = [
  ["mes", "último mês"], ["2m", "últimos 2 meses"], ["3m", "últimos 3 meses"],
  ["6m", "últimos 6 meses"], ["ano", "último ano"], ["2anos", "últimos 2 anos"],
  ["todos", "todo o histórico"],
];
const NC_PER_LABEL: Record<string, string> = Object.fromEntries(NC_PERIODOS);

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
// a data mais recente entre duas ISO (ex.: última msg do RD vs. disparo de template nosso)
function maisRecenteISO(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
function diasInativo(iso: string | null): number {
  if (!iso) return Infinity; // nunca contatado — "mais parado que qualquer outro"
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
// janela de 24h do WhatsApp: passou disso sem interação, a conversa "fecha" e só aceita template
function dentro24h(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 24 * 3600 * 1000;
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
// Aceita null de propósito. Desde a 0100 o board recebe cards SEM DONO (a fila
// de não atribuídos), e `vendedor` chega nulo — a versão anterior fazia
// `s.charAt(0)` direto e derrubava a tela inteira com "Cannot read properties
// of null". Mesma implementação que o /chat já usava.
const cap = (s: any) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");

const LOTE_INICIAL = 100;   // cards renderizados de cada coluna ao carregar
const LOTE_INCREMENTO = 100; // quanto libera a cada vez que chega perto do fim da lista
const CARD_ALTURA = 168;    // altura fixa do card (simétrico) — nome em até 2 linhas + selos + bolhas

// Períodos de atividade. "hoje/semana/quinzena/mês" são janelas cumulativas; "ontem"
// é o dia-calendário anterior (só no dropdown, não nos chips). "todos" = sem filtro.
// Cards de prospecção (ultima_atividade null) só aparecem em "todos".
// "7d" só existe na coluna Pedido emitido: é o universo dela desde a 0104 (o
// card sai 7 dias após a compra), não uma opção do dropdown de período.
type Periodo = "todos" | "hoje" | "ontem" | "semana" | "quinzena" | "mes" | "7d";
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
  // tema visual (padrao / murano "Tema 1" / escuro "Dark"). Carrega do
  // localStorage após montar (SSR não tem window) e aplica mutando RD antes do
  // render dos filhos.
  const [tema, setTema] = useState<TemaId>("padrao");
  const [temaMenuAberto, setTemaMenuAberto] = useState(false);
  useEffect(() => { setTema(temaSalvo()); }, []);
  Object.assign(RD, TEMAS[tema]);
  const TEMA_ROTULO: Record<TemaId, string> = { padrao: "Padrão", murano: "Tema 1", escuro: "Dark" };
  const escolherTema = (t: TemaId) => { salvarTema(t); setTema(t); setTemaMenuAberto(false); };
  // mobile: uma linha só que circula entre os três
  const alternarTema = () => {
    const ordem: TemaId[] = ["padrao", "murano", "escuro"];
    escolherTema(ordem[(ordem.indexOf(tema) + 1) % ordem.length]);
  };

  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [disparos, setDisparos] = useState<Record<string, string>>({});
  // cores dos vendedores vindas da carteira_config (via API) — pra vendedor novo não exigir código
  const [vendCores, setVendCores] = useState<Record<string, string>>({});
  // rca_num + time por carteira: o selo de atribuição precisa saber de quem é cada RCA
  // e se as duas pontas são do mesmo time (migration 0093)
  const [vendMeta, setVendMeta] = useState<VendMeta>({});
  // totais do cabeçalho de Pedido Emitido: por carteira -> por período -> {total, vendas}
  const [vendasTotais, setVendasTotais] = useState<Record<string, Record<string, { total: number; vendas: number }>>>({});
  // cards de Pedido Emitido (vêm das views de faturamento, 1 linha por cliente por período)
  const [pedidoCards, setPedidoCards] = useState<Card[]>([]);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [atualizado, setAtualizado] = useState<string>("—");
  const [erro, setErro] = useState<string>("");
  const [carregando, setCarregando] = useState(true);
  const [isMobile, setIsMobile] = useState(false); // < 768px -> layout empilhado (colunas viram faixas)
  const [filtro, setFiltro] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [sessao, setSessao] = useState<{ role: string; carteira: string | null; papeis?: string[]; email?: string | null } | null>(null);
  const [trocandoPapel, setTrocandoPapel] = useState(false);
  const [papelMenuAberto, setPapelMenuAberto] = useState(false);
  const [periodoMenuAberto, setPeriodoMenuAberto] = useState(false);
  const [rankingMenuAberto, setRankingMenuAberto] = useState(false);
  const [orcamentoAberto, setOrcamentoAberto] = useState(false);
  const [menuMobile, setMenuMobile] = useState(false); // gaveta de navegação no celular
  // card ampliado (lupa): janela arrastável com o histórico rolável + resposta
  const [cardZoom, setCardZoom] = useState<Card | null>(null);

  const [zoomPos, setZoomPos] = useState({ x: 80, y: 74 });
  const zoomDrag = useRef<{ dx: number; dy: number } | null>(null);
  const [zoomSyncing, setZoomSyncing] = useState(false);
  // ↻ do card: muda de valor e a <Conversa> recarrega a thread sem remontar
  // (remontar apagaria o texto que a pessoa está escrevendo)
  const [zoomRefresh, setZoomRefresh] = useState(0);
  // meta do dia do Ranking (admin define aqui; o Ranking só lê)
  const [metaModal, setMetaModal] = useState(false);
  const [metaAtual, setMetaAtual] = useState<number | null>(null);
  const [metaValor, setMetaValor] = useState("");
  const [metaSalvando, setMetaSalvando] = useState(false);
  const [verAntModal, setVerAntModal] = useState(false);
  const [dataAnterior, setDataAnterior] = useState("");
  const [desfileStatus, setDesfileStatus] = useState<"" | "enviando" | "ok" | "erro">("");
  const [parabensModal, setParabensModal] = useState(false);
  const [parabensNome, setParabensNome] = useState("");
  const [parabensEnviando, setParabensEnviando] = useState(false);
  const [parabensMsg, setParabensMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  // música da tela de parabéns do Ranking (admin sobe o arquivo; as TVs só leem)
  const [musicaModal, setMusicaModal] = useState(false);
  const [musica, setMusica] = useState<{ url: string; nome: string; segundos: number; cortado: boolean; origem?: string; atualizado_em: string } | null>(null);
  const [musicaLoad, setMusicaLoad] = useState(false);
  const [musicaEnviando, setMusicaEnviando] = useState<"" | "preparando" | "enviando">("");
  const [musicaMsg, setMusicaMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [musicaInicio, setMusicaInicio] = useState("0:00");
  const musicaInputRef = useRef<HTMLInputElement>(null);
  const [metasIndModal, setMetasIndModal] = useState(false);
  const [metasInd, setMetasInd] = useState<{ slug: string; nome: string; meta: number }[]>([]);
  const [metasIndLoad, setMetasIndLoad] = useState(false);
  const [metasIndSalv, setMetasIndSalv] = useState(false);
  const [checando, setChecando] = useState(true);
  // reconhecimento otimista: cliente_id -> quando o vendedor abriu a conversa (epoch ms)
  const [acks, setAcks] = useState<Record<string, number>>({});
  // scroll infinito: quantos cards renderizar por coluna (col.key -> quantidade)
  const [visiveisPorColuna, setVisiveisPorColuna] = useState<Record<string, number>>({});
  // filtro de período por coluna (col.key -> período). Ausente = "todos".
  const [periodoPorColuna, setPeriodoPorColuna] = useState<Record<string, Periodo>>({});
  const [syncRodando, setSyncRodando] = useState(false);
  const [syncPausado, setSyncPausado] = useState(false);
  const [pausandoSync, setPausandoSync] = useState(false);
  // tooltip de regras da etapa: position:fixed via JS (escapa o overflow:hidden da coluna,
  // que senão corta o balão). Guardamos texto + coords da tela; clampado na borda direita.
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  // filtro por produto: lista de produtos (busca 1x), painel, seleção/período (rascunho)
  // e o filtro aplicado (conjuntos de identificadores dos clientes que compraram).
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [prodPainel, setProdPainel] = useState(false);
  const [prodSel, setProdSel] = useState<number[]>([]);
  const [prodPeriodo, setProdPeriodo] = useState<string>("mes");
  const [prodBusca, setProdBusca] = useState("");
  const [prodCarregando, setProdCarregando] = useState(false);
  const [prodFiltro, setProdFiltro] = useState<{
    clienteIds: Set<string>; codclis: Set<number>; tel8: Set<string>;
    produtos: number[]; periodo: string; total: number;
  } | null>(null);
  // filtro "AINDA NÃO COMPROU" (cross-sell): quem já compra a LINHA do produto
  // mas nunca levou o produto em si. Ex.: já compra outra selagem, nunca comprou
  // A-LIZZ. A linha sai do agrupamento do WinThor (departamento/seção/marca) e é
  // resolvida aqui mesmo, com a lista de produtos que já está em memória.
  const [ncPainel, setNcPainel] = useState(false);
  const [ncAlvo, setNcAlvo] = useState<number | null>(null);      // produto que ele NÃO comprou
  const [ncEscopo, setNcEscopo] = useState<EscopoLinha>("departamento");
  const [ncLinhaSel, setNcLinhaSel] = useState<number[] | null>(null); // null = a linha inteira
  const [ncPeriodo, setNcPeriodo] = useState<string>("ano");      // período da compra DA LINHA
  const [ncBusca, setNcBusca] = useState("");
  const [ncVerLinha, setNcVerLinha] = useState(false);
  const [ncCarregando, setNcCarregando] = useState(false);
  const [ncFiltro, setNcFiltro] = useState<{
    clienteIds: Set<string>; codclis: Set<number>; tel8: Set<string>;
    alvo: number; linha: number[]; escopo: EscopoLinha; periodo: string; total: number;
  } | null>(null);
  // filtro por cidade: mesma mecânica do de produto, porém SEM período (cidade é fixa).
  // A seleção guarda a chave normalizada (cidade_norm); o rótulo bonito vem de `cidades`.
  const [cidades, setCidades] = useState<{ cidade_norm: string; cidade: string; clientes: number }[]>([]);
  const [cidPainel, setCidPainel] = useState(false);
  const [cidSel, setCidSel] = useState<string[]>([]);
  const [cidBusca, setCidBusca] = useState("");
  const [cidCarregando, setCidCarregando] = useState(false);
  const [cidFiltro, setCidFiltro] = useState<{
    clienteIds: Set<string>; codclis: Set<number>; tel8: Set<string>;
    cidades: string[]; total: number;
  } | null>(null);
  // filtro MELHORES CLIENTES: top N por ticket médio dos últimos 3 meses (90d),
  // entre quem comprou no período. Mesma mecânica de identificadores do produto.
  const [melhoresPainel, setMelhoresPainel] = useState(false);
  const [melhoresCarregando, setMelhoresCarregando] = useState(false);
  const [melhoresFiltro, setMelhoresFiltro] = useState<{
    clienteIds: Set<string>; codclis: Set<number>; tel8: Set<string>; qtd: number; total: number;
  } | null>(null);
  // filtro por ciclo de compra (categorias do motor preditivo). "URGENTE" = ação LIGAR HOJE.
  const [cicloSel, setCicloSel] = useState<string[]>([]);
  const [cicloPainel, setCicloPainel] = useState(false);
  // Motor de ciclo ligado? Vem do /api/funil (crm_config, migration 0097).
  // Começa em `true` para a tela não piscar sem o selo antes da 1ª resposta —
  // o mesmo estado em que o interruptor nasce no banco.
  const [cicloAtivo, setCicloAtivo] = useState(true);
  const [semCadFiltro, setSemCadFiltro] = useState(false); // mostrar só leads sem cadastro no WinThor
  const [paradoSel, setParadoSel] = useState<string[]>([]); // filtro por tempo parado (buckets de dias)
  // Os 8 filtros passaram a morar dentro de um único dropdown. Fora dele ficam só as
  // AÇÕES (baixar o Excel), que não filtram nada — misturar as duas coisas numa
  // barra só era o que deixava o cabeçalho ilegível. O disparo em massa saiu do
  // board: virou uma campanha declarada em Administração → Disparo em massa.
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [paradoPainel, setParadoPainel] = useState(false);
  // lixeira (descartar cliente final arrastando o card)
  const [arrastando, setArrastando] = useState<Card | null>(null);
  const [sobreLixeira, setSobreLixeira] = useState(false);
  const [lixeiraAberta, setLixeiraAberta] = useState(false);
  const [descartados, setDescartados] = useState<any[]>([]);
  const [baixando, setBaixando] = useState(false); // gerando relatório Excel
  const [syncUltimo, setSyncUltimo] = useState<string | null>(null);
  const [syncConclusao, setSyncConclusao] = useState<string | null>(null);
  const [disparandoSync, setDisparandoSync] = useState(false);
  const [agora, setAgora] = useState(Date.now());

  // GUARDA DE IN-FLIGHT + COALESCÊNCIA.
  // /api/funil pagina três views e cruza wth_faturamento (~3,4s medido). Antes o
  // board chamava load() num setInterval de 5s sem trava: se a query passasse de
  // 5s as requisições se sobrepunham e empilhavam, cada uma re-executando as
  // agregações inteiras na instância do Supabase.
  // Agora: se já há um load em voo, marca `pendente` e roda UMA vez ao terminar.
  // Nunca empilha e nunca perde uma atualização que chegou no meio do caminho.
  const loadEmVoo = useRef(false);
  const loadPendente = useRef(false);

  async function load() {
    if (loadEmVoo.current) { loadPendente.current = true; return; }
    loadEmVoo.current = true;
    try {
      const r = await fetch("/api/funil", { cache: "no-store" });
      const j = await r.json();
      if (j.error) { setErro(j.error); return; }
      setErro("");
      setCards(j.cards ?? []);
      // rota antiga (deploy em andamento) não manda o campo: mantém ligado.
      setCicloAtivo(j.ciclo_ativo !== false);
      setDisparos(j.disparos ?? {});
      setVendasTotais(j.vendasTotais ?? {});
      setPedidoCards(j.pedidoCards ?? []);
      setVendCores(Object.fromEntries((j.vendedores ?? []).map((v: any) => [v.slug, v.cor]).filter((e: any[]) => e[0] && e[1])));
      setVendMeta(Object.fromEntries((j.vendedores ?? []).filter((v: any) => v?.slug).map((v: any) => [v.slug, { rca: v.rca_num ?? null, time: v.time ?? null }])));
      setAtualizado(new Date().toLocaleTimeString("pt-BR"));
    } catch (e: any) {
      setErro(String(e?.message ?? e));
    } finally {
      setCarregando(false);
      loadEmVoo.current = false;
      if (loadPendente.current) { loadPendente.current = false; void load(); }
    }
  }

  async function recontatar(clienteId: string, clienteNome: string) {
    // dispara direto ao clicar (sem confirmação); o botão já desativa após enviar
    setEnviando(clienteId);
    try {
      // Sem template_id: o servidor resolve pelo padrão do sistema (crm_templates.padrao
      // e, no ramo do RD, o TEMPLATE_RECONTATO_ID). A escolha "por navegador" que existia
      // no menu Automáticos saiu junto com ele — e já era inerte, porque só valia para
      // template com rd_template_id, e não há nenhum cadastrado. Quem quiser trocar o
      // padrão faz em Administração → Templates, que vale para todo mundo.
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
      else {
        await load(); // mostra o disparo/AGUARDANDO na hora
        // sync em segundo plano: puxa a mensagem real do RD e atualiza a data do card
        // (sem esperar o ciclo do ETL). Não trava o botão — atualiza quando terminar.
        fetch("/api/sync-cliente", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cliente_id: clienteId }),
        }).then(() => load()).catch(() => {});
      }
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

  // troca o papel ativo (multi-papel: Romulo admin|vendedor, Joas admin|home). O servidor
  // valida contra os papéis do e-mail logado e reescreve o cookie; recarregamos a sessão.
  async function trocarPapel(papel: string) {
    if (papel === sessao?.role) return;
    setTrocandoPapel(true);
    try {
      const r = await fetch("/api/trocar-papel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ papel }),
      });
      const j = await r.json();
      if (!r.ok) { alert("Não foi possível trocar de papel: " + (j?.error ?? r.status)); return; }
      const s = await fetch("/api/session").then((x) => x.json());
      setSessao(s);
    } catch (e: any) {
      alert("Erro ao trocar de papel: " + (e?.message ?? e));
    } finally {
      setTrocandoPapel(false);
    }
  }

  // abre o modal da meta do dia carregando o valor atual (bi_config.meta_dia)
  async function abrirMeta() {
    setMetaModal(true);
    try {
      const j = await fetch("/api/meta").then((r) => r.json());
      const m = Number(j?.meta ?? 0) || 0;
      setMetaAtual(m);
      setMetaValor(m ? String(m) : "");
    } catch { setMetaAtual(null); }
  }
  async function salvarMeta(valorFixo?: number) {
    // valorFixo=0 -> "none" (oculta o quadro da meta no Ranking)
    const m = valorFixo != null ? Math.max(0, Math.round(valorFixo)) : Math.max(0, Math.round(Number(metaValor.replace(/[^\d]/g, "")) || 0));
    setMetaSalvando(true);
    try {
      const r = await fetch("/api/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meta: m }) });
      const j = await r.json();
      if (!r.ok) { alert("Não foi possível salvar a meta: " + (j?.error ?? r.status)); return; }
      setMetaAtual(j.meta);
      setMetaModal(false);
    } catch (e: any) {
      alert("Erro ao salvar a meta: " + (e?.message ?? e));
    } finally {
      setMetaSalvando(false);
    }
  }

  // abre a aba do Ranking (reusa a MESMA aba pelo nome "ranking_murano"; se já aberta, só
  // re-renderiza com a nova config). dia = 'AAAA-MM-DD' abre um dia passado; sem dia = ao vivo.
  const RANKING_URL = "https://murano-ranking-vendas.vercel.app/";
  function abrirRanking(dia?: string) {
    window.open(RANKING_URL + (dia ? "?dia=" + encodeURIComponent(dia) : ""), "ranking_murano");
  }
  // Dispara o desfile (tela de parabéns de cada venda de hoje, 10s cada) em TODAS as TVs:
  // grava o comando (bi_config.desfile_comando) e os painéis pegam pelo poll ~6s.
  async function dispararDesfile() {
    setDesfileStatus("enviando");
    try {
      const r = await fetch("/api/ranking/desfile", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setDesfileStatus("erro"); alert("Não foi possível disparar o desfile: " + (j?.error ?? r.status)); return; }
      setDesfileStatus("ok");
      setTimeout(() => setDesfileStatus(""), 5000);
    } catch (e: any) {
      setDesfileStatus("erro");
      alert("Falha ao disparar o desfile: " + (e?.message ?? e));
    }
  }
  // Mostra a tela de parabéns da venda de hoje de um cliente (por nome) em todas as TVs.
  function abrirParabens() { setParabensNome(""); setParabensMsg(null); setParabensModal(true); }
  async function enviarParabens() {
    const nome = parabensNome.trim();
    if (nome.length < 2) { setParabensMsg({ ok: false, texto: "Digite ao menos 2 letras do nome." }); return; }
    setParabensEnviando(true); setParabensMsg(null);
    try {
      const r = await fetch("/api/ranking/parabens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setParabensMsg({ ok: false, texto: j?.error ?? ("Erro " + r.status) }); return; }
      setParabensMsg({ ok: true, texto: `🎉 Parabéns de ${j.cliente} (venda de ${j.vendedor}, R$ ${Number(j.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) enviada às TVs.` });
    } catch (e: any) {
      setParabensMsg({ ok: false, texto: "Falha: " + (e?.message ?? e) });
    } finally {
      setParabensEnviando(false);
    }
  }
  // Metas individuais do dia: cadastro por vendedor. Ao bater, o painel mostra "BATEU A META".
  async function abrirMetasInd() {
    setMetasIndModal(true); setMetasIndLoad(true);
    try {
      const j = await fetch("/api/ranking/metas-individuais").then((r) => r.json());
      setMetasInd(Array.isArray(j?.metas) ? j.metas : []);
    } catch { setMetasInd([]); }
    finally { setMetasIndLoad(false); }
  }
  async function salvarMetasInd() {
    setMetasIndSalv(true);
    try {
      const r = await fetch("/api/ranking/metas-individuais", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metas: metasInd }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert("Não foi possível salvar as metas: " + (j?.error ?? r.status)); return; }
      setMetasIndModal(false);
    } catch (e: any) {
      alert("Erro ao salvar as metas: " + (e?.message ?? e));
    } finally {
      setMetasIndSalv(false);
    }
  }
  // Preview da tela "BATEU A META" de um vendedor nas TVs (usa o valor digitado, mesmo sem salvar).
  async function preverMetaBatida(m: { slug: string; nome: string; meta: number }) {
    if (!m.meta) { alert(`Defina uma meta para ${m.nome} antes de ver a tela.`); return; }
    try {
      const r = await fetch("/api/ranking/metabatida", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: m.slug, nome: m.nome, meta: m.meta }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert("Não foi possível exibir a tela: " + (j?.error ?? r.status)); return; }
    } catch (e: any) {
      alert("Falha ao exibir a tela: " + (e?.message ?? e));
    }
  }

  // ---- Música da tela de parabéns ------------------------------------------
  // O admin escolhe um MP3/MP4; o corte de 20s acontece AQUI no navegador
  // (lib/musicaParabens.ts) — de um .mp4 só o áudio é decodificado, o vídeo é
  // descartado. Sobe o trecho, e os painéis passam a tocá-lo no lugar do samba
  // sintetizado. Sem arquivo configurado, o som padrão volta sozinho.
  const MUSICA_MAX_ORIGEM = 40 * 1024 * 1024;
  async function abrirMusica() {
    setMusicaModal(true); setMusicaMsg(null); setMusicaLoad(true);
    try {
      const j = await fetch("/api/ranking/musica").then((r) => r.json());
      setMusica(j?.musica ?? null);
    } catch { setMusica(null); }
    finally { setMusicaLoad(false); }
  }
  // aceita "80", "1:20" ou "1:20,5" -> segundos
  function inicioEmSegundos(txt: string) {
    const t = txt.trim().replace(",", ".");
    if (!t) return 0;
    const p = t.split(":").map((x) => Number(x) || 0);
    const s = p.length > 1 ? p[0] * 60 + p[1] : p[0];
    return Math.max(0, s);
  }
  async function enviarMusica(file: File) {
    if (file.size > MUSICA_MAX_ORIGEM) {
      setMusicaMsg({ ok: false, texto: `Arquivo muito grande (${(file.size / 1048576).toFixed(1)} MB). Máximo 40 MB.` });
      return;
    }
    setMusicaMsg(null); setMusicaEnviando("preparando");
    try {
      const inicio = inicioEmSegundos(musicaInicio);
      const trecho = await prepararTrecho(file, inicio);
      const fd = new FormData();
      if (trecho) {
        fd.append("audio", new File([trecho.blob], "parabens.wav", { type: "audio/wav" }), "parabens.wav");
        fd.append("cortado", "1");
      } else {
        // navegador não decodificou (codec exótico): sobe o original e QUEM corta
        // os 20s é o player do painel. Aí o limite do bucket (20 MB) vale.
        if (file.size > 20 * 1024 * 1024) {
          setMusicaMsg({ ok: false, texto: "Não consegui extrair o áudio deste arquivo neste navegador, e ele é grande demais (máx. 20 MB) para subir inteiro. Converta para MP3 e tente de novo." });
          return;
        }
        fd.append("audio", file, file.name);
        fd.append("cortado", "0");
      }
      fd.append("nome", file.name);
      fd.append("origem", file.type || "");
      setMusicaEnviando("enviando");
      const r = await fetch("/api/ranking/musica", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMusicaMsg({ ok: false, texto: j?.error ?? ("Erro " + r.status) }); return; }
      setMusica(j.musica);
      setMusicaMsg({
        ok: true,
        texto: trecho
          ? `🎵 Pronto — ${segundosFmt(trecho.segundos)} de “${file.name}”${trecho.temVideo ? " (só o áudio; o vídeo foi descartado)" : ""}. Já vale na próxima venda.`
          : `🎵 Enviado “${file.name}”. Não deu para cortar aqui, então o painel corta em ${SEGUNDOS_PARABENS}s na hora de tocar.`,
      });
    } catch (e: any) {
      setMusicaMsg({ ok: false, texto: "Falha: " + (e?.message ?? e) });
    } finally {
      setMusicaEnviando("");
      if (musicaInputRef.current) musicaInputRef.current.value = ""; // permite reenviar o mesmo arquivo
    }
  }
  async function removerMusica() {
    if (!confirm("Voltar ao som padrão (samba sintetizado) na tela de parabéns?")) return;
    setMusicaEnviando("enviando"); setMusicaMsg(null);
    try {
      const r = await fetch("/api/ranking/musica", { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMusicaMsg({ ok: false, texto: j?.error ?? ("Erro " + r.status) }); return; }
      setMusica(null);
      setMusicaMsg({ ok: true, texto: "Som padrão restaurado." });
    } catch (e: any) {
      setMusicaMsg({ ok: false, texto: "Falha: " + (e?.message ?? e) });
    } finally { setMusicaEnviando(""); }
  }

  // abre o card ampliado (lupa). Quem busca e rola a conversa agora é o
  // componente <Conversa>, que usa a mesma rota do /chat.
  function abrirZoom(c: Card) {
    setCardZoom(c);
    try { const w = window.innerWidth; setZoomPos({ x: Math.max(20, Math.round(w / 2 - 330)), y: 70 }); } catch {}
  }
  // atualiza SÓ esta conversa: puxa do RD as mensagens que faltam (item 3) e recarrega o histórico.
  // Mostra o resultado na tela (não precisa de DevTools pra diagnosticar).
  async function atualizarZoom() {
    if (!cardZoom || zoomSyncing) return;
    setZoomSyncing(true);
    try {
      const r = await fetch("/api/sync-cliente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cliente_id: cardZoom.cliente_id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) alert("Não consegui puxar do RD (item 3): " + (j?.error ?? `HTTP ${r.status}`) + "\n\nEle recarrega o que já está no banco mesmo assim.");
      setZoomRefresh((n) => n + 1);
    } catch (e: any) { alert("Erro ao atualizar: " + (e?.message ?? e)); }
    finally { setZoomSyncing(false); }
  }
  // ↻ direto no card (mesma função do card ampliado): puxa do RD as mensagens que faltam
  // desta conversa e recarrega o board. Manual (1 clique = 1 fetch) e desabilitado enquanto
  // roda, para não repetir chamada e não pesar na cota do RD.
  const [syncingCards, setSyncingCards] = useState<Record<string, boolean>>({});
  async function atualizarCard(clienteId: string) {
    if (!clienteId || clienteId.includes(":") || syncingCards[clienteId]) return;
    setSyncingCards((p) => ({ ...p, [clienteId]: true }));
    try {
      await fetch("/api/sync-cliente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cliente_id: clienteId }) });
      await load();
    } catch { /* silencioso: o load() abaixo já reflete o que houver no banco */ }
    finally { setSyncingCards((p) => { const n = { ...p }; delete n[clienteId]; return n; }); }
  }
  const zoomOnDown = (e: { clientX: number; clientY: number }) => {
    zoomDrag.current = { dx: e.clientX - zoomPos.x, dy: e.clientY - zoomPos.y };
    const move = (ev: MouseEvent) => {
      if (!zoomDrag.current) return;
      const x = Math.max(-560, Math.min(ev.clientX - zoomDrag.current.dx, window.innerWidth - 60));
      const y = Math.max(0, Math.min(ev.clientY - zoomDrag.current.dy, window.innerHeight - 40));
      setZoomPos({ x, y });
    };
    const up = () => { zoomDrag.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

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
      setSyncPausado(!!j.paused);
      setSyncUltimo(j.lastRun?.createdAt ?? null);
      setSyncConclusao(j.lastRun?.conclusion ?? null);
    } catch {}
  }
  async function togglePausaSync(pausar: boolean) {
    setPausandoSync(true);
    try {
      const r = await fetch("/api/sync-etl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: pausar ? "pausar" : "retomar" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { alert("Falha: " + (j.error ?? `HTTP ${r.status}`)); return; }
      setSyncPausado(pausar);
      if (pausar) setSyncRodando(false);
      checarSync();
    } catch (e: any) { alert("Erro: " + (e?.message ?? e)); }
    finally { setPausandoSync(false); }
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
      // prospecção: o card é `winthor:<codcli>` e não tem thread. Se existe um
      // contato de verdade por trás (`rd_cliente_id`, casado por telefone),
      // abre a conversa dele; senão, o WhatsApp cru pelo número.
      if (c.rd_cliente_id) { router.push(`/chat?cliente=${encodeURIComponent(c.rd_cliente_id)}`); return; }
      if (c.telefone) window.open(`https://wa.me/${c.telefone.replace(/\D/g, "")}`, "whatsapp");
      return;
    }
    const agoraMs = Date.now();
    setAcks((prev) => {
      const prox = { ...prev, [c.cliente_id]: agoraMs };
      try { localStorage.setItem(ACKS_KEY, JSON.stringify(prox)); } catch {}
      return prox;
    });
    // Mesma aba: board e chat são o mesmo app, então navegar é instantâneo e o
    // botão voltar funciona. Abrir em aba nova fazia sentido quando o destino
    // era outro sistema.
    router.push(`/chat?cliente=${encodeURIComponent(c.cliente_id)}`);
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

  // ATUALIZAÇÃO DO BOARD — Realtime, não polling.
  //
  // Antes: setInterval(load, 5000) POR ABA. Com 7 vendedores logados eram ~84
  // reconstruções completas do funil por minuto, quase todas devolvendo exatamente
  // o mesmo resultado. Agora o Postgres avisa quando `mensagens`/`disparos_template`
  // mudam de verdade (migration 0069) e o board recarrega só nessas horas.
  //
  // A ingestão do RD Conversas continua sendo pull — a API deles não tem webhook
  // (404 confirmado, CLAUDE.md seção 2). O que deixou de ser polling é o trecho
  // Supabase -> navegador, que nunca precisou ser.
  //
  // Canal PÚBLICO: o board autentica por cookie próprio (crm_sessao), não por
  // Supabase Auth, então não existe JWT para validar um canal privado. O payload
  // carrega só o slug da carteira; os dados continuam vindo de /api/funil, que
  // aplica a autorização por carteira no servidor.
  //
  // REDE DE PROTEÇÃO: o poll lento de 60s continua. Se o WebSocket cair, o Realtime
  // for desligado no projeto ou o trigger falhar, o board fica no máximo 1 min
  // defasado em vez de congelar.
  useEffect(() => {
    if (!sessao) return;
    load();
    const lento = setInterval(load, 60_000);

    let canal: any = null;
    let cancelado = false;
    (async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) return; // sem env -> fica só o poll de 60s
      try {
        const { createBrowserClient } = await import("@supabase/ssr");
        if (cancelado) return;
        const supa = createBrowserClient(url, anon);
        canal = supa
          .channel("board")
          .on("broadcast", { event: "mudou" }, (msg: any) => {
            // vendedor só recarrega quando a PRÓPRIA carteira mexe; admin/home veem tudo.
            // Fail-open de propósito: se o payload vier num formato inesperado, recarrega
            // — errar para o lado de atualizar demais é melhor que congelar o board.
            const cart = msg?.payload?.carteira ?? msg?.payload?.payload?.carteira ?? null;
            if (cart && sessao.carteira && cart !== sessao.carteira) return;
            load(); // a guarda de in-flight coalesce rajadas do ETL
          })
          .subscribe();
      } catch { /* sem realtime: o poll de 60s cobre */ }
    })();

    return () => {
      cancelado = true;
      clearInterval(lento);
      try { canal?.unsubscribe(); } catch {}
    };
  }, [sessao]);

  // detecta celular (largura < 768) -> board empilhado com scroll horizontal por faixa
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // AUTO-SYNC DA COLUNA NEGOCIAÇÃO — REMOVIDO DO NAVEGADOR (03/08/2026).
  //
  // Existia aqui um setInterval de 10s que chamava /api/negociacao-sync com até 10
  // cliente_ids, e cada id fazia um fetch COMPLETO de /v2/messages/history + decrypt.
  // Ou seja: até 60 chamadas/min à API do RD POR ABA ABERTA.
  //
  // O teto medido da API do RD é ~48 chamadas/min NO TOTAL (CLAUDE.md 14.5). Uma
  // única aba de vendedor já podia querer mais que o sistema inteiro tem; com 7
  // vendedores logados a demanda chegava a ~420/min contra 48 disponíveis. Era o
  // maior consumidor do recurso mais escasso do projeto — e sem nenhum teto, porque
  // escalava com o número de abas abertas, não com o volume de trabalho real.
  //
  // Foi isso que forçou o ETL a ser throttlado (ETL_SCAN_SLEEP=700, conc=1, ~30/min
  // "para deixar folga") e a existirem os botões Pausar/Retomar. Estrangular o ETL
  // não resolvia: o consumidor do outro lado não tinha limite.
  //
  // ONDE A RESPONSABILIDADE FICOU:
  //   - frescor automático: o fastSweep do ETL já coloca TODOS os cards de negociação
  //     no tier A de todo sweep (src/etl/run.ts, clientesNegociacao) — mesmo trabalho,
  //     feito uma vez só, num lugar só, com orçamento de chamadas controlado;
  //   - o board recebe o resultado por Realtime (migration 0069), sem gastar cota;
  //   - urgência pontual: o ↻ do card ampliado continua chamando /api/sync-cliente.
  //
  // A rota /api/negociacao-sync foi mantida (serve para chamada manual/pontual), mas
  // não é mais chamada em loop. Se algum dia voltar a ser, precisa de coordenação
  // entre abas — senão o problema volta idêntico.

  // lista de produtos p/ o filtro (busca uma vez; ~415 itens)
  useEffect(() => {
    if (!sessao) return;
    fetch("/api/produtos")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.produtos) setProdutos(j.produtos); })
      .catch(() => {});
  }, [sessao]);

  // lista de cidades p/ o filtro (busca uma vez; ~394 itens, ordenadas por nº de clientes)
  useEffect(() => {
    if (!sessao) return;
    fetch("/api/cidades")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.cidades) setCidades(j.cidades); })
      .catch(() => {});
  }, [sessao]);

  // status do ETL (só admin) — dá polling pra saber se já tem um run em andamento
  // (inclusive disparado por outra pessoa/via gh CLI), pra não deixar clicar à toa.
  useEffect(() => {
    if (sessao?.role !== "admin") return;
    checarSync();
    const t = setInterval(checarSync, 15000);
    return () => clearInterval(t);
  }, [sessao]);

  // carrega a meta do dia (só admin) p/ mostrar no botão de Meta
  useEffect(() => {
    if (sessao?.role !== "admin") return;
    fetch("/api/meta").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setMetaAtual(Number(j.meta ?? 0) || 0); }).catch(() => {});
  }, [sessao]);


  // relógio vivo só enquanto um run está rodando, pra mostrar "rodando há 0:47"
  useEffect(() => {
    if (!syncRodando) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [syncRodando]);

  const vendedores = useMemo(
    () => [...new Set(cards.map((c) => c.vendedor).filter((v): v is string => !!v))].sort(),
    [cards]
  );
  // filtro por produto: um card "casa" se o cliente comprou o(s) produto(s) no período.
  // Casamos por qualquer identificador — cliente_id do RD (contato real), codcli (cards
  // winthor:/venda: da prospecção/venda) ou os últimos 8 dígitos do telefone.
  const matchProduto = (c: Card): boolean => {
    if (!prodFiltro) return true;
    const id = c.cliente_id;
    if (typeof id === "string") {
      if (id.startsWith("winthor:") || id.startsWith("venda:")) {
        const cc = Number(id.slice(id.indexOf(":") + 1));
        if (prodFiltro.codclis.has(cc)) return true;
      } else if (prodFiltro.clienteIds.has(id)) return true;
    }
    const t = String(c.telefone ?? "").replace(/\D/g, "").slice(-8);
    if (t.length === 8 && prodFiltro.tel8.has(t)) return true;
    return false;
  };
  // filtro "ainda não comprou": mesma mecânica de identificadores do de produto.
  const matchNaoComprou = (c: Card): boolean => {
    if (!ncFiltro) return true;
    const id = c.cliente_id;
    if (typeof id === "string") {
      if (id.startsWith("winthor:") || id.startsWith("venda:")) {
        const cc = Number(id.slice(id.indexOf(":") + 1));
        if (ncFiltro.codclis.has(cc)) return true;
      } else if (ncFiltro.clienteIds.has(id)) return true;
    }
    if (c.codcli != null && ncFiltro.codclis.has(Number(c.codcli))) return true;
    const t = String(c.telefone ?? "").replace(/\D/g, "").slice(-8);
    if (t.length === 8 && ncFiltro.tel8.has(t)) return true;
    return false;
  };
  // filtro por cidade: um card "casa" se o cliente é da(s) cidade(s) selecionada(s).
  // Mesma lógica de identificadores do filtro de produto.
  const matchCidade = (c: Card): boolean => {
    if (!cidFiltro) return true;
    const id = c.cliente_id;
    if (typeof id === "string") {
      if (id.startsWith("winthor:") || id.startsWith("venda:")) {
        const cc = Number(id.slice(id.indexOf(":") + 1));
        if (cidFiltro.codclis.has(cc)) return true;
      } else if (cidFiltro.clienteIds.has(id)) return true;
    }
    const t = String(c.telefone ?? "").replace(/\D/g, "").slice(-8);
    if (t.length === 8 && cidFiltro.tel8.has(t)) return true;
    return false;
  };
  // filtro melhores clientes: card "casa" por qualquer identificador (igual cidade/produto)
  const matchMelhores = (c: Card): boolean => {
    if (!melhoresFiltro) return true;
    const id = c.cliente_id;
    if (typeof id === "string") {
      if (id.startsWith("winthor:") || id.startsWith("venda:")) {
        const cc = Number(id.slice(id.indexOf(":") + 1));
        if (melhoresFiltro.codclis.has(cc)) return true;
      } else if (melhoresFiltro.clienteIds.has(id)) return true;
    }
    if (c.codcli != null && melhoresFiltro.codclis.has(Number(c.codcli))) return true;
    const t = String(c.telefone ?? "").replace(/\D/g, "").slice(-8);
    if (t.length === 8 && melhoresFiltro.tel8.has(t)) return true;
    return false;
  };
  async function aplicarMelhores(qtd: number) {
    setMelhoresCarregando(true);
    setMelhoresPainel(false);
    try {
      const r = await fetch(`/api/melhores-clientes?qtd=${qtd}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok && j) {
        setMelhoresFiltro({
          clienteIds: new Set<string>(j.clienteIds ?? []),
          codclis: new Set<number>(j.codclis ?? []),
          tel8: new Set<string>(j.tel8 ?? []),
          qtd, total: j.total ?? 0,
        });
      }
    } finally { setMelhoresCarregando(false); }
  }
  // Motor desligado com filtro de ciclo aplicado: os cards vêm sem `ciclo`, e
  // `matchCiclo` esconderia TODOS eles — a tela ficaria vazia sem explicação.
  // Limpar a seleção é o único desfecho honesto.
  useEffect(() => {
    if (!cicloAtivo && cicloSel.length) { setCicloSel([]); setCicloPainel(false); }
  }, [cicloAtivo, cicloSel.length]);

  // filtro por ciclo: dois EIXOS.
  // - "URGENTE" (ligar hoje) é PRIORIDADE, não categoria: refina o resto (E/AND).
  // - as categorias (situação no ciclo) são OR entre si.
  // Ex: só Urgente -> todos que devem ligar hoje (qualquer situação). Urgente + Recuperação
  // -> só os de Recuperação que são "ligar hoje". Nenhuma categoria marcada = qualquer situação.
  const matchCiclo = (c: Card): boolean => {
    if (!cicloSel.length) return true;
    const urgente = cicloSel.includes("URGENTE");
    const cats = cicloSel.filter((s) => s !== "URGENTE");
    if (urgente && c.ciclo?.acao !== "LIGAR HOJE") return false;
    if (cats.length === 0) return true;
    return cats.includes(c.ciclo?.tipo ?? "");
  };
  // filtro por TEMPO PARADO: dias de inatividade EFETIVA (última msg do RD ou disparo
  // nosso, o que for mais recente). Nunca contatado = Infinity (só casa "nunca"). OR entre
  // os buckets marcados.
  const matchParado = (c: Card): boolean => {
    if (!paradoSel.length) return true;
    const d = diasInativo(maisRecenteISO(c.ultima_atividade, disparos[c.cliente_id]));
    return paradoSel.some((k) => {
      const b = PARADO_BUCKETS.find((x) => x.key === k);
      if (!b) return false;
      if (b.key === "nunca") return d === Infinity;
      if (d === Infinity) return false; // nunca contatado só casa o bucket "nunca"
      return d >= b.min && d <= b.max;
    });
  };

  // busca por NOME ou TELEFONE (inclusive só os últimos 8 dígitos). Detecta sozinha: se o
  // texto é só dígitos/símbolos de telefone -> casa por telefone; com letras -> por nome
  // (e ainda tenta telefone/código, caso digite números no meio).
  const matchBusca = (c: Card, q: string, qDig: string, soNum: boolean): boolean => {
    const nome = (c.cliente ?? "").toLowerCase().includes(q);
    const tel = qDig.length >= 4 && String(c.telefone ?? "").replace(/\D/g, "").includes(qDig);
    return soNum ? tel : (nome || tel);
  };

  const visiveis = useMemo(() => {
    let r = filtro === "todos" ? cards : cards.filter((c) => c.vendedor === filtro);
    const q = busca.trim().toLowerCase();
    const qDig = busca.replace(/\D/g, "");
    const soNum = !!busca.trim() && /^[\d\s()+.\-]+$/.test(busca.trim());
    if (busca.trim()) r = r.filter((c) => matchBusca(c, q, qDig, soNum));
    if (prodFiltro) r = r.filter(matchProduto);
    if (ncFiltro) r = r.filter(matchNaoComprou);
    if (cidFiltro) r = r.filter(matchCidade);
    if (melhoresFiltro) r = r.filter(matchMelhores);
    if (cicloSel.length) r = r.filter(matchCiclo);
    if (semCadFiltro) r = r.filter((c) => c.sem_cadastro);
    if (paradoSel.length) r = r.filter(matchParado);
    return r;
  }, [cards, filtro, busca, prodFiltro, ncFiltro, cidFiltro, melhoresFiltro, cicloSel, semCadFiltro, paradoSel, disparos]);
  // cards de pedido_emitido (das views de faturamento), filtrados por vendedor + busca.
  // Cada cliente tem 1 linha por período; a coluna escolhe pelo período ativo.
  const pedidoVisiveis = useMemo(() => {
    let r = filtro === "todos" ? pedidoCards : pedidoCards.filter((c) => c.vendedor === filtro);
    const q = busca.trim().toLowerCase();
    const qDig = busca.replace(/\D/g, "");
    const soNum = !!busca.trim() && /^[\d\s()+.\-]+$/.test(busca.trim());
    if (busca.trim()) r = r.filter((c) => matchBusca(c, q, qDig, soNum));
    if (prodFiltro) r = r.filter(matchProduto);
    if (ncFiltro) r = r.filter(matchNaoComprou);
    if (cidFiltro) r = r.filter(matchCidade);
    if (melhoresFiltro) r = r.filter(matchMelhores);
    if (cicloSel.length) r = r.filter(matchCiclo);
    if (semCadFiltro) r = r.filter((c) => c.sem_cadastro); // pedido nunca é sem_cadastro -> zera a coluna
    if (paradoSel.length) r = r.filter(matchParado);
    return r;
  }, [pedidoCards, filtro, busca, prodFiltro, ncFiltro, cidFiltro, melhoresFiltro, cicloSel, semCadFiltro, paradoSel, disparos]);
  // total da carteira no cabeçalho = funil (conversa+prospecção, sem comprador do mês) +
  // compradores do mês (coluna Pedido emitido). Como são mutuamente exclusivos, a soma
  // dá a carteira inteira sem duplicar.
  const pedidoMesCount = useMemo(
    () => pedidoVisiveis.filter((c) => c.periodo === "7d").length,
    [pedidoVisiveis]
  );
  // "na carteira" = só quem é CADASTRADO no WinThor (decisão de 06/08/2026).
  // Cards sem_cadastro (lead novo, candidato ainda não qualificado) aparecem no
  // board mas não somam aqui; pedido_emitido vem do faturamento, sempre cadastrado.
  const naCarteiraCount = useMemo(
    () => visiveis.filter((c) => !c.sem_cadastro).length + pedidoMesCount,
    [visiveis, pedidoMesCount]
  );
  // base do vendedor (sem os outros filtros) — pra mostrar a contagem de cards que CADA
  // filtro isoladamente traz, dentro da pill (padrão "Sem cadastro (N)").
  const baseVend = useMemo(
    () => (filtro === "todos" ? cards : cards.filter((c) => c.vendedor === filtro)),
    [cards, filtro]
  );
  const semCadTotal = useMemo(() => baseVend.filter((c) => c.sem_cadastro).length, [baseVend]);
  const paradoTotal = useMemo(() => baseVend.filter(matchParado).length, [baseVend, paradoSel, disparos]);
  const cicloTotal = useMemo(() => baseVend.filter(matchCiclo).length, [baseVend, cicloSel]);

  // descrição detalhada dos filtros ativos (pro modal explicar exatamente o que está aplicado)
  const filtrosAtivosTxt = useMemo(() => {
    const parts: string[] = [];
    if (filtro !== "todos") parts.push(`Vendedor: ${cap(filtro)}`);
    if (busca.trim()) parts.push(`Busca: "${busca.trim()}"`);
    if (cicloSel.length) {
      const labels = cicloSel.map((k) => (k === "URGENTE" ? "Urgentes (ligar hoje)" : (CICLO_LABEL[k]?.label ?? k)));
      parts.push(`Ciclo de compra: ${labels.join(", ")}`);
    }
    if (paradoSel.length) {
      const labels = paradoSel.map((k) => PARADO_BUCKETS.find((b) => b.key === k)?.label ?? k);
      parts.push(`Tempo parado: ${labels.join(", ")}`);
    }
    if (prodFiltro) {
      const nomes = prodFiltro.produtos.map((cp) => produtos.find((p) => p.codprod === cp)?.produto).filter(Boolean) as string[];
      parts.push(`Produto: ${nomes.length ? nomes.join(", ") : `${prodFiltro.produtos.length} selecionado(s)`} (${PROD_PER_LABEL[prodFiltro.periodo] ?? prodFiltro.periodo})`);
    }
    if (ncFiltro) {
      const alvo = produtos.find((p) => p.codprod === ncFiltro.alvo)?.produto ?? `cód. ${ncFiltro.alvo}`;
      parts.push(
        `Ainda não comprou: ${alvo} — mas comprou ${ncFiltro.linha.length} produto(s) da mesma ` +
        `${ESCOPO_LABEL[ncFiltro.escopo].toLowerCase()} (${NC_PER_LABEL[ncFiltro.periodo] ?? ncFiltro.periodo})`
      );
    }
    if (cidFiltro) {
      const nomes = cidFiltro.cidades.map((cn) => cidades.find((c) => c.cidade_norm === cn)?.cidade).filter(Boolean) as string[];
      parts.push(`Cidade: ${nomes.length ? nomes.join(", ") : `${cidFiltro.cidades.length} selecionada(s)`}`);
    }
    if (melhoresFiltro) parts.push(`Melhores clientes: top ${melhoresFiltro.qtd} (ticket médio 3 meses)`);
    return parts;
  }, [filtro, busca, cicloSel, paradoSel, prodFiltro, ncFiltro, produtos, cidFiltro, cidades, melhoresFiltro]);
  // === LIXEIRA: descartar (arrastar pra lixeira), listar, restaurar ===
  async function descartarCard(c: Card) {
    setArrastando(null); setSobreLixeira(false);
    try {
      await fetch("/api/descartados", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: c.cliente_id, codcli: codcliDe(c), telefone: c.telefone, cliente: c.cliente, vendedor: c.vendedor }),
      });
      await load();
    } catch {}
  }
  async function carregarLixeira() {
    try { const r = await fetch("/api/descartados", { cache: "no-store" }); const j = await r.json(); setDescartados(j.descartados ?? []); } catch {}
  }
  async function restaurarDescartado(id: number) {
    try {
      await fetch("/api/descartados", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      await carregarLixeira(); await load();
    } catch {}
  }
  // baixa Excel detalhado dos clientes dos filtros atuais (visiveis + pedido)
  async function baixarRelatorio() {
    setBaixando(true);
    try {
      const set = new Set<number>();
      for (const c of visiveis) { const cc = codcliDe(c); if (cc != null) set.add(cc); }
      for (const c of pedidoVisiveis) { const cc = codcliDe(c); if (cc != null) set.add(cc); }
      const codclis = [...set];
      if (!codclis.length) { alert("Nenhum cliente com código WinThor no filtro atual."); return; }
      // com o filtro "ainda não comprou", as colunas de produto do Excel mostram o que
      // o cliente JÁ compra da linha — é o gancho da abordagem ("você leva X, conhece Y?").
      const codprods = prodFiltro ? prodFiltro.produtos : ncFiltro ? ncFiltro.linha : [];
      // manda o vendedor selecionado no board: sem isso o admin recebia SEMPRE uma aba
      // por consultor, mesmo olhando a carteira de um só. Com ele, sai uma aba única.
      const r = await fetch("/api/relatorio", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codclis, codprods, filtros: filtrosAtivosTxt,
          titulo: "Relatório de clientes — funil",
          vendedor: filtro !== "todos" ? filtro : null,
        }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert("Falha ao gerar relatório: " + (j.error ?? `HTTP ${r.status}`)); return; }
      const blob = await r.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u; a.download = `relatorio_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
      URL.revokeObjectURL(u);
    } catch (e: any) { alert("Erro ao gerar relatório: " + (e?.message ?? e)); }
    finally { setBaixando(false); }
  }

  // produtos filtrados pela busca do painel
  const produtosFiltrados = useMemo(() => {
    const q = prodBusca.trim().toLowerCase();
    return q ? produtos.filter((p) => (p.produto ?? "").toLowerCase().includes(q)) : produtos;
  }, [produtos, prodBusca]);

  // cidades filtradas pela busca do painel (busca sem acento, igual à normalização do banco)
  const semAcento = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cidadesFiltradas = useMemo(() => {
    const q = semAcento(cidBusca.trim());
    return q ? cidades.filter((c) => semAcento(c.cidade ?? "").includes(q)) : cidades;
  }, [cidades, cidBusca]);

  // resumo do filtro de produto: quantos clientes casaram e ONDE estão no board
  // (a maioria cai em Pedido emitido porque quem comprou no mês é movido pra lá).
  const prodResumo = useMemo(() => {
    if (!prodFiltro) return null;
    const outros = visiveis.length; // cards das outras etapas que casaram
    const pedido = new Set(pedidoVisiveis.map((c) => c.cliente_id)).size; // clientes distintos em Pedido emitido
    return { outros, pedido, board: outros + pedido, total: prodFiltro.total };
  }, [prodFiltro, visiveis, pedidoVisiveis]);
  // mesmo resumo para o filtro "ainda não comprou"
  const ncResumo = useMemo(() => {
    if (!ncFiltro) return null;
    const outros = visiveis.length;
    const pedido = new Set(pedidoVisiveis.map((c) => c.cliente_id)).size;
    return { outros, pedido, board: outros + pedido, total: ncFiltro.total };
  }, [ncFiltro, visiveis, pedidoVisiveis]);

  // total faturado (bruto, "quem lançou") no período da coluna Pedido emitido e no
  // vendedor filtrado. Fica FORA da coluna (mostrado acima dela) — é o KPI do mês,
  // independente de quantos compradores estão em Pedido emitido vs reengajados.
  const vendaMes = useMemo(() => {
    // mesmo padrão da coluna: sem período escolhido, o KPI é o do MÊS. Com
    // "todos" ele somava desde abril (R$ 2,45 mi contra R$ 375 mil do mês) —
    // um número que ninguém conferia porque parecia grande demais para estar errado.
    const bruto = periodoPorColuna["pedido_emitido"] ?? "todos";
    // O KPI segue o MÊS mesmo com a coluna em 7 dias (0104): é o número que o
    // time acompanha. Mas os dois passam a discordar na tela, então o rótulo
    // abaixo diz de qual período ele é — senão parece que um deles está errado.
    const per = bruto === "todos" ? "mes" : bruto;
    const vt = filtro === "todos" ? Object.values(vendasTotais) : (vendasTotais[filtro] ? [vendasTotais[filtro]] : []);
    return {
      per,
      total: vt.reduce((a, v) => a + (v[per]?.total ?? 0), 0),
      vendas: vt.reduce((a, v) => a + (v[per]?.vendas ?? 0), 0),
    };
  }, [periodoPorColuna, filtro, vendasTotais]);

  function toggleProd(codprod: number) {
    setProdSel((prev) => (prev.includes(codprod) ? prev.filter((x) => x !== codprod) : [...prev, codprod]));
  }
  async function aplicarProduto() {
    if (prodSel.length === 0) { setProdFiltro(null); setProdPainel(false); return; }
    setProdCarregando(true);
    try {
      const r = await fetch(`/api/clientes-por-produto?produtos=${prodSel.join(",")}&periodo=${prodPeriodo}`, { cache: "no-store" });
      const j = await r.json();
      setProdFiltro({
        clienteIds: new Set<string>(j.cliente_ids ?? []),
        codclis: new Set<number>((j.codclis ?? []).map(Number)),
        tel8: new Set<string>(j.tel8 ?? []),
        produtos: [...prodSel], periodo: prodPeriodo, total: j.total ?? 0,
      });
      setProdPainel(false);
    } catch { /* mantém o filtro anterior */ } finally { setProdCarregando(false); }
  }
  function limparProduto() {
    setProdFiltro(null); setProdSel([]); setProdBusca(""); setProdPainel(false);
  }

  // === "AINDA NÃO COMPROU" =====================================================
  // A LINHA do alvo = os outros produtos que compartilham o mesmo agrupamento do
  // WinThor (departamento por padrão; seção ou marca se a vendedora quiser um
  // recorte diferente). Produto sem agrupamento preenchido fica de fora.
  const ncAlvoProd = useMemo(
    () => (ncAlvo == null ? null : produtos.find((p) => p.codprod === ncAlvo) ?? null),
    [produtos, ncAlvo]
  );
  const ncGrupo = ncAlvoProd ? ncAlvoProd[ncEscopo] : null;
  const ncLinha = useMemo(() => {
    if (!ncGrupo) return [] as Produto[];
    return produtos
      .filter((p) => p[ncEscopo] === ncGrupo && p.codprod !== ncAlvo)
      .sort((a, b) => b.clientes - a.clientes);
  }, [produtos, ncAlvo, ncEscopo, ncGrupo]);
  // null = linha inteira (padrão). Trocar de alvo/escopo desfaz qualquer poda manual.
  const ncLinhaEfetiva = useMemo(
    () => (ncLinhaSel === null ? ncLinha.map((p) => p.codprod) : ncLinhaSel),
    [ncLinha, ncLinhaSel]
  );
  useEffect(() => { setNcLinhaSel(null); }, [ncAlvo, ncEscopo]);

  const ncProdutosFiltrados = useMemo(() => {
    const q = ncBusca.trim().toLowerCase();
    return q ? produtos.filter((p) => (p.produto ?? "").toLowerCase().includes(q)) : produtos;
  }, [produtos, ncBusca]);

  function toggleNcLinha(codprod: number) {
    setNcLinhaSel((prev) => {
      const base = prev ?? ncLinha.map((p) => p.codprod);
      return base.includes(codprod) ? base.filter((x) => x !== codprod) : [...base, codprod];
    });
  }
  async function aplicarNaoComprou() {
    if (ncAlvo == null || ncLinhaEfetiva.length === 0) return;
    setNcCarregando(true);
    try {
      const r = await fetch(
        `/api/clientes-sem-produto?alvo=${ncAlvo}&linha=${ncLinhaEfetiva.join(",")}&periodo=${ncPeriodo}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (j?.error) return; // mantém o filtro anterior
      setNcFiltro({
        clienteIds: new Set<string>(j.cliente_ids ?? []),
        codclis: new Set<number>((j.codclis ?? []).map(Number)),
        tel8: new Set<string>(j.tel8 ?? []),
        alvo: ncAlvo, linha: [...ncLinhaEfetiva], escopo: ncEscopo,
        periodo: ncPeriodo, total: j.total ?? 0,
      });
      setNcPainel(false);
    } catch { /* mantém o filtro anterior */ } finally { setNcCarregando(false); }
  }
  function limparNaoComprou() {
    setNcFiltro(null); setNcAlvo(null); setNcLinhaSel(null); setNcBusca("");
    setNcVerLinha(false); setNcPainel(false);
  }

  function toggleCid(cidadeNorm: string) {
    setCidSel((prev) => (prev.includes(cidadeNorm) ? prev.filter((x) => x !== cidadeNorm) : [...prev, cidadeNorm]));
  }
  async function aplicarCidade() {
    if (cidSel.length === 0) { setCidFiltro(null); setCidPainel(false); return; }
    setCidCarregando(true);
    try {
      const r = await fetch(`/api/clientes-por-cidade?cidades=${encodeURIComponent(cidSel.join(","))}`, { cache: "no-store" });
      const j = await r.json();
      setCidFiltro({
        clienteIds: new Set<string>(j.cliente_ids ?? []),
        codclis: new Set<number>((j.codclis ?? []).map(Number)),
        tel8: new Set<string>(j.tel8 ?? []),
        cidades: [...cidSel], total: j.total ?? 0,
      });
      setCidPainel(false);
    } catch { /* mantém o filtro anterior */ } finally { setCidCarregando(false); }
  }
  function limparCidade() {
    setCidFiltro(null); setCidSel([]); setCidBusca(""); setCidPainel(false);
  }

  // troca de filtro/busca/período muda o conjunto exibido -> volta cada coluna pro lote inicial
  useEffect(() => { setVisiveisPorColuna({}); }, [filtro, busca, periodoPorColuna, prodFiltro, ncFiltro, cidFiltro, cicloSel, semCadFiltro, paradoSel]);

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

  // Resumo do que está ligado. Existe porque esconder os filtros num dropdown cria um
  // risco novo: alguém deixa um filtro ativo, fecha o painel e depois estranha o board
  // vazio. O botão carrega a contagem e o painel lista os filtros pelo nome, então o
  // estado nunca fica invisível.
  const filtrosLigados = useMemo(() => {
    const l: string[] = [];
    if (periodoGlobal !== "todos") l.push(`período: ${periodoGlobal}`);
    if (prodFiltro) l.push("comprou produto");
    if (ncFiltro) l.push("ainda não comprou");
    if (melhoresFiltro) l.push("melhores clientes");
    if (cidFiltro) l.push("cidade");
    if (cicloSel.length) l.push(`ciclo (${cicloSel.length})`);
    if (paradoSel.length) l.push(`parado (${paradoSel.length})`);
    if (semCadFiltro) l.push("sem cadastro");
    return l;
  }, [periodoGlobal, prodFiltro, ncFiltro, melhoresFiltro, cidFiltro, cicloSel, paradoSel, semCadFiltro]);

  // Limpa tudo de uma vez. Zera também as SELEÇÕES dos painéis (prodSel/cidSel), não só
  // os filtros aplicados: senão o painel reabre com as caixas marcadas de um filtro que
  // já não vale mais.
  const limparFiltros = useCallback(() => {
    setPeriodoPorColuna({});
    setProdFiltro(null); setProdSel([]);
    setNcFiltro(null); setNcAlvo(null); setNcLinhaSel(null);
    setMelhoresFiltro(null);
    setCidFiltro(null); setCidSel([]);
    setCicloSel([]); setParadoSel([]); setSemCadFiltro(false);
  }, []);

  // scroll infinito: perto do fim da coluna, libera mais um lote
  function aoRolarColuna(e: React.UIEvent<HTMLDivElement>, colKey: string, total: number) {
    const el = e.currentTarget;
    // carrega mais quando chega perto do fim em QUALQUER eixo (vertical no desktop, horizontal no mobile)
    const perto = (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) || (el.scrollLeft + el.clientWidth >= el.scrollWidth - 300);
    if (!perto) return;
    setVisiveisPorColuna((prev) => {
      const atual = prev[colKey] ?? LOTE_INICIAL;
      if (atual >= total) return prev;
      return { ...prev, [colKey]: Math.min(atual + LOTE_INCREMENTO, total) };
    });
  }
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
    <div
      style={{
        minHeight: "100vh",
        // Fora do "escuro" o fundo da página nunca era pintado por tema — ficava
        // preso no cinza claro fixo do layout.tsx, então nos temas claros aqui não
        // muda nada visível. No "escuro" isto cobre o fundo inteiro (não só cards/
        // topbar) com o mesmo gradiente de produção do hub, em vez de deixar a
        // borda cinza clara aparecer nas frestas.
        background: tema === "escuro" ? "linear-gradient(155deg, #1c0e1b 0%, #0d0512 100%)" : undefined,
      }}
    >
      <div style={{ height: 3, background: RD.wine }} />
      {/* Top bar */}
      <div style={{ background: RD.surface, borderBottom: `1px solid ${RD.border}`, padding: "0 26px" }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", minHeight: 56, padding: "6px 0", display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, flexWrap: isMobile ? "wrap" : "nowrap" }}>
          <Logo size={26} />
          <b style={{ fontSize: 16, letterSpacing: 0.2 }}>CRM</b>
          {!isMobile && (
          <nav style={{ marginLeft: 12, alignSelf: "stretch", display: "flex", alignItems: "center", gap: 2 }}>
            <span style={{ display: "inline-flex", alignItems: "center", color: RD.cyan, fontWeight: 700, fontSize: 14, borderBottom: `2px solid ${RD.cyan}`, padding: "0 10px" }}>Negociações</span>
            <a href="/chat" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: RD.gray, fontWeight: 600, fontSize: 14, textDecoration: "none", padding: "0 10px", borderBottom: "2px solid transparent", whiteSpace: "nowrap" }}>💬 Chat</a>
            <a href="/relatorios" style={{ display: "inline-flex", alignItems: "center", color: RD.gray, fontWeight: 600, fontSize: 14, textDecoration: "none", padding: "0 10px", borderBottom: "2px solid transparent" }}>Relatórios</a>
            {/* Visões da Carteira = o módulo "Gestão de Carteira" do murano-app (app externo
                MuranoIA/gestao-de-carteira, que roda sobre o murano-clientes-v2). Apontamos para a
                PÁGINA DO HUB, não para o app: é o hub que tem a ponte de SSO — um token de uso
                único emitido com a service_role da v2. Reimplementar isso aqui espalharia aquela
                chave para mais um projeto sem ganho nenhum. Não confundir com Administração →
                Gestão de carteira, que é OUTRA coisa: transferir contato de carteira no RD.

                `_top` e não `_blank`: o CRM roda dentro do iframe do hub (§17), então navegação
                de topo troca a aba interna do hub pela de carteira — que é como qualquer outro
                item do menu se comporta, sem abrir janela. Fora do iframe, navega a própria aba.
                Funciona porque o iframe do hub NÃO tem `sandbox`; se um dia ganhar, isto para
                de navegar em silêncio.

                Embutir o app aqui dentro não é opção hoje: ele responde
                `frame-ancestors 'self' https://app.muranoprofessional.com.br`, ou seja, recusa
                ser enquadrado por qualquer origem que não seja o hub. */}
            <a href="https://app.muranoprofessional.com.br/gestao-carteira" target="_top" title="Segmentação da carteira do time IS — Top 30, recorrentes, consolidação e reativação (módulo do murano-app)" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: RD.gray, fontWeight: 600, fontSize: 14, textDecoration: "none", padding: "0 10px", borderBottom: "2px solid transparent", whiteSpace: "nowrap" }}>Visões da Carteira</a>
            <button onClick={() => setOrcamentoAberto(true)} style={{ display: "inline-flex", alignItems: "center", color: orcamentoAberto ? RD.cyan : RD.gray, fontWeight: 600, fontSize: 14, fontFamily: "inherit", background: "transparent", border: "none", cursor: "pointer", padding: "0 10px", borderBottom: "2px solid transparent" }}>Orçamento</button>
            {sessao.role === "admin" && (
              <a href="/analises" style={{ display: "inline-flex", alignItems: "center", color: RD.gray, fontWeight: 600, fontSize: 14, textDecoration: "none", padding: "0 10px", borderBottom: "2px solid transparent", whiteSpace: "nowrap" }}>Análises</a>
            )}
            {(() => {
                  // Dropdown "Ranking": admin vê tudo (metas/desfile/parabéns); vendedor e home veem
                  // só "Ranking ao vivo" e "Subir foto". Reusa a MESMA aba "ranking_murano".
                  const itemStyle = { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left" as const, background: "transparent", border: "none", padding: "9px 12px", fontSize: 13, fontWeight: 600, color: RD.navy, cursor: "pointer", textDecoration: "none" as const };
                  const admin = sessao.role === "admin";
                  return (
                    <div style={{ position: "relative", display: "inline-flex" }}>
                      <button
                        onClick={() => setRankingMenuAberto((v) => !v)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, color: RD.gray, fontWeight: 600, fontSize: 14, fontFamily: "inherit", background: "transparent", border: "none", cursor: "pointer", padding: "0 10px", borderBottom: "2px solid transparent", whiteSpace: "nowrap" }}
                      >
                        Ranking<span style={{ fontSize: 11, opacity: 0.7 }}>▾</span>
                      </button>
                      {rankingMenuAberto && (
                        <>
                          <div onClick={() => setRankingMenuAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 100 }} />
                          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 101, minWidth: 230, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(16,32,64,.20)", overflow: "hidden" }}>
                            {admin && (<>
                            <button onClick={() => { setRankingMenuAberto(false); setDataAnterior(""); setVerAntModal(true); }} style={{ ...itemStyle, borderBottom: `1px solid ${RD.border}` }} title="Escolher uma data e abrir o ranking daquele dia">
                              📅 Ver anteriores
                            </button>
                            <button onClick={() => { setRankingMenuAberto(false); abrirMeta(); }} style={{ ...itemStyle, borderBottom: `1px solid ${RD.border}` }}>
                              🎯 Meta do dia{metaAtual ? <span style={{ marginLeft: "auto", fontSize: 12, color: RD.wine, fontWeight: 800 }}>R$ {metaAtual.toLocaleString("pt-BR")}</span> : null}
                            </button>
                            <button onClick={() => { setRankingMenuAberto(false); abrirMetasInd(); }} title="Meta individual do dia por vendedor — ao bater, aparece 'BATEU A META' nas TVs" style={{ ...itemStyle, borderBottom: `1px solid ${RD.border}` }}>
                              🏅 Metas individuais
                            </button>
                            <button onClick={() => { setRankingMenuAberto(false); abrirMusica(); }} title="Trocar a música que toca na tela de parabéns das TVs (MP3 ou MP4; toca 20 segundos)" style={{ ...itemStyle, borderBottom: `1px solid ${RD.border}` }}>
                              🎵 Música dos parabéns
                            </button>
                            </>)}
                            <button onClick={() => { setRankingMenuAberto(false); abrirRanking(); }} style={{ ...itemStyle, borderBottom: `1px solid ${RD.border}` }}>
                              📊 Ranking <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>ao vivo ↗</span>
                            </button>
                            {admin && (<>
                            <button onClick={() => dispararDesfile()} disabled={desfileStatus === "enviando"} title="Passa a tela de parabéns de cada venda de hoje (3s cada) em todas as TVs" style={{ ...itemStyle, borderBottom: `1px solid ${RD.border}` }}>
                              🎉 Rodar desfile
                              {desfileStatus === "enviando"
                                ? <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>enviando…</span>
                                : desfileStatus === "ok"
                                ? <span style={{ marginLeft: "auto", fontSize: 11, color: RD.wine, fontWeight: 800 }}>✓ nas TVs</span>
                                : <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>▶</span>}
                            </button>
                            <button onClick={() => { setRankingMenuAberto(false); abrirParabens(); }} title="Digite o nome de uma cliente com venda hoje para exibir a tela de parabéns dessa venda nas TVs" style={{ ...itemStyle, borderBottom: `1px solid ${RD.border}` }}>
                              🎊 Parabéns por cliente <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>↗</span>
                            </button>
                            </>)}
                            <a href="/utilitarios/foto-ranking" onClick={() => setRankingMenuAberto(false)} title="Enviar sua foto para aparecer ao lado do seu nome no ranking" style={itemStyle}>
                              📸 Subir foto no ranking
                            </a>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
            <a href="/tickets" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: RD.gray, fontWeight: 600, fontSize: 14, textDecoration: "none", padding: "0 10px", borderBottom: "2px solid transparent", whiteSpace: "nowrap" }}>Tickets</a>
            {sessao.role === "admin" && (
              <a href="/admin" title="Usuários, vendedores, horário, linhas, templates, disparo em massa e gestão de carteira" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: RD.gray, fontWeight: 600, fontSize: 14, textDecoration: "none", padding: "0 10px", borderBottom: "2px solid transparent", whiteSpace: "nowrap" }}>⚙️ Administração</a>
            )}
          </nav>
          )}
          {isMobile && (
            <button onClick={() => setMenuMobile((v) => !v)} title="Menu" style={{ marginLeft: 4, width: 38, height: 34, borderRadius: 8, border: `1px solid ${RD.border}`, background: RD.surface, color: RD.wine, fontSize: 18, lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>☰</button>
          )}
          {/* Identidade + troca de papel num pill só. Clica -> dropdown com os papéis
              (Romulo: Admin|Romulo; Joas: Admin|Home); escolhe e o pill passa a mostrar o
              nome escolhido. Quem tem 1 papel só vê o pill estático (sem dropdown). */}
          {(() => {
            const multi = (sessao.papeis?.length ?? 0) > 1;
            const rotulo = (r: string) => r === "admin" ? "Admin" : r === "home" ? "Home" : (cap(sessao.carteira ?? "") || "Vendedor");
            const inicial = (r: string) => r === "admin" ? "A" : r === "home" ? "H" : cap(sessao.carteira ?? "?").charAt(0);
            return (
              <div style={{ position: "relative", marginLeft: "auto" }}>
                <button
                  onClick={() => { if (multi) setPapelMenuAberto((v) => !v); }}
                  disabled={trocandoPapel}
                  title={multi ? "Trocar o papel de acesso" : undefined}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, background: RD.wineSoft, border: "1px solid #e8d8e1", borderRadius: 20, padding: "4px 12px 4px 5px", cursor: multi ? (trocandoPapel ? "wait" : "pointer") : "default", outline: "none" }}
                >
                  <span style={{ width: 22, height: 22, borderRadius: 20, background: RD.wine, color: RD.cream, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>
                    {inicial(sessao.role)}
                  </span>
                  <b style={{ fontSize: 12.5, color: RD.wine }}>{rotulo(sessao.role)}</b>
                  {multi && <span style={{ fontSize: 9, color: RD.wine, opacity: 0.75 }}>{trocandoPapel ? "…" : "▾"}</span>}
                </button>
                {papelMenuAberto && multi && (
                  <>
                    <div onClick={() => setPapelMenuAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                    <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 41, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(16,32,64,0.14)", overflow: "hidden", minWidth: 150 }}>
                      {sessao.papeis!.map((p) => {
                        const ativo = p === sessao.role;
                        return (
                          <button
                            key={p}
                            onClick={() => { setPapelMenuAberto(false); trocarPapel(p); }}
                            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: ativo ? RD.wineSoft : "transparent", border: "none", padding: "8px 12px", fontSize: 12.5, fontWeight: ativo ? 800 : 600, color: RD.wine, cursor: "pointer" }}
                          >
                            <span style={{ width: 18, height: 18, borderRadius: 20, background: RD.wine, color: RD.cream, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>
                              {inicial(p)}
                            </span>
                            {rotulo(p)}
                            {ativo && <span style={{ marginLeft: "auto", fontSize: 11, color: RD.cyan }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          {!isMobile && sessao.role === "admin" && (
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              {/* Toggle Sinc | Pause: a "chave" desliza pro lado ativo. Junta as 3 ações antigas —
                  Sinc = retoma (se pausado) e força um sync agora; Pause = pausa (libera cota do RD). */}
              <div
                role="switch"
                aria-checked={!syncPausado}
                title={syncPausado
                  ? "Sincronização PAUSADA. Clique em Sinc pra retomar (o board volta a atualizar)."
                  : "Sincronização ativa (RD → clientes/mensagens). Sinc = forçar agora · Pause = liberar a cota do RD pros envios de template."}
                style={{
                  position: "relative", display: "inline-flex", width: 132, height: 30, boxSizing: "border-box",
                  border: `1px solid ${syncPausado ? "#f0c987" : (syncRodando ? "#bfe6f8" : RD.border)}`,
                  borderRadius: 20, background: syncPausado ? "#fff7ed" : (syncRodando ? "#eaf6fd" : RD.surface),
                  userSelect: "none", overflow: "hidden", opacity: pausandoSync ? 0.7 : 1,
                }}
              >
                <span style={{
                  position: "absolute", top: 2, bottom: 2, width: "calc(50% - 3px)",
                  left: syncPausado ? "calc(50% + 1px)" : 2,
                  borderRadius: 16, transition: "left .22s cubic-bezier(.4,0,.2,1)",
                  background: syncPausado ? "#f59e0b" : "#0ea3dc", boxShadow: "0 1px 3px rgba(0,0,0,.18)",
                }} />
                <button
                  onClick={async () => { if (pausandoSync) return; if (syncPausado) await togglePausaSync(false); if (!syncRodando) dispararSync(); }}
                  disabled={pausandoSync}
                  style={{ position: "relative", zIndex: 1, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, background: "transparent", border: "none", padding: 0, cursor: pausandoSync ? "wait" : "pointer", fontSize: 12, fontWeight: 700, color: !syncPausado ? "#fff" : RD.gray }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 6, background: !syncPausado ? "#fff" : RD.grayLight, animation: syncRodando ? "pulse-alert 1.1s ease-in-out infinite" : "none" }} />
                  {disparandoSync ? "…" : "Sinc"}
                </button>
                <button
                  onClick={() => { if (pausandoSync) return; if (!syncPausado) togglePausaSync(true); }}
                  disabled={pausandoSync}
                  style={{ position: "relative", zIndex: 1, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: pausandoSync ? "wait" : "pointer", fontSize: 12, fontWeight: 700, color: syncPausado ? "#fff" : RD.gray }}
                >
                  {pausandoSync ? "…" : "Pause"}
                </button>
              </div>
              <span style={{ position: "absolute", top: "100%", left: 2, marginTop: 2, fontSize: 10, color: syncPausado ? "#b45309" : (syncConclusao === "failure" ? "#dc2626" : RD.grayLight), whiteSpace: "nowrap", fontWeight: syncPausado ? 700 : 400 }}>
                {syncPausado ? "PAUSADA — dados não atualizam até retomar" : (
                  <>
                    RD Conversas → clientes e mensagens
                    {syncRodando && syncUltimo ? ` · rodando há ${duracao(syncUltimo)}` : null}
                    {!syncRodando && syncUltimo ? ` · última: ${tempoRelativo(syncUltimo)}` : null}
                    {!syncRodando && syncConclusao === "failure" ? " · falhou" : null}
                  </>
                )}
              </span>
            </div>
          )}
          {!isMobile && (
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              onClick={() => setTemaMenuAberto((v) => !v)}
              title="Escolher o tema visual"
              style={{ background: tema !== "padrao" ? RD.wineSoft : "transparent", border: `1px solid ${RD.border}`, color: RD.wine, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              🎨 {TEMA_ROTULO[tema]}<span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
            </button>
            {temaMenuAberto && (
              <>
                <div onClick={() => setTemaMenuAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 100 }} />
                <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 101, minWidth: 190, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(16,32,64,.20)", padding: 6 }}>
                  {(["padrao", "murano", "escuro"] as TemaId[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => escolherTema(t)}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: t === tema ? RD.wineSoft : "transparent", border: "none", padding: "7px 10px", fontSize: 12.5, fontWeight: t === tema ? 800 : 600, color: RD.navy, cursor: "pointer", borderRadius: 7 }}
                    >
                      <span style={{ width: 14, height: 14, borderRadius: 14, background: TEMAS[t].bg, border: `1px solid ${TEMAS[t].wine}` }} />
                      {TEMA_ROTULO[t]}{t === "murano" ? " (Murano claro)" : t === "escuro" ? " (Murano escuro)" : ""}
                      {t === tema && <span style={{ marginLeft: "auto", fontSize: 11, color: RD.wine }}>✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          )}
          {!isMobile && (
          <button
            onClick={sair}
            style={{ background: "transparent", border: `1px solid ${RD.border}`, color: RD.gray, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            Sair
          </button>
          )}
        </div>
      </div>

      {isMobile && menuMobile && (() => {
        const row = { display: "flex", alignItems: "center", gap: 6, width: "100%", boxSizing: "border-box" as const, padding: "13px 18px", fontSize: 15, fontWeight: 600, color: RD.navy, textDecoration: "none", background: "transparent", border: "none", borderBottom: `1px solid ${RD.border}`, cursor: "pointer", textAlign: "left" as const };
        const fecha = () => setMenuMobile(false);
        return (
          <>
            <div onClick={fecha} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(16,32,64,0.22)" }} />
            <div style={{ position: "fixed", top: 60, left: 0, right: 0, zIndex: 201, background: RD.surface, borderTop: `1px solid ${RD.border}`, boxShadow: "0 14px 34px rgba(16,32,64,.2)", maxHeight: "82vh", overflowY: "auto" }}>
              <a href="/chat" onClick={fecha} style={row}>💬 Chat</a>
              <a href="/relatorios" onClick={fecha} style={row}>Relatórios</a>
              <a href="https://app.muranoprofessional.com.br/gestao-carteira" target="_top" onClick={fecha} style={row}>Visões da Carteira</a>
              <button onClick={() => { fecha(); setOrcamentoAberto(true); }} style={row}>Orçamento</button>
              {sessao.role === "admin" && (
                <a href="/analises" onClick={fecha} style={row}>Análises</a>
              )}
              <button onClick={() => { fecha(); abrirRanking(); }} style={row}>📊 Ranking (ao vivo) ↗</button>
              <a href="/utilitarios/foto-ranking" onClick={fecha} style={row}>📸 Subir foto no ranking</a>
              {sessao.role === "admin" && (
                <>
                  <button onClick={() => { fecha(); dispararDesfile(); }} style={row}>🎉 Rodar desfile <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>▶ nas TVs</span></button>
                  <button onClick={() => { fecha(); abrirParabens(); }} style={row}>🎊 Parabéns por cliente</button>
                  <button onClick={() => { fecha(); setDataAnterior(""); setVerAntModal(true); }} style={row}>📅 Ranking — ver anteriores</button>
                  <button onClick={() => { fecha(); abrirMeta(); }} style={row}>🎯 Meta do dia{metaAtual ? <span style={{ marginLeft: "auto", fontSize: 13, color: RD.wine, fontWeight: 800 }}>R$ {metaAtual.toLocaleString("pt-BR")}</span> : null}</button>
                  <button onClick={() => { fecha(); abrirMetasInd(); }} style={row}>🏅 Metas individuais</button>
                  <button onClick={() => { fecha(); abrirMusica(); }} style={row}>🎵 Música dos parabéns{musica ? <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{musica.nome}</span> : null}</button>
                </>
              )}
              <a href="/tickets" onClick={fecha} style={row}>🎫 Tickets</a>
              {sessao.role === "admin" && (
                <a href="/admin" onClick={fecha} style={row}>⚙️ Administração</a>
              )}
              <button onClick={() => { alternarTema(); }} style={row}>🎨 Tema: {TEMA_ROTULO[tema]} <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>trocar ↻</span></button>
              <button onClick={() => { fecha(); sair(); }} style={{ ...row, color: RD.wine, borderBottom: "none", fontWeight: 700 }}>Sair</button>
            </div>
          </>
        );
      })()}

      <main style={{ padding: isMobile ? "12px 12px" : "18px 26px", maxWidth: 1440, margin: "0 auto" }}>
        <header style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {/* Vendedor: NÃO tem linha de cima — busca + "na carteira" vão pra linha única dos filtros.
              Admin/home mantêm a busca ampla + chips + "na carteira" aqui em cima. */}
          {sessao.role !== "vendedor" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="🔍  Buscar por nome ou telefone…"
              style={{
                width: 240, padding: "8px 12px", fontSize: 13, color: RD.navy,
                background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 8, outline: "none",
              }}
            />
          {/* filtro de vendedor: só faz sentido p/ quem vê mais de uma carteira (admin/home).
              Vendedor tem carteira única -> "Todos" + o próprio nome seria redundante. */}
          {sessao.role !== "vendedor" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {chip("Todos", "todos")}
              {vendedores.map((v) => chip(cap(v), v, vendCores[v] ?? CoresVendedor[v] ?? RD.grayLight))}
            </div>
          )}
          <span style={{ marginLeft: "auto", color: RD.gray, fontSize: 12.5, whiteSpace: "nowrap" }}>
            {erro ? <span style={{ color: "#e5484d" }}>erro: {erro}</span> : `${naCarteiraCount} na carteira · ${atualizado}`}
          </span>
          </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: isMobile ? "wrap" : "nowrap" }}>
          {sessao.role === "vendedor" && (
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="🔍  Nome ou telefone…"
              style={{ width: 150, height: 30, boxSizing: "border-box", padding: "0 10px", fontSize: 12, color: RD.navy, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 8, outline: "none" }}
            />
          )}
          {/* TODOS OS FILTROS moram aqui dentro. Cada um mantém o próprio painel e a
              própria lógica — o dropdown só deixou de espalhá-los pelo cabeçalho. As
              AÇÕES (baixar o Excel) ficam FORA de propósito: elas agem sobre o
              resultado dos filtros, não são filtros. */}
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              onClick={() => setFiltrosAbertos((v) => !v)}
              title={filtrosLigados.length ? `Filtros ativos: ${filtrosLigados.join(" · ")}` : "Abrir os filtros do board"}
              style={{
                padding: "0 12px", height: 30, boxSizing: "border-box", fontSize: 11.5, fontWeight: 700,
                color: filtrosLigados.length ? "#fff" : RD.gray,
                background: filtrosLigados.length ? RD.wine : RD.surface,
                border: `1px solid ${filtrosLigados.length ? RD.wine : RD.border}`,
                borderRadius: 8, cursor: "pointer", outline: "none",
                display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              }}
            >
              Filtros{filtrosLigados.length ? ` (${filtrosLigados.length})` : ""}
              <span style={{ fontSize: 10, opacity: 0.8 }}>▾</span>
            </button>
            {filtrosAbertos && (
              <div style={{
                position: "absolute", top: 34, left: 0, zIndex: 60, minWidth: 268,
                background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10,
                boxShadow: "0 8px 24px rgba(16,32,64,0.14)", padding: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: RD.grayLight }}>Filtros do board</span>
                  <div style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                    {!!filtrosLigados.length && (
                      <button
                        onClick={limparFiltros}
                        title="Desliga todos os filtros de uma vez"
                        style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 700, color: RD.wine, background: "#fbeef4", border: `1px solid #e2c7d3`, borderRadius: 7, cursor: "pointer" }}
                      >
                        Limpar tudo
                      </button>
                    )}
                    <button
                      onClick={() => setFiltrosAbertos(false)}
                      style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 700, color: "#fff", background: "#475569", border: "1px solid #475569", borderRadius: 7, cursor: "pointer" }}
                    >
                      Fechar
                    </button>
                  </div>
                </div>
                {!!filtrosLigados.length && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                    {filtrosLigados.map((f) => (
                      <span key={f} style={{ fontSize: 10.5, fontWeight: 700, color: RD.wine, background: "#fbeef4", border: "1px solid #e2c7d3", borderRadius: 6, padding: "1px 7px", whiteSpace: "nowrap" }}>{f}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          {(() => {
            // Dropdown de período: FECHADO mostra "Período: X" (curto); ABERTO tem o cabeçalho
            // "Mensagens a partir de:" + as opções. (select nativo não separa fechado x aberto.)
            const PERS: [string, string][] = [["todos", "todos"], ["hoje", "hoje"], ["ontem", "ontem"], ["semana", "semana"], ["quinzena", "quinzena"], ["mes", "mês"]];
            const lbl = periodoGlobal === "misto" ? "misto" : (PERS.find(([k]) => k === periodoGlobal)?.[1] ?? periodoGlobal);
            return (
              <div style={{ position: "relative", display: "inline-flex" }}>
                <button
                  onClick={() => setPeriodoMenuAberto((v) => !v)}
                  title="Filtra por quão recente é a última mensagem (aplica a todas as etapas)"
                  style={{
                    padding: "0 10px", height: 30, boxSizing: "border-box", fontSize: 11.5, fontWeight: 600, color: RD.gray,
                    background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 8, cursor: "pointer", outline: "none",
                    display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                  }}
                >
                  Período: {lbl}
                  <span style={{ fontSize: 10, opacity: 0.8 }}>▾</span>
                </button>
                {periodoMenuAberto && (
                  <>
                    <div onClick={() => setPeriodoMenuAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 100 }} />
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 101, minWidth: 210, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(16,32,64,.20)", padding: 6 }}>
                      <div style={{ fontSize: 10.5, color: RD.grayLight, fontWeight: 700, padding: "4px 8px 6px" }}>Mensagens a partir de:</div>
                      {PERS.map(([k, l]) => {
                        const ativo = k === periodoGlobal;
                        return (
                          <button
                            key={k}
                            onClick={() => { setPeriodoGlobal(k as Periodo); setPeriodoMenuAberto(false); }}
                            style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left", background: ativo ? RD.cyanSoft : "transparent", border: "none", padding: "7px 10px", fontSize: 12.5, fontWeight: ativo ? 800 : 600, color: ativo ? "#0b7fb0" : RD.navy, cursor: "pointer", borderRadius: 7 }}
                          >
                            {l}
                            {ativo && <span style={{ marginLeft: "auto", fontSize: 11, color: "#0b7fb0" }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setProdPainel((v) => !v)}
              title="Filtrar clientes que compraram um produto num período"
              style={{
                padding: "0 10px", height: 30, boxSizing: "border-box", fontSize: 11.5, fontWeight: 600,
                color: prodFiltro ? "#fff" : RD.gray,
                background: prodFiltro ? RD.wine : RD.surface,
                border: `1px solid ${prodFiltro ? RD.wine : RD.border}`,
                borderRadius: 8, cursor: "pointer", outline: "none",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {prodFiltro
                ? `Produto: ${prodFiltro.produtos.length} · ${prodFiltro.total} clientes`
                : "Filtro por produto"}
              <span style={{ fontSize: 10, opacity: 0.8 }}>▾</span>
            </button>
            {prodFiltro && (
              <span
                onClick={limparProduto}
                title="Limpar filtro de produto"
                style={{
                  position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: 17,
                  background: "#fff", border: `1px solid ${RD.wine}`, color: RD.wine, fontSize: 11, fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1,
                }}
              >×</span>
            )}
            {prodPainel && (
              <div
                style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100, width: 344,
                  background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10,
                  boxShadow: "0 12px 32px rgba(16,32,64,.20)", padding: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: RD.gray, fontWeight: 700 }}>Período</span>
                  <select
                    value={prodPeriodo}
                    onChange={(e) => setProdPeriodo(e.target.value)}
                    style={{ flex: 1, padding: "6px 8px", fontSize: 12.5, color: RD.navy, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 7, cursor: "pointer", outline: "none" }}
                  >
                    <option value="hoje">hoje</option>
                    <option value="ontem">ontem</option>
                    <option value="semana">última semana</option>
                    <option value="quinzena">última quinzena</option>
                    <option value="mes">último mês</option>
                    <option value="2m">últimos 2 meses</option>
                    <option value="3m">últimos 3 meses</option>
                    <option value="4m">últimos 4 meses</option>
                    <option value="5m">últimos 5 meses</option>
                    <option value="6m">últimos 6 meses</option>
                    <option value="ano">último 1 ano</option>
                  </select>
                </div>
                <input
                  value={prodBusca}
                  onChange={(e) => setProdBusca(e.target.value)}
                  placeholder="Buscar produto..."
                  style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12.5, color: RD.navy, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 7, outline: "none" }}
                />
                <div style={{ maxHeight: 232, overflowY: "auto", margin: "8px 0", border: `1px solid ${RD.border}`, borderRadius: 8 }}>
                  {produtosFiltrados.length === 0 ? (
                    <div style={{ padding: 10, color: RD.grayLight, fontSize: 12 }}>
                      {produtos.length === 0 ? "carregando produtos…" : "nenhum produto"}
                    </div>
                  ) : produtosFiltrados.map((p) => (
                    <label
                      key={p.codprod}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", fontSize: 12.5, color: RD.navy, cursor: "pointer", borderBottom: `1px solid ${RD.bg}` }}
                    >
                      <input type="checkbox" checked={prodSel.includes(p.codprod)} onChange={() => toggleProd(p.codprod)} />
                      <span style={{ flex: 1, lineHeight: 1.25 }}>{p.produto}</span>
                      <span style={{ color: RD.grayLight, fontSize: 10.5, whiteSpace: "nowrap" }} title="clientes que já compraram">{p.clientes}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: RD.grayLight }}>{prodSel.length} selecionado(s)</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={limparProduto}
                      style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, color: RD.gray, background: "transparent", border: `1px solid ${RD.border}`, borderRadius: 7, cursor: "pointer" }}
                    >Limpar</button>
                    <button
                      onClick={aplicarProduto}
                      disabled={prodCarregando || prodSel.length === 0}
                      style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, color: "#fff", background: RD.wine, border: `1px solid ${RD.wine}`, borderRadius: 7, cursor: prodCarregando || prodSel.length === 0 ? "default" : "pointer", opacity: prodCarregando || prodSel.length === 0 ? 0.6 : 1 }}
                    >{prodCarregando ? "Aplicando…" : "Aplicar"}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* AINDA NÃO COMPROU: já compra a linha, nunca levou este produto (cross-sell) */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setNcPainel((v) => !v)}
              title="Clientes que ainda não compraram um produto, mas já compraram outro da mesma linha"
              style={{
                padding: "0 10px", height: 30, boxSizing: "border-box", fontSize: 11.5, fontWeight: 600,
                color: ncFiltro ? "#fff" : RD.gray,
                background: ncFiltro ? RD.cyan : RD.surface,
                border: `1px solid ${ncFiltro ? RD.cyan : RD.border}`,
                borderRadius: 8, cursor: "pointer", outline: "none",
                display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              }}
            >
              {ncFiltro
                ? `Não comprou: ${(produtos.find((p) => p.codprod === ncFiltro.alvo)?.produto ?? "").slice(0, 22)} · ${ncFiltro.total}`
                : "Ainda não comprou"}
              <span style={{ fontSize: 10, opacity: 0.8 }}>▾</span>
            </button>
            {ncFiltro && (
              <span
                onClick={limparNaoComprou}
                title="Limpar filtro"
                style={{
                  position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: 17,
                  background: "#fff", border: `1px solid ${RD.cyan}`, color: RD.cyan, fontSize: 11, fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1,
                }}
              >×</span>
            )}
            {ncPainel && (
              <>
                <div onClick={() => setNcPainel(false)} style={{ position: "fixed", inset: 0, zIndex: 100 }} />
                <div
                  style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 101, width: 360,
                    background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10,
                    boxShadow: "0 12px 32px rgba(16,32,64,.20)", padding: 12,
                  }}
                >
                  {/* 1) o produto que ele NUNCA comprou */}
                  <div style={{ fontSize: 11.5, color: RD.navy, fontWeight: 800, marginBottom: 6 }}>
                    1. Nunca comprou este produto
                  </div>
                  <input
                    value={ncBusca}
                    onChange={(e) => setNcBusca(e.target.value)}
                    placeholder="Buscar produto..."
                    style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12.5, color: RD.navy, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 7, outline: "none" }}
                  />
                  <div style={{ maxHeight: 150, overflowY: "auto", margin: "8px 0 10px", border: `1px solid ${RD.border}`, borderRadius: 8 }}>
                    {ncProdutosFiltrados.length === 0 ? (
                      <div style={{ padding: 10, color: RD.grayLight, fontSize: 12 }}>
                        {produtos.length === 0 ? "carregando produtos…" : "nenhum produto"}
                      </div>
                    ) : ncProdutosFiltrados.map((p) => (
                      <label
                        key={p.codprod}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", fontSize: 12.5, color: RD.navy, cursor: "pointer", borderBottom: `1px solid ${RD.bg}`, background: ncAlvo === p.codprod ? RD.cyanSoft : "transparent" }}
                      >
                        <input type="radio" name="nc-alvo" checked={ncAlvo === p.codprod} onChange={() => setNcAlvo(p.codprod)} />
                        <span style={{ flex: 1, lineHeight: 1.25 }}>{p.produto}</span>
                        <span style={{ color: RD.grayLight, fontSize: 10.5, whiteSpace: "nowrap" }} title="clientes que já compraram">{p.clientes}</span>
                      </label>
                    ))}
                  </div>

                  {/* 2) mas JÁ COMPRA a linha do alvo */}
                  <div style={{ fontSize: 11.5, color: RD.navy, fontWeight: 800, marginBottom: 6 }}>
                    2. Mas já comprou da mesma linha
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <select
                      value={ncEscopo}
                      onChange={(e) => setNcEscopo(e.target.value as EscopoLinha)}
                      title="Como agrupar a linha (agrupamento do WinThor)"
                      style={{ flex: 1, padding: "6px 8px", fontSize: 12, color: RD.navy, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 7, cursor: "pointer", outline: "none" }}
                    >
                      {(Object.keys(ESCOPO_LABEL) as EscopoLinha[]).map((k) => (
                        <option key={k} value={k}>{ESCOPO_LABEL[k]}</option>
                      ))}
                    </select>
                    <select
                      value={ncPeriodo}
                      onChange={(e) => setNcPeriodo(e.target.value)}
                      title="Quando ele comprou da linha"
                      style={{ flex: 1, padding: "6px 8px", fontSize: 12, color: RD.navy, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 7, cursor: "pointer", outline: "none" }}
                    >
                      {NC_PERIODOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  <div style={{ fontSize: 11.5, color: RD.gray, lineHeight: 1.45, marginBottom: 8 }}>
                    {ncAlvo == null ? (
                      <span style={{ color: RD.grayLight }}>Escolha o produto acima para ver a linha dele.</span>
                    ) : !ncGrupo ? (
                      <span style={{ color: "#b45309" }}>Este produto não tem {ESCOPO_LABEL[ncEscopo].toLowerCase()} no WinThor — tente outro agrupamento.</span>
                    ) : ncLinha.length === 0 ? (
                      <span style={{ color: "#b45309" }}>
                        <b>{ncGrupo}</b> não tem outro produto — tente um agrupamento mais amplo.
                      </span>
                    ) : (
                      <>
                        Linha <b>{ncGrupo}</b> · {ncLinhaEfetiva.length} de {ncLinha.length} produto(s)
                        {" "}
                        <span
                          onClick={() => setNcVerLinha((v) => !v)}
                          style={{ color: RD.cyan, cursor: "pointer", fontWeight: 700 }}
                        >{ncVerLinha ? "ocultar" : "ver / escolher"}</span>
                      </>
                    )}
                  </div>
                  {ncVerLinha && ncLinha.length > 0 && (
                    <div style={{ maxHeight: 140, overflowY: "auto", margin: "0 0 10px", border: `1px solid ${RD.border}`, borderRadius: 8 }}>
                      {ncLinha.map((p) => (
                        <label
                          key={p.codprod}
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", fontSize: 12.5, color: RD.navy, cursor: "pointer", borderBottom: `1px solid ${RD.bg}` }}
                        >
                          <input type="checkbox" checked={ncLinhaEfetiva.includes(p.codprod)} onChange={() => toggleNcLinha(p.codprod)} />
                          <span style={{ flex: 1, lineHeight: 1.25 }}>{p.produto}</span>
                          <span style={{ color: RD.grayLight, fontSize: 10.5, whiteSpace: "nowrap" }}>{p.clientes}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 10.5, color: RD.grayLight, lineHeight: 1.35 }}>
                      Compras desde jan/2025
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={limparNaoComprou}
                        style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, color: RD.gray, background: "transparent", border: `1px solid ${RD.border}`, borderRadius: 7, cursor: "pointer" }}
                      >Limpar</button>
                      <button
                        onClick={aplicarNaoComprou}
                        disabled={ncCarregando || ncAlvo == null || ncLinhaEfetiva.length === 0}
                        style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, color: "#fff", background: RD.cyan, border: `1px solid ${RD.cyan}`, borderRadius: 7, cursor: ncCarregando || ncAlvo == null || ncLinhaEfetiva.length === 0 ? "default" : "pointer", opacity: ncCarregando || ncAlvo == null || ncLinhaEfetiva.length === 0 ? 0.6 : 1 }}
                      >{ncCarregando ? "Aplicando…" : "Aplicar"}</button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          {/* MELHORES CLIENTES: top N por ticket médio dos últimos 3 meses */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setMelhoresPainel((v) => !v)}
              title="Top N clientes por ticket médio dos últimos 3 meses (entre quem comprou no período)"
              style={{
                padding: "0 10px", height: 30, boxSizing: "border-box", fontSize: 11.5, fontWeight: 600,
                color: melhoresFiltro ? "#fff" : RD.gray,
                background: melhoresFiltro ? "#b8860b" : RD.surface,
                border: `1px solid ${melhoresFiltro ? "#b8860b" : RD.border}`,
                borderRadius: 8, cursor: "pointer", outline: "none",
                display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              }}
            >
              {melhoresCarregando ? "Calculando…" : melhoresFiltro ? `🏆 Top ${melhoresFiltro.qtd} melhores` : "Melhores clientes"}
              <span style={{ fontSize: 10, opacity: 0.8 }}>▾</span>
            </button>
            {melhoresFiltro && (
              <span
                onClick={() => setMelhoresFiltro(null)}
                title="Limpar filtro de melhores clientes"
                style={{
                  position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: 17,
                  background: "#fff", border: `1px solid #b8860b`, color: "#b8860b", fontSize: 11, fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1,
                }}
              >×</span>
            )}
            {melhoresPainel && (
              <>
                <div onClick={() => setMelhoresPainel(false)} style={{ position: "fixed", inset: 0, zIndex: 100 }} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 101, minWidth: 230, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(16,32,64,.20)", padding: 6 }}>
                  <div style={{ fontSize: 10.5, color: RD.grayLight, fontWeight: 700, padding: "4px 8px 6px", lineHeight: 1.4 }}>
                    Quem comprou nos últimos 3 meses,<br />ordenado pelo maior ticket médio:
                  </div>
                  {[10, 20, 30, 40, 50].map((n) => {
                    const ativo = melhoresFiltro?.qtd === n;
                    return (
                      <button
                        key={n}
                        onClick={() => aplicarMelhores(n)}
                        style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left", background: ativo ? RD.wineSoft : "transparent", border: "none", padding: "7px 10px", fontSize: 12.5, fontWeight: ativo ? 800 : 600, color: ativo ? RD.wine : RD.navy, cursor: "pointer", borderRadius: 7 }}
                      >
                        🏆 {n} melhores
                        {ativo && <span style={{ marginLeft: "auto", fontSize: 11, color: RD.wine }}>✓</span>}
                      </button>
                    );
                  })}
                  {melhoresFiltro && (
                    <button
                      onClick={() => { setMelhoresFiltro(null); setMelhoresPainel(false); }}
                      style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left", background: "transparent", border: "none", borderTop: `1px solid ${RD.border}`, marginTop: 4, padding: "7px 10px", fontSize: 12, fontWeight: 600, color: RD.gray, cursor: "pointer" }}
                    >
                      Limpar filtro
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setCidPainel((v) => !v)}
              title="Filtrar clientes por cidade"
              style={{
                padding: "0 10px", height: 30, boxSizing: "border-box", fontSize: 11.5, fontWeight: 600,
                color: cidFiltro ? "#fff" : RD.gray,
                background: cidFiltro ? "#2563eb" : RD.surface,
                border: `1px solid ${cidFiltro ? "#2563eb" : RD.border}`,
                borderRadius: 8, cursor: "pointer", outline: "none",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {cidFiltro
                ? `Cidade: ${cidFiltro.cidades.length} · ${cidFiltro.total} clientes`
                : "Filtro por cidade"}
              <span style={{ fontSize: 10, opacity: 0.8 }}>▾</span>
            </button>
            {cidFiltro && (
              <span
                onClick={limparCidade}
                title="Limpar filtro de cidade"
                style={{
                  position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: 17,
                  background: "#fff", border: "1px solid #2563eb", color: "#2563eb", fontSize: 11, fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1,
                }}
              >×</span>
            )}
            {cidPainel && (
              <div
                style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100, width: 320,
                  background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10,
                  boxShadow: "0 12px 32px rgba(16,32,64,.20)", padding: 12,
                }}
              >
                <input
                  value={cidBusca}
                  onChange={(e) => setCidBusca(e.target.value)}
                  placeholder="Buscar cidade..."
                  style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12.5, color: RD.navy, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 7, outline: "none" }}
                />
                <div style={{ maxHeight: 232, overflowY: "auto", margin: "8px 0", border: `1px solid ${RD.border}`, borderRadius: 8 }}>
                  {cidadesFiltradas.length === 0 ? (
                    <div style={{ padding: 10, color: RD.grayLight, fontSize: 12 }}>
                      {cidades.length === 0 ? "carregando cidades…" : "nenhuma cidade"}
                    </div>
                  ) : cidadesFiltradas.map((c) => (
                    <label
                      key={c.cidade_norm}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", fontSize: 12.5, color: RD.navy, cursor: "pointer", borderBottom: `1px solid ${RD.bg}` }}
                    >
                      <input type="checkbox" checked={cidSel.includes(c.cidade_norm)} onChange={() => toggleCid(c.cidade_norm)} />
                      <span style={{ flex: 1, lineHeight: 1.25 }}>{c.cidade}</span>
                      <span style={{ color: RD.grayLight, fontSize: 10.5, whiteSpace: "nowrap" }} title="clientes nesta cidade">{c.clientes}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: RD.grayLight }}>{cidSel.length} selecionada(s)</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={limparCidade}
                      style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, color: RD.gray, background: "transparent", border: `1px solid ${RD.border}`, borderRadius: 7, cursor: "pointer" }}
                    >Limpar</button>
                    <button
                      onClick={aplicarCidade}
                      disabled={cidCarregando || cidSel.length === 0}
                      style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, color: "#fff", background: "#2563eb", border: "1px solid #2563eb", borderRadius: 7, cursor: cidCarregando || cidSel.length === 0 ? "default" : "pointer", opacity: cidCarregando || cidSel.length === 0 ? 0.6 : 1 }}
                    >{cidCarregando ? "Aplicando…" : "Aplicar"}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Filtro de ciclo: some inteiro com o motor desligado no /admin. O selo
              no card não precisa de guarda — vem `ciclo: null` do servidor. */}
          {cicloAtivo && (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setCicloPainel((v) => !v)}
              title="Filtrar por ciclo de compra / oportunidade (análise preditiva)"
              style={{
                padding: "0 10px", height: 30, boxSizing: "border-box", fontSize: 11.5, fontWeight: 600,
                color: cicloSel.length ? "#fff" : RD.gray,
                background: cicloSel.length ? "#0e7490" : RD.surface,
                border: `1px solid ${cicloSel.length ? "#0e7490" : RD.border}`,
                borderRadius: 8, cursor: "pointer", outline: "none",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              Ciclo compra{cicloSel.length ? ` (${cicloTotal})` : ""}
              <span style={{ fontSize: 10, opacity: 0.8 }}>▾</span>
            </button>
            {cicloSel.length > 0 && (
              <span
                onClick={() => { setCicloSel([]); setCicloPainel(false); }}
                title="Limpar filtro de ciclo"
                style={{ position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: 17, background: "#fff", border: "1px solid #0e7490", color: "#0e7490", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1 }}
              >×</span>
            )}
            {cicloPainel && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100, width: 320, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(16,32,64,.20)", padding: 10 }}>
                <div style={{ fontSize: 10, color: RD.grayLight, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, margin: "2px 6px 4px" }}>Prioridade</div>
                {[{ key: "URGENTE", label: "Urgentes (ligar hoje)", cor: "#b91c1c", bg: "#fdecec", desc: "atravessa todas as situações abaixo" }].map((cat) => (
                  <label key={cat.key} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 6px", fontSize: 12.5, cursor: "pointer", borderRadius: 7 }}>
                    <input
                      type="checkbox"
                      checked={cicloSel.includes(cat.key)}
                      onChange={() => setCicloSel((prev) => prev.includes(cat.key) ? prev.filter((x) => x !== cat.key) : [...prev, cat.key])}
                    />
                    <span style={{ flexShrink: 0, background: cat.bg, color: cat.cor, border: `1px solid ${cat.cor}33`, borderRadius: 6, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>{cat.label}</span>
                    <span style={{ color: RD.grayLight, fontSize: 10.5, lineHeight: 1.2 }}>{cat.desc}</span>
                  </label>
                ))}
                <div style={{ height: 1, background: RD.border, margin: "7px 4px 5px" }} />
                <div style={{ fontSize: 10, color: RD.grayLight, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, margin: "2px 6px 4px" }}>
                  Situação no ciclo <span style={{ textTransform: "none", fontWeight: 600, letterSpacing: 0 }}>· combina com a prioridade</span>
                </div>
                {CICLO_CATS.map((cat) => (
                  <label key={cat.key} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 6px", fontSize: 12.5, cursor: "pointer", borderRadius: 7 }}>
                    <input
                      type="checkbox"
                      checked={cicloSel.includes(cat.key)}
                      onChange={() => setCicloSel((prev) => prev.includes(cat.key) ? prev.filter((x) => x !== cat.key) : [...prev, cat.key])}
                    />
                    <span style={{ flexShrink: 0, background: cat.bg, color: cat.cor, border: `1px solid ${cat.cor}33`, borderRadius: 6, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>{cat.label}</span>
                    <span style={{ color: RD.grayLight, fontSize: 10.5, lineHeight: 1.2 }}>{cat.desc}</span>
                  </label>
                ))}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                  <button onClick={() => setCicloPainel(false)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 700, color: "#fff", background: "#0e7490", border: "1px solid #0e7490", borderRadius: 7, cursor: "pointer" }}>Fechar</button>
                </div>
              </div>
            )}
          </div>
          )}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setParadoPainel((v) => !v)}
              title="Filtrar por quanto tempo o card está parado (dias sem atividade — conta o último template disparado)."
              style={{
                padding: "0 10px", height: 30, boxSizing: "border-box", fontSize: 11.5, fontWeight: 600, lineHeight: 1.2,
                color: paradoSel.length ? "#fff" : "#475569",
                background: paradoSel.length ? "#475569" : RD.surface,
                border: `1px solid ${paradoSel.length ? "#475569" : RD.border}`,
                borderRadius: 8, cursor: "pointer", outline: "none",
                display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              }}
            >
              Tempo parado{paradoSel.length ? ` (${paradoTotal})` : ""}
              <span style={{ fontSize: 10, opacity: 0.8 }}>▾</span>
            </button>
            {paradoSel.length > 0 && (
              <span
                onClick={() => { setParadoSel([]); setParadoPainel(false); }}
                title="Limpar filtro de tempo parado"
                style={{ position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: 17, background: "#fff", border: "1px solid #475569", color: "#475569", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1 }}
              >×</span>
            )}
            {paradoPainel && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100, width: 230, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(16,32,64,.20)", padding: 10 }}>
                <div style={{ fontSize: 11, color: RD.grayLight, fontWeight: 600, margin: "2px 4px 8px" }}>Mostrar só cards parados há:</div>
                {PARADO_BUCKETS.map((b) => (
                  <label key={b.key} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 6px", fontSize: 12.5, cursor: "pointer", borderRadius: 7 }}>
                    <input
                      type="checkbox"
                      checked={paradoSel.includes(b.key)}
                      onChange={() => setParadoSel((prev) => prev.includes(b.key) ? prev.filter((x) => x !== b.key) : [...prev, b.key])}
                    />
                    <span style={{ color: RD.navy }}>{b.label}</span>
                  </label>
                ))}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                  <button onClick={() => setParadoPainel(false)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 700, color: "#fff", background: "#475569", border: "1px solid #475569", borderRadius: 7, cursor: "pointer" }}>Fechar</button>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setSemCadFiltro((v) => !v)}
            title="Mostrar só os contatos que existem no RD Conversas mas ainda NÃO têm cadastro no WinThor (leads de marketing). Some quando o cliente é cadastrado."
            style={{
              padding: "0 10px", height: 30, boxSizing: "border-box", fontSize: 11.5, fontWeight: 600,
              color: semCadFiltro ? "#fff" : "#b45309",
              background: semCadFiltro ? "#b45309" : "#fff3e0",
              border: `1px solid ${semCadFiltro ? "#b45309" : "#f0c987"}`,
              borderRadius: 8, cursor: "pointer", outline: "none",
              display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
            }}
          >
            Sem cadastro{semCadTotal ? ` (${semCadTotal})` : ""}
          </button>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={baixarRelatorio}
            disabled={baixando}
            title="Baixar um Excel detalhado dos clientes que casam com os filtros atuais (Base Completa + aba por consultor no admin)"
            style={{
              padding: "0 12px", height: 30, boxSizing: "border-box", fontSize: 11.5, fontWeight: 700,
              color: "#15803d", background: "#e7f6ec", border: "1px solid #bfe6cd",
              borderRadius: 8, cursor: baixando ? "wait" : "pointer", outline: "none",
              display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
            }}
          >
            {baixando ? "Gerando…" : "⬇ .xls"}
          </button>
          <div style={{ marginLeft: isMobile ? 0 : "auto", display: "flex", alignItems: "flex-end", gap: 8, flexWrap: isMobile ? "wrap" : "nowrap" }}>
            <div
              title="Faturado no MÊS (bruto, por quem lançou). A coluna Pedido emitido mostra os últimos 7 dias, então os dois números não coincidem de propósito — este é o acumulado do mês."
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, boxSizing: "border-box", padding: "0 10px", background: "#e7f6ec", border: "1px solid #bfe6cd", borderRadius: 8, whiteSpace: "nowrap", marginLeft: 12 }}
            >
              <b style={{ fontSize: 12.5, color: "#15803d", lineHeight: 1 }}>{moedaBR(vendaMes.total)}</b>
              <span style={{ fontSize: 9.5, color: "#15803d", fontWeight: 700, whiteSpace: "nowrap" }}>{vendaMes.vendas} VENDAS</span>
              {/* rótulo do período: a coluna ao lado passou a mostrar 7 dias
                  (0104) e sem isto os dois números pareceriam contraditórios */}
              <span style={{ fontSize: 9, color: "#15803d", opacity: 0.75, fontWeight: 700, whiteSpace: "nowrap" }}>
                {vendaMes.per === "mes" ? "NO MÊS" : vendaMes.per.toUpperCase()}
              </span>
            </div>
          </div>
          {/* Vendedor: "na carteira" no fim da linha única (não tem a linha de cima) */}
          {sessao.role === "vendedor" && (
            <span style={{ color: RD.gray, fontSize: 11.5, whiteSpace: "nowrap", marginLeft: 12 }}>
              {erro ? <span style={{ color: "#e5484d" }}>erro: {erro}</span> : `${naCarteiraCount} na carteira · ${atualizado}`}
            </span>
          )}
          </div>
        </header>

        {prodFiltro && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            background: RD.wineSoft, border: `1px solid ${RD.cream}`, borderRadius: 10,
            padding: "9px 14px", marginBottom: 14, fontSize: 12.5, color: RD.wine,
          }}>
            <span style={{ fontWeight: 700 }}>
              Compraram {prodFiltro.produtos.length} produto{prodFiltro.produtos.length > 1 ? "s" : ""} · {PROD_PER_LABEL[prodFiltro.periodo] ?? prodFiltro.periodo}
            </span>
            <span style={{ color: RD.navy }}>
              <b>{prodResumo?.board ?? 0}</b> no seu board
              {" — "}{prodResumo?.pedido ?? 0} em <b>Pedido emitido</b>, {prodResumo?.outros ?? 0} nas outras etapas
            </span>
            {prodResumo && prodResumo.total > prodResumo.board && (
              <span style={{ color: RD.grayLight }}>({prodResumo.total} no total da empresa)</span>
            )}
            {prodResumo && prodResumo.pedido > 0 && prodResumo.outros <= 2 && (
              <span style={{ color: RD.grayLight, fontStyle: "italic" }}>
                quem comprou no mês corrente aparece só em Pedido emitido →
              </span>
            )}
            <button
              onClick={limparProduto}
              style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${RD.wine}`, color: RD.wine, borderRadius: 7, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >Limpar filtro</button>
          </div>
        )}

        {ncFiltro && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            background: RD.cyanSoft, border: `1px solid ${RD.cyan}33`, borderRadius: 10,
            padding: "9px 14px", marginBottom: 14, fontSize: 12.5, color: RD.navy,
          }}>
            <span style={{ fontWeight: 700 }}>
              Nunca compraram <b>{produtos.find((p) => p.codprod === ncFiltro.alvo)?.produto ?? `cód. ${ncFiltro.alvo}`}</b>
              {" "}· mas compraram {ncFiltro.linha.length} produto{ncFiltro.linha.length > 1 ? "s" : ""} da mesma linha
              {" "}({NC_PER_LABEL[ncFiltro.periodo] ?? ncFiltro.periodo})
            </span>
            <span>
              <b>{ncResumo?.board ?? 0}</b> no seu board
              {" — "}{ncResumo?.pedido ?? 0} em <b>Pedido emitido</b>, {ncResumo?.outros ?? 0} nas outras etapas
            </span>
            {ncResumo && ncResumo.total > ncResumo.board && (
              <span style={{ color: RD.grayLight }}>({ncResumo.total} no total da empresa)</span>
            )}
            <button
              onClick={limparNaoComprou}
              style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${RD.cyan}`, color: RD.cyan, borderRadius: 7, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >Limpar filtro</button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(5, minmax(0, 1fr))", gap: isMobile ? 10 : 12, alignItems: "start" }}>
          {COLUNAS.map((col) => {
            const ehPedido = col.key === "pedido_emitido";
            // Pedido emitido não tem "todos": o universo da coluna É o mês corrente,
            // e ela zera sozinha no dia 1º. hoje/semana/quinzena recortam DENTRO do
            // mês. Nas demais colunas, "todos" segue sendo o padrão.
            //
            // O "todos" precisa ser TRADUZIDO, não só ter outro padrão: o dropdown
            // global aplica um período a todas as colunas de uma vez, e escolher
            // "todos" ali deixaria esta coluna procurando um bucket que o servidor
            // não manda mais — vazia, sem nada explicando.
            const periodoBruto = periodoPorColuna[col.key] ?? "todos";
            const periodoAtivo: Periodo = ehPedido && periodoBruto === "todos" ? "7d" : periodoBruto;
            const ehProspec = col.key === "prospeccao";
            // atividade EFETIVA do card = a mais recente entre a última msg (RD) e o
            // disparo de template nosso (disparos_template). Assim um card que você
            // acabou de templar não conta como "parado" desde a msg antiga.
            const efetiva = (c: Card) => maisRecenteISO(c.ultima_atividade, disparos[c.cliente_id]);
            // pedido_emitido: cards vêm das views de faturamento (1 linha por período);
            // prospecção: carteira nunca contatada, sem data -> ignora o período;
            // demais colunas: da vw_funil filtrada por atividade.
            const todosDaEtapa = ehPedido
              ? pedidoVisiveis.filter((c) => c.periodo === "7d")
              : visiveis.filter((c) => c.etapa === col.key);
            let doGrupo = ehPedido
              ? pedidoVisiveis.filter((c) => c.periodo === periodoAtivo)
              : ehProspec
              ? todosDaEtapa
              : todosDaEtapa.filter((c) => dentroPeriodo(c.ultima_atividade, periodoAtivo));
            if (busca.trim()) {
              // na busca: ordena por data da última mensagem (mais recente primeiro) p/ separar homônimos
              doGrupo = [...doGrupo].sort(
                (a, b) => (new Date(b.ultima_atividade ?? 0).getTime()) - (new Date(a.ultima_atividade ?? 0).getTime())
              );
            } else if (col.key === "tentativa_contato" || col.key === "ociosos") {
              // botão TEMPLATE clicável no TOPO; quem já disparou e aguarda resposta afunda.
              // Em ociosos o botão está sempre disponível (só o disparo recente segura); em
              // tentativa precisa ter parado >= DIAS_RECONTATO. Mesma regra nas duas colunas.
              const podeTemplate = (c: Card) => {
                const ud = disparos[c.cliente_id];
                if (ud && diasInativo(ud) < DIAS_RECONTATO) return false; // aguardando resposta -> baixo
                if (col.key === "ociosos") return true;
                return diasInativo(c.ultima_atividade) >= DIAS_RECONTATO;
              };
              doGrupo = [...doGrupo].sort((a, b) => {
                const pa = podeTemplate(a), pb = podeTemplate(b);
                if (pa !== pb) return pa ? -1 : 1; // disponível no topo
                // dentro de cada grupo: mais tempo sem atividade efetiva no topo
                return (new Date(efetiva(a) ?? 0).getTime()) - (new Date(efetiva(b) ?? 0).getTime());
              });
            }
            // cards com alerta (cliente esperando >10 min, e não reconhecido) vão pro TOPO —
            // EXCETO em tentativa/ociosos, onde a ordem por "apto a disparar template" manda
            // (senão o alerta puxaria pro topo os que já estão aguardando resposta).
            const emAlerta = (c: Card) => ehAlerta(c, acks[c.cliente_id]);
            if (col.key !== "tentativa_contato" && col.key !== "ociosos") {
              doGrupo = [...doGrupo.filter(emAlerta), ...doGrupo.filter((c) => !emAlerta(c))];
            }
            // contagem por período. pedido_emitido: nº de clientes com venda no período
            // (linhas daquele período na view); demais: por atividade.
            const contaPeriodo = (p: Periodo) => ehPedido
              ? pedidoVisiveis.filter((c) => c.periodo === (p === "todos" ? "7d" : p)).length
              : ehProspec
              ? todosDaEtapa.length
              : todosDaEtapa.filter((c) => dentroPeriodo(c.ultima_atividade, p)).length;
            return (
              <section key={col.key} style={{ background: RD.colHeader, borderRadius: 10, border: `1px solid ${RD.border}`, overflow: "hidden" }}>
                <div style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 4, height: 15, borderRadius: 3, background: RD.wine, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.2, color: RD.wine, textTransform: "uppercase", textShadow: "0 1px 0 rgba(255,255,255,0.6)", whiteSpace: "nowrap" }}>
                      {col.titulo}
                    </span>
                    <span style={{ color: RD.gray, fontSize: 11, fontWeight: 700, flexShrink: 0 }} title="clientes nesta etapa no período selecionado">({doGrupo.length})</span>
                    <span
                      className="et-tip-wrap"
                      style={{ marginLeft: 1 }}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        const W = 300;
                        const x = Math.min(r.left - 8, window.innerWidth - W - 12);
                        setTip({ text: col.regras, x: Math.max(8, x), y: r.bottom + 6 });
                      }}
                      onMouseLeave={() => setTip(null)}
                    >
                      <span title="Regras e automações desta etapa" style={{ width: 15, height: 15, borderRadius: 15, border: `1.3px solid ${RD.grayLight}`, color: RD.grayLight, fontSize: 11, fontWeight: 700, fontStyle: "italic", fontFamily: "Georgia, 'Times New Roman', serif", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "help", userSelect: "none" }}>i</span>
                    </span>
                  </div>
                  <div title={col.subLong} style={{ marginTop: 3, fontSize: 10, lineHeight: 1.3, color: RD.grayLight, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {col.sub}
                  </div>
                  {/* chips de período por coluna — guardados por ora; trocar false->true p/ reativar */}
                  {false && (
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
                  )}
                </div>

                <div
                  key={`${col.key}:${filtro}:${periodoAtivo}:${prodFiltro ? "p" : ""}:${cicloSel.join(",")}:${semCadFiltro ? "sc" : ""}:${paradoSel.join(",")}`}
                  onScroll={(e) => aoRolarColuna(e, col.key, doGrupo.length)}
                  style={isMobile
                    ? { padding: "6px 8px 10px", display: "flex", flexDirection: "row", gap: 8, overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch" }
                    : { padding: "4px 8px 10px", display: "flex", flexDirection: "column", gap: 8, maxHeight: "76vh", overflowY: "auto" }}
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
                      const codcli = codcliDe(c); // pro botão "C" (Consulta Clientes)
                      // id p/ enviar template: prospecção usa o CONTATO do RD (rd_cliente_id);
                      // as demais usam o cliente_id do card. Prospecção sem contato no RD não
                      // dá pra templatar (não existe destinatário lá), só WhatsApp manual.
                      const idEnvio = prospeccao ? (c.rd_cliente_id ?? null) : c.cliente_id;
                      // ociosos/tentativa parada precisam de template; prospecção COM contato no RD
                      // também (nunca contatada por este RCA). Sem contato no RD -> sem template.
                      const recontactar = prospeccao
                        ? !!c.rd_cliente_id
                        : ((col.key === "tentativa_contato" && diasInativo(c.ultima_atividade) >= DIAS_RECONTATO) || col.key === "ociosos");
                      const ultimoDisparo = ((col.key === "tentativa_contato" || col.key === "ociosos" || prospeccao) && idEnvio) ? disparos[idEnvio] : undefined;
                      // input de msg livre (24h): negociação sempre; pedido emitido só quando tem conversa real
                      const temConversaReal = !String(c.cliente_id).includes(":");
                      const mostraInput = col.key === "negociacao" || (col.key === "pedido_emitido" && temConversaReal && dentro24h(c.ultima_atividade));
                      // disparo há MENOS de 4 dias => botão desativado (aguardando resposta).
                      // após 4 dias sem resposta, o botão TEMPLATE volta a liberar.
                      const disparoRecente = !!ultimoDisparo && diasInativo(ultimoDisparo) < DIAS_RECONTATO;
                      // data efetiva do card (msg do RD ou disparo nosso, o que for mais recente)
                      const ultimaEf = efetiva(c);
                      const viaDisparo = !!disparos[c.cliente_id] && ultimaEf === disparos[c.cliente_id] && ultimaEf !== c.ultima_atividade;
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
                      const selo = seloAtribuicao(c, vendMeta);
                      return (
                        <article
                          key={c.cliente_id}
                          draggable
                          onDragStart={() => setArrastando(c)}
                          onDragEnd={() => { setArrastando(null); setSobreLixeira(false); }}
                          onClick={() => abrirConversa(c)}
                          title={prospeccao ? (c.rd_cliente_id ? "Abrir conversa no RD Conversas (já tem contato lá, mesmo sem atendimento)" : "Abrir WhatsApp com este número (ainda sem contato no RD Conversas)") : "Abrir conversa no RD Conversas (reconhece e silencia o alerta)"}
                          style={{
                            cursor: "pointer", height: mostraInput ? CARD_ALTURA + 34 : CARD_ALTURA, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden",
                            ...(isMobile ? { width: "80vw", maxWidth: 340 } : {}),
                            background: disparoRecente ? RD.aguardaBg : recontactar ? RD.recontatoBg : RD.surface,
                            border: `1px solid ${disparoRecente ? RD.aguardaBorda : recontactar ? RD.recontatoBorda : RD.border}`,
                            borderLeft: `3px solid ${disparoRecente ? "#e08a00" : recontactar ? RD.wine : RD.border}`,
                            borderRadius: 8, padding: "11px 13px", boxShadow: "0 1px 2px rgba(16,32,64,0.05)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                            <span style={{ width: 11, height: 11, borderRadius: 3, background: col.cor }} />
                            <span style={{ fontSize: 11.5, color: RD.gray, fontWeight: 600 }}>{col.status}</span>
                            {c.sem_cadastro && (
                              <span
                                title="Só existe no RD Conversas — ainda não cadastrado no WinThor. Provável lead de marketing (Instagram, campanha). Ao efetuar a 1ª compra e ser cadastrado, o card se junta automaticamente ao cliente oficial (por telefone/CPF)."
                                style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#fff3e0", color: "#b45309", border: "1px solid #f0c987", borderRadius: 6, padding: "1px 6px", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3, cursor: "help", textTransform: "uppercase" }}
                              >
                                sem cadastro
                              </span>
                            )}
                            {codcli != null && (
                              <button
                                onClick={(e) => { e.stopPropagation(); window.open(`${URL_CONSULTA}/?codcli=${codcli}`, "consultaclientes"); }}
                                title={`Ver cadastro completo na Consulta Clientes (código ${codcli})`}
                                style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 5, border: `1px solid #e2c7d3`, background: "#fbeef4", color: RD.wine, fontSize: 11, fontWeight: 800, lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                              >
                                C
                              </button>
                            )}
                            {temConversaReal && (
                              <button
                                onClick={(e) => { e.stopPropagation(); abrirZoom(c); }}
                                title="Ampliar o card — ler a conversa e responder aqui mesmo"
                                style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 5, border: `1px solid #bfe6f8`, background: "#eaf6fd", color: "#0b7fb0", fontSize: 10, lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                              >
                                🔍
                              </button>
                            )}
                            {temConversaReal && (
                              <button
                                onClick={(e) => { e.stopPropagation(); atualizarCard(c.cliente_id); }}
                                disabled={!!syncingCards[c.cliente_id]}
                                title="Atualizar esta conversa — puxa do RD as mensagens novas (igual ao ↻ do card ampliado)"
                                style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 5, border: `1px solid #cfe3d6`, background: "#eef7f0", color: "#2e7d52", fontSize: 11, lineHeight: 1, cursor: syncingCards[c.cliente_id] ? "wait" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                              >
                                {syncingCards[c.cliente_id] ? "…" : "↻"}
                              </button>
                            )}
                            <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              {alerta && (
                                <span
                                  title="Aguardando resposta do cliente"
                                  style={{ width: 10, height: 10, borderRadius: 10, background: "#dc2626", flexShrink: 0, boxShadow: "0 0 0 3px rgba(220,38,38,0.16)", animation: "pulse-alert 1.1s ease-in-out infinite" }}
                                />
                              )}
                              {disparoRecente ? (
                                <span
                                  title={`Template enviado ${tempoRelativo(ultimoDisparo!)} atrás — aguardando resposta (botão liberado após ${DIAS_RECONTATO} dias)`}
                                  style={{
                                    display: "inline-flex", alignItems: "center", gap: 3,
                                    background: "#fff7e6", color: "#b76e00", border: "1px solid #f3ddad",
                                    borderRadius: 5, padding: "1px 5px", fontSize: 8.5, fontWeight: 800, letterSpacing: 0.1, whiteSpace: "nowrap",
                                  }}
                                >
                                  <span style={{ width: 6, height: 6, borderRadius: 6, background: "#e08a00", animation: "pulse-alert 1.1s ease-in-out infinite" }} />
                                  AGUARDANDO
                                </span>
                              ) : recontactar ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); recontatar(idEnvio!, c.cliente); }}
                                  disabled={enviando === idEnvio}
                                  title="Enviar template (mensagem real no WhatsApp)"
                                  style={{
                                    cursor: enviando === idEnvio ? "wait" : "pointer",
                                    display: "inline-flex", alignItems: "center", gap: 3,
                                    background: "#f8e6ec", color: "#9c1f47", border: "1px solid #ecc6d2",
                                    borderRadius: 5, padding: "2px 6px", fontSize: 8.5, fontWeight: 800, letterSpacing: 0.1, whiteSpace: "nowrap",
                                  }}
                                >
                                  <span style={{ width: 5, height: 5, borderRadius: 5, background: "#b02350" }} />
                                  {enviando === idEnvio ? "ENVIANDO…" : "TEMPLATE"}
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: RD.navy, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }} title={c.cliente}>
                            {c.cliente}
                          </div>
                          {((c.venda_valor != null || col.key === "pedido_emitido") || (c.ciclo?.tipo && CICLO_LABEL[c.ciclo.tipo]) || selo) && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                              {(c.venda_valor != null || col.key === "pedido_emitido") && (
                                <span
                                  title={col.key === "pedido_emitido" ? "Faturado no período (nota fiscal, líquido)" : "Comprou no mês — valor faturado (fica no card até virar o mês)"}
                                  style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", background: "#e7f6ec", color: "#15803d", border: "1px solid #bfe6cd", borderRadius: 6, padding: col.key === "pedido_emitido" ? "2px 9px" : "1px 7px", fontSize: col.key === "pedido_emitido" ? 11.5 : 10.5, fontWeight: 800, letterSpacing: 0.2 }}
                                >
                                  {moedaBR(c.venda_valor ?? 0)}
                                </span>
                              )}
                              {c.ciclo?.tipo && CICLO_LABEL[c.ciclo.tipo] && (
                                <span
                                  title={`Ciclo de compra: ${CICLO_LABEL[c.ciclo.tipo].label}`
                                    + (c.ciclo.ciclo_medio ? ` · compra a cada ~${Math.round(c.ciclo.ciclo_medio)} dias` : "")
                                    + (c.ciclo.pct_ciclo != null ? ` · ${Math.round(c.ciclo.pct_ciclo)}% do ciclo` : "")
                                    + (c.ciclo.dias_ausente != null ? ` · ${c.ciclo.dias_ausente}d sem comprar` : "")
                                    + (c.ciclo.acao ? ` · ${c.ciclo.acao}` : "")}
                                  style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, background: CICLO_LABEL[c.ciclo.tipo].bg, color: CICLO_LABEL[c.ciclo.tipo].cor, border: `1px solid ${CICLO_LABEL[c.ciclo.tipo].cor}44`, borderRadius: 6, padding: "1px 7px", fontSize: 10, fontWeight: 800, letterSpacing: 0.2, cursor: "help" }}
                                >
                                  {CICLO_LABEL[c.ciclo.tipo].label}{c.ciclo.acao === "LIGAR HOJE" ? " ·hoje" : ""}
                                </span>
                              )}
                              {selo && (
                                <span
                                  title={selo.title}
                                  style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", background: selo.bg, color: selo.cor, border: `1px solid ${selo.borda}`, borderRadius: 6, padding: "1px 6px", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.2, cursor: "help", whiteSpace: "nowrap" }}
                                >
                                  {selo.texto}
                                </span>
                              )}
                            </div>
                          )}
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
                              <span style={{ width: 7, height: 7, borderRadius: 7, background: vendCores[c.vendedor ?? ""] ?? CoresVendedor[c.vendedor ?? ""] ?? RD.grayLight }} />
                              {cap(c.vendedor) || "sem dono"}
                            </span>
                            {!prospeccao && (
                              <span style={{ color: recontactar && !viaDisparo ? "#d92d20" : RD.grayLight, fontSize: 11, fontWeight: recontactar && !viaDisparo ? 700 : 400 }}>
                                · {tempoRelativo(ultimaEf)}{viaDisparo ? " · template enviado" : (recontactar ? " parado" : "")}
                              </span>
                            )}
                          </div>
                          {mostraInput && (
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
      {tip && (
        <div
          style={{
            position: "fixed", left: tip.x, top: tip.y, zIndex: 200, width: 300,
            background: "#111d33", color: "#fff", padding: "11px 13px", borderRadius: 9,
            fontSize: 11.5, lineHeight: 1.55, whiteSpace: "pre-line",
            boxShadow: "0 8px 26px rgba(16,32,64,.28)", pointerEvents: "none",
          }}
        >
          {tip.text}
        </div>
      )}
      {orcamentoAberto && <OrcamentoFlutuante onClose={() => setOrcamentoAberto(false)} />}
      {cardZoom && (() => {
        const zc = cardZoom;
        const zid = ehProspeccao(zc) ? (zc.rd_cliente_id ?? null) : zc.cliente_id;
        const zcol = COLUNAS.find((k) => k.key === zc.etapa);
        const zcodcli = codcliDe(zc);
        const zciclo = zc.ciclo?.tipo && CICLO_LABEL[zc.ciclo.tipo] ? CICLO_LABEL[zc.ciclo.tipo] : null;
        // mesma lógica do card p/ a pill TEMPLATE/AGUARDANDO no topo à direita
        const zprospec = ehProspeccao(zc);
        const zRecontactar = zprospec ? !!zc.rd_cliente_id : ((zc.etapa === "tentativa_contato" && diasInativo(zc.ultima_atividade) >= DIAS_RECONTATO) || zc.etapa === "ociosos");
        const zUltimoDisparo = ((zc.etapa === "tentativa_contato" || zc.etapa === "ociosos" || zprospec) && zid) ? disparos[zid] : undefined;
        const zDisparoRecente = !!zUltimoDisparo && diasInativo(zUltimoDisparo) < DIAS_RECONTATO;
        const zUltimaEf = maisRecenteISO(zc.ultima_atividade, disparos[zc.cliente_id]);
        return (
          <div style={{ position: "fixed", left: zoomPos.x, top: zoomPos.y, zIndex: 400, width: 500, maxWidth: "94vw", background: RD.surface, border: `1px solid ${RD.border}`, borderLeft: `4px solid ${RD.wine}`, borderRadius: 10, boxShadow: "0 24px 70px rgba(16,32,64,.3)", display: "flex", flexDirection: "column", maxHeight: "74vh" }}>
            <div onMouseDown={zoomOnDown} style={{ cursor: "move", userSelect: "none", padding: "10px 14px 11px", borderBottom: `1px solid ${RD.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: zcol?.cor ?? RD.wine, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: RD.gray, fontWeight: 600 }}>{zcol?.status ?? ""}</span>
                {zc.sem_cadastro && (
                  <span title="Só existe no RD Conversas — ainda não cadastrado no WinThor." style={{ background: "#fff3e0", color: "#b45309", border: "1px solid #f0c987", borderRadius: 6, padding: "1px 6px", fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase" }}>sem cadastro</span>
                )}
                {zcodcli != null && (
                  <button onClick={(e) => { e.stopPropagation(); window.open(`${URL_CONSULTA}/?codcli=${zcodcli}`, "consultaclientes"); }} onMouseDown={(e) => e.stopPropagation()} title={`Ver cadastro na Consulta Clientes (código ${zcodcli})`} style={{ width: 20, height: 20, borderRadius: 5, border: `1px solid #e2c7d3`, background: "#fbeef4", color: RD.wine, fontSize: 11, fontWeight: 800, lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>C</button>
                )}
                <button onClick={(e) => { e.stopPropagation(); atualizarZoom(); }} onMouseDown={(e) => e.stopPropagation()} disabled={zoomSyncing} title="Atualizar — busca no RD as mensagens que faltam nesta conversa" style={{ width: 20, height: 20, borderRadius: 5, border: `1px solid ${RD.border}`, background: RD.surface, color: RD.gray, fontSize: 12, lineHeight: 1, cursor: zoomSyncing ? "wait" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>{zoomSyncing ? "…" : "↻"}</button>
                <button onClick={() => setCardZoom(null)} onMouseDown={(e) => e.stopPropagation()} title="Diminuir — fecha a janela ampliada" style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid #bfe6f8`, background: "#eaf6fd", color: "#0b7fb0", fontSize: 11, lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>🔍</button>
                {zDisparoRecente ? (
                  <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 3, background: "#fff7e6", color: "#b76e00", border: "1px solid #f3ddad", borderRadius: 5, padding: "2px 7px", fontSize: 9, fontWeight: 800 }}><span style={{ width: 5, height: 5, borderRadius: 5, background: "#e08a00" }} />AGUARDANDO RESPOSTA</span>
                ) : (zRecontactar && zid) ? (
                  <button onClick={(e) => { e.stopPropagation(); recontatar(zid!, zc.cliente); }} onMouseDown={(e) => e.stopPropagation()} disabled={enviando === zid} title="Enviar template (usa o template padrão)" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 3, background: "#f8e6ec", color: "#9c1f47", border: "1px solid #ecc6d2", borderRadius: 5, padding: "2px 8px", fontSize: 9, fontWeight: 800, cursor: enviando === zid ? "wait" : "pointer" }}><span style={{ width: 5, height: 5, borderRadius: 5, background: "#b02350" }} />{enviando === zid ? "ENVIANDO…" : "TEMPLATE"}</button>
                ) : null}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: RD.navy, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cap(zc.cliente)}</div>
              {zciclo && (
                <span style={{ display: "inline-flex", alignItems: "center", marginTop: 5, background: zciclo.bg, color: zciclo.cor, border: `1px solid ${zciclo.cor}44`, borderRadius: 6, padding: "1px 8px", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.2 }}>{zciclo.label}{zc.ciclo?.acao === "LIGAR HOJE" ? " ·hoje" : ""}</span>
              )}
            </div>
            {/* dono da carteira + tempo parado: sobe para cá porque a conversa
                agora traz o próprio compositor colado no rodapé */}
            <div style={{ padding: "0 14px 9px", display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: RD.gray, fontWeight: 600 }}>
              <span style={{ width: 7, height: 7, borderRadius: 7, background: vendCores[zc.vendedor ?? ""] ?? CoresVendedor[zc.vendedor ?? ""] ?? RD.grayLight }} />
              {cap(zc.vendedor) || "sem dono"}
              {!zprospec && (
                <span style={{ color: zRecontactar ? "#d92d20" : RD.grayLight, fontWeight: zRecontactar ? 700 : 400 }}> · {tempoRelativo(zUltimaEf)}{zRecontactar ? " parado" : ""}</span>
              )}
            </div>
            {/* A conversa inteira, com a mesma rolagem e o mesmo compositor do
                /chat. A janela de 24h é decidida DENTRO do componente, pela
                última mensagem recebida — não pela etapa do card, que podia
                estar desatualizada e escondia o campo de quem podia escrever. */}
            <Conversa
              clienteId={zc.cliente_id}
              altura={Math.round(Math.min(420, Math.max(220, window.innerHeight * 0.42)))}
              recarregar={zoomRefresh}
              cores={{ ink: RD.navy, gray: RD.gray, grayLight: RD.grayLight, border: RD.border, surface: RD.surface, marca: RD.wine }}
              aoEnviar={() => void load()}
              aoPedirTemplate={zid ? () => recontatar(zid!, zc.cliente) : undefined}
              enviandoTemplate={enviando === zid}
            />
          </div>
        );
      })()}
      {verAntModal && (
        <div
          onClick={() => setVerAntModal(false)}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(16,32,64,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 340, background: RD.surface, borderRadius: 14, padding: 22, boxShadow: "0 20px 60px rgba(16,32,64,.3)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: RD.wine, marginBottom: 4 }}>📅 Ranking de um dia passado</div>
            <div style={{ fontSize: 12.5, color: RD.gray, marginBottom: 16 }}>Escolha a data e abra o ranking daquele dia (estado de fim de dia). Histórico a partir de 25/07/2026.</div>
            <label style={{ fontSize: 12, fontWeight: 700, color: RD.navy }}>Data</label>
            <input
              autoFocus
              type="date"
              value={dataAnterior}
              max={new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)}
              onChange={(e) => setDataAnterior(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && dataAnterior) { abrirRanking(dataAnterior); setVerAntModal(false); } }}
              style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: "10px 12px", fontSize: 15, fontWeight: 700, color: RD.navy, border: `1px solid ${RD.border}`, borderRadius: 8, outline: "none" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button onClick={() => setVerAntModal(false)} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, color: RD.gray, background: "transparent", border: `1px solid ${RD.border}`, borderRadius: 8, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => { if (dataAnterior) { abrirRanking(dataAnterior); setVerAntModal(false); } }} disabled={!dataAnterior} style={{ padding: "8px 18px", fontSize: 13, fontWeight: 700, color: "#fff", background: dataAnterior ? RD.wine : RD.grayLight, border: "none", borderRadius: 8, cursor: dataAnterior ? "pointer" : "not-allowed" }}>Abrir ranking ↗</button>
            </div>
          </div>
        </div>
      )}
      {metaModal && (
        <div
          onClick={() => !metaSalvando && setMetaModal(false)}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(16,32,64,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 360, background: RD.surface, borderRadius: 14, padding: 22, boxShadow: "0 20px 60px rgba(16,32,64,.3)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: RD.wine, marginBottom: 4 }}>🎯 Meta de vendas do dia</div>
            <div style={{ fontSize: 12.5, color: RD.gray, marginBottom: 16 }}>Valor exibido no Ranking como barra de progresso. Vale para todos os dias.</div>
            <label style={{ fontSize: 12, fontWeight: 700, color: RD.navy }}>Meta (R$)</label>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={metaValor}
              onChange={(e) => setMetaValor(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && !metaSalvando) salvarMeta(); }}
              placeholder="ex: 50000"
              style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: "10px 12px", fontSize: 15, fontWeight: 700, color: RD.navy, border: `1px solid ${RD.border}`, borderRadius: 8, outline: "none" }}
            />
            <div style={{ fontSize: 12, color: RD.grayLight, marginTop: 6 }}>
              {metaValor ? `= R$ ${Number(metaValor).toLocaleString("pt-BR")}` : (metaAtual != null ? (metaAtual ? `Atual: R$ ${metaAtual.toLocaleString("pt-BR")}` : "Sem meta definida (barra oculta no Ranking)") : "carregando…")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
              <button onClick={() => salvarMeta(0)} disabled={metaSalvando} title="Nenhuma meta — o quadro da meta some do Ranking" style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, color: RD.gray, background: "transparent", border: `1px solid ${RD.border}`, borderRadius: 8, cursor: metaSalvando ? "wait" : "pointer" }}>Sem meta (none)</button>
              <button onClick={() => setMetaModal(false)} disabled={metaSalvando} style={{ marginLeft: "auto", padding: "8px 16px", fontSize: 13, fontWeight: 600, color: RD.gray, background: "transparent", border: `1px solid ${RD.border}`, borderRadius: 8, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => salvarMeta()} disabled={metaSalvando} style={{ padding: "8px 18px", fontSize: 13, fontWeight: 700, color: "#fff", background: RD.wine, border: `1px solid ${RD.wine}`, borderRadius: 8, cursor: metaSalvando ? "wait" : "pointer" }}>{metaSalvando ? "Salvando…" : "Salvar meta"}</button>
            </div>
          </div>
        </div>
      )}
      {parabensModal && (
        <div
          onClick={() => !parabensEnviando && setParabensModal(false)}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(16,32,64,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 380, background: RD.surface, borderRadius: 14, padding: 22, boxShadow: "0 20px 60px rgba(16,32,64,.3)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: RD.wine, marginBottom: 4 }}>🎊 Parabéns por cliente</div>
            <div style={{ fontSize: 12.5, color: RD.gray, marginBottom: 16 }}>Digite o nome da cliente. Se houver venda hoje, a tela de parabéns dessa venda aparece nas TVs.</div>
            <label style={{ fontSize: 12, fontWeight: 700, color: RD.navy }}>Nome da cliente</label>
            <input
              autoFocus
              type="text"
              value={parabensNome}
              onChange={(e) => { setParabensNome(e.target.value); if (parabensMsg) setParabensMsg(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !parabensEnviando) enviarParabens(); }}
              placeholder="ex: Raquel Rodrigues"
              style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: "10px 12px", fontSize: 15, fontWeight: 700, color: RD.navy, border: `1px solid ${RD.border}`, borderRadius: 8, outline: "none" }}
            />
            {parabensMsg && (
              <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: parabensMsg.ok ? "#0a7d3c" : "#b3261e", background: parabensMsg.ok ? "rgba(10,125,60,.08)" : "rgba(179,38,30,.07)", border: `1px solid ${parabensMsg.ok ? "rgba(10,125,60,.3)" : "rgba(179,38,30,.3)"}`, borderRadius: 8, padding: "8px 10px", lineHeight: 1.4 }}>
                {parabensMsg.texto}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
              <button onClick={() => setParabensModal(false)} disabled={parabensEnviando} style={{ marginLeft: "auto", padding: "8px 16px", fontSize: 13, fontWeight: 600, color: RD.gray, background: "transparent", border: `1px solid ${RD.border}`, borderRadius: 8, cursor: "pointer" }}>Fechar</button>
              <button onClick={() => enviarParabens()} disabled={parabensEnviando} style={{ padding: "8px 18px", fontSize: 13, fontWeight: 700, color: "#fff", background: RD.wine, border: `1px solid ${RD.wine}`, borderRadius: 8, cursor: parabensEnviando ? "wait" : "pointer" }}>{parabensEnviando ? "Buscando…" : "Mostrar parabéns"}</button>
            </div>
          </div>
        </div>
      )}
      {metasIndModal && (
        <div
          onClick={() => !metasIndSalv && setMetasIndModal(false)}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(16,32,64,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxHeight: "82vh", display: "flex", flexDirection: "column", background: RD.surface, borderRadius: 14, padding: 22, boxShadow: "0 20px 60px rgba(16,32,64,.3)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: RD.wine, marginBottom: 4 }}>🏅 Metas individuais do dia</div>
            <div style={{ fontSize: 12.5, color: RD.gray, marginBottom: 14 }}>Meta de vendas (R$) por vendedor. Ao atingir, a tela <b>BATEU A META</b> aparece nas TVs. Deixe 0 (vazio) para sem meta. Vale para todos os dias.</div>
            <div style={{ flex: 1, overflowY: "auto", margin: "0 -6px", padding: "0 6px" }}>
              {metasIndLoad ? (
                <div style={{ fontSize: 13, color: RD.gray, padding: "12px 0" }}>Carregando vendedores…</div>
              ) : metasInd.length === 0 ? (
                <div style={{ fontSize: 13, color: RD.gray, padding: "12px 0" }}>Nenhum vendedor encontrado.</div>
              ) : metasInd.map((m, i) => (
                <div key={m.slug} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${RD.border}` }}>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: RD.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.nome}</span>
                  <span style={{ fontSize: 12, color: RD.grayLight }}>R$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={m.meta ? String(m.meta) : ""}
                    onChange={(e) => { const val = Math.max(0, Number(e.target.value.replace(/[^\d]/g, "")) || 0); setMetasInd((prev) => prev.map((x, ix) => (ix === i ? { ...x, meta: val } : x))); }}
                    placeholder="0"
                    style={{ width: 96, boxSizing: "border-box", padding: "7px 10px", fontSize: 14, fontWeight: 700, textAlign: "right", color: RD.navy, border: `1px solid ${RD.border}`, borderRadius: 8, outline: "none" }}
                  />
                  <button
                    onClick={() => preverMetaBatida(m)}
                    disabled={!m.meta}
                    title={m.meta ? `Ver a tela BATEU A META de ${m.nome} nas TVs` : "Defina uma meta para ver a tela"}
                    style={{ flex: "none", padding: "6px 9px", fontSize: 14, lineHeight: 1, background: "transparent", border: `1px solid ${RD.border}`, borderRadius: 8, cursor: m.meta ? "pointer" : "not-allowed", opacity: m.meta ? 1 : 0.4 }}
                  >👁</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
              <button onClick={() => setMetasIndModal(false)} disabled={metasIndSalv} style={{ marginLeft: "auto", padding: "8px 16px", fontSize: 13, fontWeight: 600, color: RD.gray, background: "transparent", border: `1px solid ${RD.border}`, borderRadius: 8, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => salvarMetasInd()} disabled={metasIndSalv || metasIndLoad} style={{ padding: "8px 18px", fontSize: 13, fontWeight: 700, color: "#fff", background: RD.wine, border: `1px solid ${RD.wine}`, borderRadius: 8, cursor: metasIndSalv ? "wait" : "pointer" }}>{metasIndSalv ? "Salvando…" : "Salvar metas"}</button>
            </div>
          </div>
        </div>
      )}
      {musicaModal && (
        <div
          onClick={() => !musicaEnviando && setMusicaModal(false)}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(16,32,64,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 470, maxWidth: "100%", maxHeight: "86vh", overflowY: "auto", background: RD.surface, borderRadius: 14, padding: 22, boxShadow: "0 20px 60px rgba(16,32,64,.3)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: RD.wine, marginBottom: 4 }}>🎵 Música dos parabéns</div>
            <div style={{ fontSize: 12.5, color: RD.gray, marginBottom: 16, lineHeight: 1.5 }}>
              Toca nas TVs quando entra uma venda nova. Envie um <b>MP3</b> ou um <b>MP4</b> — de vídeo só aproveitamos o áudio,
              a imagem é descartada. Tocam <b>{SEGUNDOS_PARABENS} segundos</b>, com um fade no fim.
            </div>

            {musicaLoad ? (
              <div style={{ fontSize: 13, color: RD.gray, padding: "10px 0" }}>Carregando…</div>
            ) : musica ? (
              <div style={{ border: `1px solid ${RD.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: RD.gray, letterSpacing: .3, marginBottom: 4 }}>TOCANDO HOJE</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: RD.navy, wordBreak: "break-word" }}>{musica.nome}</div>
                <audio controls preload="none" src={musica.url} style={{ width: "100%", marginTop: 10 }} />
                <div style={{ fontSize: 11.5, color: RD.gray, marginTop: 8, lineHeight: 1.5 }}>
                  {musica.cortado
                    ? `Trecho de ${musica.segundos}s já recortado.`
                    : `Arquivo inteiro — o painel corta em ${musica.segundos}s ao tocar.`}
                  {" · "}atualizada em {new Date(musica.atualizado_em).toLocaleString("pt-BR", { timeZone: "America/Belem" })}
                </div>
              </div>
            ) : (
              <div style={{ border: `1px dashed ${RD.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: 12.5, color: RD.gray }}>
                Nenhuma música enviada — as TVs usam o som padrão (samba/pagode sintetizado).
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: RD.navy }}>Começar em</span>
              <input
                type="text"
                value={musicaInicio}
                onChange={(e) => setMusicaInicio(e.target.value)}
                placeholder="0:00"
                title="Ponto da música onde o trecho começa (mm:ss). Útil para pegar o refrão em vez da introdução."
                style={{ width: 80, boxSizing: "border-box", padding: "7px 10px", fontSize: 13.5, fontWeight: 700, textAlign: "center", color: RD.navy, border: `1px solid ${RD.border}`, borderRadius: 8, outline: "none" }}
              />
              <span style={{ fontSize: 11.5, color: RD.gray }}>mm:ss — pule a introdução e pegue o refrão</span>
            </div>

            <input
              ref={musicaInputRef}
              type="file"
              accept="audio/*,video/mp4,video/webm,video/quicktime,.mp3,.m4a,.wav,.ogg,.mp4"
              disabled={!!musicaEnviando}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarMusica(f); }}
              style={{ display: "block", width: "100%", fontSize: 12.5, color: RD.navy }}
            />
            <div style={{ fontSize: 11.5, color: RD.gray, marginTop: 6 }}>Até 40 MB. O corte acontece aqui no seu navegador — só o trecho sobe.</div>

            {musicaEnviando && (
              <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: RD.wine }}>
                {musicaEnviando === "preparando" ? "Extraindo o áudio e cortando o trecho…" : "Enviando para as TVs…"}
              </div>
            )}
            {musicaMsg && (
              <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: musicaMsg.ok ? "#0a7d3c" : "#b3261e", background: musicaMsg.ok ? "rgba(10,125,60,.08)" : "rgba(179,38,30,.07)", border: `1px solid ${musicaMsg.ok ? "rgba(10,125,60,.3)" : "rgba(179,38,30,.3)"}`, borderRadius: 8, padding: "8px 10px", lineHeight: 1.4 }}>
                {musicaMsg.texto}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
              {musica && (
                <button onClick={() => removerMusica()} disabled={!!musicaEnviando} title="Apaga a música e volta ao som sintetizado" style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#b3261e", background: "transparent", border: "1px solid rgba(179,38,30,.35)", borderRadius: 8, cursor: musicaEnviando ? "wait" : "pointer" }}>Voltar ao som padrão</button>
              )}
              <button onClick={() => setMusicaModal(false)} disabled={!!musicaEnviando} style={{ marginLeft: "auto", padding: "8px 18px", fontSize: 13, fontWeight: 700, color: "#fff", background: RD.wine, border: `1px solid ${RD.wine}`, borderRadius: 8, cursor: "pointer" }}>Fechar</button>
            </div>
          </div>
        </div>
      )}
      {/* LIXEIRA — arraste um card do cliente final aqui pra descartar; clique pra ver/restaurar */}
      <div
        onDragOver={(e) => { e.preventDefault(); if (arrastando) setSobreLixeira(true); }}
        onDragLeave={() => setSobreLixeira(false)}
        onDrop={(e) => { e.preventDefault(); if (arrastando) descartarCard(arrastando); }}
        onClick={() => { setLixeiraAberta(true); carregarLixeira(); }}
        title="Lixeira — arraste aqui o card de um cliente final pra descartar; clique pra ver/restaurar"
        style={{
          position: "fixed", right: 24, bottom: 24, zIndex: 250,
          width: arrastando ? 74 : 52, height: arrastando ? 74 : 52, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: arrastando ? 30 : 22, cursor: "pointer", userSelect: "none",
          background: sobreLixeira ? "#dc2626" : arrastando ? "#fee2e2" : RD.surface,
          color: sobreLixeira ? "#fff" : "#b91c1c",
          border: `2px ${arrastando ? "dashed" : "solid"} ${sobreLixeira ? "#dc2626" : "#f0b4b4"}`,
          boxShadow: "0 8px 24px rgba(16,32,64,.22)", transition: "all .15s",
        }}
      >
        🗑️
      </div>
      {lixeiraAberta && (
        <div onClick={() => setLixeiraAberta(false)} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(16,32,64,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: "100%", maxHeight: "80vh", background: RD.surface, borderRadius: 14, boxShadow: "0 20px 60px rgba(16,32,64,.35)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "15px 20px", borderBottom: `1px solid ${RD.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: "#b91c1c" }}>🗑️ Lixeira — descartados ({descartados.length})</span>
              <span onClick={() => setLixeiraAberta(false)} title="Fechar" style={{ cursor: "pointer", color: RD.gray, fontSize: 22, lineHeight: 1 }}>×</span>
            </div>
            <div style={{ padding: 12, overflow: "auto" }}>
              <div style={{ fontSize: 12, color: RD.grayLight, margin: "0 8px 10px", lineHeight: 1.5 }}>Clientes finais descartados (a empresa só atende profissionais). Ficam guardados por tempo indeterminado; "Restaurar" devolve ao funil.</div>
              {descartados.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: RD.grayLight, fontSize: 13 }}>Nenhum cliente descartado.</div>
              ) : descartados.map((d) => (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderBottom: `1px solid ${RD.bg}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: RD.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.cliente ?? `cliente ${d.codcli ?? ""}`}</div>
                    <div style={{ fontSize: 10.5, color: RD.grayLight }}>{d.motivo}{d.vendedor ? ` · ${cap(d.vendedor)}` : ""} · por {d.descartado_por}</div>
                  </div>
                  <button onClick={() => restaurarDescartado(d.id)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, color: RD.wine, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" }}>Restaurar</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (s: { role: string; carteira: string | null; papeis?: string[]; email?: string | null }) => void }) {
  const [erro, setErro] = useState("");
  const [gCarregando, setGCarregando] = useState(false);

  // mensagem de erro vinda do callback do Google (?erro=...)
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("erro");
    if (e === "nao_autorizado") setErro("E-mail não autorizado a acessar o funil.");
    else if (e === "oauth") setErro("Falha no login Google. Tente novamente.");
    else if (e === "config") setErro("Login Google ainda não configurado.");
    else if (e === "sem_carteira") setErro("Seu acesso está sem carteira definida.");
  }, []);

  async function entrarGoogle() {
    setErro("");
    setGCarregando(true);
    try {
      const { createBrowserClient } = await import("@supabase/ssr");
      const supa = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      await supa.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } });
    } catch (err: any) {
      setErro("Erro ao iniciar login Google: " + String(err?.message ?? err));
      setGCarregando(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 320, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 14, padding: 28, boxShadow: "0 8px 30px rgba(16,32,64,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <Logo size={32} />
          <b style={{ fontSize: 17 }}>CRM · Funil</b>
        </div>

        <button
          onClick={entrarGoogle}
          disabled={gCarregando}
          style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${RD.border}`, background: RD.surface, color: RD.navy, fontWeight: 600, fontSize: 13, cursor: gCarregando ? "wait" : "pointer", marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          {gCarregando ? "Redirecionando…" : "Entrar com Google"}
        </button>
        {erro && <div style={{ color: "#e5484d", fontSize: 12, marginTop: 10, textAlign: "center" }}>{erro}</div>}
      </div>
    </div>
  );
}
