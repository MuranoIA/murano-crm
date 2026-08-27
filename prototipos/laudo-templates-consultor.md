# Laudo de UX — `/templates` para o consultor

> Escrito sobre o código (27/08/2026), não sobre suposição. Evidências em
> `arquivo:linha`. Nada aqui foi implementado: este documento e o protótipo
> `templates-consultor.html` são material de decisão.
>
> Fontes lidas: `web/app/admin/page.tsx:684-960` (`TemplatesAba`),
> `web/app/api/admin/templates-whatsapp/route.ts`, `web/app/api/templates/route.ts`,
> `web/app/chat/page.tsx:3381-3455` (o seletor de template do compositor),
> `web/lib/templateVars.ts`, `supabase/migrations/0090_templates_cloud.sql` e
> `supabase/migrations/0110_template_sugestao.sql` (já existe no disco, ainda não
> commitada — o modelo de dados citado abaixo é o dela, não uma proposta paralela).

---

## 1. O ponto de partida, medido

**Hoje não existe lugar nenhum onde o consultor leia um template fora de uma
conversa.** `/api/templates` tem **um único consumidor** em toda a aplicação:
`web/app/chat/page.tsx:1090`. A lista só se manifesta no dropdown do botão
TEMPLATE (`chat/page.tsx:3395-3440`), que exige uma conversa selecionada e ainda
recorta pelo canal daquela conversa (`chat/page.tsx:3383-3385`).

| Tarefa real | Custo hoje | Custo proposto |
|---|---|---|
| Ver que textos eu posso mandar | abrir `/chat` → escolher **uma cliente** → clicar TEMPLATE → rolar. E só vê os do canal daquela conversa | 1 clique no menu |
| Ler o texto inteiro de um template | idem, e a prévia do dropdown é espremida numa caixa de 360 px | visível na lista |
| Sugerir um texto novo | **não existe** — pede no WhatsApp ou no corredor. Zero registro, zero fila, zero resposta rastreável | escrever e enviar, numa tela |
| Saber no que deu a sugestão | **não existe** — perguntar de novo | a própria tela, com o tempo de espera |
| Corrigir um texto recusado | não existe | "corrigir e reenviar", com o motivo à vista |

Os itens 3 e 4 são o pedido do usuário. O item 1 é o achado que justifica a tela
existir **mesmo para quem nunca vai sugerir nada** — e é ele que evita a
sugestão redundante ("já tem um desses").

---

## 2. Ordem dos blocos, e por quê

1. **Prontos para usar** (aprovados, com o texto inteiro à vista).
   Primeiro porque é a pergunta diária, e porque **ler o que já existe é o
   antídoto da sugestão duplicada**. Quem abre a tela para sugerir e dá de cara
   com um template quase igual resolve sem gerar trabalho para o admin nem custo
   na Meta.
2. **Sugerir um template novo** (o compositor, com prévia ao vivo).
   Não pode ficar escondido — o pedido é que a experiência seja *a mesma de criar
   um template*. Fica como cartão de ação largo logo abaixo da lista, que se abre
   no lugar; no celular, também como botão fixo no rodapé.
3. **Minhas sugestões**, com estado e tempo de espera.
   Por último porque é consulta de retorno: quem acabou de enviar já sabe; quem
   volta no dia seguinte vem justamente por isso e rola até aqui sem esforço.

A tentação é inverter 1 e 2 ("a tela é de criar, então o formulário primeiro").
Isso transformaria a tela numa caixa de sugestões e enterraria o único uso
diário. O compositor não precisa ser o primeiro bloco para ser óbvio — precisa
ser o único bloco com botão na cor de ação.

**Dentro do compositor**, a ordem é: nome → texto (com "+ campo a preencher") →
cabeçalho → rodapé → *por que este texto ajuda a vender* → **o que acontece
depois** → botão. A explicação do destino fica **acima** do botão, não em nota de
rodapé: é a última coisa lida antes do gesto.

---

## 3. O que NÃO deve estar nesta tela

