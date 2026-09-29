import "server-only";
import { banco } from "./servidor";

// ---------------------------------------------------------------------------
// A 1ª CARGA DO PAINEL, NO SERVIDOR (spec §2.3).
//
// O que a tela desenha já vai no HTML: nada de casca vazia esperando um
// `fetch` do navegador para aparecer. As leituras vão em `Promise.all`, com
// `select` só das colunas usadas — a mesma régua que tirou o `/api/chat` de 20
// idas ao banco.
//
// As rotas `/api/admin/*` continuam existindo: elas servem às MUTAÇÕES e à
// atualização depois da primeira pintura. O que sai daqui é o primeiro quadro.
// ---------------------------------------------------------------------------

export type PessoaTransferencia = {
  email: string; nome: string; papel: string | null; carteira: string | null;
  atende_chat: boolean; visivel: boolean; impedimento: string | null;
};

export type Atendente = {
  endereco: string; nome: string; papel: string | null; tipo: "consultor" | "atendimento";
};

export type Disparo = {
  chave: string; template_id: string | null; de: string; ate: string;
  total: number; carteiras: string[];
};

export type CampanhaResumo = {
  id: number; nome: string; criada_em: string; criada_por: string | null;
  template_id: string | null; disparo_de: string; disparo_ate: string;
  carteiras: string[]; atendentes: string[]; proximo: number;
  janela_dias: number; ativa: boolean; feitos: number; total: number;
};

export type PainelInicial = {
  pessoas: PessoaTransferencia[];
  atendentes: Atendente[];
  disparos: Disparo[];
  campanhas: CampanhaResumo[];
};

const PAGE = 1000;

/** Os disparos em massa recentes, agrupados por template + HORA — que é como a
 *  pessoa se refere a eles ("o de hoje às 14h"). `disparos_template` é um log
 *  por cliente e não tem id de lote, então o agrupamento é a única âncora. */
async function disparosRecentes(sb: any): Promise<Disparo[]> {
  const desde = new Date(Date.now() - 30 * 86400_000).toISOString();
  const linhas: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb.from("disparos_template")
      .select("cliente_id,vendedor,template_id,criada_em")
      .gte("criada_em", desde).eq("origem", "massa")
      .order("criada_em", { ascending: false })
      .range(from, from + PAGE - 1);
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  const balde = new Map<string, any>();
  for (const l of linhas) {
    const k = `${l.template_id ?? "-"}|${String(l.criada_em).slice(0, 13)}`;
    const b = balde.get(k) ?? {
      chave: k, template_id: l.template_id ?? null,
      de: l.criada_em, ate: l.criada_em, total: 0, carteiras: new Set<string>(),
    };
    b.total += 1;
    if (l.criada_em < b.de) b.de = l.criada_em;
    if (l.criada_em > b.ate) b.ate = l.criada_em;
    if (l.vendedor) b.carteiras.add(String(l.vendedor));
    balde.set(k, b);
  }
  return [...balde.values()]
    .map((b) => ({ ...b, carteiras: [...b.carteiras].sort() }))
    .sort((a, b) => (a.de < b.de ? 1 : -1))
    .slice(0, 40);
}

export async function lerPainel(): Promise<PainelInicial> {
  const sb = banco();

  const [acessoRes, carteirasRes, campanhasRes, disparos] = await Promise.all([
    sb.from("acesso").select("email,nome,papel,carteira,ativo,atende_chat,transferencia_visivel")
      .eq("ativo", true).order("carteira", { nullsFirst: false }).order("email"),
    sb.from("carteira_config").select("slug").eq("ativo", true).order("slug"),
    sb.from("campanha").select("*").order("criada_em", { ascending: false }).limit(30),
    disparosRecentes(sb),
  ]);

  const pessoas: PessoaTransferencia[] = (acessoRes.data ?? []).map((p: any) => ({
    email: p.email,
    nome: (p.nome && String(p.nome).trim()) || String(p.email).split("@")[0],
    papel: p.papel ?? null,
    carteira: p.carteira ?? null,
    atende_chat: p.atende_chat === true,
    visivel: p.transferencia_visivel !== false,
    // o que impede de aparecer na lista, MESMO marcado — dizer o motivo aqui
    // evita a pergunta "marquei e não aparece"
    impedimento: !p.carteira && p.atende_chat !== true
      ? "não atende no chat — ligue em Administração › Usuários"
      : null,
  }));

  const slugsAtivos = new Set((carteirasRes.data ?? []).map((c: any) => String(c.slug)));
  const atendentes: Atendente[] = pessoas
    .filter((p) => p.visivel)
    .filter((p) => (p.carteira ? slugsAtivos.has(p.carteira) : p.atende_chat))
    .map((p) => ({
      endereco: p.carteira ? p.carteira : `u:${p.email.toLowerCase()}`,
      nome: p.carteira ? p.carteira : p.nome,
      papel: p.papel,
      tipo: p.carteira ? "consultor" : "atendimento",
    }));

  // quantos já foram distribuídos em cada campanha — o número do card, sem
  // precisar abrir a planilha
  const ids = (campanhasRes.data ?? []).map((c: any) => c.id);
  const conta = new Map<number, { feitos: number; total: number }>();
  if (ids.length) {
    const { data } = await sb.from("campanha_alvo")
      .select("campanha_id,distribuido_em").in("campanha_id", ids).limit(20000);
    for (const a of data ?? []) {
      const k = Number((a as any).campanha_id);
      const v = conta.get(k) ?? { feitos: 0, total: 0 };
      v.total += 1;
      if ((a as any).distribuido_em) v.feitos += 1;
      conta.set(k, v);
    }
  }

  return {
    pessoas,
    atendentes,
    disparos,
    campanhas: (campanhasRes.data ?? []).map((c: any) => ({
      ...c, ...(conta.get(Number(c.id)) ?? { feitos: 0, total: 0 }),
    })),
  };
}
