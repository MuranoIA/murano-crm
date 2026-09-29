import { guardaAdmin, sbAdmin } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// CAMPANHAS DE DISTRIBUIÇÃO (demanda #52, 29/09/2026)
//
// O caso de uso: uma carteira ficou vaga, centenas de clientes sem atendimento.
// Dispara-se um template; à medida que respondem, caem na fila de espera e
// alguém transfere UM POR UM, à mão, conforme vão chegando.
//
// ⚠️ A CAMPANHA NÃO DISPARA — ela se prende a um disparo QUE JÁ ACONTECEU.
// Foi a escolha do próprio dono no fim do pedido ("selecionar o disparo
// ocorrido hoje às xx horas"), e é a que evita duas telas de disparo: a de
// Administração › Templates já tem prévia, motivos de corte, anti-repetição,
// custo e upload de planilha — e o laço de envio precisa rodar na aba aberta,
// porque a cota do WhatsApp não cabe no tempo de uma rota (§26.2).
//
// ⚠️ O NOME DO ARQUIVO não é `campanhas`: aquela rota já existe e responde
// outra coisa (desempenho dos templates). Duas rotas com o mesmo nome e
// assuntos diferentes é como se manda a próxima pessoa para o lugar errado.
// ---------------------------------------------------------------------------

const PAGE = 1000;

/** Os disparos em massa recentes, agrupados por template + HORA — que é como a
 *  pessoa se refere a eles ("o de hoje às 14h"). `disparos_template` é um log
 *  por cliente e não tem id de lote, então o agrupamento é a única âncora. */
