# Laudo de UX — `/chat` do CRM Murano

> Auditoria feita sobre o código, não sobre a impressão de tela.
> Fontes lidas: `web/app/chat/page.tsx` (2.253 linhas), `web/app/chat/ligacao.tsx`
> (620), `web/app/chat/indicadores/page.tsx`, as 14 rotas de `web/app/api/chat/`,
> `web/app/api/send-template/route.ts`, `web/lib/tema.ts`,
> `.claude/skills/murano-brand/SKILL.md`,
> `murano-app/src/app/globals.css` e as seções §6, §11.6, §18, §21, §22, §23.4 e
> §23.5 do `CLAUDE.md`.
> Referências externas consultadas ao vivo estão citadas com URL nos achados.
>
> **Nada em `web/`, `src/` ou `supabase/` foi tocado.** Tudo o que este trabalho
> produziu está em `prototipos/`.
>
> Data: 24/08/2026.

---

## 1. Resumo executivo

Oito achados, em ordem de impacto sobre o trabalho de quem usa a tela todo dia.

**1. A tela não diz quantas clientes estão esperando — o número está escondido dentro de um menu fechado.**
A fila padrão é "Meus atendimentos", que mistura lida e não lida. O contador de
"Mensagens não lidas" só existe *depois* de abrir o dropdown
(`page.tsx:1408-1428`). O único número sempre visível no cabeçalho da lista é o
da fila de espera (🚶). Ou seja: a primeira pergunta do dia — *quem está me
esperando?* — custa dois cliques e uma leitura visual. Isto é o achado de maior
retorno da lista inteira, porque é pago dezenas de vezes por dia, por sete pessoas.

