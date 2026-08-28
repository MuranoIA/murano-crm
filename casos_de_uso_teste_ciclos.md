# Casos de uso — testes de ciclo completo (Murano Pulse)

> Cada ciclo junta vários itens do checklist numa jornada real. O objetivo não é
> testar a funcionalidade isolada, é ver se o **ciclo inteiro fecha** — porque é
> nos pontos de transição entre uma etapa "pronta" e uma "parcial" que a coisa
> costuma quebrar na frente do cliente.
>
> Para cada passo: ✅ esperado funcionar liso · ⚠️ esperado funcionar com
> limitação conhecida (descrita) · ⛔ vai travar, porque o recurso não existe.

---

## ⏱️ EXECUTADO em 27/08/2026 — suíte `testes/`

Rodado contra o build de produção (`next build` + `next start`) falando com o
Supabase e a Cloud API **de produção**. Placar contado por script:
**76 passos · 68 passaram · 1 falhou · 7 pulados**.
Relatório completo em `testes/RELATORIO.md`; saída bruta em
`testes/saidas/resultado.json`.

**Cinco ⛔ deste arquivo já não são verdade** — os passos foram executados e
funcionaram. Estão corrigidos in loco abaixo, marcados com **[27/08]**:

| Ciclo · passo | Era | É |
|---|---|---|
| 2 · 2 e 4 | "fica em `wait` para sempre, sem alerta" | alarme de canal mudo **existe** (§52) |
| 3 · 5 | "não corta quem falhou antes" | corte `numero_morto` **existe** (§61) |
| 3 · 10-11 | "não existe" | **existe em código**, esperando a migration 0114 |
| 4 · 5 | "não dá para devolver para a fila" | **existe** (0112, §56) |
| 7 · 3 | "tempo de resolução não existe" | **existe em código**, esperando a 0114 |

**A única falha da suíte** é estrutural e vale para os três últimos itens acima:
a migration **0114 está no disco e não foi aplicada no banco**. O código já a
referencia e degrada em silêncio — nada quebra, e nenhum número aparece.

**Sete passos não foram executados**, cinco deles por recusa deliberada de
segurança (derrubar o canal de produção, enviar disparo em massa, ligar a
resposta automática que responde a cliente real). Cada um está anotado no
relatório com o motivo.

---

## Ciclo 1 — Conversa nova, do zero ao encerramento

**Objetivo:** validar o caminho mais comum: cliente manda mensagem pela primeira vez, alguém atende, resolve, encerra.

1. Cliente novo manda mensagem no WhatsApp pela primeira vez ✅
2. Conversa aparece na fila de "não atribuídos" ✅
3. Atendente clica em "✋ Pegar" ✅
4. Atendente responde com texto ✅
5. Atendente envia uma imagem (foto de produto) ✅
6. Atendente envia 3 imagens juntas ✅
7. Cliente reage a uma das mensagens com emoji ⚠️ — a reação aparece na bolha, mas o atendente não consegue reagir de volta
8. Atendente tenta responder citando uma mensagem específica do cliente ⚠️ — só a citação recebida aparece; enviar citando não é possível
9. Atendente adiciona uma nota interna sobre o combinado ✅
10. Atendente encerra a conversa com motivo ✅
11. Cliente responde de novo dias depois ✅ — conversa reabre automaticamente

**O que observar:** se o passo 7-8 muda o tom do atendimento (cliente espera reação/resposta citada e não recebe), e se o encerramento com motivo (passo 10) está de fato virando dado de tabulação utilizável depois.

---

## Ciclo 2 — Conversa parada, sem ninguém perceber

**Objetivo:** validar o pior cenário: o canal cai e a operação não sabe.

