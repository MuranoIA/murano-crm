# Laudo de performance — onde o CRM gasta tempo

> Medido em 11/09/2026, contra o banco de produção, com o build de produção
> rodando local. **Nada aqui é estimativa de leitura de código**: cada número
> saiu de uma medição, e o método está descrito para poder ser refeito.
>
> Motivo do laudo: depois de remover o RD Conversas (§69), ficou registrado que
> aquele não era o gargalo. Este documento responde qual é.

---

## 0. Como foi medido

Um preload de Node (`instrument.cjs`) envolve o `fetch` global **antes** de o
Next subir e registra cada ida ao Supabase — duração, bytes e alvo — sem tocar
no código do app:

```
NODE_OPTIONS="--require ./instrument.cjs" npx next start -p 3313
```

Isso dá a contagem exata de round-trips por requisição, que é o número mais
difícil de obter lendo código (está espalhado por `Promise.all`, laços de
paginação e helpers).

⚠️ **A máquina de medição é um notebook falando com o Supabase na nuvem**, então
cada ida e volta custa ~170–220 ms, contra poucos milissegundos em produção
(Vercel colada ao banco). Por isso o laudo separa, sempre, **o que é rede** de
**o que é trabalho do servidor** — e as conclusões se apoiam só na segunda.
Comparações finas entre casos parecidos usam **mediana de rodadas
intercaladas** (A,B,A,B…), porque a rede daqui tem outliers de segundos.

---

## 1. O retrato

| rota | idas ao banco | dados | tempo (local) |
|---|---|---|---|
| `/api/funil` (board) | **19** | **2,7 MB** | 3,4 s |
| `/api/chat` | **20** | **854 KB** | 3,4 s |

Cada uma dessas telas recarrega **a cada 60 s** e **a cada evento de Realtime**.

---

## 2. O gargalo: uma coluna

`vw_funil_visivel.ultimas_mensagens` — a prévia de até 3 mensagens que aparece
dentro do card do board.

**Mediana de 7 rodadas intercaladas, mesma página de 1000 linhas:**

| | mediana |
|---|---|
| sem `ultimas_mensagens` | **625 ms** |
| com `ultimas_mensagens` | **1.302 ms** |
| **custo da coluna** | **+677 ms por página (2,1×)** |

O board pagina **5 vezes** (4.232 linhas). São **~2,8 segundos por
carregamento**, só nessa coluna.

### Não é banda — é CPU do banco

A resposta vem **gzipada**: a página de 1000 linhas com a coluna pesa **48 KB
comprimidos**. Quarenta e oito quilobytes não explicam 677 ms em rede nenhuma.

E o custo **cresce com o número de linhas**, que é a assinatura de cálculo por
linha:

| linhas | com a coluna | sem ela | diferença |
|---|---|---|---|
| 50 | 173 ms | 160 ms | 13 ms |
| 250 | 369 ms | 162 ms | **207 ms** |
| 1000 | 1.628 ms | 261 ms | **1.367 ms** |

A view faz um *lateral join* em `mensagens` para buscar as 3 últimas de cada
cliente. São ~0,7 ms por linha × 4.232 linhas, a cada carregamento do board.

### Duas hipóteses testadas e DESCARTADAS

**"Falta índice em `mensagens(cliente_id)`."** Não falta. Medido, mediana de 5:

| consulta | mediana |
|---|---|
| por `id` (chave primária) | 167 ms |
| por `cliente_id` | 178 ms |
| por `cliente_id` + ordem + limite 3 | 307 ms |
| por `cliente_id` + ordem + filtro de tipo (o que a view faz) | 169 ms |

Todas no patamar da ida e volta (~170 ms). O índice existe e funciona — o custo
é fazer isso **mil vezes**, não fazer uma vez mal.

**"Basta calcular só para quem tem conversa."** Das 4.232 linhas, só 1.130 têm
conversa; as outras 3.100 são prospecção. Parecia o corte óbvio. **Não é:**

| | mediana (5 rodadas intercaladas) |
|---|---|
| a coluna para todas as linhas | 718 ms |
| a coluna só para quem tem conversa | 700 ms |
| **economia** | **18 ms (3%)** |

O custo está nas linhas que TÊM conversa. Filtrar não ataca o problema.

### O que essa coluna entrega na tela

Até 3 bolhas no card pequeno, cada uma **cortada em 2 linhas pelo CSS**
(`WebkitLineClamp: 2`, `page.tsx` na bolha do card).

Medido no conteúdo real de uma página: **tamanho médio 193 caracteres, 41% das
mensagens passam de 200, a maior tem 597**. Num card de 330 px a 10,5 px, duas
linhas comportam ~120 caracteres.

> O banco faz mil buscas e transporta mensagens de até 597 caracteres para a
> tela mostrar, no máximo, os primeiros ~120 — e só nos cards que a pessoa
> estiver olhando.

---

## 3. Quanto isso custa junto

