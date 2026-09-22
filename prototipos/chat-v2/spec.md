# Spec: chat-v2 do murano-crm (reconstrução com boas práticas, mobile-first)

> **Para a sessão do Claude Code que vai executar isto no repo `murano-crm`.**
>
> O usuário aprovou o Painel de Demandas (`C:\murano-projetos\sistema-gestao-demandas`) em
> design, fluidez e responsividade. A decisão tomada com ele:
> - **reconstruir a interface do `/chat` do zero**, com as boas práticas daquele projeto;
> - **dentro do repositório do CRM**, em arquivos novos;
> - **partindo do posicionamento** que o time já conhece, sem ficar preso a ele: o usuário quer
>   **outra cara**, e autorizou mudanças de posição quando elas melhorarem o uso (§3.0 e §4.1);
> - reaproveitando o servidor e as regras de negócio que já existem;
> - liberando aos poucos pelo **interruptor de desenho** que o CRM já tem.
>
> O Painel está no disco: quando esta spec citar um arquivo de lá, leia.
>
> **Esta é a cópia canônica.** Nasceu em `sistema-gestao-demandas/docs/`, foi conferida contra o
> repositório em 19/09/2026 e mora aqui desde então. Alterações vêm para cá.

---

## Objetivo: velocidade, design e experiência do usuário

**Estes três objetivos são o motivo desta spec.** Toda decisão de implementação se julga por eles:
se uma escolha não deixa o chat mais rápido, mais bonito ou mais fácil de usar, ela não entra.

- **Velocidade real:** menos idas ao banco, menos bytes, menos JS, dado já no HTML.
- **Velocidade percebida:** a tela nunca espera em branco (esqueleto na hora). Todo toque tem
  resposta visual imediata (ripple, state layer). Toda ação aparece antes de o servidor confirmar
  (otimismo).
- **Design e experiência:** hierarquia clara, componentes consistentes, movimento com significado e
  **celular como primeira classe**.

**Por que Google Material:** é um sistema desenhado justamente para esses três objetivos.
- Dá feedback imediato a cada toque, e isso faz a interface **parecer** rápida.
- Tem componentes consistentes (o vendedor aprende uma vez e reconhece em toda tela).
- Define elevação e movimento que explicam o que aconteceu.
- Nasceu para toque e celular.

O usuário escolheu o Material por isso, ao ver o Painel de Demandas funcionando. **Não é
decoração:** ripple, state layer, elevação e motion fazem parte da entrega, não são acabamento para
o fim.

**Critérios de sucesso** (medidos em build de produção, celular emulado e real):
| Critério | Meta |
|---|---|
| Lista de conversas visível | **esqueleto no primeiro byte**, lista real no mesmo documento (streaming), sem spinner e sem esperar o JS nem o `/api/chat` (ver §2.3) |
| Digitar no compositor | nenhuma *long task* > 50 ms enquanto digita (Performance do DevTools) |
| Tocar em Enviar → bolha na tela | < 100 ms (otimista) |
| INP (resposta a interação) | < 200 ms |
| CLS (pulo de layout) | < 0,1, com mídia de tamanho reservado |
| Lighthouse mobile, Performance | ≥ 90 |
| Cada fase | **melhor que a medição da fase 0** em todos os itens acima |

---

## 0. Regras. Leia antes de tudo.

1. **O `CLAUDE.md` do CRM manda.** Siga a §0 dele à risca:
   - rode `node scripts/abertura.mjs`;
   - abra worktree própria com `node scripts/nova-worktree.mjs chat-v2 <porta livre>`;
   - não encoste em worktree ou branch de outra sessão;
   - veja se outra sessão está buildando antes de rodar `next build`.
2. **Até o piloto, só localhost.** Commits locais na branch da worktree, sim. Push, PR e deploy
   só quando o usuário aprovar a fase de piloto (§6). Aí vale o fluxo do CRM: PR para `master`
   com squash.
3. **O banco é o de produção**, o mesmo que os vendedores usam agora.
   - **Nenhuma migration sem aprovação explícita do usuário.** Se precisar de view, RPC ou índice,
     escreva o SQL em `prototipos/chat-v2/sql-proposto.sql` e pergunte.
   - **Envio só com `SIMULACAO_ENVIO=1`** (`lib/simulacaoEnvio.ts`), com a lista de destinos reais
     **vazia**. Assim nenhuma mensagem, template ou mídia sai para cliente. Depois, limpe as
     mensagens `sim.` pelo procedimento que o próprio arquivo e o `testes/README.md` descrevem.
   - **Ligação** (fase 4): só com número interno que o usuário indicar.
   - **Não mexa em interruptores globais** (`chat_layout` id=1, `crm_config`). Piloto por pessoa
     (`acesso.chat_layout`) só na fase 6, com o usuário.
