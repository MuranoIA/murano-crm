import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";
import { situacaoDoTelefone, impedimentoDe } from "../../../../lib/contatoDoErp";

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
//
// ---------------------------------------------------------------------------
// O TERCEIRO CASO NÃO ERA UM CASO SÓ (09/09/2026)
//
// Relato do usuário: clientes da carteira apareciam com "sem contato" e não
// abriam. A suspeita levantada era outra tabela de telefone no ERP (contato de
// cobrança, de entrega). **Medido e descartado:** `psv_contato` e `wth_ciclo`
// repetem o mesmo número, e recuperam ZERO dos que estão sem; casar por nome
// também dá zero. O telefone que falta, falta mesmo.
//
// O que a medição achou foi outra coisa. Dos 118 inertes das 7 carteiras:
//
//   24  o telefone do ERP é PERFEITO (DDD + 9 dígitos) — só nunca ninguém criou
//       o contato. O provisionamento em massa de 37.4 rodou uma vez, em agosto;
//       quem entrou na carteira depois ficou de fora e ninguém percebeu.
//   31  telefone quebrado no cadastro (sem DDD, ou com um dígito a mais)
//   63  cadastro sem telefone nenhum
//
// Então a linha deixou de ter dois estados (abre / não abre) e passou a ter
// três, porque as ações são diferentes: o primeiro grupo abre no clique, e os
// outros dois pedem o número ao consultor — que é quem está com a cliente na
// frente — e mandam a correção para quem edita o WinThor.
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
      const { data } = await sb.from("clientes").select("id,telefone")
        .order("id", { ascending: true })   // desempate: `range` sem `order` nao tem ordem prometida entre paginas
        .range(from, from + PAGE - 1);
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
    const sit = situacaoDoTelefone(c.telefone);
    return {
      codcli: c.codcli,
      cliente_id,
      cliente: c.nome,
      telefone: c.telefone ?? null,
      cidade: c.cidade ?? null,
      vendedor: slugPorRca.get(c.rca_num) ?? null,
      // sem contato ainda, mas o número do cadastro serve: o clique cria o
      // contato e abre a conversa (POST desta mesma aba, com o codcli)
      criar_no_clique: !cliente_id && sit.pode,
      // o CRM não consegue sozinho — precisa do número, que só quem está com a
      // cliente na frente tem. A linha continua clicável: ela abre o campo.
      precisa_telefone: !cliente_id && !sit.pode,
      impedimento: cliente_id ? null : impedimentoDe(sit),
    };
  });

  return Response.json({
    carteira,
    total: carteira.length,
    sem_contato: carteira.filter((c) => !c.cliente_id).length,
    // o que ainda depende de alguém digitar — é o número que vale acompanhar,
    // porque o outro grupo se resolve sozinho no primeiro clique
    sem_telefone: carteira.filter((c) => c.precisa_telefone).length,
  });
}
