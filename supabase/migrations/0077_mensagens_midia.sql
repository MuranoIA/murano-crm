-- 0077 — coluna `midia` em `mensagens`
--
-- Contexto (12/08/2026): o ETL sempre chamou /v2/messages/history sem o parâmetro
-- `type`, cujo DEFAULT documentado é "text". Resultado: todo áudio, imagem, vídeo e
-- documento — dos dois lados da conversa — nunca entrou na base. Zero mídia em 68.477
-- mensagens. Como boa parte das clientes responde por ÁUDIO, o lado delas sumia: o
-- board mostrava "cliente não respondeu" em conversas que estavam em negociação ativa.
--
-- Com `type` corrigido, a API devolve a mídia dentro do próprio `content`, como JSON
-- url-encoded: {"file_name","file_path","file_extension","mimetype"}. Guardar isso cru
-- em `conteudo` poluiria o chat e o board (o vendedor veria "%7B%22file_name%22...").
--
-- Então: `conteudo` recebe um rótulo legível ("[áudio]", "[imagem]") e o objeto
-- original vai para esta coluna, preservando o `file_path` — que é o que permitirá
-- baixar o arquivo e transcrever o áudio do nosso lado (automático, sem depender do
-- botão "Transcrever" do painel do RD, que é manual, um clique por áudio).
--
-- Aditiva e idempotente: quem não manda a coluna no upsert deixa NULL, e nenhuma view
-- existente referencia `midia`.

alter table mensagens add column if not exists midia jsonb;

comment on column mensagens.midia is
  'Metadados do arquivo quando a mensagem é mídia (áudio/imagem/vídeo/documento), '
  'vindos do /v2/messages/history: file_name, file_path, file_extension, mimetype. '
  'NULL em mensagens de texto. `conteudo` guarda o rótulo legível correspondente.';

-- só mídia: usado pelo passo de download/transcrição
create index if not exists mensagens_midia_idx on mensagens ((midia->>'file_path'))
  where midia is not null;
