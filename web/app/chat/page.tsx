"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ehApp, ativarPush, desativarPush, pushInscrito } from "../pwa";
import Link from "next/link";
import {
  useLigacao, BotaoLigar, BarraChamada, ChamadaRecebida, DesfechoLigacao, MarcoLigacao,
  type Ligacao,
} from "./ligacao";
// mesma régua das variáveis do template usada pela rota de envio — a tela avisa
// cedo, o servidor confere de novo (lib/templateVars.ts)
import { Icone, type NomeIcone } from "./icones";
import { variaveisDe, aplicarVariaveis, conferirVariaveis } from "../../lib/templateVars";
import { traduzErroMeta, codigoMeta } from "../../lib/erroMeta";
import { CAMPOS_PADRAO, faltando, fichaEmTexto, textoPedidoDeDados, type CampoCadastro } from "../../lib/cadastroCampos";
import { nomeComCodigo } from "../../lib/nomeCliente";
import { limiteDe, recadoDeLimite } from "../../lib/midia";

// ---------------------------------------------------------------------------
// CHAT — ambiente de conversa estilo RD Conversas, layout inspirado no WhatsApp
// Web, identidade visual Murano (skill murano-brand). Paleta desta tela:
//   púrpura #7b2d8b  -> botões e ações (preferência sobre o laranja)
//   vinho   #621244  -> títulos, nomes, acentos de marca
//   azul    #1a5fa8  -> ticks de "lida" e links (pitada de azul do dev)
//   laranja #dd4222  -> COM MODERAÇÃO: só avisos (fora da janela) e falha
// ---------------------------------------------------------------------------
//
// `M` é MUTÁVEL de propósito — mesmo padrão do board (§11.5): trocar o desenho
// é `Object.assign(M, PALETAS[layout])` no início do componente, e o re-render
// leva a paleta nova para todos os estilos inline sem refatorar nenhum deles.
// Componentes fora de `Chat()` (PainelContato, Ticks, Midia) leem este mesmo
// objeto, então a troca alcança a tela inteira.
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
  // Dois tokens que nasceram com a Direção 4 e valem para todos os desenhos.
  // Em `original` e `continuidade` eles reproduzem o que o código já fazia
  // cravado, então acrescentá-los é uma mudança de zero pixels:
  //   `lineStrong` = a borda de CONTROLE (campo, botão), que a régua exige em
  //   3:1 por ser elemento não-textual — hoje ela é a mesma linha decorativa
  //   das divisórias, e some contra o fundo;
  //   `ok` = o verde de "concluído", literal em oito lugares deste arquivo.
  lineStrong: "#e0cfdb",
  ok: "#1a6b3c",
};

// A paleta de cada desenho (migration 0095, catálogo em lib/chatLayout.ts).
//
// `original` é a de sempre, guardada aqui para o rollback ser exato — voltar
// não pode ser "quase igual".
//
// `continuidade` troca o rosa #f5edf4 e o roxo #7b2d8b, que não são token de
// lugar nenhum (skill murano-brand §5), pelos tokens oficiais do hub: fundo
// #f4f4f6, púrpura como MARCA e azul como AÇÃO. Por isso a bolha enviada vira
// azul-clara — ela é ação do operador, não identidade — e o botão usa #7a1755,
// o tom que o hub calibrou porque #621244 chapado dá 1,46:1 de contraste.
const PALETAS: Record<string, Partial<typeof M>> = {
  original: { ...M },
  continuidade: {
    wine: "#621244",
    roxo: "#7a1755",        // .murano-btn do hub — calibrado por contraste
    roxoSoft: "#f3ecf1",
    azul: "#1a5fa8",
    laranja: "#a83015",     // o laranja profundo lê como texto; o #dd4222 não
    bg: "#f4f4f6",          // --color-murano-light, não o rosa do chat atual
    bgThread: "#eceaf0",
    surface: "#ffffff",
    border: "#e3e1e8",
    ink: "#241327",
    // ⚠️ 4,25:1 sobre branco e 3,87:1 sobre o fundo da tela (#f4f4f6) --
    // MEDIDO, e reprova para texto normal (a régua é 4,5:1). O comentário
    // anterior dizia "4,6:1" e estava errado; melhora o #9a8098 antigo, mas
    // não passa. Escurecer aqui muda a cara do D1 em produção, então fica
    // como dívida nomeada para a decisão de tema, não corrigido de afogadilho.
    muted: "#7c7986",
    gray: "#55555f",
    bolhaFora: "#e9f1fb",   // enviada = ação = azul
    bolhaDentro: "#ffffff",
    lineStrong: "#e3e1e8",  // = a borda da D1: acrescentar o token não a muda
  },
  // `bancada` (Direção 4). Mesma rampa do hub que a D1 usa, com uma diferença
  // que é decisão e não gosto: cada família tem UM trabalho, e os valores foram
  // medidos, não escolhidos de olho (laudo §4.4).
  //
  //   marca (púrpura)  #7a1755   ação (azul) #1a5fa8   urgência #a83015
  //   concluído (verde) #1a6b3c  — e um acento por região da tela
  //
  // Três correções de contraste que vêm junto:
  //   · `muted` #6b6577 passa nos TRÊS fundos (5,60:1 sobre branco, 5,02:1 sobre
  //     a página, 4,65:1 sobre a conversa). O #7c7986 da D1 dá 4,25:1 e 3,87:1 —
  //     reprova para texto normal, e está registrado como dívida no comentário
  //     dela. Aqui a dívida é paga, sem mexer na D1 que está em produção.
  //   · `lineStrong` #8d8599 é a borda de controle: 3,53:1, acima do mínimo de
  //     3:1 para elemento não-textual. A divisória decorativa continua clara.
  //   · o azul preenchido é #1a5fa8 (6,47:1) e nunca #2f7fd4, que dá 4,11:1 com
  //     texto branco e reprova — este último só serve como cor de foco.
  bancada: {
    wine: "#7a1755",
    roxo: "#7a1755",
    roxoSoft: "#f2ecf1",
    azul: "#1a5fa8",
    laranja: "#a83015",
    ok: "#1a6b3c",
    bg: "#f3f2f5",
    bgThread: "#ebe9ef",
    surface: "#ffffff",
    border: "#e4e2e9",
    lineStrong: "#8d8599",
    ink: "#221826",
    gray: "#4d4757",
    muted: "#6b6577",
    bolhaFora: "#e9f1fb",   // enviada = ação = azul, como na D1
    bolhaDentro: "#ffffff",
  },
};

// ---------------------------------------------------------------------------
// A GRADE (Direção 4) — a segunda alavanca, irmã de `PALETAS`.
//
// `M` resolve a cor; `G` resolve a geometria. Mesmo padrão e mesmo motivo: o
// objeto é mutável e recebe `Object.assign` no início do componente, então
// trocar o desenho alcança todos os estilos inline sem refatorar nenhum deles.
//
// A razão de existir: hoje o arquivo tem 65 combinações de padding e 15 raios,
// e é isso que faz a tela parecer improvisada mesmo mostrando a coisa certa.
// A sidebar chega a ter TRÊS bordas esquerdas diferentes (10, 12 e 13 px), o
// que se vê como uma goteira torta de cima a baixo.
//
// ⚠️ `GRADES.original` reproduz os literais de HOJE. É isso que torna a troca de
// um literal por `G.x` uma mudança de zero pixel enquanto o layout for
// `original` — e o rollback exato, não "quase igual".
const G = {
  lista: 340,             // largura da coluna de conversas
  painel: 268,            // largura do painel do contato
  cabPad: "8px 10px 6px", // cabeçalho da lista
  rodapePad: "8px 13px",  // rodapé "Online ●"
  cabConvPad: "9px 14px", // cabeçalho da conversa (desktop)
  msgsPad: "14px 18px",   // a thread
  compPad: "10px 14px",   // o compositor (desktop)
  pilPad: "4px 6px",      // a pílula do compositor (desktop)
  pilBtn: 42,             // botão dentro da pílula (desktop)
  pilBtnC: 30,            // idem, no compacto (a lupa do board)
  raioPil: 12,            // raio desses botões (desktop)
  raioPilC: 9,            // idem, no compacto
  envAlt: 42,             // o enviar — o controle PRIMÁRIO da tela
  envAltC: 30,
  envLarg: 44,
  envLargC: 32,
  // ---- entrega 2: densidade -------------------------------------------------
  linhaPad: "10px 12px",  // a linha da conversa na sidebar
  linhaAlt: 0,            // 0 = sem altura mínima (o conteúdo manda)
  gapLinha: 10,           // avatar ↔ texto
  avatar: 38,
  gapDia: 4,              // entre itens do mesmo dia na thread
  bolhaMax: "72%",
  raioBolha: 12,
  bolhaPad: "7px 11px",
  /** o painel do cliente mostra um número herói + dois de apoio, em vez de três
   *  tiles iguais. É lido por `PainelContato`, que mora FORA de `Chat()` — pelo
   *  mesmo caminho que ele já lê `M`. */
  numeroHeroi: false,
};
/** Desenhos que carregam as correções da Direção 1 (a faixa da janela de 24h, a
 *  aba Resumo, o mobile com o ERP). A 4 herda todas — a tese dela é grade, não
 *  informação nova. Um Set, e não `layout !== "original"`, porque as direções 2
 *  e 3 têm arranjo próprio e não devem ser arrastadas por esta régua. */
const CORRIGE = new Set(["continuidade", "bancada"]);

const GRADES: Record<string, Partial<typeof G>> = {
  original: { ...G },
  continuidade: { ...G },
  // Goteira de 16 px no desktop: tudo que tem borda começa na mesma aresta.
  // A lista cede 20 px para o painel do ERP, que é onde mora a vantagem sobre
  // o RD e onde `R$ 12.480,00` (112 px) não cabia em tile de 55.
  bancada: {
    lista: 320,
    painel: 320,
    cabPad: "12px 16px",
    rodapePad: "12px 16px",
    // 6 px em cima e embaixo, e não zero: com `minHeight` o conteúdo pode
    // passar de 56 px, e aí sem padding ele encostaria na divisória.
    cabConvPad: "6px 16px",
    msgsPad: "16px 16px",
    compPad: "12px 16px",
    pilPad: "4px 4px",
    pilBtn: 32,
    pilBtnC: 28,
    raioPil: 10,
    raioPilC: 10,
    // O primário é um degrau acima do secundário, e quadrado: 40 contra 32.
    // Hoje ele é mais LARGO que alto (44 × 42), o que o faz parecer torto ao
    // lado dos botões redondos da pílula.
    envAlt: 40,
    envAltC: 36,
    envLarg: 40,
    envLargC: 36,
    // A linha da conversa começa na goteira (16) como todo o resto, e ganha
    // 52 px de altura.
    // ⚠️ `minHeight`, não `height`. O laudo pede altura FIXA por ser o
    // pré-requisito barato da virtualização — que a lista vai precisar quando
    // passar de 3.900 conversas. Mas virtualização não é esta entrega, e altura
    // fixa espreme quem tem selo de transferência ou de vendedor na segunda
    // linha. Quando a virtualização entrar, isto precisa virar `height`; até lá,
    // ceder é melhor que cortar (mesma lição do cabeçalho da conversa, §60.4).
    // 16 à esquerda (a goteira), 12 à direita: a régua é da aresta ESQUERDA, e
    // cada pixel à direita é caractere a mais na prévia, que é o que o vendedor
    // lê para decidir se abre a conversa.
    linhaPad: "8px 12px 8px 16px",
    linhaAlt: 52,
    gapLinha: 12,
    avatar: 36,
    gapDia: 2,
    // 72% num monitor largo dá linha de 100+ caracteres. 560 px a 13,5 dá ~75,
    // que é a faixa confortável de leitura.
    bolhaMax: "min(72%, 560px)",
    raioBolha: 14,
    bolhaPad: "8px 12px",
    numeroHeroi: true,
  },
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
type Fila = "pendentes" | "todas" | "resolvidas" | "fila" | "carteira";
const FILAS: { k: Fila; icone: string; rotulo: string; dica: string }[] = [
  { k: "todas", icone: "💬", rotulo: "Meus atendimentos", dica: "conversas abertas sob sua responsabilidade" },
  { k: "pendentes", icone: "🔔", rotulo: "Mensagens não lidas", dica: "o cliente falou e ninguém leu ainda" },
  { k: "fila", icone: "🚶", rotulo: "Fila de espera", dica: "sem dono — qualquer um pode pegar" },
  { k: "resolvidas", icone: "✓", rotulo: "Encerradas", dica: "atendimentos já resolvidos" },
  // A carteira NÃO é um recorte da lista de conversas como as quatro acima: é a
  // agenda inteira do vendedor, buscada à parte e só quando aberta (§38).
  { k: "carteira", icone: "📇", rotulo: "Minha carteira", dica: "todos os clientes do seu RCA, com ou sem conversa" },
];

// Uma linha da agenda. `codcli` é a identidade no ERP e a chave da lista;
// `cliente_id` é o contato para abrir a conversa, já resolvido pelo servidor.
type ContatoCarteira = {
  codcli: number; cliente_id: string | null; cliente: string;
  telefone: string | null; cidade: string | null; vendedor: string | null;
  impedimento: string | null;
};

// Abas do contato — mesma posição das do RD (Perfil · Etiquetas · Atividades ·
// Funis · Carteiras · Histórico), com o conteúdo que NÓS temos: o ERP.
// `resumo` só existe no desenho "continuidade" (0095) e é a aba que ele abre
// por padrão — ver o comentário em PainelContato.
type AbaContato = "resumo" | "perfil" | "compras" | "ciclo" | "funil" | "notas";
const ABAS: { k: AbaContato; rotulo: string; soD1?: boolean }[] = [
  { k: "resumo", rotulo: "Resumo", soD1: true },
  { k: "perfil", rotulo: "Perfil" },
  { k: "compras", rotulo: "Compras" },
  { k: "ciclo", rotulo: "Ciclo" },
  { k: "funil", rotulo: "Funil" },
  { k: "notas", rotulo: "Notas fiscais" },
];

type Conversa = {
  cliente_id: string; cliente: string; vendedor: string | null; etapa: string | null;
  // codigo do cliente no WinThor: vem no mesmo SELECT do nome, sem consulta nova
  codcli?: number | string | null;
  telefone: string | null; ultima_atividade: string | null;
  ultima_mensagem: string | null; ultima_enviada_por: string | null;
  nao_lida?: boolean; status?: string | null; motivo?: string | null;
  na_fila?: boolean;   // sem dono: qualquer um pode puxar
  /** dono COMERCIAL cru (carteira/RCA), antes da transferência — governa o "devolver" */
  carteira_dona?: string | null;
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

// Template que pode ser disparado. `corpo` só existe nos da Cloud (0090); os do
// RD são ponteiros para o painel deles e não têm texto do nosso lado.
type TemplateEscolha = {
  id: number; nome: string; padrao: boolean; canal: string;
  meta_nome: string | null; rd_template_id: string | null;
  corpo: string | null; cabecalho_tipo: string | null; usa_nome: boolean;
};

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
  erro?: string | null;        // motivo da falha, como a Meta explicou (0091)
  linha_id?: string | null;    // null = RD Conversas (§23.4); decide a janela de 24h
  // ponto no mapa (0115). Vale para o que a cliente compartilha E para o que
  // nós mandamos — a bolha desenha o mesmo cartão nos dois casos.
  localizacao?: { lat: number; lng: number; nome?: string | null; endereco?: string | null; url?: string | null } | null;
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
  // motor de ciclo ligado? (crm_config, migration 0097 — vem junto no mesmo JSON,
  // então o painel não precisa de uma segunda chamada só para saber disso)
  ciclo_ativo?: boolean;
  compras: { codcli: number | null; cidade: string | null; compras: number | null; ultima_compra: string | null;
             dias_sem_comprar: number | null; total_liquido: number | null; rca_oficial: string | null } | null;
  ciclo: { pct_ciclo: number | null; ciclo_medio: number | null; dias_ausente: number | null;
           tipo_oportunidade: string | null; acao_recomendada: string | null; tendencia: string | null } | null;
  funil: { etapa: string | null; venda_valor: number | null; venda_data: string | null; sem_cadastro: boolean | null } | null;
  ultimas_notas: { data_fat: string; valor: number; num_nota: string | number | null; filial: string | null }[];
  // Clientes do ERP com o MESMO NOME, quando este numero nao tem vinculo.
  // Nao afirma identidade -- e pista para o humano decidir (§ trocou de numero).
  erp_candidatos?: { codcli: number; nome: string; telefone: string | null;
                     cidade: string | null; rca_num: number | null; rca_nome: string | null }[];
};

const moedaBR = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dataBR = (d: string | null | undefined) =>
  d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—";

const cap = (s: any) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");
const horaBR = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);

/**
 * Junta duas listas de mensagens da MESMA conversa sem duplicar nem perder.
 *
 * Dois usos, e o `pendurar` distingue os dois:
 *
 *   pendurar=false (recarga completa): `chegou` e a foto autoritativa -- ela
 *     manda em tudo que existia quando foi tirada. So sobrevive de `atual` o
 *     que for mais novo que a foto inteira, porque isso chegou depois dela.
 *     E assim que o tique que virou "lida" no servidor sobrescreve o "enviada"
 *     que estava na tela.
 *
 *   pendurar=true (lote incremental): `chegou` traz so o que e novo, entao
 *     `atual` e a base e o lote se soma a ela.
 *
 * Nos dois casos a chave e o `id` (o wamid, na Cloud), e a versao que vence e a
 * mais recente do servidor -- nunca a otimista que a tela pintou ao enviar.
 */
function juntar(atual: Msg[] | null, chegou: Msg[], pendurar = false): Msg[] {
  if (!atual?.length) return chegou;
  if (!chegou.length) return pendurar ? atual : chegou;
  const base = pendurar ? atual : chegou;
  const extra = pendurar
    ? chegou
    // corte da foto: o que for estritamente mais novo que a linha mais recente
    // dela chegou depois, e nao pode ser apagado por ela
    : atual.filter((m) => m.criada_em > chegou[chegou.length - 1].criada_em);
  // A bolha otimista (`tmp:`) morre quando o servidor devolve a mensagem DE
  // VERDADE: mesmo lado, mesmo texto. Sem isto a propria fala do vendedor
  // apareceria em dobro entre o aviso do Realtime (que ja traz a linha gravada)
  // e a resposta do POST (que era quem limpava a otimista) -- um piscar de
  // duplicata que so existe porque a thread ficou rapida.
  const ditas = new Set(chegou.filter((m) => m.enviada_por !== "customer").map((m) => m.conteudo ?? ""));
  const vivos = extra.filter((m) => !(String(m.id).startsWith("tmp:") && ditas.has(m.conteudo ?? "")));
  if (!vivos.length) return base;
  const por = new Map(base.map((m) => [m.id, m]));
  for (const m of vivos) por.set(m.id, por.get(m.id) ?? m);
  return [...por.values()].sort((x, y) => (x.criada_em < y.criada_em ? -1 : x.criada_em > y.criada_em ? 1 : 0));
}
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
/**
 * Cartão de mapa (0115) — o mesmo desenho para o ponto que a cliente manda e
 * para o que nós mandamos.
 *
 * Sem imagem de mapa de propósito: um preview estático exigiria chave de um
 * provedor de tiles, e cada bolha viraria uma requisição a um terceiro dentro
 * de uma tela que carrega 200 mensagens. O cartão traz o que serve para agir —
 * nome, endereço e o link que abre no app de mapas do aparelho.
 *
 * `nome` e `endereco` são opcionais: quem compartilha a própria posição manda
 * só as coordenadas, e nesse caso elas são o texto.
 */
