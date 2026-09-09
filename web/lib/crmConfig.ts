// Interruptores globais do CRM (`crm_config`, linha única id=1, migrations 0097/0099).
//
// ⚠️ O RD CONVERSAS NÃO EXISTE MAIS (0131). A conta na Tallos foi desativada — a
// API responde `API Rest resources not available for disabled company.` — e o
// ETL que a lia foi removido junto com os dois workflows. Por isso saíram daqui
// as chaves que só existiam para conviver com ele: `historico_rd`,
// `carteira_rd_ativa`, `numero_envio` e o modo migração, que era a leitura das
// três em conjunto. O que elas simulavam passou a ser o comportamento único:
// não há canal para escolher, não há carteira de lá para preferir, e não há
// histórico em outro número para oferecer.
//
// As MENSAGENS do RD continuam no banco (159.944 delas) — é o histórico do que
// foi combinado com cada cliente, e medimos que não custa desempenho: contar as
// 170 mil leva 201 ms. O que saiu foram os mecanismos, não o dado.
//
// UMA implementação, lida por board, chat, disparo em massa e relatório. Se cada
// rota resolvesse o estado por conta própria, uma delas divergiria no primeiro
// ajuste — e o sintoma seria o pior possível: o selo de ciclo sumindo do card
// mas continuando a ranquear a campanha, sem ninguém entender por quê. Mesmo
// motivo de `layoutEfetivo()` em lib/chatLayout.ts (§29.3).

export type Linha = {
  phone_number_id: string;
  rotulo: string;
  numero: string | null;
  ativo: boolean;
};

export type CrmConfig = {
  ciclo_ativo: boolean;
  /** NULO = todas as linhas ativas. Ver `linhasVisiveis()`. */
  linhas_visiveis: string[] | null;
  /** Cadastro de `chat_linha` (só as ativas), para a tela montar o seletor. */
  linhas: Linha[];
  /**
   * QUAL linha Cloud é a padrão de saída, quando a conversa ainda não tem uma
   * própria (0123). NULO = a env WHATSAPP_PHONE_NUMBER_ID (estado de fábrica).
   * Só vale para MENSAGEM — ligação continua presa à env (ver `linhaDeEnvio`
   * em lib/whatsapp.ts, e o comentário da migration 0123 sobre o porquê).
   *
   * Ler resolvido (contra linha inativa/desconhecida) por `linhaPadraoCloud()`
   * logo abaixo — nunca o campo cru.
   */
  linha_padrao_cloud: string | null;
  /**
   * QUAL linha origina/recebe CHAMADA de voz (0124). Independente da de cima —
   * calling tem pré-requisito próprio por número (pagamento, campo `calls`
   * assinado, interruptor ligado em /admin → Linhas) que não deve seguir uma
   * troca pensada só para mensagem. NULO = a env WHATSAPP_PHONE_NUMBER_ID.
   *
   * Ler resolvido por `linhaPadraoCalling()` logo abaixo — nunca o campo cru.
   */
  linha_padrao_calling: string | null;
  /** Aviso enviado ao cliente pelo botão de pausa do chat (0106). */
  texto_pausa: string;
  /**
   * Minutos de espera que acendem o alerta de SLA no chat (0114). **0 =
   * desligado**, e é o estado de origem: escolher o limite é decisão de quem
   * opera, e um número chutado no deploy viraria alarme que todo mundo aprende
   * a ignorar — que é pior que não ter alarme, porque dá a sensação de que
   * alguém está vigiando.
   */
  sla_minutos: number;
  atualizado_por: string | null;
  atualizado_em: string | null;
};

/** O estado que vale quando a tabela ainda não existe ou a leitura falha. */
export const CRM_CONFIG_PADRAO: CrmConfig = {
  ciclo_ativo: true,
  linhas_visiveis: null,
  linhas: [],
  linha_padrao_cloud: null,
  linha_padrao_calling: null,
  texto_pausa: "",
  sla_minutos: 0,
  atualizado_por: null,
  atualizado_em: null,
};

/**
 * A view que a TELA lê. Sempre a filtrada: ela se resolve sozinha pela config,
 * e com tudo marcado devolve as mesmas linhas da `vw_funil` (menos o card
 * sintético `venda:<codcli>`, que o board já descartava). Um caminho só — sem
 * "às vezes uma view, às vezes outra", que é onde nasce a divergência entre
 * board e chat.
 *
 * ⚠️ NÃO usar isto no ETL nem no disparo em massa:
 *  - o ETL lê `vw_funil` para saber o que sincronizar (src/etl/run.ts). Com a
 *    view filtrada ele concluiria que nada está ativo e pararia de puxar o RD,
 *    em silêncio — o oposto do que o seletor quer (o ETL segue alimentando o
 *    banco mesmo sem nada aparecer na tela);
 *  - o disparo em massa decide QUEM ABORDAR. Cegá-lo faria o CRM re-abordar
 *    quem está em conversa aberta no RD agora. Esconder não pode virar agir
 *    sem saber.
 */
