// -----------------------------------------------------------------------------
// Interceptor de envio — SÓ PARA ENSAIO. Nunca ligado na Vercel.
//
// Por que existe: não há ambiente de teste neste projeto (`testes/README.md`).
// Para exercitar seis consultores enviando ao mesmo tempo é preciso volume, e
// volume de verdade contra a Graph API significa (a) custo, (b) mensagem
// chegando em número de estranho, ou (c) 131026 em todo envio — que não
// exercita nada, porque o caminho feliz nunca roda.
//
// Com `SIMULACAO_ENVIO=1` o envio para de sair: `post()` e `sendMedia()`
// devolvem um wamid falso, prefixado `sim.`, e o resto do app segue idêntico —
// espelho em `mensagens`, bucket, Realtime, funil. O que se mede passa a ser o
// NOSSO sistema, que é o que está por provar; a integração com a Meta já foi
// provada ponta a ponta (CLAUDE.md §28, §62).
//
// ⚠️ DUAS TRAVAS DE PROPÓSITO:
//
// 1. FALHA PARA O LADO SEGURO. Com a chave ligada e a lista de destinos reais
//    vazia, TUDO é simulado. O contrário — "não sei, então manda" — é como se
//    perde dinheiro e se escreve para cliente real por engano.
//
// 2. O `sim.` no wamid não é enfeite. É por ele que a limpeza acha o que
//    apagar, e é o que denuncia a chave esquecida ligada: mensagem parada com
//    id `sim.` em produção é ensaio que vazou, e salta aos olhos numa consulta.
//
// A lista `SIMULACAO_DESTINOS_REAIS` existe para o outro lado do ensaio: os
// números autorizados pelo usuário continuam recebendo de verdade, no mesmo
// run, sem reiniciar o servidor com outra configuração. Sem ela seriam duas
// rodadas e duas oportunidades de subir a errada.
// -----------------------------------------------------------------------------
import { randomUUID } from "node:crypto";

/** A chave-mestra. Ausente = comportamento normal, em todo o resto do arquivo. */
export function simulacaoLigada(): boolean {
  return process.env.SIMULACAO_ENVIO === "1";
}

const so = (s: unknown) => String(s ?? "").replace(/\D+/g, "");

/**
 * Este destino continua saindo de verdade?
 *
 * Compara pelos ÚLTIMOS 8 DÍGITOS, e não pela string inteira, pela mesma razão
 * do resto do projeto (§16.3): o mesmo número aparece com 12 e com 13 dígitos
 * conforme quem escreveu, e comparar inteiro deixaria passar como "simulado"
 * um número que era para ser real — ou pior, o contrário.
 */
export function destinoReal(to: string): boolean {
  const lista = (process.env.SIMULACAO_DESTINOS_REAIS ?? "")
    .split(",").map((n) => so(n)).filter(Boolean);
  const alvo = so(to).slice(-8);
  if (!alvo) return false;
  return lista.some((n) => n.slice(-8) === alvo);
}

/** Interceptar este envio? */
export function deveSimular(to: string): boolean {
  return simulacaoLigada() && !destinoReal(to);
}

/** wamid falso, no formato que o resto do app trata como id de mensagem. */
export function wamidSimulado(): string {
  return `sim.${randomUUID().replace(/-/g, "")}`;
}
