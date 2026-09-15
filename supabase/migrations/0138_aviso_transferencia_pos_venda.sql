-- 0138 — Aviso automático de transferência para o pós-venda
--
-- Pedido do usuário: "quando o consultor transferir para a tati (pós-venda),
-- enviar uma mensagem informando isso para a cliente, algo como: estou
-- transferindo você para o setor de pós venda."
--
-- Duas coisas, e as duas precisam existir antes do deploy: o texto (que vai
-- para cliente REAL, então mora em config e não no código — mudar uma vírgula
-- não pode exigir um deploy, §23.3) e a marca de que uma transferência já
-- avisou (a trava de repetição).
--
-- ⚠️ A ORDEM IMPORTA: a rota grava `avisada_em` depois de enviar. Se o deploy
-- chegar antes desta migration, o update falha, e o envio JÁ aconteceu — a
-- cliente recebe e a trava não registra, então a próxima transferência avisa de
-- novo. É a armadilha da §62.3, com o agravante de a mensagem já ter saído.
-- Por isso o código tolera a coluna ausente, mas aplicar isto primeiro é o certo.

-- ---------------------------------------------------------------------------
-- 1) O texto e o interruptor
-- ---------------------------------------------------------------------------
-- Colunas em `crm_config` (linha única, id=1) e não tabela nova: é a decisão
-- da §30 — os interruptores de mecanismo moram todos ali, e uma tabela por
-- chave espalharia a mesma pergunta por vários lugares.
alter table crm_config
  add column if not exists aviso_pos_venda_ativo boolean not null default true,
  add column if not exists aviso_pos_venda_texto text,
  add column if not exists aviso_pos_venda_horas integer not null default 12;

-- NASCE LIGADO, ao contrário da resposta de fora do horário (§30.2 discute os
-- dois casos). Aquela nasceu desligada porque ninguém tinha pedido um robô
-- respondendo de madrugada; esta É o pedido — nascer desligada faria a
-- funcionalidade não existir até alguém descobrir onde ligar.
--
-- O texto padrão fica aqui e não no código pelo mesmo motivo de `paginas_legais`
-- (§23.3): quem sabe a palavra certa para a cliente é quem atende, não quem faz
-- deploy.
update crm_config
   set aviso_pos_venda_texto = coalesce(aviso_pos_venda_texto,
     'Vou te passar para o nosso setor de pós-venda, que cuida do seu pedido ' ||
     'daqui em diante. Já estou transferindo — em instantes alguém de lá fala ' ||
     'com você por aqui mesmo.')
 where id = 1;

comment on column crm_config.aviso_pos_venda_ativo is
  'Avisar a cliente quando a conversa é transferida para o pós-venda. Nasce ligado.';
comment on column crm_config.aviso_pos_venda_texto is
  'O texto que a cliente lê. Editável em /admin → Mecanismos.';
comment on column crm_config.aviso_pos_venda_horas is
  'Janela da trava anti-repetição: um aviso por conversa a cada N horas.';

-- ---------------------------------------------------------------------------
-- 2) A marca de "esta transferência avisou"
-- ---------------------------------------------------------------------------
-- A trava NÃO pode ser "existe mensagem tipo=auto recente", que é como a
-- resposta de fora do horário se protege: as duas usam `tipo='auto'` (para
-- ficarem fora do indicador de tempo de resposta, §21.1) e uma calaria a outra.
-- Marcando na própria linha da transferência, cada mecanismo conta o seu.
alter table chat_transferencia
  add column if not exists avisada_em timestamptz;

comment on column chat_transferencia.avisada_em is
  'Quando a cliente foi avisada desta transferência. NULO = não avisada (fora da janela de 24h, mecanismo desligado, ou destino que não é pós-venda).';

-- Serve à pergunta "esta conversa já foi avisada nas últimas N horas?", que é
-- a única leitura nova. Parcial porque a esmagadora maioria das linhas é NULA.
create index if not exists idx_transf_avisada
  on chat_transferencia (cliente_id, avisada_em desc)
  where avisada_em is not null;