export const VIEW_FUNIL_TELA = "vw_funil_visivel" as const;

/**
 * A lista de conversas do CHAT (`/api/chat`) — migration 0126.
 *
 * NÃO é a mesma coisa que `VIEW_FUNIL_TELA`, e a diferença é o ponto:
 *
 *     board -> "todo cliente da carteira, tenha conversa ou não"
 *     chat  -> "quem tem conversa"
 *
 * A `vw_funil_visivel` responde a primeira pergunta, com três ramos (conversas,
 * ociosos sem cadastro e prospecção do ERP) e as colunas que só o card usa
 * (as 3 últimas mensagens em jsonb, o valor faturado, `sem_cadastro`). O chat
 * jogava 95% disso fora a cada chamada — e é a rota mais chamada do sistema
 * (a cada 60 s por aba, mais uma recarga por mensagem recebida).
 *
 * Medido em produção, mesmas 309 linhas de resultado:
 *     vw_funil_visivel   647 ms   206.498 buffers
 *     vw_chat_conversa   234 ms     7.214 buffers
 *
 * ⚠️ As duas repetem a régua de etapa. Se ela mudar numa, muda na outra —
 * duplicação consciente, mesma da 0098.
 */
export const VIEW_CHAT_LISTA = "vw_chat_conversa" as const;

/** A seleção efetiva: NULO na config significa "todas as linhas ativas". */
export const linhasVisiveis = (cfg: CrmConfig): string[] =>
  cfg.linhas_visiveis ?? cfg.linhas.filter((l) => l.ativo).map((l) => l.phone_number_id);

/**
 * Está tudo marcado? A tela usa para não anunciar filtro onde não há.
 *
 * ⚠️ "Tudo marcado" é sobre o SELETOR, não sobre a tabela `mensagens`. Ele
 * pergunta se toda linha ATIVA está escolhida — e linha desativada continua
 * tendo mensagem no banco. Não usar isto para concluir "não há nada a
 * excluir": foi exatamente esse atalho que deixou o RD Conversas vazar
 * (ver `filtroLinhas`).
 */
export const tudoVisivel = (cfg: CrmConfig): boolean => {
  const sel = new Set(linhasVisiveis(cfg));
  return cfg.linhas.filter((l) => l.ativo).every((l) => sel.has(l.phone_number_id));
};

/**
 * Aplica o recorte de linhas a uma consulta em `mensagens`.
 *
 * Existe porque a lupa do card, a thread e a busca varrem `mensagens` direto,
 * sem passar pela view — e sem este filtro devolveriam o conteúdo de uma
 * conversa que a tela ao lado está escondendo.
 *
 * ⚠️ `linha_id IS NULL` é a MENSAGEM DO RD CONVERSAS — o conceito de linha
 * nasceu no webhook da Meta, então o que veio do ETL não tem nenhuma. Com o RD
 * encerrado (0131) essas 159.944 linhas continuam no banco como histórico e
 * **nunca** entram numa consulta de tela: por isso o filtro agora é sempre um
 * `.in(...)` sobre as linhas escolhidas, e não há mais ramo que as inclua.
 *
 * ⚠️ NÃO TEM ATALHO, e o atalho que existia era o bug. O código antigo abria
 * com `if (tudoVisivel(cfg)) return q;` — "está tudo marcado, não há nada a
 * excluir". As duas metades da frase não são a mesma coisa: `tudoVisivel` olha
 * as linhas ATIVAS do catálogo, e `mensagens` guarda linha desativada também.
 * No dia em que a linha 'rd' foi marcada `ativo=false` no `chat_linha`, ela
 * saiu do catálogo, `tudoVisivel` virou `true` — e este filtro parou de
 * filtrar. Resultado medido em 09/09/2026: com o seletor dizendo "só Murano
 * Professional", a thread, a lupa do card e a busca no conteúdo voltaram a
 * mostrar conversa do RD, etiquetada "MURANO PRO (RD CONVERSAS)". Sem o ramo
 * do RD esse retorno deixa de ser possível, mas a lição fica: filtro de tela
 * não se decide pelo catálogo de linhas, e sim pela coluna da mensagem.
 */
