"use client";

import { COLUNAS, COR_ETAPA, ROTULO_CURTO_ETAPA, TITULO_ETAPA, type EtapaBoard } from "../../../lib/etapasBoard";

// ---------------------------------------------------------------------------
// OS TRÊS RECORTES QUE CRUZAM: consultor, número e coluna do board.
//
// Eles CRUZAM com as filas (Todas / Não lidas / Favoritas / Fila / Resolvidas)
// e entre si, em vez de substituí-las — "as não lidas da Kamilly em Negociação"
// é uma pergunta legítima, e foi a escolha do chat antigo (§23.5). A
// consequência é que cada chip precisa contar DENTRO do que os outros já
// escolheram: um chip que promete 12 e entrega 3 é pior que chip nenhum.
//
// ⚠️ NÃO é a mesma escolha que a fila, e por isso são controles separados. Onde
// dois controles decidem A MESMA coisa, eles acabam se contradizendo — foi o
// que a 0099 teve de desfazer (§32) e a régua do §68.2.
//
// O painel é fechado por padrão: abri-lo é o gesto que manda buscar a lista
// inteira e os dois recortes caros do servidor. Quem não filtra não paga por
// eles (a régua da fase 1).
// ---------------------------------------------------------------------------

export type Recortes = {
  vendedor: string | null;
  linha: string | null;
  etapa: EtapaBoard | null;
};

export const SEM_RECORTE: Recortes = { vendedor: null, linha: null, etapa: null };
export const quantosRecortes = (r: Recortes) =>
  (r.vendedor ? 1 : 0) + (r.linha ? 1 : 0) + (r.etapa ? 1 : 0);

function Pilula({
  ativo, rotulo, titulo, cor, n, onClick,
}: {
  ativo: boolean;
  rotulo: string;
  titulo?: string;
  /** cor da etapa: entra como filete e borda, nunca como fundo chapado —
   *  duas das sete (o cinza dos ociosos, o roxo da prospecção) reprovam em
   *  contraste com texto branco, e trocá-las faria o chip discordar da coluna */
  cor?: string;
  n?: number | null;
  onClick: () => void;
}) {
  return (
    <button
      data-ripple
      onClick={onClick}
      title={titulo ?? rotulo}
      aria-pressed={ativo}
      className={[
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] transition-colors duration-150",
        ativo
          ? "bg-v2-azul-claro text-v2-azul ring-1 ring-inset ring-v2-azul"
          : "text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie-2",
      ].join(" ")}
    >
      {cor && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: cor }} />}
      {rotulo}
      {n != null && <span className="tabular-nums opacity-70">{n}</span>}
    </button>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function Filtros({
  aberto,
  recortes,
  aoMudar,
  consultores,
  linhas,
  contaPorConsultor,
  contaPorLinha,
  contaPorEtapa,
  carregando,
}: {
  aberto: boolean;
  recortes: Recortes;
  aoMudar: (r: Recortes) => void;
  /** endereços que atendem: carteiras com conversa + quem atende sem carteira */
  consultores: { endereco: string; nome: string; cor: string | null }[];
  /** os números ATIVOS. Com um só, este grupo não aparece — não há o que separar. */
  linhas: { id: string; rotulo: string; numero: string | null }[];
  contaPorConsultor: Map<string, number>;
  contaPorLinha: Map<string, number>;
  contaPorEtapa: Map<string, number>;
  /** enquanto a lista inteira não chegou, chip sem número — nunca com zero */
  carregando: boolean;
}) {
  if (!aberto) return null;

  const n = (m: Map<string, number>, k: string) => (carregando ? null : m.get(k) ?? 0);
  const alterna = <T,>(atual: T | null, v: T): T | null => (atual === v ? null : v);

  return (
    <div className="border-t border-v2-linha bg-v2-superficie-2 px-3 py-2">
      {consultores.length > 0 && (
        <Grupo titulo="Consultor">
          {consultores.map((c) => (
            <Pilula
              key={c.endereco}
              ativo={recortes.vendedor === c.endereco}
              rotulo={c.nome}
              cor={c.cor ?? undefined}
              n={n(contaPorConsultor, c.endereco)}
              onClick={() => aoMudar({ ...recortes, vendedor: alterna(recortes.vendedor, c.endereco) })}
            />
          ))}
        </Grupo>
      )}

      {/* Com uma linha só o seletor não tem o que separar, e desenhá-lo seria
          oferecer uma escolha que não existe. Medido em 20/09/2026: uma linha
          ativa, com 4.144 conversas. */}
      {linhas.length > 1 && (
        <Grupo titulo="Número">
          {linhas.map((l) => (
            <Pilula
              key={l.id}
              ativo={recortes.linha === l.id}
              rotulo={l.rotulo}
              titulo={l.numero ? `${l.rotulo} · ${l.numero}` : l.rotulo}
              n={n(contaPorLinha, l.id)}
              onClick={() => aoMudar({ ...recortes, linha: alterna(recortes.linha, l.id) })}
            />
          ))}
        </Grupo>
      )}

      <Grupo titulo="Coluna do board">
        {/* a ORDEM é sempre a do board: é o que torna a faixa legível de
            relance, e o que permite duas colunas começarem com a mesma letra
            sem confundir (§68.3) */}
        {COLUNAS.map((c) => (
          <Pilula
            key={c.key}
            ativo={recortes.etapa === c.key}
            rotulo={ROTULO_CURTO_ETAPA[c.key as EtapaBoard]}
            titulo={TITULO_ETAPA[c.key as EtapaBoard]}
            cor={COR_ETAPA[c.key as EtapaBoard]}
            n={n(contaPorEtapa, c.key)}
            onClick={() => aoMudar({ ...recortes, etapa: alterna(recortes.etapa, c.key as EtapaBoard) })}
          />
        ))}
      </Grupo>

      {quantosRecortes(recortes) > 0 && (
        <button
          onClick={() => aoMudar(SEM_RECORTE)}
          className="mt-2 text-[12px] font-medium text-v2-azul underline-offset-2 hover:underline"
        >
          limpar os filtros
        </button>
      )}
    </div>
  );
}