| Fora | Por quê |
|---|---|
| **Disparo em massa** | ação cara (R$ 0,43 por envio) e irreversível, com público declarado e conferido no servidor. É de admin (§26) — e o motivo de ter saído do board foi exatamente estar perto demais de quem trabalha |
| **Extrato de envios / contadores por carteira** (`EnviosAba`) | número de gestão. Aqui vira ruído e convida à comparação entre consultoras numa tela que é de escrita |
| **Tornar padrão · Desativar · Apagar** | mexem no que todo mundo usa. Apagar chega até a Meta e **bloqueia o identificador por 30 dias** (§24.4) |
| **`meta_nome`, idioma, categoria (MARKETING/UTILITY)** | decisão de quem publica: têm regra de formato, mudam o **preço** cobrado pela Meta e não se corrigem depois. A 0110 já os deixou fora da tabela de sugestão de propósito. A intenção comercial ("é oferta" × "é aviso de pedido") entra em texto livre, na justificativa — não como campo que finge autoridade |
| **Templates do RD Conversas** | são ponteiros: `nome` + `rd_template_id`, **sem o texto** (§24). Uma lista de nomes que ela não pode ler não ajuda a escolher; ajuda a escolher errado |
| **Qualquer botão que envie mensagem** | enviar é gesto com uma cliente na frente, no chat. Aqui o equivalente honesto é "usar no chat" (navega) ou "copiar texto" |
| **Editar um template já aprovado** | template aprovado é imutável na Meta — mexer é criar outro. Um botão "editar" seria mentira; o certo é "partir deste" |

---

## 4. Onde é fácil enganar a pessoa

Seis armadilhas, todas com conserto barato.

**4.1 Fazer parecer que foi para a Meta.**
A tela do admin diz hoje `"Enviando para a Meta…"` (`admin/page.tsx:876`) e a
rota devolve `"Enviado para análise da Meta"`
(`api/admin/templates-whatsapp/route.ts:196`). Reaproveitar esse texto no
consultor faz a pessoa esperar aprovação "em minutos a horas" de algo que ainda
nem foi lido por um humano. **O botão diz "Enviar para o administrador analisar";
o estado diz "Em análise com o administrador". A palavra Meta não aparece em
nenhuma sugestão.**

**4.2 Esconder que o admin pode recusar.**
Antes do envio, os desfechos possíveis ficam escritos — incluindo a recusa, que
vem com motivo e pode ser corrigida. Esconder isso não protege ninguém: a recusa
chega do mesmo jeito, só que como surpresa.

**4.3 "Aprovada" ≠ "posso usar" — o erro mais provável deste desenho.**
São **dois vereditos em sequência**: admin, depois Meta (é o desenho da 0110). Um
selo "Aprovada" logo após o admin dizer sim faz a consultora procurar o template
no chat e não achar — `/api/templates` só entrega os que a Meta marcou `APPROVED`
(`api/templates/route.ts:44-46`). São necessários **cinco estados visíveis**, e o
terceiro e o quarto são derivados de `publicado_id` + o status da Meta:

| Estado na tela | De onde sai |
|---|---|
| Em análise com o administrador | `status='pendente'` |
| Aprovada — o administrador ainda vai criar na Meta | `status='aprovado'` e `publicado_id is null` |
| Criada na Meta, esperando a análise deles | `publicado_id` preenchido, `crm_templates.status='PENDING'` |
| **Pronta para usar** | `crm_templates.status='APPROVED'` |
| Recusada + motivo | `status='recusado'` |

**4.4 Prazo inventado.** Não existe SLA para a análise do admin. Escrever
"resposta em até 24 h" é promessa de terceiro. O honesto é mostrar **há quanto
tempo está esperando** ("enviada há 3 dias") — informação verdadeira, e que de
quebra cobra o admin sem precisar de texto acusatório.

**4.5 Prévia que mente.** Duas formas:
- mostrar `{{1}}` cru — ninguém julga um texto com chaves no meio. A prévia usa um
  nome de exemplo e diz que **quem preenche cada campo é o consultor, na hora do
  envio** (é assim desde que o compositor aceita mais de uma variável,
  `chat/page.tsx:3440`);
- contar só o corpo bruto contra os 1024 caracteres. O limite da Meta vale para o
  **texto final, já substituído** — é o que `conferirVariaveis` verifica
  (`lib/templateVars.ts:76-80`). O contador da tela conta o texto da prévia.

`templateVars.ts` é puro justamente para rodar nos dois lados (comentário no topo
do arquivo): a numeração fora de sequência (`{{1}}` seguido de `{{3}}`) deve ser
barrada enquanto se digita, não depois.

