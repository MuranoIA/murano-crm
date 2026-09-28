"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { JanelaVirtual } from "../../../lib/virtualizacao";
import { ItemConversa } from "./ItemConversa";
import { Filtros, type Recortes } from "./Filtros";
import { COLUNAS, COR_ETAPA, LETRA_ETAPA, TITULO_ETAPA, type EtapaBoard } from "../../../lib/etapasBoard";
import { ListaCarteira } from "./Carteira";
import { FILAS, type Conversa, type Fila, type ItemCarteira } from "./tipos";

// A coluna da esquerda: busca, recortes e a lista.
//
// Duas decisões que vêm da fase 0 e do laudo de UX:
//  · os CONTADORES ficam sempre visíveis, em chips. No chat antigo o número de
//    não lidas só existe depois de abrir um dropdown (achado 1) — é a primeira
//    pergunta do dia, paga dezenas de vezes por dia, por sete pessoas;
//  · a lista é VIRTUALIZADA. Uma aba aberta chegou a acumular 43.788 nós de DOM
//    e travar o notebook da equipe (nota do lib/virtualizacao.tsx).

export function ListaConversas({
  conversas,
  selecionada,
  fila,
  busca,
  carregando,
  completa,
  contagens,
  aoAbrir,
  aoTrocarFila,
  aoBuscar,
  aoChegarNoFim,
  presentes,
  recortes,
  aoMudarRecortes,
  filtrosAbertos,
  aoAbrirFiltros,
  consultores,
  linhas,
  contaPorConsultor,
  contaPorLinha,
  contaPorEtapa,
  carteira,
  comConversa,
  aoAbrirDaCarteira,
  aoNovoContato,
  antigasPrimeiro,
  aoInverterOrdem,
}: {
  conversas: Conversa[];
  selecionada: string | null;
  fila: Fila;
  busca: string;
  carregando: boolean;
  completa: boolean;
  /** null = ainda não chegou do servidor. Chip sem número, nunca zero. */
  contagens: Record<Fila, number | null>;
  aoAbrir: (id: string) => void;
  aoTrocarFila: (f: Fila) => void;
  aoBuscar: (t: string) => void;
  aoChegarNoFim: () => void;
  /** cliente_id -> rótulos de OUTRAS pessoas com a conversa aberta agora */
  presentes: Record<string, string[]>;
  recortes: Recortes;
  aoMudarRecortes: (r: Recortes) => void;
  filtrosAbertos: boolean;
  aoAbrirFiltros: () => void;
  consultores: { endereco: string; nome: string; cor: string | null }[];
  linhas: { id: string; rotulo: string; numero: string | null }[];
  contaPorConsultor: Map<string, number>;
  contaPorLinha: Map<string, number>;
  contaPorEtapa: Map<string, number>;
  /** a agenda (§38); null = ainda não chegou */
  carteira: ItemCarteira[] | null;
  /** null = a lista inteira ainda não veio: não dá para afirmar "sem conversa" */
  comConversa: Set<string> | null;
  aoAbrirDaCarteira: (k: ItemCarteira) => void;
  aoNovoContato: () => void;
  antigasPrimeiro: boolean;
  aoInverterOrdem: () => void;
}) {
  const raiz = useRef<HTMLDivElement>(null);

  // ---- busca NO CONTEÚDO das mensagens ------------------------------------
  // A busca por nome e telefone é local e instantânea (a lista já está aqui).
  // Esta é outra pergunta — "onde foi que eu falei sobre isso?" — e vai ao
  // servidor, que usa trigrama (§18/0081). Mínimo de 3 letras porque abaixo
  // disso o índice não é usado; debounce de 400 ms para não disparar por tecla.
  const [achados, setAchados] = useState<{ conversas: any[]; truncado: boolean } | null>(null);
  const [procurando, setProcurando] = useState(false);

  useEffect(() => {
    const t = busca.trim();
    // na agenda a busca é por nome/telefone/código, local: procurar no
    // conteúdo das mensagens responderia outra pergunta
    if (t.length < 3 || fila === "carteira") {
      setAchados(null);
      return;
    }
    let vivo = true;
    const atraso = setTimeout(() => {
      setProcurando(true);
      fetch(`/api/chat/buscar?q=${encodeURIComponent(t)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => vivo && setAchados({ conversas: j.conversas ?? [], truncado: !!j.truncado }))
        .catch(() => vivo && setAchados(null))
        .finally(() => vivo && setProcurando(false));
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(atraso);
    };
  }, [busca, fila]);

  // rolou até perto do fim da primeira página: é hora de buscar o resto
  const aoRolar = () => {
    const el = raiz.current;
    if (!el || completa || carregando || fila === "carteira") return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) aoChegarNoFim();
  };

  const chave = useMemo(() => (c: Conversa) => c.cliente_id, []);

  // o painel de Filtros guarda dois recortes; a coluna do board saiu para a
  // faixa do cabeçalho (27/09) e por isso não entra neste contador
  const recortesNoPainel = (recortes.vendedor ? 1 : 0) + (recortes.linha ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-v2-superficie">
      {/* ---- cabeçalho ---------------------------------------------------
          A ORDEM É PEDIDO DO TIME (27/09/2026, print do chat antigo): fila +
          três atalhos · quatro mini-cards · busca · colunas do board · ordem.
          O time usou o v2 e sentiu falta de ver as quatro filas de uma vez —
          que era o achado 1 do laudo de UX, perdido quando os chips viraram um
          menu só (22/09). O menu FICA: ele é quem diz o que está aberto e
          guarda favoritas; os mini-cards são o atalho para as quatro de sempre.
          "Ativar avisos" NÃO entra: no v2 o aviso mora no sino da conversa. */}
      <div className="shrink-0 border-b border-v2-linha px-3 pb-2 pt-3">
        <div className="flex items-center gap-1">
          <MenuFilas fila={fila} contagens={contagens} aoTrocar={aoTrocarFila} />
          <span className="min-w-0 flex-1" />
          {ATALHOS.map((a) => (
            <AtalhoFila
              key={a.id}
              atalho={a}
              ativo={fila === a.id}
              n={contagens[a.id]}
              aoTrocar={aoTrocarFila}
            />
          ))}
        </div>

        {/* Os quatro de todo dia, com o número à vista. Zero fica esmaecido —
            e enquanto o servidor não contou, o cartão fica SEM número, nunca
            com zero: "0 esperando" e "ainda não sei" são coisas diferentes. */}
        <div className="mt-2 grid grid-cols-4 gap-1">
          {CARTOES.map((c) => (
            <MiniCard
              key={c.id}
              cartao={c}
              ativo={fila === c.id}
              n={contagens[c.id]}
              aoTrocar={aoTrocarFila}
            />
          ))}
        </div>

        <div className="mt-2 flex items-center gap-2">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Buscar conversa</span>
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-v2-tinta-fraca"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            value={busca}
            onChange={(e) => aoBuscar(e.target.value)}
            placeholder={fila === "carteira" ? "Buscar na carteira" : "Buscar por nome ou telefone"}
            className="h-11 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie pl-10 pr-3 text-[15px] placeholder:text-v2-tinta-fraca focus:border-v2-azul focus:outline-none"
            style={{ transition: "border-color 120ms var(--ease-padrao)" }}
          />
        </label>
        {/* NOVO CONTATO (§35.2): sem isto não há como falar com um número que
            ainda não está na base */}
        <button
          data-ripple
          onClick={aoNovoContato}
          aria-label="Novo contato"
          title="Novo contato — conversar com um número"
          className="grid size-11 shrink-0 place-items-center rounded-xl text-v2-azul ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-azul-claro"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        </div>

        {/* A FILA num botão só, que abre as opções — pedido do piloto
            (22/09/2026): sete chips ocupavam três linhas da coluna. O botão
            não tem nome fixo: ele MOSTRA a fila escolhida e o contador dela,
            que é a pergunta de quem olha ("o que estou vendo?").

            ⚠️ O que isso custa: os contadores das OUTRAS filas deixam de ficar
            sempre à vista, que era o achado 1 do laudo de UX. O que pede ação
            não pode sumir, então o botão ganha um PONTO LARANJA quando há não
            lidas ou recados numa fila que não está aberta. */}
        {/* AS COLUNAS DO BOARD, fora do painel de filtros (pedido do time):
            são a leitura de relance de "onde estão minhas conversas". Quadrados
            de canto pequeno, como o print — a pílula redonda as fazia parecer
            mais um filtro solto.

            ⚠️ Estando aqui, elas SAEM do painel de Filtros: dois controles para
            a mesma escolha acabam se contradizendo (§32, §68.2). */}
        {fila !== "carteira" && (
          <div className="-mx-3 mt-2 flex flex-wrap gap-1 px-3">
            {COLUNAS.map((c) => {
              const k = c.key as EtapaBoard;
              const ativo = recortes.etapa === k;
              const n = completa ? contaPorEtapa.get(c.key) ?? 0 : null;
              return (
                <button
                  key={c.key}
                  data-ripple
                  onClick={() => aoMudarRecortes({ ...recortes, etapa: ativo ? null : k })}
                  aria-pressed={ativo}
                  title={TITULO_ETAPA[k]}
                  className={[
                    "flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] transition-colors duration-150",
                    ativo
                      ? "bg-v2-azul-claro ring-1 ring-inset ring-v2-azul"
                      : "ring-1 ring-inset ring-v2-linha hover:bg-v2-superficie-2",
                  ].join(" ")}
                >
                  {/* A LETRA, não o nome (como no chat de hoje e no print): sete
                      nomes ocupavam TRÊS linhas da coluna de 320 px — medido em
                      27/09 —, e a faixa existe justamente para ser lida de
                      relance. O nome inteiro está no `title` e na coluna do
                      board, que é de onde a letra vem. */}
                  <span aria-hidden className="font-bold" style={{ color: COR_ETAPA[k] }}>
                    {LETRA_ETAPA[k]}
                  </span>
                  <span className="sr-only">{TITULO_ETAPA[k]}</span>
                  {n != null && n > 0 && <span className="tabular-nums text-v2-tinta-fraca">{n}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* UMA LINHA (pedido do piloto): Filtros e a ordenação não encolhem,
            porque ícone sem rótulo ali seria adivinhação. */}
        <div className="-mx-3 mt-2 flex flex-nowrap items-center gap-1 px-3 pb-1">
          {/* Os RECORTES (consultor e número) — ocasionais,
              e por isso atrás de um botão desde o início. Esconder o recorte
              não esconde contador nenhum: ele nasce sem filtro. */}
          <button
            data-ripple
            onClick={aoAbrirFiltros}
            aria-pressed={filtrosAbertos}
            aria-expanded={filtrosAbertos}
            title="Filtrar por consultor ou número"
            className={[
              "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors duration-150",
              filtrosAbertos || recortesNoPainel > 0
                ? "bg-v2-azul text-white"
                : "text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie-2",
            ].join(" ")}
          >
            <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Filtros
            {/* ⚠️ conta só o que o PAINEL controla. A coluna do board mora na
                faixa acima desde 27/09: contá-la aqui faria o botão anunciar um
                filtro que não está dentro dele. */}
            {recortesNoPainel > 0 && (
              <span className="min-w-4 rounded-full bg-white/20 px-1 text-[11px] tabular-nums">
                {recortesNoPainel}
              </span>
            )}
          </button>

          {/* ordenação (lacuna 11). Na agenda não vale: ela é alfabética. */}
          {fila !== "carteira" && (
            <button
              data-ripple
              onClick={aoInverterOrdem}
              aria-pressed={antigasPrimeiro}
              title={antigasPrimeiro ? "Mostrando as mais antigas primeiro" : "Mostrando as mais recentes primeiro"}
              className={[
                "flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] transition-colors duration-150",
                antigasPrimeiro
                  ? "bg-v2-azul text-white"
                  : "text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie-2",
              ].join(" ")}
            >
              {antigasPrimeiro ? "↑ Antigas" : "↓ Recentes"}
            </button>
          )}
        </div>
      </div>

      <Filtros
        aberto={filtrosAbertos}
        recortes={recortes}
        aoMudar={aoMudarRecortes}
        consultores={consultores}
        linhas={linhas}
        contaPorConsultor={contaPorConsultor}
        contaPorLinha={contaPorLinha}
        contaPorEtapa={contaPorEtapa}
        carregando={!completa}
      />

      {/* ---- a lista ------------------------------------------------------ */}
      <div ref={raiz} onScroll={aoRolar} className="rolagem min-h-0 flex-1 overflow-y-auto">
        {fila === "carteira" ? (
          <ListaCarteira
            carteira={carteira}
            busca={busca}
            selecionada={selecionada}
            comConversa={comConversa}
            aoAbrir={aoAbrirDaCarteira}
            raizRef={raiz}
          />
        ) : conversas.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-v2-tinta-fraca">
            {carregando
              ? "Carregando o resto das conversas…"
              : busca
                ? "Nenhuma conversa com esse nome ou telefone."
                : "Nenhuma conversa neste recorte."}
          </p>
        ) : (
          <JanelaVirtual
            itens={conversas}
            chave={chave}
            raizRef={raiz}
            alturaEstimada={72}
            ativo={conversas.length > 40}
            renderItem={(c) => (
              <ItemConversa
                c={c}
                selecionada={c.cliente_id === selecionada}
                aoAbrir={aoAbrir}
                presentes={presentes[c.cliente_id]}
              />
            )}
          />
        )}

        {/* ---- o que a busca achou DENTRO das mensagens ------------------ */}
        {busca.trim().length >= 3 && fila !== "carteira" && (
          <div className="border-t border-v2-linha bg-v2-superficie-2">
            <p className="flex items-center gap-2 px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">
              nas mensagens
              {procurando && <span className="font-normal normal-case">procurando…</span>}
              {achados?.truncado && (
                <span className="font-normal normal-case text-v2-laranja">muitos resultados — refine a busca</span>
              )}
            </p>
            {achados && achados.conversas.length === 0 && !procurando && (
              <p className="px-3 pb-3 text-[13px] text-v2-tinta-fraca">Nada encontrado no conteúdo das conversas.</p>
            )}
            {(achados?.conversas ?? []).map((c: any) => (
              <button
                key={`busca-${c.cliente_id}`}
                data-ripple
                onClick={() => aoAbrir(c.cliente_id)}
                className="block w-full px-3 py-2 text-left hover:bg-v2-superficie"
              >
                <span className="block truncate text-[13.5px] font-medium">{c.cliente}</span>
                <span className="mt-0.5 block truncate text-[12.5px] text-v2-tinta-fraca">
                  {c.trecho ?? c.ultima_mensagem}
                </span>
              </button>
            ))}
          </div>
        )}

        {carregando && conversas.length > 0 && fila !== "carteira" && (
          <p className="px-4 py-3 text-center text-[12px] text-v2-tinta-fraca">
            carregando o resto da lista…
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OS TRÊS ATALHOS ao lado da fila, e os QUATRO MINI-CARDS abaixo dela.
//
// Pedido do time em 27/09/2026, copiando o chat de hoje: as filas de todo dia
// têm de estar À VISTA, não dentro de um menu. Os dois grupos apontam para as
// MESMAS filas do menu — não são um segundo estado, só outro caminho para o
// mesmo `aoTrocarFila` (a régua do §68.2: uma escolha, vários controles que
// escrevem nela).
//
// "Sem dono" e o atalho da fila de espera são a mesma fila, como no print. É
// repetição de propósito: o ícone é o gesto rápido, o cartão é o número.
// ---------------------------------------------------------------------------
type Atalho = { id: Fila; rotulo: string; icone: React.ReactNode };

const ICONE = (d: string, extra?: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
    {extra}
  </svg>
);

const ATALHOS: Atalho[] = [
  // bandeja: o que chegou e ainda não tem dono
  { id: "fila", rotulo: "Fila de espera", icone: ICONE("M4 13h4l2 3h4l2-3h4M4 13 6 5h12l2 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z") },
  // papel dobrado: a nota interna da supervisão
  { id: "recados", rotulo: "Recados da supervisão", icone: ICONE("M5 4h14v11l-5 5H5V4ZM19 15h-5v5") },
  // agenda: todos os clientes do RCA, com ou sem conversa
  { id: "carteira", rotulo: "Minha carteira", icone: ICONE("M7 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7V4ZM4 8h3M4 12h3M4 16h3") },
];

function AtalhoFila({
  atalho, ativo, n, aoTrocar,
}: {
  atalho: Atalho;
  ativo: boolean;
  n: number | null;
  aoTrocar: (f: Fila) => void;
}) {
  return (
    <button
      data-ripple
      onClick={() => aoTrocar(atalho.id)}
      aria-pressed={ativo}
      aria-label={atalho.rotulo}
      title={n != null && n > 0 ? `${atalho.rotulo} — ${n}` : atalho.rotulo}
      className={[
        "relative grid size-9 shrink-0 place-items-center rounded-lg transition-colors duration-150",
        ativo ? "bg-v2-azul-claro text-v2-azul ring-1 ring-inset ring-v2-azul" : "text-v2-tinta-fraca hover:bg-v2-superficie-2",
      ].join(" ")}
    >
      {atalho.icone}
      {/* o número só aparece quando pede ação — recado por ver, conversa sem
          dono. Contador em tudo vira decoração e some da vista. */}
      {n != null && n > 0 && (atalho.id === "recados" || atalho.id === "fila") && (
        <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-v2-laranja px-1 text-center text-[10.5px] font-semibold leading-[18px] text-white ring-2 ring-v2-superficie">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </button>
  );
}

type Cartao = { id: Fila; rotulo: string; destaque?: boolean };

const CARTOES: Cartao[] = [
  // "Esperando" é a cliente que falou e ainda não teve resposta — no v2 essa é
  // a conta de não lidas, que já exclui encerradas e fila (§lista.contarFilas)
  { id: "nao_lidas", rotulo: "Esperando", destaque: true },
  { id: "todas", rotulo: "Meus" },
  { id: "fila", rotulo: "Sem dono" },
  { id: "resolvidas", rotulo: "Encerradas" },
];

function MiniCard({
  cartao, ativo, n, aoTrocar,
}: {
  cartao: Cartao;
  ativo: boolean;
  n: number | null;
  aoTrocar: (f: Fila) => void;
}) {
  const vazio = n === 0;
  return (
    <button
      data-ripple
      onClick={() => aoTrocar(cartao.id)}
      aria-pressed={ativo}
      title={`${cartao.rotulo}${n != null ? ` — ${n}` : ""}`}
      className={[
        "rounded-lg px-1 py-1.5 text-center transition-colors duration-150",
        ativo
          ? "bg-v2-azul-claro ring-1 ring-inset ring-v2-azul"
          : "ring-1 ring-inset ring-v2-linha hover:bg-v2-superficie-2",
      ].join(" ")}
    >
      <span
        className={[
          "block text-[17px] font-bold leading-5 tabular-nums",
          vazio ? "text-v2-tinta-fraca" : cartao.destaque ? "text-v2-laranja" : ativo ? "text-v2-azul" : "text-v2-tinta",
        ].join(" ")}
      >
        {/* sem número ainda: um traço, nunca um zero que mente */}
        {n == null ? "—" : n}
      </span>
      <span className="block truncate text-[10.5px] leading-3 text-v2-tinta-fraca">{cartao.rotulo}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// O botão das filas e o menu dele.
//
// O menu é FIXO na tela, posicionado pelo botão na hora do clique: dentro da
// fileira de chips (que rola na horizontal no celular) um menu absoluto seria
// cortado — foi o que aconteceu com o "⋯" da conversa a 360 px.
// ---------------------------------------------------------------------------
function MenuFilas({
  fila,
  contagens,
  aoTrocar,
}: {
  fila: Fila;
  contagens: Record<Fila, number | null>;
  aoTrocar: (f: Fila) => void;
}) {
  const [pos, setPos] = useState<null | { top: number; left: number; largura: number }>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const atual = FILAS.find((f) => f.id === fila) ?? FILAS[0];
  const n = contagens[fila];

  // Esc fecha, como qualquer menu
  useEffect(() => {
    if (!pos) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [pos]);

  // o que pede ação e está FORA da fila aberta — é o que o ponto avisa
  const pendente = (["nao_lidas", "recados"] as Fila[]).filter((f) => f !== fila && (contagens[f] ?? 0) > 0);
  const dica = pendente
    .map((f) => `${contagens[f]} em ${FILAS.find((x) => x.id === f)?.rotulo}`)
    .join(" · ");

  return (
    <>
      <button
        ref={botao}
        data-ripple
        aria-haspopup="menu"
        aria-expanded={!!pos}
        title={dica ? `Fila: ${atual.rotulo} — ${dica}` : `Fila: ${atual.rotulo}`}
        onClick={() => {
          if (pos) return setPos(null);
          const r = botao.current?.getBoundingClientRect();
          if (!r) return;
          const largura = Math.min(280, window.innerWidth - 24);
          setPos({ top: r.bottom + 4, left: Math.max(12, Math.min(r.left, window.innerWidth - largura - 12)), largura });
        }}
        className="relative flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-v2-azul pl-3 pr-2 text-[13px] text-white"
      >
        <span className="min-w-0 truncate">{atual.rotulo}</span>
        {n != null && n > 0 && <span className="min-w-4 rounded-full bg-white/20 px-1 text-[11px] tabular-nums">{n}</span>}
        <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7 10 5 5 5-5" />
        </svg>
        {pendente.length > 0 && (
          <span aria-label={dica} className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-v2-laranja ring-2 ring-v2-superficie" />
        )}
      </button>

      {pos && (
        <>
          <span className="fixed inset-0 z-30" onClick={() => setPos(null)} aria-hidden />
          <div
            role="menu"
            style={{ top: pos.top, left: pos.left, width: pos.largura }}
            className="entrar fixed z-40 max-h-[70vh] overflow-y-auto rounded-2xl bg-v2-superficie py-1 shadow-e3 ring-1 ring-v2-linha"
          >
            {FILAS.map((f) => {
              const ativo = f.id === fila;
              const c = contagens[f.id];
              const pede = (f.id === "nao_lidas" || f.id === "recados") && (c ?? 0) > 0;
              return (
                <button
                  key={f.id}
                  data-ripple
                  role="menuitemradio"
                  aria-checked={ativo}
                  onClick={() => {
                    setPos(null);
                    aoTrocar(f.id);
                  }}
                  className={[
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px]",
                    ativo ? "bg-v2-azul-claro font-semibold text-v2-azul" : "text-v2-tinta hover:bg-v2-superficie-2",
                  ].join(" ")}
                >
                  <span className="flex-1">{f.rotulo}</span>
                  {/* sem número (carteira, ou ainda contando) = nada, nunca zero */}
                  {c != null && c > 0 && (
                    <span
                      className={[
                        "min-w-5 rounded-full px-1.5 text-center text-[12px] tabular-nums",
                        pede && !ativo ? "bg-v2-laranja text-white" : "bg-v2-superficie-2 text-v2-tinta-fraca",
                      ].join(" ")}
                    >
                      {c}
                    </span>
                  )}
                  {ativo && (
                    <svg aria-hidden viewBox="0 0 24 24" className="size-4 text-v2-azul" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
