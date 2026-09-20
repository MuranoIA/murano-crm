# chat-v2 — relatório por fase

> Estado: **fases 0, 1, 2 e 3 entregues** (19–20/09/2026), em localhost. Nada
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

## Fase 1 — ler (19/09/2026) · commit `93b926b`

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

## O que falta

| Fase | O quê |
|---|---|
| **4** | ligação (WebRTC), push e notificações, `embed=1` para a lupa do board, presença anti-colisão, filtros por consultor/número e etapa do board |
| 5 | paridade: suíte `testes/` contra o v2 + os 96 casos do checklist |
| 6 | piloto por pessoa (decisão do usuário) |
| 7 | global e aposentar o chat antigo (decisão do usuário) |

### Pendências que dependem do usuário

1. **Número interno para exercitar a ligação** (fase 4). Sem ele a voz é
   construída e não é provada.
2. **`VAPID_PUBLIC_KEY` na Vercel do hub** — pendência antiga do push (§72.7).
3. **Quando ir para produção** e **quem entra no piloto** (fase 6).
4. **Quando eu posso encostar no `app/chat/page.tsx`** — a troca de tela no
   servidor exige isso, e o arquivo tem outras frentes trabalhando nele.

### Não exercitado (dito, não afirmado)

- **Gravador de áudio**: headless não tem microfone.
- **Preservação da rolagem** ao carregar mensagens antigas.

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
