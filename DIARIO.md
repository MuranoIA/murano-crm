# Diário de demandas

Uma linha por demanda, com o nome que o usuário deu a ela. Mais novo em cima.

Por que existe: várias demandas chegam no mesmo dia, algumas atravessam outras,
e "o que já está em produção" não é a mesma coisa que "o que está pronto no
código". Sem isso, o que fica registrado é o commit — que conta o que mudou, não
o que foi pedido nem o que ainda falta.

**Estados:** `no ar` (mesclado e em produção) · `pronto` (código feito, ainda não
mesclado) · `em curso` · `a fazer` · `com você` (depende de uma ação sua).

---

## 14/09/2026

### 1. Mover o "⋯" para o fim da barra — `no ar`
O dropdown criado no #205 ficava no meio das abas; foi para o fim da linha, ao
lado do nome. Saiu de dentro do `<nav>`, o que também soltou a trava de 20px de
altura que existia para a barra não ganhar setas de rolagem.
→ PR #206.

### 2. Push notification com ação "Responder" — `no ar` · `com você`
Aviso de mensagem nova para quem trabalha **dentro do hub**. O push já existia
desde a 0096 e nunca alcançou o time: em iframe cross-origin o navegador
responde `Notification.permission = "denied"` antes de qualquer pergunta
(medido). A inscrição passou a nascer no hub; a entrega continua saindo do
webhook, daqui.
→ murano-crm #207 e #208 · murano-app #22 · correção do batimento #23 · §72.

**Com você:** confirmar que uma mensagem real gera a notificação. O que já foi
provado é a cadeia (um push real chegou ao aparelho) e o agrupamento; o que
falta é o caminho completo, de ponta a ponta, com o hub em segundo plano.

### 3. Criar o acesso da Tati — `no ar` · `com você`
Tatiana (pós-venda) passou de `home` para o papel **`pos-venda`**.

Dois achados que encurtaram a demanda: o papel **já existia** no código desde
09/09/2026, com exatamente a regra pedida (enxerga o mesmo que `home`, sem as 4
features de admin, papel próprio para divergir depois); e a **Tatiana já tinha
acesso**, idêntico ao da Lais. Então não houve papel a criar nem acesso a
conceder — só a troca do rótulo, que é o que permite regra própria daqui em
diante.

Auditoria antes de mexer: nenhuma comparação literal com `"home"` na lógica de
negócio. Tudo passa por `veTudo`/`PAPEIS_QUE_VEEM_TUDO`, e o que resta compara
pela **negativa** (`!== "vendedor"`) — que é o que faz um papel novo funcionar
sem ninguém lembrar de atualizar uma lista.

**⚠️ Ela não conseguia entrar — e não era a troca de papel.** Relatado logo
depois: "e-mail não autorizado" no login. O `acesso` dela tinha
`tatiana@muranoprofessional.com.br`, e a conta Google dela é
`tatianaalves@muranoprofessional.com.br` — cadastrada errada desde 29/07, então
ela **nunca** tinha conseguido entrar. O que denunciou foi o banco: existe uma
conta Google com esse endereço, que entrou às 09:37 e não tem linha em `acesso`;
e existe uma inscrição de push dela no hub, ou seja, ela alcança o hub e parava
no CRM. E-mail corrigido.

A conversa que tinha sido transferida para o endereço inexistente **não ficou
órfã** — já havia sido movida para o thiago às 09:27. O histórico de
transferência fica como está: ele é append-only e registra o que aconteceu.

**Com você:** a Lais também é pós-venda? Ela ficou em `home`. Se for do mesmo
time, deveria ir junto — senão qualquer regra futura de pós-venda pega uma e não
a outra.

### 4. Chat com os mesmos itens de menu do funil — `no ar`
No funil aparecem **Orçamento** e **Templates**; no chat, não. Quem estava no
chat tinha de voltar ao funil para chegar neles.

Orçamento não é rota: é um painel flutuante (`OrcamentoFlutuante`), o mesmo
componente do funil — reusado, não reimplementado. Um link para `/orcamento`
levaria à página cheia e tiraria o consultor da conversa.

**⚠️ E a captura de tela pegou outra coisa:** o papel da atendente de pós-venda
aparecia como "Supervisão", por um ternário anterior ao papel novo. Não é um
rótulo feio, é um rótulo falso — e é o mesmo texto que aparece na presença, para
os colegas. Corrigido para "Pós-venda"; `home` continua "Supervisão", que é o que
a Lais vê hoje.
→ PR #209.

### 5. Número de clientes em espera não condiz com a verdade — `a fazer`
Consultores relatam que a contagem da fila de espera não bate com o que de fato
está lá. A analisar.

### 6. Aviso automático de transferência para pós-venda — `a fazer`
Ao transferir uma conversa para a Tati (pós-venda), mandar uma mensagem à
cliente avisando ("estou transferindo você para o setor de pós-venda").

### 7. Avisar o administrador quando chega sugestão de template — `a fazer`
Quando um consultor cria um template, ele entra na fila de sugestões e pode
ficar esquecido lá. O administrador precisa ver na tela que há algo esperando
aprovação.

### 8. Finalizar conversas automaticamente após 48h sem interação — `a fazer`
Conversa parada há mais de 48 horas passa a `resolvida` sozinha. A combinar
quando for fazer: o que conta como "interação", se a cliente responder reabre
(hoje o webhook já reabre), e se o encerramento automático precisa de motivo —
o motivo é o que transforma "encerrei" em dado (§21.1).

### 9. A imagem da sugestão de template se perde na aprovação — `a fazer`
O consultor monta a sugestão com imagem; quando o administrador aprova e cria de
fato o template, a imagem não vai junto. Deve ser persistida e reaproveitada.

⚠️ Ponto de atenção já conhecido (§24.3): a imagem vive em DOIS lugares e os
dois são necessários — o `header_handle` da Meta, que serve para APROVAR, e o
arquivo no bucket `wa-midia`, que é o que será ENVIADO a cada disparo. Trocar um
pelo outro quebra em momentos diferentes, e o segundo só falha em produção.

---

## Anotado, sem data para fazer

- **Dar continuidade ao módulo Motorista no `murano-app`** (pedido em
  14/09/2026). Não é neste repositório — é no hub, dentro de Entregas.
