import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";
import { carregarAtribuicoes, aplicaEscopo, emLotes } from "../../../../lib/chatEscopo";
import { lerCrmConfig, viewFunil } from "../../../../lib/crmConfig";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Busca no CONTEÚDO das mensagens (P1, CLAUDE.md §18). A busca da sidebar já
// filtrava nome e telefone no navegador; esta acha "onde foi mesmo que falamos
// de boleto" dentro de 72 mil mensagens.
//
// Trigrama (pg_trgm + GIN, migration 0081) e não full-text: quem procura numa
// conversa digita pedaço de palavra e erra a grafia. Exige 3+ caracteres — com
// menos que isso o índice não é usado e a busca viraria varredura da tabela.
//
// Escopo: a MESMA régua da lista (lib/chatEscopo) — o vendedor só vê resultado
// de conversa que é dele hoje, inclusive as recebidas por transferência.
// ---------------------------------------------------------------------------
const MIN = 3;
const TETO_MSGS = 400;      // mensagens varridas por busca
const TETO_CONVERSAS = 60;  // conversas devolvidas

// O valor entra num filtro do PostgREST e num LIKE do Postgres. Tira o que
// quebra o parser do PostgREST (vírgula, parênteses, aspas) e escapa os
// curingas do LIKE, para `100%` procurar "100%" e não "100 qualquer coisa".
const sanitiza = (s: string) =>
  s.replace(/[,()"'\\]/g, " ").trim().replace(/[%_]/g, (c) => `\\${c}`);

export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value ?? null;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const carteira = carteiraDe(sessao);

  const bruto = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (bruto.length < MIN) {
    return Response.json({ conversas: [], termo: bruto, curto: true });
  }
  const termo = sanitiza(bruto);
  if (!termo) return Response.json({ conversas: [], termo: bruto, curto: true });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Interruptor das conversas do RD (0098). A busca varre `mensagens` direto,
  // sem passar pela view — então precisa do filtro aqui, senão o trecho de uma
  // conversa escondida apareceria no resultado com o termo destacado.
  const cfg = await lerCrmConfig(sb);

  let busca = sb
    .from("mensagens")
    .select("cliente_id,conteudo,enviada_por,criada_em")
    .ilike("conteudo", `%${termo}%`)
    .neq("tipo", "evento_sistema");
  if (!cfg.conversas_rd_visiveis) busca = busca.not("linha_id", "is", null);
  const { data: achadas, error } = await busca
    .order("criada_em", { ascending: false })
    .limit(TETO_MSGS);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // agrupa por conversa: guarda o trecho MAIS RECENTE e quantas vezes bateu
  const porCliente = new Map<string, { trecho: string; trecho_em: string; de: string; n: number }>();
  for (const m of achadas ?? []) {
    const atual = porCliente.get(m.cliente_id);
    if (atual) { atual.n++; continue; }   // já veio ordenado por data desc
    porCliente.set(m.cliente_id, {
      trecho: String(m.conteudo ?? ""), trecho_em: m.criada_em, de: m.enviada_por, n: 1,
    });
  }
  if (!porCliente.size) {
    return Response.json({ conversas: [], termo: bruto, truncado: false });
  }

  // dados da conversa (nome, telefone, dono) + a régua de escopo da lista
  const ids = [...porCliente.keys()];
  const atrib = await carregarAtribuicoes(sb);
  const linhas: any[] = [];
  for (const lote of emLotes(ids)) {
    const { data } = await sb
      .from(viewFunil(cfg))
      .select("cliente_id,cliente,vendedor,etapa,telefone,ultima_atividade,ultima_mensagem,ultima_enviada_por")
      .in("cliente_id", lote);
    linhas.push(...(data ?? []));
  }

  const conversas = aplicaEscopo(linhas, atrib, carteira)
    .map((c) => ({ ...c, ...porCliente.get(c.cliente_id)! }))
    .sort((a, b) => (a.trecho_em < b.trecho_em ? 1 : -1))
    .slice(0, TETO_CONVERSAS);

  return Response.json({
    conversas,
    termo: bruto,
    // teto explícito: melhor dizer que cortou do que fingir cobertura completa
    truncado: (achadas?.length ?? 0) >= TETO_MSGS,
  });
}
