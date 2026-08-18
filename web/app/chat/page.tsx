"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  useLigacao, BotaoLigar, BarraChamada, ChamadaRecebida, DesfechoLigacao, MarcoLigacao,
  type Ligacao,
} from "./ligacao";

// ---------------------------------------------------------------------------
// CHAT — ambiente de conversa estilo RD Conversas, layout inspirado no WhatsApp
// Web, identidade visual Murano (skill murano-brand). Paleta desta tela:
//   púrpura #7b2d8b  -> botões e ações (preferência sobre o laranja)
//   vinho   #621244  -> títulos, nomes, acentos de marca
//   azul    #1a5fa8  -> ticks de "lida" e links (pitada de azul do dev)
//   laranja #dd4222  -> COM MODERAÇÃO: só avisos (fora da janela) e falha
// ---------------------------------------------------------------------------
const M = {
  dark: "#1c0e1b",
  wine: "#621244",
  roxo: "#7b2d8b",
  roxoSoft: "#f1e6f4",
  azul: "#1a5fa8",
  laranja: "#dd4222",
  blush: "#e4d4d3",
  bg: "#f5edf4",
  bgThread: "#efe3ec",
  surface: "#ffffff",
  border: "#e0cfdb",
  ink: "#241327",
  muted: "#9a8098",
  gray: "#6f5c6d",
  bolhaFora: "#ecdcf0",   // mensagem enviada (operator) — púrpura bem claro
  bolhaDentro: "#ffffff", // mensagem recebida (customer)
};

// Mesma marca do board (app/page.tsx) — a barra de navegação do topo passou a ser
// a do CRM inteiro, como o RD faz: o Chat é uma aba do produto, não uma tela solta.
function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }} aria-label="Murano">
      <rect width="100" height="100" rx="18" fill="#57163f" />
      <path d="M31 74 C 31 48, 33 36, 47 28" fill="none" stroke="#e7d7dc" strokeWidth="9.5" strokeLinecap="round" />
      <path d="M53 74 C 53 48, 55 36, 69 28" fill="none" stroke="#e7d7dc" strokeWidth="9.5" strokeLinecap="round" />
    </svg>
  );
}

// as mesmas rotas do menu do board, na mesma ordem — quem vem do board não perde
// a referência ao entrar no chat
const NAV: { href: string; rotulo: string; soAdmin?: boolean }[] = [
  { href: "/", rotulo: "Negociações" },
  { href: "/chat", rotulo: "💬 Chat" },
  { href: "/relatorios", rotulo: "Relatórios" },
  { href: "/visoes", rotulo: "Visões" },
  { href: "/analises", rotulo: "Análises", soAdmin: true },
  { href: "/catalogos", rotulo: "Catálogo" },
  { href: "/tickets", rotulo: "Tickets" },
  { href: "/admin", rotulo: "⚙️ Administração", soAdmin: true },
];

// As "filas" da sidebar. No RD isto é o dropdown "Meus atendimentos" no alto da
// lista; aqui são os mesmos quatro estados que os chips antigos filtravam — só
// mudou a forma de escolher, não a regra (ver `filtradas`).
type Fila = "pendentes" | "todas" | "resolvidas" | "fila";
const FILAS: { k: Fila; icone: string; rotulo: string; dica: string }[] = [
  { k: "todas", icone: "💬", rotulo: "Meus atendimentos", dica: "conversas abertas sob sua responsabilidade" },
  { k: "pendentes", icone: "🔔", rotulo: "Mensagens não lidas", dica: "o cliente falou e ninguém leu ainda" },
  { k: "fila", icone: "🚶", rotulo: "Fila de espera", dica: "sem dono — qualquer um pode pegar" },
  { k: "resolvidas", icone: "✓", rotulo: "Encerradas", dica: "atendimentos já resolvidos" },
];

// Abas do contato — mesma posição das do RD (Perfil · Etiquetas · Atividades ·
// Funis · Carteiras · Histórico), com o conteúdo que NÓS temos: o ERP.
type AbaContato = "perfil" | "compras" | "ciclo" | "funil" | "notas";
const ABAS: { k: AbaContato; rotulo: string }[] = [
  { k: "perfil", rotulo: "Perfil" },
  { k: "compras", rotulo: "Compras" },
  { k: "ciclo", rotulo: "Ciclo" },
  { k: "funil", rotulo: "Funil" },
  { k: "notas", rotulo: "Notas fiscais" },
];

type Conversa = {
  cliente_id: string; cliente: string; vendedor: string | null; etapa: string | null;
  telefone: string | null; ultima_atividade: string | null;
  ultima_mensagem: string | null; ultima_enviada_por: string | null;
  nao_lida?: boolean; status?: string | null; motivo?: string | null;
  na_fila?: boolean;   // sem dono: qualquer um pode puxar
  // por qual NÚMERO a conversa corre (migration 0089): phone_number_id da Cloud
  // API, ou 'rd' para o número oficial, que é atendido pelo RD Conversas
  linha_id?: string;
  // `vendedor` já vem como o dono EFETIVO (depois da transferência); isto diz de
  // qual carteira ela veio, para o selo "recebida de fulano" (migration 0081)
  transferida_de?: string | null;
  // só nos resultados da busca por conteúdo
  trecho?: string; trecho_em?: string; de?: string; n?: number;
};

// Um número de WhatsApp e quantas conversas correm por ele. Vem pronto do
// servidor (/api/chat) já com o rótulo de `chat_linha`, para a sidebar e o
// cabeçalho da conversa chamarem o mesmo número pelo mesmo nome.
type LinhaResumo = { id: string; rotulo: string; numero: string | null; total: number };

// motivos de encerramento = a nossa tabulação (CLAUDE.md §6 e §18)
const MOTIVOS: { v: string; rotulo: string }[] = [
  { v: "venda_realizada", rotulo: "✅ Venda realizada" },
  { v: "tentativa_contato", rotulo: "📞 Tentativa de contato" },
  { v: "follow_up", rotulo: "🕗 Follow-up agendado" },
  { v: "sem_interesse", rotulo: "🚫 Sem interesse" },
  { v: "outro", rotulo: "• Outro" },
];
type Msg = {
  id: string; conteudo: string; enviada_por: string; tipo: string | null; status: string | null; criada_em: string;
  midia_tipo?: string | null; midia_mime?: string | null; midia_nome?: string | null; midia_path?: string | null;
  reacao?: string | null;      // emoji com que a cliente reagiu A ESTA mensagem
  resposta_a?: string | null;  // wamid da mensagem citada
};
// nota interna: recado da equipe dentro da conversa — o cliente nunca vê (0080)
type Nota = { id: number; autor: string; texto: string; criada_em: string };
// resposta rápida: texto nosso colado na caixa pelo atalho `/` — NÃO é template
// do WhatsApp (aquele mora em crm_templates e reabre a janela de 24h)
type Resposta = { id: number; atalho: string; titulo: string; corpo: string; carteira: string | null };
// passagem de bastão registrada: aparece na thread onde aconteceu (0081)
type Transferencia = {
  id: number; de_carteira: string | null; para_carteira: string;
  por: string; observacao: string | null; criada_em: string;
};
type Vendedor = { slug: string; cor: string | null };
// a thread mistura tudo na ordem do relógio: mensagens, notas internas,
// transferências e ligações (0087 — ligação NÃO é mensagem, ver a migration)
type Item =
  | { k: "m"; em: string; m: Msg }
  | { k: "n"; em: string; n: Nota }
  | { k: "t"; em: string; t: Transferencia }
  | { k: "l"; em: string; l: Ligacao };

// cor da nota interna: papel de recado, deliberadamente fora da paleta das bolhas
const NOTA = { bg: "#fdf6e3", borda: "#e8d9a8", ink: "#6b5a1f" };
// painel do contato: dados do WinThor ao lado da conversa (o RD não tem isso)
type Contato = {
  compras: { codcli: number | null; cidade: string | null; compras: number | null; ultima_compra: string | null;
             dias_sem_comprar: number | null; total_liquido: number | null; rca_oficial: string | null } | null;
  ciclo: { pct_ciclo: number | null; ciclo_medio: number | null; dias_ausente: number | null;
           tipo_oportunidade: string | null; acao_recomendada: string | null; tendencia: string | null } | null;
  funil: { etapa: string | null; venda_valor: number | null; venda_data: string | null; sem_cadastro: boolean | null } | null;
  ultimas_notas: { data_fat: string; valor: number; num_nota: string | number | null; filial: string | null }[];
};

const moedaBR = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dataBR = (d: string | null | undefined) =>
  d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—";

const cap = (s: any) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");
const horaBR = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
const diaBR = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const rotuloTempo = (iso: string | null) => {
  if (!iso) return "";
  const hoje = diaBR(new Date().toISOString());
  const d = diaBR(iso);
  return d === hoje ? horaBR(iso) : d.split("-").reverse().slice(0, 2).join("/");
};

