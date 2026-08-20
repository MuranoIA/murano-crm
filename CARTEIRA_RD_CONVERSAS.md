# Funcionalidade: Gestão de Carteira — RD Conversas

> Prompt para Claude Code · Murano Professional · Sistema CRM

---

## Contexto geral

A Murano Professional usa o **RD Station Conversas** como plataforma de atendimento WhatsApp.
Cada cliente é atribuído a um atendente — isso é chamado de **carteira**.

Hoje essa atribuição só pode ser feita manualmente dentro do RD Conversas, cliente por cliente.
A necessidade é ter **dentro do CRM já existente** uma tela para redistribuir carteiras em massa
ou individualmente, sem precisar acessar o RD.

O CRM já possui integração ativa com a API do RD Conversas (token configurado, cliente HTTP
disponível). Esta tarefa é adicionar **um novo módulo** a esse sistema.

---

## Antes de escrever qualquer código

1. Leia **todos os arquivos do projeto** e mapeie:
   - Onde está o cliente HTTP que chama a API do RD Conversas
   - Como o token de autenticação é armazenado/injetado
   - Se já existe alguma referência a `carteira`, `wallet` ou `employee` no código
   - Qual o padrão de rotas/páginas do CRM (React Router, Next.js, etc.)
   - Quais componentes de tabela/lista já existem e podem ser reutilizados
   - Qual o padrão de estado global (Context, Zustand, Redux, etc.)

2. Informe o mapeamento antes de implementar — aguarde confirmação se encontrar
   ambiguidade na arquitetura.

---

## Banco de dados (Supabase — projeto `wtunzezigncwjpcqsfzk`)

### Tabela `clientes` (leitura)
Espelho do RD Conversas. Campos relevantes:

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | text | ID do contato no RD Conversas |
| `nome_completo` | text | Nome do cliente |
| `telefone` | text | Telefone (ex: `559181959789`) |
| `carteira` | text | Slug do atendente atual (ex: `luana`) |
| `employee_id` | text | ID do atendente no RD Conversas |
| `canal` | text | Canal de origem (ex: `whatsapp`) |
| `sincronizado_em` | timestamptz | Última sincronização com RD |

### Tabela `vendedores` (leitura)
Lista de atendentes disponíveis:

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | text | ID do atendente no RD Conversas |
| `nome` | text | Nome de exibição |
| `email` | text | Email |
| `role` | text | `operator`, `admin`, `manager` |
| `departamento` | text | Departamento configurado no RD |

### Tabela `chat_transferencia` (escrita)
Registra histórico de transferências realizadas pelo sistema:

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | bigint | PK auto |
| `cliente_id` | text | ID do cliente transferido |
| `de_carteira` | text | Slug de origem |
| `para_carteira` | text | Slug de destino |
| `por` | text | Quem executou (ex: email do usuário logado) |
| `observacao` | text | Observação opcional |
| `criada_em` | timestamptz | Timestamp automático |

### Atendentes ativos (referência)
Estes são os atendentes com carteiras ativas:

| Nome | Slug (`carteira`) | `employee_id` | Total de clientes |
|---|---|---|---|
| Luana | `luana` | `6a3a99836da6dc52edf34c5a` | ~878 |
| Kamilly | `kamilly` | `6a3a9851e785f9118ec9141d` | ~868 |
| Romulo | `romulo` | `6a3a97bbb94e6ad472ee9d02` | ~829 |
| Thiago | `thiago` | `69e2d5da7a1da8f60a3d18f5` | ~605 |
| Milene | `milene` | `69e2d5bc7a1da8f60a3d1883` | ~571 |
| Anne | `anne` | `69be094449a354e83156d1eb` | ~553 |
| Thamires | `thamires` | `69d6b06613af1985c95efa62` | ~537 |

---

## API do RD Conversas — Endpoints necessários

A API base já está configurada no projeto. Use o cliente HTTP existente.

### Listar contatos de uma carteira
```
GET /v2/customers?employee_id={employee_id}&limit=100&page={n}
```
Resposta: `{ data: [...], total: N, page: N }`

### Atualizar carteira de um contato
```
PATCH /v2/customers/{customer_id}
Content-Type: application/json

{
  "employee_id": "{novo_employee_id}"
}
```
Resposta: `200 OK` em caso de sucesso.

> **Rate limit:** máximo 120 req/min. Implemente delay de 600ms entre chamadas
> em lote para não estourar o limite.

---

## Funcionalidades a implementar

### Tela: Gestão de Carteira (`/carteira` ou rota equivalente no padrão do projeto)

