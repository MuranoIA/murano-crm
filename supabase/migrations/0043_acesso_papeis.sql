-- Controle de acesso multi-papel. `papeis` = conjunto de papéis que o e-mail PODE assumir
-- (admin | home | vendedor); `papel` = padrão/atual. home = vê todas as carteiras como admin,
-- mas SEM B.I. Conversas / Ranking / Sincronizar / Disparo em massa. vendedor = só a própria
-- carteira, também sem essas 4. Romulo escolhe admin|vendedor; Joas escolhe admin|home.
-- A troca de papel (front) reescreve o cookie crm_sessao via /api/trocar-papel, validada
-- contra `papeis`. Aplicar só no murano-conversas.
alter table acesso add column if not exists papeis text[];
update acesso set papeis = array[papel] where papeis is null;

-- multi-papel
update acesso set papel='admin', papeis=array['admin','vendedor'] where email='romuloalbuquerque@muranoprofessional.com.br';
update acesso set papel='admin', papeis=array['admin','home']     where email='joas@muranoprofessional.com.br';

-- novos: jonata (admin) e lais (home)
delete from acesso where email in ('jonatassilva@muranoprofessional.com.br','lais@muranoprofessional.com.br');
insert into acesso (email, papel, papeis, carteira, ativo) values
  ('jonatassilva@muranoprofessional.com.br','admin',array['admin'],null,true),
  ('lais@muranoprofessional.com.br','home',array['home'],null,true);

-- angelo@ não é conta Google válida (não loga); angelomelo@ é o acesso real dele, admin.
delete from acesso where email = 'angelo@muranoprofessional.com.br';
update acesso set papel='admin', papeis=array['admin'], carteira=null, ativo=true
  where email='angelomelo@muranoprofessional.com.br';
