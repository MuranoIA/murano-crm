# 02 — Manual de Uso

Como usar o CRM de Conversas no dia a dia. Escrito para **vendedores**, **gestão (home)** e
**admin**. Não é preciso saber programar para ler este documento.

> Acesso: https://crm.muranoprofessional.com.br

---

## 1. Entrar no sistema

O acesso é pelo **Login com Google**: use a conta autorizada da Murano
(`@muranoprofessional.com.br`). Não existe mais login por usuário e senha.

Se você tem **mais de um papel** (ex.: admin e vendedor), aparece uma **pílula de identidade**
no canto superior direito com uma setinha — clique para **trocar de papel** sem sair.

### O que cada papel vê

| Recurso | Vendedor | Home (gestão) | Admin |
|---|---|---|---|
| Ver o funil da própria carteira | ✅ | ✅ (todas) | ✅ (todas) |
| Atender (template / mensagem), Chat | ✅ | ✅ | ✅ |
| Visões, Orçamento, Relatório .xls, Tickets | ✅ | ✅ | ✅ |
| Análises, B.I., Ranking (config), Sincronizar, Disparo em massa | — | — | ✅ |

## 2. O funil (board)

O board tem **5 colunas**, da esquerda para a direita:

1. **Lista de prospecção** — clientes da carteira ainda **não contatados** e sem compra no mês. Só permitem **template**.
2. **Ociosos** — pararam de interagir (mais de 24 h). Só **template**.
3. **Tentativa de contato** — conversas novas aguardando andamento. Só **template**.
4. **Negociação** — conversa ativa; **é aqui que você digita e responde** em tempo real.
5. **Pedido emitido** — quem já comprou no período. Mostra o valor da venda.

Cada **card** mostra: nome do cliente, status, última mensagem, o **valor da venda** (quando
houver), e um **selo de ciclo** (ex.: "URGENTE", dias sem comprar). A bolinha colorida no
rodapé indica o vendedor dono.

O board **atualiza sozinho, na hora** (tempo real): quando chega mensagem nova ou sai um
disparo, os cards se reorganizam sem você precisar recarregar a página.

### Sinais visuais úteis
- **AGUARDA RESPOSTA** (pulsando): você mandou algo e o cliente ainda não respondeu.
- **TEMPLATE**: o card está fora da janela de 24 h — só dá para reengajar por template.
- **Sem cadastro**: o contato existe na conversa mas ainda não está casado com um cliente do ERP.

## 3. Atender um cliente

### 💬 Chat (tela de conversa)
Menu **Chat** → abre um ambiente de conversa no estilo WhatsApp Web: lista de conversas à
esquerda (com busca por nome ou telefone) e a conversa aberta à direita.

- **Bolhas**: cliente à esquerda, você à direita, separadas por dia.
- **Ticks de entrega**: ✓ enviada · ✓✓ entregue · ✓✓ **azul** = lida · **!** = falhou.
- **Enviar**: digite e tecle **Enter** (Shift+Enter quebra linha). Dentro da janela de 24 h
  a mensagem sai na hora; fora dela aparece um aviso — reengaje por **template pelo board**.
- A lista e a conversa atualizam em tempo real, igual ao board.
- Vendedor vê as conversas da própria carteira; admin/home veem todas (com a pill da carteira).

### Responder pelo board (texto livre)
Disponível **só na Negociação** e em **Pedido emitido dentro de 24 h** da última interação.
Digite no campo do card e tecle Enter. Sua mensagem aparece na hora (otimista) e é confirmada
quando o envio registra.

### Enviar um template
Nos cards fora da janela de 24 h (prospecção, ociosos, tentativa) o caminho é o **template**.
Clique no botão **TEMPLATE** do card. Para escolher qual template é o padrão, use o menu
**Automáticos ▾** na barra de filtros (o admin pode cadastrar novos).

### Ver a conversa inteira (lupa 🔍)
Clique no ícone de **lupa** do card para abrir a **janela ampliada**: histórico rolável das
últimas mensagens, campo de resposta/template e um botão **↻** que **busca as mensagens que
faltam** naquela conversa. A janela pode ser arrastada.

### Botão **C**
Abre o cadastro do cliente no app **Consulta Clientes** (deep-link por `codcli`).

## 4. Visões da carteira

Menu **Visões** → um hub com 5 leituras prontas da carteira. Cada uma abre um board filtrado
(vendedor vê a própria carteira; admin/home veem tudo):

1. **🏆 30 Melhores** — os 30 maiores clientes por **frequência + valor comprado** (12 meses),
   separados em **Ativos** (compraram nos últimos 120 dias) e **Inativos** (mais de 120 dias).
2. **📅 Frequência** — quem compra **todo mês**: 3+ meses seguidos de compra = **frequente**;
   quem perdeu a sequência aparece como **não frequente** (é quem precisa de atenção).
3. **🌱 Fidelização** — clientes **novos** no caminho dos 3 meses de compra (colunas 1/3 e
   2/3). Ao fechar o 3º mês, o cliente "se forma" e passa a aparecer na Frequência.
