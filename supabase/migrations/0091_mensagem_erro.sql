-- =============================================================================
-- 0091 · Guardar o MOTIVO da falha de envio
--
-- O que aconteceu em 19/08: dois disparos de template voltaram `status='failed'`
-- e não havia como saber por quê. O webhook recebia o motivo da Meta e fazia
-- `console.error` — ou seja, a explicação vivia só no log da Vercel, que é
-- efêmero e que nem todo mundo alcança. Na tela, o vendedor via "falhou" e
-- ponto.
--
-- É a mesma lição da §22.6.1, agora do outro lado: lá o texto do erro era
-- descartado por um `??`; aqui era gravado em lugar nenhum. O recado da Meta é
-- a ÚNICA pista em erros que não estão na documentação pública — perdê-lo custa
-- horas todas as vezes.
--
-- `chat_ligacao` já fazia certo (coluna `erro` desde a 0087). Isto alinha
-- `mensagens` ao mesmo padrão.
--
-- Seguro contra o ETL: o upsert de `src/etl/run.ts` lista as colunas que
-- escreve, e esta não está entre elas — o valor sobrevive a re-sincronização.
-- =============================================================================
alter table mensagens
  add column if not exists erro text;

comment on column mensagens.erro is
  'Motivo da falha de envio, como a Meta explicou (código + texto). Preenchido pelo '
  'webhook quando o status vira failed; nulo no caminho feliz. Existe porque o recado '
  'da Meta costuma ser a única pista em erros fora da documentação pública.';
