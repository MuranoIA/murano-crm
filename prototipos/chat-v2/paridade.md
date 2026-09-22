# chat-v2 — relatório de paridade (fase 5)

> **21/09/2026.** A pergunta desta fase não é "o v2 funciona?" — isso as fases
> 1 a 4 responderam. É **"o v2 faz tudo o que o chat de hoje faz?"**, porque é
> isso que a equipe vai perder no dia em que trocar de tela.

---

## ⚠️ A correção que esta fase existe para fazer

O relatório da fase 4 dizia **"41 de 41 capacidades (100%)"**. O número estava
certo e a conclusão, errada: ele contava o que tinha sido **planejado** para a
tela, não o que o chat de hoje **faz**. O chat antigo acumulou funções ao longo
de agosto e setembro que nunca entraram na lista da spec.

A paridade foi medida de dois jeitos, e o segundo é o que achou as lacunas:

1. **os 96 itens do `checklist_chat_crm.md`**, um a um;
2. **um diff de funções** entre `app/chat/page.tsx` e `app/chat-v2/` — procurando
   as rotas e os recursos que a tela antiga chama e a nova não.

O resultado: **13 funções que o chat de hoje tem e o v2 não**. Nenhuma delas é
detalhe — duas são filas de trabalho que a equipe usa o dia inteiro.

---

## 0. ESTADO EM 21/09/2026 (noite) — as 13 lacunas, uma a uma

| # | Lacuna | Estado | Prova |
|---|---|---|---|
| 1 | Fila "Esperando" | **não era lacuna** — ver abaixo | leitura dos dois códigos |
| 2 | Minha carteira | ✅ fechada (`c774c75`) | `prova-paridade.mjs` |
| 3 | Novo contato (+) | ✅ fechada (`c774c75`) | `prova-paridade.mjs` |
| 4 | Recados da supervisão | ✅ chip + selo + marca de visto ao abrir | `prova-paridade-b.mjs` (chip) |
| 5 | Ficha WinThor + "Pedir os dados" | ✅ no painel; substitui o editor nome+CPF | `prova-paridade-b.mjs` |
| 6 | Vincular ("É a mesma pessoa") | ✅ no painel, com confirmação | ⚠️ **não exercitado** (escreve vínculo real) |
| 7 | Pausa | ✅ no "⋯" da conversa | item presente; **não clicado** |
| 8 | Pedir localização | ✅ no "⋯" | clicado (simulado) |
| 9 | PDF | ✅ no "⋯" | item presente; **não clicado** (grava no Storage) |
| 10 | Navegação do produto | ✅ (sessão anterior) — agora medida | `prova-paridade.mjs` |
| 11 | Ordenação | ✅ "↓ Mais recentes / ↑ Mais antigas" | `prova-paridade-b.mjs` |
| 12 | Criar resposta rápida | ✅ rodapé do menu do "/" | formulário aberto; **não salvo** (tabela do time) |
| 13 | "Devolver" só sem dono | ✅ (sessão anterior) — agora medida nos dois sentidos | `prova-paridade.mjs` |

**A lacuna 1 era um erro deste relatório.** O chip "Esperando" do chat de hoje
é a fila `pendentes`: `aberta && nao_lida && !na_fila` (`app/chat/page.tsx`,
`contaPendentes`). É exatamente a régua do "Não lidas" do v2. O `sla` com
`vw_chat_espera` que o `/api/chat` devolve **não é lido pela tela antiga** —
`grep` por `sla` em `app/chat/` não acha consumidor. Não há o que portar. O
único detalhe de régua que faltava — o otimismo do "lida" valer só para quem
ATENDE a conversa (`souQuemAtende`) — foi portado.

**Bug achado de passagem (já estava no v2 desde a fase 2):** `/api/chat/respostas`
devolve o texto em `corpo`, e o compositor lia `r.texto`. Colar uma resposta
rápida punha `undefined` na caixa, e digitar `/` seguido de um trecho que não
batesse em nenhum atalho chamava `.toLowerCase()` em `undefined` — **a tela
inteira caía**. Corrigido com um mapa na leitura; a prova b cobre os dois casos.

**Selo "sem conversa" na agenda:** com a primeira página da lista (60) ele
marcava TODA a carteira, inclusive quem conversa todo dia — visto no screenshot.
Agora só aparece com a lista completa.

## 1. As lacunas — o que bloqueia o piloto

Ordenadas pelo que a equipe mais sentiria falta.

