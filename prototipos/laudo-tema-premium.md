# Direção 4 — “Bancada”: o tema premium do `/chat`

> Protótipo: **[`tema-premium.html`](./tema-premium.html)** (standalone, abre com duplo clique).
> Nada em `web/`, `src/` ou `supabase/` foi tocado.
> Este documento parte do laudo anterior — [`laudo-ux-chat.md`](./laudo-ux-chat.md) e §29 do
> `CLAUDE.md` — e **não repete** os onze achados dali. O que a Direção 1 já resolveu
> continua resolvido aqui; esta direção é construída **em cima** dela.

---

## 1. O que “premium” significa nesta tela — e o que não significa

Premium numa vitrine é surpresa: uma cor que ninguém usa, um movimento que chama
atenção, uma foto grande. Premium numa **ferramenta que sete consultoras usam das
8h às 18h para vender por WhatsApp** é o oposto disso. É o que some da consciência.

Cinco atributos, e cada um é verificável — não é gosto:

| Atributo | O que significa aqui | Como se verifica |
|---|---|---|
| **Previsibilidade** | O mesmo objeto tem sempre o mesmo tamanho, na mesma posição, com a mesma cor. Um botão de ação do cabeçalho mede o mesmo no desktop, no celular e na lupa | contar quantas alturas de controle existem |
| **Um acento por região** | Cada área da tela tem no máximo uma cor que grita. Púrpura é marca, azul é ação, laranja é urgência, verde é concluído, grafite é o resto | contar quantas cores saturadas competem numa mesma coluna |
| **Silêncio** | Nada se mexe se o dado não se mexeu. Nenhum brilho correndo, nenhum contador subindo, nenhuma bolha entrando com fade | listar o que anima |
| **Densidade que respira** | Densidade não é apertar; é **remover o que não é informação** para o que é informação poder ser maior | contar linhas visíveis sem encolher a letra |
| **Acabamento de borda** | Uma rampa de raio, uma de sombra, uma barra de rolagem, foco visível em tudo | contar raios e sombras distintos |

**O contraponto, dito na frente:** premium aqui **não** é escuro por padrão, não é
vidro fosco, não é gradiente na bolha, não é ícone animado e não é mais espaço em
branco. Uma tela com muito ar é premium num site institucional e é hostil numa caixa
de entrada com 3.900 conversas.

## 2. O que “simetria” significa nesta tela

Não é simetria de espelho — a tela é assimétrica de propósito (lista à esquerda,
conversa no meio, ERP à direita). Simetria aqui tem três sentidos concretos:

**(a) Régua vertical.** Tudo que tem borda numa coluna começa na mesma linha.
Hoje a sidebar tem **três bordas esquerdas diferentes**:

| Elemento | `padding` no código | Borda esquerda |
|---|---|---|
| cabeçalho da lista | `"8px 10px 6px"` — `page.tsx:2269` | **10 px** |
| linha da conversa | `"10px 12px"` — `page.tsx:2663` | **12 px** |
| rodapé “Online” | `"8px 13px"` — `page.tsx:2754` | **13 px** |

E a conversa tem duas: as bolhas ficam em **18 px** (`padding: "14px 18px"`,
`page.tsx:3001`) e o compositor em **14 px** (`page.tsx:3379`). Quatro pixels de
diferença numa aresta que corre a tela inteira de cima a baixo. Ninguém nomeia isso;
todo mundo sente.

**(b) Altura por papel.** Na barra de ações do cabeçalho da conversa convivem hoje
três alturas: os botões secundários com `padding: "5px 11px"` e fonte `11.5`
(`padBotao`, `page.tsx:2121`), o **Resolver** com `"6px 12px"`, e o **WhatsApp ↗**,
que não é botão nenhum — é um `<a>` de texto sem caixa (`page.tsx:2894-2898`). Três
alturas e um elemento sem forma, lado a lado.

**(c) Simetria de estado.** Carregando, vazio e erro deveriam ter a mesma anatomia.
Hoje têm quatro anatomias diferentes: a thread vazia é um emoji de 44 px com duas
linhas centradas (`page.tsx:2770-2774`), “Carregando mensagens…” é uma linha cinza
de 12,5 px (`:3002`), “Sem mensagens ainda.” é a mesma linha cinza com outro sentido
(`:3003`), e o erro da lista é uma linha laranja de 12,5 px com `padding: 14`
(`:2572`). O mesmo tipo de acontecimento, com quatro formas.

---

## 3. O diagnóstico em números — o que está fora de escala hoje

Contado direto de `web/app/chat/page.tsx` (3.812 linhas):

| | hoje | valores distintos |
|---|---|---|
| `fontSize` | 231 declarações | **18** — 9 · 9,5 · 10 · 10,5 · 11 · 11,5 · 12 · 12,5 · 13 · 13,5 · 14 · 14,5 · 15 · 16 · 17 · 18 · 22 · 44 |
| `padding` | 126 declarações | **65** combinações distintas |
| `borderRadius` | — | **15** — 3 · 5 · 6 · 8 · 9 · 10 · 11 · 12 · 14 · 15 · 20 · 30 · 34 · 38 · 999 |
| `gap` | — | **9** — 2 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · 12 |
| `fontWeight` | — | 3 — 600 · 700 · **800** |
| `boxShadow` | — | 6 rampas diferentes |
| emoji como ícone de interface | 120 ocorrências | **44 glifos distintos** |