**4.6 Sugestão que cai num buraco.** Se nada no `/admin` mostrar que há sugestões
esperando, elas morrem — é literalmente a doença descrita na §36 do `CLAUDE.md`
("um registro que o sistema não sabe classificar não pode simplesmente não
aparecer"). O contador tem que aparecer **antes** de alguém entrar na aba. E, do
lado do consultor, a mudança de estado precisa de um sinal no menu; senão ele
descobre por acaso, dias depois.

---

## 5. O que a tela do ADMIN precisa ganhar

**Onde encaixa.** Quarta posição da chave que já existe dentro da aba
📨 Templates (`admin/page.tsx:790`, hoje `cadastro | disparo | envios`):
**`✍️ Sugestões (2)`**. Não é aba de topo — mesmo argumento da §26: quem avalia
uma sugestão está decidindo entre os templates que já existem, e separar
obrigaria a ir e voltar só para comparar o texto. O número também precisa
aparecer no rótulo da aba de topo (`📨 Templates ·2`), senão só vê quem já entrou.

**O que mostrar para decidir**, por sugestão:

1. quem sugeriu, a carteira e **há quanto tempo espera** (ordenar pela mais
   antiga, não pela mais recente);
2. o texto **como a cliente vai ler** — cabeçalho, corpo com um nome de exemplo,
   rodapé — e não o corpo cru num bloco de código;
3. a **justificativa** ("por que este texto ajuda a vender"), que é o que separa
   uma ideia de um capricho;
4. **quantos campos `{{n}}`** o consultor terá de preencher a cada envio — três
   campos é atrito que reduz o uso do template no dia a dia;
5. **os aprovados ao lado**, para o admin ver na hora se já existe um quase igual
   (evita publicar quase-cópia e pagar duas vezes pela mesma ideia);
6. **conferências automáticas**, todas possíveis antes de falar com a Meta:
   corpo > 1024 · rodapé > 60 · cabeçalho de texto > 60 · imagem **e** cabeçalho
   de texto juntos (a Meta aceita um só) · imagem fora de JPEG/PNG ou > 5 MB ·
   numeração fora de sequência · e **`meta_nome` derivado do nome já existente** —
   o índice único `crm_templates_meta_nome_uq` devolveria 409 só depois do clique,
   e o nome fica bloqueado por 30 dias se um dia for apagado;
7. **link encurtado no corpo** — não é bloqueio, é lembrete: é o que mais causa
   recusa, e a tela de cadastro já avisa isso hoje (`admin/page.tsx:866`).

**Ações, e o que acontece depois:**

| Ação | Efeito |
|---|---|
| **Aprovar e publicar agora** | grava `status='aprovado'` e **abre a vista `cadastro` com o formulário já preenchido** (nome, corpo, cabeçalho, imagem que já está no bucket, rodapé). O admin escolhe a categoria e confere o identificador; o gesto irreversível continua sendo o botão dele. Ao criar, o id novo volta para `publicado_id` |
| **Aprovar sem publicar** | mesmo veredito, sem abrir o formulário — para quando a decisão é "presta, mas publico junto com os outros". É o estado que a tela do consultor precisa nomear como *"ainda não dá para enviar"* |
| **Recusar** | exige motivo (a rota cobra) — é o texto que o consultor vai ler para corrigir. Sem quarto status "pedir ajuste": recusa com motivo + o botão "corrigir e reenviar" do lado do consultor já cobrem o caso, e um status a mais só multiplica os estados a explicar |

**Aprovar não cria nada na Meta** — é a decisão registrada no cabeçalho da 0110, e
ela precisa aparecer em texto na própria tela do admin, porque a sequência
"aprovei, sumiu da fila, nunca publiquei" é fácil de fazer sem perceber. Enquanto
`publicado_id` for nulo, a sugestão aprovada continua visível numa faixa
**"aprovadas, ainda não criadas na Meta"**.

---

## 6. Riscos deste desenho

- **A fila vira caixa de reclamação.** Mitigação embutida: a lista de aprovados
  vem antes, e a justificativa é obrigatória — escrever por que ajuda a vender
  filtra o impulso melhor que qualquer regra.
- **Expectativa de prazo.** Sem SLA declarado, o "há 3 dias" pode virar cobrança.
  É o preço de ser honesto; a alternativa (esconder a data) é pior.
- **Dois lugares para ler o mesmo texto** (esta tela e o dropdown do chat). É
  aceitável — são momentos diferentes: aqui se estuda, lá se dispara. O que não
  pode é divergirem: as duas devem ler `/api/templates`, que já esconde o que a
  Meta não aprovou.
