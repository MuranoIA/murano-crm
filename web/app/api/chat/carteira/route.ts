import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Minha carteira — a aba "Contatos" do chat.
//
// Pedido do usuário (25/08/2026): além das quatro filas, *"ter também toda
// minha carteira... como se fosse mesmo a função contatos do whatsapp"*.
//
// ---------------------------------------------------------------------------
// POR QUE ROTA PRÓPRIA, E NÃO MAIS UM RECORTE DE /api/chat
//
// As quatro filas existentes são recortes da lista que o chat JÁ tem em memória
// — custam zero. A carteira são até **961 registros por vendedor** que hoje não
// são buscados. Enfiá-los no carregamento inicial encareceria toda abertura do
// chat por causa de uma aba que quase nunca é a primeira. Aqui é buscada só
// quando alguém abre a aba, e uma vez por sessão.
//
// ---------------------------------------------------------------------------
// A IDENTIDADE, QUE É O PONTO DELICADO
//
// O board identifica o cliente de prospecção por `winthor:<codcli>` — id
// sintético, sem thread, que serve para desenhar um card e nada mais. O chat
// precisa do contato REAL para abrir conversa e enviar.
//
// A solução é não misturar as duas listas: **a carteira é chaveada por
// `codcli`**, a de conversas por `cliente_id`. O dropdown alterna entre elas, e
// como não há merge, não há como nascer card duplicado — que é o risco de
// forçar a mesma view a servir os dois usos.
//
// Cada linha carrega os dois identificadores, com `cliente_id` já resolvido:
//   1. `wth_vinculo` (casado por CPF) — 4.441 dos 4.691
//   2. senão, um `clientes` com o mesmo telefone (8 últimos dígitos, §16.3)
//   3. senão NULO — a linha aparece inerte, com o motivo. Some em silêncio
//      seria a doença que a tela de Pendências existe para curar (§36).
// ---------------------------------------------------------------------------

const PAGE = 1000;

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  // vendedor vê a própria carteira; admin/home veem todas e usam os chips de
  // vendedor que a sidebar já tem
  const minha = carteiraDe(sessao);

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: cfg } = await sb.from("carteira_config").select("slug,rca_num").eq("ativo", true);
  const rcas = (cfg ?? []).filter((c: any) => !minha || c.slug === minha).map((c: any) => c.rca_num);
  const slugPorRca = new Map((cfg ?? []).map((c: any) => [c.rca_num, c.slug]));
  if (!rcas.length) return Response.json({ carteira: [] });

  const clientes: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("wth_carteira")
      .select("codcli,nome,telefone,tel8,cidade,rca_num")
      .in("rca_num", rcas).eq("ativo", true)
      .order("nome").range(from, from + PAGE - 1);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    clientes.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  if (!clientes.length) return Response.json({ carteira: [] });

  // ---- resolve o contato: vínculo primeiro, telefone depois ----------------
  const codclis = clientes.map((c) => c.codcli);
  const porCodcli = new Map<number, string>();
  for (let i = 0; i < codclis.length; i += 300) {
    const { data } = await sb.from("wth_vinculo").select("codcli,cliente_id").in("codcli", codclis.slice(i, i + 300));
    for (const v of data ?? []) porCodcli.set(Number((v as any).codcli), (v as any).cliente_id);
  }

  // Para os que sobraram, casa por telefone. Uma varredura só de `clientes`
  // indexada por tel8: 300 consultas `like` seriam muito mais caras que ler a
  // tabela inteira uma vez (são ~5 mil linhas).
  const faltam = clientes.filter((c) => !porCodcli.has(Number(c.codcli)) && c.tel8);
  const porTel8 = new Map<string, string>();
  if (faltam.length) {
    for (let from = 0; ; from += PAGE) {
      const { data } = await sb.from("clientes").select("id,telefone").range(from, from + PAGE - 1);
      for (const cl of data ?? []) {
        const t8 = String((cl as any).telefone ?? "").replace(/\D/g, "").slice(-8);
        // preferência estável: o primeiro que aparecer fica; o telefone é a
        // chave fraca, e trocar de contato entre recargas confundiria mais
        if (t8.length === 8 && !porTel8.has(t8)) porTel8.set(t8, (cl as any).id);
      }
      if (!data || data.length < PAGE) break;
    }
  }

  const carteira = clientes.map((c) => {
    const cliente_id = porCodcli.get(Number(c.codcli)) ?? (c.tel8 ? porTel8.get(c.tel8) ?? null : null);
    return {
      codcli: c.codcli,
      cliente_id,
      cliente: c.nome,
      telefone: c.telefone ?? null,
      cidade: c.cidade ?? null,
      vendedor: slugPorRca.get(c.rca_num) ?? null,
      // por que não dá para abrir — a linha aparece mesmo assim, inerte
      impedimento: cliente_id ? null
        : !c.telefone ? "sem telefone no cadastro do WinThor"
        : "sem contato no CRM — telefone não confere com nenhum",
    };
  });

  return Response.json({
    carteira,
    total: carteira.length,
    sem_contato: carteira.filter((c) => !c.cliente_id).length,
  });
}
