# chat-v2 — relatório por fase

> Estado: **fases 0, 1, 2, 3 e 4 entregues** (19–20/09/2026), em localhost. Nada
> foi para produção. O `/chat` antigo continua intocado e é a volta segura.
>
> Como retomar em uma sessão nova: **CLAUDE.md §73.1**.

---

## Fase 0 — a régua (19/09/2026)

Em `medicao-base.md`. Resumo: a lista de conversas leva **7,4 s** para aparecer,
`/api/chat` custa **32,3 idas ao banco** e **2,9 MB**, e digitar 20 teclas gera
**1 long task de até 136 ms**.

## Onde chegamos

Mesma régua (`medir.mjs`), mesmo build de produção, mesmo banco, três rodadas,
mediana, como admin:

| | `/chat` (hoje) | `/chat-v2` | |
|---|---|---|---|
| **Lista de conversas visível** | 7.395 ms | **1.120 ms** | **6,6× mais rápido** |
| Primeira pintura (FCP) | 308 ms | 1.180 ms | ⚠️ ver nota |
| **Bytes de API por sessão** | 2.969 kB | **1 kB** | |
| JS baixado | 307 kB | **100 kB** | |
| First Load JS (`next build`) | 156 kB | **110 kB** | com as fases 2 e 3 |
| Abrir conversa — até o compositor | 1.863 ms | **766 ms** | |
| Abrir conversa — até a thread | 1.680 ms | **724 ms** | |
| **Long tasks ao digitar 20 teclas** | 1 (51–136 ms) | **0** | |
| **Do clique em enviar até a bolha** | — | **19 ms** | meta era 100 ms |

⚠️ **A primeira pintura ficou MAIS LENTA, e é de propósito.** No chat antigo ela
acontece aos 308 ms com a tela **vazia** — a lista só chega 7 segundos depois. No
v2 o servidor já manda as 60 primeiras conversas no documento, então a primeira
coisa pintada tem conteúdo.

---

## Fase 1 — ler (19/09/2026) · commit `9571733`

Lista virtualizada com prévia e contadores sempre visíveis; recortes (todas, não
lidas, favoritas, fila, resolvidas); busca por nome e telefone; thread com
separador de dia, agrupamento por autor, ticks, selo de template e mídia
recebida; carregar mensagens anteriores; **faixa da janela de 24h antes de
escrever**; painel do ERP com número herói, **inclusive no celular**; primeira
carga no servidor e `?cliente=` na URL.

Quatro achados do laudo de UX entraram: contador fora do menu (achado 1), janela
avisada antes (2), ERP no celular (3) e motivo de falha tocável (5).

### Como os 2,9 MB viraram 1 kB

A primeira página (60 conversas) vem no HTML. A lista inteira só é buscada
quando o gesto exige — buscar, trocar de recorte ou rolar até o fim. Os
contadores dos chips vêm de uma rota que devolve **cinco números**.

## Fase 2 — escrever (19/09/2026) · commit `cb6ae46`

Envio otimista (19 ms), marca de leitura ao abrir, template pelo chat com os
campos e a prévia do texto, respostas rápidas por `/`, **fila de snackbars** com
ação, Enter/Shift+Enter, reenviar o que falhou, Realtime + `?desde=` incremental
(7,8 kB em vez de 82) com balde de 1,2 s, e poll de 60 s de proteção.

## Fase 3 — completar (20/09/2026) · commit `b39d19c`

Anexos (assinar → Storage direto → Meta, com progresso acima de 2 MB), gravador
de áudio, localização por endereço salvo, notas internas, transferir / pegar /
devolver, resolver com motivo e reabrir, favoritar, encaminhar, exibição da
citação, ficha do contato (nome + CPF) e busca no conteúdo por trigrama.

Exercitado na conversa de ensaio com `SIMULACAO_ENVIO=1`: localização, resolver,
reabrir, transferir, devolver, nota, favoritar e um upload ponta a ponta.

---

## Fase 4 — delicado (20/09/2026) · commit `60f0ccf`

Os cinco itens que faltavam para a tela estar inteira. Cada um medido no
navegador por `prototipos/chat-v2/prova-fase4.mjs` — **20/20**, contra o build
de produção, com o Chrome dirigido por CDP.

```
node prototipos/chat-v2/prova-fase4.mjs
```

### Ligação (WebRTC), campainha e desfecho

A máquina de estados da chamada saiu de `app/chat/ligacao.tsx` para
**`lib/ligacaoChat.ts`** (commit `486a27c`, sozinho) — a regra da frente é que o
v2 não importa nada de `app/chat/`, e copiar criaria duas versões da mesma
máquina, que divergiriam como "a campainha tocou num chat e não no outro". Do
lado do chat antigo nada mudou: aquele arquivo ficou com as cinco telas e
reexporta o que `page.tsx` importa dali.

Três decisões que valem manter:

- **A camada é dinâmica pela ORDEM, não pela condição.** Ela precisa estar
  montada SEMPRE (é ela que faz a campainha tocar quando a cliente liga), mas o
  `RTCPeerConnection`, o `getUserMedia` e a máquina de estados não podem estar
  no JS da primeira pintura.