Isso não é desleixo — é o rastro honesto de dezoito seções do `CLAUDE.md` construídas
sob pressão, cada uma acertando o comportamento. O comportamento está certo. **A tela
não tem sistema**, e é isso que faz “parecer improvisada mesmo mostrando a coisa certa”.

### Dois defeitos concretos que a falta de escala produziu

**1. O número que é a nossa vantagem sobre o RD está truncado.** O painel tem
`width: 268` (`page.tsx:3695`); o Resumo põe **três tiles iguais** lado a lado
(`Numero`, `page.tsx:560`), cada um com `whiteSpace: nowrap` + `textOverflow: ellipsis`.

Medido no navegador (Inter, `tabular-nums`):

| | |
|---|---|
| espaço de texto dentro do tile | **55 px** (268 − 28 de padding − 14 de gaps = 75 por tile, − 20 de padding interno) |
| largura de `R$ 12.480,00` a 17 px/800 | **112 px** |

O tile mostra **metade** do número. Quanto maior a cliente, mais cedo o valor é
cortado — o dado se degrada exatamente onde ele mais importa.

**2. No modo compacto (a lupa do board), o botão “📊 Cliente” não faz nada** —
no desenho `original`. O botão é renderizado quando `(!isMobile || compacto)`
(`page.tsx:2849`), mas o painel só existe em `painelAberto && !isMobile`
(`page.tsx:3694`) e a folha do celular exige `d1 && isMobile` (`page.tsx:3717`).
Dentro da lupa `isMobile` é verdadeiro (a largura do iframe é ~500 px, §41.1), então
com `layout = original` o clique liga um estado que nenhum ramo desenha. **Bug de
hoje, não do redesenho** — está registrado aqui porque a Direção 4 o fecha de graça.

---

## 4. As escalas propostas

Todas as três foram aplicadas no protótipo e **auditadas no navegador headless**
(números da §8).

### 4.1 Espaço — base 4, sete degraus

```
--s1  2   --s2  4   --s3  8   --s4 12   --s5 16   --s6 24   --s7 32
```

E uma regra que resolve a assimetria (a):

> **Goteira da coluna: 16 px no desktop, 12 px no compacto e no celular.
> Tudo que tem borda começa na goteira.**

O que alinha, e não alinhava: a faixa de filas, o campo de busca, o avatar da linha
da conversa, o rodapé “Online”, as bolhas, a faixa da janela de 24 h, o compositor e
os blocos do painel. Uma aresta só, de cima a baixo.

Corolário de nesting: raio interno = raio externo − padding. A faixa de filas é
`r-ctl` 10 com 3 px de padding, então os segmentos internos usam 8. É o único
número derivado do sistema.

### 4.2 Tipografia — sete tokens

| token | px | peso | uso |
|---|---|---|---|
| `t-micro` | **10** | 700, `+0.06em`, caixa alta | rótulo de seção, selo, unidade |
| `t-meta` | **11,5** | 500 | hora, contador, telefone, metadado |
| `t-c2` | **12,5** | 500 | prévia da lista, linha do painel |
| `t-corpo` | **13,5** | 400 | mensagem e caixa de texto |
| `t-titulo` | **14,5** | 600 | nome do cliente, título de painel |
| `t-tela` | **17** | 700, `−0.02em` | título da fila |
| `t-num` | **26** | 700, `−0.03em` | o número herói do ERP |

Entrelinha: 1,45 no corpo · 1,25-1,3 em título · 1,05 em número.
`tabular-nums` obrigatório em hora, contador, R$ e data — é o que faz as colunas do
painel e a coluna de horas da lista formarem **uma régua**, em vez de dançarem.

**Peso 800 é abolido.** Hoje 800 aparece em rótulo de 9,5 px, em selo, em nome, em
contador e em botão — quando tudo é negrito extra, nada é. O topo passa a ser 700,
reservado a números e ao título da fila. Hierarquia volta a vir de tamanho, cor e
posição, que é onde ela deve estar.

**Um detalhe da casa que muda:** a skill `murano-brand` §3 pede *tracking* negativo
crescente e `font-optical-sizing: auto`. O chat de hoje não aplica nenhum dos dois.
Aqui os títulos ganham o tracking e o número herói ganha `−0.03em` — é o que faz
`R$ 12.480,00` parecer desenhado e não digitado.

### 4.3 Raio, altura, elevação

**Raio — a rampa da casa** (`murano-brand` §4), não uma inventada:
`10` botão e campo · `14` cartão, bolha, folha · `999` pílula e selo. Mais o canto
de 4 px na quina da bolha que aponta para o autor. **Quinze valores viram três.**

**Altura de controle — três degraus por contexto:**

| | secundário | primário / compositor | linha da lista |
|---|---|---|---|
| desktop | **32** | **40** | 52 |
| compacto (500 px) | **28** | **36** | — |
| celular | **44** (piso de toque) | **52** | 60 |