**Medido:** 3.465 mensagens nas últimas 24 h (**~144/hora**), 16 acessos ativos.
Cada mensagem dispara um evento de Realtime, e cada aba aberta reage com um
recarregamento do board.

**Estimado** (esta parte é conta, não medição, e o número real depende de
quantas abas estão abertas e da coalescência de eventos que o board já faz):
com ~7 abas em horário comercial, entre o poll de 60 s e os eventos, o board
recarrega **dezenas de vezes por minuto** — e cada recarga carrega os mesmos
~2,8 s de trabalho do Postgres nessa coluna.

É trabalho que ocupa o banco **permanentemente**, e com o qual toda outra
consulta do sistema compete. É a explicação mais provável para a lentidão
generalizada, e o RD nunca teve parte nela.

---

## 4. Achados menores (reais, mas de outra ordem)

**`lerCrmConfig` bloqueia o começo do `/api/chat`.** É a primeira coisa da rota,
com `await` puro: nada mais começa antes dela terminar. Nas medições foi a ida
mais cara do log (~900 ms, mas aí incluindo o custo de abrir a conexão). Em
produção é 1 round-trip serializado — pequeno, e de correção trivial: entrar no
`Promise.all` que já existe logo abaixo, como o `/api/funil` faz.

**`disparos_template` é lido inteiro.** 2.644 linhas / 91 KB por carregamento do
board, para calcular o **último disparo por cliente**. Hoje todos os disparos
são dos últimos 90 dias, então cortar por data ganharia pouco — **é dívida
futura, não gargalo atual**: a tabela só cresce, e o dia em que tiver 20 mil
linhas não vem com aviso.

**Colunas do RD ainda pedidas.** `rd_cliente_id` e `carteira_rd` continuam no
`select` do board (~44 KB por página). Resíduo da remoção; o board já não usa
`carteira_rd` para nada desde §69.

---

## 5. O que fazer, em ordem de retorno

### 1. Tirar `ultimas_mensagens` do carregamento do board

O maior ganho por larga margem: **~2,8 s de trabalho do banco por
carregamento**, multiplicado por todas as abas e todos os eventos.

Três caminhos, do mais conservador ao mais efetivo:

| caminho | a tela muda? | ganho |
|---|---|---|
| **a)** buscar as 3 mensagens numa segunda chamada, depois que o board pintou | não | o board **pinta** ~2× mais rápido; o custo total do banco continua |
| **b)** buscar só as dos cards que entram na tela (o board já tem scroll infinito de 100 em 100) | não | 100 linhas ≈ 70 ms em vez de 4.232 ≈ 2,8 s |
| **c)** o card passa a mostrar só a prévia de 1 linha (`ultima_mensagem`, que já vem no payload) | **sim** — perde as 3 bolhas | elimina o custo inteiro, sem código novo |

**Recomendo (b)**: preserva a tela exatamente como está e ataca o custo real. É
a única que corta o trabalho em vez de adiá-lo.

### 2. `lerCrmConfig` entra no `Promise.all` do `/api/chat`

Um round-trip a menos no caminho crítico. Correção de poucas linhas.

### 3. Tirar `rd_cliente_id` e `carteira_rd` do `select` do board

Resíduo da remoção do RD.

### 4. Janela em `disparos_template`

Não urgente. Deixar registrado para quando a tabela crescer.

---

## 6. O que NÃO é problema — para não se investigar de novo

| suspeita | veredito |
|---|---|
| as 159.944 mensagens do RD no banco | **não custam nada**: contar as 170 mil leva 201 ms, e `vw_funil_visivel` responde igual com ou sem elas |
| falta de índice em `mensagens` | **existe e funciona** (§2) |
| o volume de `vw_funil` / `vw_funil_visivel` em si | 151 ms e 158 ms — as views são rápidas; o que pesa é uma coluna específica |
| o ETL do RD disputando recursos | rodava no GitHub Actions, fora do app — e está removido |
| banda / tamanho da resposta | vem gzipada; a página de 1000 linhas são 48 KB na rede |

---

## 7. O que foi feito — e o que a medição de 12/09 CORRIGE deste laudo

> Executado em 12/09/2026, com o método da §0 e, além dele, um A/B de dois
> servidores de produção locais falando com o MESMO banco: um com o código de
> antes, outro com o de depois, medidos em rodadas intercaladas.

### 7.1 ⚠️ A coluna não custa mais os 677 ms da §2

Mesma consulta da §2 — página de 1000 linhas, com e sem `ultimas_mensagens`,
mediana de 7 rodadas intercaladas — refeita em 12/09:

| | 11/09 (§2) | **12/09** |
|---|---|---|
| sem a coluna | 625 ms | **214 ms** |
| com a coluna | 1.302 ms | **298 ms** |
| **custo da coluna** | **+677 ms** | **+84 ms** |