1. Simular queda do canal (revogar token ou desconectar número de teste no Meta Business Suite)
2. Atendente tenta enviar mensagem ✅ **[27/08 — CORRIGIDO NA REALIDADE]** — a mensagem fica em `wait`, e a partir de 3 presas há mais de 15 min o board mostra a faixa "3 mensagens enviadas sem confirmação" (`lib/saudeCanal.ts`, §52). Exercitado: plantei 3 presas, o alarme acendeu (`estado: "mudo"`) e apagou sozinho quando elas saíram
3. Verificar se `api/whatsapp/diag` mostra o problema — sim, mas só quem sabe entrar na rota admin ⚠️
4. Verificar se existe qualquer notificação automática do problema ⛔ — **continua ⛔, mas com nuance [27/08]**: há alarme de TELA (faixa no board + diagnóstico em /admin). Não há push nem e-mail, então o canal caindo de madrugada só aparece quando alguém abre o sistema

**O que observar:** quanto tempo alguém demoraria, na operação real, para perceber que mensagens não estão saindo. Esse é o ciclo de maior risco do checklist inteiro.

---

## Ciclo 3 — Disparo em massa, do template à resposta

**Objetivo:** validar a campanha inteira, não só o envio.

1. Cadastrar/consultar template aprovado ✅
2. Ver status de aprovação do template ✅
3. Montar lista de destinatários por segmento ✅
4. Sistema corta quem já tem conversa aberta ✅
5. Sistema corta quem falhou em disparo anterior ✅ **[27/08 — JÁ EXISTE, §61]** — corte `numero_morto` na prévia. Só falha DO NÚMERO (131026/131051): 131047 é janela fechada, que é justamente quem o template existe para alcançar, e 131042 é erro nosso de pagamento. Vale o ÚLTIMO desfecho, em janela de 90 dias
6. Definir variável de texto livre da campanha ✅
7. Rodar o disparo com a aba aberta ✅
8. Fechar a aba no meio do disparo ⚠️ — interrompe; retoma depois pelo ETL, mas sem botão de pausa
9. Tentar agendar o mesmo disparo pra amanhã 8h ⛔ — não existe, o laço roda no navegador
10. Depois do disparo, checar quantos responderam ⚠️ **[27/08 — EXISTE EM CÓDIGO]** — `/api/admin/campanhas` calcula a taxa sobre os ENTREGUES. Hoje responde `indisponivel` porque a migration 0114 (`vw_disparo_desfecho`) não foi aplicada
11. Checar quantos foram entregues/lidos, campanha a campanha ⚠️ **[27/08]** — mesma rota do item 10, mesma pendência: entregue/lido/falhou por template já está codificado, e só produz número depois da 0114

**O que observar:** o ciclo hoje termina no envio. Não fecha o loop de "isso funcionou?" — passos 5, 9 e 10 são os que mais pesam pra decisão de investir em mais campanhas.

---

## Ciclo 4 — Transferência e trabalho em equipe

**Objetivo:** validar o que acontece quando mais de uma pessoa mexe na mesma conversa.

1. Atendente A assume uma conversa ✅
2. Atendente B abre a mesma conversa ✅ — aparece "👀 fulano está aqui"
3. Atendente A transfere para atendente C, com motivo ✅
4. Atendente C tenta transferir para o time GC (não para uma pessoa) ⛔ — transferência é só entre atendentes, não entre filas
5. Atendente C percebe que pegou a conversa errada e tenta devolver pra fila ✅ **[27/08 — JÁ EXISTE, 0112/§56]** — `devolver: true` grava destino NULO e a conversa volta para a fila. Exercitado como round trip (devolver → fila → pegar). Só vale para conversa SEM dono comercial: cliente com carteira devolve 422 com o recado de transferir para alguém, para não criar órfão
6. Verificar o histórico de transferências na thread ✅ — append-only, com motivo

**O que observar:** os passos 4 e 5 são os que mais geram fricção no dia a dia — força o atendente a "empurrar" a conversa pra alguém em vez de simplesmente soltar.

---

## Ciclo 5 — Atendimento fora do horário

**Objetivo:** validar o comportamento fora do expediente.

