# Protótipos do `/chat` — como abrir e como decidir

Três direções de redesenho do chat do CRM Murano, para escolha. Nada aqui é
código de produção: **nenhum arquivo de `web/`, `src/` ou `supabase/` foi tocado.**

## Como abrir

Duplo clique em qualquer um dos `.html`. São arquivos **standalone** — CSS e JS
inline, sem build, sem CDN, sem servidor. A única coisa que vem da rede é a fonte
Inter (Google Fonts), e há fallback de sistema se estiver offline.

Em cada protótipo, no topo:

- **Desktop / Mobile** — o mobile aparece em duas molduras de 390 × 844 lado a
  lado, mostrando a lista e a conversa ao mesmo tempo. Clique numa conversa para
  navegar entre elas.
- **Claro / Escuro** — as duas variantes derivam da mesma paleta oficial do hub
  (`murano-app/src/app/globals.css`). A Direção 3 abre no escuro de propósito.
- **Cenários** — interruptores que ligam os estados críticos: janela de 24h
  fechada, falha de envio, ligação recebida, chamada em curso, transferência,
  encerramento, escolha de template, gravação de áudio. É neles que as diferenças
  entre as direções aparecem.

Dentro de cada arquivo, no rodapé, há a **tese daquela direção e o que ela
sacrifica**. Toda direção sacrifica algo; dizer o quê faz parte do trabalho.

O laudo completo — achados com evidência em `arquivo:linha`, mapa das dez tarefas
com custo em cliques, o que está bom e deve ser preservado, e os riscos — está em
**[`laudo-ux-chat.md`](./laudo-ux-chat.md)**.

## Os arquivos

| Arquivo | Direção |
|---|---|
| `direcao-1-continuidade.html` | Continuidade — o mapa do RD, com o que faltava aparecer |
| `direcao-2-fila-de-trabalho.html` | Fila de trabalho — a lista vira ordem de serviço |
| `direcao-3-balcao.html` | Balcão — a unidade de trabalho é a cliente, não a conversa |
| `laudo-ux-chat.md` | O laudo de UX |

---

## O que cada direção defende

### 1 · Continuidade
**Nada muda de lugar. Coisas passam a aparecer.** A equipe tem memória muscular do
RD Conversas, e o orçamento inteiro de mudança foi gasto nos quatro pontos que
doem todo dia: os contadores das filas saem de dentro do dropdown; a janela de 24h
vira uma faixa permanente acima da caixa; o painel do cliente abre no *Resumo*
(gasto, dias sem comprar, ciclo) em vez de abrir no telefone; e o mobile ganha
barra inferior, folha deslizante com o ERP, `100dvh` e área segura. De quebra, três
freios em erros caros: motivo antes dos nomes na transferência, custo do template
à vista, e a falha de envio com o motivo e o botão de reenviar dentro da bolha.

*Sacrifica:* não muda a forma do dia. Continua sendo uma fila cronológica — o
sistema mostra melhor o que existe, mas não diz o que fazer em seguida. E não
resolve a tabulação como problema cultural.

### 2 · Fila de trabalho
**A pergunta do vendedor não é "que conversas existem", é "qual é a próxima".** A
lista vira uma fila em seções: *Esperando você* (ordenada pela espera mais longa,
com selo de três estados), *Janela fechando*, *Adiadas*, *Sem dono*, *Resto*.
Adiar vira ação de primeira classe. Quando a conversa esfria, a pergunta "no que
deu?" aparece **dentro da conversa**, e o botão "Fechei a venda" escreve, encerra e
tabula num gesto. Teclado para o dia inteiro: `⌘K`, `j`/`k`, `r`, `e`, `s`, `t`.
Cartão de altura uniforme, que é o pré-requisito barato da virtualização.

*Sacrifica:* é a direção com maior custo de treinamento. Quebra a lista única, e
uma seção que classifica errado é pior que uma lista burra. A ficha do ERP recua
para caber a fila mais larga.

### 3 · Balcão
**Isto não é um help desk, é um balcão de venda — e a unidade de trabalho é a
cliente.** Os quatro números do ERP viram uma faixa fixa sob o cabeçalho, com a
ação recomendada como um botão que **escreve a mensagem**. A coluna da direita
deixa de ser estável e passa a responder ao momento: janela fechada mostra os
templates com o texto; chegou foto, mostra o catálogo com preço e o botão de
mandar; a conversa esfriou, mostra a tabulação; tocou o telefone, vira o painel da
chamada. A lista é de clientes, com anel de ciclo de recompra antes da prévia da
mensagem. Nasce no escuro, como o hub que embute este CRM.