export function filtroLinhas<T>(q: T, cfg: CrmConfig): T {
  const sel = linhasVisiveis(cfg).filter((l) => l !== "rd");
  const anyQ = q as any;
  // Seleção vazia = não sabemos nada (leitura da config falhou e caiu no
  // padrão, ou o catálogo veio vazio). A rede de proteção é mostrar as linhas
  // que TÊM id — nunca o histórico do RD, que é o que este filtro existe para
  // manter fora. Antes daqui a rede era "não filtrar", e com o RD vivo isso
  // significava devolver tudo; hoje devolveria justamente o que foi encerrado.
  if (!sel.length) return anyQ.not("linha_id", "is", null) as T;
  return anyQ.in("linha_id", sel) as T;
}

type Sb = { from: (t: string) => any };

/**
 * Lê os interruptores. FALHA PARA O LADO DO QUE JÁ FUNCIONAVA: erro de leitura,
 * tabela ausente (migration não aplicada) ou linha sumida devolvem o padrão —
 * que é o comportamento de hoje. O contrário seria um deploy adiantado ou uma
 * instabilidade do banco desligando um mecanismo na cara da equipe.
 */
export async function lerCrmConfig(sb: Sb): Promise<CrmConfig> {
  try {
    const [cfgR, linhasR] = await Promise.all([
      // ⚠️ `select("*")`, e não a lista de colunas, DE PROPÓSITO.
      //
      // Pedir uma coluna que ainda não existe faz o PostgREST recusar a
      // consulta INTEIRA — e o `catch` abaixo devolveria `CRM_CONFIG_PADRAO`,
      // que tem `linhas_visiveis: null` (= todas) e `carteira_rd_ativa: true`.
      // Ou seja: uma coluna nova no código, antes da migration, traria o RD
      // Conversas de volta em todas as telas, sem erro nenhum aparecer.
      //
      // Com `*`, coluna que falta simplesmente não vem, e cada campo cai no seu
      // próprio padrão. O deploy pode chegar antes da migration sem estrago.
      sb.from("crm_config").select("*")
        .eq("id", 1).maybeSingle(),
      sb.from("chat_linha").select("phone_number_id,rotulo,numero,ativo").eq("ativo", true).order("rotulo"),
    ]);
    const data = cfgR?.data;
    if (cfgR?.error || !data) return CRM_CONFIG_PADRAO;
    return {
      ciclo_ativo: data.ciclo_ativo !== false,
      linhas_visiveis: Array.isArray(data.linhas_visiveis) ? data.linhas_visiveis : null,
      linha_padrao_cloud: typeof data.linha_padrao_cloud === "string" ? data.linha_padrao_cloud : null,
      linha_padrao_calling: typeof data.linha_padrao_calling === "string" ? data.linha_padrao_calling : null,
      texto_pausa: String(data.texto_pausa ?? ""),
      sla_minutos: Math.max(0, Number(data.sla_minutos ?? 0) || 0),
      linhas: (linhasR?.data ?? []) as Linha[],
      atualizado_por: data.atualizado_por ?? null,
      atualizado_em: data.atualizado_em ?? null,
    };
  } catch {
    return CRM_CONFIG_PADRAO;
  }
}



/**
 * A linha Cloud escolhida em /admin como padrão de saída (0123), já validada
 * contra o cadastro: aponta para linha desconhecida ou desativada? Trata como
 * se não houvesse escolha — `null` aqui significa "cai na env
 * WHATSAPP_PHONE_NUMBER_ID", que é quem resolve de fato (`linhaDeEnvio()` em
 * lib/whatsapp.ts). Sem esta validação, desativar a linha que estava marcada
 * como padrão deixaria a escolha "fantasma": salva no banco, silenciosamente
 * sem efeito, e ninguém entenderia por que o envio voltou pra env sozinho.
 */
export const linhaPadraoCloud = (cfg: CrmConfig): string | null => {
  const v = cfg.linha_padrao_cloud;
  if (!v || v === "rd") return null;
  return cfg.linhas.some((l) => l.phone_number_id === v && l.ativo) ? v : null;
};

/**
 * A linha escolhida em /admin para ORIGINAR/RECEBER chamada (0124), já validada
 * contra o cadastro — mesma regra da de cima, mesmo motivo: linha desativada ou
 * desconhecida não pode ficar "escolhida" só no papel.
 */
export const linhaPadraoCalling = (cfg: CrmConfig): string | null => {
  const v = cfg.linha_padrao_calling;
  if (!v || v === "rd") return null;
  return cfg.linhas.some((l) => l.phone_number_id === v && l.ativo) ? v : null;
};

/** Atalho para quem só precisa do ciclo (a maioria dos consumidores). */
export async function cicloAtivo(sb: Sb): Promise<boolean> {
  return (await lerCrmConfig(sb)).ciclo_ativo;
}