async function disparosRecentes(sb: any) {
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
    const hora = String(l.criada_em).slice(0, 13);
    const k = `${l.template_id ?? "-"}|${hora}`;
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

export async function GET(req: Request) {
  const g = guardaAdmin("ver as campanhas de distribuição");
  if (g.erro) return g.erro;
  const sb = sbAdmin();
  const id = new URL(req.url).searchParams.get("id");

  // ---- a planilha de uma campanha ---------------------------------------
  if (id) {
    const [{ data: camp }, { data: alvos }] = await Promise.all([
      sb.from("campanha").select("*").eq("id", Number(id)).maybeSingle(),
      sb.from("campanha_alvo").select("*").eq("campanha_id", Number(id))
        .order("distribuido_em", { ascending: false, nullsFirst: false })
        .order("nome")
        .limit(PAGE),
    ]);
    if (!camp) return Response.json({ error: "campanha não encontrada" }, { status: 404 });
    return Response.json({ campanha: camp, alvos: alvos ?? [] });
  }

  // ---- a tela de montagem ------------------------------------------------
  const [disparos, campanhasRes, pessoasRes, carteirasRes] = await Promise.all([
    disparosRecentes(sb),
    sb.from("campanha").select("*").order("criada_em", { ascending: false }).limit(30),
    // os mesmos dois tipos de endereço que a transferência aceita, e o MESMO
    // recorte da lista dela (0146): quem o admin escondeu de lá não pode
    // aparecer aqui — seria oferecer como destino quem ele acabou de tirar.
    sb.from("acesso").select("email,nome,papel,carteira,atende_chat,transferencia_visivel")
      .eq("ativo", true).order("email"),
    sb.from("carteira_config").select("slug").eq("ativo", true).order("slug"),
  ]);

  const slugsAtivos = new Set((carteirasRes.data ?? []).map((c: any) => String(c.slug)));
  const atendentes = (pessoasRes.data ?? [])
    .filter((p: any) => p.transferencia_visivel !== false)
    .filter((p: any) => (p.carteira ? slugsAtivos.has(String(p.carteira)) : p.atende_chat === true))
    .map((p: any) => ({
      endereco: p.carteira ? String(p.carteira) : `u:${String(p.email).toLowerCase()}`,
      nome: p.carteira ? String(p.carteira) : ((p.nome && String(p.nome).trim()) || String(p.email).split("@")[0]),
      papel: p.papel ?? null,
      tipo: p.carteira ? "consultor" : "atendimento",
    }));

  // quantos já foram distribuídos em cada campanha — o número que a tela mostra
  // no card sem precisar abrir a planilha
  const ids = (campanhasRes.data ?? []).map((c: any) => c.id);
  const distribuidos = new Map<number, { feitos: number; total: number }>();
  if (ids.length) {
    const { data } = await sb.from("campanha_alvo")
      .select("campanha_id,distribuido_em").in("campanha_id", ids).limit(20000);
    for (const a of data ?? []) {
      const k = Number((a as any).campanha_id);
      const v = distribuidos.get(k) ?? { feitos: 0, total: 0 };
      v.total += 1;
      if ((a as any).distribuido_em) v.feitos += 1;
      distribuidos.set(k, v);
    }
  }

  return Response.json({
    disparos,
    atendentes,
    campanhas: (campanhasRes.data ?? []).map((c: any) => ({
      ...c, ...(distribuidos.get(Number(c.id)) ?? { feitos: 0, total: 0 }),
    })),
  });
}

export async function POST(req: Request) {
  const g = guardaAdmin("criar campanha de distribuição");
  if (g.erro) return g.erro;
  const sb = sbAdmin();

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }

  const nome = String(b?.nome ?? "").trim().slice(0, 120);
  const de = String(b?.de ?? "");
  const ate = String(b?.ate ?? "");
  const atendentes: string[] = Array.isArray(b?.atendentes)
    ? b.atendentes.map((x: any) => String(x)).filter(Boolean) : [];
  const templateId = b?.template_id ? String(b.template_id) : null;
  const janela = Number(b?.janela_dias ?? 7);

  if (!nome) return Response.json({ error: "dê um nome à campanha" }, { status: 400 });
  if (!de || !ate) return Response.json({ error: "escolha o disparo" }, { status: 400 });
  if (!atendentes.length) {
    return Response.json({ error: "escolha ao menos um atendente para o rodízio" }, { status: 400 });
  }
  // ⚠️ ordem importa e repetição NÃO: um nome duas vezes na fila daria o dobro
  // de clientes para a mesma pessoa, e ninguém perceberia olhando a tela.
  if (new Set(atendentes).size !== atendentes.length) {
    return Response.json({ error: "há atendente repetido na fila do rodízio" }, { status: 400 });
  }
  if (!Number.isFinite(janela) || janela < 1 || janela > 90) {
    return Response.json({ error: "janela de resposta inválida" }, { status: 400 });
  }

  // ---- quem entra: os clientes daquele disparo ---------------------------
  const enviados: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("disparos_template")
      .select("cliente_id,vendedor,criada_em")
      .gte("criada_em", de).lte("criada_em", ate).eq("origem", "massa")
      .order("cliente_id").range(from, from + PAGE - 1);
    if (templateId) q = q.eq("template_id", templateId);
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    enviados.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  if (!enviados.length) return Response.json({ error: "esse disparo não tem clientes" }, { status: 422 });

  // o envio MAIS ANTIGO por cliente: a janela conta a partir dele, e repetir o
  // cliente daria duas chances de distribuição para a mesma pessoa
  const porCliente = new Map<string, any>();
  for (const e of enviados) {
    const a = porCliente.get(e.cliente_id);
    if (!a || e.criada_em < a.criada_em) porCliente.set(e.cliente_id, e);
  }
  const ids = [...porCliente.keys()];

  // ---- a foto do cadastro: é ela que deixa a planilha dizer "de quem ERA" --
  // Guardada agora, e não lida por join na hora de mostrar, porque a carteira
  // do cliente MUDA — inclusive por causa desta campanha.
  const dados = new Map<string, any>();
  const vinc = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const [{ data: cs }, { data: vs }] = await Promise.all([
      sb.from("clientes").select("id,nome_completo,carteira").in("id", lote),
      sb.from("wth_vinculo").select("cliente_id,codcli").in("cliente_id", lote),
    ]);
    for (const c of cs ?? []) dados.set((c as any).id, c);
    for (const v of vs ?? []) vinc.set((v as any).cliente_id, Number((v as any).codcli));
  }
  const codclis = [...new Set(vinc.values())];
  const rcaDe = new Map<number, number | null>();
  for (let i = 0; i < codclis.length; i += 300) {
    const { data } = await sb.from("wth_carteira").select("codcli,rca_num").in("codcli", codclis.slice(i, i + 300));
    for (const w of data ?? []) rcaDe.set(Number((w as any).codcli), (w as any).rca_num ?? null);
  }

  const carteirasOrigem = [...new Set(
    [...porCliente.values()].map((e) => String(e.vendedor ?? "")).filter(Boolean),
  )].sort();

  const { data: camp, error: eCamp } = await sb.from("campanha").insert({
    nome, criada_por: g.email ?? null,
    template_id: templateId, template_nome: b?.template_nome ? String(b.template_nome).slice(0, 120) : null,
    disparo_de: de, disparo_ate: ate,
    carteiras: carteirasOrigem, atendentes, janela_dias: janela,
  }).select("*").single();
  if (eCamp) return Response.json({ error: eCamp.message }, { status: 500 });

  const linhas = [...porCliente.entries()].map(([cliente_id, e]) => {
    const c = dados.get(cliente_id);
    const cod = vinc.get(cliente_id) ?? null;
    return {
      campanha_id: camp.id,
      cliente_id,
      nome: c?.nome_completo ?? null,
      codcli: cod,
      rca: cod != null ? rcaDe.get(cod) ?? null : null,
      carteira_origem: e.vendedor ?? c?.carteira ?? null,
      enviado_em: e.criada_em,
    };
  });
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await sb.from("campanha_alvo").insert(linhas.slice(i, i + 500));
    if (error) return Response.json({ error: `gravar alvos: ${error.message}` }, { status: 500 });
  }

  return Response.json({ ok: true, campanha: camp, alvos: linhas.length });
}

export async function PATCH(req: Request) {
  const g = guardaAdmin("encerrar campanha de distribuição");
  if (g.erro) return g.erro;
  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return Response.json({ error: "id ausente" }, { status: 400 });
  const ativa = b?.ativa === true;

  const { error } = await sbAdmin().from("campanha")
    .update({ ativa, encerrada_em: ativa ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, id, ativa });
}
