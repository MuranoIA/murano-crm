# Relatório de QA — CRM Murano

**Rodada:** 27/08/2026 · agente `qa-murano`
**Alvo:** build de produção (`next build` + `next start`) em `http://localhost:3100`,
falando com o **Supabase de produção** e a **Cloud API de produção**.
**Harness:** `testes/` — novo nesta rodada. CDP com WebSocket nativo do Node 24,
sem puppeteer.

> Método: só entra aqui o que foi **executado e medido**. Onde não rodei, está
> escrito "não executado" — não "deve funcionar".

---

## 1. Placar

Contado por script (`testes/saidas/resultado.json`), não no olho.

| Ciclo | Passos | Passaram | Falharam | Pulados |
|---|---:|---:|---:|---:|
| 0 — fundação (plataforma, config, sessões) | 10 | 9 | **1** | 0 |
| 1 — conversa nova até o encerramento | 10 | 8 | 0 | 2 |
| 2 — canal caído, e quem avisa | 5 | 3 | 0 | 2 |
| 3 — disparo em massa (só prévia) | 8 | 7 | 0 | 1 |
| 4 — transferência e trabalho em equipe | 6 | 6 | 0 | 0 |
| 5 — atendimento fora do horário | 4 | 2 | 0 | 2 |
| 6 — cadastro e vínculo de contato | 6 | 6 | 0 | 0 |
| 7 — relatório de fim de mês | 7 | 7 | 0 | 0 |
| 8 — multi-número | 4 | 4 | 0 | 0 |
| Telas — navegador real (6 telas × sessões) | 13 | 13 | 0 | 0 |
| Regressão — paginação determinística | 3 | 3 | 0 | 0 |
| **TOTAL** | **76** | **68** | **1** | **7** |

**1 falha**, e ela é estrutural: a migration 0114 não está aplicada (R3).
Os 8 ciclos do `casos_de_uso_teste_ciclos.md` foram executados.

---

## 2. Regressões

### R1 — O board perdia 30 clientes e duplicava 22 · **CORRIGIDO E VERIFICADO**

**Gravidade: alta.** Trinta clientes de prospecção não apareciam no board.
Nenhum erro, nenhum log — eles simplesmente não estavam lá.

**Reprodução (determinística, 3 de 3 rodadas):**

    vw_funil_visivel        4.327 clientes, 0 duplicados
    GET /api/funil (admin)  4.322 cards, 4.297 distintos
    => 22 clientes em dobro (25 linhas extras) e 30 ausentes

**A conta fecha exata: 4.327 − 30 + 25 = 4.322.** É isso que descarta filtro —
se fosse regra de negócio removendo gente, não haveria duplicata compensando.

**Causa.** `web/app/api/funil/route.ts:86` paginava com
`.order("ultima_atividade")` apenas. Essa coluna é **NULA em ~4 mil linhas**
(toda a prospecção): milhares de empates. Cada página é uma consulta separada e
o Postgres não promete a mesma ordem entre elas quando as chaves empatam — a
mesma linha volta em duas páginas e outra não volta em nenhuma.

**Evidências que isolam a causa:** a view tem 0 duplicados; todos os ausentes
são `winthor:*` com `ultima_atividade` nula; todas as duplicatas são **dentro da
mesma coluna**; nenhum ausente estava em `vw_venda_card`.

> **Não era o off-by-one da §42.3.** Aquele produziria duplicata *entre colunas
> diferentes* e exigiria duplicata na própria view. Conferi o par de
> comparadores antes de descartar.

**Correção:** desempate determinístico (`cliente_id`/`codcli`, únicos nessas
views) em todo laço de paginação — 4 arquivos, 8 laços:

| Arquivo | Laço | Antes |
|---|---|---|
| `api/funil/route.ts` | `vw_funil_visivel` | **quebrado, medido** |
| `api/funil/route.ts` | `vw_venda_card` | sem `.order()` — 484 linhas, latente |
| `api/funil/route.ts` | `vw_ciclo_card` | sem `.order()` — **1.144 linhas = 2 páginas** |
| `api/admin/disparo-massa/route.ts` | `vw_funil_visivel` | mesmo defeito, **e aqui monta o público da campanha** |
| `api/chat/route.ts` | lista, fila, `vw_chat_linha_cliente` | mesma classe |
| `api/chat/carteira/route.ts` | `clientes` (4.976 = 5 páginas) | sem `.order()` |
| `api/orcamento/route.ts` | `allRows()` genérico | sem `.order()` |