// ---------------------------------------------------------------------------
// Mídia na bolha. O arquivo mora em bucket privado; /api/chat/midia devolve uma
// URL assinada por redirect, então <img>/<audio>/<video> apontam direto pra rota.
// Se `midia_path` está vazio, a mensagem chegou mas o download falhou — mostra
// aviso em vez de um player quebrado.
// ---------------------------------------------------------------------------
function Midia({ m }: { m: Msg }) {
  if (!m.midia_tipo) return null;
  const src = `/api/chat/midia?id=${encodeURIComponent(m.id)}`;
  const caixa = { borderRadius: 9, marginBottom: 4, display: "block" } as const;

  if (!m.midia_path) {
    return (
      <div style={{ fontSize: 11.5, color: M.laranja, background: "#fdeae3", border: "1px solid #f0c4b0", borderRadius: 8, padding: "5px 9px", marginBottom: 4 }}>
        ⚠️ {rotuloMidia(m.midia_tipo)} não pôde ser baixada
      </div>
    );
  }
  if (m.midia_tipo === "image" || m.midia_tipo === "sticker") {
    const max = m.midia_tipo === "sticker" ? 140 : 260;
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
        <img src={src} alt={m.conteudo || "imagem"} style={{ ...caixa, maxWidth: max, maxHeight: 300, objectFit: "cover", cursor: "zoom-in" }} />
      </a>
    );
  }
  if (m.midia_tipo === "audio") {
    return <audio controls preload="none" src={src} style={{ ...caixa, width: 240, height: 38 }} />;
  }
  if (m.midia_tipo === "video") {
    return <video controls preload="metadata" src={src} style={{ ...caixa, maxWidth: 260, maxHeight: 300 }} />;
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer"
       style={{ ...caixa, display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "rgba(123,45,139,.07)", border: `1px solid ${M.border}`, textDecoration: "none", color: M.ink, maxWidth: 250 }}>
      <span style={{ fontSize: 18 }}>📎</span>
      <span style={{ minWidth: 0 }}>
        <b style={{ display: "block", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {m.midia_nome || "documento"}
        </b>
        <span style={{ fontSize: 10.5, color: M.azul, fontWeight: 700 }}>abrir ↗</span>
      </span>
    </a>
  );
}
const rotuloMidia = (t: string) =>
  ({ image: "Imagem", audio: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha" }[t] ?? "Mídia");

// Trecho da mensagem achada na busca, recortado em volta do termo e com ele
// destacado — a mensagem inteira não cabe na linha da sidebar.
function Trecho({ texto, termo }: { texto: string; termo: string }) {
  const t = texto ?? "";
  const i = t.toLowerCase().indexOf(termo.toLowerCase());
  if (i < 0) return <>{t.slice(0, 90)}</>;
  const ini = Math.max(0, i - 28);
  const corte = t.slice(ini, i + termo.length + 60);
  const j = corte.toLowerCase().indexOf(termo.toLowerCase());
  return (
    <>
      {ini > 0 ? "…" : ""}
      {corte.slice(0, j)}
      <mark style={{ background: "#ffe9a8", color: M.ink, padding: "0 1px", borderRadius: 3 }}>
        {corte.slice(j, j + termo.length)}
      </mark>
      {corte.slice(j + termo.length)}
      {t.length > ini + corte.length ? "…" : ""}
    </>
  );
}

// ---------------------------------------------------------------------------
// Painel do contato — dados do ERP (WinThor) ao lado da conversa. É o que o RD
// Conversas nunca teve: o vendedor decide o que responder olhando o histórico de
// compra, sem trocar de tela.
// ---------------------------------------------------------------------------
function PainelContato({ c, aba, extra }: { c: Contato | null; aba: AbaContato; extra?: any }) {
  if (!c) return <div style={{ padding: 14, fontSize: 12, color: M.muted }}>Carregando dados do cliente…</div>;
  const { compras, ciclo, funil, ultimas_notas } = c;

  const Bloco = ({ titulo, children }: { titulo: string; children: any }) => (
    <div style={{ padding: "11px 14px", borderBottom: `1px solid ${M.border}` }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: M.muted, marginBottom: 6 }}>{titulo}</div>
      {children}
    </div>
  );
  const Linha = ({ r, v, forte }: { r: string; v: any; forte?: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "2px 0" }}>
      <span style={{ color: M.gray }}>{r}</span>
      <b style={{ color: forte ? M.wine : M.ink, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{v}</b>
    </div>
  );

  // barra do ciclo: quanto do intervalo médio de recompra já passou
  const pct = ciclo?.pct_ciclo == null ? null : Math.max(0, Math.min(140, Number(ciclo.pct_ciclo)));
  const corCiclo = pct == null ? M.muted : pct >= 100 ? M.laranja : pct >= 75 ? "#b8860b" : "#1a6b3c";

  // Aviso de "sem cadastro" só nas abas que dependem do ERP — a de Perfil ainda
  // mostra telefone/carteira/linha, que existem mesmo sem vínculo no WinThor.
  const semErp = !compras && !funil?.venda_valor && !ultimas_notas.length;
  const Vazio = ({ t }: { t: string }) => (
    <div style={{ padding: 14, fontSize: 12, color: M.muted, lineHeight: 1.5 }}>{t}</div>
  );

  return (
    <div style={{ fontSize: 12.5 }}>
      {aba === "perfil" && (
        <>
          <Bloco titulo="Contato">
            <Linha r="Telefone" v={extra?.telefone ?? "—"} />
            <Linha r="Carteira" v={extra?.carteira ? cap(extra.carteira) : "sem dono"} />
            {extra?.linha && <Linha r="Linha" v={extra.linha} />}
            <Linha r="Situação" v={extra?.status === "resolvida" ? "Encerrado" : "Em atendimento"} />
          </Bloco>
          {compras ? (
            <Bloco titulo="Cliente no WinThor">
              <Linha r="Código" v={compras.codcli ?? "—"} />
              {compras.cidade && <Linha r="Cidade" v={compras.cidade} />}
              {compras.rca_oficial && <Linha r="RCA oficial" v={compras.rca_oficial} />}
            </Bloco>
          ) : (
            <Vazio t="Sem cadastro no WinThor — contato ainda não vinculado a um cliente do ERP." />
          )}
        </>
      )}

      {aba === "compras" && (compras ? (
        <Bloco titulo="Histórico de compra">
          <Linha r="Compras" v={compras.compras ?? 0} />
          <Linha r="Total líquido" v={moedaBR(compras.total_liquido)} forte />
          <Linha r="Última compra" v={dataBR(compras.ultima_compra)} />
          <Linha r="Sem comprar há" v={compras.dias_sem_comprar != null ? `${compras.dias_sem_comprar} dias` : "—"} />
        </Bloco>
      ) : <Vazio t={semErp ? "Sem cadastro no WinThor — nada a mostrar aqui." : "Sem histórico de compra."} />)}

      {aba === "ciclo" && (ciclo && (ciclo.ciclo_medio != null || ciclo.acao_recomendada) ? (
        <Bloco titulo="Ciclo de recompra">
          {ciclo.ciclo_medio != null && <Linha r="Ciclo médio" v={`${Math.round(Number(ciclo.ciclo_medio))} dias`} />}
          {pct != null && (
            <>
              <div style={{ height: 6, borderRadius: 6, background: "#e6d8e4", overflow: "hidden", margin: "6px 0 4px" }}>
                <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: corCiclo }} />
              </div>
              <div style={{ fontSize: 11, color: corCiclo, fontWeight: 700 }}>
                {pct >= 100 ? "Passou do ciclo — hora de reativar" : `${Math.round(pct)}% do ciclo percorrido`}
              </div>
            </>
          )}
          {ciclo.acao_recomendada && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: M.ink, background: M.roxoSoft, borderRadius: 8, padding: "6px 9px", lineHeight: 1.4 }}>
              💡 {ciclo.acao_recomendada}
            </div>
          )}
        </Bloco>
      ) : <Vazio t="Ainda não dá para calcular o ciclo — o cliente precisa de mais de uma compra." />)}

      {aba === "funil" && (funil ? (
        <Bloco titulo="No funil">
          <Linha r="Etapa" v={cap(String(funil.etapa ?? "—").replace(/_/g, " "))} />
          {funil.venda_valor != null && <Linha r="Faturado no mês" v={moedaBR(funil.venda_valor)} forte />}
          {funil.venda_data && <Linha r="Data da venda" v={dataBR(funil.venda_data)} />}
        </Bloco>
      ) : <Vazio t="Este contato ainda não aparece no funil." />)}

      {aba === "notas" && (ultimas_notas.length ? (
        <Bloco titulo="Últimas notas">
          {ultimas_notas.map((n, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: M.gray }}>{dataBR(n.data_fat)}</span>
              <b>{moedaBR(n.valor)}</b>
            </div>
          ))}
        </Bloco>
      ) : <Vazio t="Nenhuma nota fiscal faturada para este cliente." />)}
    </div>
  );
}

// ticks estilo WhatsApp: wait ✓ · success ✓✓ · read/checked ✓✓ azul · failed !
function Ticks({ status }: { status: string | null }) {
  if (status === "failed") return <span style={{ color: M.laranja, fontWeight: 800 }}>!</span>;
  const lida = status === "read" || status === "checked";
  const duplo = lida || status === "success";
  return (
    <span style={{ color: lida ? M.azul : M.muted, letterSpacing: -2, fontWeight: 700 }}>
      {duplo ? "✓✓" : "✓"}
    </span>
  );
}

