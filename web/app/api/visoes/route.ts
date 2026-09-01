import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { escopoCarteira } from "../../../lib/verComo";

export const dynamic = "force-dynamic";

// Motivos oficiais do dropdown da visão Desativados. "cliente final" minúsculo
// é o legado da lixeira do board — mantido pra casar com as linhas antigas.
const MOTIVOS = [
  "cliente final",
  "não trabalha mais",
  "fechou o salão",
  "mudou de cidade",
  "comprando de concorrente",
  "outro",
];

type Linha = {
  codcli: number; cliente_id: string | null; nome: string; telefone: string | null;
  tel8: string | null; cidade: string | null; vendedor: string | null; rca_nome: string | null;
  ultima_compra: string | null; primeira_compra: string | null; dias_sem_comprar: number | null;
  meses_total: number; meses_12m: number; total_12m: number; valor_mes: number;
  comprou_mes: boolean; meses_recentes: string[] | null;
};

// meses de compra CONSECUTIVOS contando de hoje pra trás. O mês corrente ainda
// está aberto — se o cliente não comprou nele, a sequência pode começar no mês
// anterior sem quebrar (senão todo mundo viraria "não frequente" no dia 1º).
function sequenciaMeses(mesesRecentes: string[] | null | undefined): number {
  const meses = new Set((mesesRecentes ?? []).map((m) => m.slice(0, 7)));
  if (!meses.size) return 0;
  const agora = new Date(Date.now() - 3 * 3600 * 1000); // BRT aproximado (como o resto do app)
  let ano = agora.getUTCFullYear(), mes = agora.getUTCMonth(); // 0-11
  const chave = () => `${ano}-${String(mes + 1).padStart(2, "0")}`;
  const volta = () => { mes -= 1; if (mes < 0) { mes = 11; ano -= 1; } };
  if (!meses.has(chave())) volta(); // tolera o mês corrente em aberto
  let seq = 0;
  while (meses.has(chave())) { seq += 1; volta(); }
  return seq;
}

const ATIVO_DIAS = 120;   // regra do usuário: 120 dias determina ativo/inativo
const SEQ_FREQUENTE = 3;  // 3 meses de compra = frequente / fidelizado