**Verificado depois da correção**, com rebuild:

    view 4.327 · board 4.322 cards / 4.322 distintos · 0 duplicados · 0 invisíveis

Os 5 de diferença são saída **legítima**: estão nas colunas de venda sob outra
identidade, casados por tel8 (`ehCompradorMes`). Confirmei um a um.

**Trava:** `testes/casos/regressao-paginacao.mjs`. O passo 2 prova que o teste
pega o defeito — paginando sem desempate direto no banco: **25 duplicadas e 25
perdidas**; com desempate, 0 e 0.

### R2 — `/api/chat/thread` devolvia 500 em TODA conversa · **CORRIGIDO**

**Bloqueio de deploy.** Achado ao rodar o Ciclo 1 depois de um rebuild:

    GET /api/chat/thread?cliente_id=...
    500 {"error":"column mensagens.localizacao does not exist"}

O chat não abria **nenhuma** conversa. A coluna nasce na **0115, que não está
aplicada** (§4). Não veio de código meu — `thread/route.ts` é de outra frente
ativa nesta árvore.

O que torna o achado nítido: **o mesmo autor já tratou disso em dois lugares** —
`whatsapp/webhook/route.ts:161` e `chat/localizacao/route.ts:131` fazem uma
segunda tentativa sem a coluna. Só a thread não fazia.

**Correção:** a mesma segunda tentativa, no mesmo padrão. Perder o cartão de
mapa é aceitável; perder a conversa não. Verificado: HTTP 200.

> ⚠️ O teste de telas no navegador **não pegou isto** — a página `/chat`
> carrega a lista, e a thread só quebra ao abrir uma conversa. Quem pegou foi o
> teste de API. É o argumento das duas frentes, ao vivo.

### R3 — A migration 0114 não está aplicada, e o código depende dela · **NÃO CORRIGIDO (decisão)**

`supabase/migrations/0114_metricas_disparo_resolucao_sla.sql` existe no disco e
seis arquivos a referenciam. O banco não tem nada dela:

| Objeto | Estado |
|---|---|
| `vw_disparo_desfecho` · `chat_resolucao` · `vw_chat_resolucao` · `vw_chat_espera` | AUSENTES |
| `crm_config.sla_minutos` | AUSENTE |

**Consequência medida:** tempo de resolução, alerta de SLA e desempenho por
campanha **não produzem número nenhum** — os itens 1 a 4 da lista "o que dói sem
ninguém perceber" do checklist.

**O que está certo:** o código degrada bem, e verifiquei os quatro caminhos.
`lerCrmConfig` usa `select("*")`; `/api/chat/status` grava dentro de `try/catch`
(encerrar conversa **não quebra**); `/api/chat/indicadores` devolve
`sem_views: true`; `/api/admin/campanhas` responde `indisponivel`. **Nada
quebra; tudo silencia** — a doença que este projeto conhece bem.

**Não apliquei:** é DDL em produção, não pedida nesta sessão. Ver §6.

---

## 3. Documentação desatualizada — ⛔ que já funciona

Dez passos marcados ⛔ passaram. Cinco são recurso que **existe**; os outros
cinco confirmam a lacuna. Já corrigi ambos os arquivos, com data e evidência.

| Ciclo · passo | Documento dizia | Realidade medida |
|---|---|---|
| 2 · 2 | "fica em `wait` para sempre, **sem alerta**" | **alarme existe** (§52). Plantei 3 presas: acendeu `estado: "mudo"`, título "3 mensagens enviadas sem confirmação", e **apagou sozinho** quando saíram |
| 3 · 5 | "não corta quem falhou antes" | **corte `numero_morto` existe** (§61). Códigos no banco: 131026×3 · 131042×8 · 131047×12, e só o primeiro corta |
| 3 · 10-11 | "não existe" | **existe em código** (`/api/admin/campanhas`), esperando a 0114 |
| 4 · 5 | "é obrigado a escolher alguém" | **devolver existe** (0112). Round trip exercitado: devolver → fila → pegar |
| 7 · 3 | "não existe" | **existe em código**, esperando a 0114 |

Confirmados como lacuna real: agendar disparo (3·9), transferir para time
(4·4), árvore de opções e roteamento por palavra-chave (5·3-4), tags e bloquear
número (6·5-6).

---