| # | Função no chat de hoje | Por que pesa | Onde mora hoje |
|---|---|---|---|
| **1** | **Fila "Esperando"** — quem falou por último e está sem resposta, com o tempo de espera | **É a fila principal de um atendimento.** "Não lidas" (que o v2 tem) é outra pergunta: lida é *eu abri*, esperando é *ninguém respondeu* | `vw_chat_espera`, `crm_config.sla_minutos` |
| **2** | **Minha carteira** — todo cliente do RCA, com ou sem conversa, como a agenda do WhatsApp | é por onde se começa uma conversa com quem nunca falou | `/api/chat/carteira` (§38) |
| **3** | **Novo contato (+)** — digitar um número e conversar | sem isto não há como falar com número novo pelo v2 | `/api/chat/novo-contato` (§35.2) |
| **4** | **Recados da supervisão** — fila das conversas com nota nova da supervisão | é o canal supervisor → consultora | `nota_nova` (0129) |
| **5** | **Ficha de cadastro WinThor + "Pedir os dados"** | é como um cliente novo vira cliente do ERP | `/api/chat/cadastro` (§47, 0109) |
| **6** | **Vincular ao ERP** | liga a conversa ao cadastro existente | `/api/chat/vincular` |
| **7** | **Pausa** — avisa a cliente que o vendedor vai se ausentar | tem duas travas (janela de 24h, cota) que precisam vir junto | `/api/chat/pausa` (0106) |
| **8** | **Pedir a localização da cliente** | o botão que abre o "compartilhar localização" no aparelho dela | `location_request` (§62.1) |
| **9** | **PDF da conversa** | exportar o histórico | `/api/chat/pdf` |
| **10** | **Navegação do produto** — Orçamento, Indicadores, e os itens do menu | o v2 só tem "voltar ao board"; quem está no chat não chega ao Orçamento nem aos Indicadores | `NAV` no `page.tsx` |
| 11 | Ordenação mais antiga / mais recente | o v2 só ordena pela mais recente | `menuOrdem` |
| 12 | **Criar** resposta rápida | o v2 **usa** as respostas; o antigo também **salva** o texto da caixa como uma nova | `POST /api/chat/respostas` |
| 13 | "Devolver para a fila" só onde faz sentido | o v2 oferece em **toda** conversa; o servidor recusa quando há dono comercial — é o anti-padrão da §56 (botão que aparece e falha) | `carteira_dona` |

> **Todas usam rotas que JÁ EXISTEM.** Nenhuma pede migration nem regra nova:
> é tela. É o que torna a lista fechável antes do piloto, e não um projeto novo.

---

## 2. Os 96 itens do checklist

Legenda: **✅** o v2 tem · **⚠️** tem em parte, ou diferente · **❌** o chat de
hoje tem e o v2 não · **➖** não é da tela de chat (outra tela ou o servidor; o v2
não muda nada ali) · **⛔** não existe em nenhum dos dois.

| | ✅ | ⚠️ | ❌ | ➖ | ⛔ | total |
|---|---|---|---|---|---|---|
| **Itens** | **34** | **7** | **3** | **35** | **15** | **96** (inclui 2 cancelados) |

**Dos 44 itens que são da tela de chat, 34 estão prontos, 7 em parte e 3
faltam.** Os 3 faltantes estão na lista de lacunas acima (novo contato, ficha
de cadastro e o SLA/Esperando).

> Contado por script, seção a seção, com a soma conferida contra as 96 caixas do
> arquivo. ⚠️ **A primeira versão deste quadro, contada no olho, dizia 39/8/29 —
> errada.** É o mesmo tropeço que o cabeçalho do checklist registra sobre si
> mesmo ("59 · 18 · 30 (107 itens)", quando eram 96).

### 1. Canais e Conexão (7)
Todos ➖ — conexão, webhook, roteamento por número, alerta de canal caído (que
aparece no **board** e no **/admin**, não no chat).

### 2. Caixa de Entrada (10)
| Item | v2 | |
|---|---|---|
| Lista com preview | ✅ | virtualizada |
| Ordenação | ⚠️ | só mais recente — lacuna 11 |
| Contador de não lidas | ✅ | **melhor**: sempre visível, sem abrir dropdown (achado 1 do laudo de UX) |
| Filtro por status | ⚠️ | tem Todas/Não lidas/Favoritas/Fila/Resolvidas; **faltam Esperando, Minha carteira e Recados** — lacunas 1, 2 e 4 |
| Filtro por consultor | ✅ | fase 4 |
| Filtro por tag | ⛔ | |
| Busca nome/telefone/conteúdo | ✅ | local + trigrama |
| "Digitando…" | ⛔ | a Cloud API não entrega |
| Entregue/lido | ✅ | |
| Sem dono × atribuídas | ✅ | fila + ✋ Pegar |