1. Ativar horário de atendimento em /admin ✅ (nasce desligado, precisa ligar)
2. Simular mensagem chegando fora do horário configurado ✅ — mensagem de ausência dispara
3. Verificar se a conversa cai automaticamente numa árvore de opções (suporte/vendas/etc.) ⛔ — não existe bot de menu
4. Verificar se a mensagem é roteada por palavra-chave pro time certo ⛔ — não existe

**O que observar:** hoje o "fora do horário" é só uma mensagem estática. Qualquer expectativa de auto-atendimento além disso vai falhar.

---

## Ciclo 6 — Cadastro e vínculo de contato

**Objetivo:** validar a ponte entre o chat e o cliente já cadastrado no ERP.

1. Mensagem chega de um número novo, sem cadastro ✅
2. Atendente cria contato pelo chat ✅
3. Sistema tenta vincular automaticamente ao cliente do ERP (por CPF/telefone) ✅
4. Atendente edita um dado do contato direto na conversa ✅
5. Atendente tenta aplicar uma tag livre nesse contato (ex: "cliente VIP") ⛔ — não existe
6. Atendente tenta bloquear um número que está enviando spam ⛔ — não existe
7. Consultar histórico de todas as conversas desse contato, não só a atual ✅

**O que observar:** o vínculo com o ERP (passo 3) é o ponto mais crítico — vale testar com número duplicado ou CPF divergente pra ver o comportamento de borda.

---

## Ciclo 7 — Relatório de fim de mês

**Objetivo:** validar se dá pra prestar contas da operação com o que existe hoje.

1. Abrir `/chat/indicadores` e puxar volume de conversas do mês ✅
2. Puxar tempo médio de primeira resposta (mediana/p90) ✅
3. Puxar tempo médio de **resolução** (abertura → encerramento) ⚠️ **[27/08 — EXISTE EM CÓDIGO]** — `chat_resolucao` + `vw_chat_resolucao` (0114) e a conta já está em `/api/chat/indicadores` (mediana, p90, até 1h, até 24h). A rota devolve `sem_views: true` enquanto a 0114 não for aplicada
4. Puxar conversas por atendente ✅
5. Comparar abertas × fechadas × sem resposta do mês inteiro (não só hoje) ⚠️ — só dá o número do dia, sem série histórica
6. Exportar tudo em Excel/CSV ✅

**O que observar:** dá pra fechar volume e produtividade por atendente; não dá pra fechar "quanto tempo levamos pra resolver" nem comparar mês a mês — isso hoje é conta manual.

---

## Ciclo 8 — Multi-número (Murano Pro / Murano Shop / Murano Professional)

**Objetivo:** validar se a operação com mais de um número de WhatsApp é confiável.

1. Mensagem chega pelo número "Murano Shop" ✅ — webhook carimba a linha certa
2. Mensagem chega pelo número "Murano Professional" ✅
3. Atendente responde uma conversa que veio pelo "Murano Shop" ⚠️ — a resposta sai pelo número configurado globalmente em `crm_config.numero_envio`, que pode não ser o mesmo que recebeu
4. Trocar o número de envio padrão em /admin ✅ — mas afeta todo mundo, não só essa conversa

**O que observar:** esse é o ciclo mais propenso a gerar confusão silenciosa — cliente manda pra um número e recebe resposta de outro, sem ninguém perceber que a rota está errada.

---

## Como usar

1. Rode os ciclos na ordem, num ambiente de teste (número de teste, não produção).
2. Para cada passo, anote o resultado real ao lado do esperado (✅/⚠️/⛔) — se um ✅ falhar na prática, é regressão; se um ⛔ "funcionar por acidente", vale investigar por quê.
3. Cole este arquivo no Claude Code junto com o checklist auditado e peça para cruzar: "quais dos ⚠️ e ⛔ destes ciclos já têm item correspondente pendente no checklist, e quais são um problema novo que a auditoria não pegou."