O lado "sem" bate (625 → a §2 também registrou 261 ms na tabela por número de
linhas, e 214 ms está nessa faixa). **O que mudou foi o lado "com": 8× mais
barato.** A causa não foi investigada — candidatos são o cache do Postgres, um
`ANALYZE` depois da limpeza do RD (§69) ou contenção no momento da primeira
medição. Fica registrado como fato, não como explicação.

**Consequência:** o "~2,8 s de trabalho do Postgres por carregamento do board"
da §2 e §3 **não descreve o sistema de hoje**. O número de hoje é ~420 ms
(5 páginas × 84 ms). Quem citar aquele número — inclusive os comentários de
`app/page.tsx` e da rota de delta, que o citam — está citando uma medição
vencida.

**Regra que fica:** medida de performance tem validade. Antes de justificar
trabalho com um número deste arquivo, refazer a medição.

### 7.2 O que foi feito mesmo assim, e por quê

`ultimas_mensagens` saiu do payload do board (caminho **b** da §5) e virou
`/api/funil/previas`, pedida pelo `IntersectionObserver` só para os cards que
entram na tela. Não pelos 2,8 s, que não existem mais, mas por:

| | antes | depois |
|---|---|---|
| payload do `/api/funil` | **2,81 MB** | **1,96 MB** (−30%) |
| `/api/funil` (mediana de 7 intercaladas) | 2.103 ms | 1.954 ms (−7%) |
| cards devolvidos | 4.007 + 557 | **idênticos** |

850 KB a menos por carregamento, por aba, e o custo da coluna é **por linha**:
ele volta a crescer com a base sem avisar. `/api/funil/previas` com 100 ids
responde em **197 ms**.

### 7.3 O ganho de verdade estava em outro lugar: duas chamadas em série

Instrumentando a ABERTURA do board no navegador (fetch envolvido antes de a
página subir), o retrato foi este:

```
   inicio    fim    dur      KB  chamada
      930   1746    816       0  /api/session
     1791   4673   2882    2008  /api/funil      <- só começa quando a sessão volta
     1801   3465   1664      65  /api/produtos
     ...
   cards na tela em 7391 ms
```

`load()` estava atrás de `if (!sessao) return` — **e não usa `sessao` para
nada**: quem aplica o escopo por carteira é o `/api/funil`, no servidor, lendo o
mesmo cookie. Era serialização pura de duas chamadas independentes. Agora as
duas partem juntas.

**Medido no navegador, tempo até o board mostrar card, mediana de 5 rodadas
intercaladas, duas execuções separadas:**

| | 1ª execução | 2ª execução |
|---|---|---|
| antes | 6.574 ms | 6.408 ms |
| depois | **5.712 ms** | **5.536 ms** |
| ganho | **862 ms (13%)** | **872 ms (14%)** |

### 7.4 O maior custo restante do board é o NAVEGADOR, não o banco

No retrato acima, a última resposta chega em **4.673 ms** e os cards aparecem em
**7.391 ms**: **~2,7 segundos de trabalho do navegador**, renderizando **582
cards** de uma vez. Nenhuma otimização de consulta alcança isso.

O caminho conhecido é **virtualizar as colunas** (desenhar só as linhas
visíveis), e o pré-requisito barato dele já está anotado na §60.7 do CLAUDE.md:
a linha da conversa precisa de **altura fixa**, não `minHeight`. É trabalho de
outra ordem e não foi feito aqui.

### 7.5 Itens 2 e 3 da §5

- **`lerCrmConfig`** saiu do caminho crítico do `/api/chat`: disparado sem
  `await` no topo e colhido no `Promise.all` que já existia. Um round-trip a
  menos na rota mais chamada do sistema.
- **`carteira_rd`** saiu do `select` do board, e com ela a função
  `seloAtribuicao` (40 linhas que ninguém chamava desde o §69) e o estado
  `vendMeta`, que existia só para alimentá-la.
- ⚠️ **`rd_cliente_id` FICOU.** A §4 deste laudo agrupou os dois como "resíduo
  do RD" e **estava errada sobre um deles**: `rd_cliente_id` é o contato real do
  card de prospecção, e é por ele que o clique abre a conversa (§40.1 do
  CLAUDE.md). Tirá-lo quebraria o gesto mais frequente da tela.

### 7.6 Efeito colateral achado no caminho

O `onScroll` da caixa de mensagens do card chamava `carregarThread` quando
`scrollTop <= 4` — e o `ref` daquela caixa faz `scrollTop = scrollHeight` a cada
render. Numa caixa que mal transborda o navegador crava o valor em 0..4 e emite
um evento de rolagem indistinguível de um gesto humano: o card buscava a
conversa inteira **sem ninguém pedir**. Passou a exigir que a caixa role de
verdade e que o gesto tenha partido de uma pessoa (`pointerdown`/`wheel`/toque).

Piora com a prévia de uma linha, que é o estado do card antes de
`/api/funil/previas` responder — caixa curta é caixa que não rola.