Sem exceção: o **WhatsApp ↗** vira um botão de ícone de 32 px como os outros.

**Elevação — dois níveis, e só:**
`e1 = 0 1px 2px rgba(24,16,26,.06)` para bolha e cartão ·
`e2 = 0 12px 32px rgba(24,16,26,.18)` para folha, menu e camada de chamada.
Todo o resto do relevo é borda de 1 px. Seis rampas viram duas.

### 4.4 Cor — cinco famílias, um trabalho cada

A rampa é a do hub (`murano-app/globals.css`), como manda a skill. O que a Direção 4
acrescenta é a **disciplina de papel** e as superfícies.

| Papel | Claro | Escuro | Contraste medido |
|---|---|---|---|
| fundo da página | `#f3f2f5` | `#14101a` | — |
| superfície | `#ffffff` | `#201826` | — |
| fundo da conversa | `#ebe9ef` | `#191322` | — |
| divisória | `#e4e2e9` | `#332a3a` | decorativa |
| **borda de controle** | `#8d8599` | `#786a86` | **3,53:1** / **3,45:1** — passa o mínimo de 3:1 para elemento não-textual |
| texto primário | `#221826` | `#e2d8dc` (pérola) | **17,12:1** / **12,37:1** |
| texto secundário | `#4d4757` | `#c3b8c2` | **8,92:1** |
| **metadado** | `#6b6577` | `#a89dab` | **5,60:1** sobre branco · **5,02:1** sobre a página · **4,65:1** sobre a conversa |
| marca (púrpura) | `#7a1755` | `#c98bb0` | **10,09:1** com branco |
| ação (azul) | `#1a5fa8` | `#8ec2f5` | **6,47:1** com branco · **9,17:1** no escuro |
| urgência (laranja) | `#a83015` | `#f2a68f` | **6,78:1** com branco · **8,71:1** no escuro |
| concluído (verde) | `#1a6b3c` | `#86cba1` | **6,54:1** com branco |

Três coisas que caem daí, e são decisões, não estética:

1. **`#2f7fd4` não pode ser fundo de botão com texto branco: dá 4,11:1** e reprova
   os 4,5 exigidos. O azul de preenchimento é `#1a5fa8` (6,47:1). A skill lista
   `#2f7fd4` como “ação”, mas para *ação preenchida* é o `-deep` que serve. Ele
   continua válido como **cor de foco**, onde a régua é 3:1.
2. **Correção a um número do `CLAUDE.md` §29.7.** Lá está escrito que o `muted` da
   Direção 1, `#7c7986`, dá “4,6:1 sobre o fundo”. Medido: **4,25:1 sobre a
   superfície branca e 3,87:1 sobre o fundo `#f4f4f6`** — ou seja, reprova onde mais
   é usado. O `#6b6577` proposto passa nos três fundos.
3. **Nuance sobre a §2 da skill.** Lá está registrado que púrpura como texto precisa
   clarear porque `#8a2a63` dá 2,3:1 — isso vale **sobre o cartão escuro do hub**.
   Sobre branco, `#8a2a63` dá **8,10:1**. No tema claro o púrpura pode ser texto sem
   clarear; no escuro, não. Vale registrar para não “corrigir” a coisa certa.

**Um acento por região.** Auditado no protótipo: na sidebar sobram exatamente
**três** cores saturadas, e cada uma tem um dono — púrpura na conversa aberta e nos
avatares (marca), laranja em quem está esperando (urgência) e verde só no ponto de
conexão. Fila zerada, e a coluna inteira fica grafite e púrpura. No cabeçalho da
conversa o único preenchimento é o verde do **Resolver** (concluído). No compositor,
o único é o azul do enviar — e ele é o **único azul preenchido da tela inteira**. No
painel, o púrpura da sugestão e o laranja dos dois números fora do ciclo, que são o
mesmo fato dito duas vezes.

A regra é *por região*, não por tela: quatro famílias visíveis ao mesmo tempo em
áreas diferentes é sistema; duas disputando a mesma área é ruído. Foi por isso que o
controle de ordenação da lista (“Mais recente”) saiu do azul para o grafite — ele é
uma preferência, não uma ação, e roubava o azul do único lugar onde ele decide algo.

---

## 5. Densidade — com números

**Sidebar.** A linha da conversa passa de avatar 38 + `padding "10px 12px"` para
avatar 36 + 52 px de altura fixa, sem encolher o nome (13,5) nem a prévia (12,5).
Altura fixa não é preciosismo: é o **pré-requisito barato da virtualização** que a
lista vai precisar quando passar de 3.900 conversas.

Mas o ganho real não vem da linha, vem do **cromo do cabeçalho**. Hoje a sidebar
empilha, um sobre o outro, **dois controles para a mesma escolha**: o título-dropdown
das filas (`page.tsx:2271-2300`, com os contadores dentro) e a faixa de contadores da
Direção 1 (`page.tsx:2341+`). A D1 acrescentou a faixa e — corretamente, para não
quebrar memória muscular — deixou o dropdown onde estava. A Direção 4 fecha a conta:
**a faixa segmentada passa a ser o título**, e o dropdown some.

