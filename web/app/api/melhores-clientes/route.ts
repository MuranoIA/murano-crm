import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { escopoCarteira } from "../../../lib/verComo";

export const dynamic = "force-dynamic";

// Filtro "Melhores clientes" do board: top N por TICKET MÉDIO dos últimos 3
// meses (90 dias móveis), entre quem COMPROU no período. Critério definido pelo
// usuário em 06/08/2026: "compra nos últimos 3 meses e, destes, maior ticket
// médio no período". Devoluções já saem do líquido (total_3m da view).
// Devolve os identificadores (cliente_id / codcli / tel8) — o board casa os
// cards por qualquer um deles, igual aos filtros de produto e cidade.
export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const carteira = escopoCarteira();

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const qtdRaw = Number(new URL(req.url).searchParams.get("qtd") ?? 30);
  const qtd = [10, 20, 30, 40, 50].includes(qtdRaw) ? qtdRaw : 30;

  // paginado (PostgREST corta em 1000); só quem comprou na janela de 90 dias
  const PAGE = 1000;
  const linhas: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("vw_visoes_cliente")
      .select("cliente_id,codcli,tel8,compras_3m,total_3m")
      .gt("compras_3m", 0)
      .order("codcli")
      .range(from, from + PAGE - 1);
    if (carteira) q = q.eq("vendedor", carteira);
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // desativados ficam fora do ranking (mesma regra do board)
  const { data: descRows } = await sb.from("wth_descartados").select("cliente_id,codcli,tel8");
  const descCod = new Set((descRows ?? []).map((d: any) => d.codcli).filter((x: any) => x != null).map(Number));
  const descCli = new Set((descRows ?? []).map((d: any) => d.cliente_id).filter(Boolean));
  const descTel = new Set((descRows ?? []).map((d: any) => d.tel8).filter(Boolean));

  const top = linhas
    .filter((l) =>
      !descCod.has(Number(l.codcli)) &&
      !(l.cliente_id && descCli.has(l.cliente_id)) &&
      !(l.tel8 && descTel.has(l.tel8)))
    .map((l) => ({ ...l, ticket: +l.total_3m / +l.compras_3m }))
    .sort((a, b) => b.ticket - a.ticket || +b.total_3m - +a.total_3m)
    .slice(0, qtd);

  return Response.json({
    qtd,
    total: top.length,
    clienteIds: top.map((t) => t.cliente_id).filter(Boolean),
    codclis: top.map((t) => Number(t.codcli)).filter((x) => !isNaN(x)),
    tel8: top.map((t) => t.tel8).filter(Boolean),
    ticket_min: top.length ? +top[top.length - 1].ticket.toFixed(2) : null,
    ticket_max: top.length ? +top[0].ticket.toFixed(2) : null,
  });
}
