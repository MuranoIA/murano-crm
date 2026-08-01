import { createClient } from "npm:@supabase/supabase-js@2";

// Gera as análises (narrativas) do dashboard Inside Sales por IA.
// Body {} → mês corrente: lê is_dashboard.dados e grava em is_dashboard.narrativas.
// Body {"mes":"2026-07"} → mês encerrado: calcula via is_dashboard_as_of.
// Em ambos os casos guarda o resultado em is_narrativas_mes (cache por mês), para que
// o dropdown de mês do dashboard abra com a análise pronta.
// Disparada toda madrugada pelo pg_cron (is-narrativas-diario, 45 6 * * * UTC = 03:45 BRT)
// após o is_refresh das 03:30. Deploy com verify_jwt=false.
// Secret necessário: ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).
// Modelo: Haiku 4.5 (econômico, ~centavos/dia). Trocar MODEL para claude-opus-5 se quiser
// prosa mais rica (custa mais).

const MODEL = "claude-haiku-4-5";

const ABAS: Record<string, string> = {
  fat: "Faturamento líquido por consultor: quem lidera, % da meta, quem cresceu/caiu vs mês anterior, e as devoluções altas.",
  ticket: "Ticket médio por cliente: quem tem o maior, quem cresceu/caiu.",
  clientes: "Clientes atendidos (únicos): quem recuperou base, quem caiu.",
  preco: "Preço médio por produto: quem vende itens de maior valor.",
  itens: "Itens (unidades) vendidos: volume por consultor.",
  mix: "Positivação do mix (produtos distintos / total ativo): quem cobre mais do portfólio.",
  evolucao: "Evolução de desempenho: compare o MÊS ATUAL vs o MÊS ANTERIOR e vs o MELHOR MÊS — tanto a EQUIPE inteira quanto CADA consultor. Use o bloco 'evolucao' dos dados (equipe_por_mes, equipe_melhor_mes, consultores). Aponte quem acelerou/desacelerou, quem está no pico ou longe dele, o tamanho do movimento da equipe, e o que isso sugere de ação.",
  opp: "Oportunidades e conversões: taxa de conversão, quem converteu mais, alvos pendentes de maior valor.",
  novatos: "Perfil dos novatos: clientes novos vs reativados, faixas de inatividade, evolução semanal.",
};

// Calcula os agregados de evolução (equipe por mês + melhor mês + por consultor) para
// entregar números exatos à IA — mesma lógica da aba "Evolução" no front.
function buildEvolucao(dados: any) {
  const linhas: any[] = dados.linhas ?? [];
  const periodos: string[] = (dados.periodos ?? []).map((p: any) => p.label);
  const iAtual = periodos.length - 1, iAnt = iAtual - 1;
  const bestIdx = (vals: (number | null)[]) => { let bi = 0, bv = -Infinity; vals.forEach((v, i) => { if (v != null && v > bv) { bv = v; bi = i; } }); return bi; };
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const team = periodos.map((_: string, m: number) => {
    const sum = (f: (p: any) => number) => linhas.reduce((a: number, l: any) => a + (l.p[m] ? f(l.p[m]) : 0), 0);
    const bruto = sum((p) => p.bruto || 0), dev = sum((p) => p.dev || 0), liq = sum((p) => p.liq || 0);
    const clientes = sum((p) => p.clientes || 0), itens = sum((p) => p.itens || 0);
    return { mes: periodos[m], bruto: round2(bruto), dev: round2(dev), liq: round2(liq), clientes, itens, ticket: clientes ? round2(bruto / clientes) : null, preco: itens ? round2(bruto / itens) : null };
  });
  const teamBest = bestIdx(team.map((t: any) => t.liq));
  const consultores = linhas.map((l: any) => {
    const bi = l.novato ? iAtual : bestIdx(l.p.map((p: any) => p?.liq ?? null));
    return {
      nome: l.nome, novato: !!l.novato, meta: l.meta,
      liq_atual: l.p[iAtual]?.liq ?? 0,
      liq_anterior: l.novato ? null : (l.p[iAnt]?.liq ?? null),
      melhor_mes: l.novato ? null : periodos[bi],
      liq_melhor_mes: l.novato ? null : (l.p[bi]?.liq ?? null),
      no_pico: l.novato ? null : (bi === iAtual),
      clientes_atual: l.p[iAtual]?.clientes ?? 0,
      clientes_anterior: l.novato ? null : (l.p[iAnt]?.clientes ?? null),
    };
  });
  return { mes_atual: periodos[iAtual], mes_anterior: periodos[iAnt], equipe_por_mes: team, equipe_melhor_mes: periodos[teamBest], consultores };
}