- **Ela não envolve a tela.** Um provider de contexto em volta de tudo seria o
  caminho óbvio e derrubaria a fase 1: com `ssr: false`, nada de dentro viria no
  primeiro byte. Ela é irmã da tela e publica para cima só o que é estável entre
  renders — publicar o objeto inteiro do hook faria um laço de render sem fim.
- **O marco da chamada na thread importa de `lib/ligacaoDados`**, que não conhece
  React nem WebRTC. Se importasse o hook, quem só lê conversas baixaria a
  telefonia inteira para desenhar uma pílula de "chamada recebida · 0:42".

⚠️ **Não se discou para ninguém.** O servidor local sobe com `WHATSAPP_TOKEN=`
vazio: o Graph recusa, e o que a prova exercita é a CADEIA — botão → rota → erro
traduzido em recado, com o botão "Pedir autorização" quando é o caso. O marco na
thread é conferido numa conversa que **tem** chamada em `chat_ligacao`.

### Avisos: título da aba, bipe, notificação e push

Quatro degraus de alcance, não quatro alternativas (`_componentes/notificacoes.ts`).

⚠️ **O número conta a lista INTEIRA.** Com a primeira página o título dizia
"(6)" enquanto o chip ao lado dizia 16 — medido em 20/09. E enquanto os
contadores não chegam o valor é `null`, não zero: registrar zero faria a
primeira medida de verdade parecer uma subida, e a tela apitaria toda manhã.

### `embed=1` — a lupa do board

- **Vem do servidor**, não de `location.search`: o cabeçalho do produto nunca
  pisca dentro do quadro antes de o JS decidir escondê-lo.
- **A coluna da lista não é desenhada** — nem escondida por CSS. Buscar as ~4
  mil conversas para montar uma lista invisível seria o desperdício que a §15.1
  corrigiu, e a busca e os contadores continuariam rodando atrás do quadro.
- **A lupa não grava o `crm_tela`**: ela venceria o board que a hospeda, e a
  volta do SSO cairia numa conversa em tela cheia, sem navegação (§64.2).
- **`?acao=ligar|audio|anexo`** dispara o gesto sem reimplementar WebRTC,
  gravador nem upload — quem executa é o dono deles, aqui dentro (§50.1).
- **A ponte do hub confere a ORIGEM antes do conteúdo.** A prova manda o mesmo
  recado de outra porta (origem diferente) e ele é ignorado; da origem certa, a
  conversa abre. Sem essa trava, qualquer página que embutisse o chat leria a
  conversa de uma cliente.

### Presença anti-colisão

Um socket, dois canais (`_componentes/realtime.ts`): `board` e `chat-presenca`.
O filtro é **por rótulo, não por aba** — senão o próprio celular ao lado do PC
apareceria como "outra pessoa" na conversa. O payload não leva e-mail: o canal é
público (§15.4).

Provado com duas sessões de verdade, em jarros de cookie separados
(`novaAbaIsolada`): a 2ª aba entra como `romulo` e o aviso aparece na 1ª.

### Os três recortes: consultor, número e coluna do board

Ficam atrás de um botão **Filtros**, e abrir esse botão é o gesto que manda
buscar a lista inteira **com** etapa e número. Quem não filtra não paga por
nenhum dos dois.

Eles **cruzam** com as filas e entre si (§23.5), e cada chip conta DENTRO do que
os outros já escolheram — um chip que promete 12 e entrega 3 é pior que chip
nenhum. Medido: Ociosos 344 · Tentativa 3.194 · Negociação 37 · Pedido 64 ·
Vender de novo 394 · Prospecção 0 · Sem cadastro 0 (as duas últimas descrevem
quem **não** tem conversa, e a lista do chat é de conversas — ficam visíveis com
zero para o vazio ser estrutural e não parecer um bug).

⚠️ **O grupo Número não aparece hoje, e isso é a resposta certa.** Medido em
20/09: **uma** linha ativa em `chat_linha`, com 4.144 conversas; as outras
quatro estão inativas e somam 13. Varrer `vw_chat_linha_cliente` (4.157 linhas,
5 páginas) para desenhar um seletor de uma opção seria exatamente o custo que a
fase 1 tirou. O grupo nasce sozinho no dia em que houver uma segunda linha.

A etapa é classificada por **`lib/etapasBoard`**, a mesma régua do board — a
`etapa` da view não é a coluna do board, e quem só a lê erra 344 de 1.113
conversas (§68.1).

### O bug que a fase 4 desenterrou

**`?cliente=` abria "Escolha uma conversa à esquerda" desde a fase 1.**
`lerThread` pedia `codcli` à tabela `clientes`, que **não tem essa coluna** — e o
PostgREST devolve **erro**, não uma linha sem o campo (§62.6). O cliente vinha
nulo, a conversa não tinha de onde nascer, e os três casos que a primeira carga
no servidor existe para atender — o link do board, o push e o F5 dentro de um
atendimento — caíam numa tela vazia. Ninguém tinha percebido porque o caminho
testado até aqui era clicar na lista, que é outro código.

### Os números, depois da fase 4