function CartaoLocal({ loc }: { loc: any }) {
  const lat = Number(loc?.lat), lng = Number(loc?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const titulo = loc?.nome || loc?.endereco || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const sub = loc?.nome && loc?.endereco ? loc.endereco : null;
  const href = loc?.url || `https://www.google.com/maps?q=${lat},${lng}`;
  return (
    <a href={href} target="_blank" rel="noreferrer"
      style={{ display: "flex", gap: 9, alignItems: "flex-start", textDecoration: "none",
        background: "rgba(26,95,168,.07)", border: "1px solid rgba(26,95,168,.22)",
        borderRadius: 10, padding: "8px 10px", marginBottom: 4, maxWidth: 260 }}>
      <span style={{ fontSize: 18, lineHeight: 1.1 }}>📍</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: M.ink, wordBreak: "break-word" }}>{titulo}</span>
        {sub && <span style={{ display: "block", fontSize: 11.5, color: M.gray, marginTop: 1 }}>{sub}</span>}
        <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: M.azul, marginTop: 3 }}>Abrir no mapa ↗</span>
      </span>
    </a>
  );
}

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
// ---------------------------------------------------------------------------
// Salvar contato — o que faltava para quem chega pela fila de espera.
//
// O webhook cria o contato com o nome do PERFIL do WhatsApp, que as vezes e o
// proprio numero. Sem isto, ele fica assim para sempre: nada no CRM editava
// `clientes`.
//
// O CPF e o campo que importa: `wth_reconciliar_vinculos()` casa CPF e liga o
// contato ao cadastro do WinThor a cada 10 minutos (§10.5). Preenchido aqui, o
// card ganha codcli, RCA e historico de compra sozinho — sem escrita paralela
// que o proprio job poderia desfazer.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// FICHA DE CADASTRO (0109) - a cliente dita, o consultor cola, alguem digita
// no WinThor depois.
//
// Substitui o antigo "Salvar contato", que pedia nome + CPF e mais nada. Ele
// resolvia o VINCULO (o CPF faz `wth_reconciliar_vinculos()` casar) e deixava
// o cadastro de fora: na hora de digitar no ERP faltava endereco, inscricao
// estadual, nome fantasia -- e o consultor voltava a perguntar, dias depois,
// coisas que a cliente teria respondido de uma vez.
//
// A lista de campos NAO esta aqui. Vem de `crm_config.cadastro_campos`,
// editavel em /admin, porque quem sabe o que o WinThor exige e quem cadastra.
// O mesmo array gera a MENSAGEM que pede os dados -- se fossem dois textos,
// divergiriam e alguem perguntaria duas vezes.
// ---------------------------------------------------------------------------
function FichaCadastro({ clienteId, temErp, pedirDados, avisar }: {
  clienteId: string;
  temErp: boolean;
  /** poe o texto do pedido na caixa de mensagem, para revisar antes de enviar */
  pedirDados: (texto: string) => void;
  avisar: (m: string) => void;
}) {
  const [campos, setCampos] = useState<CampoCadastro[]>(CAMPOS_PADRAO);
  const [dados, setDados] = useState<Record<string, string>>({});
  const [obs, setObs] = useState("");
  const [ficha, setFicha] = useState<any>(null);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    setAberto(false); setDados({}); setObs(""); setFicha(null);
    fetch("/api/chat/cadastro?cliente_id=" + encodeURIComponent(clienteId), { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        setCampos(j?.campos ?? CAMPOS_PADRAO);
        setFicha(j?.ficha ?? null);
        setDados((j?.ficha?.dados ?? {}) as Record<string, string>);
        setObs(j?.ficha?.observacao ?? "");
        // Ficha ja comecada reabre ABERTA: fechada, quem esta no meio do
        // preenchimento acharia que perdeu o que digitou ontem.
        if (j?.ficha) setAberto(true);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [clienteId]);

  // Cliente ja vinculado: o cadastro existe no ERP e e ele que manda (10.8 e a
  // migration 0108). Nao ha ficha a preencher -- ha o caminho para corrigir.
  if (temErp) {
    return (
      <div style={{ padding: "11px 14px", borderBottom: "1px solid " + M.border }}>
        <div style={{ fontSize: 12.5, color: M.gray, lineHeight: 1.5 }}>
          <b style={{ color: M.ink }}>Cadastro do WinThor.</b> Nome, CPF e endereco vem do ERP e
          nao sao editados aqui - corrigir por la vale para todo mundo, e a mudanca chega em ate
          10 minutos.
        </div>
      </div>
    );
  }

  const falta = faltando(campos, dados);
  const preenchidos = campos.filter((c) => String(dados[c.k] ?? "").trim()).length;

  async function salvar() {
    setOcupado(true);
    try {
      const r = await fetch("/api/chat/cadastro", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, dados, observacao: obs }),
      });
      const j = await r.json().catch(() => ({}));
      avisar(r.ok ? (j?.aviso ?? "Ficha salva.") : (j?.error ?? ("erro " + r.status)));
      if (r.ok) setFicha({ ...(ficha ?? {}), dados, observacao: obs });
    } finally { setOcupado(false); }
  }

  async function marcarCopiado(desfazer: boolean) {
    setOcupado(true);
    try {
      const r = await fetch("/api/chat/cadastro", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, desfazer }),
      });
      const j = await r.json().catch(() => ({}));
      avisar(r.ok ? (j?.aviso ?? "ok") : (j?.error ?? ("erro " + r.status)));
      if (r.ok) setFicha((f: any) => ({ ...(f ?? {}), copiado_em: desfazer ? null : new Date().toISOString() }));
    } finally { setOcupado(false); }
  }

  return (
    <div style={{ padding: "11px 14px", borderBottom: "1px solid " + M.border }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: M.muted }}>
          Ficha para o WinThor
        </div>
        {ficha?.copiado_em && (
          <span title="Ja foi digitada no ERP" style={{ fontSize: 9, fontWeight: 800, color: "#1a6b3c", background: "#e7f6ec", border: "1px solid #bfe6cd", borderRadius: 5, padding: "1px 6px" }}>
            CADASTRADA
          </span>
        )}
        {!ficha?.copiado_em && preenchidos > 0 && (
          <span style={{ fontSize: 9.5, color: M.muted }}>{preenchidos}/{campos.length}</span>
        )}
      </div>

      {/* O gesto que comeca tudo. O texto vai para a CAIXA DE MENSAGEM, nao
          direto para o WhatsApp - quem envia e a pessoa, depois de ler.
          Disparar mensagem real ao clicar num painel de consulta seria o tipo
          de engano que nao tem desfazer. */}
      <button
        onClick={() => pedirDados(textoPedidoDeDados(campos, String(dados["nome"] ?? "").trim().split(/\s+/)[0]))}
        style={{ width: "100%", padding: "8px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
          color: M.wine, background: M.roxoSoft, border: "1px solid " + M.border, borderRadius: 9,
          cursor: "pointer", marginBottom: 8 }}>
        Pedir os dados a cliente
      </button>

      {!aberto ? (
        <button onClick={() => setAberto(true)}
          style={{ width: "100%", padding: "8px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
            color: M.gray, background: M.bg, border: "1px solid " + M.border, borderRadius: 9, cursor: "pointer" }}>
          Preencher a ficha
        </button>
      ) : (
        <>
          {campos.map((c) => (
            <div key={c.k} style={{ marginBottom: 6 }}>
              <label style={{ display: "block", fontSize: 10.5, color: M.muted, marginBottom: 2 }}>
                {c.rotulo}{c.obrigatorio && <span style={{ color: M.laranja }}> *</span>}
                {c.ajuda && <span style={{ opacity: 0.8 }}> - {c.ajuda}</span>}
              </label>
              <input
                value={dados[c.k] ?? ""}
                onChange={(e) => setDados((d) => ({ ...d, [c.k]: e.target.value }))}
                style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px", fontSize: 12.5,
                  fontFamily: "inherit", color: M.ink, background: M.bg,
                  border: "1px solid " + M.border, borderRadius: 8, outline: "none" }} />
            </div>
          ))}
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2}
            placeholder="Observacao (opcional)"
            style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px", fontSize: 12.5,
              fontFamily: "inherit", color: M.ink, background: M.bg, border: "1px solid " + M.border,
              borderRadius: 8, outline: "none", resize: "vertical", marginBottom: 8 }} />

          {falta.length > 0 && (
            <div style={{ fontSize: 10.5, color: M.laranja, marginBottom: 6 }}>
              Falta: {falta.join(", ")}
            </div>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button disabled={ocupado || falta.length > 0} onClick={salvar}
              style={{ flex: 1, padding: "7px 12px", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                color: "#fff", background: ocupado || falta.length ? M.muted : M.azul, border: "none",
                borderRadius: 8, cursor: ocupado || falta.length ? "default" : "pointer" }}>
              {ocupado ? "Salvando..." : "Salvar ficha"}
            </button>
            <button
              onClick={() => {
                const t = fichaEmTexto(campos, dados);
                navigator.clipboard?.writeText(t).then(
                  () => avisar("Ficha copiada - cole no WinThor."),
                  () => avisar("Nao consegui copiar; selecione o texto a mao."),
                );
              }}
              title="Copia a ficha em texto, campo por linha, para colar no ERP"
              style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                color: M.wine, background: M.roxoSoft, border: "1px solid " + M.border,
                borderRadius: 8, cursor: "pointer" }}>
              Copiar
            </button>
          </div>

          {ficha && (
            <button disabled={ocupado} onClick={() => marcarCopiado(!!ficha.copiado_em)}
              style={{ width: "100%", marginTop: 6, padding: "6px 12px", fontSize: 11.5, fontWeight: 700,
                fontFamily: "inherit", color: M.gray, background: "transparent",
                border: "1px solid " + M.border, borderRadius: 8, cursor: "pointer" }}>
              {ficha.copiado_em ? "Desmarcar - ainda nao cadastrei" : "Ja cadastrei no WinThor"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado vazio, carregando ou sem resultado — UMA anatomia (item 28 do laudo).
//
// A tela tinha quatro: um bloco centrado com emoji de 44 px, dois avisos de uma
// linha em cinza com padding 14 e um terceiro com padding 20 e centrado. São o
// mesmo momento da experiência — "não há nada aqui" — contado de quatro jeitos,
// e é o tipo de coisa que faz um sistema parecer montado por pessoas
// diferentes, porque foi.
//
// Só `bancada` usa este componente; os outros desenhos mantêm o markup literal
// de antes, para o rollback continuar exato.
//
// `texto` é a CAUSA, não enfeite: um vazio que não diz por que está vazio faz
// quem olha desconfiar do sistema em vez de entender a situação.
function Estado({ glifo, titulo, texto, alto }: {
  glifo: string; titulo: string; texto?: string;
  /** ocupa a área toda (thread sem conversa) em vez de uma faixa na lista */
  alto?: boolean;
}) {
  return (
    <div style={{ ...(alto ? { flex: 1 } : null), display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", textAlign: "center",
      gap: 6, padding: alto ? 24 : "28px 20px", color: M.muted }}>
      <div style={{ fontSize: alto ? 40 : 26, opacity: 0.5, lineHeight: 1 }}>{glifo}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: M.gray, letterSpacing: -0.2 }}>{titulo}</div>
      {texto && <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 260 }}>{texto}</div>}
    </div>
  );
}

function PainelContato({ c, aba, extra, fichaDe, vincular, ocupado }: {
  c: Contato | null; aba: AbaContato; extra?: any;
  /** a ficha de cadastro (0109); ausente em card sintetico do ERP */
  fichaDe?: (temErp: boolean) => React.ReactNode;
  /** "e a mesma pessoa": liga o contato ao cliente do ERP escolhido (0117) */
  vincular?: (codcli: number, nome: string) => void;
  ocupado?: boolean;
}) {
  if (!c) return <div style={{ padding: 14, fontSize: 12, color: M.muted }}>Carregando dados do cliente…</div>;
  const { compras, ciclo, funil, ultimas_notas } = c;
  const candidatos = c.erp_candidatos ?? [];

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

  // motor de ciclo desligado no /admin: some o que é DERIVADO (% do ciclo, ciclo
  // médio, sugestão de ação). O que é fato do ERP — comprado, dias sem comprar,
  // notas — continua, porque não faz parte do mecanismo em revisão.
  const cicloOn = c.ciclo_ativo !== false;
  // barra do ciclo: quanto do intervalo médio de recompra já passou
  const pct = !cicloOn || ciclo?.pct_ciclo == null ? null : Math.max(0, Math.min(140, Number(ciclo.pct_ciclo)));
  const corCiclo = pct == null ? M.muted : pct >= 100 ? M.laranja : pct >= 75 ? "#b8860b" : "#1a6b3c";

  // Aviso de "sem cadastro" só nas abas que dependem do ERP — a de Perfil ainda
  // mostra telefone/carteira/linha, que existem mesmo sem vínculo no WinThor.
  const semErp = !compras && !funil?.venda_valor && !ultimas_notas.length;
  const Vazio = ({ t }: { t: string }) => (
    <div style={{ padding: 14, fontSize: 12, color: M.muted, lineHeight: 1.5 }}>{t}</div>
  );

  // ---- D1 · a aba que o painel passa a abrir (0095) -------------------------
  // O laudo mediu que `abrir()` forçava "Perfil", e Perfil repete telefone e
  // carteira que o cabeçalho da conversa já mostra: os números que decidem o
  // que dizer — quanto ela compra, há quanto tempo sumiu, onde está no ciclo —
  // ficavam a um ou dois cliques. Aqui eles são a primeira coisa, em corpo
  // grande, porque são lidos de relance no meio de uma conversa.
  // `heroi` = o número que decide a conversa (quanto ela compra) ocupa a coluna
  // inteira, em corpo 26. Os outros dois ficam lado a lado embaixo, em 17.
  //
  // Não é preferência estética: três tiles iguais num painel de 268 px deixam
  // ~55 px de texto para cada, e `R$ 12.480,00` precisa de 112. Ou seja, quanto
  // MAIOR a cliente, mais cedo o número sumia — exatamente ao contrário do que
  // deveria. O painel foi a 320 na entrega 1; a hierarquia fecha a conta.
  const Numero = ({ r, v, cor, dica, heroi }: { r: string; v: string; cor?: string; dica?: string; heroi?: boolean }) => (
    <div title={dica} style={{ flex: 1, minWidth: 0, padding: heroi ? "10px 12px" : "9px 10px", background: M.bg, border: `1px solid ${M.border}`, borderRadius: 10 }}>
      <div style={{ fontSize: heroi ? 26 : 17, fontWeight: G.numeroHeroi ? 700 : 800, letterSpacing: heroi ? -0.8 : -0.4, lineHeight: heroi ? 1.05 : 1.2, fontVariantNumeric: "tabular-nums",
        color: cor ?? M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: M.gray, marginTop: heroi ? 2 : 1 }}>{r}</div>
    </div>
  );

  return (
    <div style={{ fontSize: 12.5 }}>
      {aba === "resumo" && (
        semErp ? (
          candidatos.length ? (
            // Mesma pista da aba Perfil, no lugar onde o painel ABRE -- o Resumo
            // e a aba padrao, entao e aqui que a consultora le primeiro.
            <div style={{ padding: 14, fontSize: 12, color: M.muted, lineHeight: 1.6 }}>
              Este <b>número</b> não está no cadastro do WinThor, por isso não há histórico de
              compra. Mas o <b>nome</b> já existe lá, com outro telefone —{" "}
              <b>{candidatos[0].nome}</b>, cód. {candidatos[0].codcli}
              {candidatos[0].rca_num != null && `, RCA ${candidatos[0].rca_num}`}
              {candidatos[0].telefone && `, telefone ${candidatos[0].telefone}`}.
              {" "}Pode ser a mesma cliente que trocou de número, ou um homônimo; veja a aba{" "}
              <b>Perfil</b>.
            </div>
          ) : (
            <Vazio t="Este contato não tem vínculo com o cadastro do WinThor, então não há histórico de compra para resumir. Preencher o CPF na ficha é o que cria o vínculo." />
          )
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: G.numeroHeroi ? "column" : "row", gap: 7, padding: "12px 14px 10px" }}>
              <Numero r="comprado" v={moedaBR(compras?.total_liquido)} heroi={G.numeroHeroi}
                dica="Faturamento líquido — já descontadas as devoluções" />
              {/* os dois de apoio dividem uma linha só quando há herói acima */}
              <div style={{ display: "flex", gap: 7, ...(G.numeroHeroi ? null : { display: "contents" as const }) }}>
                <Numero r="sem comprar"
                  v={compras?.dias_sem_comprar == null ? "—" : `${compras.dias_sem_comprar}d`}
                  cor={pct != null && pct >= 100 ? M.laranja : undefined}
                  dica="Dias desde a última nota faturada" />
                {cicloOn && (
                  <Numero r="do ciclo" v={pct == null ? "—" : `${Math.round(pct)}%`} cor={corCiclo}
                    dica="Quanto do intervalo médio de recompra desta cliente já passou" />
                )}
              </div>
            </div>
            {ciclo?.acao_recomendada && (
              <div style={{ margin: "0 14px 12px", padding: "9px 12px", fontSize: 12, lineHeight: 1.5,
                color: M.ink, background: M.roxoSoft, borderLeft: `3px solid ${M.wine}`, borderRadius: "0 8px 8px 0" }}>
                <b style={{ color: M.wine }}>Sugestão: </b>{ciclo.acao_recomendada}
              </div>
            )}
            <Bloco titulo="Compra">
              <Linha r="Última" v={dataBR(compras?.ultima_compra)} />
              <Linha r="Notas" v={compras?.compras ?? "—"} />
              {cicloOn && <Linha r="Ciclo médio" v={ciclo?.ciclo_medio == null ? "—" : `${Math.round(Number(ciclo.ciclo_medio))} dias`} />}
              {compras?.cidade && <Linha r="Cidade" v={compras.cidade} />}
            </Bloco>
            {funil?.venda_valor ? (
              <Bloco titulo="Este mês">
                <Linha r="Faturado" v={moedaBR(funil.venda_valor)} forte />
                <Linha r="Em" v={dataBR(funil.venda_data)} />
              </Bloco>
            ) : null}
          </>
        )
      )}
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
          ) : candidatos.length ? (
            // Trocou de numero: o cadastro velho continua no ERP, com CPF e
            // vinculo; o numero novo entrou como outra linha, sem CPF. Dizer
            // "sem cadastro" aqui e falso, e a equipe percebe na hora -- foi
            // exatamente essa a reclamacao (28/08/2026).
            <Bloco titulo="Este número não está no cadastro">
              <div style={{ padding: "2px 0 8px", fontSize: 12, color: M.muted, lineHeight: 1.5 }}>
                Este nome já existe no WinThor
                {candidatos.length > 1 ? ` (${candidatos.length} cadastros)` : ""}, com{" "}
                <b>outro telefone</b>. Pode ser a mesma pessoa que <b>trocou de número</b> — ou um{" "}
                <b>homônimo</b>. Confira antes de decidir:
              </div>
              {candidatos.map((k) => (
                <div key={k.codcli} style={{
                  borderLeft: `3px solid ${M.roxo}`, padding: "6px 10px", marginBottom: 6,
                  background: M.bg, borderRadius: 6, fontSize: 12, lineHeight: 1.5,
                }}>
                  <div style={{ fontWeight: 700 }}>{k.nome}</div>
                  <div style={{ color: M.muted }}>
                    cód. {k.codcli}
                    {k.rca_num != null && ` · RCA ${k.rca_num}${k.rca_nome ? ` (${k.rca_nome})` : ""}`}
                    {k.cidade && ` · ${k.cidade}`}
                  </div>
                  {k.telefone && <div style={{ color: M.muted }}>telefone no cadastro: {k.telefone}</div>}
                  {vincular && (
                    // O gesto humano que o sistema nao pode dar sozinho. Dai o
                    // rotulo dizer o que ele AFIRMA ("e a mesma pessoa"), e nao
                    // o que ele executa ("vincular"): quem clica esta assumindo
                    // a identidade, e e isso que precisa estar consciente.
                    <button
                      disabled={ocupado}
                      onClick={() => vincular(k.codcli, k.nome)}
                      style={{ marginTop: 7, padding: "6px 10px", fontSize: 12, fontWeight: 700,
                        fontFamily: "inherit", color: "#fff", background: M.roxo, border: "none",
                        borderRadius: 8, cursor: ocupado ? "wait" : "pointer", opacity: ocupado ? 0.6 : 1 }}>
                      É a mesma pessoa
                    </button>
                  )}
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: M.muted, lineHeight: 1.5 }}>
                Se for a mesma pessoa, preencher o CPF na ficha cria o vínculo sozinho em até
                10 minutos: o histórico de compra aparece aqui e a conversa passa para o RCA do
                cadastro. Se for homônimo, não preencha — são duas pessoas.
              </div>
            </Bloco>
          ) : (
            <Vazio t="Não encontrei este contato no WinThor — ainda não vinculado a um cliente do ERP." />
          )}
          {fichaDe && fichaDe(!!compras)}
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
// No "!" o motivo entra como `title`: até a 0091 a explicação da Meta só existia
// no log da Vercel, e quem estava na tela via a falha sem a causa.
function Ticks({ status, erro }: { status: string | null; erro?: string | null }) {
  if (status === "failed") {
    return (
      <span title={erro ?? "a Meta não explicou o motivo"}
        style={{ color: M.laranja, fontWeight: 800, cursor: erro ? "help" : "default" }}>!</span>
    );
  }
  const lida = status === "read" || status === "checked";
  const duplo = lida || status === "success";
  return (
    <span style={{ color: lida ? M.azul : M.muted, letterSpacing: -2, fontWeight: 700 }}>
      {duplo ? "✓✓" : "✓"}
    </span>
  );
}

/**
 * Compositor do template: um campo por `{{n}}` do texto aprovado, e a prévia do
 * que a cliente vai ler montada enquanto se digita.
 *
 * Por que existe: até aqui, escolher um template ERA enviá-lo, e o `{{1}}` era
 * preenchido pelo servidor com o primeiro nome — o consultor não tinha como
 * dizer nada. O campo do nome continua chegando pronto (é o uso mais comum),
 * só que agora dá para trocar por qualquer coisa antes de enviar.
 *
 * A régua de validação é a mesma de `lib/templateVars.ts` que a rota aplica: a
 * tela desabilita o botão cedo, o servidor confere de novo — a Meta recusa o
 * disparo inteiro por um parâmetro vazio, e essa recusa chegaria minutos depois,
 * pelo webhook, longe do clique que a causou.
 */