Medido no protótipo: cabeçalho da lista **145 px**, área de rolagem **527 px** num
quadro de 760, linha de **52 px** → **10 conversas visíveis**. No celular, a faixa de
filas **não se repete** no topo: a barra inferior é o controle, e repeti-la seria
cometer, em miniatura, o defeito que esta direção corrige.

**Thread.** Duas mudanças, nenhuma delas tipográfica:

- **Agrupamento por autor**: 2 px entre bolhas do mesmo grupo, 10 px entre grupos, e
  **hora + tique só na última bolha do grupo**. Hoje cada mensagem carrega a própria
  hora (`page.tsx:3155-3156`), o que enche a coluna direita de repetição. Estimo
  ~20 % mais bolhas por tela — **estimativa**, não medição, porque depende do
  comprimento das mensagens.
- **Medida de leitura**: `max-width` passa de `72%` para `min(72%, 560px)`. Num
  monitor largo, 72 % dá linhas de 100+ caracteres; 560 px a 13,5 px dá ~75, que é a
  faixa confortável.

**Compacto (500 px).** Medido: a área de mensagens fica com **477 de 618 px = 77 %**
da janela, com o cabeçalho em uma linha (nome + três ícones de 28 px) e a faixa da
janela de 24 h em uma linha sem a barra de progresso. É onde o espaço acaba primeiro,
e é por isso que a terceira ação em diante mora atrás de **⋯** por regra, não por
improviso.

---

## 6. Estados e movimento

### Uma anatomia para os quatro estados

`glifo (40 px, em caixa de 14 px de raio) · título 14,5/600 · uma linha 12,5 ·
ação opcional` — centralizado, `max-width: 280`. Vale para carregando, vazio, erro e
“nada aconteceu ainda”, na lista e na thread.

E uma regra de conteúdo que vem direto da §39.2: **vazio precisa dizer a causa**.
“Sem mensagens ainda.” pode significar “esta cliente é nova” ou “o histórico do outro
número está desligado” — e a tela afirmando a primeira quando é a segunda foi o que
fez vendedor ligar achando que era primeiro contato. No protótipo o vazio da thread
diz: *“Este contato ainda não conversou pelo Murano Professional. O histórico do
número antigo está desligado nas configurações.”*

**Esqueleto sólido, sem brilho correndo.** O `shimmer` é um movimento que se repete e
não carrega informação nenhuma — é exatamente o oposto de premium numa ferramenta de
trabalho. Blocos chapados na cor da superfície rebaixada bastam.

**E um atraso de 300 ms antes de mostrar “carregando”.** Quase toda abertura de
conversa é mais rápida que isso; sem o atraso, o operador vê um estado piscar e
sumir a cada clique. O estado só aparece quando a espera é real. (Não simulado no
protótipo — é comportamento, não desenho.)

### O que anima, e por quanto

| Anima | Duração |
|---|---|
| entrada da folha e da camada de chamada | 160 ms, `ease-out` |
| cor de hover, foco e estado de botão | 160 ms |
| sublinhado da aba / segmento ativo | 120 ms |
| barra da janela de 24 h | só quando o valor muda |

### O que NUNCA anima

Mensagem nova entrando na thread · a rolagem de abertura (a conversa **abre** no fim,
sem `smooth`: rolagem animada na abertura faz o olho perseguir algo que já deveria
estar parado) · contadores das filas (nada de número subindo) · o botão de enviar ·
o indicador de presença · qualquer coisa que se repita sozinha. E
`prefers-reduced-motion` derruba tudo para 1 ms — padrão da casa, não opcional.

---

## 7. O que esta direção é, em relação às outras três

| | tese | aposta | dado novo? |
|---|---|---|---|
| `original` | a tela de hoje | — | — |
| `continuidade` (D1) | nada muda de lugar; **coisas passam a aparecer** | ver o que faltava | não |
| **`bancada` (D4)** | nada aparece de novo; **tudo passa a obedecer a uma grade** | menos fadiga e menos erro de leitura | **não** |
| `fila` (D2) | a lista vira ordem de serviço | mais conversas por dia | sim (adiar) |
| `balcao` (D3) | a unidade é a cliente, não a conversa | mais venda por conversa | sim (catálogo, ação) |

A D1 e a D4 são **complementares, não alternativas**: a D1 responde *“o que falta
aparecer”*, a D4 responde *“por que a tela parece improvisada mesmo mostrando a coisa
certa”*. Por isso a D4 **herda todas as correções da D1** (faixa de filas, faixa da
janela de 24 h, aba Resumo, falha fora do `title`, `100dvh`, área segura, folha do
ERP no celular) e acrescenta o sistema por cima. Implementá-la não desfaz nada do que
foi entregue em 24/08.

E a D4 é a única das três não-triviais que **não pede um dado que o banco não tem**.
D2 precisa de “adiar”; D3 precisa de catálogo com preço. D4 precisa de zero migrations
e zero rotas novas.

### O que muda em relação ao `original` — resumo

