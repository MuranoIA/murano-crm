-- =============================================================================
-- 0135 · As policies que faltavam na 0134
--
-- A 0134 nasceu no padrão desta casa: RLS ligado SEM policy, e `service_role`
-- atravessando. Serve para tudo que é escrito só pelo nosso servidor.
--
-- ⚠️ Só que quem escreve aqui é o HUB, e o hub tem uma regra própria, escrita
-- no `packages/supabase/src/server.ts` dele: *"Nao usamos service_role no app:
-- quem filtra e a politica no banco, nao o codigo."* Um cliente privilegiado
-- novo lá dentro seria a primeira exceção a essa regra — e exceção de segurança
-- que entra por conveniência não volta.
--
-- Então a inscrição passa a ser escrita pelo PRÓPRIO usuário, com a sessão dele,
-- e o banco é que decide o que ele alcança: a própria linha, nunca a de outro.
--
-- A ENTREGA não muda: continua saindo do CRM com `service_role`, que ignora RLS
-- — é o webhook do WhatsApp, o único lugar que sabe que uma cliente falou.
-- Dividir assim é o recorte certo: o dono da inscrição é quem se inscreve; o
-- dono do envio é o servidor.
--
-- A chave é o E-MAIL do JWT, e não `auth.uid()`, porque é o e-mail que amarra
-- as três pontas deste recurso — `acesso.email` (quem atende qual carteira),
-- `chat_push_inscricao.usuario` e esta tabela. Com `uid` seria preciso um join
-- a mais em toda consulta só para reencontrar a mesma pessoa.
-- =============================================================================

-- Sem GRANT o RLS nem chega a ser consultado: a política decide QUAIS linhas,
-- o privilégio decide SE a operação existe para aquele papel.
grant select, insert, update, delete on hub_push_inscricao to authenticated;
grant usage, select on sequence hub_push_inscricao_id_seq to authenticated;

-- Ler: só as próprias inscrições. É o que a tela usa para dizer "avisos
-- ligados neste aparelho" — e é o que impede alguém de listar os endpoints
-- dos colegas, que são endereços de entrega e não deviam circular.
drop policy if exists hub_push_le_o_proprio on hub_push_inscricao;
create policy hub_push_le_o_proprio on hub_push_inscricao
  for select to authenticated
  using (usuario = (auth.jwt() ->> 'email'));

-- Inscrever: só em nome próprio. O `with check` é o que impede alguém de
-- gravar uma inscrição com o e-mail de outra pessoa e passar a receber as
-- notificações dela.
drop policy if exists hub_push_inscreve_o_proprio on hub_push_inscricao;
create policy hub_push_inscreve_o_proprio on hub_push_inscricao
  for insert to authenticated
  with check (usuario = (auth.jwt() ->> 'email'));

-- Atualizar: a re-inscrição do mesmo navegador (que devolve o mesmo endpoint)
-- e o batimento de `visto_em`. `using` E `with check` — sem o segundo, daria
-- para pegar a própria linha e reescrever o `usuario` para o de outro, que é
-- a mesma brecha do insert por outro caminho.
drop policy if exists hub_push_atualiza_o_proprio on hub_push_inscricao;
create policy hub_push_atualiza_o_proprio on hub_push_inscricao
  for update to authenticated
  using (usuario = (auth.jwt() ->> 'email'))
  with check (usuario = (auth.jwt() ->> 'email'));

-- Desligar os avisos deste aparelho.
drop policy if exists hub_push_apaga_o_proprio on hub_push_inscricao;
create policy hub_push_apaga_o_proprio on hub_push_inscricao
  for delete to authenticated
  using (usuario = (auth.jwt() ->> 'email'));

comment on table hub_push_inscricao is
  'Inscrições de Web Push registradas no HUB (app.muranoprofessional.com.br), '
  'uma por navegador/aparelho. Separadas de chat_push_inscricao porque são de '
  'outra ORIGEM: outro service worker, outro endpoint, outra permissão. Em '
  'iframe cross-origin o navegador recusa a permissão de notificação antes de '
  'perguntar (medido em 14/09/2026), então a inscrição do time só pode nascer '
  'no documento de topo. Escrita pelo próprio usuário sob RLS (o hub não usa '
  'service_role); a ENTREGA sai do CRM, com service_role, a partir do webhook. '
  '`visto_em` é o batimento da aba em foco: a entrega pula quem carimbou há '
  'pouco, porque quem está olhando a tela não precisa de notificação.';
