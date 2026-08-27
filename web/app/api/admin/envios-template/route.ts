import { sbAdmin, guardaAdmin } from "../../../../lib/adminApi";
import { lerCrmConfig, linhasVisiveis, filtroLinhas } from "../../../../lib/crmConfig";

export const dynamic = "force-dynamic";

// Quantos templates saíram, e por qual caminho.
//
// Estes dois números viviam como duas pastilhas no cabeçalho do board —
// "Templates 2733" e "Automáticos 94" — sem nada que dissesse o que eram. Os
// rótulos, aliás, enganavam: nada ali é "automático". Vieram para cá para poder
// ser explicados.
//
// | pastilha antiga | view | o que É de verdade |
// |---|---|---|
// | Templates | `vw_templates_diario` | mensagens `tipo='template'` de operador — **todo** template que chegou à conversa, tenha saído daqui ou do painel do RD |
// | Automáticos | `vw_templates_auto_diario` | linhas de `disparos_template` — só os que **saíram do CRM** (botão do card, chat, disparo em massa) |
//
// A diferença entre os dois é, portanto, o que a equipe disparou **pelo painel
// do RD**, fora do nosso sistema. É a informação mais útil das duas e era
// justamente a que ninguém conseguia ler no board.
//
// ⚠️ ...e essa moldura MORRE quando o RD sai de vista. Duas razões, e a segunda
// é a que decide:
//
// 1. `vw_templates_diario` varre `mensagens` inteira, sem olhar `linha_id` —
//    medido em 27/08: **3.707 templates no mês, 33 pelo nosso número**. Com a
//    chave de migração ligada, a tela mostrava 3.676 disparos do painel do RD
//    numa tela que deveria estar cega para ele.
// 2. **No nosso número a comparação não pode existir.** A WABA é nossa, o token
//    é nosso, não há BSP nem painel de terceiro: todo template que sai por ali
//    saiu por este CRM (o ramo Cloud do `send-template` grava nas duas fontes).
//    A subtração é estruturalmente zero — mostrá-la é oferecer uma pergunta que
//    já tem resposta.
//
// Então: com o RD visível, seguem os dois números e a diferença. Sem ele, vira
// **um número só**, contado direto de `mensagens` com o filtro de linha.

/** Dia em Brasília (BRT, UTC-3), `offset` dias atrás. */
const diaBRT = (offset = 0) =>
  new Date(Date.now() - 3 * 3600_000 - offset * 86_400_000).toISOString().slice(0, 10);

type Tot = { hoje: number; ontem: number; semana: number; quinzena: number; mes: number };
const zero = (): Tot => ({ hoje: 0, ontem: 0, semana: 0, quinzena: 0, mes: 0 });

export async function GET() {
  const g = guardaAdmin("ver os envios de template");
  if (g.erro) return g.erro;

  const hoje = diaBRT(0), ontem = diaBRT(1);
  const d7 = diaBRT(6), d15 = diaBRT(14);
  const mesIni = hoje.slice(0, 8) + "01";
  // 31 dias cobre o maior balde (mês corrente) em qualquer dia do mês
  const desde = diaBRT(31);

  const db = sbAdmin();
  const cfg = await lerCrmConfig(db);
  const comRd = linhasVisiveis(cfg).includes("rd");

  // Baldes CUMULATIVOS (semana inclui hoje, mês inclui a semana) — é como o
  // board sempre contou, e trocar isso agora faria os números "mudarem" sem
  // nada ter mudado na operação.
  const somar = (acc: Map<string, Tot>, vend: string, dia: string, n: number) => {
    const a = acc.get(vend) ?? zero();
    if (dia === hoje) a.hoje += n;
    if (dia === ontem) a.ontem += n;
    if (dia >= d7) a.semana += n;
    if (dia >= d15) a.quinzena += n;
    if (dia >= mesIni) a.mes += n;
    acc.set(vend, a);
  };

  const saiu = new Map<string, Tot>(), crm = new Map<string, Tot>();

  if (comRd) {
    // as views são pré-agregadas — varrer as ~94 mil mensagens do RD a cada
    // abertura da tela seria caro sem ganho nenhum
    const [saiuRes, crmRes] = await Promise.all([
      db.from("vw_templates_diario").select("vendedor,dia,templates_enviados").gte("dia", desde),
      db.from("vw_templates_auto_diario").select("vendedor,dia,templates_automaticos").gte("dia", desde),
    ]);
    if (saiuRes.error) return Response.json({ error: saiuRes.error.message }, { status: 500 });
    if (crmRes.error) return Response.json({ error: crmRes.error.message }, { status: 500 });
    for (const r of saiuRes.data ?? []) somar(saiu, String(r.vendedor ?? "—"), String(r.dia), Number(r.templates_enviados ?? 0));
    for (const r of crmRes.data ?? []) somar(crm, String(r.vendedor ?? "—"), String(r.dia), Number(r.templates_automaticos ?? 0));
  } else {
    // sem o RD sobram dezenas de linhas, não dezenas de milhares: dá para
    // contar direto e aplicar o mesmo filtro de linha do resto do sistema.
    let q = db.from("mensagens")
      .select("vendedor_carteira,criada_em")
      .eq("tipo", "template").eq("enviada_por", "operator")
      .gte("criada_em", desde).limit(5000);
    q = filtroLinhas(q, cfg);
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    for (const m of data ?? []) {
      // o dia tem de ser o de Brasília, como nas views — senão o balde "hoje"
      // troca de dono às 21h e ninguém entende por que o número recuou
      const dia = new Date(new Date(String(m.criada_em)).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
      somar(saiu, String(m.vendedor_carteira ?? "—"), dia, 1);
    }
  }

  const vendedores = [...new Set([...saiu.keys(), ...crm.keys()])].sort();
  const linhas = vendedores.map((v) => ({ vendedor: v, saiu: saiu.get(v) ?? zero(), crm: crm.get(v) ?? zero() }));

  const total = (m: Map<string, Tot>): Tot => {
    const t = zero();
    for (const v of m.values()) {
      t.hoje += v.hoje; t.ontem += v.ontem; t.semana += v.semana; t.quinzena += v.quinzena; t.mes += v.mes;
    }
    return t;
  };

  return Response.json({
    "envios-template": {
      linhas,
      total: { saiu: total(saiu), crm: total(crm) },
      // a tela usa isto para decidir entre a comparação e o número único
      com_rd: comRd,
      // a janela real coberta, para a tela não prometer mais do que tem
      desde,
    },
  });
}
