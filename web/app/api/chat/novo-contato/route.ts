import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";
import { normalizarTelefone, tel8De } from "../../../../lib/telefone";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Novo contato — "digitar o número e começar a conversar", como num WhatsApp.
//
// Pedido do usuário (25/08/2026): *"deve haver funcionalidade no chat e no CRM
// para cadastrar novo contato, igual como acontece em um whatsapp normal
// (cadastrar ou simplesmente digitar o número para mandar mensagem)"*.
//
// Esta rota NÃO envia nada. Ela só garante que existe uma linha em `clientes`
// para aquele número e devolve o `cliente_id` — a partir daí a conversa é a
// mesma de sempre: janela fechada, então o primeiro contato sai por template.
// Separar as duas coisas evita o pior desfecho possível, que é um clique em
// "cadastrar" disparando mensagem para o número errado.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const minhaCarteira = carteiraDe(sessao);

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }

  const telefone = normalizarTelefone(body?.telefone ?? "");
  if (!telefone) {
    return Response.json({
      error: "Número incompleto. Digite com DDD — ex.: (91) 98166-0019.",
    }, { status: 400 });
  }
  const nomeInformado = String(body?.nome ?? "").trim();

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Match pelos 8 ÚLTIMOS dígitos, a mesma chave do webhook e do ETL: o RD
  // guarda 12 dígitos (sem o nono) e a Meta manda 13, então comparar o número
  // inteiro erraria justamente nos contatos que já existem (§16.3).
  const tel8 = tel8De(telefone);

  const { data: existentes, error: e1 } = await sb
    .from("clientes").select("id,nome_completo,carteira,telefone")
    .like("telefone", `%${tel8}`).limit(5);
  if (e1) return Response.json({ error: e1.message }, { status: 500 });

  if (existentes?.length) {
    // mesma preferência do webhook: se houver mais de um, fica com quem tem dono
    const escolhido = existentes.find((c: any) => c.carteira) ?? existentes[0];
    return Response.json({
      cliente_id: escolhido.id,
      nome: escolhido.nome_completo,
      carteira: escolhido.carteira ?? null,
      ja_existia: true,
    });
  }

  // Não está em `clientes`, mas pode ser cliente do ERP que nunca conversou —
  // nesse caso o nome e o dono certos vêm de lá, não do que foi digitado.
  const { data: noErp } = await sb
    .from("wth_carteira").select("codcli,nome,rca_num").eq("tel8", tel8).limit(1);
  let carteiraErp: string | null = null;
  if (noErp?.[0]?.rca_num != null) {
    const { data: cc } = await sb
      .from("carteira_config").select("slug").eq("rca_num", noErp[0].rca_num).eq("ativo", true).maybeSingle();
    carteiraErp = cc?.slug ?? null;
  }

  const novo = {
    // mesmo id sintético do webhook: se esta pessoa escrever depois, o
    // `acharOuCriarCliente` cai no match por tel8 e reusa ESTA linha, sem criar
    // uma segunda conversa para o mesmo número
    id: `wa:${telefone}`,
    nome_completo: nomeInformado || noErp?.[0]?.nome || telefone,
    telefone,
    // dono: o do ERP se houver; senão quem cadastrou, quando é vendedor. Admin
    // e home não têm carteira, então o contato nasce na fila de não atribuídos
    // (§21) — que é onde qualquer um pode pegá-lo.
    carteira: carteiraErp ?? minhaCarteira ?? null,
    canal: "whatsapp",
  };
  const { error: e2 } = await sb.from("clientes").upsert(novo, { onConflict: "id" });
  if (e2) return Response.json({ error: e2.message }, { status: 500 });

  return Response.json({
    cliente_id: novo.id,
    nome: novo.nome_completo,
    carteira: novo.carteira,
    ja_existia: false,
    codcli: noErp?.[0]?.codcli ?? null,
  });
}
