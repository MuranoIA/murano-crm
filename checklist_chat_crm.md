# Checklist — Casos de Uso de Chat CRM (baseado no RD Conversas)

> **Auditado contra o código em 27/08/2026.** Cada `[x]` traz o arquivo ou a
> migration responsável. `[~]` = existe em parte, com a limitação escrita ao
> lado — foi o rótulo mais usado, e é o mais útil: "meio pronto" descrito é
> acionável, "pronto" otimista vira surpresa na frente do cliente.
>
> Placar: **59 prontos · 18 parciais · 30 pendentes** (107 itens).

## 1. Canais e Conexão

- [x] Conectar número de WhatsApp via API oficial (Meta Cloud API) — `api/whatsapp/webhook`, `lib/whatsapp.ts`
- [~] Suportar múltiplos números no mesmo sistema — **recebe** por vários (`chat_linha`, `linha_id`, 0080/0089/0094); **envia** por um só, o da env `WHATSAPP_PHONE_NUMBER_ID` (`linhaDeEnvio()`)
- [x] Roteamento de mensagens recebidas por número de origem — o webhook carimba `linha_id`; filtro na sidebar (0089)
- [~] Status de conexão do canal — `api/whatsapp/diag` mostra `health_status` sob demanda, mas é rota **temporária** de admin e a allowlist dela está desatualizada (§28.8)
- [x] Webhook de recebimento (texto, mídia, status de entrega) — `api/whatsapp/webhook`; recibos `wait→success→read` (§16.3)
- [ ] Reconexão automática / alerta quando o canal cai — **nada vigia.** `vw_etl_trigger_saude` é do ETL, não do webhook. O sintoma hoje é mensagem parada em `wait` para sempre (§28.3)
- [~] Outros canais além do WhatsApp — há um segundo canal (RD Conversas), mas não webchat, Instagram ou e-mail

## 2. Caixa de Entrada (Inbox)

- [x] Lista de conversas com preview da última mensagem — `api/chat`
- [~] Ordenação por mais recente / não lidas primeiro — recente/antiga existe (`menuOrdem`); "não lidas primeiro" não, mas a aba **Pendentes** cobre o caso
- [x] Contador de não lidas (badge) — `chat_leitura` (0079), por usuário; badge no título da aba
- [x] Filtro por status — Pendentes · Abertas · Resolvidas · Fila de espera · Minha carteira
- [x] Filtro por consultor/atendente — dropdown 🧑‍💼 (admin/home), filtra filas, busca e carteira
- [ ] Filtro por tag/etiqueta — **não existem tags** (ver seção 9)
- [x] Busca por nome, telefone ou conteúdo — local + trigrama no conteúdo (`pg_trgm`, 0081)
- [ ] Indicador de "digitando…" — a Cloud API **não entrega** esse evento; só daria para simular entre operadores
- [x] Lida/entregue (double check) — ticks ✓/✓✓/✓✓azul, de `mensagens.status`
- [x] Novas sem dono × já atribuídas — fila de não atribuídos com ✋ Pegar (§21)

## 3. Conversa Individual

- [x] Texto simples — `api/send-message`
- [x] Imagem única — `api/chat/enviar-midia`
- [x] Múltiplas imagens — `multiple` no seletor, com fila e contador (`fila.feito/total`)
- [x] Vídeo — mesmo caminho
- [x] Áudio (gravação e envio de PTT) — `alternarGravacao`, MediaRecorder
- [x] Documento/PDF — mesmo caminho
- [ ] Envio de localização — o webhook **recebe** (`webhook/route.ts:275`), mas não há como enviar
- [x] Recebimento e exibição de toda mídia — bucket privado `wa-midia` (0079)
- [x] Download/visualização de mídia recebida — `api/chat/midia`, URL assinada
- [~] Emojis e formatação — emoji pelo teclado; `*negrito*` funciona porque o WhatsApp interpreta, mas **não há botão** nem prévia da formatação
- [~] Responder mensagem específica — a **citação recebida** aparece (0086); citar ao enviar, não
- [~] Reagir a mensagem — reação **recebida** vira atributo da bolha (0086); reagir, não
- [ ] Encaminhar mensagem
- [ ] Apagar mensagem (local e/ou para todos)
- [ ] Editar mensagem enviada
- [~] Histórico completo com scroll infinito — a thread traz **200** e para (`api/chat/thread:44`). Há o botão "ver histórico anterior" (0103), que é outra coisa: traz o do número escondido
- [x] Notas internas — `chat_nota` (0082), papel amarelo na thread
- [x] Janela de 24 h com aviso visual — faixa com tempo restante e barra, contada **pelo canal de envio** (§37.2)