| | fase 3 | fase 4 |
|---|---|---|
| Lista de conversas visível | 1.120 ms | 1.438 ms |
| Bytes de API por sessão | 1 kB | 3 kB |
| Abrir conversa — até a thread | 724 ms | 1.008 ms |
| Long tasks ao digitar 20 teclas | 0 | **0** |
| First Load JS (`next build`) | 110 kB | 120 kB |

Os 10 kB a mais são os recortes, os avisos e a presença; a telefonia ficou fora,
num pedaço próprio. O aumento de bytes por sessão é a rota de contadores e a
configuração do push.

⚠️ **Compare contagem, bytes e long task — não o tempo absoluto.** Esta máquina
fala com o Supabase pela internet, e a diferença entre 1.120 ms e 1.438 ms cabe
inteira na variação da rede entre duas rodadas. Contra o `/chat` de hoje
(7.395 ms e 2.969 kB) a distância continua a mesma ordem de grandeza.

---

## O que falta

| Fase | O quê |
|---|---|
| **5** | paridade: suíte `testes/` contra o v2 + os 96 casos do checklist |
| 6 | piloto por pessoa (decisão do usuário) |
| 7 | global e aposentar o chat antigo (decisão do usuário) |

### Pendências que dependem do usuário

1. **Autorização para fazer UMA chamada real.** A cadeia está provada (botão →
   rota → erro tratado; marco na thread; campainha inscrita no canal), mas
   nenhuma chamada real foi feita. Para fazer uma:

   - **nada muda na Vercel** — a produção já liga; o que falta é o
     `WHATSAPP_TOKEN` no `web/.env.local` (ele existe no `.env` da RAIZ, que o
     Next não lê). O `phone_number_id` já vem do banco.
   - ⚠️ **`SIMULACAO_ENVIO=1` NÃO cobre ligação.** Ele guarda só
     `lib/whatsapp.ts` (mensagem, mídia, template). Com token de verdade, a
     chamada **toca no aparelho e é cobrada** (~US$ 0,0108/min).
   - ⚠️ **cota da Meta: 1 chamada por dia e 2 por semana** por par (número,
     cliente), e o cliente precisa ter autorizado antes (§22.6).
   - o microfone exige contexto seguro: dá para testar em
     `localhost:3120` **no computador**, não pelo IP da rede em HTTP.
2. ~~**`VAPID_PUBLIC_KEY` na Vercel do hub**~~ — **não era isso.** O push já
   entrega (o time recebe). O que faltava era o DESTINO: o webhook mandava
   `url: "/chat"` sem o cliente, então tocar na notificação abria o app na
   lista. Corrigido no commit `259ecfe`, e **vale para a produção de hoje** —
   pode sair como PR próprio, sem esperar o resto desta frente.

   ⚠️ **Responder DE DENTRO da notificação não é possível na web.** Campo de
   texto dentro de uma notificação é `RemoteInput` do Android nativo; a API de
   notificação da web não tem equivalente. O mais perto é o botão "Responder"
   levar à conversa com o cursor na caixa — que é o que passa a acontecer.
3. **Quando ir para produção** e **quem entra no piloto** (fase 6).
4. **Quando eu posso encostar no `app/chat/page.tsx`** — a troca de tela no
   servidor exige isso, e o arquivo tem outras frentes trabalhando nele.

### Não exercitado (dito, não afirmado)

- **Gravador de áudio**: headless não tem microfone.
- **Preservação da rolagem** ao carregar mensagens antigas.
- **Uma chamada de voz de verdade** (ver a pendência 1).
- **O arrastar/colar em aparelho real**: o gesto é provado com `DataTransfer`
  sintético (`prova-soltar.mjs`, 10/10) e o upload de verdade foi exercitado na
  fase 3 — mas os dois nunca rodaram juntos num arquivo vindo do Explorador.
- **O seletor por número com duas linhas**: hoje só há uma ativa, então o
  caminho que varre `vw_chat_linha_cliente` nunca é percorrido.
- **O push chegando com o navegador fechado**: o interruptor e a inscrição
  foram construídos e o `/api/chat/push` responde, mas a entrega depende da
  `VAPID_PUBLIC_KEY` (pendência 2).

### Achados fora do chat, para o usuário decidir

- A chave `anon` **lê todas as views** do projeto, e toda tabela concede
  `TRUNCATE` a `anon`/`authenticated` — o RLS não protege contra isso. Corrigir
  é um `revoke` em massa, com risco de calar em silêncio algum consumidor
  desconhecido (a mesma armadilha da §12.5).
- **Região da Vercel — RESOLVIDO em 19/09** (PR #234): as funções rodavam em
  `iad1` com o banco em `sa-east-1`. Produção agora responde `gru1::gru1`.
- **Next 14 → 16** fica para depois que o v2 virar o chat de todos (spec §6). O
  `npm install` avisa que o **14.2.5 tem vulnerabilidade conhecida**.

### Sujeira a limpar quando a frente fechar

- `web/app/dev-entrar/` (gitignored) e o arquivo `.chave-dev`.
- A conversa de ensaio e as mensagens `sim.`: `node prototipos/chat-v2/ensaio.mjs limpar`.
