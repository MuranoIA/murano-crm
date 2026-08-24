// Interruptores globais do CRM (`crm_config`, linha única id=1, migration 0097).
//
// UMA implementação, lida por board, chat, disparo em massa e relatório. Se cada
// rota resolvesse o estado por conta própria, uma delas divergiria no primeiro
// ajuste — e o sintoma seria o pior possível: o selo de ciclo sumindo do card
// mas continuando a ranquear a campanha, sem ninguém entender por quê. Mesmo
// motivo de `layoutEfetivo()` em lib/chatLayout.ts (§29.3).

export type CrmConfig = {
  ciclo_ativo: boolean;
  conversas_rd_visiveis: boolean;
  atualizado_por: string | null;
  atualizado_em: string | null;
};

/** O estado que vale quando a tabela ainda não existe ou a leitura falha. */
export const CRM_CONFIG_PADRAO: CrmConfig = {
  ciclo_ativo: true,
  conversas_rd_visiveis: true,
  atualizado_por: null,
  atualizado_em: null,
};

/**
 * Qual view do funil a TELA deve ler. Uma função só, usada pelo board, pelo chat
 * e pelo painel do contato — se cada rota escolhesse, o board mostraria um card
 * em prospecção enquanto o chat ainda listaria a conversa dele.
 *
 * ⚠️ NÃO usar isto no ETL nem no disparo em massa:
 *  - o ETL lê `vw_funil` para saber o que sincronizar (src/etl/run.ts). Com a
 *    view filtrada ele concluiria que nada está ativo e pararia de puxar o RD,
 *    em silêncio — o oposto do que o interruptor quer (o ETL segue alimentando
 *    o banco mesmo sem nada aparecer na tela);
 *  - o disparo em massa decide QUEM ABORDAR. Cegá-lo faria o CRM re-abordar
 *    quem está em conversa aberta no RD agora. Esconder não pode virar agir
 *    sem saber.
 */
export const viewFunil = (cfg: CrmConfig): "vw_funil" | "vw_funil_sem_rd" =>
  cfg.conversas_rd_visiveis ? "vw_funil" : "vw_funil_sem_rd";

type Sb = { from: (t: string) => any };

/**
 * Lê os interruptores. FALHA PARA O LADO DO QUE JÁ FUNCIONAVA: erro de leitura,
 * tabela ausente (migration não aplicada) ou linha sumida devolvem o padrão —
 * que é o comportamento de hoje. O contrário seria um deploy adiantado ou uma
 * instabilidade do banco desligando um mecanismo na cara da equipe.
 */
export async function lerCrmConfig(sb: Sb): Promise<CrmConfig> {
  try {
    const { data, error } = await sb
      .from("crm_config")
      .select("ciclo_ativo,conversas_rd_visiveis,atualizado_por,atualizado_em")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return CRM_CONFIG_PADRAO;
    return {
      ciclo_ativo: data.ciclo_ativo !== false,
      conversas_rd_visiveis: data.conversas_rd_visiveis !== false,
      atualizado_por: data.atualizado_por ?? null,
      atualizado_em: data.atualizado_em ?? null,
    };
  } catch {
    return CRM_CONFIG_PADRAO;
  }
}

/** Atalho para quem só precisa do ciclo (a maioria dos consumidores). */
export async function cicloAtivo(sb: Sb): Promise<boolean> {
  return (await lerCrmConfig(sb)).ciclo_ativo;
}
