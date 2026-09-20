# chat-v2 — relatório por fase

> Estado: **fase 1 (ler) entregue em 19/09/2026**, em localhost. Nada foi para
> produção. O `/chat` antigo continua intocado e é a volta segura.

---

## Fase 0 — a régua (19/09/2026)

Em `medicao-base.md`. Resumo: a lista de conversas leva **7,4 s** para aparecer,
`/api/chat` custa **32,3 idas ao banco** e **2,9 MB**, e digitar 20 teclas gera
**1 long task de até 136 ms**.

## Fase 1 — ler (19/09/2026)

Mesma régua (`medir.mjs`), mesmo build de produção, mesmo banco, três rodadas,
mediana, como admin:

| | `/chat` (hoje) | `/chat-v2` | |
|---|---|---|---|
| **Lista de conversas visível** | 7.395 ms | **1.120 ms** | **6,6× mais rápido** |
| Primeira pintura (FCP) | 308 ms | 1.180 ms | ⚠️ ver nota |
| TTFB | 21 ms | 77 ms | a página agora busca dado antes de responder |
| **Bytes de API por sessão** | 2.969 kB | **1 kB** | **2.969×** |
| JS baixado | 307 kB | **100 kB** | |
| First Load JS (`next build`) | 156 kB | **97,9 kB** | |
| Abrir conversa — até o compositor | 1.863 ms | **766 ms** | |
| Abrir conversa — até a thread | 1.680 ms | **724 ms** | (3 kB, contra 14) |
| **Long tasks ao digitar 20 teclas** | 1 (51–136 ms) | **0** | |
| Pior interação ao digitar | 72–272 ms | **32–64 ms** | meta: < 200 ms |

⚠️ **A primeira pintura ficou MAIS LENTA, e é de propósito.** No chat antigo ela
acontece aos 308 ms com a tela **vazia** — a lista só chega 7 segundos depois. No
v2 o servidor já manda as 60 primeiras conversas no documento, então a primeira
coisa pintada tem conteúdo. O número que importa para quem trabalha é o da
primeira linha.

### O que mudou de verdade

1. **A primeira carga acontece no servidor.** `app/chat-v2/page.tsx` lê a sessão
   pelo cookie e entrega lista (60 conversas) e, com `?cliente=`, a conversa
   aberta — no HTML.
2. **A lista inteira só vem quando faz falta**: buscar, trocar de recorte ou
   rolar até o fim. Os **contadores dos chips** vêm de uma rota própria que
   devolve cinco números (1 kB) em vez das 4 mil conversas (2,7 MB).
3. **O texto do compositor não sobe.** Vive em `Compositor.tsx` e o pai só
   receberá o evento "enviar" (fase 2). Zero long task ao digitar.
4. **Lista e thread virtualizadas**, com `React.memo` por linha e por bolha.

### Desenho

Google Material com a paleta Murano, e a regra de papel por cor: **vinho é
marca** (a barra), **azul é ação** (ticks, conversa selecionada, bolha enviada,
foco, botão de enviar, progresso da janela), **laranja é acento pontual** (não
lida, janela fechada, falha). Ripple em todo toque, elevação e movimento curto.

Quatro coisas que o laudo de UX cobrava e entraram aqui:

| Achado | Como ficou |
|---|---|
| 1 — contador de não lidas exige abrir um menu | chips sempre visíveis, com número |
| 2 — a janela de 24h só se manifesta como erro | faixa acima do compositor, com quanto falta, **antes** de escrever |
| 3 — o painel do ERP some no celular | folha que sobe, com o número herói (comprado líquido) |
| 5 — motivo da falha só no `title` (exige hover) | texto tocável abaixo da bolha, já traduzido por `lib/erroMeta` |

### Conferido

- 360 / 390 / 768 / 1024 / 1440 px: **sem rolagem horizontal**, sem exceção no
  console, fotos em `testes/saidas/v2-*.png`.
- `/`, `/chat` e `/admin` **iguais** antes e depois de passar pelo `/chat-v2`
  (fundo, margem, fonte e número de botões idênticos; `--color-primary` continua
  vazia no `:root`, porque os tokens do v2 são prefixados).
- Build de produção limpo; `/chat` seguiu em 156 kB.

### Armadilhas pagas nesta fase

- **Rolar a thread para o fim uma vez não basta.** O conteúdo cresce depois do
  primeiro render (a virtualização mede as alturas reais; as imagens carregam
  segundos depois). Quem cola no fim é um `ResizeObserver`, não um `setTimeout`.
- **Contar as filas dentro da carga da página** levou a lista de 994 ms para
  **3.816 ms**. Contadores saíram para uma rota própria, pedida depois da
  pintura.
- **Puxar a lista inteira em segundo plano** deixava a sessão em 2,7 MB mesmo
  com a tela rápida. Só vem quando o gesto exige.
- **`console.log` num preload de `--require`** faz o Next morrer com "Cannot
  find module": o stdout vira argumento do processo que ele levanta.
- **O Git Bash converte `--tela /chat-v2`** em `C:/Program Files/Git/chat-v2`.
  Usar `MSYS_NO_PATHCONV=1`.

### O que a fase 1 NÃO faz (e é assim mesmo)

Enviar mensagem, mídia, template, nota, transferir, resolver, ligar, favoritar,
marcar como lida, Realtime, push, `embed=1` para a lupa do board, etapa do board
nos chips, filtro por número e a busca no conteúdo das mensagens. Fases 2 a 4.

---

## Itens para o usuário decidir

1. **Região da Vercel — RESOLVIDO em 19/09** (PR #234): as funções rodavam em
   `iad1` com o banco em `sa-east-1`. Produção agora responde `gru1::gru1`.
2. **Next 14 → 16**: fica para depois que o v2 virar o chat de todos (spec §6).
   O `npm install` avisa que o **14.2.5 tem vulnerabilidade de segurança
   conhecida** — mais um motivo para essa frente existir, mas não junto desta.
