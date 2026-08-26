-- =============================================================================
-- 0103 · O historico do RD a um clique, dentro da conversa.
--
-- Contexto que o usuario deu (25/08/2026): as chaves de ligar/desligar existem
-- porque ele esta **testando aos poucos a saida do RD Conversas**, para ver o
-- comportamento de cada peca antes do corte. Nao sao preferencia de tela; sao
-- instrumento de migracao.
--
-- ---------------------------------------------------------------------------
-- O PROBLEMA QUE ISTO RESOLVE
--
-- Com `linhas_visiveis` em "so Murano Professional", abrir um cliente mostra
-- **"Sem mensagens ainda"** — e existem, no banco, 88.523 mensagens de 3.769
-- clientes da carteira (media de 23 por cliente; 2.553 conversaram nos ultimos
-- 30 dias, 567 nos ultimos 7). A tela nao estava so omitindo: estava
-- **afirmando algo falso**, e o vendedor ligava achando que era primeiro
-- contato.
--
-- Isso nunca foi pedido. O que o usuario tirou foi o RD de ORGANIZAR AS COLUNAS;
-- o historico foi junto porque `linhas_visiveis` decidia as duas coisas com a
-- mesma chave.
--
-- ---------------------------------------------------------------------------
-- A FORMA, ESCOLHIDA PELO USUARIO: botao, nao inline
--
-- A primeira proposta era misturar as mensagens do RD na thread quando a chave
-- estivesse ligada. O usuario preferiu **copiar o que o proprio RD faz**: um
-- botao "ver historico" dentro da conversa, que traz as mensagens antigas
-- quando clicado.
--
-- E melhor, e por tres razoes que valem registrar:
--   1. a thread continua sendo **o que aconteceu neste numero** — nao mistura
--      dois canais como se fossem um;
--   2. o historico vem **rotulado**, entao ninguem confunde a origem;
--   3. nao paga o custo de carregar 23 mensagens por conversa que quase nunca
--      serao lidas.
--
-- A chave decide se o botao e OFERECIDO. Desligada, a conversa mostra so o
-- numero em uso — que e o cenario "depois do corte", exatamente o que ele quer
-- poder simular.
--
-- NASCE LIGADA: hoje o historico esta escondido por efeito colateral, e o
-- estado correto de partida e "mostrar o que sabemos".
-- =============================================================================

alter table crm_config
  add column if not exists historico_rd boolean not null default true;

comment on column crm_config.historico_rd is
  'Oferecer o botao "ver historico" dentro da conversa quando existirem mensagens em '
  'linhas que `linhas_visiveis` esconde (na pratica, o RD Conversas). NAO mistura nada '
  'na thread por conta propria: o vendedor clica e as antigas aparecem, rotuladas. '
  'Desligada simula o cenario pos-corte, sem historico do RD em lugar nenhum.';