// Ranking já ordenado do período de referência. Sem isso a IA erra a ordem — chegou a
// escrever "Milene liderou, seguida por Thamires" com a Thamires valendo mais.
function buildRanking(dados: any) {
  const linhas: any[] = dados.linhas ?? [];
  const i = (dados.periodos ?? []).length - 1;
  return linhas
    .map((l: any) => ({
      nome: l.nome, novato: !!l.novato,
      liq: l.p?.[i]?.liq ?? 0, meta: l.meta,
      pct_meta: l.meta ? Math.round(((l.p?.[i]?.liq ?? 0) / l.meta) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.liq - a.liq)
    .map((r, idx) => ({ posicao: idx + 1, ...r }));
}

Deno.serve(async (req) => {
  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthKey) return json({ error: "ANTHROPIC_API_KEY ausente no Supabase (Edge Functions → Secrets)" }, 500);

    let mes: string | null = null;
    try {
      const body = await req.json();
      if (body?.mes && /^\d{4}-\d{2}$/.test(body.mes)) mes = body.mes;
    } catch (_e) { /* body vazio = mês corrente */ }

    const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

    let dados: any;
    if (mes) {
      const { data, error } = await sb.rpc("is_dashboard_as_of", { p_mes: `${mes}-01` });
      if (error || !data) return json({ error: `is_dashboard_as_of falhou: ${error?.message}` }, 500);
      dados = data;
    } else {
      const { data: row, error } = await sb.from("is_dashboard").select("dados").eq("id", 1).single();
      if (error || !row?.dados) return json({ error: "is_dashboard.dados ausente" }, 500);
      dados = row.dados;
    }

    // injeta agregados prontos (evolução e ranking ordenado) para a IA usar números exatos
    const dadosAI = { ...dados, evolucao: buildEvolucao(dados), ranking: buildRanking(dados) };

    // mês encerrado não tem oportunidades/novatos — não peça análise dessas abas
    const abas: Record<string, string> = { ...ABAS };
    if (!dados.oportunidades) delete abas.opp;
    if (!dados.novatos) delete abas.novatos;
    const abasTxt = Object.entries(abas).map(([k, v]) => `- ${k}: ${v}`).join("\n");
    const formato = "{" + Object.keys(abas).map((k) => `"${k}":["...","..."]`).join(",") + "}";
    const sys = "Você é analista sênior de vendas da Murano Professional (distribuidora B2B de cosméticos, Belém/PA). Escreve análises curtas, executivas e acionáveis em português do Brasil para um dashboard de Inside Sales. Baseie-se ESTRITAMENTE nos números fornecidos — cite nomes de consultores e valores reais. Destaque a frase-chave de cada parágrafo com <strong>...</strong>. Não invente dados nem faça suposições além dos números. REGRA CRÍTICA: para qualquer afirmação de posição (quem lidera, quem vem em seguida, quem está por último) use EXCLUSIVAMENTE o bloco 'ranking' dos dados, que já vem ordenado do maior para o menor — nunca ordene por conta própria. Confira que o valor citado é coerente com a posição afirmada.";
    const ctx = mes
      ? `Este é um MÊS JÁ ENCERRADO (${dados.periodos?.[3]?.label ?? mes}) — os números são os resultados finais e fechados do mês. Escreva no passado, como um fechamento de mês, e não como acompanhamento em andamento.`
      : `O último período é o MÊS EM ANDAMENTO.`;
    const user = `Dados do dashboard em JSON. Os períodos comparados estão em 'periodos' (o último é o período de referência). ${ctx}\n\nPara CADA aba abaixo, escreva de 2 a 4 parágrafos curtos de análise; cada parágrafo começa com uma frase-chave entre <strong>...</strong>.\n\nEXCEÇÃO — a aba 'evolucao' deve ter o DOBRO de profundidade das outras: escreva de 5 a 8 parágrafos, cobrindo (a) a EQUIPE no período de referência vs o anterior, (b) a EQUIPE vs o melhor mês, e (c) destaques por CONSULTOR (quem acelerou, quem desacelerou, quem está no pico e quem está longe dele). Use o bloco 'evolucao' dos dados para os números.\n\nAbas:\n${abasTxt}\n\nResponda EXCLUSIVAMENTE com um objeto JSON válido no formato ${formato} — sem texto fora do JSON, sem crases.\n\nDADOS:\n${JSON.stringify(dadosAI)}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, system: sys, messages: [{ role: "user", content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) return json({ error: `Anthropic HTTP ${r.status}: ${JSON.stringify(j).slice(0, 400)}` }, 502);

    const txt = (j.content || []).map((b: any) => (b.type === "text" ? b.text : "")).join("");
    let narr: any;
    try {
      const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
      narr = JSON.parse(a >= 0 && b > a ? txt.slice(a, b + 1) : txt);
    } catch (_e) {
      return json({ error: "Resposta da IA não é JSON válido", amostra: txt.slice(0, 300) }, 502);
    }

    // cache por mês (o dropdown lê daqui); mês corrente também alimenta is_dashboard
    const mesRef = mes ?? String(dados.atualizado ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(mesRef)) {
      await sb.from("is_narrativas_mes")
        .upsert({ mes: `${mesRef}-01`, narrativas: narr, gerado_em: new Date().toISOString() }, { onConflict: "mes" });
    }
    if (!mes) await sb.from("is_dashboard").update({ narrativas: narr }).eq("id", 1);

    return json({ ok: true, model: MODEL, mes: mesRef, abas: Object.keys(narr), tokens: j.usage });
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