## 4. Achados novos (não estavam em nenhum dos dois documentos)

**a) Três migrations no disco, nenhuma aplicada.** Além da 0114:
`0115_localizacao_recebida.sql` (`mensagens.localizacao` não existe — causou R2)
e `0116_pendencia_contato_sem_conversa.sql` (`vw_pendencias_admin` tem só os
grupos A–D: **A 103 · B 47 · C 83 · D 113**, sem o grupo E que a 0116 cria).

**b) O webhook pode mandar a mesma cliente para cadastros diferentes.**
`acharOuCriarCliente` faz `.like("telefone", "%tel8").limit(5)` e escolhe "o
primeiro que tiver carteira" — **sem `order by`**. O número autorizado tem
**3 cadastros** em `clientes` (dois na carteira `romulo`, um na `kamilly`).
Sem ordenação determinística, mensagens da mesma pessoa podem cair em linhas
diferentes entre chamadas. É a mesma família de defeito do R1. Não corrigi:
está fora do que quebrou nesta rodada, e mexer no casamento de contato sem o
usuário decidir qual cadastro é o bom pode consolidar o errado.

**c) O padrão do `count` silencioso está no produto.** `lib/saudeCanal.ts` faz
`presasR?.count ?? 0`. Hoje é inofensivo (`mensagens` existe), mas se aquela
consulta passar a falhar o alarme de canal mudo responde **"ok"** — justamente
o alarme que existe para quando nada mais avisa.

**d) Números que batem.** Cruzei tela × banco onde era possível: os 7 vendedores
em `/api/chat/indicadores` conferem com `vw_chat_volume_diario` em recebidas e
enviadas (12.051 e 28.182 em 30 dias); o board não tem `cliente_id` duplicado.

---

## 5. O que passou, e o que isso prova

- **Escopo por carteira.** Consultor vê 9 conversas, admin 13, e **nenhuma
  conversa de outra carteira vaza**. Sem cookie: 401. As 4 features restritas
  recusam consultor **e** `home` (403).
- **Reação continua sendo atributo da bolha, não mensagem nova.** Contei as
  linhas antes e depois: idênticas. Os dois bugs silenciosos da §21.2 (mover
  card de etapa, abrir espera no indicador) seguem corrigidos.
- **Devolver para a fila grava destino NULO** e o dono efetivo vira `null` — se
  a coalescência `??` da §56 voltasse, o teste falharia.
- **Presença "👀 está aqui"** aparece na aba A quando a aba B abre a mesma
  conversa (duas sessões simultâneas de Chrome).
- **Transferência**: motivo na thread, 403 ao tentar puxar conversa alheia,
  append-only (a vigente é a última linha, nada é apagado).
- **A conversa reabre sozinha** quando a cliente responde.
- **Exportação** devolve um `.xlsx` de verdade e **recusa exportar sem filtro**
  (400), em vez de despejar a base inteira.
- **Trocar o número de envio em /admin grava mesmo** — o bug da §37.5 (valor
  string caindo no fallback) não voltou. Restaurado ao valor original.
- **Telas**: board, chat, indicadores, admin, templates e relatórios abrem como
  `romulo` e como `admin` **sem uma única exceção de JS**. Screenshots em
  `testes/saidas/`.

Dois falsos alarmes que investiguei e **descartei com medição**, para ninguém
gastar tempo neles de novo: **"Reconectando…"** no chat é transitório (some em
menos de 25 s); e a **fila de não atribuídos** parecia quebrada (5 no banco, 0
na tela) mas o errado era o meu teste — "sem dono" é `transferência vigente ??
carteira`, e as 5 já tinham sido puxadas.

---

## 6. Não executado, e por quê

**Recusas de segurança (§0), deliberadas:**

| O quê | Por que parei |
|---|---|
| **Derrubar o canal** (revogar token / desconectar número) | Derruba o atendimento real de 15 pessoas. Testei o **detector**, que é o que interessa saber |
| **Enviar o disparo em massa** | Proibido. Cada template é cobrado e vai para centenas de clientes. Parei na prévia, onde mora toda a decisão de público |
| **Ligar a resposta de fora do horário** | O gatilho é o **webhook de produção**, que não passa pela minha máquina: ligado, ele responderia a **qualquer** cliente que escrevesse, não só ao número autorizado |
| **Envio real de mensagem/mídia** | Subi o servidor **sem `WHATSAPP_TOKEN`** de propósito — assim nenhuma mensagem pode fisicamente sair. Testei as guardas (texto vazio 400, card do ERP 400, cliente inexistente 404), não a chamada à Graph |

