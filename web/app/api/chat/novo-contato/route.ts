import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";
import { normalizarTelefone, tel8De } from "../../../../lib/telefone";
import { acharOuCriarContato, situacaoDoTelefone } from "../../../../lib/contatoDoErp";

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
//
// ---------------------------------------------------------------------------
// DOIS CHAMADORES (09/09/2026)
//
// 1. o botão "+" — número digitado, ninguém do ERP por trás;
// 2. a aba **Minha carteira**, com `codcli`: cliente que JÁ é da carteira e
//    ainda não tem contato. Aí o telefone vem do próprio cadastro, e nome, dono
//    e **CPF** saem do ERP — o CPF é o que faz o vínculo (e o histórico de
//    compra) nascer junto com a conversa.
//
// A identidade mora em `lib/contatoDoErp.ts`, uma implementação só: com duas,
// o mesmo número nasceria com ids diferentes pelos dois caminhos.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const minhaCarteira = carteiraDe(sessao);

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const codcli = Number(body?.codcli);
  const digitado = String(body?.telefone ?? "").trim();

  // ---- caminho 1: cliente da carteira (veio da agenda) ---------------------
  if (Number.isFinite(codcli) && codcli > 0) {
    const { data: erpRow } = await sb.from("wth_carteira")
      .select("codcli,nome,cpf,telefone,rca_num,ativo").eq("codcli", codcli).maybeSingle();
    if (!erpRow) return Response.json({ error: "cliente não encontrado no WinThor" }, { status: 404 });

    const { data: cc } = await sb.from("carteira_config")
      .select("slug").eq("rca_num", erpRow.rca_num).eq("ativo", true).maybeSingle();
    const dono = cc?.slug ?? null;
    // escopo: vendedor só mexe na própria carteira. Admin e home veem todas —
    // mesma régua do GET desta aba.
    if (minhaCarteira && dono !== minhaCarteira) {
      return Response.json({ error: "esse cliente não é da sua carteira" }, { status: 403 });
    }

    // o número digitado ganha do cadastro: quem está com a cliente na frente
    // sabe mais que o ERP. Sem digitar nada, vale o que está lá.
    const bruto = digitado || String(erpRow.telefone ?? "");
    const sit = situacaoDoTelefone(bruto);
    if (!sit.pode) {
      return Response.json({
        error: sit.motivo === "sem_telefone"
          ? "Esse cliente não tem telefone no cadastro do WinThor. Informe o número para abrir a conversa."
          : `O telefone do cadastro (${sit.bruto}) está incompleto — falta o DDD ou sobra dígito. Informe o número certo.`,
        motivo: sit.motivo,
        telefone_erp: erpRow.telefone ?? null,
      }, { status: 422 });
    }

    let r;
    try {
      r = await acharOuCriarContato(sb, {
        telefone: sit.telefone,
        nome: String(body?.nome ?? "").trim() || erpRow.nome,
        carteiraDeQuemCriou: minhaCarteira,
        erp: { codcli: erpRow.codcli, nome: erpRow.nome, cpf: erpRow.cpf, carteira: dono },
      });
    } catch (e: any) {
      return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
    }

    // O CRM não pode corrigir o WinThor — o `murano-clientes-v2` é espelho,
    // reescrito a cada dez minutos (§10.1). Então a correção vira PEDIDO, na
    // mesma fila que já sai em `.csv` para quem edita o ERP (0117). Sem isto o
    // consultor conserta o problema para si e ele volta para todo mundo no
    // próximo cliente.
    const tel8Erp = tel8De(String(erpRow.telefone ?? ""));
    const mudou = Boolean(digitado) && tel8De(sit.telefone) !== tel8Erp;
    let pedido_cadastro = false;
    if (mudou) {
      const { error } = await sb.from("cadastro_atualizacao").insert({
        cliente_id: r.cliente_id, codcli: erpRow.codcli, campo: "telefone",
        valor_atual: erpRow.telefone ?? null, valor_novo: sit.telefone,
        origem: "consultor", por: sessao,
      });
      // falhar aqui não pode custar a conversa: pedido repetido para o mesmo
      // cliente é recusado pelo índice, e isso é o comportamento certo
      pedido_cadastro = !error;
    }

    return Response.json({ ...r, pedido_cadastro });
  }

  // ---- caminho 2: número digitado, sem cliente do ERP ----------------------
  const telefone = normalizarTelefone(digitado);
  if (!telefone) {
    return Response.json({
      error: "Número incompleto. Digite com DDD — ex.: (91) 98166-0019.",
    }, { status: 400 });
  }

  try {
    const r = await acharOuCriarContato(sb, {
      telefone,
      nome: String(body?.nome ?? "").trim() || null,
      carteiraDeQuemCriou: minhaCarteira,
    });
    return Response.json(r);
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