## 4. Templates e Variáveis

- [x] Cadastro de templates aprovados pela Meta — `api/admin/templates-whatsapp` (0090)
- [x] Envio de template fora da janela de 24 h — `api/send-template`
- [~] Variáveis fixas de sistema — só `{{1}}` = primeiro nome. **Saudação por horário não existe**
- [x] Variáveis de texto livre no disparo — o compositor do chat pede campo a campo; o disparo em massa pede uma vez para a campanha (§26.5)
- [x] Preview antes de enviar — no compositor e no cadastro
- [x] Status de aprovação (aprovado/rejeitado/em análise) — reconsultado a cada abertura da tela (§24.3)
- [ ] Log de falhas por template, para reprocessar — o motivo fica em `mensagens.erro` (0091) e aparece na bolha, mas **não há agrupamento por template nem reenvio em lote**
- [x] *(novo)* Consultor sugere template, admin avalia — `/templates` + `api/templates/sugestoes` (0110)

## 5. Disparos em Massa / Broadcast

- [x] Lista de destinatários por segmento/filtro — `/admin` → Templates → Disparo em massa (§26)
- [x] Excluir contatos com conversa já aberta — corte `ativo_demais` + anti-repetição
- [ ] Excluir contatos com falha de template anterior — a falha é conhecida (`mensagens.erro`), mas não entra nos cortes
- [ ] Agendamento (data/hora futura) — o laço roda **no navegador** (§26.2); agendar exige mover o envio para o servidor, e a cota do RD não cabe no tempo de uma rota da Vercel
- [~] Limite por lote — dá para escolher a quantidade; **não há teto por consultor**
- [~] Acompanhamento do disparo — `disparos_template` + aba Envios dão *enviado*; **entregue/lido/falhou por campanha, não**
- [ ] Taxa de resposta pós-disparo
- [~] Pausar/cancelar em andamento — fechar a aba interrompe (e o ETL é retomado no fim); não há botão de pausa da campanha

## 6. Distribuição e Atendimento

- [x] Atribuição manual — ↪ Transferir (`chat_transferencia`, 0081)
- [ ] Atribuição automática (round-robin, por regra, por horário)
- [x] Transferência entre atendentes — append-only, com histórico e motivo na thread
- [ ] Transferência entre filas/setores — `carteira_config.time` (IS/ISR/GC) existe, mas não é destino de transferência
- [x] Assumir conversa (self-assign) — ✋ Pegar, na fila de não atribuídos (§21)
- [ ] Devolver conversa para a fila — a transferência exige um destino; não há "para ninguém"
- [x] Múltiplos atendentes vendo o mesmo chat — presença por Realtime, "👀 fulano está aqui" (§21)
- [x] Fechar/encerrar com motivo — `chat_conversa` (0079); o motivo **é a nossa tabulação**
- [x] Reabrir conversa encerrada — automático, pelo webhook, quando a cliente responde
- [~] SLA — os indicadores **medem** tempo de resposta (mediana, p90, faixas, 0084); **não há alerta de estouro**

## 7. Contatos / CRM

- [x] Cadastro de contato vinculado ao número — `api/chat/novo-contato` (§35.2)
- [x] Vínculo com cliente existente (dedupe) — CPF e tel8 via `wth_reconciliar_vinculos()` (§10.5)
- [x] Edição de dados dentro do chat — `api/chat/contato` PATCH; ficha completa em 0109
- [x] Histórico de todas as conversas do contato — a thread é por cliente, não por atendimento
- [ ] Tags/etiquetas no contato
- [~] Campos customizados — a **ficha de cadastro** (0109) é configurável em /admin, mas serve ao cadastro no ERP, não a segmentação
- [ ] Bloquear/silenciar contato

## 8. Automação / Bot

- [ ] Fluxo de boas-vindas automático
- [ ] Árvore de decisão (menu de opções)
- [x] Resposta automática fora do horário — `chat_horario_atendimento` (0085). **Nasce desligada**, de propósito
- [ ] Roteamento automático por palavra-chave
- [ ] Handoff bot → humano — não há bot
- [x] Respostas rápidas / atalhos — `/atalho` no compositor, da casa ou pessoais (0082)

## 9. Tags, Etiquetas e Organização

- [ ] Criar/editar/excluir tags
- [ ] Aplicar múltiplas tags por conversa
- [ ] Filtrar inbox por tag
- [ ] Tags automáticas por regra