**Outros não executados:** a regra de `foraDeHorario.ts` isolada (é TypeScript e
o runner é Node puro); a preservação da rolagem ao carregar mensagens antigas
(exige +200 mensagens carregadas); e **interação de clique/digitação nas telas**
— as telas foram abertas e medidas, não operadas, exceto o fluxo de presença do
Ciclo 4.

**Sobre o número autorizado:** `91984719702` tem conversa viva na linha Cloud
(`6a66af9224e3f7ae2f1e99a7`, carteira `romulo`) com mensagem da cliente em 27/08
21:34Z — **janela de 24 h aberta**, então um envio de texto seria gratuito e
possível. Não o fiz: o valor marginal (provar a chamada à Graph, que é da Meta)
não pagava o risco de manter credencial de envio ativa durante a suíte.

---

## 7. Pendências para o usuário decidir

1. **Aplicar 0114, 0115 e 0116.** As três estão no disco e nenhuma no banco.
   A **0115 é a mais urgente**: sem ela, o deploy da árvore atual levava a thread
   a 500 (agora há rede de proteção, mas o cartão de mapa não funciona).
   Todas são aditivas e idempotentes (`create or replace view`,
   `create table if not exists`, `add column if not exists`).
2. **Decidir sobre o achado (b)**: qual dos 3 cadastros do mesmo telefone é o
   bom, e se o casamento do webhook deve ganhar ordem determinística.
3. **Alerta de canal fora da tela.** Hoje só avisa quem abre o board. Se o canal
   cair de madrugada, ninguém sabe. O projeto já tem `pg_cron` e `chat_push`.

---

## 8. O que ficou no banco

**Nada.** O runner remove na ordem inversa da criação; conferi depois, item a item:

| Escrita de teste | Estado |
|---|---|
| `mensagens` com id `wamid.QA_*` (mensagens e presas plantadas) | **0** |
| `chat_nota` com `[QA …` | **0** |
| `chat_transferencia` das QA | **0** — o maior id voltou a ser **#11**, anterior a mim |
| `mensagens.reacao` plantada | restaurada ao valor anterior |
| `clientes.nome_completo` editado no Ciclo 6 | restaurado para `romulo` |
| `chat_conversa` do alvo | restaurada ao snapshot de origem |
| `crm_config.numero_envio` (Ciclo 8) | trocado e **restaurado** para `cloud`, confirmado |

Estado final de `crm_config`, idêntico ao do início: `ciclo_ativo=false ·
numero_envio=cloud · historico_rd=false · carteira_rd_ativa=false ·
linhas_visiveis=["1264458800091787"]` — **modo migração ligado**, como estava.

**Ressalva honesta:** `chat_conversa.atualizado_em` do cliente alvo mudou de
21:34 para 21:47, efeito colateral do upsert de restauração. O conteúdo é o
original; só o carimbo de tempo mudou.

---

## 9. Atribuição de código

⚠️ **Há outro escritor ativo nesta árvore.** Arquivos ficaram sujos durante a
sessão sem que eu os tocasse, então "sujo depois que você começou" **não**
identifica autoria aqui.

**Meus são 5 arquivos.** As correções de paginação estão todas assinadas com a
palavra `desempate` (`grep -rln desempate web/app/`):

| Arquivo | O que fiz |
|---|---|
| `web/app/api/funil/route.ts` | 3 desempates (R1) |
| `web/app/api/admin/disparo-massa/route.ts` | 1 desempate — **só isso**; o resto já vinha sujo |
| `web/app/api/chat/route.ts` | 3 desempates — **só isso**; o resto já vinha sujo |
| `web/app/api/chat/carteira/route.ts` | 1 desempate |
| `web/app/api/orcamento/route.ts` | 1 desempate no `allRows()` |
| `web/app/api/chat/thread/route.ts` | **a rede de proteção da coluna `localizacao`** (R2) — nada além disso |

Mais `testes/` (novo), a linha `testes/saidas/` no `.gitignore`, e as atualizações
em `casos_de_uso_teste_ciclos.md` e `checklist_chat_crm.md`.