4. **O chat antigo não é editado.** `app/chat/page.tsx` e cia. ficam intactos: são a volta segura
   e continuam atendendo o time. **O chat-v2 não importa nada de `app/chat/`.** Se precisar de uma
   função que está presa lá, extraia para `lib/`, **sem mudar o comportamento**, em commit separado.
5. **Regras de negócio não se reimplementam.** Janela de 24h (`lib/janela24h.ts`), templates,
   escopo por carteira e papel, `ver-como`, nome do WinThor, erros da Meta (`lib/erroMeta.ts`),
   limites de mídia (`lib/midia.ts`): **use o que existe em `lib/`**. Se a regra estiver dentro de
   uma rota `/api/chat/*`, chame a rota ou extraia a regra para `lib/`.
6. **Leitura obrigatória antes da primeira linha de código:**
   - `prototipos/laudo-ux-chat.md`: 11 achados de UX com `arquivo:linha`;
   - `prototipos/laudo-performance.md`: medições reais, com `/api/chat` = 20 idas ao banco;
   - `prototipos/laudo-tema-premium.md`: escalas, contraste e densidade medidos;
   - `checklist_chat_crm.md`: os 96 casos de uso, que são o **contrato de paridade**;
   - `testes/README.md`: a bateria que roda contra o build;
   - CLAUDE.md §17 (iframe do hub), §29 (interruptor de desenho), §41 (lupa do board = `/chat` em
     iframe), §51 (compositor e armadilhas de layout), §57 (thread e paginação), §64 (cookie
     `crm_tela` e `?cliente=`), §65 (incremental `?desde=` e `juntar()`), §70 (guarda
     `aindaAberta`), §72.5 (ponte `postMessage` do hub). Ver §2.6 desta spec.

---

## 1. Por que reconstruir, e não retocar

- **O chat inteiro é um componente de ~5.400 linhas** (`export default function Chat()` começa em
  `app/chat/page.tsx:1355`, num arquivo de **6.773 linhas**; `app/chat/` soma 7.730, medido em
  19/09/2026). O texto do compositor (`useState("")`, linha ~1382) mora **nesse mesmo
  componente**. Então **cada tecla digitada redesenha lista, conversa e painel**. Provável causa
  principal da sensação de peso ao digitar. Meça na fase 0 para confirmar.
- **Os desenhos alternativos são `if`s no mesmo arquivo** (`const bc = layout === "bancada"`). Cada
  desenho novo aumenta o arquivo e o risco.
- **O carregamento é todo no navegador:** o JS carrega, depois `/api/chat` faz 20 idas ao banco,
  depois vem a render. Nada aparece antes.
- **No celular, o chat perde o diferencial** (laudo UX, achado 3):
  - painel do ERP e abas somem (`!isMobile`);
  - o compositor ocupa quase toda a altura;
  - a barra de ligação cobre a caixa de texto;
  - motivo de falha só aparece no `title`, que exige hover.
- **O time reclama da responsividade.** Aqui ela é requisito central, não acabamento (§4).

---

## 2. Arquitetura do chat-v2

### 2.1 Onde mora
```
web/app/chat-v2/
  page.tsx              Server Component: sessão, escopo, 1ª carga (lista + conversa da URL)
  loading.tsx           esqueleto com o formato real das 3 regiões
  layout.tsx            importa o CSS do v2 (Tailwind sem preflight, escopado em .v2)
  v2.css
  _componentes/
    Casca.tsx           grade responsiva das 3 regiões + navegação no celular
    ListaConversas.tsx  (client) lista virtualizada, busca, filtros
    ItemConversa.tsx    memo; só re-renderiza se a SUA conversa mudar
    Thread.tsx          (client) virtualizada, paginação para cima
    Bolha.tsx           memo; status, mídia, citação, reação, falha tocável
    Compositor.tsx      (client) ESTADO PRÓPRIO do texto; nunca sobe a cada tecla
    FaixaJanela24h.tsx  aviso antecipado da janela (achado 2 do laudo UX)
    PainelContato.tsx   ERP/ficha; lateral no desktop, sheet no celular
    Ligacao.tsx         next/dynamic, só carrega quando há chamada
    ...                 modais (templates, transferir, notas) via next/dynamic
  _dados/               leitura no servidor (funções puras, usando lib/)
  _acoes.ts             Server Actions das mutações (ou fetch às rotas /api/chat/* existentes)
```
**Um componente, um trabalho.** Meta: nenhum arquivo acima de ~300 linhas. Tipos compartilhados em
`_componentes/tipos.ts` ou `lib/`.

### 2.2 Estado: quem guarda o quê
- **Texto do compositor:** só no `Compositor`. O pai recebe **apenas** o evento "enviar".
  ⚠️ **O chat atual NÃO tem rascunho por conversa** (conferido: nenhum `sessionStorage` em
  `app/chat/page.tsx`). Não é paridade, é funcionalidade nova. Só faça se o usuário pedir. Se
  fizer, use `sessionStorage` com `try/catch`.