Paleta (rosa `#f5edf4` e roxo `#7b2d8b`, que não são token de lugar nenhum, saem) ·
escala de espaço, tipo, raio, altura e sombra · agrupamento de mensagens · título da
fila absorvido pela faixa segmentada · ícones de interface em SVG · anatomia única de
estado · painel de 268 → 320 com hierarquia · alvos de toque no piso de 44 no celular
e a folha do ERP funcionando também na lupa.

### O que muda em relação à Direção 1

A D1 mexeu em **quatro pontos e na paleta**. A D4 não acrescenta nenhum ponto novo:
ela **sistematiza os mesmos elementos**. As duas diferenças de comportamento são o
desaparecimento do título-dropdown (absorvido pela faixa que a própria D1 criou) e o
agrupamento de mensagens. Todo o resto é geometria e cor.

---

## 8. Auditoria do protótipo — o que foi medido, não afirmado

Dirigido no Chrome headless (151) por CDP, com screenshot em cada rodada.

| Verificação | Resultado |
|---|---|
| tamanhos de fonte renderizados na tela desktop | **7** — 10 · 11,5 · 12,5 · 13,5 · 14,5 · 17 · 26 (contra 18 hoje) |
| pesos renderizados | **400 · 500 · 600 · 700** — nenhum 800 |
| sombras distintas na superfície de trabalho | **1** (a segunda só existe em camada flutuante) |
| cores saturadas competindo na sidebar | **3** — púrpura (marca), laranja (urgência), verde (conexão) |
| bordas esquerdas da sidebar (faixa, busca, avatar, rodapé) | **16 · 16 · 16 · 16** |
| alturas dos botões do cabeçalho da conversa | **32 · 32 · 32 · 32 · 32** |
| altura da linha da conversa | **52 · 52 · 52** |
| cabeçalho da lista / área de rolagem / conversas visíveis | **145 px / 527 px / 10** |
| alvos de toque no celular | **mínimo 44** (44 · 56 · 60) |
| controles no compacto | **28 e 36**, e nada mais |
| cabeçalho da conversa no compacto | 3 ações, **mesma linha**, altura 28, topo idêntico |
| área de mensagens no compacto | **477 de 618 px (77 %)** |
| a thread abre na última mensagem | resto de rolagem **0 px** nos três modos |
| erros de JavaScript / exceções | **nenhum** |

Interações exercitadas: trocar de fila (as 4), trocar de conversa, abrir e fechar o
painel, trocar de aba do painel, abrir e fechar a folha do ERP no compacto, os seis
cenários (janela fechada, falha, ligação, nota, template, modo nota) **empilhados ao
mesmo tempo**, os quatro estados (normal, carregando, vazio, erro) e o tema escuro.

### Quatro defeitos que só o navegador pegou

1. **O cabeçalho da conversa quebrava em três linhas.** O seletor
   `.cabConv .quem span` alcançava também o `<span>` interno da presença e o tornava
   `display:block`. Escopo para filho direto (`> span`) resolveu: 56 px, uma linha.
   *(É o mesmo tipo de coisa que a §55 registra: “sonda numérica engana em layout;
   screenshot decide”.)*
2. **A faixa “Janela fechada” vazava no celular** — altura fixa com texto que quebra.
   No celular a frase explicativa some (o botão ao lado já diz o que fazer) e a altura
   virou `min-height`.
3. **O celular repetia a faixa de filas** no topo *e* na barra inferior — dois
   controles para a mesma escolha, exatamente o defeito que esta direção existe para
   corrigir. Removido do topo.
4. **A camada de chamada escapava do quadro do desktop.** Ela é `absolute` e o
   quadro não tinha ancestral posicionado, então ela se resolvia contra a página. Um
   `position: relative` na moldura resolveu — e vale registrar que é o mesmo tipo de
   problema, com sinal trocado, do achado §29.2 item 4: em produção a `BarraChamada`
   é `fixed bottom:0` em largura total (`ligacao.tsx:474`) e **cobre o compositor**.
   Aqui ela mora no topo, porque durante uma ligação se continua digitando.

---

## 9. O que eu recusei fazer, e por quê

- **Mover qualquer elemento de posição.** Lista à esquerda, conversa no meio, ERP à
  direita, ações na linha do nome, compositor embaixo. A §3 do briefing do laudo
  anterior é explícita: o RD é a referência de posição, e memória muscular vale mais
  que originalidade. A única exceção é o título-dropdown, e ele não se move — ele é
  absorvido por um controle que já está no mesmo lugar.
- **Escuro por padrão.** A equipe trabalha de dia, o CRM roda embutido no hub, e a
  Direção 3 já reservou “nascer no escuro” como parte da sua tese. Aqui o escuro é
  variante, e existe porque a lupa do board dentro do hub é o contexto onde ele mais
  faz falta.
- **Qualquer coisa que peça dado novo.** Sem “adiar”, sem catálogo, sem sugestão
  gerada, sem coluna nova, sem migration. É o que torna esta direção de prazo curto e
  permite que ela conviva com a decisão entre D2 e D3, que continua em aberto (§29.8).
- **Biblioteca de ícones.** `murano-brand` §6 é explícita: SVG inline em todos os
  projetos Murano. Os ~24 ícones do protótipo são caminhos crus de 24 × 24, traço 1,6,
  prontos para copiar.