4. **🛒 Compras do mês** — quem já comprou no mês atual, do maior para o menor valor.
5. **🚫 Desativados** — clientes removidos do board. Cada um tem **motivo** (dropdown:
   cliente final, não trabalha mais, fechou o salão…) e **observação** livre — preencha para
   o histórico ficar claro. O botão **↩ Restaurar** devolve o cliente ao board.

Nos cards, o **💬** abre o WhatsApp do cliente.

## 5. Encontrar clientes

- **Busca**: digite **nome** ou **telefone** (funciona com os últimos dígitos). O sistema
  detecta sozinho se você digitou um número.
- **Período ▾**: filtra por hoje/ontem/semana/quinzena/mês.
- **Filtro por produto ▾**: mostra só quem comprou determinado(s) produto(s) no período.
- **Filtro por cidade ▾**: mostra só clientes das cidades escolhidas.
- **Ciclo compra ▾**: filtra por oportunidade de recompra (inclui "URGENTE").
- **Tempo parado ▾**: filtra por faixas de dias sem comprar.
- **Sem cadastro**: mostra só contatos ainda não casados com o ERP.

## 6. Orçamento

Menu **Orçamento** → abre uma **janela flutuante** (arrastável) sobre o board:
1. Busque o produto por nome/código.
2. Veja **preço de tabela**, **estoque** e as **campanhas de desconto** ativas (dá para
   escolher o preço de campanha por linha).
3. Ajuste a **quantidade** → o total é calculado.
4. Clique em **copiar** para levar o texto pronto para o WhatsApp.

> Os preços/estoque vêm de um espelho atualizado automaticamente (estoque a cada 30 min).

## 7. Relatórios

- **⬇ .xls** na barra de filtros baixa uma planilha Excel dos clientes.
  - **Sem filtro**, vêm 5 colunas: cliente, telefone, dias sem comprar, ciclo médio, ticket médio.
  - **Com filtro por produto**, colunas do produto são adicionadas.
  - Admin/home recebem abas por vendedor; vendedor recebe só a própria carteira.
- Menu **Relatórios**: relatórios prontos (vendas por período, clientes sem comprar,
  regiões específicas etc.).

## 8. Lixeira (desativar cliente)

Alguns contatos são "cliente final" (a empresa só atende profissionais). **Arraste o card**
até o ícone de lixeira (canto inferior direito) para removê-lo do board. Para ver e gerenciar
quem foi desativado — inclusive registrar o **motivo** e uma **observação** — use
**Visões → Desativados** (seção 4.5), que também tem o botão **Restaurar**.

## 9. Aparência (🎨 Tema)

O botão **🎨** no topo (ou no menu ☰ do celular) alterna entre o **tema padrão** e o
**Tema 1** (identidade visual Murano — tons de vinho). A escolha fica salva no seu navegador
e vale também para as telas de Visões.

## 10. Recursos de administrador

Visíveis **só para o admin**:

- **Sinc | Pause** (topo): liga/pausa a sincronização de fundo. Pausar libera 100% da cota do
  RD (útil durante um disparo em massa). **Lembre de retomar.**
- **📣 Disparo massa**: seleciona os melhores N clientes elegíveis (pelos filtros atuais) e
  envia um template para todos, com barra de progresso. Mostra o **custo** (R$ 0,43 por
  template) e **pede confirmação** — é irreversível. O sistema pausa a sincronização durante
  o envio e retoma no final.
- **Ranking ▾**:
  - **📊 Ranking (ao vivo)**: abre o painel público de ranking (todos os papéis).
  - **🎯 Meta do dia**: define a meta que aparece no painel (0 = esconde a meta).
  - **🏅 Metas individuais**: meta do dia por vendedor — ao bater, aparece "BATEU A META" nas TVs.
  - **📅 Ver anteriores**: escolhe uma data passada e abre o ranking daquele dia.
  - **🎉 Rodar desfile / 🎊 Parabéns por cliente**: telas de comemoração nas TVs.
  - **📸 Subir foto no ranking**: qualquer papel pode enviar a própria foto.
- **Análises**: hub de análises e B.I. (inside sales, indicadores de conversas).

## 11. No celular

O board é responsivo: cada coluna vira uma **faixa horizontal** (os cards rolam para o lado)
e as faixas ficam empilhadas. O menu vira um **☰** (hambúrguer) — Chat, Visões, Relatórios e
os demais itens ficam lá. No Chat, a lista e a conversa alternam com o botão **←**.

## 12. Dúvidas frequentes

- **"Não consigo digitar num card."** Só Negociação (e Pedido emitido dentro de 24 h) tem
  campo de texto. Fora disso, use **TEMPLATE** — ou abra o **Chat** para conversar com quem
  está dentro da janela.
- **"A conversa não atualizou."** O board e o Chat atualizam sozinhos (tempo real, com uma
  rede de proteção de 60 s). Se algo parecer congelado, recarregue a página; persistindo,
  fale com o admin (a sincronização pode estar pausada).
- **"Não vejo os botões de admin."** Eles são exclusivos do papel admin. Troque de papel na
  pílula de identidade se você tiver acesso.
- **"O cliente sumiu do board."** Veja **Visões → Desativados** — ele pode ter sido
  desativado. Se foi engano, use **Restaurar**.