- **Lista e thread:** um store por conversa (ex.: `useSyncExternalStore` ou reducer com `Map`),
  para que um evento do Realtime **atualize só a conversa afetada**. Nunca recarregar tudo.
- **Conversa aberta na URL** (`?cliente=X`). O voltar do navegador e do celular funciona, e o
  embed do board (`/chat?cliente=X&embed=1`, §41) continua válido.

### 2.3 Dados: rápido de verdade
- **1ª carga no servidor:** `page.tsx` lê a sessão pelos cookies (`crm_sessao`/`crm_email`, como
  `app/api/session/route.ts`) e entrega no HTML a lista e, se houver `?cliente=`, a thread. O vendedor
  vê as conversas **sem esperar JS nem `/api/chat`**. Referência no Painel: `src/app/(painel)/page.tsx`
  + `loading.tsx`.
  ⚠️ **Com `loading.tsx` a página faz streaming**: o primeiro byte leva o esqueleto, e a lista entra
  depois, no mesmo documento. Isso é o desejado. Não tire o `loading.tsx` para forçar a lista no
  primeiro byte: o primeiro byte passaria a esperar a consulta inteira (o `/api/chat` de hoje leva
  ~800 ms), e a tela ficaria em branco nesse tempo.
- **Rotas enxutas para o v2 quando a atual for pesada.** `/api/chat` faz 20 idas ao banco para servir
  a tela antiga inteira. O v2 busca **só o que cada região desenha**, em `Promise.all`, com `select`
  das colunas usadas. Crie funções novas em `_dados/` ou rotas `/api/chat-v2/*`, sem alterar as antigas.
- **Meça as idas ao banco e os bytes, antes e depois, com o método do laudo de performance (§0).**
  ⚠️ **O `instrument.cjs` citado lá NÃO está no repositório** (nunca foi commitado). Na fase 0,
  reescreva-o conforme a descrição do laudo: um preload de Node que envolve o `fetch` global e
  registra duração, bytes e alvo de cada chamada ao Supabase, carregado com
  `NODE_OPTIONS="--require ./instrument.cjs"`. Guarde-o em `prototipos/chat-v2/`, para a próxima
  medição não ter que reescrever de novo.
- **Realtime aplica diffs** (mensagem nova → entra na thread e sobe a conversa na lista). Troque o
  polling amplo por atualização ao voltar para a aba (`visibilitychange`, como
  `src/components/AtualizarAoVoltar.tsx` do Painel), com um refresh lento de segurança.
- **Pré-busca:** ao tocar ou passar o mouse numa conversa, já busque a thread.

### 2.4 Resposta imediata (otimismo)
- **Enviar:** a bolha aparece **na hora** com relógio. Depois vira ✓ / ✓✓, ou falha com o motivo
  **tocável** e botão **Reenviar** (achado 5). Modelo: `useOptimistic` + toast de erro de
  `src/components/ListaDemandas.tsx` do Painel.
- **Mesma lógica** para marcar como lida, favoritar, pegar atendimento, resolver, transferir e nota.
- **Avisos:** uma **fila de snackbars**, não um slot único. Hoje, 18 `setAviso` num slot só, e o
  segundo apaga o primeiro (achado 4).
- ⚠️ **Otimismo sem guarda de conversa reabre o bug da §70.** Toda resposta assíncrona (envio,
  recarga, página antiga, painel do ERP) confere, **quando chega**, se a conversa dela ainda é a
  aberta, e só então escreve. Sem isso, as mensagens da cliente A aparecem na tela da cliente B por
  alguns segundos. O teste `testes/casos/regressao-thread-de-outra-conversa.mjs` amostra a tela
  **durante** a troca: rode-o contra o v2.

### 2.6 Integrações que o checklist não lista (paridade silenciosa)
O `checklist_chat_crm.md` cobre o que o vendedor vê. Isto aqui é encanamento. Sem estes itens, a
tela funciona na demonstração e falha em produção sem dar erro:

| Item | Onde está hoje | O que quebra se faltar |
|---|---|---|
| Ponte `postMessage` do hub, com a **origem como constante** (`lib/hub.ts`) | CLAUDE.md §72.5 | o "Responder" do push não abre a conversa; se a origem não for travada, qualquer página que embutir o chat lê conversas |
| Cookie `crm_tela` + `?cliente=` na URL (`lembrarTelaAtual`) | §64 | recarregar dentro do hub joga todo mundo no board |
| Realtime `board`/`mudou` e `ligacao` (só `call_id` no payload) | §15.4, §22.2 | a conversa não se atualiza; a campainha não toca |
| Incremental `?desde=` + `juntar()` + `estados` (ticks) | §65 | rajada de mensagens chega em lote; os ticks congelam |
| Guarda `aindaAberta` | §70 | mensagem da cliente A aparece na conversa da cliente B |
| `embed=1` sem gravar `crm_tela` | §64.2 | a volta do SSO cai numa conversa em tela cheia, sem navegação |
| Microfone delegado + mensagem de erro que diferencia as causas (`lib/microfone.ts`) | §22.5, §66 | "permissão negada" sem prompt dentro do iframe |

