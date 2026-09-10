-- ============================================================================
-- 0127 — a marca de leitura é de quem ATENDE, não de quem passou os olhos
--
-- A régua nova (lib/chatEscopo.souDonoDaConversa) só grava `chat_leitura` para o
-- dono efetivo da conversa. Quem abre a conversa de outra pessoa está
-- conferindo, e conferir não é atender: marcar ali apagava o próprio número de
-- "esperando resposta" no gesto de olhar — o supervisor abria as duas que
-- estavam na fila e passava a ver zero, sem ninguém ter respondido nada.
--
-- Mas a régua nova só vale daqui para a frente. O passado continua mascarando,
-- e medido em 09/09/2026 o pior caso é justamente quem motivou o pedido:
--
--     Lais    65 marcas, 51 em conversa que não é dela  -> 25 voltam para a fila
--     Angelo 102 marcas, 89 idem                        -> 11
--     Romulo  98 marcas, 81 idem                        ->  6
--     consultores                                       -> no máximo 2 cada
--
-- Sem esta limpeza a régua nova entra e não muda nada visível para eles: as
-- conversas que já estavam mascaradas seguem mascaradas até o cliente falar de
-- novo. Com ela, a fila passa a dizer a verdade no primeiro acesso.
--
-- O CRITÉRIO É O MESMO DA RÉGUA, não "apagar tudo de admin". Romulo entra como
-- admin e TEM a carteira `romulo`: as 17 marcas dele em conversas da própria
-- carteira são legítimas e ficam. E consultor também acumulou marca em conversa
-- alheia (Luana 29, Milene 28) — abrindo a fila, a busca, o que foi transferido
-- para outra pessoa. A régua nova impede os dois casos; a limpeza também.
--
-- Idempotente: rodar de novo não acha mais nada para apagar.
-- ============================================================================

do $$
declare
  n_antes  bigint;
  n_apagou bigint;
begin
  select count(*) into n_antes from chat_leitura;

  with dono as (
    -- dono efetivo = transferência vigente, se houver; senão a carteira do
    -- cliente. É a MESMA régua de dois degraus de chatEscopo.donoEfetivo — e,
    -- como lá, um destino NULO (conversa devolvida para a fila) decide: ela não
    -- é de ninguém, então marca nenhuma se sustenta nela.
    select l.usuario, l.cliente_id,
           case when t.cliente_id is not null then t.para_carteira else f.vendedor end as dono_efetivo
      from chat_leitura l
      left join vw_chat_atribuicao t on t.cliente_id = l.cliente_id
      left join vw_funil          f on f.cliente_id = l.cliente_id
  ),
  sobra as (
    select d.usuario, d.cliente_id
      from dono d
      left join acesso a on a.email = d.usuario
     -- `is distinct from` e não `<>`: quem não tem carteira (admin, home) tem
     -- NULL dos dois lados em conversa sem dono, e `NULL <> NULL` é NULL, que o
     -- WHERE descarta — a linha sobreviveria justamente no caso que se quer
     -- limpar. Mesma armadilha do `??` da §22.6.1, na versão SQL.
     where d.dono_efetivo is distinct from a.carteira
  )
  delete from chat_leitura l
   using sobra s
   where l.usuario = s.usuario and l.cliente_id = s.cliente_id;

  get diagnostics n_apagou = row_count;
  raise notice '0127: chat_leitura tinha %, apagadas % marcas de quem não atendia, restam %',
    n_antes, n_apagou, n_antes - n_apagou;
end $$;
