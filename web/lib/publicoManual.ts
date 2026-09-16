import { situacaoDoTelefone, acharOuCriarContato } from "./contatoDoErp";

// ---------------------------------------------------------------------------
// Público do disparo em massa DECLARADO por código de cliente — lista digitada
// ou planilha. É o terceiro jeito de montar o público de uma campanha, ao lado
// do automático (`lib/publicoDisparo.ts`, por filtro) e do assistente (mesmo
// arquivo, conversando). Os três terminam no MESMO lugar: `montarPublico`, que
// aplica as proteções de custo (número morto, lixeira, anti-repetição,
// conversa aberta) — só os filtros de SEGMENTAÇÃO (carteira, etapa, "não
// comprou no período") não fazem sentido aqui, porque a lista já é a
// segmentação.
//
// Por dentro, toda entrada vira `codcli` — nunca nome solto. Digitar por nome
// abre busca com sugestões reais do WinThor (`buscarClientesPorNome`); a
// pessoa escolhe o registro antes de a entrada existir na lista, então não há
// como um "Maria Silva" ambíguo entrar sem que alguém tenha escolhido QUAL
// Maria Silva.
// ---------------------------------------------------------------------------

const COLS_ERP = "codcli,cpf,nome,telefone,cidade,estado,rca_num";

export type ItemErp = { codcli: number; nome: string; cidade: string | null; estado: string | null };

/** Autocomplete por nome — nunca texto livre além deste ponto. Até 20 candidatos. */
export async function buscarClientesPorNome(db: any, termo: string): Promise<ItemErp[]> {
  const t = termo.trim();
  if (t.length < 2) return [];
  const { data, error } = await db.from("wth_carteira").select(COLS_ERP)
    .ilike("nome", `%${t}%`).order("nome", { ascending: true }).limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    codcli: Number(r.codcli), nome: String(r.nome ?? ""), cidade: r.cidade ?? null, estado: r.estado ?? null,
  }));
}

/** Um código, conferido na hora — para o "+" da lista digitada por código. */
export async function buscarClientePorCodigo(db: any, codcli: number): Promise<ItemErp | null> {
  const { data, error } = await db.from("wth_carteira").select(COLS_ERP).eq("codcli", codcli).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { codcli: Number(data.codcli), nome: String(data.nome ?? ""), cidade: data.cidade ?? null, estado: data.estado ?? null };
}

/** O formato que `montarPublico` já sabe consumir (o mesmo que a `vw_funil_visivel` devolve). */
export type CardManual = {
  cliente_id: string; cliente: string; vendedor: string | null; etapa: null;
  ultima_atividade: null; telefone: string; venda_valor: null; rd_cliente_id: null; codcli: number;
};

export type ResolucaoLista = {
  cards: CardManual[];
  /** codcli que não deu para alcançar, e por quê — nunca some em silêncio (§36.1). */
  semAlcance: { codcli: number; nome: string | null; motivo: string }[];
};

/**
 * Transforma uma lista de codcli em cards prontos para `montarPublico`.
 *
 * Reusa `acharOuCriarContato` — a MESMA peça do botão "+" do chat e da aba
 * Minha carteira (§35.2/§38): cliente que já conversou reaproveita o contato
 * que já existe; quem nunca falou ganha um agora, do mesmo jeito, sem um
 * segundo caminho de identidade para o mesmo número. Só roda quando o admin
 * pede para "Conferir" — nunca a cada tecla, porque provisiona contato de
 * verdade (escreve em `clientes`).
 */
export async function resolverListaManual(db: any, codclis: number[]): Promise<ResolucaoLista> {
  const unicos = [...new Set(codclis.filter((n) => Number.isFinite(n) && n > 0))];
  if (!unicos.length) return { cards: [], semAlcance: [] };

  const [{ data: erp, error: e1 }, { data: cfgCart, error: e2 }] = await Promise.all([
    db.from("wth_carteira").select(COLS_ERP).in("codcli", unicos),
    db.from("carteira_config").select('rca_num,slug').eq("ativo", true),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);

  const porCod = new Map<number, any>((erp ?? []).map((r: any) => [Number(r.codcli), r]));
  const slugPorRca = new Map<number, string>(
    (cfgCart ?? []).filter((c: any) => c.rca_num != null).map((c: any) => [Number(c.rca_num), c.slug]),
  );

  const cards: CardManual[] = [];
  const semAlcance: ResolucaoLista["semAlcance"] = [];

  for (const cod of unicos) {
    const row = porCod.get(cod);
    if (!row) { semAlcance.push({ codcli: cod, nome: null, motivo: "código não existe no WinThor" }); continue; }

    const sit = situacaoDoTelefone(row.telefone);
    if (!sit.pode) {
      semAlcance.push({
        codcli: cod, nome: row.nome,
        motivo: sit.motivo === "sem_telefone"
          ? "sem telefone no cadastro do WinThor"
          : `telefone incompleto no cadastro (${sit.bruto})`,
      });
      continue;
    }

    const slug = row.rca_num != null ? (slugPorRca.get(Number(row.rca_num)) ?? null) : null;
    let resolvido;
    try {
      resolvido = await acharOuCriarContato(db, {
        telefone: sit.telefone,
        nome: row.nome,
        erp: { codcli: row.codcli, nome: row.nome, cpf: row.cpf, carteira: slug },
      });
    } catch (e: any) {
      semAlcance.push({ codcli: cod, nome: row.nome, motivo: `erro ao preparar o contato: ${e?.message ?? e}` });
      continue;
    }

    cards.push({
      cliente_id: resolvido.cliente_id, cliente: resolvido.nome, vendedor: resolvido.carteira,
      etapa: null, ultima_atividade: null, telefone: resolvido.telefone, venda_valor: null,
      rd_cliente_id: null, codcli: cod,
    });
  }

  return { cards, semAlcance };
}