### 2.5 Peso no navegador
- `Thread` e `ListaConversas` virtualizadas. Já existe `useVirtualizacao` em `app/chat/virtual.tsx`.
  **Mova** para `lib/virtualizacao.tsx` (`git mv`, sem mudar o comportamento, commit separado) e
  deixe `app/chat/virtual.tsx` só reexportando. **Não copie:** duas cópias divergem, e isso
  recriaria a dívida de duas renderizações que a §41.2 do CLAUDE.md eliminou.
- Mídia com largura e altura reservadas: nada de pulo de layout quando a imagem carrega.
- `React.memo` em `ItemConversa` e `Bolha`, com props estáveis (`useCallback` nos handlers).
- Pesados via `next/dynamic`: ligação/WebRTC, gravador de áudio, templates, PDF, mapa/localização.
- Meta: **First Load JS de `/chat-v2` bem menor que o de `/chat`**. Anote os dois do `next build`.

---

## 3. Visual: Google Material com a paleta Murano

O usuário **gostou especificamente do Material** do Painel. Implemente com **Tailwind v4, sem lib
de componentes** (nada de MUI nem Material Web).

### 3.0 Quanta liberdade você tem (dito pelo usuário, 19/09/2026)

> *"na spec, fala sobre respeitar o mapa do chat, a posição das coisas na tela, mas não precisa se
> prender tanto a isso, visando dar uma melhor experiência ao usuário, você pode sugerir pequenas
> mudanças de posicionamento. eu realmente quero outro design, outra cara melhor, e estou confiando
> no google material para isso."*

Então:

- **O alvo é outra cara, não um retoque.** Copiar a tela de hoje pixel a pixel com tokens novos
  seria entregar menos do que foi pedido.
- **O mapa é ponto de partida, não contrato.** Lista, conversa e contato continuam sendo as três
  regiões, e a lógica de leitura (esquerda → centro → direita) fica de pé. Dentro disso, mover
  coisa de lugar é permitido **quando houver motivo**: menos toques para a tarefa, menos coisa
  disputando atenção, ou um erro caro evitado antes de acontecer.
- **Mudança de posição se justifica, e se mostra.** Cada uma entra no relatório da fase com uma
  linha: o que saiu de onde, para onde foi, e qual tarefa ficou mais barata. O usuário vê a tela
  antes de ela virar padrão de alguém (fase 6, piloto por pessoa).
- **O que NÃO se mexe sem perguntar:** o gesto que o time repete o dia inteiro — abrir uma
  conversa pela lista e escrever. Esse caminho pode ficar mais bonito, mas não pode exigir
  reaprendizado.
- **Memória muscular tem preço.** A §60.6 do CLAUDE.md já registrou isso ao deixar o item 10 do
  tema premium de fora: quando um controle sai do lugar, a pessoa procura por ele. Vale mexer, mas
  sabendo que custa, e no piloto primeiro.

### 3.0.1 O azul, que é assinatura — e por sorte já é regra

Pedido do usuário, na mesma conversa:

> *"quero que aplique também a cor azul sutilmente em algumas coisas, de forma discreta, que este é
> o meu toque como desenvolvedor, minha identidade, o azul, então coloque sutilmente azul, quando
> possível."*

Isso **não briga** com a marca: a skill `murano-brand` já dá um trabalho a cada cor — **púrpura é
marca, azul é ação, laranja é acento pontual**. O chat de hoje já usa azul nos ticks de lida e nos
links (§11.6). O que muda é passar a usá-lo **de propósito e em todo lugar que for ação**, em vez
de em dois lugares por acaso.

Onde o azul entra (discreto, nunca dominante):

| Lugar | Como |
|---|---|
| ticks de entregue e lido | `#1a5fa8` — é o que o time já lê como "chegou" |
| links e telefone clicável | `#1a5fa8`, sublinhado no hover |
| anel de foco do teclado | `#2f7fd4` (só contorno: dá 3:1, que é a régua de elemento não-textual) |
| estado selecionado | conversa aberta na lista e aba ativa: filete azul de 2–3px, não fundo chapado |
| bolha enviada | fundo azul discreto, porque enviar é ação (a Direção 1 já fez isso, §29.7) |
| barra de progresso e carregamento | azul |

⚠️ **`#2f7fd4` não serve de fundo com texto branco: 4,11:1, reprova** (§58.3). Para fundo, é
`#1a5fa8` (6,47:1). Mesma cor, dois papéis, e só um deles é válido.

⚠️ **Um acento por região.** Se o azul aparecer ao lado do laranja no mesmo canto da tela, os dois
perdem. O laranja fica para o que é aviso ou uma única chamada principal; o azul, para ação
corriqueira. O vinho segue sendo a moldura da marca.

