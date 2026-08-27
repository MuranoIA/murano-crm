-- =============================================================================
-- 0111 · Enviar localizacao (enderecos salvos) e encaminhar mensagem.
--
-- Pedido do usuario (27/08/2026), dois itens do checklist marcados como
-- fundamentais: "Envio de localizacao" e "Encaminhar mensagem".
--
-- ---------------------------------------------------------------------------
-- POR QUE ENDERECO SALVO, E NAO A LOCALIZACAO DO NAVEGADOR
--
-- A tentacao e usar `navigator.geolocation` e mandar onde a pessoa esta. Duas
-- razoes para nao ser isso:
--
-- 1. **Nao e o caso de uso.** O que a cliente pergunta e "onde fica a loja",
--    nao "onde voce esta agora". Mandar a posicao do celular do consultor as
--    23h de um sabado e, alem de inutil, um dado pessoal dele que ninguem
--    pediu.
--
-- 2. **Nao funcionaria onde o CRM roda.** A tela vive dentro de um iframe (o
--    hub embute o CRM, e o board embute o chat na lupa). Em iframe
--    cross-origin o padrao do navegador para `geolocation` e `self`, entao
--    sem delegacao no `allow` de CADA nivel o pedido e recusado **sem prompt**
--    -- exatamente a armadilha do microfone que ja custou uma hora (§22.5), e
--    que exigiria mexer no repositorio do hub.
--
-- Endereco salvo resolve o caso real, sem permissao, sem dado pessoal e sem
-- dependencia de outro repositorio.
--
-- A Murano tem duas filiais (Venus e MK Cosmeticos, §12.3), entao a lista e
-- lista, nao um endereco so.
-- =============================================================================

alter table crm_config
  add column if not exists locais jsonb not null default '[]'::jsonb;

comment on column crm_config.locais is
  'Enderecos que o consultor pode enviar como localizacao no chat (0111). '
  'Cada item: {nome, endereco, lat, lng}. Editavel em /admin -> Mecanismos, porque '
  'quem sabe a coordenada certa e quem esta na loja, nao quem faz deploy. Vazio = o '
  'botao de localizacao nem aparece.';

-- ---------------------------------------------------------------------------
-- Encaminhar: precisa saber DE ONDE veio, senao vira uma mensagem sem historia
--
-- A Cloud API nao tem "forward" -- encaminhar e reenviar o mesmo conteudo para
-- outro contato. A cliente do outro lado NAO ve o selo "Encaminhada" que o
-- WhatsApp poe; ela recebe uma mensagem normal. Do nosso lado, guardar a
-- origem e o que permite responder "de onde veio isto?" tres semanas depois --
-- e e o unico jeito de a thread nao mentir dizendo que o consultor escreveu
-- aquilo do zero.
--
-- Coluna em `mensagens` e nao tabela nova: e atributo da mensagem enviada, do
-- mesmo tipo de `midia_path` e `linha_id`. E nulo em 99,9% das linhas, entao
-- nao custa nada.
-- ---------------------------------------------------------------------------
alter table mensagens
  add column if not exists encaminhada_de text;

comment on column mensagens.encaminhada_de is
  'cliente_id de onde esta mensagem foi encaminhada (0111). A Cloud API nao tem '
  'forward: encaminhar e reenviar o conteudo, e a cliente NAO ve selo de encaminhada. '
  'Isto existe para a nossa thread nao fingir que o texto nasceu ali.';
