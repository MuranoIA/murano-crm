-- ============================================================================
-- 0128 — nome de exibição em `acesso`, para quem atende sem carteira
--
-- Contexto: admin, home e o papel novo `pos-venda` passam a ter atendimentos
-- próprios no chat, mesmo sem RCA e sem carteira. O endereço de atendimento
-- dessas pessoas é o e-mail, sob o prefixo `u:` (ver lib/chatEscopo.ts) — e
-- e-mail não serve de rótulo na tela: "angelomelo@muranoprofessional.com.br"
-- num chip de filtro, ou na lista de "transferir para", é ilegível.
--
-- Derivar o nome do e-mail no código foi a primeira ideia e não presta: dá
-- "Angelomelo" e "Jonatassilva". O nome é dado de cadastro, e quem sabe
-- escrevê-lo é quem cadastra — mesmo argumento das páginas legais (§23.3), em
-- que o CNPJ mora no banco e não no commit.
--
-- O PAPEL `pos-venda` NÃO PRECISA DE MIGRATION: `acesso.papel` não tem CHECK
-- (conferido em 09/09/2026 — só existe `acesso_chat_layout_check`), e a
-- validação de papel mora na rota (/api/admin/usuarios). Fica registrado aqui
-- para quem procurar "onde o pos-venda foi criado" não perder tempo no banco.
-- ============================================================================

alter table acesso add column if not exists nome text;

comment on column acesso.nome is
  'Nome de exibição. Usado no chip de vendedor, na lista de transferência e no '
  'seletor de papel do board. NULO cai no e-mail — feio, mas nunca vazio.';

-- Palpite inicial para quem já existe: a parte antes do @, capitalizada, sem
-- separadores. Fica EDITÁVEL no /admin justamente porque é palpite — "Angelomelo"
-- está errado e a pessoa que cadastra conserta em dois segundos. Melhor um nome
-- aproximado que um e-mail cru na tela, e melhor um campo editável que um regex
-- cada vez mais esperto tentando adivinhar sobrenome.
update acesso
   set nome = initcap(replace(replace(split_part(email, '@', 1), '.', ' '), '_', ' '))
 where nome is null;
