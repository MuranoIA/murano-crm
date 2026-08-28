import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { lerCrmConfig, VIEW_FUNIL_TELA } from "../../../../lib/crmConfig";
import { carteiraDe } from "../../../../lib/papel";
import { carregarAtribuicoes, donoEfetivo } from "../../../../lib/chatEscopo";
import { normalizarTelefone } from "../../../../lib/telefone";

export const dynamic = "force-dynamic";

// Painel do contato (P1, CLAUDE.md §18): os dados do WinThor ao lado da conversa.
// É a vantagem estrutural sobre o RD Conversas — o RD nunca teve o ERP do lado.
// Tudo vem de views que já existem; esta rota só junta e devolve enxuto.
export async function GET(req: Request) {
  if (!cookies().get("crm_sessao")?.value) {
    return Response.json({ error: "não autenticado" }, { status: 401 });
  }
  const cliente_id = new URL(req.url).searchParams.get("cliente_id");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // interruptor do motor de ciclo (crm_config, migration 0097) — disparado junto
  // com o resto, não antes, para não somar um round-trip ao painel do contato
  const cfgP = lerCrmConfig(sb);

  const [compras, cicloRow, funil, ultimas] = await Promise.all([
    // histórico de compra consolidado (líquido já desconta devolução)
    sb.from("vw_cliente_compras")
      .select("codcli,cidade,compras,ultima_compra,dias_sem_comprar,total_liquido,rca_oficial")
      .eq("cliente_id", cliente_id).maybeSingle(),
    // ciclo de recompra: quanto do ciclo já passou, urgência, ação sugerida.
    // Com o motor desligado a consulta nem sai — o painel perde a aba Ciclo,
    // mas mantém compras, dias sem comprar e ticket, que são fato do ERP.
    (async () => {
      if (!(await cfgP).ciclo_ativo) return null;
      const { data } = await sb.from("vw_ciclo_card")
        .select("pct_ciclo,ciclo_medio,dias_ausente,tipo_oportunidade,acao_recomendada,tendencia")
        .eq("cliente_id", cliente_id).maybeSingle();
      return data ?? null;
    })(),
    // etapa no funil + valor faturado no mês. Mesma view que o board está
    // lendo (0098): senão o painel diria "negociação" para um card que a tela
    // ao lado mostra em prospecção.
    (async () => {
      await cfgP;
      const { data } = await sb.from(VIEW_FUNIL_TELA)
        .select("cliente,etapa,venda_valor,venda_data,codcli,sem_cadastro")
        .eq("cliente_id", cliente_id).maybeSingle();
      return data ?? null;
    })(),
    // últimas notas fiscais do cliente
    sb.from("vw_pedido_emitido")
      .select("data_fat,valor,num_nota,filial")
      .eq("cliente_id", cliente_id)
      .order("data_fat", { ascending: false })
      .limit(5),
  ]);

  // -------------------------------------------------------------------------
  // "SEM CADASTRO NO WINTHOR" ERA MENTIRA EM 52 CONTATOS
  //
  // Relatado com print em 28/08/2026: clientes que a equipe SABE que existem no
  // ERP apareciam no painel como contato novo. Não eram novas — **trocaram de
  // número**. O cadastro velho continua lá, com CPF e vínculo; o número novo
  // entrou como outra linha em `clientes`, sem CPF, e o vínculo casa por CPF
  // (§10.5), então nunca se forma.
  //
  // O detalhe que torna isso um defeito nosso, e não um buraco de dado: a view
  // JÁ SABIA. Para os dois casos do print ela devolve `sem_cadastro = false` —
  // ou seja, encontrou o nome no WinThor — e o painel escrevia o contrário,
  // porque decidia pela ausência de `codcli`. Duas telas do mesmo sistema
  // afirmando coisas opostas sobre a mesma pessoa.
  //
  // Aqui a rota pergunta ao ERP pelo NOME e devolve o candidato. Quem afirma que
  // é a mesma pessoa é o humano, nunca este código: homônimo existe, e a §10.3
  // já registra que casar por nome não escala. Por isso vêm até 3 candidatos com
  // telefone e RCA à vista — é com eles que a consultora decide.
  //
  // O caminho de saída continua sendo o CPF: gravado na ficha, o
  // `wth_reconciliar_vinculos()` liga tudo sozinho em até 10 minutos.
  // -------------------------------------------------------------------------
  let erp_candidatos: any[] = [];
  if (!compras.data) {
    const nome = String((funil as any)?.cliente ?? "").trim();
    // nome curto demais casa com meio mundo; melhor não sugerir nada
    if (nome.length >= 8) {
      const { data } = await sb.from("wth_carteira")
        .select("codcli,nome,telefone,cidade,rca_num,rca_nome")
        .ilike("nome", nome).eq("ativo", true).limit(3);
      erp_candidatos = data ?? [];
    }
  }

  return Response.json({
    ciclo_ativo: (await cfgP).ciclo_ativo,
    compras: compras.data ?? null,
    ciclo: cicloRow,
    funil,
    ultimas_notas: ultimas.data ?? [],
    erp_candidatos,
  });
}

