# 02 — Manual de Uso

Como usar o CRM de Conversas no dia a dia. Escrito para **vendedores**, **gestão (home)** e
**admin**. Não é preciso saber programar para ler este documento.

> Acesso: https://funil-murano.vercel.app

---

## 1. Entrar no sistema

Você entra de duas formas:
- **Login com Google** (recomendado): use a conta autorizada da Murano.
- **Usuário e senha** (admin).

Se você tem **mais de um papel** (ex.: admin e vendedor), aparece uma **pílula de identidade**
no canto superior direito com uma setinha — clique para **trocar de papel** sem sair.

### O que cada papel vê

| Recurso | Vendedor | Home (gestão) | Admin |
|---|---|---|---|
| Ver o funil da própria carteira | ✅ | ✅ (todas) | ✅ (todas) |
| Atender (template / mensagem) | ✅ | ✅ | ✅ |
| Orçamento, Relatório .xls | ✅ | ✅ | ✅ |
| Atualização em tempo real da Negociação | ✅ | ✅ | usa o ↻ do card |
| B.I., Ranking (config), Sincronizar, Disparo em massa | — | — | ✅ |

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

### Sinais visuais úteis
- **AGUARDA RESPOSTA** (pulsando): você mandou algo e o cliente ainda não respondeu.
- **TEMPLATE**: o card está fora da janela de 24 h — só dá para reengajar por template.
- **Sem cadastro**: o contato existe no RD mas ainda não está casado com um cliente do ERP.

## 3. Atender um cliente

### Responder (texto livre)
Disponível **só na Negociação** e em **Pedido emitido dentro de 24 h** da última interação.
Digite no campo do card e tecle Enter. Sua mensagem aparece na hora (otimista) e é confirmada
quando o RD registra.

### Enviar um template
Nos cards fora da janela de 24 h (prospecção, ociosos, tentativa) o caminho é o **template**.
Clique no botão **TEMPLATE** do card. Para escolher qual template é o padrão, use o menu
**Automáticos ▾** na barra de filtros (o admin pode cadastrar novos).

### Ver a conversa inteira (lupa 🔍)
Clique no ícone de **lupa** do card para abrir a **janela ampliada**: histórico rolável das
últimas mensagens, campo de resposta/template e um botão **↻** que **busca no RD as mensagens
que faltam** naquela conversa. A janela pode ser arrastada.

### Botão **C**
Abre o cadastro do cliente no app **Consulta Clientes** (deep-link por `codcli`).

## 4. Encontrar clientes

- **Busca**: digite **nome** ou **telefone** (funciona com os últimos dígitos). O sistema
  detecta sozinho se você digitou um número.
- **Período ▾**: filtra por hoje/ontem/semana/quinzena/mês.
- **Filtro por produto ▾**: mostra só quem comprou determinado(s) produto(s) no período.
- **Ciclo compra ▾**: filtra por oportunidade de recompra (inclui "URGENTE").
- **Tempo parado ▾**: filtra por faixas de dias sem comprar.
- **Sem cadastro**: mostra só contatos ainda não casados com o ERP.

## 5. Orçamento

Menu **Orçamento** → abre uma **janela flutuante** (arrastável) sobre o board:
1. Busque o produto por nome/código.
2. Veja **preço de tabela**, **estoque** e as **campanhas de desconto** ativas (dá para
   escolher o preço de campanha por linha).
3. Ajuste a **quantidade** → o total é calculado.
4. Clique em **copiar** para levar o texto pronto para o WhatsApp.

> Os preços/estoque vêm de um espelho atualizado automaticamente (estoque a cada 30 min).

## 6. Relatório (.xls)

Botão **⬇ .xls** na barra de filtros baixa uma planilha Excel dos clientes.
- **Sem filtro**, vêm 5 colunas: cliente, telefone, dias sem comprar, ciclo médio, ticket médio.
- **Com filtro por produto**, colunas do produto são adicionadas.
- Admin/home recebem abas por vendedor; vendedor recebe só a própria carteira.

## 7. Lixeira (descartar cliente final)

Alguns contatos são "cliente final" (a empresa só atende profissionais). **Arraste o card**
até o ícone de lixeira (canto inferior direito) para removê-lo do board. Clique no ícone para
abrir a lista e **Restaurar** se precisar.

## 8. Recursos de administrador

Visíveis **só para o admin**:

- **Sinc | Pause** (topo): liga/pausa a sincronização de fundo. Pausar libera 100% da cota do
  RD (útil durante um disparo em massa). **Lembre de retomar.**
- **📣 Disparo massa**: seleciona os melhores N clientes elegíveis (pelos filtros atuais) e
  envia um template para todos, com barra de progresso. Mostra o **custo** (R$ 0,43 por
  template) e **pede confirmação** — é irreversível. O sistema pausa a sincronização durante
  o envio e retoma no final.
- **Ranking ▾**:
  - **📊 Ranking (ao vivo)**: abre o painel público de ranking.
  - **🎯 Meta do dia**: define a meta que aparece no painel (0 = esconde a meta).
  - **📅 Ver anteriores**: escolhe uma data passada e abre o ranking daquele dia.
- **B.I. Conversas**: abre o painel de indicadores de conversas.

## 9. No celular

O board é responsivo: cada coluna vira uma **faixa horizontal** (os cards rolam para o lado)
e as faixas ficam empilhadas. O menu vira um **☰** (hambúrguer). A atualização em tempo real
da Negociação continua funcionando.

## 10. Dúvidas frequentes

- **"Não consigo digitar num card."** Só Negociação (e Pedido emitido dentro de 24 h) tem
  campo de texto. Fora disso, use **TEMPLATE**.
- **"A conversa não atualizou."** Na Negociação atualiza sozinho a cada ~10 s; nas outras,
  abra a lupa 🔍 e use o **↻**. Admin sempre usa o ↻.
- **"Não vejo os botões de admin."** Eles são exclusivos do papel admin. Troque de papel na
  pílula de identidade se você tiver acesso.
