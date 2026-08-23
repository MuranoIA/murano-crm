import { sbAdmin, guardaAdmin } from "../../../../lib/adminApi";

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
  const [saiuRes, crmRes] = await Promise.all([
    db.from("vw_templates_diario").select("vendedor,dia,templates_enviados").gte("dia", desde),
    db.from("vw_templates_auto_diario").select("vendedor,dia,templates_automaticos").gte("dia", desde),
  ]);
  if (saiuRes.error) return Response.json({ error: saiuRes.error.message }, { status: 500 });
  if (crmRes.error) return Response.json({ error: crmRes.error.message }, { status: 500 });

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
  for (const r of saiuRes.data ?? []) somar(saiu, String(r.vendedor ?? "—"), String(r.dia), Number(r.templates_enviados ?? 0));
  for (const r of crmRes.data ?? []) somar(crm, String(r.vendedor ?? "—"), String(r.dia), Number(r.templates_automaticos ?? 0));

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
      // a janela real coberta, para a tela não prometer mais do que tem
      desde,
    },
  });
}
