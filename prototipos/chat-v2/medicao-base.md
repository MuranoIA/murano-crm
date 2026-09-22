# Fase 0 — a régua. O que o `/chat` de hoje custa

> Medido em **19/09/2026**, contra o **banco de produção**, com o **build de
> produção** do `master` (`f70a3ff`) rodando local na porta 3120, como **admin**,
> em Chrome headless por CDP. Três rodadas, **mediana**.
>
> Reproduzir:
> ```
> cd web && npm run build
> cd web && WHATSAPP_TOKEN= \
>   NODE_OPTIONS="--require C:/.../prototipos/chat-v2/instrument.cjs" \
>   npx next start -p 3120
> node prototipos/chat-v2/medir.mjs --rodadas 3
> ```
> Saída crua: `prototipos/chat-v2/medicoes/` (fora do git).

---

## 1. O número que resume tudo

**A lista de conversas leva 7,4 segundos para aparecer** (6,5 · 7,4 · 8,7 nas três
rodadas), num aparelho de desenvolvimento, com a tela pintada em 0,3 s.

Ou seja: **7 dos 7,4 segundos são tela desenhada e vazia.** A primeira pintura
acontece rápido e não tem nada dentro — é a casca esperando o JS carregar,
hidratar, pedir `/api/chat` e receber 3 MB.

## 2. A tabela

| O que | Hoje (`/chat`, master `f70a3ff`) |
|---|---|
| TTFB | **21 ms** |
| Primeira pintura (FCP) | **308 ms** |
| **Lista de conversas visível** | **7.395 ms** |
| JS baixado na abertura | **307 kB** |
| First Load JS (`next build`) | **156 kB** (rota `/chat`: 54,4 kB) |
| `/api/chat` — tempo | **5.320 ms** |
| `/api/chat` — bytes para o navegador | **2.958 kB** |
| `/api/chat` — **idas ao banco** | **32,3 por requisição** |
| `/api/chat` — bytes vindos do banco | **2,86 MB** |
| Chamadas de `/api/chat` por sessão | **2** (abrir a tela + abrir uma conversa) |
| Abrir uma conversa — até o compositor | **1.863 ms** |
| Abrir uma conversa — até a thread chegar | **1.680 ms** (thread: 2 kB, 4 idas) |
| Digitar 20 teclas — long tasks | **1** (pior: 51–136 ms) |
| Digitar 20 teclas — pior interação | **72 ms** (uma rodada anterior deu 272 ms) |

⚠️ **Tempo absoluto aqui não é o de produção.** Esta máquina fala com o Supabase
pela internet (~170–220 ms por ida), e a produção passou a rodar em `gru1`, do
lado do banco (PR #234, mesmo dia). O que vale comparar entre versões é
**contagem de idas, bytes e long task** — esses não mudam com a distância.

## 3. Onde as 32 idas se gastam

Por requisição de `/api/chat` (média de 6 requisições medidas):

| Alvo | Idas | O que é |
|---|---|---|
| `vw_chat_conversa` | **7** | a lista, paginada de 1000 em 1000 |
| `vw_chat_linha_cliente` | **5,5** | por qual número cada conversa corre |
| `acesso` | **3,5** | o mesmo usuário, relido várias vezes na mesma requisição |
| `chat_linha` | **2,3** | o cadastro de linhas, que muda uma vez por mês |
| `crm_config` · `chat_layout` · `carteira_config` | 1 cada | configuração global |
| `vw_chat_atribuicao` · `chat_conversa` · `chat_leitura` · `chat_favorito` · `chat_nota_vista` | 1 cada | estado por conversa |

Três coisas saltam:

1. **`acesso` é lido 3–4 vezes na MESMA requisição.** É a mesma linha, do mesmo
   usuário, no mesmo instante. Em produção isso custava 3 travessias do
   continente; agora custa 3 idas curtas — mas continua sendo trabalho à toa.
2. **A lista inteira vem toda vez, paginada de 1000 em 1000** (7 idas). O
   vendedor vê ~15 conversas na tela.
3. **`chat_linha` e `carteira_config` são cadastro quase imutável** e vêm em toda
   abertura de toda aba.

## 4. Os 3 MB

`/api/chat` devolve **2,9 MB** ao navegador. A lista tem ~300 conversas visíveis
para um admin, e cada uma carrega prévia, estado, favorito, não lidas,
atribuição, linha, e o que mais a tela antiga usa em algum canto.

Para desenhar as ~15 linhas que cabem na tela.

Isso é o teto de tudo: nenhum truque de renderização compensa baixar 3 MB antes
de mostrar a primeira conversa.

## 5. A agenda também é cara, e ninguém pediu por ela

`/api/chat/carteira` (o pré-carregamento de "Minha carteira", §71.4 do CLAUDE.md)
custa **13 idas e 836 kB**, em toda sessão, mesmo de quem nunca abre a aba. Por
desenho ele espera a lista chegar antes de disparar — então não atrasa a
abertura. Mas continua sendo 836 kB e 13 idas por vendedor por sessão.

## 6. Digitar

**1 long task por 20 teclas**, de 51 a 136 ms conforme a rodada, e a pior
interação entre 72 ms e 272 ms. A meta da spec é **nenhuma long task acima de
50 ms**.

A hipótese da spec (§1) era que cada tecla redesenha lista, conversa e painel,
porque o texto do compositor mora no componente de 5.400 linhas
(`app/chat/page.tsx:1382`). **Os números são compatíveis com isso**, mas não
provam sozinhos: a variação entre rodadas é grande e depende do que a lista está
desenhando no momento. O que se pode afirmar é o alvo: **hoje a régua de 50 ms é
estourada; no v2 não pode ser.**

## 7. O que isto significa para o v2

| Meta da spec | Hoje | O que precisa mudar |
|---|---|---|
| lista no primeiro documento | 7,4 s depois | primeira carga no servidor |
| menos idas | 32,3 | pedir só o que a região desenha; ler `acesso` uma vez |
| menos bytes | 2,9 MB | página de lista, não a lista inteira |
| digitar sem travar | 1 long task, até 136 ms | texto do compositor em estado próprio |
| JS menor | 156 kB First Load | componentes separados + `next/dynamic` |

---

## 8. Armadilhas desta medição (para a próxima não repagar)

- **`MutationObserver` no `documentElement` não pegou a lista aparecendo** — deu
  `null` nas três rodadas. Amostragem de 50 ms pegou. O erro passa a ser o passo,
  o que é honesto e suficiente.
- **`Page.addScriptToEvaluateOnNewDocument` é obrigatório** para long task e
  primeira pintura: instalar o observador depois do `load` perde tudo o que
  aconteceu antes.
- **O compositor aparece ANTES da conversa.** Medir só até o `textarea` contaria
  1,8 s e esconderia a thread. São dois números, e os dois entram na tabela.
- **Escape em `aba.js`:** o texto passa por um template literal antes de virar JS
  na página, então `/chat\/thread/` vira `/chat/thread/` e quebra. Use
  `includes()`. É a armadilha do CLAUDE.md §36.4, de novo.
- **O preload roda em vários processos** (npm, npx, next) e cada um abre um
  `.jsonl`. Vale o arquivo maior — é o do servidor.
- **Nada aqui escreve.** A medição só lê, e limpa a caixa de texto ao final.