- **Trocar emoji por ícone em tudo.** Só nos **ícones de interface**. Emoji que é
  **conteúdo** — a reação da cliente, o 🙂 que ela digitou — continua emoji, porque
  ali ele não é um ícone, é a mensagem.
- **Vitalizar a tela com movimento.** Nenhuma bolha entra com animação, nenhum
  contador sobe, nenhum esqueleto brilha. Ver §6.
- **Virtualizar a lista.** Fora de escopo. A altura fixa de 52 px que esta direção
  introduz é o pré-requisito de graça, e fica registrado para quem for fazer.

---

## 10. Riscos

| Risco | Tamanho | Mitigação |
|---|---|---|
| **O título-dropdown some.** É o elemento que a equipe usa para trocar de fila desde o começo, e o único que muda de forma | **o maior** | A faixa segmentada fica no mesmo lugar, com os mesmos quatro rótulos e os mesmos contadores; o gesto passa de dois cliques para um. Ainda assim: é a mudança a observar num piloto de uma pessoa antes de qualquer coisa |
| **Peso 800 abolido** pode ler como “apagado” na primeira impressão | médio | Todos os contrastes **sobem** (o metadado sai de 3,55:1 para 5,60:1). É estranhamento de primeiro dia, não perda de legibilidade — mas é real e vai aparecer no retorno da equipe |
| **Emoji → SVG.** 44 glifos coloridos viram traços monocromáticos | médio | Silhuetas e rótulos preservados. Ganha-se alinhamento, peso uniforme e renderização igual em Windows, Android e iOS; perde-se o reconhecimento instantâneo pela cor |
| **Agrupamento de mensagens** tira a hora de bolhas intermediárias | baixo | É o padrão de WhatsApp, iMessage e Slack; a hora do grupo fica na última bolha, e o `title` pode manter a exata |
| **Superfície de mudança grande.** É a tela inteira, não quatro pontos | médio | Tudo atrás da flag, com `original` intacto — a régua da §29.3. E a mudança é *só* geometria e cor: nenhum comportamento, nenhuma rota, nenhuma consulta muda |
| **Duas colunas de 320** deixam a conversa mais estreita que hoje em telas pequenas (a soma passa de 608 para 640) | baixo | 32 px, e em compensação o painel para de truncar o número que é a vantagem contra o RD |

---

## 11. Plano de implementação

### 11.1 O identificador

Em **`web/lib/chatLayout.ts`**, `LayoutId` passa a ser:

```ts
export type LayoutId = "original" | "continuidade" | "bancada" | "fila" | "balcao";
```

e entra uma quinta entrada em `LAYOUTS`, **depois de `continuidade`** (a ordem da
lista é a ordem que o admin lê, e “Bancada” é a evolução direta da 1):

```ts
{
  id: "bancada",
  rotulo: "4 · Bancada",
  resumo: "Nada de novo na tela. Tudo no mesmo ritmo.",
  tese:
    "Herda todas as correções da Direção 1 e não acrescenta nenhuma informação nova. " +
    "O que muda é que a tela passa a obedecer a uma grade: sete degraus de espaço, sete " +
    "de tipografia, três de raio, três alturas de controle, dois de elevação e cinco " +
    "famílias de cor com um trabalho cada. A 1 respondeu 'o que falta aparecer'; esta " +
    "responde 'por que a tela parece improvisada mesmo mostrando a coisa certa'.",
  ganhos: [
    "Uma régua vertical por coluna — hoje a sidebar tem três bordas esquerdas e a conversa duas",
    "Uma altura por papel — as ações do cabeçalho medem todas 32 px, inclusive o link do WhatsApp",
    "Mensagens agrupadas por autor, com hora só na última do grupo",
    "O painel do ERP para de truncar o valor comprado: hierarquia no lugar de três tiles iguais",
    "Contrastes acima do mínimo em todo o texto, no claro e no escuro",
    "Alvos de toque no piso de 44 px no celular; 28 e 36 no compacto, e nada fora disso",
  ],
  sacrificios: [
    "O título-dropdown das filas some, absorvido pela faixa segmentada — é memória muscular",
    "Peso 800 é abolido: a primeira impressão pode ser de tela mais 'apagada'",
    "Ícones de interface deixam de ser emoji e viram SVG monocromático",
    "Não muda a forma do dia nem vende mais por conversa — isso continua sendo a 2 e a 3",
  ],
  risco: "baixo",
  prazo: "curto",
  prototipo: "prototipos/tema-premium.html",
  implementado: false,   // vira true SÓ depois de a tela existir (§29.3)
},
```

`layoutEfetivo`, `podeAtivar` e a rota do `/admin` **não mudam** — o catálogo já é
genérico. `original` continua sendo valor válido, então o redesenho continua
reversível, que é a régua da §29.3.

### 11.2 As duas alavancas no `page.tsx`

O padrão já existe e já é confiável (`M` mutável + `Object.assign`, §11.5 e §29.7).
A Direção 4 acrescenta **uma segunda tabela do mesmo tipo, para geometria**:

