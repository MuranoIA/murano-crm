"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { JanelaVirtual } from "../../../lib/virtualizacao";
import { ItemConversa } from "./ItemConversa";
import { COLUNAS, COR_ETAPA, LETRA_ETAPA, TITULO_ETAPA, type EtapaBoard } from "../../../lib/etapasBoard";
import { ListaCarteira } from "./Carteira";
import { FILAS, type Conversa, type Fila, type ItemCarteira, type Recortes } from "./tipos";

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
  recadosNovos,
  ocultos,
  aoMostrarMais,
  aoAbrir,
  aoTrocarFila,
  aoBuscar,
  aoChegarNoFim,
  presentes,
  recortes,
  aoMudarRecortes,
  aoAbrirFiltros,
  consultores,
  linhas,
  contaPorConsultor,
  totalConsultores,
  contaPorLinha,
  contaPorEtapa,
  carteira,
  comConversa,
  aoAbrirDaCarteira,
  aoNovoContato,
  antigasPrimeiro,
  aoInverterOrdem,
  soDivida,
  resumoDivida,
  carregandoDivida,
  aoAlternarDivida,
}: {
  conversas: Conversa[];
  selecionada: string | null;
  fila: Fila;
  busca: string;
  carregando: boolean;
  completa: boolean;
  /** null = ainda não chegou do servidor. Chip sem número, nunca zero. */
  contagens: Record<Fila, number | null>;
  /** ⚠️ O ALERTA de recado NÃO é o tamanho da fila (#41): a fila mostra toda
   *  conversa com nota, inclusive as minhas; o alerta conta só o que pede
   *  ação — nota de outra pessoa que eu ainda não vi. */
  recadosNovos: number | null;
  /** quantas conversas de recado ficaram fora do lote mostrado */
  ocultos: number;
  aoMostrarMais: () => void;
  aoAbrir: (id: string) => void;
  aoTrocarFila: (f: Fila) => void;
  aoBuscar: (t: string) => void;
  aoChegarNoFim: () => void;
  /** cliente_id -> rótulos de OUTRAS pessoas com a conversa aberta agora */
  presentes: Record<string, string[]>;
  recortes: Recortes;
  aoMudarRecortes: (r: Recortes) => void;
  /** pedir ao servidor os recortes caros (a lista inteira) - chamado
   *  quando um seletor de recorte abre */
  aoAbrirFiltros: () => void;
  consultores: { endereco: string; nome: string; cor: string | null }[];
  linhas: { id: string; rotulo: string; numero: string | null }[];
  // `null` = ainda não sei. Os números vêm do CUBO do servidor (~15 kB) quando
  // a lista inteira não está em memória, e dela quando está — ver `contagens.ts`.
  // Nunca zero no lugar de "não sei": zero é uma afirmação.
  contaPorConsultor: Map<string, number> | null;
  /** o total sem o recorte de consultor (a opção "Todos") */
  totalConsultores: number | null;
  contaPorLinha: Map<string, number> | null;
  contaPorEtapa: Map<string, number> | null;
  /** a agenda (§38); null = ainda não chegou */
  carteira: ItemCarteira[] | null;
  /** null = a lista inteira ainda não veio: não dá para afirmar "sem conversa" */
  comConversa: Set<string> | null;
  aoAbrirDaCarteira: (k: ItemCarteira) => void;
  aoNovoContato: () => void;
  /** chip "com dívida" (#64) — o estado mora na Casca, que tem o conjunto */
  soDivida?: boolean;
  resumoDivida?: { clientes: number; vencidas: number; total_vencido: number } | null;
  carregandoDivida?: boolean;
  aoAlternarDivida?: () => void;
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

  // De quem é cada conversa, para a etiqueta na linha. `consultores` só vem
  // preenchido para quem enxerga todas as carteiras (admin, home, pós-venda e
  // supervisão) — para o vendedor ele é vazio, e a etiqueta não aparece, porque
  // repetir o próprio nome em 900 linhas não informa nada.
  const porConsultor = useMemo(
    () => new Map(consultores.map((c) => [c.endereco, { nome: c.nome, cor: c.cor }])),
    [consultores],
  );

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
      {/* ⚠️ 10% DE PÚRPURA NO FUNDO (28/09/2026, pedido do dono). É isto que
          faz os controles brancos se destacarem: com o fundo branco de antes,
          branco sobre branco não tinha degrau nenhum, e a sombra sozinha não
          dava conta. O contraste vem da CAMADA, não de mudar a paleta. */}
      <div
        className="shrink-0 border-b border-v2-linha px-3 pb-2.5 pt-3"
        style={{ background: "color-mix(in srgb, var(--color-v2-vinho) 10%, #fff)" }}
      >
        <div className="flex items-center gap-1.5">
          <MenuFilas fila={fila} contagens={contagens} recadosNovos={recadosNovos} aoTrocar={aoTrocarFila} />
          <span className="min-w-0 flex-1" />
          {ATALHOS.map((a) => (
            <AtalhoFila
              key={a.id}
              atalho={a}
              ativo={fila === a.id}
              // o atalho mostra o que PEDE AÇÃO, não o tamanho da fila
              n={a.id === "recados" ? recadosNovos : contagens[a.id]}
              aoTrocar={aoTrocarFila}
            />
          ))}
        </div>

        {/* Os quatro de todo dia, com o número à vista. Zero fica esmaecido —
            e enquanto o servidor não contou, o cartão fica SEM número, nunca
            com zero: "0 esperando" e "ainda não sei" são coisas diferentes. */}
        <div className="mt-1.5 grid grid-cols-4 gap-1">
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

        <div className="mt-1.5 flex items-center gap-2">
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
            className="h-10 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie pl-10 pr-3 text-[15px] shadow-e1 placeholder:text-v2-tinta-fraca focus:border-v2-azul focus:outline-none"
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
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-v2-superficie text-v2-azul shadow-e1 ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-azul-claro"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        {/* COM DÍVIDA (#64) — era uma faixa de largura inteira e virou quadrado
            (pedido do dono, 03/10): a faixa custava ~48 px de LISTA, e o que ela
            dizia cabe num ícone com contador. O número fica no `title` e, quando
            há alguém, num ponto no canto — sem contador o botão vira enfeite. */}
        {fila !== "carteira" && aoAlternarDivida && (
          <button
            data-ripple
            type="button"
            onClick={aoAlternarDivida}
            aria-pressed={!!soDivida}
            aria-label="Com dívida"
            title={
              (soDivida ? "Mostrando só quem tem boleto em aberto" : "Mostrar só quem tem boleto em aberto") +
              (resumoDivida ? ` — ${resumoDivida.clientes} cliente${resumoDivida.clientes === 1 ? "" : "s"}` : "")
            }
            className={[
              "relative grid size-10 shrink-0 place-items-center rounded-xl shadow-e1 transition-colors duration-150",
              soDivida
                ? "bg-v2-erro/[0.1] text-v2-erro ring-2 ring-inset ring-v2-erro"
                : "bg-v2-superficie text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie-2",
            ].join(" ")}
          >
            {/* nota de dinheiro: diz "cobrança" sem precisar de rótulo */}
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="6" width="19" height="12" rx="2" />
              <circle cx="12" cy="12" r="2.6" />
              <path d="M6 9.5v5M18 9.5v5" />
            </svg>
            {carregandoDivida ? (
              <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-v2-tinta-fraca" />
            ) : resumoDivida && resumoDivida.clientes > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 min-w-[15px] rounded-full bg-v2-erro px-1 text-[9.5px] font-bold leading-[15px] text-white">
                {resumoDivida.clientes > 99 ? "99+" : resumoDivida.clientes}
              </span>
            ) : null}
          </button>
        )}
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
          // UMA BARRA SEGMENTADA que ocupa a largura inteira (28/09, pedido do
          // dono): sete quadradinhos soltos deixavam um vão à direita e pareciam
          // sete botões avulsos. Grade de sete colunas iguais, dentro de um
          // trilho — o segmento aceso é preenchido, como numa régua de etapas.
          <div className="mt-1.5 grid grid-cols-7 gap-1">
            {COLUNAS.map((c) => {
              const k = c.key as EtapaBoard;
              const ativo = recortes.etapa === k;
              const n = contaPorEtapa ? contaPorEtapa.get(c.key) ?? 0 : null;
              return (
                <button
                  key={c.key}
                  data-ripple
                  onClick={() => aoMudarRecortes({ ...recortes, etapa: ativo ? null : k })}
                  aria-pressed={ativo}
                  title={n != null ? `${TITULO_ETAPA[k]} — ${n}` : TITULO_ETAPA[k]}
                  className={[
                    // cada uma com o PRÓPRIO contorno e um degrau de sombra
                    // (28/09, pedido do dono): dentro de um trilho só, liam
                    // como régua e se misturavam ao fundo
                    "flex h-8 min-w-0 flex-col items-center justify-center rounded-lg leading-none shadow-e1 ring-1 ring-inset transition-colors duration-150",
                    ativo
                      ? "bg-v2-vinho-claro ring-v2-vinho"
                      : "bg-v2-superficie ring-v2-linha-forte hover:bg-v2-vinho-claro",
                  ].join(" ")}
                >
                  {/* A LETRA, não o nome (como no chat de hoje e no print): sete
                      nomes ocupavam TRÊS linhas da coluna de 320 px — medido em
                      27/09 —, e a faixa existe justamente para ser lida de
                      relance. O nome inteiro está no `title` e na coluna do
                      board, que é de onde a letra vem. */}
                  <span
                    aria-hidden
                    className="text-[12px] font-bold"
                    style={{ color: COR_ETAPA[k] }}
                  >
                    {LETRA_ETAPA[k]}
                  </span>
                  <span className="sr-only">{TITULO_ETAPA[k]}</span>
                  {n != null && (
                    <span className="mt-0.5 text-[10px] tabular-nums text-v2-tinta-fraca">
                      {n > 999 ? `${Math.round(n / 100) / 10}k` : n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* O CONSULTOR vira um seletor com a LISTA, não um painel de chips
            (28/09/2026, pedido do dono, com o print do board como referência):
            "Filtros" não dizia o que se está vendo, e o painel aberto empurrava
            a lista para baixo. O seletor mostra a escolha no próprio rótulo —
            "Todos os consultores" ou o nome de quem está filtrado.

            ⚠️ Abrir o seletor é o gesto que manda buscar a lista inteira (os
            contadores por consultor só existem com ela), o mesmo papel que o
            painel tinha. Quem não filtra continua não pagando por isso. */}
        <div className="-mx-3 mt-2 flex flex-nowrap items-center gap-1.5 px-3 pb-1">
          {consultores.length > 0 && (
            <MenuRecorte
              rotuloVazio="Todos os consultores"
              opcoes={consultores.map((c) => ({
                valor: c.endereco,
                rotulo: c.nome,
                cor: c.cor,
                n: contaPorConsultor ? contaPorConsultor.get(c.endereco) ?? 0 : null,
              }))}
              valor={recortes.vendedor}
              // "Todos os consultores" conta IGNORANDO o próprio consultor
              // escolhido — senão a opção que desliga o filtro mostraria o
              // número do filtro ligado. `conversas.length` não serve aqui: é o
              // que está na tela DEPOIS de filtrar.
              total={totalConsultores ?? (completa ? conversas.length : null)}
              aoEscolher={(v) => aoMudarRecortes({ ...recortes, vendedor: v })}
              aoAbrir={aoAbrirFiltros}
            />
          )}

          {/* o número só aparece quando há mais de um: com um só não há o que
              separar, e desenhar o seletor seria oferecer escolha que não existe */}
          {linhas.length > 1 && (
            <MenuRecorte
              rotuloVazio="Todos os números"
              opcoes={linhas.map((l) => ({
                valor: l.id,
                rotulo: l.rotulo,
                cor: null,
                n: contaPorLinha ? contaPorLinha.get(l.id) ?? 0 : null,
              }))}
              valor={recortes.linha}
              total={completa ? conversas.length : null}
              aoEscolher={(v) => aoMudarRecortes({ ...recortes, linha: v })}
              aoAbrir={aoAbrirFiltros}
            />
          )}


          {/* ORDENAÇÃO — TEXTO, não botão (03/10, decisão do dono).
              O achado dele: na visão do CONSULTOR o seletor de consultores não
              existe (ele só tem uma carteira), então esta faixa ficava com um
              botão só e cobrava uma linha inteira de lista por ele.
              Virar quadrado na linha da busca resolveria a altura e apertaria o
              campo de busca; texto pequeno resolve as duas coisas — a faixa
              encolhe de 40 px para ~20 e o campo não perde nada.
              Na agenda não vale: ela é alfabética. */}
          {fila !== "carteira" && (
            <button
              type="button"
              onClick={aoInverterOrdem}
              aria-pressed={antigasPrimeiro}
              title={antigasPrimeiro ? "Mostrando as mais antigas primeiro" : "Mostrando as mais recentes primeiro"}
              className={[
                "ml-auto shrink-0 whitespace-nowrap rounded px-1 text-[11.5px] leading-5 underline-offset-2 hover:underline",
                antigasPrimeiro ? "font-semibold text-v2-vinho" : "text-v2-tinta-fraca",
              ].join(" ")}
            >
              {antigasPrimeiro ? "↑ antigas" : "↓ recentes"}
            </button>
          )}
        </div>
      </div>

      {/* ---- a lista ------------------------------------------------------ */}
      <div ref={raiz} onScroll={aoRolar} className="rolagem min-h-0 flex-1 overflow-y-auto">
        {fila === "carteira" ? (
          <ListaCarteira
            carteira={carteira}
            busca={busca}
            consultor={recortes.vendedor}
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
                consultor={porConsultor.get(c.vendedor ?? "")}
              />
            )}
          />
        )}

        {/* ⚠️ MOSTRAR MAIS (pedido do dono, 28/09/2026) — só nos recados.
            A fila deixou de ser curta quando passou a mostrar toda conversa
            com nota (#41), então ela vem em lotes. O botão DIZ QUANTAS FALTAM:
            um "mostrar mais" mudo esconde o tamanho de verdade, e a pessoa não
            sabe se clica uma vez ou dez. Fica embaixo da lista, não flutuando,
            porque ele é o fim dela — e o clique não busca nada no servidor: as
            conversas já estão em memória (ver a nota do lote na Casca). */}
        {ocultos > 0 && (
          <div className="px-3 pb-3 pt-1">
            <button
              data-ripple
              data-faltam={ocultos}
              onClick={aoMostrarMais}
              className="w-full rounded-xl bg-v2-superficie px-3 py-2.5 text-[13px] font-semibold text-v2-vinho shadow-e1 ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-vinho-claro"
            >
              Mostrar mais {ocultos > 30 ? 30 : ocultos}
              <span className="ml-1 font-normal text-v2-tinta-fraca">
                (faltam {ocultos})
              </span>
            </button>
          </div>
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
// UM SELETOR DE RECORTE (consultor, número) — o desenho que o dono escolheu em
// 28/09/2026: botão com a escolha à vista e, dentro, a lista com a bolinha de
// cor e a contagem de cada um. Serve aos dois porque a pergunta é a mesma
// ("mostre só os de fulano"), e duas cópias divergiriam no primeiro ajuste.
//
// O menu é FIXO na tela, posicionado pelo botão na hora do clique — dentro de
// uma faixa que rola, um menu absoluto seria cortado (a mesma razão do menu de
// filas logo abaixo).
// ---------------------------------------------------------------------------
type Opcao = { valor: string; rotulo: string; cor: string | null; n: number | null };

function MenuRecorte({
  rotuloVazio, opcoes, valor, total, aoEscolher, aoAbrir,
}: {
  rotuloVazio: string;
  opcoes: Opcao[];
  valor: string | null;
  /** quantas conversas no recorte atual; null = a lista inteira ainda não veio */
  total: number | null;
  aoEscolher: (v: string | null) => void;
  aoAbrir: () => void;
}) {
  const [pos, setPos] = useState<null | { top: number; left: number; largura: number }>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const atual = opcoes.find((o) => o.valor === valor) ?? null;

  useEffect(() => {
    if (!pos) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [pos]);

  const linha = (o: Opcao | null, ativo: boolean) => (
    <button
      key={o?.valor ?? "todos"}
      data-ripple
      role="menuitemradio"
      aria-checked={ativo}
      onClick={() => {
        setPos(null);
        aoEscolher(o ? o.valor : null);
      }}
      className={[
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px]",
        ativo ? "bg-v2-vinho-claro font-semibold text-v2-vinho-texto" : "text-v2-tinta hover:bg-v2-superficie-2",
      ].join(" ")}
    >
      {o?.cor ? (
        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: o.cor }} />
      ) : (
        <span aria-hidden className="size-2.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{o ? o.rotulo : rotuloVazio}</span>
      {(o ? o.n : total) != null && (
        <span className="shrink-0 text-[12px] tabular-nums text-v2-tinta-fraca">{o ? o.n : total}</span>
      )}
    </button>
  );

  return (
    <>
      <button
        ref={botao}
        data-ripple
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={() => {
          if (pos) return setPos(null);
          aoAbrir();
          const r = botao.current?.getBoundingClientRect();
          if (!r) return;
          const largura = Math.min(300, window.innerWidth - 24);
          setPos({ top: r.bottom + 4, left: Math.max(12, Math.min(r.left, window.innerWidth - largura - 12)), largura });
        }}
        title={atual ? `Mostrando só ${atual.rotulo}` : rotuloVazio}
        className={[
          "flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] transition-colors duration-150",
          atual
            ? "bg-v2-vinho-claro font-semibold text-v2-vinho shadow-e1 ring-2 ring-inset ring-v2-vinho"
            : "bg-v2-superficie font-medium text-v2-vinho shadow-e1 ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-vinho-claro",
        ].join(" ")}
      >
        {atual?.cor ? (
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: atual.cor }} />
        ) : (
          <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0 text-v2-tinta-fraca" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="3.2" />
            <path d="M5 20a7 7 0 0 1 14 0" />
          </svg>
        )}
        <span className="min-w-0 flex-1 truncate text-left">{atual ? atual.rotulo : rotuloVazio}</span>
        {(atual ? atual.n : total) != null && (
          <span className="shrink-0 text-[11.5px] tabular-nums text-v2-tinta-fraca">{atual ? atual.n : total}</span>
        )}
        <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0 text-v2-tinta-fraca" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>

      {pos && (
        <>
          <span className="fixed inset-0 z-30" onClick={() => setPos(null)} aria-hidden />
          <div
            role="menu"
            style={{ top: pos.top, left: pos.left, width: pos.largura }}
            className="entrar fixed z-40 max-h-[60vh] overflow-y-auto rounded-xl bg-v2-superficie py-1 shadow-e3 ring-1 ring-v2-linha"
          >
            {linha(null, valor === null)}
            {opcoes.map((o) => linha(o, o.valor === valor))}
          </div>
        </>
      )}
    </>
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

// ⚠️ Os DESENHOS seguem os três do chat de hoje (28/09/2026, pedido do dono):
// lá eles são emoji — 🚶 quem está esperando na fila, 📄 o bilhete da
// supervisão, 🗃️ a caixa de fichas da carteira. Aqui viram traço, porque emoji
// é desenhado pelo sistema e sete pesos diferentes numa barra só é o que faz a
// tela parecer improvisada (§60.8). A LEITURA é a mesma; o traço é nosso.
const ATALHOS: Atalho[] = [
  {
    id: "fila",
    rotulo: "Fila de espera",
    // pessoa andando: quem está na fila, esperando alguém pegar
    icone: (
      <svg viewBox="0 0 24 24" className="size-[19px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13" cy="4" r="1.6" />
        <path d="M12.5 8 9 10.5 7 15M12.5 8l3 2 2.5.5M12.5 8l1 5 2.5 3.5M13.5 13 10 16l-1.5 4.5" />
      </svg>
    ),
  },
  {
    id: "recados",
    rotulo: "Recados da supervisão",
    // folha escrita: a nota interna
    icone: (
      <svg viewBox="0 0 24 24" className="size-[19px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v4h4M9 11h6M9 14h6M9 17h4" />
      </svg>
    ),
  },
  {
    id: "carteira",
    rotulo: "Minha carteira",
    // caixa de fichas: todos os clientes do RCA, com ou sem conversa
    icone: (
      <svg viewBox="0 0 24 24" className="size-[19px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12h16v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7Z" />
        <path d="M7 12V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v7M10 8h4" />
      </svg>
    ),
  },
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
        // branco com relevo sobre o fundo tingido, e o traço em púrpura: são
        // atalhos da marca, não ações (28/09)
        "relative grid size-10 shrink-0 place-items-center rounded-xl shadow-e1 transition-colors duration-150",
        ativo
          ? "bg-v2-vinho-claro text-v2-vinho ring-2 ring-inset ring-v2-vinho"
          : "bg-v2-superficie text-v2-vinho-texto ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-vinho-claro",
      ].join(" ")}
    >
      {atalho.icone}
      {/* o número só aparece quando pede ação — recado por ver, conversa sem
          dono. Contador em tudo vira decoração e some da vista. */}
      {n != null && n > 0 && (atalho.id === "recados" || atalho.id === "fila") && (
        // ⚠️ DENTRO do botão (28/09/2026). Pendurada para fora (-top-1), a
        // bolinha era cortada pelo topo da faixa — e contador cortado é pior
        // que contador nenhum: ele existe exatamente para ser lido de relance.
        <span className="absolute right-0 top-0 min-w-[16px] rounded-full bg-v2-laranja px-1 text-center text-[10px] font-semibold leading-4 text-white ring-2 ring-v2-superficie">
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
        // ⚠️ O ATIVO É CLARO, COM O NÚMERO ESCURO (28/09/2026). Número branco
        // sobre o vinho claro ficou ilegível — e o número é a única coisa que
        // este cartão existe para mostrar. O destaque vem da BORDA e do fundo
        // tingido, nunca de inverter o texto.
        // py 6 -> 4 e o número de 17 para 16 (03/10): quatro pixels por cartão
        // numa faixa que a lista paga inteira. O rótulo não encolhe — ele já está
        // em 10,5 px, e abaixo disso deixa de ser legível.
        "rounded-lg px-1 py-1 text-center shadow-e1 transition-colors duration-150",
        ativo
          ? "bg-v2-vinho-claro ring-2 ring-inset ring-v2-vinho"
          : "bg-v2-superficie ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-vinho-claro",
      ].join(" ")}
    >
      <span
        className={[
          "block text-[16px] font-bold leading-5 tabular-nums",
          vazio ? "text-v2-tinta-fraca" : cartao.destaque ? "text-v2-laranja" : ativo ? "text-v2-vinho" : "text-v2-tinta",
        ].join(" ")}
      >
        {/* sem número ainda: um traço, nunca um zero que mente */}
        {n == null ? "—" : n}
      </span>
      <span className={["block truncate text-[10.5px] leading-3", ativo ? "text-v2-vinho-texto" : "text-v2-tinta-fraca"].join(" ")}>
        {cartao.rotulo}
      </span>
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
  recadosNovos,
  aoTrocar,
}: {
  fila: Fila;
  contagens: Record<Fila, number | null>;
  recadosNovos: number | null;
  aoTrocar: (f: Fila) => void;
}) {
  // o número do MENU é o tamanho da fila; o do ALERTA é o que pede ação (#41)
  const alerta = (f: Fila) => (f === "recados" ? recadosNovos : contagens[f]);
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

  // o que pede ação e está FORA da fila aberta — é o que o contador avisa
  const pendente = (["nao_lidas", "recados"] as Fila[]).filter((f) => f !== fila && (alerta(f) ?? 0) > 0);
  const pendentes = pendente.reduce((t, f) => t + (alerta(f) ?? 0), 0);
  const dica = pendente
    .map((f) => `${alerta(f)} em ${FILAS.find((x) => x.id === f)?.rotulo}`)
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
        // ⚠️ MESMA ALTURA DA BUSCA (h-11) e CANTO MENOS REDONDO (28/09/2026,
        // pedido do dono): a pílula azul de ponta redonda destoava do campo
        // logo abaixo e puxava a atenção para um controle que é de escolha, não
        // de ação. Letra preta sobre superfície discreta; o azul continua sendo
        // do que AGE (enviar, ligar).
        className="relative flex h-10 min-w-0 items-center gap-1.5 rounded-xl bg-v2-superficie pl-3 pr-2 text-[14px] font-semibold text-v2-vinho shadow-e1 ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-vinho-claro"
      >
        <span className="min-w-0 truncate">{atual.rotulo}</span>
        {n != null && n > 0 && (
          <span className="min-w-5 rounded-md bg-v2-superficie px-1 text-[11.5px] tabular-nums text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha">
            {n}
          </span>
        )}
        <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7 10 5 5 5-5" />
        </svg>
        {/* ⚠️ DENTRO do botão, e COM O NÚMERO (28/09/2026). Pendurado para
            fora, o ponto era cortado pela borda da faixa e virava um risco
            vermelho no canto; e um ponto sem número não diz quanto está
            esperando, que é justamente a pergunta. */}
        {pendente.length > 0 && (
          <span
            aria-label={dica}
            className="absolute right-0.5 top-0.5 min-w-[17px] rounded-full bg-v2-laranja px-1 text-center text-[10px] font-semibold leading-4 text-white ring-2 ring-v2-superficie"
          >
            {pendentes > 99 ? "99+" : pendentes}
          </span>
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
              const pede = (f.id === "nao_lidas" || f.id === "recados") && (alerta(f.id) ?? 0) > 0;
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
