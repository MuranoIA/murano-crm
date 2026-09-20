"use client";

import { DESFECHOS, VIVOS, duracaoBR, horaBR, type Ligacao } from "../../../lib/ligacaoDados";

// A ligação no ponto da conversa em que aconteceu, como a transferência.
//
// ⚠️ Ligação NÃO é mensagem, e por isso não mora em `mensagens` (§22.3): uma
// linha lá viraria "a última mensagem" da conversa, moveria o card de coluna no
// board e abriria uma espera no indicador de tempo de resposta — os dois bugs
// silenciosos que a reação causou e a 0086 corrigiu.
//
// Importa de `ligacaoDados`, nunca do hook: este componente é código da
// primeira pintura, e o hook arrasta WebRTC e microfone consigo.
export function MarcoLigacao({ l }: { l: Ligacao }) {
  const entrada = l.direcao === "entrada";
  const ok = l.status === "concluida";
  const perdida = ["nao_atendida", "recusada", "falhou", "cancelada"].includes(l.status);
  const viva = VIVOS.includes(l.status);

  const titulo = viva
    ? entrada
      ? "Chamada recebida — em andamento"
      : "Ligação em andamento"
    : entrada
      ? ok
        ? "Chamada recebida"
        : l.status === "recusada"
          ? "Chamada recusada"
          : "Chamada perdida"
      : ok
        ? "Ligação feita"
        : l.status === "nao_atendida"
          ? "Não atendeu"
          : l.status === "falhou"
            ? "Ligação falhou"
            : "Ligação cancelada";

  // verde é "concluído" nesta paleta; laranja é o acento do que pede atenção
  // (a chamada que se perdeu). Tudo o mais é neutro.
  const pintura = viva
    ? "border-v2-ok/30 bg-v2-ok-claro text-v2-ok"
    : perdida
      ? "border-v2-laranja/25 bg-v2-laranja-claro text-v2-laranja"
      : "border-v2-linha bg-v2-superficie text-v2-tinta-fraca";

  const desfecho = DESFECHOS.find((d) => d.v === l.motivo)?.rotulo;

  return (
    <div className="my-2 flex justify-center px-3">
      <div className={["max-w-[min(80%,620px)] rounded-2xl border px-3.5 py-1.5 text-center text-[11.5px] leading-5", pintura].join(" ")}>
        <span aria-hidden>{entrada ? "📲" : "📞"}</span> <b className="font-semibold">{titulo}</b>
        {l.duracao_seg != null && <span className="opacity-80"> · {duracaoBR(l.duracao_seg)}</span>}
        <span className="tabular-nums opacity-70"> · {horaBR(l.iniciada_em)}</span>
        {desfecho && <div className="font-semibold">{desfecho}</div>}
        {l.observacao && <div className="italic opacity-85">“{l.observacao}”</div>}
      </div>
    </div>
  );
}
