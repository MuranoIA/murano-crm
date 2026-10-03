"use client";

import { useEffect, useState } from "react";
import { dinheiro, telefoneBonito } from "./formato";
import type { Conversa } from "./tipos";
import { FichaCadastro, MesmaPessoa, OutroCadastro, type CadastroDoTelefone, type CandidatoErp } from "./FichaCadastro";
import { TrocarNumero } from "./TrocarNumero";

// O ERP ao lado da conversa. É a vantagem que o RD Conversas não tem — e no
// chat antigo ela **some no celular** (`!isMobile`, achado 3 do laudo), que é
// justamente o aparelho que vai virar o app.
//
// Aqui o painel existe em toda largura: coluna no desktop, folha que sobe no
// celular (quem decide é o CSS da Casca, não um `window.innerWidth` em JS).
//
// O NÚMERO HERÓI: no painel antigo o valor faturado divide 268 px com outros
// dois blocos iguais e **trunca** — quanto maior a cliente, mais cedo o número
// some (§58.3). Aqui ele ocupa a coluna inteira, e o resto é apoio.

type Dados = {
  compras: { compras: number; ultima_compra: string | null; dias_sem_comprar: number | null; total_liquido: number | null; cidade: string | null; rca_oficial: string | null } | null;
  funil: { etapa: string | null; venda_valor: number | null; sem_cadastro: boolean | null } | null;
  ultimas_notas: { data_fat: string; valor: number; num_nota: number | null; filial: string | null }[];
  /** mesmo NOME no WinThor com outro telefone, quando este número não tem vínculo */
  erp_candidatos?: CandidatoErp[];
  erp_mesmo_telefone?: CadastroDoTelefone[];
  boletos?: Boleto[];
  boletos_resumo?: {
    vencidas: number; a_vencer: number;
    total_vencido: number; total_a_vencer: number; pior_atraso: number;
  } | null;
};

export type Boleto = {
  numero_cobranca: string; numero_nf: string | null; filial: string | null;
  tipo_cobranca: string | null; status_cobranca: string | null;
  valor_reais: number; vencimento: string; dias: number; vencido: boolean;
  url_cobranca: string | null;
};

