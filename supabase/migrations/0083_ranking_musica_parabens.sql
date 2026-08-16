-- =============================================================================
-- 0083 · Música da tela de parabéns do Ranking
--
-- O painel do ranking (repo murano-bi-ranking-vendas) toca sons SINTETIZADOS
-- (samba/pagode em WebAudio) quando aparece a tela de parabéns. Esta migration
-- cria o lugar onde o admin guarda uma MÚSICA PRÓPRIA, configurada no CRM
-- (menu Ranking → 🎵 Música dos parabéns).
--
-- Duas peças, nenhuma tabela nova:
--   1) bucket público `ranking-musica` — o arquivo de áudio em si
--      (mesmo padrão do `ranking-fotos`: público porque as TVs leem sem sessão)
--   2) chave `parabens_musica` em `bi_config` — JSON com {url, nome, segundos,
--      formato, cortado, atualizado_em}. A edge fn `bi-ranking-vendas` devolve
--      esse JSON no payload e em `?comando=1`; o painel toca por `segundos`
--      (20) e volta ao som sintetizado se a chave não existir.
--
-- O arquivo já chega cortado em 20s pelo navegador do admin (WAV mono). Quando
-- o navegador não consegue decodificar (codec exótico dentro de um .mp4), o
-- original sobe inteiro com `cortado=false` e QUEM corta é o player do painel —
-- o teto de 20s vale nos dois caminhos. Vídeo nunca é exibido: o painel usa
-- sempre um elemento <audio>, que ignora a trilha de vídeo do container.
--
-- Aditiva e idempotente: não altera nada existente.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ranking-musica', 'ranking-musica', true, 20971520,
  array[
    'audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac',
    'audio/wav','audio/x-wav','audio/wave','audio/ogg','audio/webm',
    'video/mp4','video/webm','video/quicktime','video/x-m4v'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Sem policy em storage.objects, igual ao `ranking-fotos`: bucket público é
-- servido por /storage/v1/object/public/... sem passar por RLS, e a escrita
-- fica exclusiva do service_role (que ignora RLS) usado pela rota do CRM.

-- A chave em si é criada pelo app (upsert em bi_config) no primeiro upload.
-- Nada a inserir aqui: sem a chave, o painel usa o som padrão.