```ts
// junto de PALETAS, no topo do arquivo
const G = {
  lista: 340, painel: 268, gut: 14, gutStr: "0 14px",
  cabPad: "8px 10px 6px", linhaPad: "10px 12px", linhaAlt: undefined as number|undefined,
  msgsPad: "14px 18px", compPad: "10px 14px", gapMsg: 4,
  ctlAlt: undefined as number|undefined, ctlPad: "5px 11px", ctlFonte: 11.5,
  bolhaMax: "72%", raioCtl: 10, raioCard: 12,
};
const GRADES: Record<string, Partial<typeof G>> = {
  original: { ...G },                    // literais de hoje — rollback exato
  continuidade: { ...G },
  bancada: {
    lista: 320, painel: 320, gut: 16, gutStr: "0 16px",
    cabPad: "12px 16px", linhaPad: "8px 16px", linhaAlt: 52,
    msgsPad: "16px 16px", compPad: "12px 16px", gapMsg: 2,
    ctlAlt: 32, ctlPad: "0 12px", ctlFonte: 11.5,
    bolhaMax: "min(72%, 560px)", raioCtl: 10, raioCard: 14,
  },
};
```

`GRADES.original` reproduz **os literais de hoje**, então trocar uma declaração
literal por `G.x` é uma mudança de zero pixels enquanto o layout for `original` —
é o que torna o rollback exato, e não “quase igual”.

### 11.3 “Isto vira aquilo” — a lista concreta

| # | Onde | Isto | Vira aquilo |
|---|---|---|---|
| 1 | `page.tsx` ~30-46, objeto `M` | 16 chaves | + `lineStrong` e `ok`. Em `original`, `lineStrong = border` e `ok = "#1a6b3c"` — os valores que o código já usa cravados. Zero mudança visual |
| 2 | `page.tsx` ~57-76, `PALETAS` | `original`, `continuidade` | + `bancada` com a paleta da §4.4 |
| 3 | topo do arquivo | — | + `G` e `GRADES` (§11.2) |
| 4 | `page.tsx:2049` | `const d1 = layout === "continuidade"` | `const CORRIGE = new Set(["continuidade","bancada"]);` → `const d1 = CORRIGE.has(layout); const bc = layout === "bancada";` — a 4 herda as correções da 1 |
| 5 | `page.tsx:2050` (perto do `Object.assign(M, …)`) | uma linha | + `Object.assign(G, GRADES[layout] ?? GRADES.original)` |
| 6 | `page.tsx:848` | `abaPadrao = layout === "continuidade" ? "resumo" : "perfil"` | `layout === "original" ? "perfil" : "resumo"` |
| 7 | `page.tsx:2056` | `ABAS.filter(a => !a.soD1 \|\| d1)` | inalterado — `d1` já contempla `bancada` |
| 8 | `page.tsx:2264` | `width: isMobile ? "100%" : 340` | `: G.lista` |
| 9 | `page.tsx:2269` | `padding: "8px 10px 6px"`, `gap: 7` | `padding: G.cabPad`, `gap: bc ? 8 : 7` |
| 10 | `page.tsx:2271-2300` | título-dropdown das filas | `{bc ? null : (…)}` — em `bancada` a faixa segmentada é o título |
| 11 | `page.tsx:2341+` | faixa de filas da D1 | mesma faixa, com `height: bc ? 40 : auto`, número em `t-titulo`/700 e rótulo em `t-micro`/600. Segmento ativo: superfície + `e1`, não `inset box-shadow` |
| 12 | `page.tsx:2663` | linha da conversa: `padding "10px 12px"`, `gap 10`, avatar 38 | `padding: G.linhaPad`, `height: G.linhaAlt`, `gap: 12`, avatar `bc ? 36 : 38`; a hora e o ponto de não-lida vão para uma coluna de **largura fixa 46 px**, empilhados — é o que forma a régua vertical das horas |
| 13 | `page.tsx:2754` | rodapé: `padding "8px 13px"` | `padding: G.cabPad` |
| 14 | `page.tsx:2780` | cabeçalho da conversa: `padding "9px 14px"` | `padding: G.gutStr`, `height: bc ? 56 : undefined` |
| 15 | `page.tsx:2121-2122` | `padBotao` / `fonteBotao` | `G.ctlPad` / `G.ctlFonte` + `height: G.ctlAlt`; no compacto 28, no celular 44 |
| 16 | `page.tsx:2894-2898` | `<a>WhatsApp ↗</a>` sem caixa | mesmo estilo de botão de ícone dos demais, `height: G.ctlAlt` |
| 17 | `page.tsx:2892` | `Resolver` com `background: M.roxo` | `M.ok` — verde é “concluído”; assim o único azul preenchido da tela é o **enviar** |
| 18 | `page.tsx:2117` | `rot = (icone, texto) => compacto ? icone : texto` (emoji) | `bc ? <Icone n="…"/> : icone` — novo componente `Icone` com o dicionário de `path` (os 24 do protótipo, `viewBox 0 0 24 24`, `stroke-width 1.6`, `currentColor`) |
| 19 | `page.tsx:3001` | `padding: "14px 18px"`, `gap: 4` | `padding: G.msgsPad`, `gap: G.gapMsg` |
| 20 | `page.tsx:3038+`, `g.itens.map` | cada mensagem é um bloco isolado | calcular `grupo` (autor mudou) e `fim` (próximo item muda de autor ou não é mensagem); `marginTop: fim/grupo ? 10 : 2` |
| 21 | `page.tsx:3155-3156` | hora + `<Ticks>` em **toda** bolha | em `bancada`, só quando `fim` |
| 22 | `page.tsx:3115` | `maxWidth: "72%"`, `borderRadius "12px 12px 3px 12px"`, `padding "7px 11px"` | `maxWidth: G.bolhaMax`, raio `G.raioCard` com a quina de 4 px, `padding: bc ? "8px 12px" : "7px 11px"` |
| 23 | `page.tsx:3143-3152` | `↪` permanente na bolha, 12 px | 24 × 24, `opacity 0` → aparece no `:hover`/`:focus-visible`; escondido no toque (o gesto certo é toque longo, que é outra construção) |
| 24 | `page.tsx:3379` | compositor `padding compacto ? "8px 10px" : "10px 14px"` | `G.compPad` |
| 25 | `page.tsx:3398-3401` | pílula `padding "4px 6px"`, botões 42 | `minHeight` 40 (desktop) / 36 (compacto) / 52 (celular); botões internos 32 / 28 / 44; enviar 40 / 36 / 52 |
| 26 | `page.tsx:3695` | `width: 268` | `G.painel` |
| 27 | `page.tsx:560-566`, `Numero` | três tiles iguais de 75 px | em `bancada`: **um herói** (`t-num` 26/700, largura da coluna inteira) + **dois de apoio** (`t-num2` 17/700) lado a lado. Medido: `R$ 12.480,00` precisa de 112 px e o tile de hoje dá 55 |
| 28 | `page.tsx:2572`, `:2726-2731`, `:3002-3003` | quatro anatomias de estado | um componente `<Estado glifo titulo texto acao/>`; o vazio da thread passa a dizer a causa (§39.2) |
| 29 | `page.tsx:3694` e `:3717` | painel desktop `!isMobile`; folha `d1 && isMobile` | **corrigir o bug da §3**: a folha já cobre o compacto (compacto ⇒ `isMobile`), então basta `d1` incluir `bancada`. Em `original` o botão continua inerte — se quiser corrigir para todos, é `(d1 \|\| compacto)` |
| 30 | `ligacao.tsx:474` | `BarraChamada` é `position: fixed; left:0; right:0; bottom:0` — **cobre o compositor** (§29.2 item 4) | a camada de chamada sobe para o **topo do quadro**, largura contida, com `e2`. Durante uma ligação se continua digitando; a barra não pode morar em cima da caixa de texto. No protótipo ela é `absolute` dentro do quadro — o equivalente em produção é `top` em vez de `bottom`, mantendo o `fixed` |
| 31 | folha de estilo global do chat | — | + `scrollbar-width: thin` e `::-webkit-scrollbar` de 8 px na lista, na thread e no painel; + `:focus-visible` com `outline: 2px solid` no azul de foco; + bloco `@media (prefers-reduced-motion: reduce)` |