### 3. Conversa (18 + 2 cancelados)
| Item | v2 | |
|---|---|---|
| Texto · imagem · várias imagens · vídeo · documento | ✅ | |
| Áudio (gravação) | ⚠️ | construído; **não exercitado** — headless não tem microfone |
| Localização (endereço salvo) | ✅ | |
| Receber e baixar mídia | ✅ | |
| Emojis e formatação | ✅ | igual ao de hoje |
| Responder citando | ✅ | **melhor**: o de hoje só exibe a citação recebida (`be169bd`) |
| Reagir | ⚠️ | igual ao de hoje — exibe a recebida, não envia |
| Encaminhar | ✅ | |
| Histórico com scroll infinito | ✅ | ⚠️ preservação da rolagem não exercitada (igual ao de hoje) |
| Notas internas | ✅ | |
| Janela de 24h | ✅ | **melhor**: aparece antes de escrever |
| Apagar / editar | — | cancelados pelo usuário em 27/08 |

### 4. Templates (8)
Envio fora da janela, variáveis, prévia e motivo da falha na bolha: **✅**.
Cadastro, status de aprovação e sugestão de template: **➖** (`/admin`, `/templates`).

### 5. Disparo em massa (8)
Todos **➖** — `/admin`.

### 6. Distribuição e atendimento (10)
| Item | v2 | |
|---|---|---|
| Atribuição manual · transferir · assumir · presença · fechar com motivo · reabrir | ✅ | |
| Devolver para a fila | ⚠️ | aparece onde não deveria — lacuna 13 |
| **SLA** | ❌ | o de hoje tem a fila "Esperando" com o tempo; o v2 não — lacuna 1 |
| Atribuição automática · entre filas | ⛔ | |

### 7. Contatos (7)
| Item | v2 | |
|---|---|---|
| **Cadastro de contato** | ❌ | lacuna 3 |
| Edição no chat | ⚠️ | nome + CPF; faltam ficha e "vincular" — lacunas 5 e 6 |
| **Campos customizados (ficha 0109)** | ❌ | lacuna 5 |
| Histórico | ✅ | |
| Dedupe | ➖ | servidor |
| Tags · bloquear | ⛔ | |

### 8. Automação (6)
Respostas rápidas **⚠️** (usa, não cria — lacuna 12). Fora do horário **➖**
(servidor). Boas-vindas, árvore, palavra-chave e handoff **⛔**.

### 9. Tags (4)
Todos **⛔**.

### 10. Times e permissões (5)
Visualização restrita **✅** (mesmo escopo no servidor). O resto **➖**.

### 11. Relatórios (7)
Todos **➖** — `/chat/indicadores` e `/api/relatorio`. ⚠️ Mas o v2 **não tem
link** para os Indicadores (lacuna 10).

### 12. Configurações (6)
Notificações **✅** (fase 4). Assinatura **⛔**. O resto **➖**.

---

## 3. ⚠️ O checklist está desatualizado em 4 itens

Os quatro itens que ele marca como **"pendente da 0114"** — tempo de resolução,
alerta de SLA, entregue/lido por campanha e taxa de resposta pós-disparo — têm
as views **no banco hoje** (`vw_chat_resolucao`, `vw_chat_espera`,
`vw_disparo_desfecho` e `crm_config.sla_minutos`, conferidos em 21/09). A 0114
foi aplicada depois da auditoria de 27/08. Não mexi no checklist: ele é de
outra frente, e corrigi-lo sem conferir cada tela seria trocar uma afirmação
velha por outra não verificada.

---

## 4. A suíte `testes/` contra as duas telas

### 4.0 Linha de base COMPLETA contra o chat de hoje (22/09/2026)

`CHAT_TELA=/chat`, build de `feat/chat-v2` com `NEXT_PUBLIC_HUB_ORIGIN`,
servidor na 3100 com `SIMULACAO_ENVIO=1 ENSAIO_VISIVEL=1`:

**188 passos · 152 passaram · 22 falharam · 14 pulados · nada ficou no banco.**

A suíte **não é verde no código de produção** — estas 22 são o piso. Uma falha
do v2 só é regressão do v2 se NÃO estiver nesta lista:

| Caso | Passos que falham no chat de hoje |
|---|---|
| ciclo10 (equipe simultânea) | as 24 caem na fila · p90 < 3 s · dois números (2 passos) |
| ciclo11 (iframe do hub) | carrega no iframe · microfone com e sem `allow` · duas sessões · tempo real (5) |
| ciclo2 | alarme de canal mudo (o documento diz ⛔) |
| ciclo3 | status de aprovação dos templates |
| ciclo4 | presença "👀 fulano está aqui" |
| ciclo8 | trocar número de envio em /admin (a chave saiu com o fim do RD, §69) |
| ciclo9 | chat abre sem exceção (romulo e admin) · sair de "Reconectando…" |
| regressões | board mantém estado · chat mantém estado · citação rola (2) · planilha 5.000 · envio por conversa |