export function PainelContato({
  conversa,
  aoFechar,
  aoAviso,
  aoPedirDados,
  aoTrocouNumero,
  aoAbrirConversa,
}: {
  conversa: Conversa;
  aoFechar: () => void;
  aoAviso?: (texto: string, ok: boolean) => void;
  /** põe o pedido de dados da ficha na caixa de mensagem (não envia) */
  aoPedirDados?: (texto: string) => void;
  /** trocar o número (22/09): a conversa passa a usar o novo na hora */
  aoTrocouNumero?: (novo: string) => void;
  aoAbrirConversa?: (id: string) => void;
}) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let vivo = true;
    setD(null);
    setErro(null);
    fetch(`/api/chat/contato?cliente_id=${encodeURIComponent(conversa.cliente_id)}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j?.error ?? `erro ${r.status}`)))))
      .then((j) => vivo && setD(j))
      .catch((e) => vivo && setErro(String(e.message ?? e)));
    return () => {
      // a resposta pode chegar depois de a pessoa trocar de conversa: sem esta
      // guarda, o painel da cliente A aparece dentro da conversa da cliente B
      // (§70 do CLAUDE.md, onde isso custou produção)
      vivo = false;
    };
  }, [conversa.cliente_id, versao]);

  const c = d?.compras;
  // Tem ERP = o cadastro do WinThor manda (§46/0108): não há ficha a preencher,
  // há o caminho para corrigir por lá. Card sintético do ERP não é contato.
  const temErp = !!c;
  const ehContato = !/^(winthor|venda):/.test(conversa.cliente_id);
  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-v2-linha bg-v2-superficie">
      <header className="flex shrink-0 items-center gap-2 border-b border-v2-linha px-3 py-2.5">
        <h2 className="flex-1 text-[13px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">Cliente</h2>
        <button
          data-ripple
          onClick={aoFechar}
          aria-label="Fechar"
          className="grid size-8 place-items-center rounded-full text-v2-tinta-fraca hover:bg-v2-superficie-2"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className="rolagem min-h-0 flex-1 overflow-y-auto p-3">
        {erro && <p className="rounded-lg bg-v2-erro-claro px-3 py-2 text-[12.5px] text-v2-erro">{erro}</p>}

        {!d && !erro && (
          <div className="space-y-2">
            <div className="esqueleto h-16 w-full" />
            <div className="esqueleto h-10 w-full" />
            <div className="esqueleto h-24 w-full" />
          </div>
        )}

        {d && (
          <>
            {/* --- o número herói --------------------------------------- */}
            <div className="rounded-2xl bg-v2-superficie-2 p-3">
              <p className="text-[11px] uppercase tracking-wide text-v2-tinta-fraca">Comprado (líquido)</p>
              <p className="mt-0.5 text-[26px] font-bold leading-8 tabular-nums text-v2-tinta">
                {dinheiro(c?.total_liquido ?? null)}
              </p>
              <p className="mt-0.5 text-[12px] text-v2-tinta-fraca">
                {c?.compras ? `${c.compras} compras` : "sem compra registrada"}
                {c?.cidade ? ` · ${c.cidade}` : ""}
              </p>
            </div>

            {/* --- os de apoio ------------------------------------------- */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-v2-linha p-2.5">
                <p className="text-[11px] text-v2-tinta-fraca">Sem comprar há</p>
                <p className="text-[17px] font-semibold tabular-nums">
                  {c?.dias_sem_comprar != null ? `${c.dias_sem_comprar} d` : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-v2-linha p-2.5">
                <p className="text-[11px] text-v2-tinta-fraca">Faturado no mês</p>
                <p className="text-[17px] font-semibold tabular-nums">{dinheiro(d.funil?.venda_valor ?? null)}</p>
              </div>
            </div>

            <dl className="mt-3 space-y-1.5 text-[12.5px]">
              <Linha rotulo="Telefone" valor={telefoneBonito(conversa.telefone)} />
              {aoTrocouNumero && aoAbrirConversa && !/^(winthor|venda):/.test(conversa.cliente_id) && (
                <div className="pl-[104px]">
                  <TrocarNumero
                    clienteId={conversa.cliente_id}
                    atual={conversa.telefone}
                    aoTrocou={aoTrocouNumero}
                    aoAbrirConversa={aoAbrirConversa}
                    aoAviso={aoAviso}
                  />
                </div>
              )}
              <Linha rotulo="Código" valor={conversa.codcli ? String(conversa.codcli) : "—"} />
              <Linha rotulo="RCA oficial" valor={c?.rca_oficial ?? "—"} />
              <Linha rotulo="Etapa no board" valor={d.funil?.etapa ?? "—"} />
              <Linha rotulo="Carteira" valor={conversa.vendedor ?? (conversa.na_fila ? "na fila" : "—")} />
            </dl>

            {/* ---- cadastro: ERP manda, ou ficha para o ERP (paridade 5 e 6) ---
                Substitui o "salvar nome e CPF": a ficha grava os dois e mais o
                que o WinThor exige. Cliente vinculado não tem formulário — o
                cadastro é do ERP e é ele que manda no nome (§46). */}
            {ehContato && temErp && (
              <p className="mt-4 rounded-xl bg-v2-superficie-2 px-3 py-2 text-[12px] leading-4 text-v2-tinta-fraca">
                <b className="text-v2-tinta">Cadastro do WinThor.</b> Nome, CPF e endereço vêm do ERP e não são
                editados aqui — corrigir por lá vale para todo mundo, e chega em até 10 minutos.
              </p>
            )}

            <Dividas
              boletos={d.boletos ?? []}
              resumo={d.boletos_resumo ?? null}
              aoPedirDados={aoPedirDados}
            />

            {/* ⚠️ FORA do `!temErp` (demanda #50): o caso é justamente o do
                contato que JÁ tem cadastro — e cadastro errado. Dentro do bloco
                de "sem cadastro" ele nunca apareceria para quem precisa. */}
            {ehContato && (
              <OutroCadastro
                clienteId={conversa.cliente_id}
                cadastros={d.erp_mesmo_telefone ?? []}
                aoAviso={aoAviso}
                aoTrocado={() => setVersao((v) => v + 1)}
              />
            )}
            {ehContato && !temErp && (
              <>
                <MesmaPessoa
                  clienteId={conversa.cliente_id}
                  candidatos={d.erp_candidatos ?? []}
                  aoAviso={aoAviso}
                  aoVinculado={() => setVersao((v) => v + 1)}
                />
                <FichaCadastro clienteId={conversa.cliente_id} aoPedirDados={aoPedirDados} aoAviso={aoAviso} />
              </>
            )}

            {d.funil?.sem_cadastro && (
              <p className="mt-3 rounded-lg bg-v2-laranja-claro px-3 py-2 text-[12px] leading-4 text-v2-laranja">
                Não encontrei este contato no WinThor. Com o CPF/CNPJ na ficha, o vínculo aparece em até 10 minutos.
              </p>
            )}

            {d.ultimas_notas?.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">
                  Últimas notas
                </h3>
                <ul className="space-y-1">
                  {d.ultimas_notas.map((n, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[12.5px]">
                      <span className="tabular-nums text-v2-tinta-fraca">
                        {new Date(n.data_fat).toLocaleDateString("pt-BR", { timeZone: "America/Belem" })}
                      </span>
                      <span className="flex-1 truncate text-v2-tinta-fraca">
                        nota {n.num_nota ?? "—"}
                        {n.filial ? ` · ${n.filial}` : ""}
                      </span>
                      <span className="font-medium tabular-nums">{dinheiro(n.valor)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 shrink-0 text-v2-tinta-fraca">{rotulo}</dt>
      <dd className="min-w-0 flex-1 truncate font-medium">{valor}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DÍVIDAS EM ABERTO (demanda #64)
//
// Fica ACIMA do aviso de cadastro e abaixo dos dados, porque é informação que
// muda a conversa: oferecer compra nova a quem está com boleto vencido é o
// erro que este bloco existe para impedir. Cliente sem nada em aberto não vê
// bloco nenhum — um "sem dívidas" permanente vira ruído e some da vista
// justamente quando passa a ter conteúdo.
//
// ⚠️ VENCIDO VEM DO SERVIDOR, pela DATA (0152), não do `status_cobranca`: 125
// cobranças estão `pending` e já venceram, a mais antiga de 2024. Recalcular
// aqui no navegador daria uma segunda régua, e as duas divergiriam no primeiro
// fuso mal resolvido.
function Dividas({
  boletos,
  resumo,
  aoPedirDados,
}: {
  boletos: Boleto[];
  resumo: { vencidas: number; a_vencer: number; total_vencido: number; total_a_vencer: number; pior_atraso: number } | null;
  aoPedirDados?: (texto: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  if (!boletos.length || !resumo) return null;

  const temVencida = resumo.vencidas > 0;
  // as vencidas primeiro, e dentro de cada grupo a mais antiga antes
  const lista = [...boletos].sort((a, b) =>
    a.vencido === b.vencido ? a.vencimento.localeCompare(b.vencimento) : a.vencido ? -1 : 1,
  );
  const mostrar = aberto ? lista : lista.slice(0, 3);

  const dia = (iso: string) => {
    const [a, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${a.slice(2)}`;
  };

  return (
    <section
      className={`mt-4 rounded-2xl border p-3 ${
        temVencida ? "border-v2-erro/40 bg-v2-erro/[0.06]" : "border-v2-linha bg-v2-superficie-2"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">
          {temVencida ? "Dívidas vencidas" : "A pagar"}
        </p>
        <p className="text-[11px] text-v2-tinta-fraca">{boletos.length} em aberto</p>
      </div>

      {temVencida && (
        <>
          <p className="mt-0.5 text-[22px] font-bold leading-7 tabular-nums text-v2-erro">
            {dinheiro(resumo.total_vencido)}
          </p>
          <p className="text-[12px] text-v2-tinta-fraca">
            {resumo.vencidas} {resumo.vencidas === 1 ? "cobrança vencida" : "cobranças vencidas"}
            {resumo.pior_atraso > 0 ? ` · a mais antiga há ${resumo.pior_atraso} dias` : ""}
          </p>
        </>
      )}

      {resumo.a_vencer > 0 && (
        <p className={`${temVencida ? "mt-1.5" : "mt-0.5"} text-[12.5px] text-v2-tinta-fraca`}>
          {temVencida ? "E mais " : ""}
          <b className="tabular-nums text-v2-tinta">{dinheiro(resumo.total_a_vencer)}</b> a vencer
          {resumo.a_vencer > 1 ? ` em ${resumo.a_vencer} cobranças` : ""}
        </p>
      )}

      <ul className="mt-2.5 space-y-1.5">
        {mostrar.map((k) => (
          <li key={k.numero_cobranca} className="flex items-center gap-2 text-[12.5px]">
            <span className={`w-[70px] shrink-0 tabular-nums ${k.vencido ? "font-semibold text-v2-erro" : "text-v2-tinta-fraca"}`}>
              {dia(k.vencimento)}
            </span>
            <span className="w-[76px] shrink-0 tabular-nums font-medium text-v2-tinta">
              {dinheiro(k.valor_reais)}
            </span>
            {/* ⚠️ O tipo NAO encolhe, a NF sim. Com os dois no mesmo `truncate` a
                coluna cortava em "B…" e a linha perdia a única informação que
                muda a conversa (pix se paga na hora; boleto, não). A NF é
                referência, e vive no `title` quando não couber. */}
            <span className="shrink-0 text-v2-tinta-fraca" title={k.numero_nf ? `NF ${k.numero_nf}` : undefined}>
              {k.tipo_cobranca === "pix" ? "Pix" : k.tipo_cobranca === "boleto" ? "Boleto" : (k.tipo_cobranca ?? "—")}
            </span>
            <span className="min-w-0 flex-1 truncate text-right text-[11.5px] text-v2-tinta-fraca">
              {k.numero_nf ? `NF ${k.numero_nf}` : ""}
            </span>
            {/* O link NÃO é enviado por este botão: ele vai para a caixa de
                mensagem, como o "Pedir os dados" da ficha (§47). Mandar cobrança
                com um clique é o tipo de gesto que não pode ser acidental. */}
            {k.url_cobranca && aoPedirDados && (
              <button
                data-ripple
                type="button"
                title="Põe o link desta cobrança na caixa de mensagem (não envia)"
                onClick={() =>
                  aoPedirDados(
                    `Segue o link da cobrança de ${dinheiro(k.valor_reais)} com vencimento em ${dia(k.vencimento)}: ${k.url_cobranca}`,
                  )
                }
                className="shrink-0 rounded-full border border-v2-linha-forte px-2 py-0.5 text-[11px] font-medium text-v2-tinta-fraca hover:border-v2-azul hover:text-v2-azul"
              >
                link
              </button>
            )}
          </li>
        ))}
      </ul>

      {lista.length > 3 && (
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="mt-1.5 text-[12px] font-medium text-v2-azul"
        >
          {aberto ? "ver menos" : `ver as outras ${lista.length - 3}`}
        </button>
      )}
    </section>
  );
}