*Sacrifica:* é a maior ruptura com o RD. Painel que se move divide opiniões, e uma
sugestão comercial defasada vira mensagem errada com aparência de autoridade.
Cartões mais ricos custam consulta.

---

## Tabela de decisão

| | 1 · Continuidade | 2 · Fila de trabalho | 3 · Balcão |
|---|---|---|---|
| **Risco de treinamento** | baixo | alto | alto |
| **Fidelidade ao mapa do RD** | total | parcial (lista muda) | baixa (direita muda) |
| **Resolve triagem em 3 s** | parcial (contadores) | **sim** (fila ordenada por espera) | parcial (estado comercial) |
| **Resolve a janela de 24h** | mostra | mostra e **trava a caixa** | mostra, trava e oferece o template ao lado |
| **Resolve a tabulação** | não (facilita) | **sim** (vem procurar o vendedor) | **sim** (dossiê do momento) |
| **Usa a vantagem do ERP** | resumo por padrão | ficha estreita com ações | **fusão total** (faixa fixa + catálogo) |
| **Mobile** | resolvido | resolvido + gestos (swipe, áudio com trava) | resolvido + carrossel de contexto |
| **Teclado** | inalterado | **⌘K, j/k, r/e/s/t** | inalterado |
| **Custo de dados por conversa** | igual ao de hoje | um pouco maior | **bem maior** |
| **Prazo estimado de implementação** | curto | médio | longo |

**Uma leitura possível:** as três não são excludentes no tempo. A Direção 1 é o
piso — quase tudo nela é correção do que já existe, e vale mesmo que a escolha
final seja outra. A 2 e a 3 são apostas diferentes sobre onde está o ganho: a 2
aposta em **atender mais conversas por dia**, a 3 em **vender mais por conversa**.
A pergunta a responder antes de escolher é essa, não qual tela é mais bonita.

---

## Convenções seguidas nos três arquivos

- **Nenhum dado real de cliente.** Nomes de salão e de pessoas são inventados;
  telefones com DDD 91 e produtos de cosmético reais de categoria, não de cadastro.
  O repositório é público (`CLAUDE.md` §15.5).
- **Ícones em SVG inline**, sem biblioteca — a casa não usa lucide/heroicons e a
  skill `murano-brand` §6 pede que continue assim.
- **Paleta derivada só de tokens oficiais** do hub (`--color-murano-*`), com a
  divisão de papéis da skill: púrpura = marca, azul = ação, laranja = acento
  pontual. O rosa `#f5edf4` e o roxo `#7b2d8b` do chat atual **não** foram usados:
  nenhum dos dois é token de lugar nenhum (ver laudo §3.11).
- **Contrastes conferidos** e anotados no laudo; nenhuma informação depende só de
  cor.
- `100dvh`, área segura desenhada e alvos de toque ≥ 44 px nas telas mobile.
- `prefers-reduced-motion` respeitado.

---

## Adendo (27/08/2026) — `/templates`, a tela do CONSULTOR

Assunto diferente do redesenho do chat acima. Dois arquivos novos:

| Arquivo | O que é |
|---|---|
| `laudo-templates-consultor.md` | laudo curto: tarefas reais, ordem dos blocos, o que NÃO entra, as seis formas de enganar a pessoa, e a lista do que a tela do ADMIN precisa ganhar para avaliar as sugestões |
| `templates-consultor.html` | protótipo navegável — desktop e celular na mesma página, um abaixo do outro. Abre com duplo clique |

O que dá para exercitar no protótipo: abrir o compositor (pela lista ou pelo
botão fixo do celular), digitar e ver a prévia no balão do WhatsApp com o `{{1}}`
já preenchido, inserir campos, estourar o limite de 1024, cair no aviso de
numeração fora de sequência (`{{1}}` + `{{3}}`) e no de link encurtado, enviar
para o administrador, e usar “corrigir e reenviar” numa sugestão recusada.
Na barra do topo: tema escuro e os dois estados vazios (carteira sem template
aprovado; ninguém nunca sugeriu nada).

Os **cinco** estados de uma sugestão estão todos na tela, e essa é a tese do
desenho: `em análise com o administrador` → `aprovada pelo administrador` →
`criada na Meta` → `pronta para usar`, mais `recusada + motivo`. São dois
vereditos em sequência (admin, depois Meta), e colapsá-los em “aprovada” faria a
consultora procurar no chat um template que ainda não está lá.
