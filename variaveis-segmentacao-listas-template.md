# Variáveis de Segmentação — Sistema de Listas para RD Conversas

Guia de referência para o agente construir o motor de filtros do novo sistema.
Base: Supabase `murano-clientes-v2` (jjvbmqycgjgkwidgcmif) — tabelas `faturamento`, `itens`, `clientes` + views `vw_oportunidades_diarias`, `vw_perfil_cliente`.

Cada filtro deve poder ser **combinado com qualquer outro** (AND/OR), já que a maioria dos pedidos reais são cruzamentos: *"vendedora X + cidade Y + não comprou produto Z há N dias"*.

---

## 1. Vendedor / Time

| Filtro | Campo | Exemplo de pedido |
|---|---|---|
| Vendedor específico | `clientes.rca_vendedor` | "clientes da Anne" |
| Time (IS / GC / ISR) | mapear RCA → time | "todos os clientes do time GC" |
| Todos os vendedores (ignorar dono da carteira) | — | "clientes de todos os vendedores que..." |
| Carteira de RCA específico incluindo transitórios | `rca_vendedor` | caso Romulo (RCA45, carteira ainda atribuída) |

---

## 2. Localização

| Filtro | Campo | Exemplo |
|---|---|---|
| Cidade | `clientes.cidade` | "clientes de Belém" |
| Bairro | `clientes.bairro` | "clientes de Mosqueiro" (ilha/distrito, cai em bairro ou cidade dependendo do cadastro — vale checar os dois) |
| Estado | `clientes.estado` | filtro MA vs PA (Filial 1 vs Filial 3) |
| CEP / região de CEP | `clientes.cep` | roteirização de entrega |
| Filial | `codfilial` | Filial 1 (Venus/Belém) vs Filial 3 (MK/Maranhão) |

---

## 3. Recência e ciclo de compra

| Filtro | Campo/lógica | Exemplo |
|---|---|---|
| Dias desde a última compra | `CURRENT_DATE - MAX(data_fat)` | "não compram há 3 meses" |
| Faixa de dias sem comprar | intervalo (30-60, 60-90, 90+) | "inativos entre 60 e 90 dias" |
| % do ciclo individual (`pct_ciclo`) | `vw_oportunidades_diarias` | "no timing ideal de recompra" |
| Ciclo médio de compra (dias) | calculado (LAG entre pedidos) | "cliente que compra a cada 20 dias" |
| Cliente novo (primeira compra) | `MIN(data_fat)` dentro do período | "novos clientes de agosto" |
| Cliente sem compra alguma há X dias = órfão/perdido | recência alta + sem contato | reativação de base |

---

## 4. Produto / Categoria / Marca

| Filtro | Campo | Exemplo |
|---|---|---|
| Comprou produto X (em algum momento) | `itens.produto` / `codprod` | "compraram o produto Y" |
| **Nunca** comprou produto X | NOT IN subquery por `codcli` | "nunca comprou o produto Y" |
| Comprou categoria/seção X | `itens.secao` | "compram selagem" |
| Comprou departamento X | `itens.departamento` | "departamento coloração" |
| Comprou marca X | `itens.marca` | "clientes da marca Z" |
| Não compra categoria X há N dias | `MAX(dt_venda)` por seção | "não compram selagem há 3 meses" |
| Compra categoria X mas nunca comprou Y (cross-sell) | join negativo entre seções | "compram coloração mas nunca selagem" |
| Top categoria/produto do cliente ("geralmente compram X") | `vw_perfil_cliente` (top 5 seções) | "clientes que geralmente compram selagem" |
| Número de categorias diferentes compradas | `COUNT(DISTINCT secao)` | maturidade de mix (curva de cross-sell) |

---

## 5. Valor financeiro

| Filtro | Campo | Exemplo |
|---|---|---|
| Ticket médio mínimo/máximo | `AVG(vlr_atendido)` por pedido | "ticket médio acima de R$500" |
| Receita total no período | `SUM(vlr_atendido)` | "faturaram mais de R$X em 2026" |
| Receita últimos 12 meses | `receita_12m` (view) | usado para priorizar canal (ligar vs WA) |
| Faixa de valor / tier de LTV | segmentação já validada na skill de LTV | "clientes do grupo estabelecido" |
| Valor do último pedido | último `vlr_atendido` | "última compra acima de R$300" |

