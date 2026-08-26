-- =============================================================================
-- 0106 · Botao de pausa — o aviso de intervalo para o cliente.
--
-- Pedido do usuario (25/08/2026): *"botao de pausa, o vendedor clica nesse botao
-- e vai um aviso para o cliente, algo como, pausa para intervalo, aguarde um
-- momento. a mensagem devera ser melhor elaborada por voce"*.
--
-- ---------------------------------------------------------------------------
-- TRES DECISOES QUE A VERSAO INGENUA ERRARIA
--
-- 1. **So dentro da janela de 24h.** Fora dela o envio livre falha (131047) ou
--    exigiria um template — e pausar nao vale R$ 0,43 por cliente. Com a janela
--    fechada o botao fica desabilitado, dizendo por que.
--
-- 2. **Uma vez por pausa.** Sem trava, cada clique repetido manda outro aviso
--    para quem ja foi avisado — vira spam justamente com quem esta esperando. A
--    rota recusa se a ULTIMA mensagem nossa ja for o aviso.
--
-- 3. **Uma conversa por vez, nao difusao.** O pedido fala de "o cliente", no
--    singular. Disparar para todas as conversas abertas do vendedor seria um
--    envio em massa disfarcado de botao — caro, irreversivel e sem previa.
--    Se um dia for esse o desejo, e outra funcionalidade, com confirmacao e
--    contagem, como o disparo em massa tem (§26).
--
-- ---------------------------------------------------------------------------
-- O TEXTO MORA NO BANCO, NAO NO CODIGO
--
-- Mesmo padrao de `chat_horario_atendimento` (0085) e das paginas legais
-- (§23.3): quem sabe o tom certo e o time, nao quem faz deploy. Se exigisse
-- commit, ficaria errado por meses.
--
-- O texto padrao evita "pausa para intervalo" literal: dizer ao cliente que voce
-- foi almocar convida a comparar a espera dele com o seu descanso. "Preciso me
-- ausentar por alguns minutos" entrega a mesma informacao — vou demorar, volto —
-- sem esse contraste, e promete o retorno, que e o que a pessoa quer saber.
-- =============================================================================

alter table crm_config
  add column if not exists texto_pausa text
    not null default 'Oi! Preciso me ausentar por alguns minutos. Já já retorno e te respondo — pode deixar sua mensagem que eu vejo assim que voltar 💜';

comment on column crm_config.texto_pausa is
  'Aviso enviado ao cliente quando o vendedor clica em Pausa no chat. Editavel em '
  '/admin -> Mecanismos. So e enviado dentro da janela de 24h: fora dela exigiria '
  'template, e pausa nao vale R$ 0,43. A rota recusa repeticao se a ultima mensagem '
  'nossa ja for este aviso.';
