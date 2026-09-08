-- =============================================================================
-- 0122 · Botões no template do WhatsApp (criação por dentro do sistema)
--
-- O pedido veio comparando com o RD Conversas: lá, ao criar um template, dá
-- para anexar um botão (CTA — link/telefone — ou Resposta rápida). Aqui
-- (§24/0090) o cadastro cria o template DE VERDADE na Meta, então o botão tem
-- de ir junto no componente `BUTTONS` da criação — não é um enfeite da tela.
--
-- `botoes` guarda o que foi ENVIADO à Meta, na ordem enviada, só para a lista
-- de "Templates desta linha" conseguir mostrar o que existe sem precisar
-- reconsultar a Meta (que devolve os botões, mas a rota já faz uma chamada por
-- abertura só para o status — não vale duplicar). Formato:
--   [{"tipo":"QUICK_REPLY","texto":"Quero saber mais"},
--    {"tipo":"URL","texto":"Ver catálogo","valor":"https://..."},
--    {"tipo":"PHONE_NUMBER","texto":"Ligar","valor":"+5591..."}]
-- Nulo/[] = sem botão, o caso de hoje. Não é coluna estruturada (tipo/texto/
-- valor em colunas próprias) porque só existe 1 template com botão até agora
-- e a lista é de tamanho variável — normalizar cedo demais é overengineering.
-- =============================================================================
alter table crm_templates
  add column if not exists botoes jsonb;

comment on column crm_templates.botoes is
  'Botões enviados à Meta na criação (QUICK_REPLY/URL/PHONE_NUMBER), na ordem '
  'em que foram enviados. NULO ou [] = sem botão. Só para exibição — quem manda '
  'é o componente BUTTONS montado em criarTemplate().';