---

## 6. Frequência

| Filtro | Campo | Exemplo |
|---|---|---|
| Número de pedidos no período | `COUNT(pedido)` | "compraram 3+ vezes este ano" |
| Número de pedidos total (histórico) | `COUNT(pedido)` desde jan/2025 | recorrência histórica |
| Cliente de compra única (1 pedido só) | `COUNT(pedido) = 1` | risco de churn precoce |

---

## 7. Status preditivo (motor de oportunidades já existente)

| Filtro | Campo | Exemplo |
|---|---|---|
| Tipo de oportunidade | `vw_oportunidades_diarias.tipo` (RECOMPRA/EXPANSAO/RECUPERACAO/REATIVACAO/ATRASO) | "clientes em REATIVACAO" |
| Tendência | `tendencia` (CRESCENDO/CAINDO/PAROU) | "carteira caindo" |
| Score de urgência | `score` (0-100) | "score acima de 70" |
| Ação recomendada | `LIGAR HOJE` / `WHATSAPP` | separar lista de ligação vs WA em massa |

---

## 8. Segmentação por atividade (regra oficial 120 dias)

| Filtro | Lógica | Exemplo |
|---|---|---|
| Ativo | gap ≤120 dias desde última compra | base ativa para nutrição |
| Reativação | gap >120 dias | lista de reativação |
| Novo | sem compra anterior no período | boas-vindas / onboarding |

---

## 9. Devoluções

| Filtro | Campo | Exemplo |
|---|---|---|
| Teve devolução recente | `tipo='DEV'` no período | tratar antes de nova oferta |
| Alta taxa de devolução (valor DEV / valor VENDA) | calculado | clientes de risco/insatisfação |

---

## 10. Cadastro / elegibilidade de contato

| Filtro | Campo | Exemplo |
|---|---|---|
| Tem telefone válido (WhatsApp) | `clientes.telefone` não nulo/formato válido | pré-requisito para qualquer envio |
| Tem e-mail | `clientes.email` | campanhas por e-mail |
| Ramo do cliente | `clientes.ramo` | salão, barbearia, clínica, etc. |
| Família/grupo do cliente | `clientes.familia` | segmentação comercial adicional |
| Status ativo no cadastro | `clientes.ativo` | ⚠️ hoje tem bug conhecido na AGC — checar consistência |

---

## 11. Histórico de campanhas / contato (RD Conversas)

| Filtro | Campo (a construir) | Exemplo |
|---|---|---|
| Já recebeu campanha X | log de disparo por `codcli` + `id_campanha` | evitar repetir envio |
| Não recebeu nenhum contato há N dias | última data de disparo | "sem contato há 30 dias" |
| Respondeu campanha anterior (sim/não) | log de resposta RD Conversas | reengajar quem não respondeu |
| Excluir quem já comprou após a campanha | cruzar data do disparo com nova compra | não reenviar oferta já atendida |
| Opt-out / não perturbe | flag de opt-out | respeitar sempre |

---

## 12. Combinações — exemplos reais do seu uso

Estes exemplos mostram como os filtros acima se cruzam na prática (o sistema deve suportar múltiplos filtros simultâneos, não só um por vez):

- Vendedor X **+** nunca comprou produto Y
- Todos os vendedores **+** bairro Mosqueiro **+** categoria selagem (top produto) **+** sem comprar há 90 dias
- Time GC **+** ticket médio acima de R$X **+** status REATIVACAO
- Cidade Y **+** tem telefone válido **+** não recebeu campanha nos últimos 15 dias
- Departamento coloração **+** nunca comprou departamento tratamento (cross-sell)
- Score de urgência > 70 **+** ação recomendada = WHATSAPP (separa da lista de ligação)

---

## Observação para o agente

O output final de qualquer combinação de filtros deve gerar uma lista exportável no **formato padrão de 9 colunas para import no RD Station** já usado hoje (250 contatos/vendedor por cota), preservando telefone em formato válido para WhatsApp Business API.