### 3.1 Tailwind sem quebrar o resto do CRM
⚠️ **O CRM não tem Tailwind.** O `web/package.json` (Next 14.2.5, React 18.3.1) não tem
`tailwindcss` nem `@tailwindcss/postcss`, e não há config de PostCSS. Instalar os dois e criar o
`postcss.config.mjs` é **dependência nova de build, que vale para o app inteiro**, não só para o
v2. Diga isso no relatório e confira que o `next build` e as telas antigas continuam iguais.

O preflight do Tailwind resetaria as telas antigas. Em `app/chat-v2/v2.css`:
```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
/* base mínima só dentro de .v2 */
```
Importe **só** em `app/chat-v2/layout.tsx`. Depois de instalar, confira `/`, `/chat` e `/admin`
no navegador: não podem ter mudado.

⚠️ **"Importar só no layout" não restringe o CSS ao v2.** No App Router, a folha de estilo que uma
rota carrega **continua no documento** depois que o usuário sai dela por navegação no cliente. As
utilidades sem preflight são por classe e não fazem mal. Mas as variáveis do `@layer theme` iriam
para o `:root` e passariam a valer em `/`, `/chat` e `/admin`. Portanto:
- declare os tokens da §3.2 em `.v2 { ... }`, não em `:root`, ou use um prefixo próprio
  (`--v2-color-*`) no `@theme`;
- confira as três telas **depois de navegar a partir do `/chat-v2`**, não só abrindo cada uma
  direto.

### 3.2 Tokens
Copie de `src/app/globals.css` do Painel:
```css
--color-primary: #621244;              /* vinho: marca, app bar, botão primário */
--color-on-primary: #ffffff;
--color-primary-container: #f5edf4;
--color-tertiary: #dd4222;             /* laranja: CTA e destaque, UM por tela */
--color-surface: #ffffff;
--color-surface-dim: #f5edf4;          /* fundo */
--color-on-surface: #1c0e1b;
--color-on-surface-variant: #6e5a6c;   /* texto secundário */
--color-outline: #e4d4d3;
--color-sucesso: #1d6b45;  --color-sucesso-container: #dff1e7;
--color-erro: #b3261e;
--color-acao: #1a5fa8;                 /* azul: ação, ticks, links, bolha enviada (§3.0.1) */
--color-acao-foco: #2f7fd4;            /* azul claro: SÓ contorno de foco, nunca fundo com texto */
--shadow-e1 / e2 / e3                  /* elevação, sombra tingida de #1c0e1b */
--ease-padrao: cubic-bezier(0.2, 0, 0, 1);
--ease-enfatico: cubic-bezier(0.05, 0.7, 0.1, 1);
```
⚠️ **Contraste medido vence token.** O `laudo-tema-premium.md` e a §29.1 do CLAUDE.md têm
calibragens reais: vinho chapado sobre card = 1,46:1; púrpura como texto precisa clarear; texto
secundário de 10px reprovou. Texto nunca abaixo de 4,5:1. No chat, o texto das bolhas é o que mais
se lê: capriche.

### 3.3 Componentes Material, como o Painel implementa
| Componente | Como fica | Referência no Painel |
|---|---|---|
| **Top app bar** | vinho, sticky, elevação 2; no celular vira a barra da conversa (voltar + nome + ações) | `src/app/(painel)/layout.tsx` |
| **Card / superfície** | `bg-surface rounded-3xl shadow-e1`; hover `shadow-e3` | `src/app/(painel)/page.tsx` |
| **Extended FAB** | laranja `bg-tertiary rounded-2xl h-12`, e2 → e3 (ex.: "Nova conversa") | `src/components/NovoProjeto.tsx` |
| **Botões** | filled vinho `rounded-full`; text com `hover:bg-primary/5`; ícone redondo 40–48px no compositor | `NovoProjeto.tsx`, `FormLogin.tsx` |
| **Filter chips** | pill h-9 com contagem; ativo vinho, inativo `ring-1 ring-outline` (Minhas, Não lidas, Aguardando, Favoritas…) | `src/components/ListaDemandas.tsx` |
| **Outlined text field** | `rounded-xl`, foco `primary` + `ring-2 ring-primary/20`, **fonte ≥ 16px** (abaixo disso o iOS dá zoom) | `src/components/Campo.tsx` |
| **Dialog** | `<dialog>` nativo, `rounded-3xl`, e3, scrim `bg-murano-dark/50 backdrop-blur-sm` | `NovoProjeto.tsx` |
| **Bottom sheet** | celular: painel do contato, templates e respostas rápidas sobem de baixo, com alça e safe-area | novo |
| **Menu** | superfície e3 ancorada; no celular, ações da mensagem abrem por **toque longo** | `ListaDemandas.tsx` |
| **Snackbar** | base da tela, acima do compositor, fila de avisos, 4 s, ação opcional ("Reenviar") | `ListaDemandas.tsx` |
| **Badge** | contador de não lidas `tabular-nums`, laranja; estado da conversa colorido | `src/components/BadgeEstado.tsx` |
| **State layer** | hover/foco com a cor do conteúdo em 5–10% de opacidade | todos |
| **Ripple** | onda a partir do toque, 550 ms, 16% (`data-ripple` + listener global) | `src/components/Ripple.tsx` + `.ripple-onda` |
| **Motion** | `--ease-padrao` para estado, `--ease-enfatico` para entrada; bolha nova entra com `translateY(6px)` em 200 ms; respeitar `prefers-reduced-motion` | `globals.css` |