// ---------------------------------------------------------------------------
// SALVAR CONTATO — dar nome (e CPF) a quem chegou pela fila de espera.
//
// Pedido do usuário (26/08/2026): *"contatos novos que caem em fila de espera,
// o vendedor atende, como ele faz pra salvar? se nao houver essa funcionalidade,
// deve ser implementada"*. Não havia: `clientes` só era escrita pelo ETL, pelo
// webhook e pela criação — nada editava.
//
// O contato que o webhook cria tem o nome do PERFIL do WhatsApp, que às vezes é
// o próprio número (hoje há um chamado "551152826842" na fila). Sem poder
// renomear, ele fica assim para sempre.
//
// ---------------------------------------------------------------------------
// O CPF É O QUE LIGA O CONTATO AO ERP — E ELE SE LIGA SOZINHO
//
// Não escrevo `wth_vinculo` na mão: `wth_reconciliar_vinculos()` casa CPF e
// preenche o vínculo a cada 10 minutos (§10.5). Gravando o CPF aqui, em até
// dez minutos o card ganha codcli, RCA oficial e todo o histórico de compra —
// pela máquina que já existe, em vez de uma escrita paralela que o próprio job
// poderia desfazer depois.
//
// ⚠️ Por que a edição PERSISTE (verificado antes de escrever): o ETL só faz
// `clientes.set(...)` dentro do laço dos NOVOS — contato já conhecido é
// filtrado antes (§25.2) —, e o webhook só cria quando não acha por telefone.
// Nenhum dos dois reescreve nome de contato existente.
// ---------------------------------------------------------------------------
export async function PATCH(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const cliente_id = String(b?.cliente_id ?? "");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  if (cliente_id.includes(":") && !cliente_id.startsWith("wa:")) {
    return Response.json({ error: "este card não é um contato — é um cliente do ERP" }, { status: 422 });
  }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Quem pode salvar: o dono efetivo da conversa, ou admin/home. Um vendedor não
  // renomeia contato da carteira de outro — mesma régua do /api/chat/transferir.
  const minha = carteiraDe(sessao);
  if (minha) {
    const [{ data: f }, atrib] = await Promise.all([
      sb.from(VIEW_FUNIL_TELA).select("vendedor").eq("cliente_id", cliente_id).maybeSingle(),
      carregarAtribuicoes(sb),
    ]);
    const dono = donoEfetivo(cliente_id, (f as any)?.vendedor ?? null, atrib);
    // dono NULO = está na fila, e a fila é de todos: quem atende pode salvar
    if (dono && dono !== minha) {
      return Response.json({ error: "esta conversa é de outra carteira" }, { status: 403 });
    }
  }

  const campos: Record<string, any> = {};

  if (b?.nome !== undefined) {
    const nome = String(b.nome ?? "").trim();
    if (nome.length < 2) return Response.json({ error: "informe um nome" }, { status: 400 });
    campos.nome_completo = nome;
  }

  if (b?.cpf !== undefined) {
    const cpf = String(b.cpf ?? "").replace(/\D/g, "");
    if (cpf === "") {
      campos.cpf = null;
    } else if (cpf.length !== 11 && cpf.length !== 14) {
      // 11 = CPF, 14 = CNPJ (a base tem os dois). Recusar o incompleto evita
      // gravar algo que nunca vai casar no reconciliador e ficar parecendo bug.
      return Response.json({ error: "CPF/CNPJ incompleto" }, { status: 400 });
    } else {
      campos.cpf = cpf;
    }
  }

  if (b?.telefone !== undefined) {
    const tel = normalizarTelefone(String(b.telefone ?? ""));
    if (!tel) return Response.json({ error: "telefone inválido — use DDD" }, { status: 400 });
    campos.telefone = tel;
  }

  if (!Object.keys(campos).length) {
    return Response.json({ error: "nada para salvar" }, { status: 400 });
  }

  const { error } = await sb.from("clientes").update(campos).eq("id", cliente_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    ok: true,
    aviso: campos.cpf
      ? "Salvo. Com o CPF preenchido, o vínculo com o cadastro do WinThor aparece em até 10 minutos, junto com o histórico de compra."
      : "Contato salvo.",
  });
}