#### Bloco 1 — Seletor de atendente (sidebar ou dropdown)
- Lista todos os atendentes da tabela `vendedores` onde `role IN ('operator', 'admin')`
  e `departamento IS NOT NULL`
- Exibe nome + contagem de clientes na carteira
- Ao selecionar um atendente, carrega a lista de clientes

#### Bloco 2 — Lista de clientes da carteira selecionada
- Fonte: tabela `clientes` filtrada por `carteira = {slug}`
- Colunas: checkbox de seleção | Nome | Telefone | Canal | Carteira atual
- Suporte a busca por nome ou telefone (filtro local, sem nova query)
- Checkbox no header para selecionar/deselecionar todos os visíveis
- Paginação ou scroll infinito (definir conforme padrão do CRM)

#### Bloco 3 — Barra de ações
- Select: "Transferir para..." (lista os outros atendentes, excluindo o selecionado)
- Botão: "Transferir X clientes" (ativo somente quando há seleção + destino)
- Contador de selecionados

#### Bloco 4 — Ação de transferência
Ao confirmar:

1. **Validação:** pelo menos 1 cliente selecionado + destino escolhido
2. **Confirmação:** modal com resumo: "Transferir X clientes de [Origem] para [Destino]?"
3. **Execução em lote:**
   - Para cada `cliente_id` selecionado:
     - Chama `PATCH /v2/customers/{id}` com o novo `employee_id`
     - Aguarda 600ms entre cada chamada (rate limit)
   - Progresso visível (ex: "Transferindo 3 de 15...")
4. **Registro:** após cada chamada bem-sucedida, insere na tabela `chat_transferencia`:
   ```json
   {
     "cliente_id": "{id}",
     "de_carteira": "{slug_origem}",
     "para_carteira": "{slug_destino}",
     "por": "{email_usuario_logado}",
     "observacao": "Transferência em lote via CRM"
   }
   ```
5. **Feedback:**
   - Sucesso: toast verde + atualiza lista removendo os clientes transferidos
   - Erro parcial: mostra quais falharam com opção de retentar
   - Erro total: toast vermelho com mensagem da API

#### Bloco 5 — Histórico de transferências (aba ou seção separada)
- Lê da tabela `chat_transferencia` ordenada por `criada_em DESC`
- Colunas: Data/hora | Cliente | De | Para | Executado por
- Filtro por período (últimos 7 / 30 dias)

---

## Comportamento de erro

| Cenário | Comportamento |
|---|---|
| API RD retorna 401 | Toast: "Token da API expirado. Contate o administrador." |
| API RD retorna 429 | Pausa automática de 5s e retenta até 3x |
| API RD retorna 5xx | Marca como falha, continua os próximos, reporta ao final |
| Supabase indisponível | Toast: "Erro ao carregar dados. Tente novamente." |
| Nenhum cliente na carteira | Estado vazio com mensagem "Esta carteira está sem clientes" |

---

## Identidade visual

Siga **exatamente** o padrão visual já estabelecido no CRM.
Não invente novos padrões — reutilize componentes existentes (tabelas, botões, modais, toasts).

Se o projeto usar Tailwind, as cores de referência da Murano são:
- Primária/ação: `#dd4222` (laranja)
- Secundária: `#621244` (vinho)
- Background: `#1c0e1b` (dark) ou `#fbfbfb` (light)
- Fonte: Inter

---

## Restrições e regras

- **NÃO alterar** a tabela `clientes` diretamente — ela é somente leitura (espelho do RD)
- **NÃO alterar** a tabela `vendedores` — também é somente leitura
- **ÚNICA escrita no Supabase:** tabela `chat_transferencia` (registro do histórico)
- **A fonte da verdade** é o RD Conversas — a atualização vai para a API, não para o banco
- A tabela `clientes` no Supabase será atualizada automaticamente pela sincronização existente
- Toda chamada à API do RD Conversas usa o cliente HTTP já configurado no projeto

---

## Entregáveis esperados

Ao concluir, informe:

1. Arquivos criados e arquivos modificados (com justificativa de cada)
2. Se algum componente existente foi reutilizado (qual e onde)
3. Se encontrou alguma inconsistência na arquitetura existente
4. Qualquer decisão de implementação que precisou tomar por conta própria

---

## Resumo da tarefa em uma linha

> Adicionar ao CRM existente um módulo de **Gestão de Carteira** que permite
> selecionar clientes de um atendente, escolher um destino, e transferi-los
> via API do RD Conversas com registro de histórico no Supabase.