- **Tipografia:** Inter (o CRM já carrega). Títulos 800/900 com tracking negativo acima de 24px.
  **`tabular-nums` em todo número:** horas, contadores, valores, telefones.
- **Estados de tela:**
  - esqueleto com o formato real (lista, bolhas alternadas, compositor);
  - vazio com frase útil;
  - erro como snackbar;
  - nunca `alert()`, nunca tela branca.

---

## 4. Mobile-first. É a reclamação do time e o requisito central.

**Desenhe e teste primeiro em 360px.** A classe sem prefixo é a do celular; `sm:`/`md:`/`lg:` só
acrescentam. O CRM roda **dentro do iframe do hub** (§17) e dentro da **lupa do board** (iframe de
~500px, §41). Media queries CSS respondem à largura do iframe, então o layout se adapta sozinho.
**Use CSS para layout, não `window.innerWidth` em JS.** Se algum comportamento precisar saber o
tamanho em JS, centralize num único hook com `matchMedia`.

### 4.1 As três regiões por largura
| Largura | Lista | Conversa | Contato/ERP |
|---|---|---|---|
| < 768 (celular, lupa do board) | tela cheia | tela cheia, com voltar | **bottom sheet** ao tocar no nome. **Não some**: o dado de compra é o diferencial |
| 768–1023 (tablet) | coluna fixa ~320px | resto | sheet lateral por cima, abre/fecha |
| ≥ 1024 (desktop) | ~320–360px | resto | ~340px fixo, recolhível |

**O mapa continua:** lista à esquerda, conversa ao centro, contato à direita, compositor embaixo.
No celular, a navegação é **lista → conversa → contato**, com o voltar nativo funcionando (estado
na URL).

**Dentro dele, mexa com critério** (§3.0). Os quatro lugares em que mover coisa de lugar tem
motivo medido, e onde eu começaria:

1. **Contador de não lidas fora do menu** — hoje exige abrir um dropdown (achado 1), e é a primeira
   pergunta do dia.
2. **Janela de 24h acima do compositor**, antes de escrever — hoje só se manifesta como erro,
   depois da mensagem pronta (achado 2). Cada descoberta tardia custa R$ 0,43 de template.
3. **Barra de ligação no fluxo**, entre a barra e a thread — hoje é `fixed` e cobre a caixa de
   texto justamente quando se anota o pedido (achado 4 e §60.8, item 30).
4. **O número do ERP em tamanho de herói** no painel do contato — hoje o valor faturado trunca em
   268px, e quanto maior a cliente, mais cedo some (§58.3).

Nenhum desses quatro tira controle nenhum do lugar onde a mão já procura: os três primeiros
**acrescentam** o que faltava, e o quarto muda a hierarquia dentro do painel que já existe.

### 4.2 Altura, teclado e área segura: o que mais dói no celular
- **`h-dvh`/`min-h-dvh`, nunca `100vh`.** A casca é `flex flex-col h-dvh`: barra, thread
  (`flex-1 min-h-0 overflow-y-auto`) e compositor.
- **Teclado virtual:** `interactiveWidget: "resizes-content"` no `viewport` (Android/Chrome).
  No iOS, ouça `visualViewport` (`resize`/`scroll`) para manter o compositor colado no teclado.
  Ao abrir o teclado, a thread **continua rolada até a última mensagem**.
- **Compositor:**
  - cresce até ~5 linhas e depois rola por dentro;
  - **nunca** ocupa mais de ~40% da altura (hoje sobram 10px para o texto, laudo UX achado 6);
  - `pb-[env(safe-area-inset-bottom)]`.
- **App bar:** `pt-[env(safe-area-inset-top)]`. O CRM já tem `viewportFit: "cover"`.
- **Barra de ligação:** entra no **fluxo** do layout (entre a barra e a thread), **não** `fixed`
  por cima do compositor (achado 4).

### 4.3 Toque
- Alvos ≥ 44px no compositor (anexo, áudio, enviar) e ≥ 40px no resto.
- Nada depende de hover. Ações da mensagem por **toque longo** (e botão "⋯" no desktop). Motivo de
  falha **tocável**, nunca só em `title`.
- `-webkit-tap-highlight-color: transparent` (o ripple substitui).
- Gravação de áudio segurando o botão, com feedback visual. Confira as armadilhas de
  `lib/microfone.ts` e `lib/opusOgg.ts`.