export default function Chat() {
  const [sessao, setSessao] = useState<{ role: string; carteira: string | null } | null | undefined>(undefined);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Conversa | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [filtro, setFiltro] = useState<Fila>("todas");
  const [menuFila, setMenuFila] = useState(false);      // dropdown "Meus atendimentos"
  const [ordem, setOrdem] = useState<"recente" | "antiga">("recente");
  const [menuOrdem, setMenuOrdem] = useState(false);
  const [menuAcoes, setMenuAcoes] = useState(false);    // kebab ⋮ do cabeçalho
  const [menuMobile, setMenuMobile] = useState(false);  // ☰ da barra de navegação
  const [abaContato, setAbaContato] = useState<AbaContato>("perfil");
  // estado do Realtime — ocupa no rodapé da lista a posição do "Online" do RD,
  // mas dizendo algo verdadeiro: se caiu, o chat depende do poll de 60s
  const [conectado, setConectado] = useState(false);
  const [puxando, setPuxando] = useState(false);
  const [resolvendo, setResolvendo] = useState(false);      // painel de motivo aberto
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [contato, setContato] = useState<Contato | null>(null);
  const [linha, setLinha] = useState<{ id: string | null; rotulo: string; canal: string } | null>(null);
  // presença: cliente_id -> rótulos de OUTRAS pessoas com a conversa aberta
  const [presentes, setPresentes] = useState<Record<string, string[]>>({});
  const presencaCanalRef = useRef<any>(null);
  // id desta ABA (chave de presença): permite ter várias abas abertas sem uma
  // derrubar o registro da outra
  const presencaIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()),
  );
  // como apareço para os outros. Sem e-mail: o canal é público (§15.4)
  const rotuloUsuario = !sessao
    ? ""
    : sessao.carteira
      ? cap(sessao.carteira)
      : sessao.role === "admin" ? "Admin" : "Supervisão";
  const [painelAberto, setPainelAberto] = useState(true);
  // --- P1: notas internas e respostas rápidas -------------------------------
  const [notas, setNotas] = useState<Nota[]>([]);
  const [modoNota, setModoNota] = useState(false);        // caixa escreve nota, não mensagem
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [picker, setPicker] = useState(false);            // lista de respostas aberta
  const [pickerIdx, setPickerIdx] = useState(0);          // item destacado (setas do teclado)
  const [novaAberta, setNovaAberta] = useState(false);    // formulário "nova resposta"
  const [novoAtalho, setNovoAtalho] = useState("");
  const [novoTitulo, setNovoTitulo] = useState("");
  // --- P1: transferência e busca no conteúdo --------------------------------
  const [transferencias, setTransferencias] = useState<Transferencia[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [transferindo, setTransferindo] = useState(false);  // painel de destino aberto
  const [obsTransf, setObsTransf] = useState("");
  // --- ligações (0087): entram na thread como marco, ao lado das transferências
  const [ligacoes, setLigacoes] = useState<Ligacao[]>([]);
  // --- filtro por NÚMERO (migration 0089): operamos Murano Pro e Murano Shop
  // ao mesmo tempo, e a sidebar precisa saber separar um do outro
  const [linhas, setLinhas] = useState<LinhaResumo[]>([]);
  const [linhaSel, setLinhaSel] = useState<string | null>(null);   // null = todos os números
  // filtro por VENDEDOR, como no board: só para quem enxerga mais de uma
  // carteira (admin/home). Vendedor já vê só a própria — chip seria redundante.
  const [vendFiltro, setVendFiltro] = useState<string | null>(null);
  const [achados, setAchados] = useState<Conversa[] | null>(null);  // busca no conteúdo
  const [buscandoMsgs, setBuscandoMsgs] = useState(false);
  const [truncado, setTruncado] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const textoRef = useRef<HTMLTextAreaElement>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const rolagemRef = useRef<HTMLDivElement>(null);   // área das mensagens (botões ⌃⌄)
  const selRef = useRef<Conversa | null>(null);
  selRef.current = sel;
  // guarda de in-flight: nunca empilha recargas (mesmo padrão do board)
  const carregandoLista = useRef(false);

  useEffect(() => {
    const mq = () => setIsMobile(window.innerWidth < 768);
    mq(); window.addEventListener("resize", mq);
    return () => window.removeEventListener("resize", mq);
  }, []);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSessao(j?.role ? { role: j.role, carteira: j.carteira ?? null } : null))
      .catch(() => setSessao(null));
  }, []);

  const carregarLista = useCallback(async () => {
    if (carregandoLista.current) return;
    carregandoLista.current = true;
    try {
      const r = await fetch("/api/chat", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok) {
        setConversas(j?.conversas ?? []);
        setVendedores(j?.vendedores ?? []);
        setLinhas(j?.linhas ?? []);
        setErro(null);
      }
      else if (r.status === 401) setSessao(null);
      else setErro(j?.error ?? `erro ${r.status}`);
    } finally { carregandoLista.current = false; }
  }, []);

  const carregarThread = useCallback(async (c: Conversa, scroll = true) => {
    const r = await fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(c.cliente_id)}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok) { setErro(j?.error ?? `erro ${r.status}`); return; }
    setMsgs(j?.mensagens ?? []);
    setNotas(j?.notas ?? []);
    setTransferencias(j?.transferencias ?? []);
    setLigacoes(j?.ligacoes ?? []);
    setLinha(j?.linha ?? null);
    if (scroll) setTimeout(() => fimRef.current?.scrollIntoView({ behavior: "auto" }), 30);
  }, []);

  // catálogo de respostas rápidas: carrega uma vez por sessão (muda raramente).
  // Vendedor recebe as da casa + as dele; admin/home recebem todas.
  const carregarRespostas = useCallback(async () => {
    try {
      const r = await fetch("/api/chat/respostas", { cache: "no-store" });
      if (r.ok) setRespostas((await r.json())?.respostas ?? []);
    } catch { /* sem respostas rápidas o chat funciona igual */ }
  }, []);

  // --- LIGAÇÃO (0087) -------------------------------------------------------
  // Todo o estado de chamada (WebRTC, campainha, sinalização) mora em ./ligacao.
  // Aqui só se diz o que fazer quando algo muda: recarregar a conversa aberta,
  // para o marco da ligação aparecer na thread na hora.
  const lig = useLigacao({
    sessao: sessao ?? null,
    aoMudar: useCallback(() => {
      carregarLista();
      if (selRef.current) carregarThread(selRef.current, false);
    }, [carregarLista, carregarThread]),
  });

  // carga inicial + poll lento (rede de proteção) + Realtime (mesmo canal do board)
  useEffect(() => {
    if (!sessao) return;
    carregarLista();
    carregarRespostas();
    const lento = setInterval(() => {
      carregarLista();
      if (selRef.current) carregarThread(selRef.current, false);
    }, 60_000);

    let canal: any = null;
    let canalPresenca: any = null;
    let cancelado = false;
    (async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) return;
      try {
        const { createBrowserClient } = await import("@supabase/ssr");
        if (cancelado) return;
        const supa = createBrowserClient(url, anon);
        canal = supa
          .channel("board")
          .on("broadcast", { event: "mudou" }, (msg: any) => {
            const cart = msg?.payload?.carteira ?? msg?.payload?.payload?.carteira ?? null;
            if (cart && sessao.carteira && cart !== sessao.carteira) return;
            carregarLista();
            if (selRef.current) carregarThread(selRef.current, false);
          })
          .subscribe((status: string) => setConectado(status === "SUBSCRIBED"));

        // ---- PRESENÇA (anti-colisão) ------------------------------------
        // Um canal só para todo o time: cada aba publica em qual conversa está,
        // e todos veem. Com ~7 pessoas isso é barato — um canal por conversa
        // exigiria entrar e sair a cada clique.
        //
        // O payload NÃO leva e-mail: só um rótulo de exibição e um id aleatório
        // de aba. O canal é público (mesma razão do `board`, §15.4), então nada
        // de identificável vai nele.
        canalPresenca = supa.channel("chat-presenca", {
          config: { presence: { key: presencaIdRef.current } },
        });
        const recalcular = () => {
          const estado = canalPresenca.presenceState() as Record<string, any[]>;
          const porConversa: Record<string, string[]> = {};
          for (const metas of Object.values(estado)) {
            for (const m of metas as any[]) {
              // filtra pelo RÓTULO, não pela chave da aba: assim minhas outras
              // abas não aparecem como se fossem outra pessoa
              if (!m?.cliente_id || !m?.rotulo || m.rotulo === rotuloUsuario) continue;
              const lista = (porConversa[m.cliente_id] ??= []);
              if (!lista.includes(m.rotulo)) lista.push(m.rotulo);
            }
          }
          setPresentes(porConversa);
        };
        canalPresenca
          .on("presence", { event: "sync" }, recalcular)
          .on("presence", { event: "join" }, recalcular)
          .on("presence", { event: "leave" }, recalcular)
          .subscribe((status: string) => {
            if (status === "SUBSCRIBED") {
              presencaCanalRef.current = canalPresenca;
              // publica onde estou agora (pode já haver conversa aberta)
              canalPresenca.track({ rotulo: rotuloUsuario, cliente_id: selRef.current?.cliente_id ?? null });
            }
          });
      } catch { /* sem realtime: o poll de 60s cobre, e a presença some sem quebrar nada */ }
    })();

    return () => {
      cancelado = true;
      clearInterval(lento);
      setConectado(false);
      try { canal?.unsubscribe(); } catch {}
      try { canalPresenca?.unsubscribe(); } catch {}
      presencaCanalRef.current = null;
    };
  }, [sessao, carregarLista, carregarThread, carregarRespostas, rotuloUsuario]);

  // republica a presença sempre que troco de conversa (ou fecho a thread)
  useEffect(() => {
    const c = presencaCanalRef.current;
    if (!c) return;
    try { c.track({ rotulo: rotuloUsuario, cliente_id: sel?.cliente_id ?? null }); } catch {}
  }, [sel?.cliente_id, rotuloUsuario]);

  // aviso no título da aba: "(3) Chat" — o vendedor percebe sem estar na tela
  const naoLidas = conversas.filter((c) => c.nao_lida).length;
  useEffect(() => {
    document.title = naoLidas ? `(${naoLidas}) Chat — Murano` : "Chat — Murano";
  }, [naoLidas]);

  // som + notificação do sistema quando CHEGA mensagem nova (não no primeiro
  // carregamento, senão apitaria ao abrir a tela com conversas pendentes).
  const naoLidasAnterior = useRef<number | null>(null);
  useEffect(() => {
    const antes = naoLidasAnterior.current;
    naoLidasAnterior.current = naoLidas;
    if (antes === null || naoLidas <= antes) return;
    // bipe curto via WebAudio: não depende de arquivo de áudio hospedado
    try {
      const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator(), ganho = ctx.createGain();
        osc.connect(ganho); ganho.connect(ctx.destination);
        osc.frequency.value = 880; osc.type = "sine";
        ganho.gain.setValueAtTime(0.0001, ctx.currentTime);
        ganho.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
        ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
        osc.start(); osc.stop(ctx.currentTime + 0.36);
        setTimeout(() => ctx.close().catch(() => {}), 600);
      }
    } catch { /* navegador sem WebAudio ou sem gesto do usuário ainda: silencioso */ }
    // notificação do sistema só se o usuário já autorizou e a aba não está à frente
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        new Notification("Nova mensagem no Chat", {
          body: `${naoLidas} conversa${naoLidas > 1 ? "s" : ""} aguardando resposta`,
          tag: "chat-murano",
        });
      }
    } catch { /* idem */ }
  }, [naoLidas]);

  // pede permissão de notificação uma única vez, no primeiro clique do usuário
  // (navegador exige gesto; pedir na carga da página costuma ser negado)
  useEffect(() => {
    const pedir = () => {
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
      } catch {}
      window.removeEventListener("click", pedir);
    };
    window.addEventListener("click", pedir);
    return () => window.removeEventListener("click", pedir);
  }, []);

  // busca no CONTEÚDO das mensagens. O filtro por nome/telefone continua local e
  // instantâneo; esta vai ao servidor, com 400ms de folga para não disparar uma
  // consulta por tecla. Mínimo de 3 letras: abaixo disso o índice trigrama não é
  // usado e a busca viraria varredura de 72 mil linhas (migration 0081).
  useEffect(() => {
    const q = busca.trim();
    if (q.length < 3) { setAchados(null); setBuscandoMsgs(false); setTruncado(false); return; }
    let vivo = true;
    setBuscandoMsgs(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/chat/buscar?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!vivo) return;
        setAchados(r.ok ? (j?.conversas ?? []) : []);
        setTruncado(!!j?.truncado);
      } catch {
        if (vivo) setAchados([]);
      } finally {
        if (vivo) setBuscandoMsgs(false);
      }
    }, 400);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca]);

  // passa a conversa para outro vendedor. Não mexe na carteira do cliente (essa
  // vem do RCA do WinThor) — só em quem atende o diálogo daqui pra frente.
  async function transferir(para: string) {
    if (!sel) return;
    setTransferindo(false);
    try {
      const r = await fetch("/api/chat/transferir", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, para, observacao: obsTransf.trim() || undefined }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setAviso(j?.error ?? `erro ${r.status}`); return; }
      setObsTransf("");
      setTransferencias((ts) => [...ts, j.transferencia]);
      // se saiu da minha carteira, ela deixa a minha lista — fecha a thread para
      // não ficar uma conversa aberta que já não é mais minha
      const minha = sessao?.carteira ?? null;
      if (minha && para !== minha) {
        setSel(null); setMsgs(null); setNotas([]); setTransferencias([]);
      } else {
        // admin/home continuam vendo: acompanha o novo dono no cabeçalho
        setSel((s) => (s ? { ...s, vendedor: para, transferida_de: s.vendedor } : s));
      }
      carregarLista();
    } catch (e: any) {
      setAviso(`Não consegui transferir: ${e?.message ?? e}`);
    }
  }

  function abrir(c: Conversa) {
    setSel(c); setMsgs(null); setNotas([]); setTransferencias([]); setAviso(null);
    setResolvendo(false); setContato(null); setTransferindo(false);
    setModoNota(false); setPicker(false); setNovaAberta(false);
    setMenuAcoes(false); setAbaContato("perfil");
    carregarThread(c);
    // painel do contato (WinThor) — falha aqui não atrapalha a conversa
    fetch(`/api/chat/contato?cliente_id=${encodeURIComponent(c.cliente_id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setContato(j ?? null))
      .catch(() => setContato(null));
    // marca como lida (otimista na lista; o servidor guarda a marca por usuário)
    if (c.nao_lida) {
      setConversas((cs) => cs.map((x) => (x.cliente_id === c.cliente_id ? { ...x, nao_lida: false } : x)));
    }
    fetch("/api/chat/lida", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cliente_id: c.cliente_id }),
    }).catch(() => { /* silencioso: a marca é conveniência, não bloqueia o uso */ });
  }

  // puxar da fila: "pegar" é uma transferência de ninguém para mim. Reaproveita
  // /api/chat/transferir (append-only), que aceita origem nula justamente por isso.
  async function puxarDaFila() {
    if (!sel || !sessao?.carteira || puxando) return;
    setPuxando(true); setAviso(null);
    try {
      const r = await fetch("/api/chat/transferir", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, para: sessao.carteira, observacao: "puxou da fila" }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setAviso(j?.error ?? `erro ${r.status}`); return; }
      setSel({ ...sel, na_fila: false, vendedor: sessao.carteira });
      await carregarLista();
      await carregarThread(sel, false);
    } catch (e: any) {
      setAviso(`Não consegui puxar: ${e?.message ?? e}`);
    } finally { setPuxando(false); }
  }

  // resolver / reabrir a conversa (o substituto do "fechar atendimento" do RD)
  async function mudarStatus(status: "aberta" | "resolvida", motivo?: string) {
    if (!sel) return;
    const antes = sel.status ?? "aberta";
    setSel({ ...sel, status, motivo: motivo ?? null });
    setConversas((cs) => cs.map((x) => (x.cliente_id === sel.cliente_id ? { ...x, status, motivo: motivo ?? null } : x)));
    setResolvendo(false);
    try {
      const r = await fetch("/api/chat/status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, status, motivo }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `erro ${r.status}`);
    } catch (e: any) {
      setSel((s) => (s ? { ...s, status: antes } : s));   // desfaz o otimismo
      setAviso(`Não consegui mudar o status: ${e?.message ?? e}`);
    }
  }

  // ---- gravação de áudio (como no WhatsApp / RD) --------------------------
  // ARMADILHA DE FORMATO, medida no primeiro teste (16/08): o WhatsApp aceita
  // Opus só dentro de Ogg e AAC só dentro de MP4. Pedir `audio/mp4` ao Chrome
  // devolve OPUS dentro de MP4 — combinação que a Graph API aceita no upload e
  // depois não entrega, virando `status: failed` sem erro no envio.
  //
  // A ordem abaixo é o que cada navegador consegue gravar, do melhor para o
  // pior, e nenhuma opção é um beco sem saída:
  //   ogg/opus  → Firefox: já é o formato final, segue direto
  //   webm/opus → Chrome/Edge: MESMO codec, container errado; o servidor
  //               reescreve o container (lib/opusOgg.ts) antes de enviar
  //   mp4/AAC   → Safari, que não grava webm; AAC é aceito como audio/mp4
  // `audio/mp4` sem codec explícito ficou de fora de propósito: é justamente o
  // que produz o Opus-em-MP4 no Chrome.
  const FORMATOS_AUDIO = [
    "audio/ogg;codecs=opus",
    "audio/webm;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
  ];
  const recRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);

  async function alternarGravacao() {
    if (gravando) { recRef.current?.stop(); return; }
    if (!sel) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = FORMATOS_AUDIO.find((f) => (window as any).MediaRecorder?.isTypeSupported?.(f)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      pedacosRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) pedacosRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        const tipo = rec.mimeType || mime || "audio/ogg";
        const blob = new Blob(pedacosRef.current, { type: tipo });
        if (blob.size < 1200) { setAviso("Áudio muito curto — segure mais tempo."); return; }
        const ext = tipo.includes("ogg") ? "ogg" : tipo.includes("mp4") ? "m4a" : tipo.includes("aac") ? "aac" : "webm";
        await enviarArquivo(new File([blob], `audio-${Date.now()}.${ext}`, { type: tipo.split(";")[0] }));
      };
      recRef.current = rec;
      rec.start();
      setGravando(true); setSegundos(0); setAviso(null);
    } catch {
      setAviso("Não consegui acessar o microfone — verifique a permissão do navegador.");
    }
  }

  // cronômetro da gravação
  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [gravando]);

  function cancelarGravacao() {
    const rec = recRef.current;
    if (!rec) return;
    rec.onstop = () => { rec.stream.getTracks().forEach((t) => t.stop()); setGravando(false); };
    rec.stop();
    pedacosRef.current = [];
  }

  // envio de arquivo (foto, áudio, documento) pelo canal WhatsApp direto
  async function enviarArquivo(file: File) {
    if (!sel || enviandoArquivo) return;
    setEnviandoArquivo(true); setAviso(null);
    try {
      const fd = new FormData();
      fd.set("cliente_id", sel.cliente_id);
      fd.set("arquivo", file);
      if (texto.trim()) fd.set("legenda", texto.trim());
      const r = await fetch("/api/chat/enviar-midia", { method: "POST", body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setAviso(j?.foraDaJanela
          ? "Fora da janela de 24h — envie um TEMPLATE para reabrir a conversa."
          : (j?.error ?? `erro ${r.status}`));
      } else {
        setTexto("");
        carregarThread(sel, true);
        carregarLista();
      }
    } catch (e: any) {
      setAviso(`Falha ao enviar arquivo: ${e?.message ?? e}`);
    } finally {
      setEnviandoArquivo(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  // template de recontato — reabre conversa fora da janela sem sair do chat
  async function enviarTemplate() {
    if (!sel || enviando) return;
    setEnviando(true); setAviso(null);
    try {
      const r = await fetch("/api/send-template", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) setAviso(j?.error ?? `erro ${r.status}`);
      else { carregarThread(sel, true); carregarLista(); }
    } finally { setEnviando(false); }
  }

  // ---- notas internas ------------------------------------------------------
  // Não passam pelo WhatsApp: gravam em chat_nota e aparecem só aqui. É o recado
  // que antes ia parar no caderno do vendedor ou num grupo paralelo.
  async function enviarNota() {
    const t = texto.trim();
    if (!t || !sel || enviando) return;
    setEnviando(true); setAviso(null);
    try {
      const r = await fetch("/api/chat/notas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, texto: t }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) setAviso(j?.error ?? `erro ${r.status}`);
      else {
        setNotas((n) => [...n, j.nota]);
        setTexto("");
        setTimeout(() => fimRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
      }
    } finally { setEnviando(false); }
  }

  async function apagarNota(id: number) {
    const antes = notas;
    setNotas((n) => n.filter((x) => x.id !== id));     // otimista
    try {
      const r = await fetch("/api/chat/notas", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `erro ${r.status}`);
    } catch (e: any) {
      setNotas(antes);                                  // desfaz
      setAviso(`Não consegui apagar a nota: ${e?.message ?? e}`);
    }
  }

  // ---- respostas rápidas ---------------------------------------------------
  function inserirResposta(r: Resposta) {
    setTexto(r.corpo);
    setPicker(false); setNovaAberta(false);
    setTimeout(() => {
      const el = textoRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 10);
  }

  // salva o que está escrito na caixa como uma resposta nova. Vendedor cria a
  // dele; admin/home criam a da casa — quem decide é o servidor, pela sessão.
  async function salvarResposta() {
    const corpo = texto.trim();
    if (!corpo || corpo.startsWith("/")) return;
    try {
      const r = await fetch("/api/chat/respostas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atalho: novoAtalho, titulo: novoTitulo || corpo.slice(0, 40), corpo }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setAviso(j?.error ?? `erro ${r.status}`); return; }
      setRespostas((rs) => [...rs, j.resposta].sort((a, b) => a.atalho.localeCompare(b.atalho)));
      setNovaAberta(false); setNovoAtalho(""); setNovoTitulo("");
    } catch (e: any) {
      setAviso(`Não consegui salvar a resposta: ${e?.message ?? e}`);
    }
  }

  async function apagarResposta(r: Resposta) {
    if (!confirm(`Apagar a resposta rápida /${r.atalho}?`)) return;
    const antes = respostas;
    setRespostas((rs) => rs.filter((x) => x.id !== r.id));
    try {
      const res = await fetch("/api/chat/respostas", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `erro ${res.status}`);
    } catch (e: any) {
      setRespostas(antes);
      setAviso(`Não consegui apagar: ${e?.message ?? e}`);
    }
  }

  // digitar `/` (ou `/algo`, sem espaço) no início da caixa abre a lista
  function aoDigitar(v: string) {
    setTexto(v);
    if (modoNota) { setPicker(false); return; }
    const ehAtalho = /^\/[a-zA-Z0-9]*$/.test(v);
    setPicker(ehAtalho);
    if (ehAtalho) setPickerIdx(0);
  }

  async function enviar() {
    const t = texto.trim();
    if (!t || !sel || enviando) return;
    setEnviando(true); setAviso(null);
    // otimista: aparece na hora com tick de espera; o refresh confirma
    const otimista: Msg = { id: `tmp:${Date.now()}`, conteudo: t, enviada_por: "operator", tipo: "mensagem", status: "wait", criada_em: new Date().toISOString() };
    setMsgs((m) => [...(m ?? []), otimista]);
    setTexto("");
    setTimeout(() => fimRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
    try {
      const r = await fetch("/api/send-message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, texto: t }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setMsgs((m) => (m ?? []).filter((x) => x.id !== otimista.id));
        setAviso(j?.foraDaJanela
          ? "Fora da janela de 24h do WhatsApp — use o botão TEMPLATE aqui do lado para reabrir a conversa."
          : (j?.error ?? `erro ${r.status}`));
        setTexto(t); // devolve o texto pro campo
      } else {
        carregarThread(sel, false);
        carregarLista();
      }
    } finally { setEnviando(false); }
  }

  if (sessao === undefined) return <div style={{ padding: 40, color: M.gray, fontSize: 14, background: M.bg, minHeight: "100vh" }}>Verificando sessão…</div>;
  if (sessao === null) {
    return (
      <div style={{ minHeight: "100vh", background: M.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: M.ink }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Chat</div>
        <div style={{ color: M.gray, fontSize: 14 }}>Sessão expirada — entre pelo funil e volte.</div>
        <Link href="/" style={{ color: M.azul, fontSize: 14, textDecoration: "none" }}>← ir para o login</Link>
      </div>
    );
  }

  // ---- os dois seletores do topo da sidebar: número e vendedor -------------
  // Eles CRUZAM com as filas em vez de substituí-las ("pendentes do Murano Shop",
  // "encerradas da Kamilly" são perguntas legítimas), e cruzam entre si.
  //
  // A fila de espera escapa do filtro por vendedor de propósito: conversa sem
  // dono não pertence a carteira nenhuma — escondê-la ao escolher um vendedor
  // faria sumir justamente o que qualquer um pode pegar.
  const daLinha = (c: Conversa) => !linhaSel || (c.linha_id ?? "rd") === linhaSel;
  const doVendedor = (c: Conversa) => !vendFiltro || c.na_fila || c.vendedor === vendFiltro;

  // bases cruzadas: cada seletor conta DENTRO do que o outro já escolheu, senão
  // o chip promete 12 e a lista mostra 3
  const baseVend = conversas.filter(doVendedor);
  const baseLinha = conversas.filter(daLinha);
  const noEscopo = conversas.filter((c) => daLinha(c) && doVendedor(c));

  const contaPorLinha = new Map<string, number>();
  for (const c of baseVend) contaPorLinha.set(c.linha_id ?? "rd", (contaPorLinha.get(c.linha_id ?? "rd") ?? 0) + 1);

  // vendedores que REALMENTE têm conversa aqui — a lista de carteira_config
  // traz gente sem nenhuma, e chip que filtra para o vazio só atrapalha
  const coresVend = new Map(vendedores.map((v) => [v.slug, v.cor]));
  const vendedoresComConversa = [...new Set(baseLinha.filter((c) => !c.na_fila && c.vendedor).map((c) => c.vendedor as string))]
    .sort()
    .map((slug) => ({
      slug,
      cor: coresVend.get(slug) ?? null,
      total: baseLinha.filter((c) => !c.na_fila && c.vendedor === slug).length,
    }));

  const filtradas = noEscopo.filter((c) => {
    const st = c.status ?? "aberta";
    // a fila é uma aba própria: sem dono, não polui as listas de quem tem dono
    if (filtro === "fila" ? !c.na_fila : c.na_fila) return false;
    if (filtro === "pendentes" && !(st === "aberta" && c.nao_lida)) return false;
    if (filtro === "resolvidas" && st !== "resolvida") return false;
    if (filtro === "todas" && st === "resolvida") return false; // resolvida sai da fila
    if (!busca.trim()) return true;
    const b = busca.toLowerCase();
    return (c.cliente ?? "").toLowerCase().includes(b) || String(c.telefone ?? "").includes(b.replace(/\D/g, "") || " ");
  });
  // ordenação da lista — o "Mais recente ▾" do RD. Só reordena o que já veio do
  // servidor; nenhum filtro muda com isso.
  const ordenadas = [...filtradas].sort((a, b) => {
    const x = a.ultima_atividade ?? "", y = b.ultima_atividade ?? "";
    return ordem === "recente" ? (x < y ? 1 : x > y ? -1 : 0) : (x < y ? -1 : x > y ? 1 : 0);
  });
  // contadores das filas seguem os seletores (`noEscopo`), não o total geral.
  // O badge do TÍTULO da aba (`naoLidas`) continua global de propósito: ele
  // avisa que chegou mensagem, e não pode calar por causa de um filtro na tela.
  const contaResolvidas = noEscopo.filter((c) => (c.status ?? "aberta") === "resolvida" && !c.na_fila).length;
  const contaFila = noEscopo.filter((c) => c.na_fila).length;
  const contaPendentes = noEscopo.filter((c) => c.nao_lida && !c.na_fila).length;
  // resultados da busca por conteúdo que a lista local já não mostrou pelo nome
  const jaNaLista = new Set(ordenadas.map((c) => c.cliente_id));
  // a busca no conteúdo respeita o filtro por vendedor (o servidor devolve o
  // dono efetivo). Não respeita o de número: o resultado vem de `mensagens` sem
  // passar pela view de linha, e inventar um palpite aqui seria pior que trazer
  // a conversa e deixar o cabeçalho dela dizer por qual número ela corre.
  const achadosNovos = (achados ?? [])
    .filter((c) => !jaNaLista.has(c.cliente_id))
    .filter((c) => !vendFiltro || c.vendedor === vendFiltro);

  const mostraLista = !isMobile || !sel;
  const mostraThread = !isMobile || !!sel;

  // thread = mensagens + notas internas + transferências na mesma linha do tempo
  // (nome explícito: `linha` sozinho agora significa a LINHA TELEFÔNICA em todo
  //  o projeto — chat_linha, linha_id, linhaDeEnvio)
  const linhaDoTempo: Item[] = [
    ...(msgs ?? []).map((m) => ({ k: "m" as const, em: m.criada_em, m })),
    ...notas.map((n) => ({ k: "n" as const, em: n.criada_em, n })),
    ...transferencias.map((t) => ({ k: "t" as const, em: t.criada_em, t })),
    ...ligacoes.map((l) => ({ k: "l" as const, em: l.iniciada_em, l })),
  ].sort((a, b) => (a.em < b.em ? -1 : a.em > b.em ? 1 : 0));

  const grupos: { dia: string; itens: Item[] }[] = [];
  for (const it of linhaDoTempo) {
    const d = diaBR(it.em);
    const g = grupos[grupos.length - 1];
    if (g && g.dia === d) g.itens.push(it);
    else grupos.push({ dia: d, itens: [it] });
  }

  // respostas rápidas visíveis no picker: filtradas pelo que veio depois da `/`
  const termo = texto.startsWith("/") ? texto.slice(1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const respostasFiltradas = respostas.filter(
    (r) => !termo || r.atalho.includes(termo) || r.titulo.toLowerCase().includes(termo),
  );
  const idxAtual = Math.min(pickerIdx, Math.max(0, respostasFiltradas.length - 1));
  const podeSalvar = !!texto.trim() && !texto.startsWith("/");

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: M.bg, color: M.ink, fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* ---- LIGAÇÃO (0087) — camadas flutuantes, fora do fluxo da tela --------
          Ficam aqui, no topo do componente, e não dentro da thread: a chamada
          sobrevive à troca de conversa e continua visível se o vendedor for
          mexer em outro atendimento no meio dela. */}
      {lig.recebida && (
        <ChamadaRecebida c={lig.recebida} ocupado={lig.ocupado}
          onAtender={lig.atender} onRecusar={lig.recusar} />
      )}
      {lig.chamada && (
        <BarraChamada c={lig.chamada} estadoRtc={lig.estadoRtc} mudo={lig.mudo}
          onMudo={lig.alternarMudo} onDesligar={lig.desligar} />
      )}
      {lig.desfechoDe && <DesfechoLigacao c={lig.desfechoDe} onSalvar={lig.salvarDesfecho} />}
      {lig.erro && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 75, maxWidth: 460,
            background: "#fdeae3", color: "#8a2f12", border: "1px solid #f0c4b0", borderRadius: 10,
            padding: "9px 14px", fontSize: 12.5, lineHeight: 1.45,
            boxShadow: "0 6px 20px rgba(28,14,27,0.18)" }}>
          <div onClick={lig.limparErro} title="clique para fechar" style={{ cursor: "pointer" }}>
            📞 {lig.erro}
          </div>
          {/* sem autorização o erro vira AÇÃO: o pedido é o caminho que a própria
              API indica, e a cota (1/dia) justifica ser um clique consciente */}
          {lig.pedirPara && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 8 }}>
              <button onClick={lig.pedirPermissao} disabled={lig.ocupado}
                style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: M.roxo, border: "none",
                  borderRadius: 999, padding: "6px 14px", cursor: lig.ocupado ? "default" : "pointer",
                  opacity: lig.ocupado ? 0.6 : 1, fontFamily: "inherit" }}>
                {lig.ocupado ? "…" : "Pedir autorização"}
              </button>
              <span style={{ fontSize: 10.5, opacity: 0.85 }}>
                1 pedido por dia, 2 por semana
              </span>
            </div>
          )}
        </div>
      )}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${M.laranja}, ${M.wine}, ${M.roxo})` }} />
      {/* ---- barra de navegação do produto (posição do menu do RD Conversas) ----
          Logo à esquerda, abas horizontais do CRM no meio, identidade à direita.
          O Chat vira uma aba do produto, com a aba ativa sublinhada. */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", minHeight: 52, background: M.surface, borderBottom: `1px solid ${M.border}`, flexShrink: 0 }}>
        <Logo size={26} />
        <b style={{ fontSize: 16, letterSpacing: 0.2, color: M.wine }}>CRM</b>
        {!isMobile ? (
          <nav style={{ display: "flex", alignItems: "center", alignSelf: "stretch", gap: 2, marginLeft: 8, minWidth: 0, overflowX: "auto" }}>
            {NAV.filter((n) => !n.soAdmin || sessao.role === "admin").map((n) => {
              const ativo = n.href === "/chat";
              return (
                <Link key={n.href} href={n.href}
                  style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", textDecoration: "none",
                    fontSize: 14, fontWeight: ativo ? 800 : 600, color: ativo ? M.roxo : M.gray,
                    padding: "0 10px", borderBottom: `2px solid ${ativo ? M.roxo : "transparent"}` }}>
                  {n.rotulo}
                </Link>
              );
            })}
          </nav>
        ) : (
          <button onClick={() => setMenuMobile((v) => !v)} title="Menu"
            style={{ width: 38, height: 32, borderRadius: 8, border: `1px solid ${M.border}`, background: M.surface, color: M.wine, fontSize: 17, cursor: "pointer", fontFamily: "inherit" }}>
            ☰
          </button>
        )}
        <Link href="/chat/indicadores" title="Tempo de resposta e encerramentos por vendedor"
          style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: M.wine, textDecoration: "none",
            background: M.roxoSoft, border: `1px solid ${M.border}`, borderRadius: 999, padding: "5px 12px", whiteSpace: "nowrap", flexShrink: 0 }}>
          📊 Indicadores
        </Link>
        {/* identidade — mesma posição do avatar do RD, no canto direito */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#f7eef4", border: "1px solid #e8d8e1", borderRadius: 20, padding: "4px 12px 4px 5px", flexShrink: 0 }}>
          <span style={{ width: 22, height: 22, borderRadius: 20, background: M.wine, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>
            {rotuloUsuario.charAt(0) || "?"}
          </span>
          {!isMobile && <b style={{ fontSize: 12.5, color: M.wine }}>{rotuloUsuario}</b>}
        </span>
        {menuMobile && isMobile && (
          <>
            <div onClick={() => setMenuMobile(false)} style={{ position: "fixed", inset: 0, zIndex: 100 }} />
            <div style={{ position: "absolute", top: "100%", left: 12, zIndex: 101, minWidth: 210, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(28,14,27,.20)", overflow: "hidden" }}>
              {NAV.filter((n) => !n.soAdmin || sessao.role === "admin").map((n) => (
                <Link key={n.href} href={n.href} onClick={() => setMenuMobile(false)}
                  style={{ display: "block", padding: "10px 13px", fontSize: 13.5, fontWeight: 600, color: n.href === "/chat" ? M.roxo : M.ink, textDecoration: "none", borderBottom: `1px solid ${M.bg}` }}>
                  {n.rotulo}
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* ---- sidebar: lista de conversas ---- */}
        {mostraLista && (
          <div style={{ width: isMobile ? "100%" : 340, flexShrink: 0, display: "flex", flexDirection: "column", background: M.surface, borderRight: `1px solid ${M.border}` }}>
            {/* ---- cabeçalho da lista, no arranjo do RD ----
                1) título-dropdown com as filas e seus contadores
                2) campo de busca (lupa à direita)
                3) ordenação alinhada à direita ("Mais recente") */}
            <div style={{ padding: "8px 10px 6px", borderBottom: `1px solid ${M.border}`, display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setMenuFila((v) => !v)} title="Trocar de fila"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "2px 0", minWidth: 0 }}>
                  <b style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {FILAS.find((f) => f.k === filtro)?.rotulo}
                  </b>
                  <span style={{ fontSize: 11, color: M.gray, opacity: 0.8 }}>▾</span>
                </button>
                {/* atalho da fila de espera, como o ícone com contador do RD */}
                <button onClick={() => setFiltro("fila")} title="Fila de espera — conversas sem dono"
                  style={{ marginLeft: "auto", position: "relative", background: "transparent", border: "none", cursor: "pointer", fontSize: 17, lineHeight: 1, padding: "2px 4px", fontFamily: "inherit", opacity: filtro === "fila" ? 1 : 0.75 }}>
                  🚶
                  {contaFila > 0 && (
                    <span style={{ position: "absolute", top: -3, right: -4, minWidth: 15, height: 15, padding: "0 3px", boxSizing: "border-box", borderRadius: 15, background: M.laranja, color: "#fff", fontSize: 9.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {contaFila}
                    </span>
                  )}
                </button>
                {menuFila && (
                  <>
                    <div onClick={() => setMenuFila(false)} style={{ position: "fixed", inset: 0, zIndex: 100 }} />
                    <div style={{ position: "absolute", top: "calc(100% + 5px)", left: 0, zIndex: 101, minWidth: 262, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(28,14,27,.20)", overflow: "hidden" }}>
                      {FILAS.map((f) => {
                        const n = f.k === "pendentes" ? contaPendentes
                          : f.k === "fila" ? contaFila
                          : f.k === "resolvidas" ? contaResolvidas
                          : noEscopo.filter((c) => !c.na_fila).length - contaResolvidas;
                        const on = filtro === f.k;
                        return (
                          <button key={f.k} onClick={() => { setFiltro(f.k); setMenuFila(false); }} title={f.dica}
                            style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "9px 12px", background: on ? M.roxoSoft : "transparent", border: "none", borderBottom: `1px solid ${M.bg}`, cursor: "pointer", fontFamily: "inherit" }}>
                            <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>{f.icone}</span>
                            <span style={{ flex: 1, fontSize: 13, fontWeight: on ? 800 : 600, color: on ? M.wine : M.ink }}>{f.rotulo}</span>
                            {n > 0 && (
                              <span style={{ minWidth: 20, padding: "1px 6px", borderRadius: 999, background: f.k === "pendentes" || f.k === "fila" ? M.laranja : M.roxoSoft, color: f.k === "pendentes" || f.k === "fila" ? "#fff" : M.wine, fontSize: 10.5, fontWeight: 800, textAlign: "center" }}>
                                {n}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <div style={{ position: "relative" }}>
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar conversa…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 32px 8px 12px", fontSize: 13, fontFamily: "inherit", color: M.ink, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 10, outline: "none" }}
                />
                <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: M.muted, pointerEvents: "none" }}>🔍</span>
              </div>

              {/* ---- seletor de NÚMERO (migration 0089) ----
                  Só aparece quando existe mais de um número com conversa: numa
                  operação de linha única ele seria ruído puro. Cruza com as
                  filas acima em vez de substituí-las. */}
              {linhas.length > 1 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                  <span title="Filtrar por número de WhatsApp" style={{ fontSize: 12, color: M.muted }}>📱</span>
                  {[{ id: null as string | null, rotulo: "Todos", numero: null, total: baseVend.length },
                    ...linhas.map((l) => ({ ...l, total: contaPorLinha.get(l.id) ?? 0 }))].map((l) => {
                    const on = linhaSel === l.id;
                    return (
                      <button
                        key={l.id ?? "todos"}
                        onClick={() => setLinhaSel(l.id)}
                        title={l.numero ? `${l.rotulo} · ${l.numero}` : l.rotulo}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px",
                          fontSize: 11.5, fontWeight: on ? 800 : 600, fontFamily: "inherit", cursor: "pointer",
                          borderRadius: 999, whiteSpace: "nowrap",
                          color: on ? "#fff" : M.gray, background: on ? M.roxo : M.bg,
                          border: `1px solid ${on ? M.roxo : M.border}`,
                        }}
                      >
                        {/* o parêntese explicativo do cadastro ("Murano Pro (RD
                            Conversas)") não cabe num chip de 340px — fica no
                            title, junto com o número */}
                        {l.rotulo.replace(/\s*\([^)]*\)\s*/g, " ").trim()}
                        <span style={{ fontSize: 10, fontWeight: 800, opacity: on ? 0.85 : 0.6 }}>{l.total}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ---- seletor de VENDEDOR ----
                  Mesmo recurso que o board tem para admin/home: ver a operação
                  de uma carteira por vez. Vendedor não vê estes chips — ele já
                  recebe só a própria carteira, filtrada no SERVIDOR (/api/chat),
                  então "Todos" e o próprio nome seriam a mesma lista. */}
              {sessao.role !== "vendedor" && vendedoresComConversa.length > 1 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                  <span title="Filtrar por vendedor" style={{ fontSize: 12, color: M.muted }}>🧑‍💼</span>
                  {[{ slug: null as string | null, cor: null, total: baseLinha.filter((c) => !c.na_fila).length },
                    ...vendedoresComConversa].map((v) => {
                    const on = vendFiltro === v.slug;
                    return (
                      <button
                        key={v.slug ?? "todos"}
                        onClick={() => setVendFiltro(v.slug)}
                        title={v.slug ? `Só as conversas de ${cap(v.slug)}` : "Todas as carteiras"}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px",
                          fontSize: 11.5, fontWeight: on ? 800 : 600, fontFamily: "inherit", cursor: "pointer",
                          borderRadius: 999, whiteSpace: "nowrap",
                          color: on ? "#fff" : M.gray, background: on ? M.roxo : M.bg,
                          border: `1px solid ${on ? M.roxo : M.border}`,
                        }}
                      >
                        {v.cor && <span style={{ width: 7, height: 7, borderRadius: 7, background: v.cor }} />}
                        {v.slug ? cap(v.slug) : "Todos"}
                        <span style={{ fontSize: 10, fontWeight: 800, opacity: on ? 0.85 : 0.6 }}>{v.total}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 10.5, color: M.muted }}>
                  {ordenadas.length} conversa{ordenadas.length === 1 ? "" : "s"}
                </span>
                <button onClick={() => setMenuOrdem((v) => !v)} title="Ordenar a lista"
                  style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: M.azul, padding: "2px 0" }}>
                  {ordem === "recente" ? "Mais recente" : "Mais antiga"}
                  <span style={{ fontSize: 9, opacity: 0.8 }}>▾</span>
                </button>
                {menuOrdem && (
                  <>
                    <div onClick={() => setMenuOrdem(false)} style={{ position: "fixed", inset: 0, zIndex: 100 }} />
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 101, minWidth: 150, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 9, boxShadow: "0 10px 26px rgba(28,14,27,.18)", overflow: "hidden" }}>
                      {([["recente", "Mais recente"], ["antiga", "Mais antiga"]] as const).map(([k, r]) => (
                        <button key={k} onClick={() => { setOrdem(k); setMenuOrdem(false); }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 12.5, fontWeight: ordem === k ? 800 : 600, color: ordem === k ? M.wine : M.ink, background: ordem === k ? M.roxoSoft : "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {erro && <div style={{ padding: 14, fontSize: 12.5, color: M.laranja }}>{erro}</div>}
              {!erro && !conversas.length && <div style={{ padding: 14, fontSize: 12.5, color: M.muted }}>Carregando conversas…</div>}
              {ordenadas.map((c) => {
                const ativa = sel?.cliente_id === c.cliente_id;
                const doCliente = c.ultima_enviada_por === "customer";
                return (
                  <button
                    key={c.cliente_id}
                    onClick={() => abrir(c)}
                    style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", padding: "10px 12px", background: ativa ? M.roxoSoft : "transparent", border: "none", borderBottom: `1px solid ${M.bg}`, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 38, background: ativa ? M.roxo : M.wine, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800 }}>
                      {(c.cliente ?? "?").trim().charAt(0).toUpperCase()}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <b style={{ fontSize: 13.5, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, fontWeight: c.nao_lida ? 900 : 700 }}>{c.cliente}</b>
                        {(c.status ?? "aberta") === "resolvida" && (
                          <span title="conversa resolvida" style={{ fontSize: 10, color: "#1a6b3c", flexShrink: 0 }}>✓</span>
                        )}
                        <span style={{ fontSize: 10.5, color: c.nao_lida ? M.roxo : M.muted, fontWeight: c.nao_lida ? 800 : 400, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{rotuloTempo(c.ultima_atividade)}</span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 12, color: M.gray, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                          {c.ultima_enviada_por === "operator" ? "Você: " : ""}{c.ultima_mensagem ?? "…"}
                        </span>
                        {c.transferida_de && (
                          <span title={`recebida de ${cap(c.transferida_de)}`}
                            style={{ fontSize: 9.5, fontWeight: 800, color: M.wine, background: "#f6e8f0", border: `1px solid ${M.border}`, borderRadius: 999, padding: "1px 6px", flexShrink: 0 }}>
                            ↪ {cap(c.transferida_de)}
                          </span>
                        )}
                        {c.vendedor && sessao.carteira == null && (
                          <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", color: M.roxo, background: M.roxoSoft, borderRadius: 999, padding: "1px 7px", flexShrink: 0 }}>{cap(c.vendedor)}</span>
                        )}
                        {!!presentes[c.cliente_id]?.length && (
                          <span title={`${presentes[c.cliente_id].join(", ")} com esta conversa aberta`}
                            style={{ fontSize: 10, flexShrink: 0 }}>👀</span>
                        )}
                        {c.nao_lida && (
                          <span title="não lida" style={{ width: 9, height: 9, borderRadius: 9, background: M.roxo, flexShrink: 0 }} />
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
              {busca && !ordenadas.length && !buscandoMsgs && !achadosNovos.length && (
                <div style={{ padding: 14, fontSize: 12.5, color: M.muted }}>Nada encontrado para “{busca}”.</div>
              )}

              {/* ---- busca no CONTEÚDO das mensagens (servidor) ---- */}
              {busca.trim().length >= 3 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: M.bg, borderTop: `1px solid ${M.border}`, borderBottom: `1px solid ${M.border}` }}>
                    <b style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: M.wine }}>
                      🔎 Nas mensagens
                    </b>
                    <span style={{ flex: 1, fontSize: 10.5, color: M.muted }}>
                      {buscandoMsgs ? "procurando…" : `${achadosNovos.length} conversa${achadosNovos.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  {truncado && !buscandoMsgs && (
                    <div style={{ padding: "6px 12px", fontSize: 10.5, color: M.laranja, background: "#fdeae3" }}>
                      Muitos resultados — mostrando os mais recentes. Use um termo mais específico.
                    </div>
                  )}
                  {!buscandoMsgs && achados !== null && !achadosNovos.length && (
                    <div style={{ padding: "10px 12px", fontSize: 12, color: M.muted }}>
                      Nenhuma mensagem com “{busca.trim()}”.
                    </div>
                  )}
                  {achadosNovos.map((c) => (
                    <button key={`b:${c.cliente_id}`} onClick={() => abrir(c)}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: sel?.cliente_id === c.cliente_id ? M.roxoSoft : "transparent", border: "none", borderBottom: `1px solid ${M.bg}`, cursor: "pointer", fontFamily: "inherit" }}>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <b style={{ fontSize: 13, color: M.ink, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.cliente}</b>
                        {(c.n ?? 1) > 1 && (
                          <span style={{ fontSize: 9.5, fontWeight: 800, color: M.roxo, background: M.roxoSoft, borderRadius: 999, padding: "1px 6px", flexShrink: 0 }}>
                            {c.n}×
                          </span>
                        )}
                        <span style={{ fontSize: 10.5, color: M.muted, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{rotuloTempo(c.trecho_em ?? null)}</span>
                      </span>
                      <span style={{ display: "block", fontSize: 11.5, color: M.gray, lineHeight: 1.4, marginTop: 2 }}>
                        {c.de === "customer" ? "" : "Você: "}
                        <Trecho texto={c.trecho ?? ""} termo={busca.trim()} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ---- rodapé da lista: a posição do "Online ●" do RD. Lá é a
                 disponibilidade do operador; aqui é o estado da conexão em tempo
                 real, que é o que existe de verdade — e serve de diagnóstico
                 quando o chat parece parado (sem Realtime, sobra o poll de 60s). ---- */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", borderTop: `1px solid ${M.border}`, background: M.surface, flexShrink: 0 }}
                 title={conectado
                   ? "Tempo real ligado — mensagens novas chegam sozinhas"
                   : "Sem tempo real — a lista ainda atualiza sozinha a cada 60 segundos"}>
              <span style={{ width: 9, height: 9, borderRadius: 9, flexShrink: 0, background: conectado ? "#1a6b3c" : M.muted }} />
              <b style={{ fontSize: 12, color: conectado ? "#1a6b3c" : M.gray }}>
                {conectado ? "Online" : "Reconectando…"}
              </b>
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: M.muted }}>{rotuloUsuario}</span>
            </div>
          </div>
        )}

        {/* ---- thread ---- */}
        {mostraThread && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: M.bgThread }}>
            {!sel && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: M.muted }}>
                <div style={{ fontSize: 44 }}>💬</div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: M.gray }}>Selecione uma conversa ao lado</div>
                <div style={{ fontSize: 12 }}>mensagens dentro da janela de 24h são enviadas na hora</div>
              </div>
            )}
            {sel && (
              <>
                {/* cabeçalho da conversa */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: M.surface, borderBottom: `1px solid ${M.border}` }}>
                  {isMobile && (
                    <button onClick={() => { setSel(null); setMsgs(null); }} style={{ background: "transparent", border: "none", fontSize: 16, color: M.gray, cursor: "pointer", padding: "0 4px", fontFamily: "inherit" }}>←</button>
                  )}
                  <span style={{ width: 34, height: 34, borderRadius: 34, background: M.wine, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
                    {(sel.cliente ?? "?").trim().charAt(0).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: "block", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.cliente}</b>
                    <span style={{ fontSize: 11, color: M.muted, fontVariantNumeric: "tabular-nums" }}>
                      {sel.telefone ?? "sem telefone"}{sel.vendedor ? ` · carteira ${cap(sel.vendedor)}` : ""}
                      {/* por qual NÚMERO esta conversa corre — com mais de uma linha
                          ativa, é o que evita responder pela linha errada (a janela
                          de 24h é por par número+cliente) */}
                      {linha && (
                        <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3,
                          color: linha.canal === "rd" ? M.gray : M.roxo,
                          background: linha.canal === "rd" ? "#eee8ed" : M.roxoSoft,
                          borderRadius: 999, padding: "1px 7px" }}>
                          {linha.rotulo}
                        </span>
                      )}
                      {/* anti-colisão: quem mais está com ESTA conversa aberta */}
                      {!!presentes[sel.cliente_id]?.length && (
                        <span title="outra pessoa está com esta conversa aberta"
                          style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3,
                            color: "#8a2f12", background: "#fdeae3", border: "1px solid #f0c4b0",
                            borderRadius: 999, padding: "1px 7px" }}>
                          👀 {presentes[sel.cliente_id].join(", ")} {presentes[sel.cliente_id].length > 1 ? "estão aqui" : "está aqui"}
                        </span>
                      )}
                    </span>
                  </span>
                  {/* fila de não atribuídos: contato sem dono, qualquer um puxa */}
                  {sel.na_fila && (
                    sessao.carteira ? (
                      <button onClick={puxarDaFila} disabled={puxando} title="Assumir este atendimento"
                        style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: "#1a6b3c", border: "none",
                          borderRadius: 999, padding: "6px 13px", cursor: puxando ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                        {puxando ? "…" : "✋ Pegar atendimento"}
                      </button>
                    ) : (
                      <span title="admin/supervisão não têm carteira: use Transferir para designar alguém"
                        style={{ fontSize: 10.5, fontWeight: 700, color: "#8a2f12", background: "#fdeae3", border: "1px solid #f0c4b0",
                          borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap" }}>
                        na fila — sem dono
                      </span>
                    )
                  )}
                  {!isMobile && (
                    <button onClick={() => setPainelAberto((v) => !v)} title={painelAberto ? "Ocultar dados do cliente" : "Mostrar dados do cliente"}
                      style={{ fontSize: 11.5, fontWeight: 700, color: painelAberto ? "#fff" : M.wine, background: painelAberto ? M.wine : M.bg, border: `1px solid ${painelAberto ? M.wine : M.border}`, borderRadius: 999, padding: "5px 11px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      📊 Cliente
                    </button>
                  )}
                  {/* ligar: só nas conversas do piloto (Cloud API). `linha.canal`
                      vem do /api/chat/thread e já diz por onde a conversa corre —
                      'rd' esconde o botão, porque o RD não tem API de voz. */}
                  <BotaoLigar
                    temTelefone={!!sel.telefone}
                    naCloud={linha?.canal === "whatsapp"}
                    ocupado={lig.ocupado}
                    emChamada={!!lig.chamada}
                    onLigar={() => lig.ligar(sel.cliente_id, sel.cliente)}
                  />
                  <button onClick={() => { setTransferindo((v) => !v); setResolvendo(false); }}
                    title="Passar esta conversa para outro vendedor"
                    style={{ fontSize: 11.5, fontWeight: 700, color: transferindo ? "#fff" : M.roxo, background: transferindo ? M.roxo : M.bg, border: `1px solid ${transferindo ? M.roxo : M.border}`, borderRadius: 999, padding: "5px 11px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    ↪ Transferir
                  </button>
                  {(sel.status ?? "aberta") === "resolvida" ? (
                    <button onClick={() => mudarStatus("aberta")} title="Voltar para a fila"
                      style={{ fontSize: 11.5, fontWeight: 700, color: "#1a6b3c", background: "#eaf5ee", border: "1px solid #bfe0cb", borderRadius: 999, padding: "5px 11px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      ✓ Resolvida — reabrir
                    </button>
                  ) : (
                    <button onClick={() => setResolvendo((v) => !v)} title="Encerrar atendimento com um motivo"
                      style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: M.roxo, border: "none", borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      Resolver
                    </button>
                  )}
                  {sel.telefone && (
                    <a href={`https://wa.me/${String(sel.telefone).replace(/\D/g, "").length <= 11 ? "55" : ""}${String(sel.telefone).replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" title="Abrir no WhatsApp" style={{ fontSize: 12, fontWeight: 700, color: M.azul, textDecoration: "none", whiteSpace: "nowrap" }}>
                      WhatsApp ↗
                    </a>
                  )}
                </div>

                {/* ---- faixa de abas do contato — exatamente onde o RD a põe
                     (lá é Perfil · Etiquetas · Atividades · Funis · Carteiras ·
                     Histórico, logo abaixo do nome). Aqui elas trocam o conteúdo
                     da coluna da direita, que continua visível: o ERP ao lado da
                     conversa é justamente o que o RD não tem. ---- */}
                {!isMobile && (
                  <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 14px", background: M.surface, borderBottom: `1px solid ${M.border}`, overflowX: "auto", flexShrink: 0 }}>
                    {ABAS.map((a) => {
                      const on = painelAberto && abaContato === a.k;
                      return (
                        <button key={a.k}
                          onClick={() => { setAbaContato(a.k); setPainelAberto(true); }}
                          style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                            fontSize: 13, fontWeight: on ? 800 : 600, color: on ? M.roxo : M.gray,
                            padding: "8px 11px", borderBottom: `2px solid ${on ? M.roxo : "transparent"}`, whiteSpace: "nowrap" }}>
                          {a.rotulo}
                        </button>
                      );
                    })}
                    {painelAberto && (
                      <button onClick={() => setPainelAberto(false)} title="Fechar o painel do cliente"
                        style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, color: M.muted, padding: "8px 4px", whiteSpace: "nowrap" }}>
                        ocultar painel ✕
                      </button>
                    )}
                  </div>
                )}

                {/* transferir: passa quem ATENDE o diálogo. A carteira do cliente
                    (dono comercial, vinda do RCA do WinThor) não muda — por isso o aviso. */}
                {transferindo && (
                  <div style={{ padding: "10px 14px", background: M.roxoSoft, borderBottom: `1px solid ${M.border}` }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: M.wine, marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Transferir a conversa para
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      {vendedores
                        .filter((v) => v.slug !== (sel.vendedor ?? ""))
                        .map((v) => (
                          <button key={v.slug} onClick={() => transferir(v.slug)}
                            style={{ fontSize: 12, fontWeight: 700, color: M.ink, background: M.surface, border: `1px solid ${v.cor ?? M.border}`, borderLeft: `4px solid ${v.cor ?? M.roxo}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>
                            {cap(v.slug)}
                          </button>
                        ))}
                      {!vendedores.length && <span style={{ fontSize: 12, color: M.gray }}>Carregando vendedores…</span>}
                    </div>
                    <input
                      value={obsTransf}
                      onChange={(e) => setObsTransf(e.target.value)}
                      placeholder="Motivo da passagem (opcional) — fica registrado na conversa"
                      style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12, fontFamily: "inherit", color: M.ink, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 8, outline: "none" }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
                      <span style={{ flex: 1, fontSize: 10.5, color: M.gray, lineHeight: 1.4 }}>
                        Muda só quem <b>atende</b> aqui no chat. A carteira do cliente continua a mesma — ela vem do RCA no WinThor.
                      </span>
                      <button onClick={() => setTransferindo(false)}
                        style={{ fontSize: 12, color: M.gray, background: "transparent", border: "none", padding: "4px 6px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                        cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* escolha do motivo — é a nossa tabulação, no fluxo natural do encerramento */}
                {resolvendo && (
                  <div style={{ padding: "10px 14px", background: M.roxoSoft, borderBottom: `1px solid ${M.border}` }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: M.wine, marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Por que está encerrando?
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {MOTIVOS.map((mo) => (
                        <button key={mo.v} onClick={() => mudarStatus("resolvida", mo.v)}
                          style={{ fontSize: 12, fontWeight: 600, color: M.ink, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>
                          {mo.rotulo}
                        </button>
                      ))}
                      <button onClick={() => setResolvendo(false)}
                        style={{ fontSize: 12, color: M.gray, background: "transparent", border: "none", padding: "6px 8px", cursor: "pointer", fontFamily: "inherit" }}>
                        cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* mensagens */}
                <div ref={rolagemRef} style={{ position: "relative", flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {msgs === null && <div style={{ color: M.muted, fontSize: 12.5, textAlign: "center", padding: 20 }}>Carregando mensagens…</div>}
                  {msgs?.length === 0 && !notas.length && <div style={{ color: M.muted, fontSize: 12.5, textAlign: "center", padding: 20 }}>Sem mensagens ainda.</div>}
                  {grupos.map((g) => (
                    <div key={g.dia} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ alignSelf: "center", fontSize: 10.5, fontWeight: 700, color: M.gray, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 999, padding: "3px 12px", margin: "8px 0 4px" }}>
                        {g.dia.split("-").reverse().join("/")}
                      </div>
                      {g.itens.map((it) => {
                        // ligação: mesmo tratamento de marco — o contato por voz
                        // aparece na conversa, no ponto em que aconteceu (0087)
                        if (it.k === "l") return <MarcoLigacao key={`l${it.l.id}`} l={it.l} />;
                        // transferência: marco no meio da conversa, o registro
                        // aparecendo no ponto exato em que o bastão passou
                        if (it.k === "t") {
                          const t = it.t;
                          return (
                            <div key={`t${t.id}`} style={{ display: "flex", justifyContent: "center", margin: "6px 0" }}>
                              <div style={{ maxWidth: "80%", textAlign: "center", fontSize: 11, color: M.gray, background: M.surface, border: `1px dashed ${M.border}`, borderRadius: 999, padding: "4px 14px", lineHeight: 1.5 }}>
                                ↪ <b style={{ color: M.wine }}>{cap(t.de_carteira) || "sem dono"}</b> transferiu para{" "}
                                <b style={{ color: M.roxo }}>{cap(t.para_carteira)}</b>
                                <span style={{ color: M.muted }}> · {horaBR(t.criada_em)}</span>
                                {t.observacao && (
                                  <div style={{ fontStyle: "italic", color: M.gray, marginTop: 2 }}>“{t.observacao}”</div>
                                )}
                              </div>
                            </div>
                          );
                        }
                        // nota interna: papel amarelo no meio da thread, sem tick e
                        // sem lado — não é mensagem, o cliente não vê
                        if (it.k === "n") {
                          const n = it.n;
                          return (
                            <div key={`n${n.id}`} style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
                              <div style={{ maxWidth: "82%", background: NOTA.bg, border: `1px solid ${NOTA.borda}`, borderRadius: 10, padding: "7px 11px", boxShadow: "0 1px 1px rgba(28,14,27,0.05)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: NOTA.ink }}>
                                    🗒️ nota interna
                                  </span>
                                  <span style={{ fontSize: 10, color: NOTA.ink, opacity: 0.75, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {n.autor}
                                  </span>
                                  <button onClick={() => apagarNota(n.id)} title="Apagar nota"
                                    style={{ background: "transparent", border: "none", color: NOTA.ink, opacity: 0.55, fontSize: 12, cursor: "pointer", padding: "0 2px", fontFamily: "inherit", flexShrink: 0 }}>
                                    ✕
                                  </button>
                                </div>
                                <div style={{ fontSize: 13, lineHeight: 1.45, color: NOTA.ink, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.texto}</div>
                                <div style={{ textAlign: "right", fontSize: 10, color: NOTA.ink, opacity: 0.6, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                                  {horaBR(n.criada_em)}
                                </div>
                              </div>
                            </div>
                          );
                        }
                        const m = it.m;
                        const fora = m.enviada_por !== "customer"; // operator/bot = lado direito
                        return (
                          <div key={m.id} style={{ display: "flex", justifyContent: fora ? "flex-end" : "flex-start", position: "relative" }}>
                            <div style={{ maxWidth: "72%", background: fora ? M.bolhaFora : M.bolhaDentro, border: `1px solid ${fora ? "#dcc8e2" : M.border}`, borderRadius: fora ? "12px 12px 3px 12px" : "12px 12px 12px 3px", padding: "7px 11px", boxShadow: "0 1px 1px rgba(28,14,27,0.06)", marginBottom: m.reacao ? 10 : 0 }}>
                              {m.tipo === "template" && (
                                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: M.roxo, marginBottom: 3 }}>template</div>
                              )}
                              {m.tipo === "auto" && (
                                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: M.gray, marginBottom: 3 }}>resposta automática</div>
                              )}
                              {/* trecho citado: dá sentido à resposta quando a conversa
                                  tem vários assuntos ao mesmo tempo */}
                              {m.resposta_a && (() => {
                                const alvo = (msgs ?? []).find((x) => x.id === m.resposta_a);
                                return (
                                  <div style={{ borderLeft: `3px solid ${M.roxo}`, background: "rgba(123,45,139,.06)", borderRadius: "0 6px 6px 0", padding: "4px 8px", marginBottom: 4, fontSize: 11.5, color: M.gray, maxHeight: 46, overflow: "hidden" }}>
                                    {alvo
                                      ? (alvo.conteudo || rotuloMidia(alvo.midia_tipo ?? "")).slice(0, 120)
                                      : "mensagem citada (fora do histórico carregado)"}
                                  </div>
                                );
                              })()}
                              <Midia m={m} />
                              {/* com mídia, o texto só aparece se for legenda de verdade (não o rótulo) */}
                              {(!m.midia_tipo || (m.conteudo && !/^(📷|🎬|🎤|📎|🙂)/.test(m.conteudo))) && (
                                <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.conteudo}</div>
                              )}
                              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 5, marginTop: 3, fontSize: 10, color: M.muted, fontVariantNumeric: "tabular-nums" }}>
                                {horaBR(m.criada_em)}
                                {fora && <Ticks status={m.status} />}
                              </div>
                              {/* reação: pendurada na borda da bolha, como no WhatsApp */}
                              {m.reacao && (
                                <span title="reação do cliente"
                                  style={{ position: "absolute", bottom: -2, [fora ? "right" : "left"]: 14,
                                    background: M.surface, border: `1px solid ${M.border}`, borderRadius: 999,
                                    padding: "1px 5px", fontSize: 12, lineHeight: 1.2, boxShadow: "0 1px 2px rgba(28,14,27,.12)" } as any}>
                                  {m.reacao}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <div ref={fimRef} />
                </div>

                {/* ---- botões flutuantes de rolagem (⌃ ⌄), como os do RD, colados
                     na borda direita da área de mensagens ---- */}
                {!!msgs?.length && (
                  <div style={{ position: "absolute", right: 16, bottom: 96, display: "flex", flexDirection: "column", gap: 7, zIndex: 5 }}>
                    {([["⌃", "Ir para o começo", () => rolagemRef.current?.scrollTo({ top: 0, behavior: "smooth" })],
                       ["⌄", "Ir para a última mensagem", () => fimRef.current?.scrollIntoView({ behavior: "smooth" })]] as const).map(([ic, t, fn]) => (
                      <button key={ic} onClick={fn} title={t}
                        style={{ width: 34, height: 34, borderRadius: 34, background: M.surface, border: `1px solid ${M.border}`,
                          color: M.gray, fontSize: 15, lineHeight: 1, cursor: "pointer", fontFamily: "inherit",
                          boxShadow: "0 2px 6px rgba(28,14,27,.14)" }}>
                        {ic}
                      </button>
                    ))}
                  </div>
                )}

                {/* ---- faixa de rodapé da conversa: o "Nenhum setor | Luana" do RD.
                     Aqui diz de quem é a carteira e por qual linha a conversa corre —
                     a janela de 24h é por par número+cliente, então errar a linha é
                     errar o envio. ---- */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "4px 14px", background: M.bgThread, borderTop: `1px solid ${M.border}`, fontSize: 10.5, color: M.muted, flexShrink: 0 }}>
                  <span>{sel.vendedor ? `Carteira ${cap(sel.vendedor)}` : "Sem dono"}</span>
                  <span style={{ opacity: 0.5 }}>|</span>
                  <span>{linha ? linha.rotulo : "linha não identificada"}</span>
                  {sel.transferida_de && (
                    <>
                      <span style={{ opacity: 0.5 }}>|</span>
                      <span title={`recebida de ${cap(sel.transferida_de)}`}>↪ de {cap(sel.transferida_de)}</span>
                    </>
                  )}
                </div>

                {/* aviso (janela 24h / erro de envio) — o ÚNICO uso forte do laranja */}
                {aviso && (
                  <div style={{ margin: "0 14px", padding: "8px 12px", fontSize: 12.5, color: "#8a2f12", background: "#fdeae3", border: `1px solid #f0c4b0`, borderLeft: `3px solid ${M.laranja}`, borderRadius: "0 8px 8px 0" }}>
                    ⚠️ {aviso}
                  </div>
                )}

                {/* ---- respostas rápidas: abre digitando `/` ou pelo botão ⚡ ---- */}
                {picker && (
                  <div style={{ margin: "0 14px", background: M.surface, border: `1px solid ${M.border}`, borderRadius: "10px 10px 0 0", borderBottom: "none", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: M.roxoSoft, borderBottom: `1px solid ${M.border}` }}>
                      <b style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: M.wine }}>⚡ Respostas rápidas</b>
                      <span style={{ flex: 1, fontSize: 10.5, color: M.gray }}>
                        {termo ? `filtrando “${termo}”` : "digite / e o atalho · ↑↓ navega · Enter usa"}
                      </span>
                      <button onClick={() => { setPicker(false); setNovaAberta(false); }} title="Fechar"
                        style={{ background: "transparent", border: "none", color: M.gray, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                    </div>

                    <div style={{ maxHeight: 210, overflowY: "auto" }}>
                      {respostasFiltradas.map((r, i) => {
                        const dela = r.carteira == null;                       // resposta da casa
                        const podeApagar = sessao.carteira == null || r.carteira === sessao.carteira;
                        return (
                          <div key={r.id} onMouseEnter={() => setPickerIdx(i)}
                            style={{ display: "flex", alignItems: "stretch", background: i === idxAtual ? M.roxoSoft : "transparent", borderBottom: `1px solid ${M.bg}` }}>
                            <button onClick={() => inserirResposta(r)}
                              style={{ flex: 1, minWidth: 0, textAlign: "left", display: "flex", alignItems: "baseline", gap: 8, padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: M.roxo, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 6, padding: "1px 6px", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                                /{r.atalho}
                              </span>
                              <span style={{ minWidth: 0, flex: 1 }}>
                                <b style={{ display: "block", fontSize: 12.5, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.titulo}</b>
                                <span style={{ display: "block", fontSize: 11.5, color: M.gray, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.corpo}</span>
                              </span>
                              <span title={dela ? "resposta da casa — todo mundo vê" : "sua resposta"}
                                style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: dela ? M.wine : M.azul, flexShrink: 0 }}>
                                {dela ? "casa" : "sua"}
                              </span>
                            </button>
                            {podeApagar && (
                              <button onClick={() => apagarResposta(r)} title={`Apagar /${r.atalho}`}
                                style={{ background: "transparent", border: "none", color: M.muted, fontSize: 12, cursor: "pointer", padding: "0 10px", fontFamily: "inherit" }}>✕</button>
                            )}
                          </div>
                        );
                      })}
                      {!respostasFiltradas.length && (
                        <div style={{ padding: "12px 14px", fontSize: 12, color: M.muted }}>
                          {termo ? `Nenhuma resposta com “${termo}”.` : "Você ainda não tem respostas rápidas."}
                        </div>
                      )}
                    </div>

                    {/* criar uma nova a partir do que está escrito na caixa */}
                    <div style={{ borderTop: `1px solid ${M.border}`, padding: "8px 12px", background: M.bg }}>
                      {!novaAberta ? (
                        <button onClick={() => { setNovaAberta(true); setNovoAtalho(""); setNovoTitulo(""); }}
                          disabled={!podeSalvar}
                          title={podeSalvar ? "Salvar o texto da caixa como resposta rápida" : "Escreva o texto na caixa primeiro"}
                          style={{ fontSize: 11.5, fontWeight: 700, color: podeSalvar ? M.roxo : M.muted, background: "transparent", border: "none", cursor: podeSalvar ? "pointer" : "default", fontFamily: "inherit", padding: 0 }}>
                          ＋ salvar o texto da caixa como resposta rápida
                        </button>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, color: M.gray }}>/</span>
                          <input value={novoAtalho} onChange={(e) => setNovoAtalho(e.target.value)} placeholder="atalho" autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); salvarResposta(); } }}
                            style={{ width: 96, padding: "5px 8px", fontSize: 12, fontFamily: "inherit", color: M.ink, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 8, outline: "none" }} />
                          <input value={novoTitulo} onChange={(e) => setNovoTitulo(e.target.value)} placeholder="título (opcional)"
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); salvarResposta(); } }}
                            style={{ flex: 1, minWidth: 120, padding: "5px 8px", fontSize: 12, fontFamily: "inherit", color: M.ink, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 8, outline: "none" }} />
                          <button onClick={salvarResposta} disabled={!novoAtalho.trim()}
                            style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: novoAtalho.trim() ? M.roxo : M.roxoSoft, border: "none", borderRadius: 8, padding: "6px 12px", cursor: novoAtalho.trim() ? "pointer" : "default", fontFamily: "inherit" }}>
                            salvar
                          </button>
                          <button onClick={() => setNovaAberta(false)}
                            style={{ fontSize: 11.5, color: M.gray, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>cancelar</button>
                          <div style={{ width: "100%", fontSize: 11, color: M.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            texto: “{texto.trim()}”
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* caixa de envio — muda de cara quando está escrevendo NOTA INTERNA */}
                <div style={{ display: "flex", gap: 8, padding: "10px 14px", background: modoNota ? NOTA.bg : M.surface, borderTop: `1px solid ${modoNota ? NOTA.borda : M.border}`, alignItems: "flex-end", transition: "background .15s" }}>
                  {/* anexo: foto, áudio, documento — o texto digitado vira legenda */}
                  <input
                    ref={arquivoRef}
                    type="file"
                    accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
                    style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarArquivo(f); }}
                  />
                  <button
                    onClick={() => arquivoRef.current?.click()}
                    disabled={enviandoArquivo || modoNota}
                    title={modoNota ? "Nota interna não leva anexo" : "Anexar foto, áudio ou documento"}
                    style={{ width: 42, height: 42, borderRadius: 12, border: `1px solid ${M.border}`, background: M.bg, color: M.gray, fontSize: 17, opacity: modoNota ? 0.4 : 1, cursor: enviandoArquivo || modoNota ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    {enviandoArquivo ? "…" : "📎"}
                  </button>
                  {/* 🎤 gravar áudio — clica pra gravar, clica de novo pra enviar */}
                  <button
                    onClick={alternarGravacao}
                    disabled={enviandoArquivo || modoNota}
                    title={modoNota ? "Nota interna não leva áudio" : gravando ? "Parar e enviar" : "Gravar áudio"}
                    style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, fontFamily: "inherit", fontSize: 17,
                      opacity: modoNota ? 0.4 : 1, cursor: enviandoArquivo || modoNota ? "default" : "pointer",
                      border: `1px solid ${gravando ? M.laranja : M.border}`,
                      background: gravando ? "#fdeae3" : M.bg, color: gravando ? M.laranja : M.gray }}
                  >
                    {gravando ? "⏹" : "🎤"}
                  </button>
                  {gravando && (
                    <span style={{ display: "flex", alignItems: "center", gap: 7, alignSelf: "center", whiteSpace: "nowrap" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 8, background: M.laranja }} />
                      <b style={{ fontSize: 13, color: M.laranja, fontVariantNumeric: "tabular-nums" }}>
                        {String(Math.floor(segundos / 60)).padStart(2, "0")}:{String(segundos % 60).padStart(2, "0")}
                      </b>
                      <button onClick={cancelarGravacao} title="Descartar gravação"
                        style={{ background: "transparent", border: "none", color: M.gray, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>
                        descartar
                      </button>
                    </span>
                  )}
                  {/* ⚡ respostas rápidas — o mesmo que digitar `/` */}
                  <button
                    onClick={() => { setPicker((v) => !v); setPickerIdx(0); }}
                    disabled={modoNota}
                    title="Respostas rápidas (ou digite / na caixa)"
                    style={{ width: 42, height: 42, borderRadius: 12, border: `1px solid ${picker ? M.roxo : M.border}`, background: picker ? M.roxo : M.bg, color: picker ? "#fff" : M.gray, fontSize: 16, opacity: modoNota ? 0.4 : 1, cursor: modoNota ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    ⚡
                  </button>
                  {/* 🗒️ nota interna — o cliente NUNCA vê o que for escrito aqui */}
                  <button
                    onClick={() => { setModoNota((v) => !v); setPicker(false); setTimeout(() => textoRef.current?.focus(), 10); }}
                    title={modoNota ? "Voltar a escrever mensagem para o cliente" : "Escrever nota interna (o cliente não vê)"}
                    style={{ width: 42, height: 42, borderRadius: 12, border: `1px solid ${modoNota ? NOTA.ink : M.border}`, background: modoNota ? NOTA.ink : M.bg, color: modoNota ? NOTA.bg : M.gray, fontSize: 16, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    🗒️
                  </button>
                  {!modoNota && (
                    <button
                      onClick={enviarTemplate}
                      disabled={enviando}
                      title="Enviar template de recontato (reabre conversa fora da janela de 24h)"
                      style={{ height: 42, padding: "0 12px", borderRadius: 12, border: `1px solid ${M.border}`, background: M.bg, color: M.wine, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
                    >
                      TEMPLATE
                    </button>
                  )}
                  <textarea
                    ref={textoRef}
                    value={texto}
                    onChange={(e) => aoDigitar(e.target.value)}
                    onKeyDown={(e) => {
                      // com a lista aberta, o teclado pertence a ela
                      if (picker && respostasFiltradas.length) {
                        const n = respostasFiltradas.length;
                        if (e.key === "ArrowDown") { e.preventDefault(); setPickerIdx((i) => (Math.min(i, n - 1) + 1) % n); return; }
                        if (e.key === "ArrowUp") { e.preventDefault(); setPickerIdx((i) => (Math.min(i, n - 1) - 1 + n) % n); return; }
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); inserirResposta(respostasFiltradas[idxAtual]); return; }
                      }
                      if (e.key === "Escape" && picker) { e.preventDefault(); setPicker(false); setNovaAberta(false); return; }
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (modoNota) enviarNota(); else enviar(); }
                    }}
                    placeholder={modoNota
                      ? "Nota interna — só a equipe vê (Enter salva)"
                      : "Escreva uma mensagem… (/ abre respostas rápidas, Enter envia)"}
                    rows={1}
                    style={{ flex: 1, resize: "none", padding: "10px 13px", fontSize: 13.5, fontFamily: "inherit", color: modoNota ? NOTA.ink : M.ink, background: modoNota ? M.surface : M.bg, border: `1px solid ${modoNota ? NOTA.borda : M.border}`, borderRadius: 12, outline: "none", lineHeight: 1.4, maxHeight: 110 }}
                  />
                  <button
                    onClick={() => (modoNota ? enviarNota() : enviar())}
                    disabled={enviando || !texto.trim()}
                    title={modoNota ? "Salvar nota interna (Enter)" : "Enviar (Enter)"}
                    style={{ width: 44, height: 42, borderRadius: 12, border: "none", background: !texto.trim() ? M.roxoSoft : modoNota ? NOTA.ink : M.roxo, color: texto.trim() ? "#fff" : M.muted, fontSize: 17, cursor: texto.trim() ? "pointer" : "default", fontFamily: "inherit", transition: "background .15s", flexShrink: 0 }}
                  >
                    {enviando ? "…" : modoNota ? "🗒️" : "➤"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- painel do contato (desktop): o ERP ao lado da conversa ---- */}
        {mostraThread && sel && painelAberto && !isMobile && (
          <div style={{ width: 268, flexShrink: 0, overflowY: "auto", background: M.surface, borderLeft: `1px solid ${M.border}` }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${M.border}`, background: M.roxoSoft, position: "sticky", top: 0, zIndex: 2 }}>
              <b style={{ fontSize: 12.5, color: M.wine }}>{ABAS.find((a) => a.k === abaContato)?.rotulo}</b>
              <div style={{ fontSize: 10.5, color: M.gray, marginTop: 1 }}>
                {abaContato === "perfil" ? "contato e cadastro" : "direto do WinThor"}
              </div>
            </div>
            <PainelContato
              c={contato}
              aba={abaContato}
              extra={{ telefone: sel.telefone, carteira: sel.vendedor, linha: linha?.rotulo, status: sel.status }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