function CompositorTemplate({
  t, campos, valores, enviando, onMudar, onVoltar, onEnviar,
}: {
  t: TemplateEscolha; campos: number[]; valores: string[]; enviando: boolean;
  onMudar: (i: number, v: string) => void; onVoltar: () => void; onEnviar: () => void;
}) {
  const erro = conferirVariaveis(t.corpo, valores);
  const previa = t.corpo ? aplicarVariaveis(t.corpo, valores) : null;
  // o cursor vai para o primeiro campo AINDA VAZIO: com o nome já preenchido,
  // o que interessa a quem abriu isto é o campo seguinte
  const foco = Math.max(0, valores.findIndex((v) => !v.trim()));

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button onClick={onVoltar} title="Escolher outro template"
          style={{ border: "none", background: "transparent", color: M.roxo, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
          ‹ templates
        </button>
        <b style={{ fontSize: 13, color: M.ink, marginLeft: "auto" }}>{t.nome}</b>
        {t.cabecalho_tipo === "imagem" && <span style={{ fontSize: 11 }} title="este template vai com imagem">🖼️</span>}
      </div>

      {campos.map((n, i) => (
        <div key={n} style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .4, textTransform: "uppercase", color: M.muted }}>
            {i === 0 && t.corpo ? "Campo 1 · veio com o nome da cliente" : `Campo ${n}`}
          </label>
          <input
            autoFocus={i === foco}
            value={valores[i] ?? ""}
            onChange={(e) => onMudar(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !erro && !enviando) { e.preventDefault(); onEnviar(); }
              if (e.key === "Escape") { e.preventDefault(); onVoltar(); }
            }}
            placeholder="digite o texto deste campo"
            style={{ width: "100%", boxSizing: "border-box", marginTop: 3, padding: "8px 10px", borderRadius: 9, border: `1px solid ${M.border}`, background: M.bg, color: M.ink, fontSize: 13, fontFamily: "inherit", outline: "none" }}
          />
        </div>
      ))}

      {previa !== null ? (
        <div style={{ marginTop: 10, padding: "9px 11px", borderRadius: 10, background: M.roxoSoft, border: `1px solid ${M.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: M.muted, marginBottom: 4 }}>
            o que a cliente vai ler
          </div>
          <div style={{ fontSize: 12.5, color: M.ink, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{previa}</div>
        </div>
      ) : (
        <div style={{ marginTop: 10, fontSize: 11.5, color: M.gray, lineHeight: 1.5 }}>
          O texto deste template mora no painel do RD Conversas — o que você escrever aqui
          entra no campo dele, mas não temos como mostrar a frase inteira daqui.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}>
        <span style={{ fontSize: 11, color: M.laranja, flex: 1, lineHeight: 1.4 }}>{erro ?? ""}</span>
        <button onClick={onEnviar} disabled={!!erro || enviando}
          style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: erro || enviando ? M.border : M.roxo, color: "#fff", fontSize: 12, fontWeight: 800, letterSpacing: .3, cursor: erro || enviando ? "default" : "pointer", fontFamily: "inherit" }}>
          {enviando ? "enviando…" : "Enviar"}
        </button>
      </div>
    </div>
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
  // desenho da tela em vigor para esta pessoa (0095). Vem do mesmo load da
  // lista — o servidor já resolveu global × piloto em `layoutEfetivo`.
  const [layout, setLayout] = useState<string>("original");
  // rodando como app instalado (PWA na tela inicial ou APK/TWA). Em efeito, e
  // nao no render, porque `ehApp()` lê `window` — calcular direto daria
  // hidratação divergente entre servidor e cliente.
  const [modoApp, setModoApp] = useState(false);
  // Embutido = a lupa do board, que renderiza esta mesma tela num <iframe>
  // estreito (§41). Duas consequências, e nenhuma delas precisou de layout novo:
  //  · `isMobile` é `innerWidth < 768` e, dentro do iframe, innerWidth é a
  //    largura DELE — a visão de celular se liga sozinha;
  //  · a navegação do topo já sabe sumir, pelo `modoApp` do PWA.
  const [embutido, setEmbutido] = useState(false);
  useEffect(() => {
    let emb = false;
    try { emb = new URLSearchParams(window.location.search).get("embed") === "1"; } catch {}
    setEmbutido(emb);
    setModoApp(emb || ehApp());
  }, []);

  // ---- notificação com o app fechado (0096) --------------------------------
  // `null` = ainda não sabemos, e nesse estado nada é desenhado: um botão
  // "Ativar" que pisca e some ao descobrir que já estava ativo é pior que
  // esperar meio segundo.
  const [push, setPush] = useState<boolean | null>(null);
  const [pushOcupado, setPushOcupado] = useState(false);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const cfg = await fetch("/api/chat/push", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      // sem chave VAPID no servidor o recurso não existe: a tela some com o
      // botão em vez de oferecer algo que vai falhar
      if (!vivo || !cfg?.disponivel) return;
      setPush(await pushInscrito());
    })();
    return () => { vivo = false; };
  }, []);

  async function alternarPush() {
    setPushOcupado(true);
    try {
      if (push) {
        await desativarPush();
        setPush(false);
        setAviso("Notificações desligadas neste aparelho.");
      } else {
        const r = await ativarPush();
        if (r.ok) { setPush(true); setAviso(null); }
        else setAviso(r.motivo);
      }
    } finally { setPushOcupado(false); }
  }
  // declarada aqui, e não junto de `d1` lá embaixo, porque `abrir()` a usa e
  // fica acima no arquivo — depender da ordem de declaração dentro do render
  // é o tipo de acoplamento que quebra em silêncio numa refatoração
  // Só o `original` abre no telefone: é a aba que repete o cabeçalho. Todo
  // desenho novo abre no resumo comercial, que é a vantagem sobre o RD.
  // Escrito pela negativa (`=== "original"`) de propósito — assim uma direção
  // futura nasce no resumo em vez de nascer na aba errada por esquecimento.
  const abaPadrao: AbaContato = layout === "original" ? "perfil" : "resumo";
  // ---- novo contato: "digitar o número e conversar", como num WhatsApp -----
  // O contato criado ainda NÃO tem mensagem, então não entra na `vw_funil_visivel`
  // (que exige conversa) — por isso ele é adicionado à lista LOCALMENTE e
  // selecionado na hora. Assim que o primeiro template sair, ele passa a vir do
  // servidor como qualquer outra conversa, com o mesmo cliente_id.
  const [novoAberto, setNovoAberto] = useState(false);
  const [novoTel, setNovoTel] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoOcupado, setNovoOcupado] = useState(false);
  const [novosLocais, setNovosLocais] = useState<Conversa[]>([]);

  // ---- agenda da carteira (§38) -------------------------------------------
  // Buscada UMA vez, e só quando a aba é aberta: são até 961 linhas por
  // vendedor que não têm por que pesar na abertura do chat.
  const [carteira, setCarteira] = useState<ContatoCarteira[] | null>(null);
  const [carteiraCarregando, setCarteiraCarregando] = useState(false);
  // Quantos nomes da agenda estão desenhados. A lista inteira (~4,7 mil botões)
  // pesa no navegador, então ela cresce sob demanda em vez de aparecer de uma
  // vez — mas o corte NÃO pode ser um teto fixo: era "Mostrando 400 de 4696",
  // sem nenhum jeito de ver o 401º a não ser buscar, e a busca estava quebrada.
  const [carteiraLimite, setCarteiraLimite] = useState(400);
  const carregarCarteira = useCallback(async () => {
    setCarteiraCarregando(true);
    try {
      const r = await fetch("/api/chat/carteira", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setCarteira(r.ok ? (j.carteira ?? []) : []);
      if (!r.ok) setAviso(j?.error ?? `não consegui carregar a carteira (erro ${r.status})`);
    } catch (e: any) { setCarteira([]); setAviso(String(e?.message ?? e)); }
    finally { setCarteiraCarregando(false); }
  }, []);

  // Lê o `?cliente=` uma vez, na montagem. `useSearchParams` do Next exigiria
  // <Suspense> em volta da página inteira; a querystring aqui é um parâmetro de
  // navegação simples, e ler do `location` evita esse arrasto.
  useEffect(() => {
    try { clienteDaUrl.current = new URLSearchParams(window.location.search).get("cliente"); } catch {}
  }, []);

  // Assim que a lista chega, seleciona o cliente que veio na URL. Se ele não
  // estiver na lista (contato sem conversa, ou fora do filtro), busca o mínimo
  // na thread e monta a conversa — o mesmo caminho do botão + e da carteira.
  useEffect(() => {
    const alvo = clienteDaUrl.current;
    // Embutido não carrega lista, então não pode esperar por ela — resolve o
    // cliente direto na thread. Fora dele, espera a lista para poder selecionar
    // o objeto certo (com não-lidas, status e transferência já resolvidos).
    if (!alvo || jaAbriuDaUrl.current || (!embutido && !conversas.length)) return;
    jaAbriuDaUrl.current = true;
    const achada = conversas.find((c) => c.cliente_id === alvo);
    if (achada) { abrirRef.current?.(achada); return; }
    void (async () => {
      try {
        const r = await fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(alvo)}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        const cli = j?.cliente;
        if (!cli) { setAviso("Não encontrei essa conversa."); return; }
        abrirRef.current?.({
          cliente_id: cli.id, cliente: cli.nome, vendedor: cli.carteira ?? null,
          etapa: null, telefone: cli.telefone ?? null, ultima_atividade: null,
          ultima_mensagem: null, ultima_enviada_por: null, na_fila: !cli.carteira,
        });
      } catch { setAviso("Não consegui abrir essa conversa."); }
    })();
  }, [conversas, embutido]);

  // ⚠️ ESTE useEffect FICA AQUI, e não junto do resto da lógica da carteira lá
  // embaixo: a partir da linha ~1426 o componente tem `return` condicional
  // (`if (sessao === undefined) return ...`). Hook depois de um return é
  // chamado num render e não no outro — React #310, tela branca. O arquivo já
  // avisa disso no comentário do `abaPadrao`; eu caí mesmo assim, e só o teste
  // no navegador pegou.
  useEffect(() => {
    if (filtro === "carteira" && carteira === null && !carteiraCarregando) void carregarCarteira();
  }, [filtro, carteira, carteiraCarregando, carregarCarteira]);

  const [menuFila, setMenuFila] = useState(false);   // dropdown "Meus atendimentos"
  const [menuVend, setMenuVend] = useState(false);   // dropdown de vendedor (admin/home)
  const [maisAberto, setMaisAberto] = useState(false); // "⋯" do compositor na lupa
  // O 📎 vira MENU, como no WhatsApp: anexo e localizacao no mesmo lugar. Assim
  // a localizacao nao custa mais um icone na barra -- e o gesto ja e o que a
  // pessoa conhece ("clipe = mandar alguma coisa que nao e texto").
  const [anexoAberto, setAnexoAberto] = useState(false);
  // Paginação para trás: a thread trazia 200 mensagens e PARAVA SEM AVISAR --
  // numa cliente de anos, a conversa mais antiga não existia para quem rolava.
  const [temMais, setTemMais] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  // Encaminhar: a mensagem escolhida, e para quem. A Cloud API nao tem
  // "forward" -- e reenviar o conteudo, e a cliente NAO ve o selo
  // "Encaminhada". A tela diz isso antes de confirmar.
  const [encaminhando, setEncaminhando] = useState<any>(null);
  const [buscaEnc, setBuscaEnc] = useState("");
  const [locais, setLocais] = useState<{ nome: string; endereco: string; lat: number; lng: number }[]>([]);
  useEffect(() => {
    fetch("/api/chat/localizacao", { cache: "no-store" })
      .then((r) => r.json()).then((j) => setLocais(j?.locais ?? []))
      .catch(() => {});   // sem enderecos cadastrados a opcao simplesmente nao aparece
  }, []);
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
  // progresso do envio em lote (várias fotos de uma vez)
  // `pct` = quanto do arquivo ATUAL já subiu para o Storage. Só é preenchido
  // acima de 2 MB — num anexo pequeno o número piscaria e sumiria.
  const [fila, setFila] = useState<{ feito: number; total: number; pct: number | null } | null>(null);
  // O que o clipe mostra enquanto envia. Lote ganha de porcentagem: saber que
  // faltam 3 de 5 fotos vale mais que os 40% da terceira.
  const rotuloFila = !fila ? null
    : fila.total > 1 ? `${fila.feito}/${fila.total}`
    : fila.pct != null ? `${fila.pct}%`
    : null;
  const [canalEnvio, setCanalEnvio] = useState<"rd" | "whatsapp" | null>(null);
  // histórico do outro número (0103): quantas mensagens a seleção de linhas
  // esconde nesta conversa, e se já foram trazidas
  const [ocultas, setOcultas] = useState(0);
  const [comHistorico, setComHistorico] = useState(false);
  // `/chat?cliente=<id>` — o board manda o vendedor para cá com a conversa já
  // selecionada. Guardado num ref porque só vale UMA vez: sem isso, qualquer
  // recarga da lista puxaria a seleção de volta para aquele cliente, tirando o
  // vendedor de onde ele foi parar.
  const clienteDaUrl = useRef<string | null>(null);
  const jaAbriuDaUrl = useRef(false);
  // `abrir()` é declarada bem abaixo, depois de coisas que ela usa. O efeito do
  // deep link roda ANTES dela no arquivo, e hook não pode descer para depois de
  // um `return` condicional (React #310, §38.4) — então a ponte é um ref.
  const abrirRef = useRef<((c: Conversa) => void) | null>(null);
  const [contato, setContato] = useState<Contato | null>(null);
  // Motor de ciclo (crm_config, 0097). Estado SEPARADO de `contato` de propósito:
  // `contato` volta a null a cada conversa aberta, e ler o interruptor de lá faria
  // a aba "Ciclo" piscar na lista toda vez. É config global — uma vez sabida, vale
  // para todas as conversas.
  const [cicloAtivo, setCicloAtivo] = useState(true);
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
  // catálogo de templates para o seletor do botão TEMPLATE (migration 0090):
  // o vendedor escolhe vendo o TEXTO, como no RD Conversas, em vez de disparar
  // um "template padrão" que ele não sabe qual é
  const [templates, setTemplates] = useState<TemplateEscolha[]>([]);
  const [menuTemplate, setMenuTemplate] = useState(false);
  // Template escolhido e o que o consultor está digitando nos {{n}} dele.
  // Enquanto isto existe, o menu mostra o compositor no lugar da lista —
  // escolher um template deixou de ser o mesmo gesto que disparar um.
  const [compondo, setCompondo] = useState<{ t: TemplateEscolha; valores: string[] } | null>(null);
  // filtro por VENDEDOR, como no board: só para quem enxerga mais de uma
  // carteira (admin/home). Vendedor já vê só a própria — chip seria redundante.
  const [vendFiltro, setVendFiltro] = useState<string | null>(null);

  // Trocar o termo da busca ou o vendedor recomeça a agenda do topo. Sem isto,
  // quem tivesse expandido para 2.000 nomes e depois digitasse um nome ficaria
  // com o "mostrar mais" de um recorte anterior — e a lista voltaria a crescer a
  // partir de um número que não diz nada sobre a busca atual.
  //
  // Mora AQUI, e não junto do estado da carteira lá em cima, porque depende de
  // `vendFiltro`: declarado na linha acima, ele não existe antes deste ponto e
  // referenciá-lo em cima estoura em tempo de render.
  useEffect(() => { setCarteiraLimite(400); }, [busca, vendFiltro]);
  const [achados, setAchados] = useState<Conversa[] | null>(null);  // busca no conteúdo
  const [buscandoMsgs, setBuscandoMsgs] = useState(false);
  const [truncado, setTruncado] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const textoRef = useRef<HTMLTextAreaElement>(null);

  // ---- a caixa cresce com o texto, como no WhatsApp ------------------------
  // `rows={1}` sozinho nao faz isso: a altura fica travada em uma linha e o
  // resto do texto rola por dentro, escondido. O truque e zerar a altura antes
  // de ler `scrollHeight` -- sem zerar, o valor lido e sempre o atual, e a
  // caixa so cresce, nunca volta a encolher quando a pessoa apaga ou envia.
  //
  // O teto existe para a conversa nao sumir atras do compositor: passando
  // dele, a caixa rola por dentro -- que e o que o WhatsApp faz tambem.
  const crescer = useCallback(() => {
    const el = textoRef.current;
    if (!el) return;
    const teto = embutido ? 92 : 132;   // `compacto` so existe mais abaixo; e o mesmo valor
    // ⚠️ `0px`, e nao `auto`. Com `auto` o navegador devolvia `scrollHeight` do
    // estado ANTERIOR (medido: campo vazio reportando 50px), entao a caixa
    // crescia e nunca voltava a encolher. Zerar a altura obriga o recalculo, e
    // o valor lido passa a ser o do conteudo de agora.
    el.style.height = "0px";
    const alvo = Math.min(el.scrollHeight, teto);
    el.style.height = alvo + "px";
    el.style.overflowY = el.scrollHeight > teto ? "auto" : "hidden";
  }, [embutido]);

  // Roda tambem quando o texto muda por FORA da digitacao: resposta rapida,
  // "pedir os dados", reenviar uma falha, e o esvaziar depois do envio -- sem
  // isto a caixa ficaria alta com o campo vazio, ou baixa com texto colado.
  useEffect(() => { crescer(); }, [texto, crescer]);
  // ancora da chegada individual: a data da mensagem mais nova que a tela ja
  // tem. Em ref, e nao em estado, porque quem a le e um callback do Realtime
  // criado uma vez -- lendo estado, ele ficaria eternamente com o valor do
  // render em que foi montado, e toda mensagem nova viria "desde" a mesma data.
  //
  // ⚠️ A bolha OTIMISTA nao serve de ancora: a data dela e a do relogio do
  // navegador, que adianta em relacao ao banco com mais frequencia do que se
  // imagina. Um relogio 30 s adiantado faria o `desde` pular as mensagens
  // gravadas nesse intervalo -- e elas nao voltariam nunca, porque o proximo
  // pedido partiria de uma data ainda mais a frente.
  const ultimaMsgRef = useRef<string | null>(null);
  const doServidor = (msgs ?? []).filter((m) => !String(m.id).startsWith("tmp:"));
  ultimaMsgRef.current = doServidor.length ? doServidor[doServidor.length - 1].criada_em : null;
  const comHistoricoRef = useRef(false);
  comHistoricoRef.current = comHistorico;
  // o callback do Realtime e montado uma vez; chamar a funcao por ref evita
  // que ele fique preso na versao do primeiro render
  const apanharNovasRef = useRef<((c: Conversa) => Promise<number>) | null>(null);
  const recargaLenta = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const rolagemRef = useRef<HTMLDivElement>(null);   // área das mensagens (botões ⌃⌄)
  const selRef = useRef<Conversa | null>(null);
  selRef.current = sel;
  // guarda de in-flight: nunca empilha recargas (mesmo padrão do board).
  //
  // ⚠️ `pedidaDeNovo` NAO estava aqui, e a falta dela contrariava o proprio
  // comentario: a guarda antiga fazia `return` e PERDIA o evento. Numa rajada,
  // a lista congelava no estado de quando a primeira recarga comecou, porque
  // todos os avisos seguintes caiam nesse `return`. Coalescer e o que a §15.3
  // descreve: nunca empilha, nunca perde.
  const carregandoLista = useRef(false);
  const pedidaDeNovo = useRef(false);
  // a propria funcao, para o `finally` dela poder se rechamar
  const carregarListaRef = useRef<(() => void) | null>(null);

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
    if (carregandoLista.current) { pedidaDeNovo.current = true; return; }
    carregandoLista.current = true;
    try {
      const r = await fetch("/api/chat", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok) {
        setConversas(j?.conversas ?? []);
        setVendedores(j?.vendedores ?? []);
        setLinhas(j?.linhas ?? []);
        if (j?.layout) setLayout(j.layout);
        setErro(null);
      }
      else if (r.status === 401) setSessao(null);
      else setErro(j?.error ?? `erro ${r.status}`);
    } finally {
      carregandoLista.current = false;
      // chegou aviso enquanto esta rodava: uma recarga a mais, nao N
      if (pedidaDeNovo.current) { pedidaDeNovo.current = false; carregarListaRef.current?.(); }
    }
  }, []);
  carregarListaRef.current = carregarLista;

  // catálogo carregado uma vez: muda com deploy de admin, não durante o turno
  useEffect(() => {
    fetch("/api/templates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setTemplates(j?.templates ?? []))
      .catch(() => {});
  }, []);

  const carregarThread = useCallback(async (c: Conversa, scroll = true, historico = false) => {
    const r = await fetch(
      `/api/chat/thread?cliente_id=${encodeURIComponent(c.cliente_id)}${historico ? "&historico=1" : ""}`,
      { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok) { setErro(j?.error ?? `erro ${r.status}`); return; }
    // ⚠️ MERGE, nao substituicao seca.
    //
    // A recarga completa e uma FOTO de um instante. Enquanto ela viajava, o
    // `apanharNovas` abaixo pode ter pendurado uma mensagem que chegou depois
    // da foto ser tirada -- e um `setMsgs(lista)` a apagaria da tela. Ela nao
    // voltaria no proximo aviso (aquele so traz o que e mais novo que a ultima
    // que temos, e ela ainda estaria na lista) -- so no poll de 60 s. Bolha
    // sumindo por alguns minutos e pior que bolha atrasada.
    //
    // O criterio e o unico defensavel: o que for estritamente mais novo que a
    // linha mais recente da foto chegou DEPOIS dela, entao sobrevive.
    setMsgs((atual) => juntar(atual, j?.mensagens ?? []));
    setCanalEnvio(j?.canal_envio ?? null);
    setOcultas(j?.historico_oculto ?? 0);
    setComHistorico(!!j?.historico_carregado);
    setNotas(j?.notas ?? []);
    setTransferencias(j?.transferencias ?? []);
    setLigacoes(j?.ligacoes ?? []);
    setLinha(j?.linha ?? null);
    setTemMais(!!j?.tem_mais);
    if (scroll) setTimeout(() => fimRef.current?.scrollIntoView({ behavior: "auto" }), 30);
  }, []);

  /**
   * Junta a foto do servidor com o que ja apareceu na tela depois dela.
   * Fora do componente nao da: precisa ser estavel entre renders e nao depende
   * de estado nenhum -- por isso e uma funcao pura, declarada no modulo.
   */

  /**
   * CHEGADA INDIVIDUAL: busca so o que existe depois da ultima mensagem que
   * temos, e pendura na conversa.
   *
   * Este e o caminho que o aviso do Realtime passa a usar. O outro
   * (`carregarThread`) continua existindo e continua sendo o certo ao ABRIR a
   * conversa, ao trocar de filtro e no poll de 60 s -- ele e quem traz notas,
   * transferencias, ligacoes e, principalmente, os TIQUES de entrega das
   * mensagens antigas, que `?desde=` por definicao nao alcanca.
   *
   * Devolve quantas chegaram: quem chamou usa para decidir se rola a tela.
   */
  const apanharNovas = useCallback(async (c: Conversa): Promise<number> => {
    const ultima = ultimaMsgRef.current;
    // Sem ancora = conversa aberta sem nenhuma mensagem (contato recem-criado, ou
    // a primeira fala da cliente). Nao ha "depois de" para perguntar, entao cai
    // na recarga completa -- que aqui e barata, porque a conversa esta vazia.
    if (!ultima) { await carregarThread(c, false); return 0; }
    const r = await fetch(
      `/api/chat/thread?cliente_id=${encodeURIComponent(c.cliente_id)}&desde=${encodeURIComponent(ultima)}` +
      (comHistoricoRef.current ? "&historico=1" : ""),
      { cache: "no-store" });
    if (!r.ok) return 0;                       // silencioso de proposito: a recarga coalescida cobre
    const j = await r.json().catch(() => null);
    // Tiques primeiro: valem mesmo quando nao chegou mensagem nenhuma -- o
    // aviso do Realtime dispara tambem por mudanca de status.
    const estados: { id: string; status?: string | null; erro?: string | null }[] = j?.estados ?? [];
    if (estados.length) {
      const novoEstado = new Map(estados.map((e) => [e.id, e]));
      setMsgs((atual) => {
        if (!atual?.length) return atual;
        let mexeu = false;
        const fim = atual.map((m) => {
          const e = novoEstado.get(m.id);
          if (!e || (e.status === m.status && (e.erro ?? null) === (m.erro ?? null))) return m;
          mexeu = true;
          return { ...m, status: e.status as any, erro: e.erro ?? null };
        });
        // sem mudanca real, devolve o MESMO array: um array novo a cada aviso
        // repintaria a thread inteira sem nada ter mudado
        return mexeu ? fim : atual;
      });
    }
    const novas = j?.mensagens ?? [];
    if (!novas.length) return 0;
    // Rolar ate o fim SO se a pessoa ja estava no fim. Quem subiu para reler um
    // preco nao pode ser arrancado de la por uma mensagem nova -- e o mesmo
    // cuidado que `carregarAntigas` toma na direcao oposta. 120 px de folga
    // porque "no fim" na pratica nunca e exatamente zero.
    const cx = rolagemRef.current;
    const noFim = !cx || cx.scrollHeight - cx.scrollTop - cx.clientHeight < 120;
    setMsgs((atual) => juntar(atual, novas, true));
    if (noFim) setTimeout(() => fimRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
    return novas.length;
  }, [carregarThread]);
  apanharNovasRef.current = apanharNovas;

  /**
   * Traz o lote anterior de mensagens (item 4 da fila).
   *
   * ⚠️ A parte delicada não é buscar, é **não arrancar a pessoa de onde ela
   * está lendo**. Ao inserir mensagens ACIMA, o navegador mantém o `scrollTop`
   * e o conteúdo desce — a leitura salta. O truque é medir `scrollHeight`
   * antes, e depois somar a diferença ao `scrollTop`: o ponto que estava sob os
   * olhos continua sob os olhos.
   *
   * O cursor é a DATA da mensagem mais antiga carregada, não um offset: com
   * offset, uma mensagem nova chegando durante a rolagem faria repetir ou pular
   * uma bolha.
   */
  async function carregarAntigas() {
    const cx = rolagemRef.current;
    const primeira = msgs?.[0];
    if (!sel || !primeira || carregandoAntigas) return;
    setCarregandoAntigas(true);
    const alturaAntes = cx?.scrollHeight ?? 0;
    const topoAntes = cx?.scrollTop ?? 0;
    try {
      const r = await fetch(
        `/api/chat/thread?cliente_id=${encodeURIComponent(sel.cliente_id)}` +
        `&antes=${encodeURIComponent(primeira.criada_em)}${comHistorico ? "&historico=1" : ""}`,
        { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setAviso(j?.error ?? `erro ${r.status}`); return; }
      const lote = j?.mensagens ?? [];
      setTemMais(!!j?.tem_mais);
      if (!lote.length) return;
      setMsgs((atual) => [...lote, ...(atual ?? [])]);
      // depois do render, devolve a posição de leitura
      setTimeout(() => {
        const el = rolagemRef.current;
        if (el) el.scrollTop = topoAntes + (el.scrollHeight - alturaAntes);
      }, 0);
    } finally { setCarregandoAntigas(false); }
  }

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
    // Embutido mostra UMA conversa: buscar a lista inteira (~3.900) só para
    // isso seria o mesmo desperdício que a §15.1 corrigiu no board.
    if (!embutido) carregarLista();
    carregarRespostas();
    // Rede de protecao. Continua recarregando TUDO de proposito: e aqui que os
    // tiques de entrega das mensagens antigas, as notas e as transferencias se
    // acertam -- o lote incremental, por definicao, so olha para a frente.
    const lento = setInterval(() => {
      if (!embutido) carregarLista();
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
            // ---- CHEGADA INDIVIDUAL --------------------------------------
            //
            // Antes, cada aviso disparava DUAS recargas completas: a lista de
            // conversas (1,3 a 2,2 s, a rota mais cara do chat) e a thread
            // inteira (200 mensagens, ~82 KB). Numa rajada de dez mensagens em
            // dez segundos eram vinte recargas concorrentes -- e a conversa so
            // se mexia quando aquilo tudo desafogava, todas as bolhas de uma
            // vez. Medido em 30/08/2026: o webhook grava cada mensagem
            // separadamente em 1,3 a 4,8 s, e o Realtime entrega cada aviso em
            // 80 ms. O enfileiramento era todo daqui.
            //
            // Agora o aviso pede so o que e novo -- uma linha, um indice -- e
            // pendura a bolha na hora. A recarga cara vai para o balde
            // coalescido logo abaixo.
            if (selRef.current) apanharNovasRef.current?.(selRef.current);
            // A lista de conversas (previa, nao-lidas, ordem) e a unica coisa
            // que ainda precisa da rota cara. Ela nao precisa ser instantanea:
            // esperar 1,2 s faz uma rajada inteira caber numa recarga so, em
            // vez de uma por mensagem. A guarda de coalescencia ja impede
            // empilhamento; este atraso impede ate a fila de formar.
            if (!embutido) {
              if (recargaLenta.current) clearTimeout(recargaLenta.current);
              recargaLenta.current = setTimeout(() => carregarLista(), 1200);
            }
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
      if (recargaLenta.current) clearTimeout(recargaLenta.current);
      setConectado(false);
      try { canal?.unsubscribe(); } catch {}
      try { canalPresenca?.unsubscribe(); } catch {}
      presencaCanalRef.current = null;
    };
  }, [sessao, carregarLista, carregarThread, carregarRespostas, rotuloUsuario, embutido]);

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

  // Cria (ou acha) o contato e abre a conversa na hora. A rota NÃO envia nada:
  // cadastrar e mandar mensagem são gestos separados de propósito — um clique em
  // "abrir conversa" nunca deve disparar mensagem para um número digitado errado.
  async function criarContato() {
    const tel = novoTel.trim();
    if (!tel || novoOcupado) return;
    setNovoOcupado(true);
    try {
      const r = await fetch("/api/chat/novo-contato", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefone: tel, nome: novoNome.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(j?.error ?? `não consegui abrir (erro ${r.status})`); return; }

      const jaNaLista = conversas.find((x) => x.cliente_id === j.cliente_id);
      const conv: Conversa = jaNaLista ?? {
        cliente_id: j.cliente_id, cliente: j.nome, vendedor: j.carteira ?? null,
        etapa: null, telefone: tel, ultima_atividade: null,
        ultima_mensagem: null, ultima_enviada_por: null,
        na_fila: !j.carteira,
      };
      // sem conversa ainda, o servidor não o devolve na lista (a view exige
      // mensagem): fica aqui até o primeiro envio, e some daqui quando o
      // servidor passar a mandá-lo
      if (!jaNaLista) setNovosLocais((n) => [conv, ...n.filter((x) => x.cliente_id !== conv.cliente_id)]);
      setNovoAberto(false); setNovoTel(""); setNovoNome("");
      setAviso(j.ja_existia ? `Esse número já estava na base como “${j.nome}”.` : null);
      abrir(conv);
    } catch (e: any) {
      setAviso(String(e?.message ?? e));
    } finally {
      setNovoOcupado(false);
    }
  }

  // Abre a conversa de um contato da agenda. Se ele JÁ está na lista carregada,
  // seleciona aquele objeto — assim não-lidas, status e transferência ficam
  // certos; senão monta a conversa na hora, como o botão + faz.
  function abrirDaCarteira(k: ContatoCarteira) {
    if (!k.cliente_id) { setAviso(`${k.cliente}: ${k.impedimento}`); return; }
    const existente = conversas.find((c) => c.cliente_id === k.cliente_id);
    if (existente) { abrir(existente); return; }
    const conv: Conversa = {
      cliente_id: k.cliente_id, cliente: k.cliente, vendedor: k.vendedor,
      etapa: null, telefone: k.telefone, ultima_atividade: null,
      ultima_mensagem: null, ultima_enviada_por: null, na_fila: !k.vendedor,
    };
    setNovosLocais((n) => [conv, ...n.filter((x) => x.cliente_id !== conv.cliente_id)]);
    abrir(conv);
  }

  // Salva nome/CPF do contato. Só faz sentido para contato NOSSO (`wa:`) ou do
  // RD — card sintético do ERP não é contato, é cliente, e a rota recusa.
  function carregarContatoDe(clienteId: string) {
    fetch(`/api/chat/contato?cliente_id=${encodeURIComponent(clienteId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { setContato(j ?? null); if (j) setCicloAtivo(j.ciclo_ativo !== false); })
      .catch(() => setContato(null));
  }

  // "É a mesma pessoa": o consultor confirma que o contato sem cadastro é o
  // cliente do ERP que o painel sugeriu pelo nome (0117). O servidor faz o
  // resto — CPF, vínculo, e o pedido de atualização do telefone, se mudou.
  const [vinculando, setVinculando] = useState(false);
  const vincularContato = useCallback(async (codcli: number, nome: string) => {
    if (!sel || vinculando) return;
    if (!confirm(
      `Confirmar que este contato é ${nome} (cód. ${codcli})?\n\n` +
      `O histórico de compra passa a aparecer aqui e a conversa vai para o RCA do ` +
      `cadastro. Se for homônimo, cancele — são duas pessoas.`
    )) return;
    setVinculando(true);
    try {
      const r = await fetch("/api/chat/vincular", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, codcli }),
      });
      const j = await r.json().catch(() => ({}));
      setAviso(r.ok ? (j?.aviso ?? "vinculado") : (j?.error ?? `erro ${r.status}`));
      if (r.ok) { carregarContatoDe(sel.cliente_id); carregarThread(sel, false); }
    } catch {
      setAviso("não consegui vincular agora");
    } finally { setVinculando(false); }
  }, [sel, vinculando]);

  // Pausa: avisa o cliente que o vendedor vai se ausentar (0106). As travas
  // (janela de 24h, não repetir) moram no servidor — aqui só o gesto e o recado.
  const [pausando, setPausando] = useState(false);
  async function avisarPausa() {
    if (!sel || pausando) return;
    setPausando(true); setAviso(null);
    try {
      const r = await fetch("/api/chat/pausa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(j?.error ?? `não consegui avisar (erro ${r.status})`); return; }
      setAviso("Aviso de pausa enviado.");
      carregarThread(sel, true);
    } catch (e: any) { setAviso(String(e?.message ?? e)); }
    finally { setPausando(false); }
  }

  // A ficha de cadastro do painel do contato (0109). Vive aqui, e nao dentro do
  // PainelContato, porque precisa do `sel` e do compositor: o botao "pedir os
  // dados" escreve na CAIXA DE MENSAGEM, e quem envia e a pessoa.
  const fichaDe = useCallback((temErp: boolean) => {
    if (!sel) return null;
    // card sintetico do ERP nao e contato: nao ha conversa nem ficha
    if (/^(winthor|venda):/.test(sel.cliente_id)) return null;
    return (
      <FichaCadastro
        clienteId={sel.cliente_id}
        temErp={temErp}
        pedirDados={(t) => {
          setModoNota(false);
          setTexto(t);
          setTimeout(() => textoRef.current?.focus(), 10);
          setAviso("Revise o texto e envie — nada foi enviado ainda.");
        }}
        avisar={(m) => setAviso(m)}
      />
    );
  }, [sel]);

  function abrir(c: Conversa) {
    setSel(c); setMsgs(null); setNotas([]); setTransferencias([]); setAviso(null);
    setResolvendo(false); setContato(null); setTransferindo(false);
    setModoNota(false); setPicker(false); setNovaAberta(false);
    // o compositor guarda o nome da cliente ANTERIOR nos campos: deixá-lo aberto
    // ao trocar de conversa mandaria o texto de uma para outra
    setMenuTemplate(false); setCompondo(null);
    setMenuAcoes(false);
    // D1 abre no Resumo (números do ERP); no desenho original, em Perfil.
    // `abaPadrao` é lida do layout vigente — ver PainelContato.
    setAbaContato(abaPadrao);
    carregarThread(c);
    // painel do contato (WinThor) — falha aqui não atrapalha a conversa
    carregarContatoDe(c.cliente_id);
    // marca como lida (otimista na lista; o servidor guarda a marca por usuário)
    if (c.nao_lida) {
      setConversas((cs) => cs.map((x) => (x.cliente_id === c.cliente_id ? { ...x, nao_lida: false } : x)));
    }
    fetch("/api/chat/lida", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cliente_id: c.cliente_id }),
    }).catch(() => { /* silencioso: a marca é conveniência, não bloqueia o uso */ });
  }
  // ponte para o efeito do deep link, que roda acima desta declaração
  abrirRef.current = abrir;

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

  /**
   * Devolve a conversa para a fila de espera (0112) — o desfazer do ✋ Pegar.
   *
   * Pegar da fila é um clique, e até aqui **não havia saída**: quem pegava a
   * conversa errada dependia de um admin. É o erro mais provável do desenho,
   * porque a fila é de todos e o botão é grande.
   */
  async function devolverParaFila() {
    if (!sel || puxando) return;
    if (!confirm("Devolver esta conversa para a fila? Ela volta a ficar disponível para qualquer pessoa.")) return;
    setPuxando(true); setAviso(null);
    try {
      const r = await fetch("/api/chat/transferir", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, devolver: true, observacao: "devolveu para a fila" }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setAviso(j?.error ?? `erro ${r.status}`); return; }
      setSel({ ...sel, na_fila: true, vendedor: null });
      setAviso(j?.aviso ?? "Devolvida.");
      await carregarLista();
    } catch (e: any) {
      setAviso(`Não consegui devolver: ${e?.message ?? e}`);
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

  // ---- a gravação pronta, esperando decisão ------------------------------
  // Parar de gravar ENVIAVA na hora. Mensagem de voz é o único conteúdo que o
  // vendedor manda sem nunca ter visto — e não tem desfazer: a Cloud API não
  // apaga mensagem enviada (§49), então a cliente ouve o cachorro latindo, a
  // frase cortada ou o silêncio de dez segundos, e o único conserto é gravar
  // outro por cima pedindo desculpa. A decisão passa a acontecer ANTES do envio.
  const [previa, setPrevia] = useState<{ url: string; file: File; seg: number } | null>(null);
  const [tocando, setTocando] = useState(false);
  const [posicao, setPosicao] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function soltarPrevia() {
    audioRef.current?.pause();
    setPrevia(null); setTocando(false); setPosicao(0);
  }

  // A URL do blob vive na memória do navegador até alguém revogá-la à mão.
  // Amarrada ao ciclo do estado, ela se solta sozinha nos três casos — gravar
  // outra por cima, descartar, e sair da tela — em vez de depender de cada
  // caminho lembrar de limpar.
  useEffect(() => {
    const u = previa?.url;
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [previa?.url]);

  // Prévia é de UMA conversa: trocar de cliente com áudio pendente e clicar em
  // Enviar mandaria a gravação para a pessoa errada.
  useEffect(() => { soltarPrevia(); }, [sel?.cliente_id]);

  async function alternarGravacao() {
    if (gravando) { recRef.current?.stop(); return; }
    if (previa || !sel) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = FORMATOS_AUDIO.find((f) => (window as any).MediaRecorder?.isTypeSupported?.(f)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      pedacosRef.current = [];
      // O relógio, e não o cronômetro da tela: este closure é montado no
      // início da gravação e leria `segundos` congelado em zero.
      // Serve de PISO para a barra da prévia: o `<audio>` costuma informar a
      // duração certa (medido no Chrome: 3,9 s para 4 s de gravação) e ela
      // assume assim que carrega — mas o WebM do MediaRecorder sai sem duração
      // no cabeçalho, e nem todo navegador a reconstrói.
      const t0 = Date.now();
      rec.ondataavailable = (e) => { if (e.data.size) pedacosRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        const tipo = rec.mimeType || mime || "audio/ogg";
        const blob = new Blob(pedacosRef.current, { type: tipo });
        if (blob.size < 1200) { setAviso("Áudio muito curto — segure mais tempo."); return; }
        const ext = tipo.includes("ogg") ? "ogg" : tipo.includes("mp4") ? "m4a" : tipo.includes("aac") ? "aac" : "webm";
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: tipo.split(";")[0] });
        setPrevia({ url: URL.createObjectURL(blob), file, seg: Math.max(1, Math.round((Date.now() - t0) / 1000)) });
      };
      recRef.current = rec;
      rec.start();
      setGravando(true); setSegundos(0); setAviso(null);
    } catch {
      setAviso("Não consegui acessar o microfone — verifique a permissão do navegador.");
    }
  }

  function ouvirPrevia() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setAviso("Não consegui tocar a gravação neste navegador."));
    else a.pause();
  }

  async function enviarPrevia() {
    const p = previa;
    if (!p || enviandoArquivo) return;
    soltarPrevia();               // revogar a URL não invalida o File: o envio usa o File
    await enviarArquivo(p.file);
  }

  // cronômetro da gravação
  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [gravando]);

  // ---- ?acao= — o card do board pedindo uma ação ---------------------------
  // Os ícones 📞 🎤 📎 do card abrem esta tela embutida já executando o gesto.
  // É assim que o card os oferece SEM reimplementar WebRTC, gravador e upload:
  // quem executa é o dono deles, aqui. Duplicá-los no board recriaria, em três
  // cópias, a dívida que a §41 pagou ao apagar o conversa.tsx.
  //
  // Dispara UMA vez, quando a conversa já está aberta — antes disso `sel` é
  // nulo e as três funções não teriam em quem agir.
  const acaoFeita = useRef(false);
  useEffect(() => {
    if (acaoFeita.current || !sel) return;
    let acao: string | null = null;
    try { acao = new URLSearchParams(window.location.search).get("acao"); } catch {}
    if (!acao) return;
    acaoFeita.current = true;
    // pequeno atraso: a thread ainda está pintando, e abrir o seletor de arquivo
    // ou o microfone no meio disso deixa a tela piscando atrás do diálogo
    const t = setTimeout(() => {
      if (acao === "ligar") lig.ligar(sel.cliente_id, sel.cliente);
      else if (acao === "audio") void alternarGravacao();
      else if (acao === "anexo") arquivoRef.current?.click();
    }, 350);
    return () => clearTimeout(t);
  }, [sel]);

  function cancelarGravacao() {
    const rec = recRef.current;
    if (!rec) return;
    rec.onstop = () => { rec.stream.getTracks().forEach((t) => t.stop()); setGravando(false); };
    rec.stop();
    pedacosRef.current = [];
  }

  /**
   * Sobe UM arquivo direto do navegador para o Supabase Storage, com o token de
   * escrita que `enviar-midia/assinar` acabou de emitir.
   *
   * ⚠️ Não passa pelo nosso servidor DE PROPÓSITO: a Vercel corta o corpo de
   * qualquer requisição em 4,5 MB (`413 FUNCTION_PAYLOAD_TOO_LARGE`), antes da
   * função rodar — medido na produção em 29/08/2026. Era isso que fazia PDF
   * pequeno passar e PDF grande falhar.
   *
   * XHR e não `fetch` porque só ele dá `upload.onprogress`: num arquivo de
   * dezenas de MB, uma tela parada é indistinguível de uma tela travada.
   */
  function subirParaStorage(
    file: File, path: string, token: string, aoAndar: (pct: number) => void,
  ): Promise<void> {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) return Promise.reject(new Error("Storage não configurado (NEXT_PUBLIC_SUPABASE_URL)"));
    const url = `${base}/storage/v1/object/upload/sign/wa-midia/${path}?token=${encodeURIComponent(token)}`;
    return new Promise((ok, erro) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url, true);
      x.setRequestHeader("content-type", file.type || "application/octet-stream");
      x.setRequestHeader("x-upsert", "true");
      x.upload.onprogress = (e) => {
        if (e.lengthComputable) aoAndar(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      };
      x.onload = () => (x.status >= 200 && x.status < 300
        ? ok()
        : erro(new Error(`falha ao subir o arquivo (${x.status})`)));
      x.onerror = () => erro(new Error("conexão caiu durante o envio do arquivo"));
      x.onabort = () => erro(new Error("envio do arquivo cancelado"));
      x.send(file);
    });
  }

  // envio de arquivo (foto, áudio, documento) pelo canal WhatsApp direto.
  //
  // Três passos por arquivo: (1) `assinar` confere sessão, canal e tamanho e
  // devolve um endereço no Storage — todas as recusas caras acontecem aqui,
  // ANTES de um byte subir; (2) o navegador sobe o arquivo direto no Storage;
  // (3) `enviar-midia` recebe só o caminho, baixa e repassa para a Meta.
  //
  // Vários de uma vez: a Cloud API manda UMA mídia por requisição, então a fila é
  // nossa. SEQUENCIAL de propósito — em paralelo os arquivos chegariam fora de
  // ordem no celular da cliente, que é justamente o que se espera preservado ao
  // mandar cinco fotos do mesmo produto. Também mantém o consumo de cota previsível.
  async function enviarArquivos(files: File[]) {
    if (!sel || enviandoArquivo || !files.length) return;
    const LIMITE_FILA = 30;
    if (files.length > LIMITE_FILA) {
      setAviso(`Máximo de ${LIMITE_FILA} arquivos por vez — selecione menos.`);
      if (arquivoRef.current) arquivoRef.current.value = "";
      return;
    }
    // guarda a conversa do começo: o lote demora, e trocar de conversa no meio
    // não pode fazer o resto das fotos irem para outra pessoa.
    const alvo = sel;
    // a legenda digitada acompanha só o PRIMEIRO arquivo — repetir o mesmo texto
    // em cada foto faria a cliente ler cinco vezes a mesma coisa.
    const legenda = texto.trim();
    setEnviandoArquivo(true); setAviso(null);
    setFila({ feito: 0, total: files.length, pct: null });
    const falhas: string[] = [];
    let enviados = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setFila({ feito: i, total: files.length, pct: null });
        try {
          // corte de tamanho aqui também, com a MESMA função da rota: recusar
          // um arquivo grande demais não precisa de ida ao servidor, e o
          // recado sai idêntico porque sai do mesmo lugar.
          if (file.size > limiteDe(file.type || "application/octet-stream")) {
            falhas.push(`${file.name}: ${recadoDeLimite(file.type || "application/octet-stream", file.size)}`);
            setFila({ feito: i + 1, total: files.length, pct: null });
            continue;
          }

          const ass = await fetch("/api/chat/enviar-midia/assinar", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              cliente_id: alvo.cliente_id,
              nome: file.name, mime: file.type || "application/octet-stream", tamanho: file.size,
            }),
          });
          const a = await ass.json().catch(() => null);
          if (!ass.ok) {
            // conversa ainda no RD (501) vale para a conversa inteira, não para
            // este arquivo: insistir nos seguintes só repetiria o mesmo erro.
            // Tamanho (413), por outro lado, é problema DESTE arquivo — o
            // próximo pode caber.
            if (ass.status === 501) {
              const restam = files.length - i;
              setAviso((a?.error ?? `erro ${ass.status}`) + (restam > 1 ? ` (${restam} arquivos não enviados)` : ""));
              break;
            }
            falhas.push(`${file.name}: ${a?.error ?? `erro ${ass.status}`}`);
            setFila({ feito: i + 1, total: files.length, pct: null });
            continue;
          }

          // barra de progresso só a partir de 2 MB: abaixo disso o número pisca
          // e some antes de alguém conseguir ler.
          const mostraPct = file.size > 2 * 1024 * 1024;
          await subirParaStorage(file, a.path, a.token, (pct) => {
            if (mostraPct) setFila({ feito: i, total: files.length, pct });
          });
          setFila({ feito: i, total: files.length, pct: mostraPct ? 100 : null });

          const r = await fetch("/api/chat/enviar-midia", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              cliente_id: alvo.cliente_id, path: a.path,
              mime: a.mime, nome: a.nome,
              ...(i === 0 && legenda ? { legenda } : null),
            }),
          });
          const j = await r.json().catch(() => null);
          if (!r.ok) {
            // janela fechada (422) e conversa ainda no RD (501) valem para a
            // conversa inteira, não para este arquivo: insistir nos seguintes só
            // repetiria o mesmo erro e gastaria cota à toa.
            if (j?.foraDaJanela || r.status === 501) {
              const restam = files.length - i;
              setAviso((j?.foraDaJanela
                ? "Fora da janela de 24h — envie um TEMPLATE para reabrir a conversa."
                : (j?.error ?? `erro ${r.status}`)) + (restam > 1 ? ` (${restam} arquivos não enviados)` : ""));
              break;
            }
            // 504 é a Vercel matando a função no meio do repasse: o arquivo
            // subiu, mas não deu tempo de chegar na Meta. Sem tradução isso vira
            // "erro 504", que não diz a ninguém o que fazer.
            falhas.push(`${file.name}: ${j?.error ?? (r.status === 504
              ? "o arquivo é grande demais para o tempo de envio — tente um menor"
              : `erro ${r.status}`)}`);
          } else {
            enviados++;
            if (i === 0 && legenda) setTexto("");
          }
        } catch (e: any) {
          falhas.push(`${file.name}: ${e?.message ?? e}`);
        }
        setFila({ feito: i + 1, total: files.length, pct: null });
      }
      // falha de um arquivo não cala os outros: o aviso diz quantos ficaram para
      // trás. Com um arquivo só (inclusive o áudio gravado) vale o erro cru — o
      // nome do arquivo na frente seria ruído.
      if (falhas.length) {
        setAviso((atual) => atual ?? (files.length === 1
          ? falhas[0].replace(/^[^:]*: /, "")
          : `Não enviei ${falhas.length} de ${files.length}: ${falhas.slice(0, 3).join(" · ")}` +
            (falhas.length > 3 ? " …" : "")));
      }
    } finally {
      setEnviandoArquivo(false);
      setFila(null);
      if (arquivoRef.current) arquivoRef.current.value = "";
      if (enviados) { carregarThread(alvo, true); carregarLista(); }
    }
  }

  // um arquivo só (a gravação de áudio) — mesma fila, com um item
  function enviarArquivo(file: File) { return enviarArquivos([file]); }

  /**
   * Quantos campos este template pede. Com o texto (cadastro nosso, 0090) a
   * conta sai dele; nos do RD o texto mora no painel deles e o envio sempre
   * mandou UMA variável — então é uma, com o rótulo dizendo que não dá para
   * mostrar o texto daqui.
   */
  function camposDe(t: TemplateEscolha): number[] {
    return t.corpo ? variaveisDe(t.corpo) : [1];
  }

  // Escolher um template não envia mais: abre o compositor, com um campo por
  // {{n}}. O primeiro chega com o nome da cliente já dentro — era o valor fixo
  // de antes, agora é só o ponto de partida. Template SEM campo não tem o que
  // compor: segue indo direto, num clique, como sempre foi.
  function escolherTemplate(t: TemplateEscolha) {
    const campos = camposDe(t);
    if (!campos.length) { void enviarTemplate(t); return; }
    const primeiroNome = String(sel?.cliente ?? "").trim().split(/\s+/)[0] || "";
    setCompondo({ t, valores: campos.map((_, i) => (i === 0 ? primeiroNome : "")) });
  }

  function fecharTemplate() { setMenuTemplate(false); setCompondo(null); }

  // template de recontato — reabre conversa fora da janela sem sair do chat
  async function enviarTemplate(t?: TemplateEscolha, valores?: string[]) {
    if (!sel || enviando) return;
    fecharTemplate();
    setEnviando(true); setAviso(null);
    try {
      // o id que o servidor entende difere por canal: na Cloud é o nome
      // aprovado na Meta; no RD é o id do painel deles
      const escolha = t ? (t.canal === "cloud" ? t.meta_nome : t.rd_template_id) : null;
      const r = await fetch("/api/send-template", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: sel.cliente_id,
          ...(escolha ? { template_id: escolha } : {}),
          // o servidor revalida tudo isto: a tela avisa cedo, mas não é ela
          // quem autoriza o envio
          ...(valores?.length ? { variaveis: valores } : {}),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) setAviso(j?.error ?? `erro ${r.status}`);
      else { carregarThread(sel, true); carregarLista(); }
    } finally { setEnviando(false); }
  }

  // ---- notas internas ------------------------------------------------------
  // Não passam pelo WhatsApp: gravam em chat_nota e aparecem só aqui. É o recado
  // que antes ia parar no caderno do vendedor ou num grupo paralelo.
  // Localizacao: um endereco SALVO, escolhido no menu do clipe. A posicao do
  // navegador nao entra aqui de proposito -- ver o comentario da rota.
  async function encaminhar(msg: any, paraId: string, paraNome: string) {
    setEnviando(true); setAviso(null);
    try {
      const r = await fetch("/api/chat/encaminhar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensagem_id: msg.id, para: paraId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setAviso(j?.error ?? `erro ${r.status}`);
      else { setAviso(`Encaminhada para ${paraNome}.`); setEncaminhando(null); setBuscaEnc(""); }
    } finally { setEnviando(false); }
  }

  /**
   * Pede a localização ATUAL da cliente (0115).
   *
   * É o que dá para chamar de "tempo real" nesta plataforma: a live location do
   * WhatsApp, aquela que fica atualizando sozinha, NÃO é entregue pela Cloud
   * API. Aqui vai um botão; ela toca, escolhe compartilhar, e a posição do
   * momento volta como uma mensagem de localização comum.
   *
   * Por isso o texto do menu diz "posição do momento": prometer acompanhamento
   * contínuo seria vender o que a API não faz.
   */
  async function pedirLocal() {
    if (!sel) return;
    try {
      const r = await fetch("/api/chat/localizacao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, pedir: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(j?.error ?? "não consegui pedir a localização"); return; }
      void carregarThread(sel, false);   // sem rolar: o pedido entra no fim, e o vendedor ja esta la
    } catch {
      setAviso("não consegui pedir a localização");
    }
  }

  async function enviarLocal(idx: number, nome: string) {
    if (!sel || enviando) return;
    setEnviando(true); setAviso(null);
    try {
      const r = await fetch("/api/chat/localizacao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, local: idx }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setAviso(j?.error ?? `erro ${r.status}`);
      else { setAviso(null); carregarThread(sel, true); }
    } finally { setEnviando(false); }
  }

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
  // Contato sem linha (nunca conversou) NÃO é do RD, e some ao filtrar por
  // qualquer número — que é o certo: ele não corre por nenhum. Antes o `?? "rd"`
  // o jogava no balde do RD e ele aparecia ao filtrar por lá.
  const daLinha = (c: Conversa) => !linhaSel || c.linha_id === linhaSel;
  const doVendedor = (c: Conversa) => !vendFiltro || c.na_fila || c.vendedor === vendFiltro;

  // bases cruzadas: cada seletor conta DENTRO do que o outro já escolheu, senão
  // o chip promete 12 e a lista mostra 3
  // contatos recém-criados que o servidor ainda não devolve (sem mensagem).
  // Somem sozinhos assim que a conversa existir de verdade.
  const pendentesNovos = novosLocais.filter((n) => !conversas.some((c) => c.cliente_id === n.cliente_id));
  const baseVend = [...pendentesNovos, ...conversas].filter(doVendedor);
  const baseLinha = conversas.filter(daLinha);
  const noEscopo = conversas.filter((c) => daLinha(c) && doVendedor(c));

  const contaPorLinha = new Map<string, number>();
  // `?? "rd"` aqui era o mesmo erro do servidor: contato sem conversa nenhuma
  // não corre por linha alguma, e somá-lo ao RD inflava um número que a lista
  // não mostrava.
  for (const c of baseVend) if (c.linha_id) contaPorLinha.set(c.linha_id, (contaPorLinha.get(c.linha_id) ?? 0) + 1);

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

  // A agenda é chaveada por `codcli` e a lista de conversas por `cliente_id`:
  // são listas separadas que o dropdown alterna, então não há merge e não há
  // como nascer linha duplicada. A busca da sidebar filtra as duas.
  const carteiraVisivel = (carteira ?? [])
    .filter((k) => !vendFiltro || k.vendedor === vendFiltro)
    .filter((k) => {
      const t = busca.trim().toLowerCase();
      if (!t) return true;
      // ⚠️ Os dígitos do termo SÓ entram na conta se existirem. `"".includes("")`
      // é `true` em JS, então um termo sem número nenhum ("samara soares brito")
      // fazia a cláusula do telefone casar com TODAS as linhas — e a busca
      // devolvia a carteira inteira, parecendo que não filtrava nada. A lista de
      // conversas escapava disso por um `|| " "` no fim, que funciona por
      // acidente; aqui a guarda é explícita, para não depender de sorte.
      const digitos = t.replace(/\D/g, "");
      return (k.cliente ?? "").toLowerCase().includes(t)
        || (!!digitos && (k.telefone ?? "").includes(digitos))
        || (!!digitos && String(k.codcli).includes(digitos));
    });

  // ---- DESENHO EM VIGOR (0095) ---------------------------------------------
  // `d1` guarda tudo que a Direção 1 acrescenta. A tese dela é "nada muda de
  // lugar, coisas passam a aparecer" — então não existe uma segunda árvore de
  // JSX: são adições pontuais nos quatro pontos que o laudo mediu como caros,
  // mais a paleta. Manter uma tela só é o que torna o rollback confiável.
  //
  // A Direção 4 ("bancada") HERDA a 1 em vez de repeti-la: `d1` deixou de ser
  // um teste de igualdade e virou "este desenho tem as correções da D1". Sem
  // isso, escolher a 4 apagaria a faixa da janela de 24h, a aba Resumo e o
  // mobile resolvido — que são justamente as correções que ela pressupõe.
  // `bc` guarda só o que é dela: a grade.
  const d1 = CORRIGE.has(layout);
  const bc = layout === "bancada";
  Object.assign(M, PALETAS[layout] ?? PALETAS.original);
  // `GRADES.original` primeiro, sempre: as entradas são PARCIAIS, então sem a
  // base o desenho novo herdaria as sobras do anterior no mesmo carregamento.
  Object.assign(G, GRADES.original, GRADES[layout] ?? {});

  // Abas do painel do contato que este usuário enxerga agora: "Resumo" só no
  // desenho D1 (0095), "Ciclo" só com o motor ligado (crm_config, 0097). Uma
  // lista só, usada pelo desktop e pela folha do celular — se cada um filtrasse
  // por conta, uma aba sumiria de um lado e ficaria no outro.
  const abasContato = ABAS.filter((a) => (!a.soD1 || d1) && (a.k !== "ciclo" || cicloAtivo));
  // Estar na aba Ciclo quando um admin desliga o motor deixaria o painel em
  // branco, sem nada explicando. Resolvido no render, não num efeito: efeito
  // aqui dependeria de nenhum `return` aparecer antes desta linha, que é
  // exatamente o acoplamento que o comentário do `abaPadrao` já evita.
  const abaAtual: AbaContato = abasContato.some((a) => a.k === abaContato) ? abaContato : abaPadrao;

  // ---- D1 · a janela de 24h vira estado permanente, não aviso de erro ------
  // Hoje ela só se manifesta DEPOIS que o envio falha (§29.2 item 2): escreve-se
  // a mensagem inteira para descobrir que precisava de template, que custa
  // R$ 0,43. O dado para antecipar já está aqui — é a última mensagem RECEBIDA,
  // que veio junto da thread. Nenhuma chamada nova.
  //
  // Conta a partir da mensagem do cliente, não da nossa: é isso que a regra do
  // WhatsApp define, e responder não reabre nada. Eventos de sistema ficam de
  // fora pela mesma razão que ficam fora da régua de etapa do funil (§11.1).
  //
  // Sem tick próprio: o valor recalcula a cada re-render, e o chat já tem o
  // poll de 60s (§15.4). Em horas, um minuto de atraso não muda decisão.
  // ⚠️ A JANELA É POR NÚMERO (0102). Um cliente que respondeu há 10 minutos NO
  // RD não tem janela aberta na Cloud. Contar sobre a conversa inteira faria a
  // faixa dizer "aberta, fecha em 23h" e o envio falhar com 131047 — com o
  // texto já escrito, que é justamente o que a faixa existe para evitar.
  const doCanalDeEnvio = (m: Msg) =>
    canalEnvio === null ? true : canalEnvio === "rd" ? !m.linha_id : !!m.linha_id;
  const ultimaRecebida = (msgs ?? [])
    .filter((m) => m.enviada_por === "customer" && m.tipo !== "evento_sistema" && doCanalDeEnvio(m))
    .slice(-1)[0];
  const msRestantes = ultimaRecebida
    ? 24 * 3600 * 1000 - (Date.now() - new Date(ultimaRecebida.criada_em).getTime())
    : null;
  const janelaAberta = msRestantes != null && msRestantes > 0;
  const janelaRotulo = !janelaAberta
    ? ""
    : msRestantes! > 2 * 3600 * 1000
      ? `${Math.floor(msRestantes! / 3600000)}h`
      : `${Math.max(1, Math.floor(msRestantes! / 60000))} min`;

  // ---- D1 · freio na transferência (0095) ----------------------------------
  // Hoje os botões de vendedor vêm ANTES do campo de motivo, e clicar num nome
  // envia na hora: quem digitou a justificativa e só então escolheu a pessoa
  // perde o texto sem aviso (§29.2 item 7). Em D1 o campo sobe para antes dos
  // nomes, então escolher a pessoa é o último gesto — o que já era verdade no
  // servidor passa a ser verdade na tela.
  // O campo é uma constante e não dois blocos duplicados: duas cópias divergem
  // na primeira vez que alguém mexer só numa delas.
  const campoMotivoTransf = (
    <input
      value={obsTransf}
      onChange={(e) => setObsTransf(e.target.value)}
      placeholder={d1
        ? "Por que está passando? (opcional) — fica registrado na conversa"
        : "Motivo da passagem (opcional) — fica registrado na conversa"}
      style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12, fontFamily: "inherit", color: M.ink, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 8, outline: "none", marginBottom: d1 ? 8 : 0 }}
    />
  );

  // Dentro da lupa a largura util e ~500px: as acoes precisam caber numa linha
  // so, senao a conversa — que e o motivo da janela existir — fica espremida.
  // Viram icone; o `title` que cada botao ja tinha vira a legenda no hover.
  const compacto = embutido;
  // `bancada` troca o emoji por traço monocromático (item 18 do laudo): sete
  // emoji lado a lado são sete pesos e sete cores decididos pela fonte do
  // sistema, não por nós. Os outros desenhos seguem com o emoji — trocar o
  // ícone de quem não pediu quebraria o rollback exato.
  const rot = (icone: string, texto: string, n?: NomeIcone, limpo?: string) => {
    if (!bc || !n) return compacto ? icone : texto;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: compacto ? 0 : 6 }}>
        <Icone n={n} />{!compacto && (limpo ?? texto)}
      </span>
    );
  };
  // -20% no compacto: sao 4 pilulas de icone competindo com o nome na MESMA
  // linha desde a mudanca anterior; cada pixel a menos aqui e um pixel a mais
  // para o nome antes das reticencias.
  const padBotao = compacto ? "4px 7px" : "5px 11px";
  const fonteBotao = compacto ? 9.5 : 11.5;
  // Os nove botões de dentro da pílula repetiam o mesmo par de literais. Aqui
  // eles passam a sair da grade — uma altura por contexto, e nada fora dela:
  // 42/30 no desenho de hoje, 32/28 em `bancada`. No celular o piso de toque é
  // 44 px, que é a régua de acessibilidade e não uma preferência.
  const pilBtn = isMobile && !compacto ? 44 : compacto ? G.pilBtnC : G.pilBtn;
  const raioPilBtn = compacto ? G.raioPilC : G.raioPil;
  // SVG dentro de <button> nao se centraliza sozinho como texto se centraliza.
  // So em `bancada`, onde o filho e um <svg>: nos outros o filho e emoji e o
  // alinhamento de hoje ja esta certo.
  const CENTRO = { display: "flex", alignItems: "center", justifyContent: "center" } as const;
  const envAlt = isMobile && !compacto ? 52 : compacto ? G.envAltC : G.envAlt;
  const envLarg = isMobile && !compacto ? 52 : compacto ? G.envLargC : G.envLarg;

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
    // D1 usa 100dvh: no celular, `100vh` conta a barra do navegador como se ela
    // não existisse, e o compositor fica embaixo dela — o laudo mediu ~10px
    // sobrando para a caixa de texto num aparelho de 390px (§29.2 item 6).
    // `paddingBottom` com safe-area tira o compositor de cima da barra de
    // gestos do iPhone.
    <div className="chat-raiz" style={{ height: d1 ? "100dvh" : "100vh", display: "flex", flexDirection: "column", background: M.bg, color: M.ink, fontFamily: "Inter, system-ui, sans-serif",
      ...(d1 && isMobile ? { paddingBottom: "env(safe-area-inset-bottom)" } : null) }}>
      {/* Movimento: vale para TODOS os desenhos. Quem liga "reduzir movimento"
          no sistema costuma fazê-lo por enxaqueca ou vertigem — não é
          preferência estética, e não deve depender de qual tema está ativo. */}
      <style dangerouslySetInnerHTML={{ __html:
        "@media(prefers-reduced-motion:reduce){.chat-raiz *,.chat-raiz *::before,.chat-raiz *::after"
        + "{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}" }} />
      {bc && (
        <style dangerouslySetInnerHTML={{ __html:
          // Barra de rolagem fina nas três colunas. A larga do Windows come 15 px
          // da lista — e é justamente a lista que já cedeu largura para a coluna
          // das horas.
          ".bc-rolagem{scrollbar-width:thin;scrollbar-color:#c9c4d0 transparent}"
          + ".bc-rolagem::-webkit-scrollbar{width:8px;height:8px}"
          + ".bc-rolagem::-webkit-scrollbar-thumb{background:#c9c4d0;border-radius:8px}"
          + ".bc-rolagem::-webkit-scrollbar-track{background:transparent}"
          // Foco visível de verdade. O azul de FOCO é o #2f7fd4, que passa os 3:1
          // exigidos de elemento não-textual — e não serve como fundo de botão
          // (4,11:1 com texto branco), que é onde o #1a5fa8 entra.
          + ".chat-raiz :focus-visible{outline:2px solid #2f7fd4;outline-offset:2px;border-radius:4px}" }} />
      )}
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
      {embutido ? null : <div style={{ height: 3, background: `linear-gradient(90deg, ${M.laranja}, ${M.wine}, ${M.roxo})` }} />}
      {/* ---- barra de navegação do produto (posição do menu do RD Conversas) ----
          Logo à esquerda, abas horizontais do CRM no meio, identidade à direita.
          O Chat vira uma aba do produto, com a aba ativa sublinhada. */}
      {embutido ? null : (
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", minHeight: 52, background: M.surface, borderBottom: `1px solid ${M.border}`, flexShrink: 0 }}>
        <Logo size={26} />
        <b style={{ fontSize: 16, letterSpacing: 0.2, color: M.wine }}>{modoApp ? "Chat" : "CRM"}</b>
        {/* ---- No app instalado a navegação do CRM inteiro desaparece ----
            O pedido foi "só o chat, fechado": um app de atendimento que oferece
            Relatórios, Tickets e Administração não é um app de atendimento, é o
            CRM dentro de uma moldura. O menu continua existindo no navegador,
            onde o CRM é o produto inteiro — é a mesma tela servindo dois
            contextos, e só o contexto muda. */}
        {modoApp ? null : !isMobile ? (
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
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* ---- sidebar: lista de conversas ---- */}
        {mostraLista && (
          <div style={{ width: isMobile ? "100%" : G.lista, flexShrink: 0, display: "flex", flexDirection: "column", background: M.surface, borderRight: `1px solid ${M.border}` }}>
            {/* ---- cabeçalho da lista, no arranjo do RD ----
                1) título-dropdown com as filas e seus contadores
                2) campo de busca (lupa à direita)
                3) ordenação alinhada à direita ("Mais recente") */}
            <div style={{ padding: G.cabPad, borderBottom: `1px solid ${M.border}`, display: "flex", flexDirection: "column", gap: bc ? 8 : 7 }}>
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setMenuFila((v) => !v)} title="Trocar de fila"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "2px 0", minWidth: 0 }}>
                  <b style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {FILAS.find((f) => f.k === filtro)?.rotulo}
                  </b>
                  <span style={{ fontSize: 11, color: M.gray, opacity: 0.8 }}>▾</span>
                </button>
                {/* atalho da fila de espera, como o ícone com contador do RD */}
                {/* ---- notificação com o app fechado (0096) ----
                    Fica aqui, no alto da lista, porque é onde se olha ao
                    começar o dia — e porque o navegador só aceita pedir a
                    permissão dentro de um clique, então precisa ser um botão
                    de verdade, não um pedido automático ao abrir a tela (que
                    o Chrome recusa e queima a chance de perguntar). */}
                {push === false && (
                  <button onClick={alternarPush} disabled={pushOcupado}
                    title="Receber aviso de mensagem nova mesmo com o app fechado"
                    style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 11, fontWeight: 800, color: "#fff", background: M.roxo, border: "none",
                      borderRadius: 999, padding: "4px 10px", cursor: pushOcupado ? "default" : "pointer",
                      opacity: pushOcupado ? 0.6 : 1, fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    🔔 {pushOcupado ? "…" : "Ativar avisos"}
                  </button>
                )}
                {push === true && (
                  <button onClick={alternarPush} disabled={pushOcupado}
                    title="Avisos ligados neste aparelho — clique para desligar"
                    style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: M.gray,
                      background: "transparent", border: "none", padding: "4px 6px",
                      cursor: pushOcupado ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    🔔 <span style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>avisos ligados</span>
                  </button>
                )}
                <button onClick={() => setFiltro("fila")} title="Fila de espera — conversas sem dono"
                  style={{ marginLeft: push === null ? "auto" : 4, position: "relative", background: "transparent", border: "none", cursor: "pointer", fontSize: 17, lineHeight: 1, padding: "2px 4px", fontFamily: "inherit", opacity: filtro === "fila" ? 1 : 0.75 }}>
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

              {/* ---- D1 · triagem sem clique (0095) ----
                  Os contadores das quatro filas saem de DENTRO do dropdown e
                  viram uma faixa fixa. O laudo mediu isto como o achado de
                  maior retorno: a primeira pergunta do dia — quem está me
                  esperando? — custava 2 cliques, pagos dezenas de vezes por dia
                  por 7 pessoas. O dropdown continua existindo e no mesmo lugar;
                  a faixa é um atalho para ele, não um substituto.
                  Zero é desenhado apagado, não escondido: fila que some faz o
                  olho procurar onde ela foi. */}
              {d1 && (
                <div style={{ display: "flex", gap: 5 }}>
                  {([
                    { k: "pendentes" as Fila, r: "Esperando", n: contaPendentes, cor: M.laranja },
                    { k: "todas" as Fila, r: "Meus", n: noEscopo.filter((c) => (c.status ?? "aberta") !== "resolvida" && !c.na_fila).length, cor: M.azul },
                    { k: "fila" as Fila, r: "Sem dono", n: contaFila, cor: M.azul },
                    { k: "resolvidas" as Fila, r: "Encerradas", n: contaResolvidas, cor: M.gray },
                  ]).map((f) => {
                    const on = filtro === f.k;
                    const vazia = f.n === 0;
                    return (
                      <button key={f.k} onClick={() => setFiltro(f.k)}
                        title={FILAS.find((x) => x.k === f.k)?.dica}
                        style={{
                          flex: 1, minWidth: 0, padding: "5px 4px 6px", cursor: "pointer", fontFamily: "inherit",
                          borderRadius: 9, textAlign: "center", lineHeight: 1.15,
                          background: on ? M.surface : M.bg,
                          border: `1px solid ${on ? f.cor : M.border}`,
                          boxShadow: on ? `inset 0 -2px 0 ${f.cor}` : "none",
                        }}>
                        <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                          color: vazia ? M.muted : f.cor }}>{f.n}</div>
                        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.2, color: M.gray,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.r}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar conversa…"
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 32px 8px 12px", fontSize: 13, fontFamily: "inherit", color: M.ink, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 10, outline: "none" }}
                  />
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: M.muted, pointerEvents: "none" }}>🔍</span>
                </div>
                <button
                  onClick={() => { setNovoAberto((v) => !v); setNovoTel(""); setNovoNome(""); }}
                  title="Nova conversa — digite o número"
                  style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, cursor: "pointer",
                    background: novoAberto ? M.roxo : M.bg, color: novoAberto ? "#fff" : M.gray,
                    border: `1px solid ${novoAberto ? M.roxo : M.border}`, fontSize: 17, fontWeight: 700, lineHeight: 1 }}
                >+</button>
              </div>

              {novoAberto && (
                <div style={{ border: `1px solid ${M.border}`, borderRadius: 10, padding: 10, background: M.surface }}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: M.muted, marginBottom: 6 }}>
                    Nova conversa
                  </div>
                  <input
                    autoFocus
                    value={novoTel}
                    onChange={(e) => setNovoTel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void criarContato(); }}
                    placeholder="Telefone com DDD — (91) 98166-0019"
                    style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 13, fontFamily: "inherit", color: M.ink, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 8, outline: "none", marginBottom: 6 }}
                  />
                  <input
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void criarContato(); }}
                    placeholder="Nome (opcional)"
                    style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 13, fontFamily: "inherit", color: M.ink, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 8, outline: "none", marginBottom: 8 }}
                  />
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button onClick={() => setNovoAberto(false)}
                      style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, color: M.gray, background: "transparent", border: `1px solid ${M.border}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>
                      Cancelar
                    </button>
                    <button onClick={() => void criarContato()} disabled={novoOcupado || !novoTel.trim()}
                      style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, color: "#fff", fontFamily: "inherit",
                        background: novoOcupado || !novoTel.trim() ? M.muted : M.azul, border: "none", borderRadius: 8,
                        cursor: novoOcupado || !novoTel.trim() ? "default" : "pointer" }}>
                      {novoOcupado ? "Abrindo…" : "Abrir conversa"}
                    </button>
                  </div>
                  <div style={{ fontSize: 10.5, color: M.gray, marginTop: 7, lineHeight: 1.45 }}>
                    Se o número já estiver na base, abre a conversa existente. Fora da janela de
                    24h, o primeiro contato sai por <b>template</b>.
                  </div>
                </div>
              )}

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
              {sessao.role !== "vendedor" && vendedoresComConversa.length > 1 && (() => {
                // DROPDOWN, não mais uma fila de chips: com sete carteiras os chips
                // quebravam em duas linhas e comiam a altura da lista, que é o que
                // a sidebar tem de mais escasso. Um controle fechado diz a mesma
                // coisa em uma linha — e diz também QUAL está escolhido, que era o
                // que a fila de chips só mostrava por cor de fundo.
                //
                // Escolher um vendedor filtra TUDO que a sidebar mostra: as quatro
                // filas e seus contadores (via `noEscopo`), a busca no conteúdo e a
                // aba Minha carteira. É o mesmo alcance que o board tem.
                const atual = vendedoresComConversa.find((v) => v.slug === vendFiltro) ?? null;
                const totalGeral = baseLinha.filter((c) => !c.na_fila).length;
                return (
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setMenuVend((v) => !v)}
                      title="Ver a operação de uma carteira por vez"
                      style={{
                        display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 10px",
                        fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                        borderRadius: 9, whiteSpace: "nowrap",
                        color: vendFiltro ? "#fff" : M.gray, background: vendFiltro ? M.roxo : M.bg,
                        border: `1px solid ${vendFiltro ? M.roxo : M.border}`,
                      }}
                    >
                      <span style={{ fontSize: 12 }}>🧑‍💼</span>
                      {atual?.cor && <span style={{ width: 8, height: 8, borderRadius: 8, background: atual.cor }} />}
                      {vendFiltro ? cap(vendFiltro) : "Todos os vendedores"}
                      <span style={{ fontSize: 10.5, fontWeight: 800, opacity: 0.7 }}>
                        {atual ? atual.total : totalGeral}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 9, opacity: 0.8 }}>▾</span>
                    </button>
                    {menuVend && (
                      <>
                        <div onClick={() => setMenuVend(false)} style={{ position: "fixed", inset: 0, zIndex: 100 }} />
                        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 101,
                          background: M.surface, border: `1px solid ${M.border}`, borderRadius: 9,
                          boxShadow: "0 10px 26px rgba(28,14,27,.18)", overflow: "hidden", maxHeight: 260, overflowY: "auto" }}>
                          {[{ slug: null as string | null, cor: null as string | null, total: totalGeral },
                            ...vendedoresComConversa].map((v) => {
                            const on = vendFiltro === v.slug;
                            return (
                              <button key={v.slug ?? "todos"}
                                onClick={() => { setVendFiltro(v.slug); setMenuVend(false); }}
                                style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", textAlign: "left",
                                  padding: "8px 11px", fontSize: 12.5, fontWeight: on ? 800 : 600,
                                  color: on ? M.wine : M.ink, background: on ? M.roxoSoft : "transparent",
                                  border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                                {v.cor
                                  ? <span style={{ width: 8, height: 8, borderRadius: 8, background: v.cor, flexShrink: 0 }} />
                                  : <span style={{ width: 8, flexShrink: 0 }} />}
                                {v.slug ? cap(v.slug) : "Todos os vendedores"}
                                <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: M.muted }}>{v.total}</span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Esta faixa fala da lista de CONVERSAS: o contador e a ordem por
                  data. Na agenda ela mentia duas vezes — dizia "0 conversas" ao
                  lado de 4.696 clientes na tela (porque "carteira" não é um
                  recorte da lista de conversas) e oferecia "Mais recente" numa
                  lista que é alfabética. A contagem da agenda já vem na faixa
                  dentro da própria lista, então aqui é só sumir. */}
              <div style={{ position: "relative", display: filtro === "carteira" ? "none" : "flex", alignItems: "center" }}>
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
            <div className={bc ? "bc-rolagem" : undefined} style={{ flex: 1, overflowY: "auto" }}>
              {erro && <div style={{ padding: 14, fontSize: 12.5, color: M.laranja }}>{erro}</div>}

              {/* ---- MINHA CARTEIRA: a agenda, não uma fila de conversas ----
                  Ordem alfabética (é uma agenda, não uma caixa de entrada) e a
                  busca da sidebar filtra. Com ~900 nomes, procurar é o caminho
                  principal; rolar é o secundário. */}
              {filtro === "carteira" ? (
                carteiraCarregando && carteira === null ? (
                  <div style={{ padding: 14, fontSize: 12.5, color: M.muted }}>Carregando sua carteira…</div>
                ) : !carteiraVisivel.length ? (
                  <div style={{ padding: 14, fontSize: 12.5, color: M.muted }}>
                    {busca.trim() ? `Nenhum cliente para “${busca.trim()}”.` : "Nenhum cliente na carteira."}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: "8px 12px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: M.muted, background: M.bg }}>
                      {carteiraVisivel.length} cliente{carteiraVisivel.length === 1 ? "" : "s"}
                      {(carteira ?? []).some((k) => !k.cliente_id) && " · alguns sem contato"}
                    </div>
                    {carteiraVisivel.slice(0, carteiraLimite).map((k) => {
                      const conv = conversas.find((c) => c.cliente_id === k.cliente_id);
                      const ativa = !!k.cliente_id && sel?.cliente_id === k.cliente_id;
                      const inerte = !k.cliente_id;
                      return (
                        <button
                          key={k.codcli}
                          onClick={() => abrirDaCarteira(k)}
                          title={k.impedimento ?? undefined}
                          style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", padding: "10px 12px",
                            background: ativa ? M.roxoSoft : "transparent", border: "none",
                            borderBottom: `1px solid ${M.bg}`, cursor: inerte ? "default" : "pointer",
                            fontFamily: "inherit", opacity: inerte ? 0.55 : 1 }}
                        >
                          <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 38,
                            background: inerte ? M.muted : ativa ? M.roxo : M.wine, color: "#fff",
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800 }}>
                            {(k.cliente ?? "?").trim().charAt(0).toUpperCase()}
                          </span>
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.ink,
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {nomeComCodigo(k.cliente, k.codcli)}
                            </span>
                            <span style={{ display: "block", fontSize: 11.5, color: inerte ? M.laranja : M.gray,
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {inerte ? k.impedimento
                                : conv?.ultima_mensagem ? conv.ultima_mensagem
                                : `${k.telefone ?? ""}${k.cidade ? ` · ${k.cidade}` : ""}`}
                            </span>
                          </span>
                          {!inerte && !conv && (
                            <span style={{ flexShrink: 0, alignSelf: "center", fontSize: 9.5, fontWeight: 800,
                              color: M.gray, background: M.bg, border: `1px solid ${M.border}`,
                              borderRadius: 20, padding: "2px 7px" }}>sem conversa</span>
                          )}
                        </button>
                      );
                    })}
                    {carteiraVisivel.length > carteiraLimite && (
                      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <button
                          onClick={() => setCarteiraLimite((n) => n + 400)}
                          style={{ background: M.roxoSoft, color: M.wine, border: `1px solid ${M.border}`,
                            borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 800,
                            cursor: "pointer", fontFamily: "inherit" }}>
                          Mostrar mais {Math.min(400, carteiraVisivel.length - carteiraLimite)}
                        </button>
                        <span style={{ fontSize: 11.5, color: M.gray }}>
                          {carteiraLimite} de {carteiraVisivel.length}
                        </span>
                        <button
                          onClick={() => setCarteiraLimite(carteiraVisivel.length)}
                          style={{ background: "transparent", color: M.gray, border: "none", padding: 0,
                            fontSize: 11.5, fontWeight: 700, textDecoration: "underline",
                            cursor: "pointer", fontFamily: "inherit" }}>
                          ver todos
                        </button>
                      </div>
                    )}
                  </>
                )
              ) : (
              <>
              {!erro && !conversas.length && (bc
                ? <Estado glifo="⏳" titulo="Carregando conversas…" />
                : <div style={{ padding: 14, fontSize: 12.5, color: M.muted }}>Carregando conversas…</div>)}
              {ordenadas.map((c) => {
                const ativa = sel?.cliente_id === c.cliente_id;
                const doCliente = c.ultima_enviada_por === "customer";
                return (
                  <button
                    key={c.cliente_id}
                    onClick={() => abrir(c)}
                    style={{ display: "flex", alignItems: "center", gap: G.gapLinha, width: "100%", textAlign: "left", padding: G.linhaPad, minHeight: G.linhaAlt || undefined, background: ativa ? M.roxoSoft : "transparent", border: "none", borderBottom: `1px solid ${M.bg}`, cursor: "pointer", fontFamily: "inherit", boxSizing: "border-box" }}
                  >
                    <span style={{ width: G.avatar, height: G.avatar, flexShrink: 0, borderRadius: G.avatar, background: ativa ? M.roxo : M.wine, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: bc ? 700 : 800 }}>
                      {(c.cliente ?? "?").trim().charAt(0).toUpperCase()}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <b style={{ fontSize: 13.5, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, fontWeight: c.nao_lida ? 900 : 700 }}>{nomeComCodigo(c.cliente, c.codcli)}</b>
                        {(c.status ?? "aberta") === "resolvida" && (
                          <span title="conversa resolvida" style={{ fontSize: 10, color: "#1a6b3c", flexShrink: 0 }}>✓</span>
                        )}
                        {/* em `bancada` a hora sai daqui e vai para a coluna da
                            direita, junto do ponto de não-lida — é isso que faz
                            as horas formarem uma régua vertical em vez de
                            dançarem conforme o comprimento de cada nome */}
                        {!bc && (
                          <span style={{ fontSize: 10.5, color: c.nao_lida ? M.roxo : M.muted, fontWeight: c.nao_lida ? 800 : 400, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{rotuloTempo(c.ultima_atividade)}</span>
                        )}
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
                        {!bc && c.nao_lida && (
                          <span title="não lida" style={{ width: 9, height: 9, borderRadius: 9, background: M.roxo, flexShrink: 0 }} />
                        )}
                      </span>
                    </span>
                    {/* a coluna das horas: largura FIXA, para a régua existir.
                        Se ela medisse o conteúdo, "09:18" e "26/08" teriam
                        larguras diferentes e nada alinharia. */}
                    {bc && (
                      <span style={{ width: 38, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                        <span style={{ fontSize: 10.5, color: c.nao_lida ? M.roxo : M.muted, fontWeight: c.nao_lida ? 700 : 400, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {rotuloTempo(c.ultima_atividade)}
                        </span>
                        {c.nao_lida
                          ? <span title="não lida" style={{ width: 9, height: 9, borderRadius: 9, background: M.roxo }} />
                          : <span style={{ width: 9, height: 9 }} />}
                      </span>
                    )}
                  </button>
                );
              })}
              {busca && !ordenadas.length && !buscandoMsgs && !achadosNovos.length && (
                bc
                  ? <Estado glifo="🔍" titulo={`Nada encontrado para “${busca}”`} texto="A busca por nome e telefone é local; procurar dentro das mensagens exige três letras e roda no servidor, logo abaixo." />
                  : <div style={{ padding: 14, fontSize: 12.5, color: M.muted }}>Nada encontrado para “{busca}”.</div>
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
                        <b style={{ fontSize: 13, color: M.ink, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nomeComCodigo(c.cliente, c.codcli)}</b>
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
              </>
              )}
            </div>

            {/* ---- rodapé da lista: a posição do "Online ●" do RD. Lá é a
                 disponibilidade do operador; aqui é o estado da conexão em tempo
                 real, que é o que existe de verdade — e serve de diagnóstico
                 quando o chat parece parado (sem Realtime, sobra o poll de 60s). ---- */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: G.rodapePad, borderTop: `1px solid ${M.border}`, background: M.surface, flexShrink: 0 }}
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
              bc ? (
                <Estado alto glifo="💬" titulo="Selecione uma conversa ao lado"
                  texto="Mensagem livre só sai dentro da janela de 24h depois da última resposta da cliente; fora dela, só template." />
              ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: M.muted }}>
                <div style={{ fontSize: 44 }}>💬</div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: M.gray }}>Selecione uma conversa ao lado</div>
                <div style={{ fontSize: 12 }}>mensagens dentro da janela de 24h são enviadas na hora</div>
              </div>
              )
            )}
            {sel && (
              <>
                {/* cabeçalho da conversa */}
                {/* Em `bancada` o padding vertical zera e a altura passa a ser
                    56 px: é isso que faz este cabeçalho alinhar com o da lista,
                    do outro lado da divisória, em vez de cada um encontrar a
                    própria altura pelo conteúdo.
                    ⚠️ `minHeight`, NUNCA `height`. Com o painel do cliente 52 px
                    mais largo, a linha de metadados do nome passa a caber em
                    duas linhas em alguns contatos — medido no navegador. Altura
                    fixa espremeria justamente esses, e o alinhamento não vale o
                    preço de cortar o telefone de quem tem nome comprido.
                    No compacto ele segue medindo o que precisa: 56 comeria a
                    conversa, que é o motivo de a lupa existir. */}
                <div style={{ display: "flex", alignItems: "center", gap: compacto ? 7 : 10, padding: compacto ? "7px 10px" : G.cabConvPad, minHeight: bc && !compacto ? 56 : undefined, background: M.surface, borderBottom: `1px solid ${M.border}`, flexWrap: "nowrap" }}>
                  {isMobile && !compacto && (
                    <button onClick={() => { setSel(null); setMsgs(null); }} style={{ background: "transparent", border: "none", fontSize: 16, color: M.gray, cursor: "pointer", padding: "0 4px", fontFamily: "inherit" }}>←</button>
                  )}
                  <span style={{ width: 34, height: 34, borderRadius: 34, background: M.wine, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
                    {(sel.cliente ?? "?").trim().charAt(0).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: "block", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nomeComCodigo(sel.cliente, sel.codcli)}</b>
                    <span style={{ fontSize: 11, color: M.muted, fontVariantNumeric: "tabular-nums" }}>
                      {/* No compacto so o telefone. A carteira e o selo da linha
                          empurravam a sub-linha para uma segunda linha num quadro
                          de 500px -- e as duas ja aparecem no rodape da conversa,
                          logo abaixo ("Carteira Milene | Murano Pro"). Repetir ali
                          em cima custava exatamente a linha que o cabecalho tinha
                          acabado de ganhar. */}
                      {sel.telefone ?? "sem telefone"}{!compacto && sel.vendedor ? ` · carteira ${cap(sel.vendedor)}` : ""}
                      {/* por qual NÚMERO esta conversa corre — com mais de uma linha
                          ativa, é o que evita responder pela linha errada (a janela
                          de 24h é por par número+cliente) */}
                      {linha && !compacto && (
                        <span title={`Esta conversa corre pelo ${linha.rotulo}`} style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3,
                          color: linha.canal === "rd" ? M.gray : M.roxo,
                          background: linha.canal === "rd" ? "#eee8ed" : M.roxoSoft,
                          borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>
                          {/* O parentese explicativo ("Murano Pro (RD Conversas)")
                             quebrava o cabecalho em duas linhas num quadro de 500px --
                             a mesma linha que acabamos de ganhar juntando as acoes ao
                             nome. Fica no `title`, como ja acontece nos chips da lista. */}
                          {compacto ? linha.rotulo.replace(/\s*\([^)]*\)\s*/g, " ").trim() : linha.rotulo}
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
                  {/* No compacto as ações ficam na MESMA LINHA do nome, não numa
                      faixa própria: a faixa custava uma linha inteira do cabeçalho,
                      e altura é o que falta numa janela que existe para mostrar
                      conversa. Cabe porque elas são só ícones aqui (`rot`) e o
                      nome encolhe com reticências. Rola na horizontal se faltar
                      espaço, em vez de quebrar — quebrar devolveria a linha que
                      esta mudança acabou de ganhar. */}
                  <span style={compacto
                    ? { display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap", overflowX: "auto", flexShrink: 0, maxWidth: "62%" }
                    : { display: "contents" }}>
                  {/* fila de não atribuídos: contato sem dono, qualquer um puxa */}
                  {sel.na_fila && (
                    sessao.carteira ? (
                      <button onClick={puxarDaFila} disabled={puxando} title="Assumir este atendimento"
                        style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: "#1a6b3c", border: "none",
                          borderRadius: 999, padding: "6px 13px", cursor: puxando ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                        {puxando ? "…" : rot("✋", "✋ Pegar atendimento", "pegar", "Pegar atendimento")}
                      </button>
                    ) : (
                      <span title="admin/supervisão não têm carteira: use Transferir para designar alguém"
                        style={{ fontSize: 10.5, fontWeight: 700, color: "#8a2f12", background: "#fdeae3", border: "1px solid #f0c4b0",
                          borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap" }}>
                        na fila — sem dono
                      </span>
                    )
                  )}
                  {(!isMobile || compacto) && (
                    <button onClick={() => setPainelAberto((v) => !v)} title={painelAberto ? "Ocultar dados do cliente" : "Mostrar dados do cliente (ERP)"}
                      style={{ fontSize: fonteBotao, fontWeight: 700, color: painelAberto ? "#fff" : M.wine, background: painelAberto ? M.wine : M.bg, border: `1px solid ${painelAberto ? M.wine : M.border}`, borderRadius: 999, padding: padBotao, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      {rot("📊", "📊 Cliente", "cliente", "Cliente")}
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
                    compacto={compacto}
                    bancada={bc}
                  />
                  {/* Devolver só aparece quando o cliente NÃO tem dono comercial
                      (`carteira_dona` nula) e a conversa está comigo: é o desfazer
                      do ✋ Pegar. Num cliente de carteira o botão certo é
                      Transferir, com nome — e por isso ele nem é oferecido, em vez
                      de aparecer e o servidor recusar depois do clique. */}
                  {!sel.na_fila && !sel.carteira_dona && sel.vendedor
                    && (sessao.role !== "vendedor" || sessao.carteira === sel.vendedor) && (
                    <button onClick={devolverParaFila} disabled={puxando}
                      title="Devolver para a fila de espera — volta a ficar disponível para qualquer pessoa"
                      style={{ fontSize: fonteBotao, fontWeight: 700, color: M.gray, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 999, padding: padBotao, cursor: puxando ? "wait" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      {rot("↩", "↩ Devolver", "devolver", "Devolver")}
                    </button>
                  )}
                  <button onClick={() => { setTransferindo((v) => !v); setResolvendo(false); }}
                    title="Passar esta conversa para outro vendedor"
                    style={{ fontSize: fonteBotao, fontWeight: 700, color: transferindo ? "#fff" : M.roxo, background: transferindo ? M.roxo : M.bg, border: `1px solid ${transferindo ? M.roxo : M.border}`, borderRadius: 999, padding: padBotao, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    {rot("↪", "↪ Transferir", "transferir", "Transferir")}
                  </button>
                  {(sel.status ?? "aberta") === "resolvida" ? (
                    <button onClick={() => mudarStatus("aberta")} title="Voltar para a fila"
                      style={{ fontSize: fonteBotao, fontWeight: 700, color: "#1a6b3c", background: "#eaf5ee", border: "1px solid #bfe0cb", borderRadius: 999, padding: padBotao, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      {rot("↺", "✓ Resolvida — reabrir", "reabrir", "Resolvida — reabrir")}
                    </button>
                  ) : (
                    /* item 17 do laudo: em `bancada` o Resolver e VERDE, porque
                       verde e "concluido" nesta paleta e cada familia de cor tem um
                       trabalho so. Roxo aqui competia com a marca; e liberar o azul
                       preenchido para o enviar, que passa a ser o unico da tela. */
                    <button onClick={() => setResolvendo((v) => !v)} title="Encerrar atendimento com um motivo"
                      style={{ fontSize: fonteBotao, fontWeight: 700, color: "#fff", background: bc ? M.ok : M.roxo, border: "none", borderRadius: 999, padding: compacto ? "4px 8px" : "6px 12px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      {rot("✓", "Resolver", "resolver", "Resolver")}
                    </button>
                  )}
                  {sel.telefone && (
                    <a href={`https://wa.me/${String(sel.telefone).replace(/\D/g, "").length <= 11 ? "55" : ""}${String(sel.telefone).replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" title="Abrir no WhatsApp" style={{ fontSize: 12, fontWeight: 700, color: M.azul, textDecoration: "none", whiteSpace: "nowrap" }}>
                      {rot("↗", "WhatsApp ↗", "externo", "WhatsApp")}
                    </a>
                  )}
                  {/* D1 · no celular não há faixa de abas: este é o caminho
                      para o ERP, que fora do D1 simplesmente não existe ali */}
                  {d1 && isMobile && (
                    <button onClick={() => { setAbaContato(abaPadrao); setPainelAberto(true); }}
                      title="Ver os dados de compra desta cliente"
                      style={{ minHeight: 34, fontSize: 11.5, fontWeight: 800, color: M.wine, background: M.roxoSoft,
                        border: `1px solid ${M.border}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer",
                        fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      📊 Cliente
                    </button>
                  )}
                  </span>
                </div>

                {/* ---- faixa de abas do contato — exatamente onde o RD a põe
                     (lá é Perfil · Etiquetas · Atividades · Funis · Carteiras ·
                     Histórico, logo abaixo do nome). Aqui elas trocam o conteúdo
                     da coluna da direita, que continua visível: o ERP ao lado da
                     conversa é justamente o que o RD não tem. ---- */}
                {!isMobile && (
                  <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 14px", background: M.surface, borderBottom: `1px solid ${M.border}`, overflowX: "auto", flexShrink: 0 }}>
                    {abasContato.map((a) => {
                      const on = painelAberto && abaAtual === a.k;
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
                      {d1 ? "Transferir a conversa" : "Transferir a conversa para"}
                    </div>
                    {d1 && campoMotivoTransf}
                    {d1 && (
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: M.gray, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
                        Para quem — escolher envia
                      </div>
                    )}
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
                    {!d1 && campoMotivoTransf}
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
                <div ref={rolagemRef} className={bc ? "bc-rolagem" : undefined} style={{ position: "relative", flex: 1, overflowY: "auto", padding: G.msgsPad, display: "flex", flexDirection: "column", gap: 4 }}>
                  {msgs === null && <div style={{ color: M.muted, fontSize: 12.5, textAlign: "center", padding: 20 }}>Carregando mensagens…</div>}
                  {msgs?.length === 0 && !notas.length && ocultas === 0 && (bc
                    ? <Estado glifo="✉️" titulo="Sem mensagens ainda"
                        texto="Este contato existe no cadastro, mas ainda não trocou nenhuma mensagem por este número." />
                    : <div style={{ color: M.muted, fontSize: 12.5, textAlign: "center", padding: 20 }}>Sem mensagens ainda.</div>)}

                  {/* Histórico do outro número, a um clique — como o RD faz (0103).
                      Fica no TOPO porque é o que vem antes na linha do tempo. Sem
                      isto, uma conversa com 23 mensagens no RD dizia "Sem mensagens
                      ainda", e o vendedor ligava achando que era o primeiro contato. */}
                  {/* Carregar as anteriores. Fica ACIMA do botão de histórico do
                      outro número porque é o que vem antes na linha do tempo
                      desta conversa; o outro é de OUTRO número. Sem isto a
                      thread terminava em silêncio na 200a mensagem, e para quem
                      rolava a conversa mais antiga simplesmente não existia. */}
                  {temMais && (
                    <div style={{ textAlign: "center", padding: "2px 0 10px" }}>
                      <button onClick={() => void carregarAntigas()} disabled={carregandoAntigas}
                        style={{ fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                          cursor: carregandoAntigas ? "wait" : "pointer",
                          color: M.gray, background: M.surface, border: `1px solid ${M.border}`,
                          borderRadius: 999, padding: "6px 16px" }}>
                        {carregandoAntigas ? "carregando…" : "↑ Carregar mensagens anteriores"}
                      </button>
                    </div>
                  )}

                  {ocultas > 0 && !comHistorico && sel && (
                    <div style={{ textAlign: "center", padding: "2px 0 10px" }}>
                      <button
                        onClick={() => void carregarThread(sel, false, true)}
                        style={{ fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                          color: M.azul, background: M.surface, border: `1px solid ${M.border}`,
                          borderRadius: 999, padding: "6px 16px" }}>
                        ↑ Ver histórico anterior ({ocultas})
                      </button>
                      <div style={{ fontSize: 10.5, color: M.muted, marginTop: 4 }}>
                        conversas deste cliente no Murano Pro (RD Conversas)
                      </div>
                    </div>
                  )}
                  {comHistorico && (
                    <div style={{ textAlign: "center", padding: "2px 0 6px" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: M.gray, background: M.surface,
                        border: `1px solid ${M.border}`, borderRadius: 999, padding: "3px 12px" }}>
                        inclui o histórico do Murano Pro (RD Conversas)
                      </span>
                    </div>
                  )}

                  {grupos.map((g) => (
                    <div key={g.dia} style={{ display: "flex", flexDirection: "column", gap: G.gapDia }}>
                      <div style={{ alignSelf: "center", fontSize: 10.5, fontWeight: 700, color: M.gray, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 999, padding: "3px 12px", margin: "8px 0 4px" }}>
                        {g.dia.split("-").reverse().join("/")}
                      </div>
                      {g.itens.map((it, iIt) => {
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
                        // ---- agrupamento por autor (bancada) -----------------
                        // Hoje cada mensagem carrega a própria hora e o próprio
                        // tique, o que enche a coluna direita de repetição —
                        // cinco mensagens seguidas da mesma pessoa mostram cinco
                        // vezes o mesmo minuto. Aqui a hora aparece só na ÚLTIMA
                        // bolha do grupo, e o grupo respira 10 px enquanto as
                        // bolhas de dentro ficam a 2.
                        //
                        // "Mesmo grupo" = mesmo LADO da conversa em itens
                        // consecutivos. Marco de ligação, nota e transferência
                        // quebram o grupo por serem outra coisa — e devem
                        // quebrar: são o assunto mudando.
                        const ladoDe = (x: any) => (x && x.k === "m" ? (x.m.enviada_por !== "customer") : null);
                        // Mensagem que FALHOU sempre fecha o grupo, e a seguinte
                        // abre outro: ela pendura o recado "não entregue" abaixo
                        // de si, que é uma barra larga cortando a conversa ao
                        // meio. Sem esta regra, a hora do grupo iria parar do
                        // outro lado dessa barra, longe das bolhas que ela datava.
                        const falhou = (x: any) => !!(x && x.k === "m" && x.m.status === "failed");
                        const abreGrupo = ladoDe(g.itens[iIt - 1]) !== fora || falhou(g.itens[iIt - 1]);
                        const fechaGrupo = ladoDe(g.itens[iIt + 1]) !== fora || falhou(it);
                        return (
                          // empilha em coluna quando há um recado abaixo da bolha
                          // (a falha do D1): em `row` ele iria PARA O LADO dela
                          <div key={m.id} style={{ display: "flex", position: "relative",
                            // 8 px somados ao `gap` de 2 dão os 10 entre grupos.
                            // No primeiro item do dia não, porque a pastilha da
                            // data já traz a própria margem.
                            marginTop: bc && abreGrupo && iIt > 0 ? 8 : undefined,
                            // só o D1 empilha: ele pendura um recado de falha
                            // abaixo da bolha, e em `row` ele iria para o LADO.
                            // O desenho original fica byte a byte como era —
                            // rollback que muda "quase nada" não é rollback.
                            ...(d1
                              ? { flexDirection: "column" as const, alignItems: fora ? "flex-end" : "flex-start" }
                              : { justifyContent: fora ? "flex-end" : "flex-start" }) }}>
                            <div
                              style={{ maxWidth: G.bolhaMax, background: fora ? M.bolhaFora : M.bolhaDentro, border: `1px solid ${fora ? (d1 ? "#c9dff5" : "#dcc8e2") : M.border}`,
                              // a quina que aponta para o autor só existe na
                              // ÚLTIMA bolha do grupo: no meio dele, as quatro
                              // pontas iguais é que fazem as bolhas lerem como
                              // uma fala só, em vez de cinco recados soltos.
                              borderRadius: bc && !fechaGrupo
                                ? G.raioBolha
                                : fora ? `${G.raioBolha}px ${G.raioBolha}px 3px ${G.raioBolha}px` : `${G.raioBolha}px ${G.raioBolha}px ${G.raioBolha}px 3px`,
                              padding: G.bolhaPad, boxShadow: "0 1px 1px rgba(28,14,27,0.06)", marginBottom: m.reacao ? 10 : 0 }}>
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
                              {m.localizacao && <CartaoLocal loc={m.localizacao} />}
                              {/* com mídia, o texto só aparece se for legenda de verdade (não o rótulo).
                                  Com CARTÃO de mapa, o texto some sempre: `conteudo` é o
                                  mesmo endereço, escrito para quem lê a LISTA de conversas,
                                  onde não há cartão nenhum. Na bolha, seria a mesma coisa duas vezes. */}
                              {!m.localizacao && (!m.midia_tipo || (m.conteudo && !/^(📷|🎬|🎤|📎|🙂)/.test(m.conteudo))) && (
                                <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.conteudo}</div>
                              )}
                              {/* Encaminhar. Fica DENTRO da bolha, na linha da
                                  hora, e nao flutuando na borda: a bolha ja e
                                  estreita, e um botao por fora empurraria o
                                  texto. Aparece so em mensagem com conteudo --
                                  marco de sistema e reacao nao se encaminham. */}
                              {/* A HORA APARECE EM TODA BOLHA, sempre — inclusive
                                  em cinco mensagens seguidas do mesmo minuto.
                                  Em `bancada` ela ficava só na última do grupo
                                  (item 21 da §60.7) para tirar repetição da
                                  coluna direita, e a troca se mostrou errada no
                                  uso: quem atende precisa saber a que horas cada
                                  fala chegou, e "o mesmo minuto" é justamente a
                                  rajada em que a ordem importa. Repetição que
                                  responde uma pergunta não é ruído.

                                  O agrupamento continua — espaçamento de 2 px
                                  dentro do grupo e a quina só na última bolha —,
                                  porque aquilo não esconde informação nenhuma. */}
                              <div
                                style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 5, marginTop: 3, fontSize: 10, color: M.muted, fontVariantNumeric: "tabular-nums" }}>
                                {(m.conteudo || m.midia_path) && m.tipo !== "evento_sistema" && (
                                  <button
                                    onClick={() => { setEncaminhando(m); setBuscaEnc(""); }}
                                    title="Encaminhar para outro contato"
                                    style={{ marginRight: "auto", background: "transparent", border: "none",
                                      color: M.muted, fontSize: 12, lineHeight: 1, cursor: "pointer",
                                      fontFamily: "inherit", padding: 0, opacity: 0.75 }}>
                                    ↪
                                  </button>
                                )}
                                {horaBR(m.criada_em)}
                                {fora && <Ticks erro={m.erro} status={m.status} />}
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
                            {/* ---- D1 · a falha deixa de morar num `title` (0095) ----
                                O motivo que a Meta devolveu vive hoje num atributo
                                `title`, que depende de hover e NÃO abre em toque —
                                num app mobile a mensagem que não chegou fica sem
                                causa e sem saída (§29.2 item 5). Aqui o motivo é
                                texto, e o reenvio é um botão ao lado dele. */}
                            {d1 && fora && m.status === "failed" && (() => {
                              // O que a Meta manda vem em inglês, com o título repetido
                              // e sem dizer o que fazer. Aqui vira uma frase em português
                              // mais a ação; o texto original continua no `title`, porque
                              // em caso novo ele é a única pista que existe (§22.6.1).
                              const e = traduzErroMeta(m.erro);
                              // Fora da janela de 24h, reenviar o mesmo texto falha de
                              // novo — o caminho é o template. O botão diz isso.
                              const janelaFechada = codigoMeta(m.erro) === "131047";
                              return (
                              <div title={e.tecnico || undefined}
                                style={{ maxWidth: "76%", marginTop: 3, padding: "6px 10px", fontSize: 11,
                                lineHeight: 1.45, color: M.laranja, background: "#fdeee9",
                                border: "1px solid #f2cabb", borderRadius: 8,
                                display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ flex: 1 }}>
                                  <b>Não entregue.</b> {e.texto}
                                  {e.acao && <><br /><span style={{ opacity: 0.85 }}>{e.acao}</span></>}
                                </span>
                                <button
                                  onClick={() => {
                                    if (janelaFechada) { setMenuTemplate(true); return; }
                                    setTexto(m.conteudo); setModoNota(false);
                                  }}
                                  title={janelaFechada
                                    ? "Abre a lista de templates — é o que reabre a conversa"
                                    : "Copia o texto para a caixa de digitação para você enviar de novo"}
                                  style={{ flexShrink: 0, border: "none", borderRadius: 999, padding: "4px 11px",
                                    fontSize: 11, fontWeight: 800, fontFamily: "inherit", color: "#fff",
                                    background: M.roxo, cursor: "pointer", whiteSpace: "nowrap" }}>
                                  {janelaFechada ? "Template" : "Reenviar"}
                                </button>
                              </div>
                              );
                            })()}
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

                {/* ---- D1 · faixa permanente da janela de 24h (0095) ----
                    Fica ACIMA do compositor, no caminho do olho antes de
                    digitar. Fechada, ela deixa de ser aviso e vira ação: o
                    botão que reabre está na própria faixa, não numa instrução
                    mandando o vendedor procurar outro botão. */}
                {d1 && msRestantes != null && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 9, margin: "0 14px",
                    padding: "6px 12px", fontSize: 12, borderRadius: 8,
                    color: janelaAberta ? M.azul : M.laranja,
                    background: janelaAberta ? "#e9f1fb" : "#fdeee9",
                    border: `1px solid ${janelaAberta ? "#c9dff5" : "#f2cabb"}`,
                  }}>
                    <span>{janelaAberta ? "🕐" : "🔒"}</span>
                    <span style={{ fontWeight: 700 }}>
                      {janelaAberta
                        ? `Janela aberta · ${janelaRotulo}`
                        : "Janela fechada"}
                    </span>
                    {janelaAberta ? (
                      // a barra mostra o que resta das 24h — número sozinho não
                      // dá noção de urgência, e é o que decide entre responder
                      // agora ou depois do almoço
                      <span style={{ flex: 1, maxWidth: 170, height: 5, borderRadius: 999, background: "rgba(127,127,140,.22)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", borderRadius: 999, background: "currentColor",
                          width: `${Math.max(2, Math.round((msRestantes! / (24 * 3600 * 1000)) * 100))}%` }} />
                      </span>
                    ) : (
                      <span style={{ flex: 1, color: M.gray }}>só um template reabre a conversa</span>
                    )}
                    {!janelaAberta && (
                      <button onClick={() => setMenuTemplate(true)} disabled={enviando}
                        title="Enviar um template para reabrir a conversa"
                        style={{ border: "none", borderRadius: 999, padding: "5px 13px", fontSize: 11.5, fontWeight: 800,
                          fontFamily: "inherit", color: "#fff", background: M.roxo, cursor: enviando ? "default" : "pointer",
                          opacity: enviando ? 0.6 : 1, whiteSpace: "nowrap" }}>
                        Enviar template
                      </button>
                    )}
                  </div>
                )}

                {/* aviso (janela 24h / erro de envio) — o ÚNICO uso forte do laranja */}
                {aviso && (
                  <div style={{ margin: "0 14px", padding: "8px 12px", fontSize: 12.5, color: "#8a2f12", background: "#fdeae3", border: `1px solid #f0c4b0`, borderLeft: `3px solid ${M.laranja}`, borderRadius: "0 8px 8px 0" }}>
                    ⚠️ {aviso}
                  </div>
                )}

                {/* ---- gravação pronta: ouvir, e só então decidir ----------------
                    Fica ACIMA do compositor, e não dentro da pílula, porque as
                    duas ações aqui não são do mesmo peso do clipe e do micro-
                    fone: uma delas fala com a cliente e não volta atrás. */}
                {previa && (
                  <div style={{ margin: "0 14px", display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 10px", background: M.surface, border: `1px solid ${M.border}`,
                    borderLeft: `3px solid ${M.roxo}`, borderRadius: "0 10px 10px 0" }}>
                    {/* o player é nosso: `<audio controls>` é desenhado pelo
                        navegador, muda de cara em cada um, e traz seek, volume e
                        menu de download num lugar onde o gesto útil é só ouvir */}
                    <audio ref={audioRef} src={previa.url} preload="metadata"
                      onPlay={() => setTocando(true)}
                      onPause={() => setTocando(false)}
                      onEnded={() => { setTocando(false); setPosicao(0); }}
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration;
                        if (Number.isFinite(d) && d > 0) setPrevia((p) => (p ? { ...p, seg: d } : p));
                      }}
                      onTimeUpdate={(e) => setPosicao((e.currentTarget as HTMLAudioElement).currentTime)} />
                    <button onClick={ouvirPrevia} title={tocando ? "Pausar" : "Ouvir antes de enviar"}
                      style={{ width: 30, height: 30, borderRadius: 30, display: "flex", alignItems: "center",
                        justifyContent: "center", flexShrink: 0, border: "none", cursor: "pointer",
                        fontFamily: "inherit", fontSize: 13, background: M.roxoSoft, color: M.roxo }}>
                      {bc ? <Icone n={tocando ? "pausa" : "tocar"} tamanho={15} /> : tocando ? "⏸" : "▶"}
                    </button>
                    <span style={{ flex: 1, minWidth: 40, height: 4, borderRadius: 4, background: M.bg, overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", borderRadius: 4, background: M.roxo,
                        width: `${Math.min(100, (posicao / previa.seg) * 100)}%` }} />
                    </span>
                    <b style={{ fontSize: 12, color: M.gray, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                      {String(Math.floor((tocando || posicao ? posicao : previa.seg) / 60)).padStart(2, "0")}
                      :{String(Math.floor((tocando || posicao ? posicao : previa.seg) % 60)).padStart(2, "0")}
                    </b>
                    <button onClick={soltarPrevia} title="Descartar e não enviar"
                      style={{ background: "transparent", border: "none", color: M.gray, fontSize: 11.5,
                        cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", flexShrink: 0 }}>
                      descartar
                    </button>
                    <button onClick={enviarPrevia} disabled={enviandoArquivo}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8,
                        border: "none", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", color: "#fff",
                        background: M.roxo, flexShrink: 0, cursor: enviandoArquivo ? "default" : "pointer",
                        opacity: enviandoArquivo ? 0.6 : 1 }}>
                      {bc ? <Icone n="enviar" tamanho={14} /> : null} Enviar
                    </button>
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
                <div style={{ display: "flex", gap: 8, padding: compacto ? "8px 10px" : G.compPad, background: modoNota ? NOTA.bg : M.surface, borderTop: `1px solid ${modoNota ? NOTA.borda : M.border}`, alignItems: "flex-end", transition: "background .15s" }}>
                  {/* anexo: foto, áudio, documento — o texto digitado vira legenda
                      da PRIMEIRA. `multiple`: dá para escolher várias fotos de uma vez */}
                  <input
                    ref={arquivoRef}
                    type="file"
                    multiple
                    accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
                    style={{ display: "none" }}
                    onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) enviarArquivos(fs); }}
                  />
                  {/* ---- A PILULA -------------------------------------------
                      No WhatsApp o anexo e o audio moram DENTRO da caixa de
                      texto, nao ao lado dela: e uma peca so, com a borda em
                      volta de tudo. Antes cada botao era um quadrado com borda
                      propria e o campo era mais um quadrado no meio da fila --
                      por isso parecia estreito mesmo tendo espaco. Aqui a borda
                      passa para o container, os botoes ficam transparentes, e o
                      campo ocupa o que sobra. O enviar fica de FORA, como la. */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "flex-end", gap: 2,
                    padding: compacto ? "3px 4px" : G.pilPad,
                    background: modoNota ? M.surface : M.bg,
                    // A borda da pílula é de CONTROLE, não divisória: é ela que
                    // diz onde se digita. Por isso `lineStrong` (3,53:1) e não
                    // a linha clara das seções, que some contra o fundo.
                    border: `1px solid ${modoNota ? NOTA.borda : M.lineStrong}`,
                    borderRadius: compacto ? 16 : 22, transition: "border-color .15s" }}>
                  <div style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    // Antes: sem endereço cadastrado o clipe ia direto para o
                    // seletor de arquivo. Agora o menu tem SEMPRE ao menos duas
                    // opções (arquivo e pedir localização), então ele sempre abre.
                    onClick={() => setAnexoAberto((v) => !v)}
                    disabled={enviandoArquivo || modoNota}
                    title={modoNota ? "Nota interna não leva anexo" : "Anexar fotos, áudio ou documentos (dá para escolher várias)"}
                    style={{ width: pilBtn, height: pilBtn, borderRadius: raioPilBtn, ...(bc ? CENTRO : null), border: "none", background: "transparent", color: M.gray, fontSize: rotuloFila ? 12 : 17, fontWeight: rotuloFila ? 700 : 400, fontVariantNumeric: "tabular-nums", opacity: modoNota ? 0.4 : 1, cursor: enviandoArquivo || modoNota ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    {!enviandoArquivo ? (bc ? <Icone n="clipe" /> : "📎") : (rotuloFila ?? "…")}
                  </button>
                  {anexoAberto && (
                    <>
                      <div onClick={() => setAnexoAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 200 }} />
                      <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 201, minWidth: 210,
                        background: M.surface, border: `1px solid ${M.border}`, borderRadius: 11,
                        boxShadow: "0 12px 30px rgba(28,14,27,.20)", overflow: "hidden" }}>
                        <button onClick={() => { setAnexoAberto(false); arquivoRef.current?.click(); }}
                          style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
                            padding: "10px 13px", fontSize: 13, fontWeight: 600, color: M.ink,
                            background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                          <span style={{ fontSize: 16 }}>📎</span> Arquivo, foto ou vídeo
                        </button>
                        <div style={{ height: 1, background: M.bg }} />
                        <div style={{ padding: "7px 13px 3px", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5,
                          textTransform: "uppercase", color: M.muted }}>Localização</div>
                        <button onClick={() => { setAnexoAberto(false); void pedirLocal(); }}
                          title="A cliente recebe um botão e escolhe compartilhar. Não é acompanhamento ao vivo — a API do WhatsApp não entrega isso."
                          style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
                            padding: "9px 13px", fontSize: 13, fontWeight: 600, color: M.ink,
                            background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                          <span style={{ fontSize: 16 }}>🛰️</span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block" }}>Pedir a localização dela</span>
                            <span style={{ display: "block", fontSize: 11, color: M.muted }}>posição do momento</span>
                          </span>
                        </button>
                        {locais.length > 0 && <div style={{ height: 1, background: M.bg }} />}
                        {locais.map((l, i) => (
                          <button key={i} onClick={() => { setAnexoAberto(false); void enviarLocal(i, l.nome); }}
                            title={l.endereco}
                            style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
                              padding: "9px 13px", fontSize: 13, fontWeight: 600, color: M.ink,
                              background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                            <span style={{ fontSize: 16 }}>📍</span>
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: "block" }}>{l.nome}</span>
                              <span style={{ display: "block", fontSize: 11, color: M.muted, whiteSpace: "nowrap",
                                overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>{l.endereco}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  </div>
                  {/* 🎤 gravar áudio — clica pra gravar, clica de novo pra enviar */}
                  <button
                    onClick={alternarGravacao}
                    disabled={enviandoArquivo || modoNota || !!previa}
                    title={modoNota ? "Nota interna não leva áudio"
                      : previa ? "Ouça a gravação e decida antes de gravar outra"
                      : gravando ? "Parar e ouvir" : "Gravar áudio"}
                    style={{ width: pilBtn, height: pilBtn, borderRadius: raioPilBtn, ...(bc ? CENTRO : null), flexShrink: 0, fontFamily: "inherit", fontSize: 17,
                      opacity: modoNota || previa ? 0.4 : 1, cursor: enviandoArquivo || modoNota || previa ? "default" : "pointer",
                      border: "none",
                      background: gravando ? "#fdeae3" : "transparent", color: gravando ? M.laranja : M.gray }}
                  >
                    {bc ? <Icone n={gravando ? "parar" : "microfone"} /> : gravando ? "⏹" : "🎤"}
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
                  {/* lote em andamento: o número na tela é o que a cliente já
                      recebeu, para ninguém achar que travou nem mandar de novo */}
                  {fila && fila.total > 1 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 7, alignSelf: "center", whiteSpace: "nowrap" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 8, background: M.roxo }} />
                      <b style={{ fontSize: 12.5, color: M.roxo, fontVariantNumeric: "tabular-nums" }}>
                        enviando {Math.min(fila.feito + 1, fila.total)} de {fila.total}…
                      </b>
                    </span>
                  )}
                  {/* ⚡ respostas rápidas — o mesmo que digitar `/` */}
                  {/* Pausa (0106): só faz sentido com a janela aberta — fora
                      dela o envio falharia, e o aviso não vale um template. O
                      botão fica visível mas desabilitado, dizendo por quê. */}
                  {/* ---- os tres secundarios ------------------------------
                      Pausa, respostas rapidas e nota interna sao uteis, mas nao
                      sao o gesto principal. Na LUPA (500px) eles somavam 90px e
                      deixavam a caixa de texto com 41% da barra -- fora do padrao
                      de qualquer chat, onde o campo domina. No modo compacto eles
                      passam a viver atras de "⋯"; na tela cheia continuam todos a
                      vista, porque la sobra largura. */}
                  {compacto ? (
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <button
                        onClick={() => setMaisAberto((v) => !v)}
                        title="Mais: pausa, respostas rapidas e nota interna"
                        style={{ width: 30, height: 30, borderRadius: 9,
                          border: "none",
                          background: maisAberto ? M.roxo : "transparent", color: maisAberto ? "#fff" : M.gray,
                          fontSize: 15, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                        ⋯
                      </button>
                      {maisAberto && (
                        <>
                          <div onClick={() => setMaisAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 200 }} />
                          <div onClick={() => setMaisAberto(false)}
                            style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 201,
                              display: "flex", gap: 5, padding: 6, background: M.surface,
                              border: `1px solid ${M.border}`, borderRadius: 10,
                              boxShadow: "0 10px 26px rgba(28,14,27,.18)" }}>
                  <button
                    onClick={avisarPausa}
                    disabled={pausando || modoNota || !janelaAberta}
                    title={!janelaAberta
                      ? "Sem janela de 24h aberta — o aviso de pausa não pode ser enviado"
                      : "Avisar a cliente que você vai se ausentar por alguns minutos"}
                    style={{ width: pilBtn, height: pilBtn, borderRadius: raioPilBtn, ...(bc ? CENTRO : null),
                      border: "none", background: "transparent", color: M.gray, fontSize: 15,
                      opacity: modoNota || !janelaAberta ? 0.4 : 1,
                      cursor: pausando || modoNota || !janelaAberta ? "default" : "pointer",
                      fontFamily: "inherit", flexShrink: 0 }}>
                    {pausando ? "…" : bc ? <Icone n="pausa" /> : "⏸"}
                  </button>
                  <button
                    onClick={() => { setPicker((v) => !v); setPickerIdx(0); }}
                    disabled={modoNota}
                    title="Respostas rápidas (ou digite / na caixa)"
                    style={{ width: pilBtn, height: pilBtn, borderRadius: raioPilBtn, ...(bc ? CENTRO : null), border: "none", background: picker ? M.roxo : "transparent", color: picker ? "#fff" : M.gray, fontSize: 16, opacity: modoNota ? 0.4 : 1, cursor: modoNota ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    {bc ? <Icone n="raio" /> : "⚡"}
                  </button>
                  {/* 🗒️ nota interna — o cliente NUNCA vê o que for escrito aqui */}
                  <button
                    onClick={() => { setModoNota((v) => !v); setPicker(false); setTimeout(() => textoRef.current?.focus(), 10); }}
                    title={modoNota ? "Voltar a escrever mensagem para o cliente" : "Escrever nota interna (o cliente não vê)"}
                    style={{ width: pilBtn, height: pilBtn, borderRadius: raioPilBtn, ...(bc ? CENTRO : null), border: "none", background: modoNota ? NOTA.ink : "transparent", color: modoNota ? NOTA.bg : M.gray, fontSize: 16, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    {bc ? <Icone n="nota" /> : "🗒️"}
                  </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                  <button
                    onClick={avisarPausa}
                    disabled={pausando || modoNota || !janelaAberta}
                    title={!janelaAberta
                      ? "Sem janela de 24h aberta — o aviso de pausa não pode ser enviado"
                      : "Avisar a cliente que você vai se ausentar por alguns minutos"}
                    style={{ width: pilBtn, height: pilBtn, borderRadius: raioPilBtn, ...(bc ? CENTRO : null),
                      border: "none", background: "transparent", color: M.gray, fontSize: 15,
                      opacity: modoNota || !janelaAberta ? 0.4 : 1,
                      cursor: pausando || modoNota || !janelaAberta ? "default" : "pointer",
                      fontFamily: "inherit", flexShrink: 0 }}>
                    {pausando ? "…" : bc ? <Icone n="pausa" /> : "⏸"}
                  </button>
                  <button
                    onClick={() => { setPicker((v) => !v); setPickerIdx(0); }}
                    disabled={modoNota}
                    title="Respostas rápidas (ou digite / na caixa)"
                    style={{ width: pilBtn, height: pilBtn, borderRadius: raioPilBtn, ...(bc ? CENTRO : null), border: "none", background: picker ? M.roxo : "transparent", color: picker ? "#fff" : M.gray, fontSize: 16, opacity: modoNota ? 0.4 : 1, cursor: modoNota ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    {bc ? <Icone n="raio" /> : "⚡"}
                  </button>
                  {/* 🗒️ nota interna — o cliente NUNCA vê o que for escrito aqui */}
                  <button
                    onClick={() => { setModoNota((v) => !v); setPicker(false); setTimeout(() => textoRef.current?.focus(), 10); }}
                    title={modoNota ? "Voltar a escrever mensagem para o cliente" : "Escrever nota interna (o cliente não vê)"}
                    style={{ width: pilBtn, height: pilBtn, borderRadius: raioPilBtn, ...(bc ? CENTRO : null), border: "none", background: modoNota ? NOTA.ink : "transparent", color: modoNota ? NOTA.bg : M.gray, fontSize: 16, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    {bc ? <Icone n="nota" /> : "🗒️"}
                  </button>
                    </>
                  )}
                  {!modoNota && (() => {
                    // Só os templates do canal DESTA conversa: oferecer um da
                    // Cloud numa conversa do RD (ou o contrário) manda um id que
                    // o outro lado não conhece, e a falha só apareceria depois.
                    const canalAqui = linha?.canal === "rd" ? "rd" : "cloud";
                    const doCanal = templates.filter((t) => (t.canal === "cloud" ? "cloud" : "rd") === canalAqui);
                    const primeiroNome = String(sel?.cliente ?? "").trim().split(/\s+/)[0] || "cliente";
                    return (
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <button
                          onClick={() => (doCanal.length ? setMenuTemplate((v) => !v) : enviarTemplate())}
                          disabled={enviando}
                          title="Escolher um template — reabre a conversa fora da janela de 24h"
                          style={{ height: pilBtn, width: compacto ? pilBtn : undefined, padding: compacto ? 0 : "0 12px", borderRadius: raioPilBtn, ...(bc ? CENTRO : null), border: "none", background: menuTemplate ? M.roxo : "transparent", color: menuTemplate ? "#fff" : M.wine, fontSize: compacto ? 13 : 11.5, fontWeight: bc ? 700 : 800, letterSpacing: compacto ? 0 : 0.3, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
                        >
                          {/* Na lupa a palavra sozinha comia ~90px de um compositor
                              de 500px. Vira "T", como os demais icones da barra —
                              o que ela faz ja esta no title. */}
                          {compacto ? "T" : <>TEMPLATE{doCanal.length > 0 && <span style={{ fontSize: 9, marginLeft: 4, opacity: .8 }}>▾</span>}</>}
                        </button>

                        {menuTemplate && doCanal.length > 0 && (
                          <>
                            <div onClick={fecharTemplate} style={{ position: "fixed", inset: 0, zIndex: 200 }} />
                            <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 201, width: 360, maxHeight: 440, overflowY: "auto", background: M.surface, border: `1px solid ${M.border}`, borderRadius: 12, boxShadow: "0 14px 40px rgba(28,14,27,.22)" }}>
                              {compondo ? (
                                <CompositorTemplate
                                  t={compondo.t}
                                  campos={camposDe(compondo.t)}
                                  valores={compondo.valores}
                                  enviando={enviando}
                                  onMudar={(i, v) => setCompondo((c) => c && { ...c, valores: c.valores.map((x, k) => (k === i ? v : x)) })}
                                  onVoltar={() => setCompondo(null)}
                                  onEnviar={() => enviarTemplate(compondo.t, compondo.valores)}
                                />
                              ) : (
                                <>
                                  <div style={{ padding: "9px 12px", fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: M.muted, borderBottom: `1px solid ${M.bg}` }}>
                                    Escolha o template
                                  </div>
                                  {doCanal.map((t) => {
                                    const campos = camposDe(t);
                                    return (
                                      <button key={t.id} onClick={() => escolherTemplate(t)}
                                        style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", background: "transparent", border: "none", borderBottom: `1px solid ${M.bg}`, cursor: "pointer", fontFamily: "inherit" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                          <b style={{ fontSize: 13, color: M.ink }}>{t.nome}</b>
                                          {t.cabecalho_tipo === "imagem" && <span style={{ fontSize: 11 }} title="tem imagem">🖼️</span>}
                                          {t.padrao && <span style={{ fontSize: 10, fontWeight: 800, color: M.roxo }}>padrão</span>}
                                          {campos.length > 0 && (
                                            <span style={{ fontSize: 10, fontWeight: 700, color: M.muted, marginLeft: "auto" }}>
                                              {campos.length} campo{campos.length === 1 ? "" : "s"} a preencher
                                            </span>
                                          )}
                                        </div>
                                        {/* prévia com o nome REAL de quem vai receber no
                                            {{1}}; os demais campos ficam como traço, que é
                                            o que ainda falta escrever */}
                                        <div style={{ fontSize: 12, color: M.gray, marginTop: 3, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                                          {t.corpo
                                            ? aplicarVariaveis(t.corpo, [primeiroNome]).replace(/\{\{\s*\d+\s*\}\}/g, "———")
                                            : "O texto deste template mora no painel do RD Conversas — não temos como mostrar aqui."}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
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
                    // ⚠️ CURTO de proposito. O `scrollHeight` de um textarea VAZIO
                    // conta a altura do placeholder -- e o texto antigo ("Escreva uma
                    // mensagem… (/ abre respostas rapidas, Enter envia)") quebrava em
                    // duas linhas num campo de 300px. Resultado: a caixa nunca voltava
                    // ao tamanho de uma linha depois de enviar. A dica do "/" e do
                    // Enter vive no `title`, onde nao ocupa altura.
                    placeholder={modoNota ? "Nota interna…" : "Mensagem"}
                    title={modoNota
                      ? "Nota interna — só a equipe vê. Enter salva."
                      : "Enter envia · Shift+Enter quebra linha · / abre as respostas rápidas"}
                    rows={1}
                    onInput={crescer}
                    style={{ flex: 1, minWidth: 0, boxSizing: "border-box", resize: "none", padding: compacto ? "6px 6px" : "9px 8px", fontSize: 13.5, fontFamily: "inherit", color: modoNota ? NOTA.ink : M.ink, background: "transparent", border: "none", outline: "none", lineHeight: 1.4, overflowY: "hidden" }}
                  />
                  </div>
                  <button
                    onClick={() => (modoNota ? enviarNota() : enviar())}
                    disabled={enviando || !texto.trim()}
                    title={modoNota ? "Salvar nota interna (Enter)" : "Enviar (Enter)"}
                    // Em `bancada` o enviar é o ÚNICO azul preenchido da tela —
                    // é o que faz "a ação" ter um lugar só. Nos outros desenhos
                    // ele segue púrpura, como sempre foi.
                    style={{ width: envLarg, height: envAlt, borderRadius: raioPilBtn, ...(bc ? CENTRO : null), border: "none", background: !texto.trim() ? M.roxoSoft : modoNota ? NOTA.ink : bc ? M.azul : M.roxo, color: texto.trim() ? "#fff" : M.muted, fontSize: 17, cursor: texto.trim() ? "pointer" : "default", fontFamily: "inherit", transition: "background .15s", flexShrink: 0 }}
                  >
                    {enviando ? "…" : bc ? <Icone n={modoNota ? "nota" : "enviar"} /> : modoNota ? "🗒️" : "➤"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- painel do contato (desktop): o ERP ao lado da conversa ---- */}
        {mostraThread && sel && painelAberto && !isMobile && (
          <div className={bc ? "bc-rolagem" : undefined} style={{ width: G.painel, flexShrink: 0, overflowY: "auto", background: M.surface, borderLeft: `1px solid ${M.border}` }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${M.border}`, background: M.roxoSoft, position: "sticky", top: 0, zIndex: 2 }}>
              <b style={{ fontSize: 12.5, color: M.wine }}>{ABAS.find((a) => a.k === abaAtual)?.rotulo}</b>
              <div style={{ fontSize: 10.5, color: M.gray, marginTop: 1 }}>
                {abaAtual === "perfil" ? "contato e cadastro" : "direto do WinThor"}
              </div>
            </div>
            <PainelContato
              c={contato}
              aba={abaAtual}
              fichaDe={fichaDe}
              vincular={vincularContato}
              ocupado={vinculando}
              extra={{ telefone: sel.telefone, carteira: sel.vendedor, linha: linha?.rotulo, status: sel.status }}
            />
          </div>
        )}

        {/* ---- D1 · o ERP no celular, em folha deslizante (0095) ----
            Hoje o painel inteiro é `!isMobile`: no celular atende-se sem
            NENHUM dado de compra, e é justamente a vantagem sobre o RD que
            some no aparelho que vai virar app (§29.2 item 3). A folha sobe
            sobre a conversa em vez de disputar largura com ela — não há 268px
            sobrando em 390. */}
        {/* ⚠️ `d1 || compacto`, e nao so `d1`. O botao "Cliente" renderiza
            quando `(!isMobile || compacto)`; o painel de desktop exige
            `!isMobile`. Logo, DENTRO DA LUPA (compacto, e isMobile porque o
            iframe tem 500px) com o layout `original`, o botao aparecia e nao
            tinha para onde abrir -- clique morto. Nao atinge ninguem hoje
            porque o layout em vigor e o D1, mas `original` e o caminho de
            ROLLBACK: aterrissar nele com um botao morto anula o proposito da
            chave. Achado pelo laudo do tema premium.

            No celular de verdade com `original` o botao nem renderiza, entao
            esta condicao conserta exatamente o caso quebrado e deixa o
            desenho antigo byte a byte como era. */}
        {(d1 || compacto) && isMobile && mostraThread && sel && painelAberto && (
          <>
            <div onClick={() => setPainelAberto(false)}
              style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(28,14,27,.38)" }} />
            <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 61, maxHeight: "82dvh",
              display: "flex", flexDirection: "column", background: M.surface,
              borderRadius: "16px 16px 0 0", boxShadow: "0 -10px 34px rgba(28,14,27,.28)",
              paddingBottom: "env(safe-area-inset-bottom)" }}>
              {/* alça: o alvo de "fechar" não pode ser só o ✕ de 12px */}
              <div onClick={() => setPainelAberto(false)}
                style={{ padding: "9px 0 5px", display: "flex", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                <span style={{ width: 38, height: 4, borderRadius: 999, background: M.border }} />
              </div>
              <div style={{ display: "flex", gap: 2, padding: "0 10px", borderBottom: `1px solid ${M.border}`,
                overflowX: "auto", flexShrink: 0 }}>
                {abasContato.map((a) => {
                  const on = abaAtual === a.k;
                  return (
                    <button key={a.k} onClick={() => setAbaContato(a.k)}
                      style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                        fontSize: 13, fontWeight: on ? 800 : 600, color: on ? M.roxo : M.gray,
                        padding: "9px 11px", minHeight: 44, borderBottom: `2px solid ${on ? M.roxo : "transparent"}`,
                        whiteSpace: "nowrap" }}>
                      {a.rotulo}
                    </button>
                  );
                })}
              </div>
              <div style={{ overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
                <PainelContato
                  c={contato}
                  aba={abaAtual}
              fichaDe={fichaDe}
                  vincular={vincularContato}
                  ocupado={vinculando}
                  extra={{ telefone: sel.telefone, carteira: sel.vendedor, linha: linha?.rotulo, status: sel.status }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* ---- D1 · barra inferior de filas no celular (0095) ----
          O título-dropdown é um alvo ruim para o polegar e esconde os
          contadores atrás de um clique. No celular as filas viram barra fixa
          embaixo, onde o polegar alcança — o padrão que qualquer app de
          mensagem usa. Só na LISTA: dentro da conversa o compositor manda no
          rodapé, e duas barras empilhadas comeriam a tela. */}
      {d1 && isMobile && mostraLista && (
        <div style={{ display: "flex", flexShrink: 0, background: M.surface, borderTop: `1px solid ${M.border}` }}>
          {([
            { k: "pendentes" as Fila, i: "🔔", r: "Esperando", n: contaPendentes },
            { k: "todas" as Fila, i: "💬", r: "Meus", n: noEscopo.filter((c) => (c.status ?? "aberta") !== "resolvida" && !c.na_fila).length },
            { k: "fila" as Fila, i: "🚶", r: "Sem dono", n: contaFila },
            { k: "resolvidas" as Fila, i: "✓", r: "Encerradas", n: contaResolvidas },
          ]).map((f) => {
            const on = filtro === f.k;
            return (
              <button key={f.k} onClick={() => setFiltro(f.k)}
                style={{ flex: 1, minWidth: 0, minHeight: 52, background: "transparent", border: "none",
                  borderTop: `2px solid ${on ? M.roxo : "transparent"}`, cursor: "pointer", fontFamily: "inherit",
                  padding: "5px 2px", color: on ? M.roxo : M.gray }}>
                <div style={{ fontSize: 15, lineHeight: 1.1, position: "relative", display: "inline-block" }}>
                  {f.i}
                  {f.n > 0 && (
                    <span style={{ position: "absolute", top: -4, right: -11, minWidth: 15, height: 15, padding: "0 3px",
                      boxSizing: "border-box", borderRadius: 999, background: f.k === "pendentes" ? M.laranja : M.azul,
                      color: "#fff", fontSize: 9.5, fontWeight: 800, display: "flex", alignItems: "center",
                      justifyContent: "center", fontVariantNumeric: "tabular-nums" }}>
                      {f.n > 99 ? "99+" : f.n}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 9.5, fontWeight: on ? 800 : 600, marginTop: 2, whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis" }}>{f.r}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* ---- ESCOLHER PARA QUEM ENCAMINHAR ------------------------------
          Camada por cima da tela, e nao um menu dentro da bolha: e uma
          escolha entre centenas de conversas, com busca. E o aviso do que a
          cliente do outro lado vai ver fica ANTES da lista -- e a unica
          diferenca entre isto e o "encaminhar" que a pessoa conhece. */}
      {encaminhando && (() => {
        const t = buscaEnc.trim().toLowerCase();
        const alvos = conversas
          .filter((c) => c.cliente_id !== encaminhando.cliente_id && !/^(winthor|venda):/.test(c.cliente_id))
          .filter((c) => !t || (c.cliente ?? "").toLowerCase().includes(t) || String(c.telefone ?? "").includes(t.replace(/\D/g, "") || " "))
          .slice(0, 60);
        const previa = (encaminhando.conteudo || rotuloMidia(encaminhando.midia_tipo ?? "")).slice(0, 140);
        return (
          <>
            <div onClick={() => setEncaminhando(null)}
              style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(28,14,27,.34)" }} />
            <div style={{ position: "fixed", zIndex: 401, top: "50%", left: "50%", transform: "translate(-50%,-50%)",
              width: "min(420px, 92vw)", maxHeight: "78vh", display: "flex", flexDirection: "column",
              background: M.surface, border: `1px solid ${M.border}`, borderRadius: 14,
              boxShadow: "0 22px 60px rgba(28,14,27,.30)", overflow: "hidden" }}>
              <div style={{ padding: "13px 16px", borderBottom: `1px solid ${M.border}` }}>
                <b style={{ fontSize: 14.5, color: M.wine }}>Encaminhar para</b>
                <div style={{ marginTop: 7, padding: "7px 10px", background: M.bg, borderRadius: 9,
                  fontSize: 12, color: M.gray, lineHeight: 1.45, maxHeight: 62, overflow: "hidden" }}>
                  {previa}
                </div>
                <div style={{ marginTop: 8, padding: "7px 10px", background: "#fff7e6", border: "1px solid #f3ddad",
                  borderRadius: 9, fontSize: 11.5, color: "#8a5a00", lineHeight: 1.45 }}>
                  A cliente recebe como uma mensagem normal — o WhatsApp não mostra
                  “Encaminhada”. Só funciona se a conversa de destino estiver dentro
                  das 24 h.
                </div>
                <input value={buscaEnc} onChange={(e) => setBuscaEnc(e.target.value)}
                  placeholder="Buscar contato…" autoFocus
                  style={{ width: "100%", boxSizing: "border-box", marginTop: 9, padding: "8px 11px",
                    fontSize: 13, fontFamily: "inherit", color: M.ink, background: M.bg,
                    border: `1px solid ${M.border}`, borderRadius: 9, outline: "none" }} />
              </div>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {!alvos.length && (
                  <div style={{ padding: 16, fontSize: 12.5, color: M.muted }}>Nenhuma conversa encontrada.</div>
                )}
                {alvos.map((c) => (
                  <button key={c.cliente_id} disabled={enviando}
                    onClick={() => void encaminhar(encaminhando, c.cliente_id, c.cliente)}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                      padding: "10px 16px", fontSize: 13, color: M.ink, background: "transparent",
                      border: "none", borderBottom: `1px solid ${M.bg}`, cursor: enviando ? "wait" : "pointer",
                      fontFamily: "inherit" }}>
                    <span style={{ width: 30, height: 30, borderRadius: 30, background: M.wine, color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                      fontWeight: 800, flexShrink: 0 }}>
                      {(c.cliente ?? "?").trim().charAt(0).toUpperCase()}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden",
                        textOverflow: "ellipsis" }}>{nomeComCodigo(c.cliente, c.codcli)}</span>
                      <span style={{ display: "block", fontSize: 11, color: M.muted }}>{c.telefone ?? "sem telefone"}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ padding: "10px 16px", borderTop: `1px solid ${M.border}`, textAlign: "right" }}>
                <button onClick={() => setEncaminhando(null)}
                  style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", color: M.gray,
                    background: "transparent", border: `1px solid ${M.border}`, borderRadius: 9,
                    padding: "6px 14px", cursor: "pointer" }}>
                  Cancelar
                </button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