> Nada disto existe. **Vale conferir se é mesmo necessário** antes de construir:
> parte do que o RD resolvia com tag, aqui já é estrutura — carteira (RCA),
> etapa do funil, status da conversa e motivo do encerramento. Tag livre em cima
> disso costuma virar um segundo sistema de classificação que ninguém mantém.

## 10. Times, Usuários e Permissões

- [x] Cadastro de atendentes — `/admin` → Usuários (tabela `acesso`)
- [x] Perfis de permissão — admin · home · vendedor (`lib/papel.ts`)
- [x] Filas/times com atendentes vinculados — `carteira_config` (slug, rca_num, time)
- [x] Visualização restrita — escopo por carteira **no servidor** (`api/chat`, `lib/chatEscopo.ts`)
- [~] Log de ações — há trilha de transferência de conversa (0081), de carteira (0092), de encerramento (0079) e de avaliação de sugestão (0110). **Não há log geral** de quem leu/enviou o quê

## 11. Relatórios e Métricas

- [x] Volume de conversas por período — `/chat/indicadores` (0084)
- [x] Tempo médio de primeira resposta — mediana, p90 e faixas, com rajada e corte de 24 h (§21.1)
- [ ] Tempo médio de resolução — `chat_conversa` guarda o encerramento; a conta não existe
- [x] Conversas por atendente — indicadores, com escopo no servidor
- [ ] Taxa de resposta a disparos
- [~] Abertas × fechadas × sem resposta — as três filas dão o número de hoje; **não há série histórica**
- [x] Exportação — `api/relatorio` (Excel) e o CSV da tela de Pendências (§36.3)

## 12. Configurações Gerais

- [x] Horário de atendimento configurável — 0085
- [x] Mensagem de ausência — 0085 (desligada por padrão)
- [ ] Assinatura automática do atendente
- [x] Notificações — som (WebAudio), Notification API e **push** mesmo com a aba fechada (0096)
- [~] Multi-número: escolher qual número usar ao responder — a escolha existe, mas é **global**, do admin (`crm_config.numero_envio`, 0102), não por conversa
- [~] Auditoria/LGPD — `/privacidade` e `/termos` publicados (0088), RLS fechado em todas as tabelas (§12.5) e PII fora do repositório (§15.5). **Não há trilha de auditoria de acesso a dado pessoal**

---

## Os pendentes, por impacto

**Primeiro — o que dói sem ninguém perceber**

1. **Alerta de canal caído** (1). Hoje o sintoma é mensagem parada em `wait` e ninguém avisado. Já aconteceu: `subscribed_apps` vazio deixou o sistema mudo por horas (§28.3). Uma view de saúde + um aviso no /admin resolvem.
2. **Devolver conversa para a fila** (6). Quem pega por engano não tem saída — e é o gesto mais provável numa fila que qualquer um puxa. Uma linha em `chat_transferencia` com destino nulo.
3. **Scroll infinito na thread** (3). Para em 200 mensagens **sem dizer**. A conversa mais antiga simplesmente não existe para quem rola.

**Segundo — o que a operação vai pedir em semanas**

4. **Excluir de disparo quem falhou antes** (5). O dado já está em `mensagens.erro`; hoje o CRM re-dispara para número que não recebe no WhatsApp, e cada tentativa custa.
5. **Taxa de resposta pós-disparo** (5/11). É a única métrica que diz se o template presta — e vira o critério para aprovar as sugestões que a 0110 acabou de criar.
6. **Tempo médio de resolução** (11). `chat_conversa` já guarda o que falta contar.
7. **Encaminhar mensagem** (3). Pedido comum quando o assunto é de outra pessoa.

**Terceiro — precisa de decisão antes de código**

8. **Tags** (9): decidir se é mesmo necessário — ver a nota da seção.
9. **Atribuição automática** (6): só faz sentido com fila real; hoje a carteira do RCA já distribui.
10. **Agendamento de disparo** (5): esbarra no laço rodar no navegador (§26.2). Exige mover o envio para o servidor — decisão de arquitetura, não uma tela.
11. **Bot / árvore de decisão** (8): é o que o RD fazia e ninguém pediu de volta ainda.

**O que provavelmente NÃO vale construir**

- **"Digitando…"** (2): a Cloud API não entrega esse evento. Só daria para simular, e simular presença é mentir.
- **Editar mensagem enviada** (3): a Meta não oferece para mensagens de negócio.
- **Apagar para todos** (3): existe na API, mas some da tela sem sumir do print da cliente — cria a ilusão de desfazer.
