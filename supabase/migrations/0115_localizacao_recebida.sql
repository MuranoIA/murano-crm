-- =============================================================================
-- 0115 — localização na conversa: receber o ponto, e pedir o ponto atual
--
-- O webhook JÁ recebia `type: location` desde a 0079 e jogava fora tudo o que
-- importa: gravava o texto "[localização]" e descartava latitude, longitude,
-- nome e endereço, que vêm no mesmo payload. Havia 1 mensagem dessas no banco,
-- como rótulo, sem mapa — a cliente mandou onde fica o salão dela e o CRM
-- guardou a palavra "localização".
--
-- ⚠️ LOCALIZAÇÃO EM TEMPO REAL (a que fica atualizando sozinha no WhatsApp) NÃO
-- EXISTE nesta API, e isso foi verificado, não suposto:
--
--   - a referência de webhook da Meta para `location` descreve só o pino
--     estático: latitude, longitude, name, address, url. Nenhuma menção a
--     atualização contínua;
--   - a documentação de BSP (tyntec) afirma explicitamente que a WhatsApp
--     Business API não recebe live location.
--
-- O que a plataforma oferece no lugar, e é o que dá para chamar honestamente de
-- "onde ela está AGORA", é o **pedido de localização**
-- (`interactive.location_request_message`): um botão que abre a tela de
-- compartilhar no aparelho da cliente. Ela toca, e a posição do momento chega
-- como um `location` comum. É sob demanda, não contínuo — e a tela precisa
-- dizer isso, senão alguém vai olhar um ponto parado achando que está
-- acompanhando a pessoa.
-- =============================================================================

-- Uma coluna jsonb, e não cinco colunas soltas.
--
-- O contraponto óbvio é `midia_*` (0079), que é discreta. A diferença é o uso:
-- `midia_tipo` é FILTRADA (tem índice parcial), então merece coluna própria.
-- Localização é sempre lida inteira, para desenhar um cartão — nunca se procura
-- "mensagens com latitude > x". Cinco colunas que só andam juntas são cinco
-- lugares para esquecer de preencher.
alter table mensagens add column if not exists localizacao jsonb;

comment on column mensagens.localizacao is
  'Ponto no mapa da mensagem: {lat, lng, nome, endereco, url}. Preenchido pelo webhook '
  'quando a cliente compartilha, e pela rota de envio quando nos mandamos. NULO na '
  'esmagadora maioria das mensagens. Nao existe versao "ao vivo": a Cloud API entrega '
  'apenas o pino estatico (verificado na doc da Meta em 27/08/2026).';

-- Índice parcial: a conversa carrega 200 mensagens por vez e quase nenhuma tem
-- ponto. Sem o `where`, seria um índice do tamanho da tabela para encontrar
-- meia dúzia de linhas.
create index if not exists idx_msg_localizacao
  on mensagens ((localizacao->>'lat')) where localizacao is not null;
