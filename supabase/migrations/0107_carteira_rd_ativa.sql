-- =============================================================================
-- 0107 · Interruptor: a carteira do RD ainda vale como dono do cliente?
--
-- Pedido do usuario (26/08/2026): *"a lista de clientes da carteira de um
-- vendedor deve obedecer apenas o que consta no banco relacionado a RCA e nao
-- relacionado a carteira do rd conversas, nao quero que fiquem resquicios,
-- residuos, de dados do rd conversas em nosso sistema... se for necessario,
-- crie outros botoes de desligamento em administracao"*.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA COLUNA DESLIGA
--
-- As views do funil decidem o dono assim:
--
--     COALESCE(ccr.slug, c.carteira)
--                 |          |
--                 |          +-- tag `carteira <nome>` do painel do RD (§4)
--                 +------------- RCA oficial do WinThor via wth_vinculo (§10.3)
--
-- Com o interruptor DESLIGADO a segunda metade sai, e o dono passa a ser
-- exclusivamente o RCA. Cliente sem RCA ativo deixa de ter dono e cai na fila
-- de nao atribuidos (0100) -- que e visivel a todos e de onde qualquer um pega.
-- Ele NAO some da tela; muda de lugar.
--
-- ---------------------------------------------------------------------------
-- ⚠️ MEDIDO ANTES DE ESCREVER (26/08/2026) -- o numero que decide isto
--
--   4.420 clientes  RCA e carteira do RD concordam ....... nada muda
--     210 clientes  divergem ......................... o RCA passa a mandar
--     335 clientes  SO tem carteira do RD ............ PERDEM o dono
--       8 clientes  nao tem nenhum dos dois .......... ja estavam sem dono
--
-- Dos 335, **233 existem no WinThor** e o RCA deles e de gente que NAO esta em
-- `carteira_config`: Francisco (2) 76 casos, Jorge (53) 38, Maiara (9) 37,
-- Henry (30) 29, Administrativo Venus (11) 20, Natalia (47) 7, Jennifer (31) 4.
-- Ou seja: sao clientes de OUTROS times (GC), que so apareciam nas carteiras do
-- IS/ISR porque alguem poe a tag no painel do RD. Perde-los das carteiras atuais
-- e exatamente o que foi pedido -- e o caminho para devolve-los a um dono e
-- cadastrar aquele RCA em `carteira_config`, uma linha por vendedor (§14.1).
-- Os outros 102 nao existem no WinThor: nao sao clientes de RCA nenhum.
--
-- **149 desses 335 tem conversa ativa nos ultimos 30 dias** e vao para a fila no
-- dia em que a chave for desligada. E por isso que isto e um interruptor com
-- volta, e nao um `create or replace view` definitivo: ligar de novo devolve
-- tudo ao estado de hoje, sem migration e sem deploy.
--
-- ---------------------------------------------------------------------------
-- NASCE LIGADA -- o padrao e o comportamento de hoje
--
-- Mesmo instinto de `WHATSAPP_ENVIO_PADRAO`, da `chat_horario_atendimento` e do
-- `original` em `chat_layout` (§29.3): a migration entra sem mover a carteira de
-- ninguem, e a mudanca acontece quando o admin decidir, olhando a previa.
-- =============================================================================

alter table crm_config
  add column if not exists carteira_rd_ativa boolean not null default true;

comment on column crm_config.carteira_rd_ativa is
  'true (padrao) = o dono do cliente e COALESCE(RCA, carteira do RD), como sempre foi. '
  'false = so o RCA do WinThor manda; quem nao tem RCA ativo cai na fila de nao '
  'atribuidos. Desligar move 335 clientes (149 com conversa ativa) para a fila -- '
  'a maioria e de RCA de outro time, que ganha dono de volta ao ser cadastrado em '
  'carteira_config. Reversivel: religar devolve tudo ao estado anterior.';

-- ---------------------------------------------------------------------------
-- As views passam a LER o interruptor, em vez de terem a regra fixa.
--
-- Substituicao cirurgica sobre a definicao vigente, com verificacao -- mesmo
-- padrao (e mesmo motivo) das 0104/0105: reescrever as ~300 linhas das duas
-- views aqui criaria uma copia que diverge no proximo ajuste. O bloco FALHA se
-- o padrao nao aparecer exatamente uma vez em cada view, entao nao ha como
-- aplicar pela metade em silencio.
--
-- `vw_funil` (a do ETL) muda junto com `vw_funil_visivel` (a da tela) pelo
-- motivo de sempre: se so uma mudasse, o ETL e o board discordariam sobre de
-- quem e o cliente, e o sintoma seria um card sumindo da carteira mas
-- continuando a ser sincronizado como dela.
-- ---------------------------------------------------------------------------
do $$
declare
  alvo constant text := 'COALESCE(ccr.slug, c.carteira) AS vendedor';
  novo constant text :=
    'CASE WHEN (SELECT cfg.carteira_rd_ativa FROM crm_config cfg WHERE cfg.id = 1) IS FALSE '
    'THEN ccr.slug ELSE COALESCE(ccr.slug, c.carteira) END AS vendedor';
  v text; def text; n int;
begin
  foreach v in array array['vw_funil','vw_funil_visivel'] loop
    def := pg_get_viewdef(('public.' || v)::regclass, true);
    n := (length(def) - length(replace(def, alvo, ''))) / length(alvo);
    if n <> 1 then
      raise exception 'em % esperava 1 ocorrencia de "%", achei %', v, alvo, n;
    end if;
    execute 'create or replace view public.' || v || ' as ' || replace(def, alvo, novo);
  end loop;
end $$;