### 4.4 Técnicas do Painel que se aplicam direto
- Chips de filtro que **rolam até a borda**:
  `-mx-4 px-4 md:mx-0 md:px-0 flex gap-2 overflow-x-auto` + `shrink-0`.
- Texto longo: `min-w-0` em filho de flex; `truncate` em nome e telefone; prévia da última
  mensagem em 1 linha.
- Flutuantes que cabem:
  - dialog `w-[calc(100%-2rem)] max-w-md m-auto`;
  - snackbar `inset-x-4 mx-auto max-w-sm`;
  - menus ancorados sem vazar da tela.
- Tipografia e espaço que escalam: `text-base md:text-sm` na lista (maior no toque); paddings
  `p-3 md:p-4`.
- Esconder o secundário, nunca o essencial: contador de não lidas, janela de 24h e ações principais
  aparecem **em qualquer largura** (achado 1: hoje o contador exige abrir um menu).

### 4.5 Como testar
- DevTools em **360, 390, 430, 768, 1024 e 1440px**, retrato e paisagem.
- **Celular de verdade na rede local:** `next start -H 0.0.0.0 -p <porta>` e abrir pelo IP. Android
  e iPhone, se houver. Emulador não mostra o teclado real.
- **Dentro de iframe:** uma página de teste com `<iframe src="/chat-v2?cliente=X&embed=1"
  width=500 height=640>`, simulando a lupa do board e o hub.
- Em 360px, **nenhuma rolagem horizontal da página**.

---

## 5. Fases, cada uma testável em localhost

| Fase | Entrega | Pronto quando |
|---|---|---|
| **0. Medir** | Números do `/chat` atual: tempo até a lista aparecer, até abrir uma conversa, atraso por tecla (Performance do DevTools, digitando 20 caracteres), idas/bytes ao banco, First Load JS, Lighthouse mobile. `prototipos/chat-v2/medicao-base.md` | tabela preenchida |
| **1. Ler** | `/chat-v2`: casca responsiva, lista (filtros, busca, não lidas), thread virtualizada com paginação, painel do contato. **Sem enviar nada** | esqueleto no 1º byte e lista no mesmo documento (streaming); 360px impecável; números melhores que a fase 0 |
| **2. Escrever** | Compositor com estado próprio, envio otimista (com `SIMULACAO_ENVIO=1`), janela de 24h antecipada, templates, respostas rápidas, marcar como lida | digitar sem atraso perceptível; falha tocável + reenviar |
| **3. Completar** | Mídia (foto, vídeo, doc), áudio, notas, transferir, pegar/devolver/resolver, favoritar, cadastro/ficha WinThor, localização, encaminhar, PDF | itens do `checklist_chat_crm.md` marcados como feitos no v2 |
| **4. Delicado** | Ligação (WebRTC, `next/dynamic`), push, `embed=1` para a lupa do board | ligação com número interno; embed funcionando no board |
| **5. Paridade** | Rodar `testes/` contra o v2 (adaptar seletores) + revisão dos 96 casos | relatório de paridade: cada caso ✅ / ⚠️ / ❌ com motivo |
| **6. Piloto** *(com o usuário)* | Plugar no interruptor: novo desenho `fluido` em `lib/chatLayout.ts` (`implementado: true` só agora) | usuário liga para 1–2 vendedores via `acesso.chat_layout` |
| **7. Todos e aposentar** *(com o usuário)* | Global = `fluido`; depois de um período estável, remover os desenhos antigos | decisão do usuário |

**Como plugar na fase 6 sem carregar o chat antigo para quem usa o novo:** a escolha do desenho
deve acontecer **no servidor**, antes de mandar JS. Hoje o desenho vem de `/api/chat`
(`layoutEfetivo`, `app/api/chat/route.ts:385`), ou seja, depois de o JS antigo carregar. Proposta:
1. mover o componente atual de `app/chat/page.tsx` para `app/chat/ChatOriginal.tsx` com `git mv`,
   **sem alterar conteúdo**;
2. criar um `app/chat/page.tsx` servidor fino que lê `layoutEfetivo` e renderiza `ChatOriginal` ou o v2.

⚠️ **Custo desse passo 2:** consultar `chat_layout` + `acesso.chat_layout` no servidor coloca uma ida
ao banco **antes de qualquer HTML, para todo mundo**, inclusive quem continua no chat antigo. Hoje
essa ida é paga dentro do `/api/chat`, junto com as outras. Alternativa a avaliar com o usuário:
um cookie com o desenho efetivo, gravado quando o admin troca o desenho e renovado pelo
`/api/chat`, com o banco só como reserva quando o cookie não existe. A regra continua sendo uma
só, `layoutEfetivo()` (§29.3), e o cookie só guarda o resultado dela.

Isso encosta num arquivo-monstro. **Combine com o usuário o momento** (CLAUDE.md §0: arquivos-monstro
são serializados).

