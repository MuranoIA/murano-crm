-- =============================================================================
-- 0154 · índice dos boletos em aberto (demanda #64)
--
-- ⚠️ ESTE ÍNDICE JÁ ESTAVA NO BANCO quando este arquivo nasceu: eu o criei
-- direto, por `execute_sql`, medindo o custo do filtro de cobrança — e não
-- gerei o arquivo na hora. É exatamente a dívida que a §19.2 registra ("toda
-- DDL aplicada vira arquivo numerado, mesmo quando aplicada primeiro pelo
-- painel"), e sem isto um banco recriado do zero sairia sem o índice e lento,
-- sem ninguém entender por quê. O `if not exists` torna a aplicação
-- idempotente: no banco de hoje ela não faz nada.
--
-- ---------------------------------------------------------------------------
-- POR QUE ELE EXISTE, medido em 03/10/2026.
--
-- A consulta que agrupa a dívida por cliente (com "quem vendeu") levava
-- 413 ms, e o plano mostrava o motivo: `Seq Scan` em `ent_neofin_cobranca`
-- descartando 21.551 linhas para achar 563.
--
--   antes:  Seq Scan · 21.551 linhas descartadas · 413 ms
--   depois: Index Scan ·                            15,8 ms
--
-- ⚠️ PARCIAL de propósito. A tabela tem 22 mil linhas e 97% delas são pagas,
-- canceladas ou pix — lixo para esta pergunta. Indexar a tabela inteira
-- custaria escrita em TODA sincronização da Neofin (que roda de minuto em
-- minuto) para guardar o que nunca é lido. Este índice tem 563 linhas.
--
-- Ele acelera tudo o que lê `vw_cliente_boleto`: o bloco de dívidas do painel
-- do contato, o chip "com dívida" da lista e o filtro de cobrança.
-- ---------------------------------------------------------------------------

create index if not exists idx_neofin_boleto_aberto
  on public.ent_neofin_cobranca (codfilial, numero_nf)
  where tipo_cobranca = 'boleto' and status_cobranca in ('pending', 'overdue');