### 11.4 Ordem sugerida, em três entregas que já valem sozinhas

1. **Paleta + escalas** (itens 1-9, 13-14, 19, 24-26). É a maior parte do efeito
   “premium” e não muda comportamento nenhum. Dá para pilotar numa conta só.
2. **Densidade e agrupamento** (12, 20-23, 27). É o que muda o número de coisas na
   tela; vale medir com a equipe antes de seguir.
3. **Ícones, estados e acabamento** (18, 28-31). O item 18 é o mais longo em linhas e
   o menos arriscado em comportamento; pode ir por último sem prejuízo.

O item **10** (o título-dropdown some) é o único que mexe em memória muscular.
Sugestão: entregá-lo **na primeira leva, mas apenas no piloto por usuário**
(`acesso.chat_layout`, §29.5), e só estabelecer para todos depois do retorno — é para
isso que o piloto existe.

---

## 12. Como abrir o protótipo

Duplo clique em `tema-premium.html`. Um arquivo, sem build, sem CDN, sem servidor —
só a fonte Inter vem da rede, com fallback de sistema se estiver offline.

No topo: **Tema** (claro/escuro), **Cenários** (janela de 24 h fechada, falha de
envio, ligação recebida, nota interna, escolher template, escrevendo nota — todos
combináveis, para mostrar que cada um tem casa própria em vez de disputar um slot de
aviso) e **Estado** (normal, carregando, vazio, erro).

Abaixo, na mesma página e nesta ordem: **desktop** 1280 × 760, **celular**
390 × 844 numa moldura, e **compacto** 500 × 620 — a lupa do board. Clicar numa
conversa, trocar de fila, abrir e fechar o painel e a folha do ERP funcionam nos três.
A tese da direção e o que ela sacrifica estão no rodapé do próprio arquivo.

**Nomes de salão, produtos, valores e telefones são fictícios.** Nenhum dado de
cliente real aparece — o repositório é público (§15.5).