export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const carteira = escopoCarteira();

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const caso = new URL(req.url).searchParams.get("caso") ?? "";

  // ---- visão 5: desativados (lixeira com motivo + observação) --------------
  if (caso === "desativados") {
    let q = sb.from("wth_descartados")
      .select("id,cliente_id,codcli,tel8,cliente,vendedor,motivo,observacao,descartado_por,criado_em")
      .order("criado_em", { ascending: false });
    if (carteira) q = q.eq("vendedor", carteira);
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({
      caso,
      motivos: MOTIVOS,
      grupos: [{ key: "desativados", titulo: "Desativados", cards: data ?? [] }],
      atualizado_em: new Date().toISOString(),
    });
  }

  // ---- visões 1-4: clientes com compra (vw_visoes_cliente) -----------------
  // paginado: o PostgREST corta em 1000 linhas e a view tem ~5.9k
  const PAGE = 1000;
  const linhas: Linha[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("vw_visoes_cliente").select("*").order("codcli").range(from, from + PAGE - 1);
    if (carteira) q = q.eq("vendedor", carteira);
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    linhas.push(...((data ?? []) as Linha[]));
    if (!data || data.length < PAGE) break;
  }

  // desativados somem das visões 1-4 (mesma regra do board), por qualquer id
  const { data: descRows } = await sb.from("wth_descartados").select("cliente_id,codcli,tel8");
  const descCod = new Set((descRows ?? []).map((d: any) => d.codcli).filter((x: any) => x != null).map(Number));
  const descCli = new Set((descRows ?? []).map((d: any) => d.cliente_id).filter(Boolean));
  const descTel = new Set((descRows ?? []).map((d: any) => d.tel8).filter(Boolean));
  const base = linhas.filter((l) =>
    !descCod.has(Number(l.codcli)) &&
    !(l.cliente_id && descCli.has(l.cliente_id)) &&
    !(l.tel8 && descTel.has(l.tel8))
  );

  const card = (l: Linha) => ({
    codcli: l.codcli, cliente_id: l.cliente_id, nome: l.nome, telefone: l.telefone,
    cidade: l.cidade, vendedor: l.vendedor, rca_nome: l.rca_nome,
    ultima_compra: l.ultima_compra, primeira_compra: l.primeira_compra,
    dias_sem_comprar: l.dias_sem_comprar, meses_total: l.meses_total, meses_12m: l.meses_12m,
    total_12m: +(+l.total_12m).toFixed(2), valor_mes: +(+l.valor_mes).toFixed(2),
    comprou_mes: l.comprou_mes, sequencia: sequenciaMeses(l.meses_recentes),
  });

  let grupos: { key: string; titulo: string; cards: any[] }[] = [];

  if (caso === "melhores") {
    // F/M: rank de frequência (meses c/ compra em 12m) + rank de monetização
    // (líquido 12m), pesos iguais. Top 30 da base visível (carteira do vendedor
    // quando não-admin). Ativo/inativo pela regra dos 120 dias.
    const n = base.length || 1;
    const rank = (vals: number[]) => {
      const ordenado = [...vals].sort((a, b) => a - b);
      return (v: number) => ordenado.findIndex((x) => x >= v) / n;
    };
    const rf = rank(base.map((l) => l.meses_12m));
    const rm = rank(base.map((l) => +l.total_12m));
    const top = base
      .map((l) => ({ l, score: rf(l.meses_12m) + rm(+l.total_12m) }))
      .sort((a, b) => b.score - a.score || +b.l.total_12m - +a.l.total_12m)
      .slice(0, 30);
    const ativos = top.filter((t) => (t.l.dias_sem_comprar ?? 9999) <= ATIVO_DIAS);
    const inativos = top.filter((t) => (t.l.dias_sem_comprar ?? 9999) > ATIVO_DIAS);
    grupos = [
      { key: "ativos", titulo: `Ativos (compra em até ${ATIVO_DIAS} dias)`, cards: ativos.map((t) => ({ ...card(t.l), posicao_rank: top.indexOf(t) + 1 })) },
      { key: "inativos", titulo: `Inativos (+${ATIVO_DIAS} dias sem compra)`, cards: inativos.map((t) => ({ ...card(t.l), posicao_rank: top.indexOf(t) + 1 })) },
    ];
  } else if (caso === "frequencia") {
    // frequente = 3+ meses de compra em sequência (mês corrente em aberto não
    // quebra). Não frequente = ativo (compra nos últimos 120 dias), sem a
    // sequência — e fora do processo de fidelização (esses ficam na visão 3).
    const ativos = base.filter((l) => (l.dias_sem_comprar ?? 9999) <= ATIVO_DIAS);
    const frequentes = ativos.filter((l) => sequenciaMeses(l.meses_recentes) >= SEQ_FREQUENTE)
      .sort((a, b) => +b.valor_mes - +a.valor_mes || +b.total_12m - +a.total_12m);
    const naoFrequentes = ativos.filter((l) => sequenciaMeses(l.meses_recentes) < SEQ_FREQUENTE && l.meses_total >= SEQ_FREQUENTE)
      .sort((a, b) => (a.dias_sem_comprar ?? 0) - (b.dias_sem_comprar ?? 0));
    grupos = [
      { key: "frequentes", titulo: "Frequentes (compram todo mês, 3+ meses)", cards: frequentes.map(card) },
      { key: "nao_frequentes", titulo: "Não frequentes (sem sequência de 3 meses)", cards: naoFrequentes.map(card) },
    ];
  } else if (caso === "fidelizacao") {
    // clientes novos no processo de fidelização: ainda não fecharam 3 meses de
    // compra. Com 3 meses o cliente é fidelizado e passa pra visão Frequência.
    const emProcesso = base.filter((l) => l.meses_total < SEQ_FREQUENTE && (l.dias_sem_comprar ?? 9999) <= ATIVO_DIAS);
    const g1 = emProcesso.filter((l) => l.meses_total === 1).sort((a, b) => (a.dias_sem_comprar ?? 0) - (b.dias_sem_comprar ?? 0));
    const g2 = emProcesso.filter((l) => l.meses_total === 2).sort((a, b) => (a.dias_sem_comprar ?? 0) - (b.dias_sem_comprar ?? 0));
    grupos = [
      { key: "mes1", titulo: "1º mês de compra (1/3)", cards: g1.map(card) },
      { key: "mes2", titulo: "2º mês de compra (2/3)", cards: g2.map(card) },
    ];
  } else if (caso === "mes") {
    const doMes = base.filter((l) => l.comprou_mes).sort((a, b) => +b.valor_mes - +a.valor_mes);
    grupos = [{ key: "mes", titulo: "Compraram no mês atual", cards: doMes.map(card) }];
  } else {
    return Response.json({ error: `caso desconhecido: ${caso}` }, { status: 400 });
  }

  return Response.json({ caso, grupos, atualizado_em: new Date().toISOString() });
}
