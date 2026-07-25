-- =============================================================================
-- LOGIN GOOGLE — tabela de acesso (fonte única de quem entra e como).
-- papel: 'admin' (vê tudo) ou 'vendedor' (vê só a própria carteira).
-- carteira = slug da carteira_config (null/ignorado p/ admin).
-- Adicionar/mudar acesso = 1 INSERT/UPDATE aqui. Aplicar SOMENTE no murano-conversas.
-- O callback do OAuth (web/app/auth/callback) lê esta tabela pelo e-mail Google
-- verificado e seta o cookie crm_sessao = 'admin' ou o slug da carteira.
-- =============================================================================
create table if not exists acesso (
  email     text primary key,
  papel     text not null default 'vendedor',   -- 'admin' | 'vendedor'
  carteira  text,                                -- slug da carteira_config (null p/ admin)
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
insert into acesso (email, papel, carteira) values
  ('ia@muranoprofessional.com.br',                 'admin',    null),
  ('romuloalbuquerque@muranoprofessional.com.br',  'admin',    'romulo'),  -- vendedor E admin
  ('luanasaavedra@muranoprofessional.com.br',      'vendedor', 'luana'),
  ('kamillylacorte@muranoprofessional.com.br',     'vendedor', 'kamilly'),
  ('milene@muranoprofessional.com.br',             'vendedor', 'milene')
on conflict (email) do update set papel=excluded.papel, carteira=excluded.carteira, ativo=true;
grant select on acesso to service_role;