**Ao fim de cada fase:**
- commit local;
- atualizar `prototipos/chat-v2/relatorio.md` com o que mudou, os números e o que falta;
- **parar e mostrar ao usuário** antes de seguir.

---

## 6. Next 14 → 16: fazer depois, mas escrever o v2 já pronto para ele

**Decisão: não atualizar agora.**
- A atualização mexe no CRM inteiro, não só no chat:
  - `cookies()`, `headers()` e `params` viram async em todas as rotas;
  - React 19;
  - `middleware` vira `proxy`;
  - `experimental.serverComponentsExternalPackages` vira `serverExternalPackages`;
  - Turbopack por padrão;
  - `next lint` removido.
- Misturar isso com a reconstrução do chat dobraria o risco e tornaria impossível saber qual das
  duas mudanças causou um problema.

**Quando:** depois que o v2 virar o chat de todos e os desenhos antigos forem removidos. São ~6.700
linhas a menos para migrar. Fazer como frente própria (worktree própria), com:
1. o codemod oficial: `npx @next/codemod@canary upgrade latest`;
2. build e a bateria `testes/` inteira;
3. os guias em `node_modules/next/dist/docs/01-app/02-guides/upgrading/` (versões 15 e 16).

**Enquanto isso, o v2 nasce compatível:**
- acesso a `cookies()`/`headers()` só em **um helper** em `lib/` (ex.: `lib/sessaoServidor.ts`); na
  migração muda num lugar só;
- nada de API já deprecada: sem `useFormState` (use `useActionState` quando migrar; no 14, prefira
  `useTransition`), sem `next/legacy/image`;
- `useOptimistic` já funciona no App Router do 14 (React canary embutido). ⚠️ Os **tipos** estão
  só em `@types/react/canary.d.ts`: adicione `/// <reference types="react/canary" />` (num `.d.ts`
  do v2), senão o `tsc` falha dizendo que o `react` não exporta o hook;
- tipos de `params` escritos como se fossem `Promise` onde for barato.

Anote isso no relatório como **próxima frente recomendada**, com a lista acima.

---

## 7. Recomendação para produção, independente do chat

**As funções do CRM na Vercel rodam em `iad1` (Washington)** e o Supabase está em `sa-east-1`
(São Paulo). **Reconferido em 19/09/2026** por dois caminhos independentes:
- cabeçalho de resposta da produção, `GET https://crm.muranoprofessional.com.br/api/session`:
  `X-Vercel-Id: gru1::iad1::…` em 3 de 3 chamadas. O primeiro campo é a borda (São Paulo) e o
  segundo é onde a **função** rodou (Washington);
- API do Supabase para o projeto `wtunzezigncwjpcqsfzk`: `"region": "sa-east-1"`.

Cada uma das ~20 idas ao banco do `/api/chat` atravessa o continente.

⚠️ **Isto contradiz o `prototipos/laudo-performance.md` §0**, que afirma "Vercel colada ao banco"
e por isso trata a rede em produção como "poucos milissegundos". **Essa premissa está errada.**
As conclusões do laudo que dependem do "trabalho do servidor" continuam valendo. Mas o custo de
rede em produção **não é desprezível**: cada ida e volta Washington ↔ São Paulo custa dezenas de
milissegundos, multiplicados pelas idas em série. Corrija o laudo quando registrar a fase 0.

Para conferir de novo: `curl -sD - -o /dev/null <url>/api/session | grep -i x-vercel-id`. **Fixar em `gru1`** (`vercel.json` → `"regions": ["gru1"]`) é
uma linha, não muda código e acelera **todas** as telas. O Painel fez isso. **Não aplique:** registre
no relatório como item nº 1 para o usuário aprovar.

---

## 8. Persistência

Crie no `CLAUDE.md` do CRM uma seção **"chat-v2"** com:
- as convenções desta spec (onde mora, regras de estado, Tailwind escopado, mobile-first,
  proibição de importar de `app/chat/`);
- o estado atual das fases.

Assim a próxima sessão continua sem reexplicar nada.

---

## 9. Checklist por fase
- [ ] Nenhuma migration aplicada sem aprovação; nenhum envio real (`SIMULACAO_ENVIO=1`); mensagens `sim.` limpas
- [ ] Nada enviado ao GitHub antes da fase 6 aprovada
- [ ] `/`, `/chat` e `/admin` conferidos no navegador e sem mudança, **inclusive depois de navegar a partir do `/chat-v2`**
- [ ] Itens de encanamento da §2.6 conferidos (hub, `crm_tela`, Realtime, `?desde=`, `aindaAberta`)
- [ ] `/chat-v2` em 360 / 390 / 430 / 768 / 1024 / 1440px, sem rolagem horizontal da página
- [ ] Testado em celular real na rede local e dentro de iframe de 500px
- [ ] Números medidos (não estimados) no relatório, comparados com a fase 0
- [ ] Porta e processos do `next start` encerrados
