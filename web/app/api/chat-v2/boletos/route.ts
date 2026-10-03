import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { escopoCarteira } from "../../../../lib/verComo";

// ---------------------------------------------------------------------------
// QUEM TEM DÍVIDA EM ABERTO — o conjunto, não a lista (demanda #64)
//
// Serve ao chip "com dívida" da lista de conversas. Devolve só os `cliente_id`
// e um resumo; o detalhe de cada cobrança continua vindo do painel do contato,
// quando alguém abre a conversa.
//
// ⚠️ POR QUE ROTA PRÓPRIA, e não mais uma coluna em `vw_chat_conversa`:
// aquela view é materializada e lida a cada 60 s por toda aba aberta (§71) —
// é a consulta mais quente do sistema. Juntar boleto ali cobraria o preço de
// TODA carga da lista por um filtro que quase ninguém liga. Aqui o custo é
// pago uma vez, por quem clicou.
//
// Medido em 03/10/2026: 1.513 cobranças em aberto, 651 clientes, dos quais 303
// têm contato no Pulse.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const PAGE = 1000;

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const minha = escopoCarteira();

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ⚠️ PAGINADO. São 1.513 linhas e o PostgREST corta em 1.000 SEM AVISAR —
  // sem isto o chip esconderia um terço dos devedores e ninguém saberia.
  const cobrancas: any[] = [];
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await sb.from("vw_cliente_boleto")
      .select("codcli,valor_reais,vencido")
      .order("codcli").range(de, de + PAGE - 1);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    cobrancas.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  if (!cobrancas.length) return Response.json({ ids: [], resumo: null });

  // codcli -> total, para o resumo do chip
  const porCodcli = new Map<number, { vencidas: number; vencido: number; aberto: number }>();
  for (const k of cobrancas) {
    const cod = Number(k.codcli);
    const a = porCodcli.get(cod) ?? { vencidas: 0, vencido: 0, aberto: 0 };
    a.aberto += Number(k.valor_reais ?? 0);
    if (k.vencido) { a.vencidas += 1; a.vencido += Number(k.valor_reais ?? 0); }
    porCodcli.set(cod, a);
  }

  // codcli -> cliente_id. Lote pequeno porque são números, mas a URL do
  // PostgREST tem teto e 651 codclis já é lista grande.
  const cods = [...porCodcli.keys()];
  const LOTE = 400;
  const partes: number[][] = [];
  for (let i = 0; i < cods.length; i += LOTE) partes.push(cods.slice(i, i + LOTE));
  const vinc = await Promise.all(
    partes.map((p) => sb.from("wth_vinculo").select("codcli,cliente_id").in("codcli", p)),
  );
  const porCliente = new Map<string, number>();
  for (const r of vinc) {
    if ((r as any).error) return Response.json({ error: (r as any).error.message }, { status: 500 });
    // um codcli pode ter DOIS contatos (dois números): os dois devem acender o
    // chip, porque falar com qualquer um deles é falar com quem deve
    for (const v of ((r as any).data ?? [])) porCliente.set((v as any).cliente_id, Number((v as any).codcli));
  }
  if (!porCliente.size) return Response.json({ ids: [], resumo: null });

  // escopo: vendedor só enxerga a própria carteira, como em /api/chat
  let ids = [...porCliente.keys()];
  if (minha) {
    const meus: string[] = [];
    const idsArr = ids;
    const L = 200;
    const pedacos: string[][] = [];
    for (let i = 0; i < idsArr.length; i += L) pedacos.push(idsArr.slice(i, i + L));
    const res = await Promise.all(
      pedacos.map((p) => sb.from("clientes").select("id").eq("carteira", minha).in("id", p)),
    );
    for (const r of res) {
      if ((r as any).error) return Response.json({ error: (r as any).error.message }, { status: 500 });
      for (const c of ((r as any).data ?? [])) meus.push((c as any).id);
    }
    ids = meus;
  }

  let vencidas = 0, totalVencido = 0;
  const codsNoEscopo = new Set(ids.map((id) => porCliente.get(id)!));
  for (const cod of codsNoEscopo) {
    const a = porCodcli.get(cod);
    if (!a) continue;
    vencidas += a.vencidas;
    totalVencido += a.vencido;
  }

  return Response.json({
    ids,
    resumo: { clientes: ids.length, vencidas, total_vencido: totalVencido },
  });
}
