// Interruptores globais do CRM (`crm_config`, linha única id=1, migrations 0097/0099).
//
// UMA implementação, lida por board, chat, disparo em massa e relatório. Se cada
// rota resolvesse o estado por conta própria, uma delas divergiria no primeiro
// ajuste — e o sintoma seria o pior possível: o selo de ciclo sumindo do card
// mas continuando a ranquear a campanha, sem ninguém entender por quê. Mesmo
// motivo de `layoutEfetivo()` em lib/chatLayout.ts (§29.3).

export type Linha = {
  phone_number_id: string;   // 'rd' é o id sintético da linha do RD Conversas
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
   * Número pelo qual o CRM ENVIA (0102). Decisão do admin, valendo para
   * mensagem, template e ligação em qualquer contato.
   *   'rd'    -> Murano Pro (RD Conversas)
   *   'cloud' -> Murano Professional (a linha da env WHATSAPP_PHONE_NUMBER_ID)
   *   null    -> automático: responde pelo canal em que o cliente falou por último
   *
   * NÃO confundir com `linhas_visiveis`, que é o que a TELA mostra. Ver e falar
   * são decisões diferentes: dá para acompanhar as conversas do RD e mesmo
   * assim já estar respondendo pelo número novo.
   */
  numero_envio: "rd" | "cloud" | null;
  atualizado_por: string | null;
  atualizado_em: string | null;
};

/** O estado que vale quando a tabela ainda não existe ou a leitura falha. */
export const CRM_CONFIG_PADRAO: CrmConfig = {
  ciclo_ativo: true,
  linhas_visiveis: null,
  linhas: [],
  numero_envio: null,
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

/** A seleção efetiva: NULO na config significa "todas as linhas ativas". */
export const linhasVisiveis = (cfg: CrmConfig): string[] =>
  cfg.linhas_visiveis ?? cfg.linhas.filter((l) => l.ativo).map((l) => l.phone_number_id);

/** Está tudo marcado? A tela usa para não anunciar filtro onde não há. */
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
 * A linha do RD é `linha_id IS NULL` (o conceito nasceu no webhook da Meta,
 * §23.4), então ela não cabe num `.in(...)` e precisa do `.or(...)`.
 */
export function filtroLinhas<T>(q: T, cfg: CrmConfig): T {
  if (tudoVisivel(cfg)) return q;
  const sel = linhasVisiveis(cfg);
  const cloud = sel.filter((l) => l !== "rd");
  const comRd = sel.includes("rd");
  const anyQ = q as any;

  if (!comRd) {
    // sem o RD: só as linhas da Cloud escolhidas
    return (cloud.length ? anyQ.in("linha_id", cloud) : anyQ.eq("linha_id", "__nenhuma__")) as T;
  }
  if (!cloud.length) return anyQ.is("linha_id", null) as T;   // só o RD
  return anyQ.or(`linha_id.is.null,linha_id.in.(${cloud.join(",")})`) as T;
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
      sb.from("crm_config").select("ciclo_ativo,linhas_visiveis,numero_envio,atualizado_por,atualizado_em")
        .eq("id", 1).maybeSingle(),
      sb.from("chat_linha").select("phone_number_id,rotulo,numero,ativo").eq("ativo", true).order("rotulo"),
    ]);
    const data = cfgR?.data;
    if (cfgR?.error || !data) return CRM_CONFIG_PADRAO;
    return {
      ciclo_ativo: data.ciclo_ativo !== false,
      linhas_visiveis: Array.isArray(data.linhas_visiveis) ? data.linhas_visiveis : null,
      numero_envio: data.numero_envio === "rd" || data.numero_envio === "cloud" ? data.numero_envio : null,
      linhas: (linhasR?.data ?? []) as Linha[],
      atualizado_por: data.atualizado_por ?? null,
      atualizado_em: data.atualizado_em ?? null,
    };
  } catch {
    return CRM_CONFIG_PADRAO;
  }
}

/**
 * O canal que o admin escolheu, já traduzido para o vocabulário do envio.
 * `null` = nenhuma escolha feita, então quem decide segue sendo a conversa.
 */
export const canalEscolhido = (cfg: CrmConfig): "rd" | "whatsapp" | null =>
  cfg.numero_envio === "rd" ? "rd" : cfg.numero_envio === "cloud" ? "whatsapp" : null;

/** Atalho para quem só precisa do ciclo (a maioria dos consumidores). */
export async function cicloAtivo(sb: Sb): Promise<boolean> {
  return (await lerCrmConfig(sb)).ciclo_ativo;
}
