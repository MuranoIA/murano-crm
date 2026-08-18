-- =============================================================================
-- 0089 · Chat — separar as conversas por NÚMERO (Murano Pro × Murano Shop)
--
-- Hoje operamos dois números ao mesmo tempo, de propósito (§20.1):
--   · Murano Pro  (+55 91 2018-2357) — oficial, atendido pelo RD/Tallos
--   · Murano Shop (+55 91 9806-0032) — linha piloto, Cloud API direta
-- O chat mostrava as duas misturadas numa lista só. Esta migration dá o que
-- falta para separá-las.
--
-- 1) A LINHA DO RD VIRA UMA LINHA DE VERDADE NO CADASTRO.
--    `chat_linha` guardava só linhas da Cloud API, porque `linha_id` nasce do
--    webhook da Meta e o ETL do RD não tem esse conceito — conversa do RD tem
--    `linha_id` nulo. Sem uma linha para chamar de sua, o número oficial não
--    tinha rótulo, não aparecia em filtro nenhum e ficava implícito no "resto".
--    Recebe o id sintético 'rd', no mesmo espírito de `wa:<numero>` e
--    `winthor:<codcli>` (§16.3): id que não vem da Meta é prefixado/nomeado por
--    nós, nunca inventado no formato do provedor.
--
--    Consequência a conhecer: 'rd' não é phone_number_id — nada que fale com a
--    Graph API pode recebê-lo. O envio continua decidido por `canalDeResposta`
--    e por WHATSAPP_PHONE_NUMBER_ID, que esta migration não toca.
--
-- 2) `vw_chat_linha_cliente` — de qual linha é cada conversa.
--    Só olha mensagens COM `linha_id` (índice parcial `idx_msg_linha` já
--    existe), então custa proporcional ao volume da Cloud, não às 94 mil
--    mensagens do RD. Quem não aparece na view é conversa do RD.
--
--    Regra: a conversa pertence à ÚLTIMA linha que carimbou uma mensagem dela.
--    A migração de número é de mão única (RD -> Cloud, §16.5 Fase C), então
--    "tem linha alguma vez" e "está nessa linha hoje" não divergem na prática.
-- =============================================================================

insert into chat_linha (phone_number_id, numero, rotulo, ativo)
values ('rd', '+55 91 2018-2357', 'Murano Pro (RD Conversas)', true)
on conflict (phone_number_id) do nothing;

-- rótulos que a equipe usa ao falar dos dois números, em vez dos nomes de teste
update chat_linha set rotulo = 'Murano Shop (piloto)'
 where phone_number_id = '973434089176828' and rotulo = 'Linha piloto';

create or replace view vw_chat_linha_cliente as
select distinct on (m.cliente_id)
  m.cliente_id,
  m.linha_id,
  m.criada_em as ultima_em
from mensagens m
where m.linha_id is not null
order by m.cliente_id, m.criada_em desc;

comment on view vw_chat_linha_cliente is
  'De qual linha telefônica é cada conversa: a última mensagem que carrega linha_id. '
  'Cliente ausente da view = conversa do RD Conversas (linha sintética "rd" em chat_linha). '
  'Lida por /api/chat para o filtro por número na sidebar do chat.';