⚠️ **O ciclo 11 continua falhando com o build certo** (com
`NEXT_PUBLIC_HUB_ORIGIN`) e com as URLs idênticas às do master — então não era
a parametrização, como se suspeitava. A causa segue aberta; é da suíte ou do
ambiente, não do v2.

Log: `suite-chat.log` no scratchpad da sessão; `testes/saidas/resultado.json`.

### 4.1 A MESMA suíte contra o /chat-v2 (22/09/2026) — nenhuma regressão

`CHAT_TELA=/chat-v2`, mesmo build, mesmo servidor:

**188 passos · 153 passaram · 22 falharam · 13 pulados** — o mesmo placar do
chat de hoje (152/22/14).

Comparado caso a caso, 20 das 22 falhas são **as mesmas** nas duas telas. As
diferenças, nos dois sentidos:

| Passo | /chat | /chat-v2 | Leitura |
|---|---|---|---|
| ciclo10 — marca de leitura por usuário | ✅ | ❌ | só API (`/api/chat` + `/api/chat/lida`) |
| prévia do card sob demanda | ✅ | ❌ | só o **board** (`/api/funil/previas`) |
| ciclo10 — as 24 caem na fila | ❌ | ✅ | só API |
| planilha de 5.000 | ❌ | ✅ | só `/admin` |

Nenhum desses quatro passos toca a tela do chat-v2, e **a branch não mexeu em
nenhuma das rotas envolvidas** (`git diff origin/master` vazio para
`api/chat/route.ts`, `api/chat/lida`, `api/funil`, `page.tsx`,
`lib/chatEscopo.ts`). O servidor é o mesmo código nas duas rodadas: a
diferença é o dado ao vivo. `/api/chat` lê a `vw_chat_conversa`, que é
materializada e atualiza a cada 2 min (0139); a prévia do card depende de
mensagens que chegam durante a rodada. Por isso aparecem trocando de lado.

**Conclusão: a suíte não aponta regressão do v2.** As 22 falhas são dívida da
suíte (ou do ambiente), a tratar numa frente própria — não bloqueiam o piloto.

### 4.2 O que dizia a rodada anterior (incompleta)

**Estado em 21/09/2026: só a LINHA DE BASE rodou, e incompleta.**

A suíte foi parametrizada para dirigir qualquer uma das telas
(`CHAT_TELA=/chat-v2 node testes/run.mjs`; ver `testes/api.mjs`, `TELA_CHAT`).
A primeira rodada foi contra o **chat de hoje** (`/chat`), para ter com o que
comparar, e parou no ciclo 9 por um erro MEU (`api` no topo de módulo) — já
corrigido; os 32 casos carregam.

Até onde rodou: **71 passaram · 14 falharam · 10 pulados** — CONTRA O CHAT DE
HOJE. Log: `prototipos/chat-v2/suite-chat.log`.

⚠️ **Isto muda a leitura da próxima rodada.** A suíte não está verde nem no
código de produção. Antes de atribuir qualquer falha ao v2, é preciso separar:

| Falha na linha de base | Leitura provável (a confirmar) |
|---|---|
| ciclo8 passo 4 — `numero_envio` → 400 "mecanismo desconhecido" | teste velho: a chave saiu com o fim do RD (§69/0131) |
| ciclo11 — 5 passos do iframe | ⚠️ **pode ser efeito da parametrização que eu fiz** (origem do quadro e do `postMessage` passaram a sair de `api.BASE`). Rodar o ciclo11 no `master` para decidir |
| ciclo4 passo 2 e ciclo11 "tempo real" | presença/Realtime — dependem do broadcast chegar a esta máquina |
| ciclo10 — latência p90 < 3 s | máquina com dois builds concorrentes e disco a 99% |
| ciclo2 — alarme de canal mudo | o documento diz ⛔ e o teste espera — conferir qual está certo |

**Próximos passos, nesta ordem:**
1. rodar o ciclo11 no `master` (sem a parametrização) para saber se a falha é minha;
2. rodar a suíte inteira contra `/chat` de novo (a rodada parou no ciclo 9);
3. rodar contra `/chat-v2` e comparar caso a caso com a linha de base.

---

## 5. Recomendação

**Não levar o v2 ao piloto antes de fechar as lacunas 1 a 10.** Um piloto com
elas mandaria a consultora de volta ao chat antigo para metade do trabalho do
dia — e o piloto mediria a falta das funções, não a tela nova.

O custo é de **tela, não de sistema**: as 13 lacunas usam rotas que já existem.
A ordem sugerida segue o impacto: primeiro as filas (Esperando, Minha carteira,
Recados), depois o que cria conversa (novo contato, ficha, vincular), depois o
resto.