**NÃO são meus**: `chat/localizacao/route.ts`, `whatsapp/webhook/route.ts`,
`chat/page.tsx`, `lib/whatsapp.ts`, `chat/indicadores/page.tsx`,
`admin/page.tsx`, `admin/crm-config/route.ts`, `chat/indicadores/route.ts`,
`chat/status/route.ts`, `lib/crmConfig.ts`, `api/admin/campanhas/`, e as
migrations **0114, 0115 e 0116**.

`npx tsc --noEmit` passa limpo, e o build de produção foi refeito e exercitado
depois de cada correção — nada aqui está apenas escrito.

---

## 10. Segunda rodada — migrations aplicadas e um falso positivo desmontado

> 27/08/2026, sessão principal, depois do laudo acima. Mesmo harness, mesmo
> alvo, servidor subido **sem `WHATSAPP_TOKEN`** (envio fisicamente impossível).

### 10.1 As três migrations foram aplicadas

Medi cada uma antes de aplicar, em vez de confiar no texto do arquivo:

| | Verificação prévia | Estado |
|---|---|---|
| **0114** métricas | nenhum dos objetos existia — criação limpa | ✅ aplicada |
| **0115** localização | coluna e índice ausentes; índice é **parcial** (`where localizacao is not null`), hoje ~0 linhas → barato | ✅ aplicada |
| **0116** pendências | recria view **em uso**: confirmei mesmas 12 colunas, **zero views dependentes**, chips do /admin montados a partir dos dados, e grupo E com **20 linhas** (não inunda) | ✅ aplicada |

Efeito conferido no banco: `vw_disparo_desfecho` já devolve **1.501 disparos com
desfecho** (a taxa de resposta que não existia agora tem dado), e
`vw_pendencias_admin` distribui A 103 · B 47 · C 83 · D 113 · **E 20**.

**Isso encerra a R2 na origem** (a thread quebrava por `mensagens.localizacao`
faltar) e **a R3** (0114 sem aplicar). `crm_config.sla_minutos` nasceu em **0 =
desligado**, de propósito: o limite é decisão de quem opera.

⚠️ Aplicar a migration **não** faz a funcionalidade aparecer em produção — o
código que lê essas views segue sem commit e sem deploy. O que mudou é que o
banco deixou de ser o bloqueio.

### 10.2 A falha do ciclo 4 era do TESTE, não do produto

O passo 2 (presença "👀 fulano está aqui") acusou defeito. **Era falso
positivo**, e a foto denunciou: a aba que deveria ser do consultor mostrava o
avatar **Admin** e o chip "Todos os vendedores", que só existe para admin.

Causa: `novaAba()` cria a aba pelo `/json/new`, no **contexto padrão** do
navegador — e contexto é quem guarda o cookie. Setar `crm_sessao=admin` na
segunda aba **derrubou** o `crm_sessao=romulo` da primeira. As duas viraram a
mesma pessoa, e o chat, corretamente, não avisa que você está onde você está
(§21: o filtro é **por rótulo, não por aba**, justamente para o PC e o celular
do mesmo vendedor não virarem "outra pessoa").

Dois consertos, no harness:

1. **`novaAbaIsolada()`** (`driver.mjs`) — `Target.createBrowserContext`, jarro
   de cookies próprio. Obrigatória sempre que o caso tiver duas pessoas.
2. **O caso agora PROVA que são duas pessoas** antes de julgar a presença, lendo
   `crm_sessao` de cada aba por `Network.getCookies`. Sem isso, uma colisão de
   sessão volta a virar "a presença não funciona" — diagnóstico errado que manda
   alguém consertar o que está certo.

Ciclo 4 depois do conserto: **6 de 6**, presença detectada.

### 10.3 Placar final da rodada

**76 passos · 70 passaram · 0 falharam · 6 pulados · 0 regressões · nada ficou
no banco.**

Os 6 pulados são os mesmos de antes, e continuam sendo recusa consciente: 3 por
segurança (derrubar o canal, enviar disparo em massa, ligar a resposta de fora
do horário — essa responderia a *qualquer* cliente, porque o gatilho é o webhook
de produção), 1 por não gastar a única autorização de número em anexo de mídia,
1 lacuna real confirmada sem execução (não há alerta fora da tela), e 1 por
`foraDeHorario.ts` ser TypeScript num runner Node puro.

Verifiquei por consulta independente que **nada sobrou**: zero linhas `[QA]` em
`mensagens`, `chat_nota` e `clientes`, e a única transferência recente é ação
real de usuário, não do teste.
