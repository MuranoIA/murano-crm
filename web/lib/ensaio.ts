// -----------------------------------------------------------------------------
// A faixa reservada do ensaio — e as duas garantias em cima dela.
//
// POR QUE ESTE ARQUIVO EXISTE (10/09/2026, incidente medido)
//
// O ensaio de equipe (`testes/simulacao.mjs`) escreve no banco de PRODUÇÃO, de
// propósito: não há ambiente de teste neste projeto. Ele cria clientes
// fictícios numa faixa de telefone reservada e conta com uma limpeza no fim.
// Em 10/09 a rodada foi interrompida às 11:33, a limpeza não rodou, e por meia
// hora os consultores atenderam 25 conversas falsas. Um deles chegou a
// RESPONDER — o "Perfeito" para o Ensaio 23 saiu pela linha de produção, com
// wamid de verdade, e só não chegou a ninguém porque a Meta recusou o número
// (131026).
//
// Daí as duas garantias, e a ordem entre elas importa:
//
//   1. NÃO APARECE. A faixa é invisível em toda tela, por padrão. Quem quiser
//      vê-la precisa dizer isso ao servidor (`ensaioVisivel()`), e produção
//      nunca diz. Falha para o lado seguro: env ausente, valor errado, leitura
//      quebrada — tudo isso esconde. O contrário ("na dúvida, mostra") é
//      exatamente o que custou a manhã de 10/09.
//
//   2. NÃO SAI. Mensagem endereçada à faixa nunca chega à Graph API, nem
//      partindo de produção, nem com o interceptador de ensaio desligado
//      (`deveSimular` em `simulacaoEnvio.ts`). A garantia 1 torna improvável
//      alguém escrever para um cliente fictício; a 2 torna inofensivo.
//
// A faixa é `55 91 9 0000-00NN`. Não colide com número real: no Brasil o dígito
// seguinte ao 9 de celular não é 0, então `9 0000-…` não é atribuível. O
// `testes/simulacao.mjs` também conferiu ausência de colisão de tel8 em
// `clientes` e em `wth_carteira` antes de adotá-la.
// -----------------------------------------------------------------------------

/** Só os dígitos — o mesmo normalizador do resto do projeto. */
const so = (s: unknown) => String(s ?? "").replace(/\D+/g, "");

/** Telefone dos clientes de ensaio, em dígitos. */
export const PREFIXO_TEL_ENSAIO = "559190000";

/** O id que o webhook cria para eles (§16.3: `wa:<wa_id>`). */
export const PREFIXO_ID_ENSAIO = `wa:${PREFIXO_TEL_ENSAIO}`;

/** Padrão de `like` para PostgREST e SQL. */
export const PADRAO_ID_ENSAIO = `${PREFIXO_ID_ENSAIO}%`;

/** Este id de cliente é de ensaio? */
export const ehClienteDeEnsaio = (id: unknown): boolean =>
  String(id ?? "").startsWith(PREFIXO_ID_ENSAIO);

/**
 * Este destino é da faixa reservada?
 *
 * Compara por PREFIXO dos dígitos, não pelos últimos 8 como o resto do projeto
 * faz para casar contato (§16.3). Aqui a pergunta é outra — "este número é de
 * mentira?" —, e prefixo é o que responde: a faixa inteira é nossa, e casar
 * pelo fim aceitaria qualquer número que terminasse igual.
 */
export const ehTelefoneDeEnsaio = (tel: unknown): boolean =>
  so(tel).startsWith(PREFIXO_TEL_ENSAIO);

/**
 * O servidor pode mostrar a faixa de ensaio?
 *
 * `ENSAIO_VISIVEL=1` é o interruptor; `SIMULACAO_ENVIO=1` vale junto porque é a
 * chave que já marca "este servidor é de ensaio" e quem sobe um não deve ter de
 * lembrar de dois. Na Vercel nenhuma das duas existe, então produção esconde
 * sem depender de ninguém configurar nada — que é a única forma de isto não se
 * repetir.
 */
export const ensaioVisivel = (): boolean =>
  process.env.ENSAIO_VISIVEL === "1" || process.env.SIMULACAO_ENVIO === "1";

/**
 * Tira a faixa de ensaio de uma consulta do PostgREST.
 *
 * Devolve a consulta INTACTA quando a faixa está visível, para o ensaio
 * enxergar o que criou. `coluna` existe porque em `clientes` a chave se chama
 * `id` e em todo o resto `cliente_id`.
 */
export function semEnsaio<T extends ComNot>(q: T, coluna = "cliente_id"): T {
  if (ensaioVisivel()) return q;
  return (q as any).not(coluna, "like", PADRAO_ID_ENSAIO) as T;
}

/**
 * O tipo existe para o COMPILADOR pegar o erro que o runtime pegou primeiro.
 *
 * `sb.from("x")` devolve um construtor de consulta que ainda NAO tem `.not()` —
 * quem tem e o filtro, depois do `.select()`. Chamar `semEnsaio` cedo demais
 * derruba a rota com 500 e "e.not is not a function", e nem `tsc` nem
 * `next build` reclamam quando o parametro e um `T` solto. Com a restricao
 * abaixo, passar o objeto errado para de compilar.
 */
type ComNot = { not: (coluna: string, operador: string, valor: unknown) => unknown };