**2. A janela de 24h do WhatsApp só se manifesta depois que a mensagem falha.**
Não há nenhum indicador de janela na tela: a string "janela" aparece só em avisos
de erro (`page.tsx:979`, `1170`) e no texto da tela vazia (`1652`). O vendedor
escreve a mensagem inteira, aperta Enter, e só então descobre que precisava de um
template. O dado para evitar isso já está no cliente (o `criada_em` da última
mensagem `customer` já vem em `/api/chat/thread`) — falta exibi-lo.
É exatamente o anti-padrão que a Twilio documenta como erro `63016`
(<https://www.twilio.com/docs/api/errors/63016>) e que o Bird resolve bloqueando
o compositor e mostrando contagem regressiva
(<https://docs.bird.com/applications/channels/channels/supported-channels/whatsapp/concepts/whatsapps-customer-care-window>).

**3. A vantagem competitiva do produto — o ERP ao lado da conversa — abre na aba errada e não existe no celular.**
`abrir()` força `setAbaContato("perfil")` (`page.tsx:816`), e a aba Perfil mostra
telefone, carteira, linha e situação — três dos quatro já estão no cabeçalho da
conversa. Os números que decidem o que dizer (total comprado, dias sem comprar,
ciclo, ticket) moram nas abas *Compras* e *Ciclo*, a um ou dois cliques. Pior: o
painel inteiro e a faixa de abas são `!isMobile` (`page.tsx:1751` e `2235`) — no
celular o vendedor atende **sem nenhum dado de compra**. Como o chat vai virar app
mobile, isso significa que a vantagem sobre o RD desaparece justamente no
dispositivo alvo.

**4. Os estados críticos se empilham, e a barra de chamada cobre o compositor.**
Há **um único** slot de aviso (`aviso`, string) usado por janela fechada, falha de
envio, falha de mídia, erro de transferência, erro de nota, erro de microfone e
mais — o segundo evento sobrescreve o primeiro (`setAviso` aparece 18 vezes em
`page.tsx`). Enquanto isso, quatro camadas flutuantes disputam a tela: erro de
ligação (fixed top center), chamada recebida (fixed top-right, `ligacao.tsx:508`),
desfecho (fixed bottom-right, `ligacao.tsx:547`) e a barra de chamada, que é
`position:fixed; left:0; right:0; bottom:0` (`ligacao.tsx:471`) — **ela fica por
cima da caixa de digitação**. Durante uma ligação, escrever para a cliente com
quem se está falando é fisicamente difícil.

**5. Uma falha de entrega é anunciada por um "!" cujo motivo só existe no `title` — que não existe no celular.**
`Ticks` põe a explicação da Meta num atributo `title` (`page.tsx:362`). `title`
depende de *hover*: em touch não abre. Num app mobile, a mensagem que não chegou
fica sem causa e sem saída — não há botão de reenviar, nem no desktop.
Telegram resolve isso há anos com o ícone vermelho na própria bolha, clicável para
reenviar (<https://bugs.telegram.org/c/12945>).

**6. Encerrar com motivo — a tabulação, que é a métrica de venda da empresa — é 100% voluntário.**
O painel de motivos existe e é bom (`page.tsx:1809-1837`), mas nada o convoca: a
conversa fica "aberta" para sempre se ninguém clicar em Resolver. O `CLAUDE.md` §6
diz que a maior alavanca do projeto é a tabulação preenchida, e §18 registra que a
equipe historicamente não preenche. O desenho atual depende inteiramente de
disciplina. Zendesk resolve o mesmo problema com campo **obrigatório para resolver**
(<https://support.zendesk.com/hc/en-us/articles/4408888756762>) e com macro que
responde+categoriza+fecha num clique
(<https://support.zendesk.com/hc/en-us/articles/4408844187034>) — e documenta o furo
que vem junto: automações passam por baixo da obrigatoriedade.

**7. Erros caros não têm freio: transferir descarta o motivo, e o template não mostra o que custa.**
No painel de transferência os botões de vendedor são renderizados **antes** do
campo de motivo (`page.tsx:1785` vs. `1793`), e clicar num nome dispara
`transferir(v.slug)` na hora — o motivo que o operador ia digitar é perdido, sem
confirmação e sem desfazer. No menu de template (`page.tsx:2151-2210`) não aparece
o custo (R$ 0,43 por envio, valor que o `/admin` mostra em
`web/app/admin/page.tsx:1055`) nem há qualquer indicação de quando o último
template foi para aquela cliente.

**8. O chat é a única tela do CRM sem tema, e o tema que ela tem é o que o usuário disse não gostar.**
`web/lib/tema.ts` define três paletas e o board alterna entre elas
(`web/app/page.tsx:307`); o chat tem um objeto `M` fixo (`page.tsx:20-35`) e não lê
`crm_tema`. E o rosa `#f5edf4` não é token de lugar nenhum: o token oficial de
fundo claro do hub é `#f4f4f6` (`murano-app/src/app/globals.css`,
`--color-murano-light`). O `#7b2d8b` dos botões também não existe na rampa
oficial — a própria skill `murano-brand` §5 registra isso como a divergência mais
forte do projeto. Como o CRM roda **dentro de um iframe do hub**, que é escuro por
padrão (`color-scheme: dark`, corpo em gradiente `#1c0e1b → #0d0512`), o chat hoje
é um retângulo rosa claro dentro de um app quase preto.

---

## 2. Mapa de tarefas — o que cada coisa custa

Contagem de cliques feita lendo o código, não estimando. "Proposto" é o custo nas
direções prototipadas; onde as três divergem, está indicado.

| # | Tarefa | Custo hoje | Onde dói | Custo proposto |
|---|---|---|---|---|
| 1 | Descobrir quem está esperando | **2 cliques** + leitura da lista inteira; o número não existe antes de abrir o dropdown | `page.tsx:1387,1408-1428` | **0 cliques** — contador fixo (D1) · fila já ordenada por espera (D2) |
| 2 | Responder um texto | **2 cliques** (conversa + caixa): `abrir()` não dá foco ao compositor | `page.tsx:809-835` | **1 clique** (foco automático) · **0** com `j`/`k`+`r` (D2) |
| 3 | Ouvir áudio / ver foto | áudio 1 clique; **foto abre em nova aba do navegador**, fora do app e fora do iframe do hub | `page.tsx:196-203` | 1 clique, visualizador dentro da tela |
| 4 | Mandar foto de produto | 2 cliques + diálogo do SO; **envia direto, sem prévia e sem desfazer** | `page.tsx:2055-2064,940` | 3 passos, com prévia antes de enviar (o passo a mais é o freio) |
| 5 | Reabrir fora da janela (template) | **3 cliques** + digitação; sem custo à vista, sem histórico de envio | `page.tsx:2151-2210` | 3 cliques, com custo, "último envio há X" e prévia (todas) |
| 6 | Saber se a cliente é boa e há quanto tempo sumiu | **1–2 cliques** por conversa (aba errada por padrão); **impossível no celular** | `page.tsx:816,1751,2235` | **0 cliques** — resumo por padrão (D1) · faixa fixa (D3) · folha/carrossel no mobile (todas) |
| 7 | Encerrar registrando o desfecho | 2 cliques — **mas nada convida a fazer** | `page.tsx:1809-1837` | 2 cliques, com o convite aparecendo sozinho quando a conversa esfria (D2, D3) |
| 8 | Transferir a conversa | 2 cliques — **o motivo é descartado** se o operador clicar no nome antes de digitar | `page.tsx:1785,1793` | 2 cliques, motivo antes dos nomes (D1) |
| 9 | Achar conversa antiga pelo que foi dito | 3+ letras, 400 ms; **acha a conversa, não a mensagem** — e a thread só carrega 200 mensagens | `page.tsx:761-786`; `api/chat/thread/route.ts:29` | idem + salto até a mensagem e "carregar mais antigas" |
| 10 | Ligar / atender | 1 clique (só em conversa Cloud) | `ligacao.tsx:426-448` | igual — mas a barra da chamada deixa de cobrir o compositor |

---

## 3. Achados detalhados

### 3.1 Triagem: a lista não separa quem espera de quem já foi respondido

**O que é.** A fila padrão (`filtro = "todas"`) exclui só as resolvidas
(`page.tsx:1225`) e ordena por `ultima_atividade`. Uma conversa que a vendedora
acabou de responder fica no topo, acima de outra que espera há quatro horas. Os
sinais de não lida são bons — nome em `fontWeight:900`, horário em roxo, bolinha
(`page.tsx:1550-1575`) — mas exigem varredura visual.

**Por que importa para o trabalho.** A pergunta que abre o dia e se repete a cada
volta do cafezinho é "quem está me esperando". Recência responde outra pergunta.
Com 7 vendedores e carteiras de centenas de contatos, isso é o gargalo de atenção.

**Como grandes produtos resolvem.** Intercom mostra um selo de SLA com três
estados de cor (vencido / <5 min / >5 min) e permite **ordenar pelo próximo prazo,
não pela última atividade**
(<https://www.intercom.com/help/en/articles/6546152-set-slas-for-conversations-and-tickets>).
Zendesk troca a lista plana por *views* pré-filtradas com ordenação própria
(<https://support.zendesk.com/hc/en-us/articles/4408888828570>).

**Nas direções.** D1 mantém a lista e só tira os contadores de dentro do menu.
D2 muda a régua: seções ("Esperando você", ordenada pela espera mais longa;
"Janela fechando"; "Adiadas"; "Sem dono"), com selo de tempo escrito ao lado da
cor. D3 troca a régua para estado comercial (anel de ciclo).

---

### 3.2 A janela de 24h é uma regra invisível até virar erro

**O que é.** Não há indicador de janela. `/api/send-message` devolve `422` com
`foraDaJanela` (`web/app/api/send-message/route.ts:65-68`) e a tela transforma
isso em texto no slot de aviso, devolvendo o texto digitado para a caixa
(`page.tsx:1163-1174`).

**Por que importa.** É o erro mais caro e mais frequente da operação: custa o
tempo de escrever a mensagem, custa a interrupção, e a saída (template) custa
**R$ 0,43** por envio. O dado necessário para antecipar já está na tela: a última
mensagem `enviada_por === "customer"` da thread carregada.

**Detalhe que quase ninguém acerta.** A janela **desliza**: cada nova mensagem da
cliente reinicia as 24h (<https://www.twilio.com/docs/content/session-definitions>).
O indicador precisa recalcular a cada mensagem, não fixar na abertura. Ligação
recebida também renova a janela — o que é relevante aqui, porque a voz já existe
(§22).

**Nas direções.** As três põem uma faixa de estado entre a thread e o compositor.
D2 e D3 vão além e **travam a caixa de texto** quando a janela fechou, deixando o
template como o único caminho — que é literalmente o que a Meta permite.

---

### 3.3 O painel do ERP: certo no conceito, errado no padrão e ausente no celular

**O que é.** `abrir()` reseta para a aba Perfil (`page.tsx:816`). A aba Perfil
mostra Telefone, Carteira, Linha e Situação (`page.tsx:255-277`) — telefone,
carteira e linha já estão no cabeçalho da conversa (`page.tsx:1663-1672`) e no
rodapé (`page.tsx:1958-1968`). O conteúdo que só existe ali — `total_liquido`,
`dias_sem_comprar`, `ciclo_medio`, `pct_ciclo`, `acao_recomendada` — está atrás de
outra aba.

**Por que importa.** É a única coisa que este produto tem e o RD Conversas não
tem (§18). Estar atrás de um clique não é o mesmo que estar presente: numa
conversa que dura 40 segundos, um clique a mais é a diferença entre olhar e não
olhar.

**Ausência no mobile.** `{!isMobile && (...)}` em `page.tsx:1751` (abas) e a
condição `painelAberto && !isMobile` em `2235` (painel) eliminam o ERP inteiro em
telas < 768px. Não há folha deslizante, nem botão, nem resumo.

**Como grandes produtos resolvem.** Gorgias carrega perfil, pedidos e rastreio do
Shopify na lateral do ticket **e permite agir dali** (reembolso, cancelamento) —
o painel deixa de ser leitura e vira operação
(<https://docs.gorgias.com/en-US/shopify-actions-461552>). Intercom deixa o
usuário *fixar* o que fica sempre visível, por pessoa
(<https://www.intercom.com/help/en/articles/6546031>).

**Nas direções.** D1 troca a aba padrão por um "Resumo" com quatro números grandes
e mantém as abas. D2 encolhe o painel e acrescenta ações. D3 leva os quatro
números para uma faixa fixa sob o cabeçalho e transforma a coluna num dossiê que
muda com o momento.

---

### 3.4 Estados críticos empilhados

Mapa de onde cada estado mora hoje:

| Estado | Onde aparece | Problema |
|---|---|---|
| Fora da janela / falha de envio / erro de mídia / erro de nota / erro de transferência | `aviso`, um slot só, acima do compositor | um sobrescreve o outro |
| Erro de carregar a lista | dentro da lista (`page.tsx:1538`) | fica escondido se a lista rolou |
| Erro de ligação | `fixed` topo-centro (`page.tsx:1265`) | tapa o cabeçalho |
| Chamada recebida | `fixed` topo-direita (`ligacao.tsx:508`) | disputa espaço com o anterior |
| Barra da chamada | `fixed bottom:0`, largura total (`ligacao.tsx:471`) | **cobre o compositor** |
| Desfecho da ligação | `fixed` baixo-direita (`ligacao.tsx:547`) | cobre o painel do contato |

Basta uma chamada recebida com um aviso de janela fechada para haver três camadas
flutuantes e a caixa de texto inacessível. Nas direções, a barra de chamada passa
a viver **dentro da coluna da conversa** (D1) ou o dossiê da direita vira o painel
da chamada (D3) — em nenhuma das duas ela cobre o compositor.

---

### 3.5 Feedback de envio: bom no otimismo, cego na falha tardia

**O que está certo.** Em `enviar()` (`page.tsx:1150-1179`) a mensagem otimista é
**removida** quando o POST falha e o texto volta para a caixa. Isso é melhor do
que a maioria: nada de bolha fantasma.

**O que falta.**
1. **Falha tardia**: quando o webhook marca `status:"failed"` depois, tudo o que
   aparece é um `!` cujo motivo está num `title` (`page.tsx:362`) — inacessível em
   touch — e **não há reenvio**.
2. **Mídia não tem otimismo nenhum**: `enviarArquivos` (`page.tsx:940-1010`) só
   recarrega a thread no fim do lote. Ao mandar cinco fotos, a tela fica em
   silêncio por vários segundos, com um contador pequeno no botão 📎.

WhatsApp usa um símbolo **próprio** para "pendente" (relógio), distinto de
"enviado" — o otimismo é visível, não disfarçado. Telegram torna a bolha falha
clicável para reenviar, e registra a exceção honesta: **mídia não é reenviável
pelo toque** (<https://bugs.telegram.org/c/12945>) — o que vale como aviso de
implementação aqui também.

---

### 3.6 Tabulação: o formulário existe, o fluxo não

O painel de motivos é bom e está no lugar certo do fluxo (encerrar). O problema é
que **nada o convoca**. Some-se a isso uma inconsistência: os motivos da conversa
(`page.tsx:117-123`: venda_realizada, tentativa_contato, follow_up, sem_interesse,
outro) não são os mesmos da ligação (`ligacao.tsx:41-48`, que troca
`tentativa_contato` por `nao_atendida` e `caixa_postal`). São duas listas para a
mesma pergunta, e relatórios que somem as duas terão de reconciliá-las.

D2 e D3 põem a pergunta **dentro da conversa**, no ponto em que ela parou, com um
botão que fecha, escreve a despedida e registra num gesto — o padrão de macro do
Zendesk/Intercom, adaptado. Vale registrar a lacuna honesta: **não encontrei
estatística pública** de adoção de tabulação antes/depois de torná-la obrigatória;
se esse número for preciso para convencer o time, terá de sair da medição de vocês.

---

### 3.7 Carga: a lista inteira vai para o DOM, e a thread para em 200 mensagens

`/api/chat` pagina até esgotar a `vw_funil` e **não tem limite**
(`api/chat/route.ts:28-40`). O front renderiza `ordenadas.map(...)` sem
virtualização (`page.tsx:1536`) — para um admin, isso é a base inteira de
conversas em botões no DOM. Do outro lado, `/api/chat/thread` corta em
`limit(200)` (`route.ts:29`) e **não há "carregar mais antigas"**: histórico de
cliente antiga fica inalcançável pela tela; a busca por conteúdo acha a conversa,
mas abre no fim dela, sem saltar para a mensagem encontrada.

Virtualizar reduz o DOM de dezenas de milhares de nós para ~15
(<https://web.dev/articles/virtualize-long-lists-react-window>) — e o pré-requisito
barato é **card de altura uniforme**, que é o que D2 adota deliberadamente. NN/g
lembra que scroll infinito serve descoberta, não tarefa dirigida, e que o "voltar"
é o custo dominante (<https://www.nngroup.com/articles/infinite-scrolling-tips/>) —
razão para preferir seções com contagem a uma rolagem sem fim.

---

### 3.8 Mobile: hoje é o desktop espremido

Evidências, todas em `page.tsx`:

- **`height: "100vh"`** no contêiner raiz (`1284`). Em navegador móvel a barra de
  endereço entra e sai; `100vh` não acompanha, e o compositor some sob a barra do
  navegador. O correto é `100dvh`.
- **Nenhum `safe-area-inset`** no arquivo (0 ocorrências). Em iPhone com faixa de
  gestos, o botão de enviar encosta na barra do sistema.
- **`isMobile` sem valor no servidor** (`useState(false)` + medição no efeito,
  `450`/`594-598`): a primeira pintura é sempre desktop e "pula" para mobile.
- **O compositor não cabe.** São 4 botões de 42px, o botão TEMPLATE (~92px), o de
  enviar (44px), 6 espaçamentos de 8px e 28px de padding: ~352px de 362
  disponíveis numa tela de 390px — **sobra cerca de 10px para a caixa de texto**
  (medida a partir dos estilos em `2073`, `2082`, `2116`, `2124`, `2140`, `2216`).
- **Alvos de toque abaixo do mínimo**: os botões do compositor têm 42px (mínimo
  recomendado 44); os chips de linha e de vendedor têm `padding:"3px 9px"`
  (`1449`, `1487`) — cerca de 22px de altura.
- **Sem painel do contato** (§3.3).

O que as direções fazem: `100dvh`, faixas de área segura desenhadas na moldura,
barra inferior com as filas (padrão que o Front mobile usa, com a gaveta pelo
título — <https://help.front.com/en/articles/4907072>), compositor reduzido a
três ações primárias com o resto atrás de "+", e — em D2 — gravação de áudio por
pressionar-e-segurar com trava deslizante, como o WhatsApp.

---

### 3.9 Teclado e foco

O que existe: `Enter` envia, `Shift+Enter` quebra linha, `/` abre respostas
rápidas com `↑ ↓ Enter Esc`, `Esc` no compositor de template (`page.tsx:2223-2233`,
`420-424`). É pouco, e há um detalhe que atrapalha: **`abrir()` não move o foco**
(`page.tsx:809-835`), então depois de clicar numa conversa o foco continua no
botão da lista — apertar Enter reabre a mesma conversa em vez de escrever.

E há um problema de acessibilidade que anda junto: `outline: "none"` aparece 6
vezes, sempre em campo de entrada (busca, textarea, campos do compositor de
template) — justamente os elementos onde o anel de foco é indispensável para quem
navega por teclado. O arquivo tem **1 atributo `aria-*` no total**; os botões se
apoiam em emoji + `title`, que leitores de tela nem sempre anunciam.

Convenções externas que valem citar na hora de escolher teclas: `⌘K` como atalho
único e global (<https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/>);
`j`/`k` + `e` + `/` herdados do Gmail e oferecidos pelo Front
(<https://help.front.com/en/articles/2189>); e a armadilha número um, documentada
pelos dois: **tecla de letra só pode valer fora da caixa de texto**.

---

### 3.10 Emoji no lugar de ícone

A tela usa emoji como sistema de ícones: 💬 🔔 🚶 ✓ 📞 ⚡ 🗒️ 📎 🎤 👀 📱 🧑‍💼 🔍 ⌃ ⌄.
Julgamento honesto, item a item:

- **Os que atrapalham.** 🧑‍💼 é uma sequência ZWJ que se decompõe em duas figuras em
  parte dos Androids e Windows antigos. 🚶 para "fila de espera" não é convenção de
  lugar nenhum — precisa do `title` para ser entendido. ⌃ e ⌄ (`page.tsx:1918`) são
  caracteres tipográficos, não ícones: alinham mal e têm peso visual diferente do
  resto.
- **O caso mais sério são os ticks**: `✓` / `✓✓` são texto com
  `letterSpacing:-2` em 10px (`page.tsx:369-373`). Em 10px, distinguir um tique de
  dois é difícil, e a cor `M.muted` (#9a8098) dá **3,57:1** sobre branco — abaixo
  do mínimo de 4,5:1 para texto pequeno.
- **Os que podem ficar.** 📞, 📎, 🎤 são inequívocos e universais.

Os protótipos trocam o conjunto por **SVG inline** (nenhuma biblioteca — a casa
não usa, e a skill `murano-brand` §6 pede que continue assim), mantendo o
significado no mesmo lugar.

---

### 3.11 Identidade: três paletas, um iframe escuro e um roxo que não existe

- `web/lib/tema.ts` tem `padrao`, `murano` e `escuro`; o board alterna com 🎨.
  **O chat não participa** — `M` é constante (`page.tsx:20-35`).
- O rosa de fundo `#f5edf4` não é token do hub; o token oficial de fundo claro é
  `#f4f4f6` (`--color-murano-light`).
- `#7b2d8b` não pertence à rampa `621244 / 7a1755 / 8a2a63` — a skill registra
  isso em §5 como a divergência mais forte do projeto.
- O hub embute o CRM num iframe e é **escuro por padrão** (`color-scheme: dark`,
  corpo em gradiente `#1c0e1b → #0d0512`).

Medições de contraste no que está no ar hoje (calculadas à mão, WCAG 2.1):

| Uso atual | Par | Contraste | Veredito |
|---|---|---|---|
| `M.muted` em metadados de 10–11px | `#9a8098` / `#ffffff` | **3,57:1** | reprova (mín. 4,5) |
| Aviso de mídia não baixada, 11,5px | `#dd4222` / `#fdeae3` | **3,70:1** | reprova |
| `M.gray` em prévia de conversa | `#6f5c6d` / `#ffffff` | 6,10:1 | passa |
| `M.roxo` em rótulos | `#7b2d8b` / `#ffffff` | 8,10:1 | passa |
| Tique de lida | `#1a5fa8` / `#ffffff` | 6,46:1 | passa |

A escala proposta nos protótipos deriva **só** de tokens oficiais e foi conferida:

| Uso proposto | Par | Contraste |
|---|---|---|
| texto secundário claro | `#55555f` / `#ffffff` | **7,37:1** |
| corpo no escuro | `#ded3d6` / `#1c0e1b` | **12,77:1** |
| link/ação no escuro | `#8ec2f5` / `#1c0e1b` | **9,93:1** |
| ação como texto no claro | `#1a5fa8` / `#ffffff` | 6,46:1 |
| laranja como **texto** | `#a83015` / `#ffffff` | 6,78:1 |
| azul `#2f7fd4` / branco | 4,11:1 | **só preenchimento e borda, nunca texto pequeno** |

Divisão de papéis adotada (é a da skill): **púrpura = marca** (avatar, faixa,
navegação ativa, botão primário), **azul = ação e estado** (link, item ativo,
foco, tique de lida) e — a decisão que tira o rosa da tela — **a bolha enviada é
azul**, porque a mensagem que você mandou é uma ação sua. **Laranja é tempero**:
prazo estourado e falha, um destaque por tela.

---

## 4. O que está BOM e deve ser preservado

Este chat tem decisões acertadas que um redesenho descuidado destruiria. Nomeando:

1. **O painel do ERP ao lado da conversa.** O conceito é a vantagem estrutural
   sobre o RD (§18). O problema é a aba padrão e a ausência no mobile — não a
   ideia. Nenhuma das três direções remove; todas aumentam.
2. **A transferência append-only** (`chat_transferencia`, §18) e o cuidado de
   **não mexer na carteira** — com o aviso escrito na tela (`page.tsx:1798-1800`).
   Distinção correta e rara.
3. **A honestidade dos contadores** (§23.5): cada seletor conta dentro do que o
   outro escolheu (`baseVend` / `baseLinha`, `page.tsx:1210-1233`), e o badge da
   aba do navegador continua global **de propósito**, com o motivo escrito no
   código. Contador que promete 12 e mostra 3 destrói confiança; aqui não
   acontece. Os protótipos mantêm a regra.
4. **A fila de espera escapando do filtro de vendedor** (`doVendedor`,
   `page.tsx:1205`): conversa sem dono não pertence a carteira nenhuma. Sutil e
   certo.
5. **O compositor de template com prévia** (`CompositorTemplate`,
   `page.tsx:389-452`): escolher deixou de ser enviar, o `{{1}}` chega preenchido,
   o foco vai para o primeiro campo vazio e a prévia mostra o que a cliente vai
   ler. É a melhor peça de UX do arquivo.
6. **Notas internas fora de `mensagens`**, com cor de papel deliberadamente fora da
   paleta das bolhas (§18) — e ligação e reação também fora, depois dos dois bugs
   silenciosos da §21.2. Regra a manter: **antes de gravar um evento em
   `mensagens`, verificar se ele é mesmo uma mensagem.**
7. **A presença anti-colisão filtrando por rótulo e não por aba** (`page.tsx:657`),
   para que o PC e o celular da mesma pessoa não apareçam como duas pessoas.
8. **O envio de mídia sequencial** com a legenda só na primeira foto
   (`page.tsx:940-1010`) e a interrupção do lote quando a janela fecha — economia
   de cota e de paciência da cliente.
9. **O rodapé "Online / Reconectando"** dizendo o estado real do Realtime
   (`page.tsx:1626-1640`), no lugar onde o RD põe a disponibilidade do operador.
   Diz algo verdadeiro em vez de decorativo.
10. **A busca por trigrama com teto declarado** (`truncado: true`,
    `api/chat/buscar/route.ts:89`), e a tela avisando que cortou em vez de fingir
    cobertura completa.
11. **A régua de espera por rajada nos indicadores** (§21.1) — cinco mensagens
    seguidas contam como uma espera. Qualquer indicador novo tem de herdar isso.

---

## 5. Riscos do redesenho

**O que quebra memória muscular — em ordem de risco:**

1. **Trocar a lista cronológica por seções (D2).** É a mudança mais valiosa e a
   mais arriscada. Mitigação obrigatória: contagem visível em cada seção e um
   "ver tudo" que devolva a lista plana ordenada por recência.
2. **Fazer a coluna da direita mudar de conteúdo (D3).** Painel que se move divide
   opiniões. Mitigação: dizer sempre *por que* aquele conteúdo está ali (os
   protótipos escrevem o motivo no cabeçalho do dossiê) e manter um caminho fixo
   para a ficha.
3. **Travar a caixa de texto com a janela fechada (D2/D3).** Tecnicamente correto
   — a Meta recusa mesmo —, mas é a primeira vez que o sistema impede alguém de
   digitar. Sem o botão de template imediatamente ao lado, vira frustração.
4. **Sugestão comercial automática (D3).** Uma regra defasada gera mensagem errada
   com aparência de autoridade. Mitigação: dizer de onde veio o número, e o botão
   escrever no **rascunho**, nunca enviar.
5. **Trocar emoji por SVG.** Baixo risco funcional, mas muda a "cara" da tela de
   uma vez. Se for feito, fazer de uma vez em toda a tela — meia troca fica pior
   que nenhuma.

**Riscos técnicos que o desenho não resolve sozinho:**

- **A obrigatoriedade da tabulação tem furo por baixo.** A própria Zendesk
  documenta que triggers e automações ignoram campo obrigatório. Aqui o
  equivalente é o webhook que **reabre** a conversa quando a cliente responde
  (§18): se ele mexer no status sem motivo, o dado nasce torto por um caminho que
  a tela não controla.
- **Cartões mais ricos custam consulta.** Ciclo, ticket e dias sem comprar em cada
  linha da lista (D2 e D3) exigem dados que hoje só são buscados ao abrir a
  conversa (`/api/chat/contato`). Sem agregado pronto, a lista fica lenta
  exatamente onde hoje é instantânea.
- **A régua de dono efetivo mora em `lib/chatEscopo.ts`** e é usada por `/api/chat`
  e `/api/chat/buscar` (§18). Qualquer seção nova da fila precisa passar por ela,
  ou uma conversa transferida vai aparecer numa lista e sumir da outra.
- **Adiar (D2) é dívida.** Sem um lugar honesto para as adiadas voltarem — seção
  com contador e horário —, a função vira esconderijo.

---

## 6. As três direções, em uma frase cada

| | Tese | Sacrifica | Risco de treinamento |
|---|---|---|---|
| **1 · Continuidade** | Nada muda de lugar; coisas passam a aparecer (contadores, janela de 24h, resumo do ERP, mobile de verdade) | Não muda a forma do dia — continua caçando conversa de cima para baixo; não resolve a tabulação como cultura | **Baixo** |
| **2 · Fila de trabalho** | A lista deixa de ser cronológica e vira ordem de serviço: espera, prazo, adiadas, e teclado para o dia inteiro | Quebra a lista única do RD; exige confiar nas regras de recorte; a ficha do ERP recua | **Alto** |
| **3 · Balcão** | A unidade de trabalho é a cliente, não a conversa: ERP fixo no cabeçalho e um dossiê que muda com o momento | Maior ruptura com o RD; painel sem lugar fixo; sugestão automática pode padronizar a fala | **Alto** |

Os arquivos: `prototipos/direcao-1-continuidade.html`,
`prototipos/direcao-2-fila-de-trabalho.html`, `prototipos/direcao-3-balcao.html`.
Cada um abre com duplo clique, alterna desktop/mobile e claro/escuro, e traz os
cenários críticos como interruptores no topo.
