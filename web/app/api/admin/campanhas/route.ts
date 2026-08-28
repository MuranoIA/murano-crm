import { sbAdmin, guardaAdmin } from "../../../../lib/adminApi";
import { lerCrmConfig, linhasVisiveis } from "../../../../lib/crmConfig";
import { traduzErroMeta, codigoMeta } from "../../../../lib/erroMeta";

export const dynamic = "force-dynamic";

// Desempenho dos templates disparados — itens 1 e 4 do checklist (§54).
//
// A pergunta que isto responde, e que o CRM não conseguia responder:
// **este template presta?**
//
// A tela de Sugestões (0110) pede ao admin que aprove ou recuse o texto que uma
// consultora escreveu. Até aqui ele decidia no olho. Sem separar "não chegou"
// de "chegou e não interessou", um template ruim e um número errado produzem o
// mesmo silêncio — e a conclusão que se tira dos dois é oposta.
//
// Por isso as duas metades vêm juntas, da mesma view:
//
//   ENTREGA   a Meta aceitou? chegou? foi lida? falhou por quê?   (item 4)
//   RESPOSTA  a cliente falou depois?                             (item 1)
//
// ⚠️ A taxa de resposta é calculada sobre os ENTREGUES, não sobre os enviados.
// Template que nem chegou não teve chance de ser respondido; contá-lo no
// denominador faria um problema de número virar culpa do texto — exatamente a
// confusão que esta tela existe para desfazer.

const JANELAS = [7, 15, 30, 90] as const;

/** Entrega considerada bem-sucedida. `read` implica entregue. */
const CHEGOU = new Set(["success", "read", "checked", "delivered"]);

export async function GET(req: Request) {
  const g = guardaAdmin("ver o desempenho dos templates");
  if (g.erro) return g.erro;

  const q = new URL(req.url).searchParams;
  const dias = JANELAS.includes(Number(q.get("dias")) as any) ? Number(q.get("dias")) : 30;
  // Horas dentro das quais uma fala da cliente conta como resposta AO template.
  // Fora disso ela respondeu a outra coisa — o passar do tempo não pode virar
  // crédito do template.
  const horas = Math.min(168, Math.max(1, Number(q.get("horas") ?? 48) || 48));

  const db = sbAdmin();
  const cfg = await lerCrmConfig(db);
  const soCloud = !linhasVisiveis(cfg).includes("rd");

  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();

  let sel = db.from("vw_disparo_desfecho")
    .select("id,template_id,vendedor,criada_em,entrega,erro,horas_ate_resposta")
    .gte("criada_em", desde)
    .limit(20000);
  // O discriminador de canal é o próprio id: o ramo Cloud do send-template
  // grava o wamid da Meta; o do RD, o id do painel deles.
  if (soCloud) sel = sel.like("id", "wamid.%");

  const { data, error } = await sel;
  if (error) {
    // A view nasce na 0114. Antes dela a tela mostra o aviso, não um 500.
    return Response.json({ campanhas: { indisponivel: true, motivo: error.message, dias, horas } });
  }

  // nome legível do template: `template_id` é o nome aprovado na Meta (Cloud) ou
  // o id do painel (RD) — nenhum dos dois é o que o admin cadastrou
  const { data: tpls } = await db.from("crm_templates").select("nome,meta_nome,rd_template_id,corpo,canal");
  const nomeDe = new Map<string, { nome: string; corpo: string | null }>();
  for (const t of tpls ?? []) {
    const chave = t.canal === "cloud" ? t.meta_nome : t.rd_template_id;
    if (chave) nomeDe.set(String(chave), { nome: String(t.nome ?? chave), corpo: t.corpo ?? null });
  }

  type Linha = {
    template_id: string; nome: string; corpo: string | null;
    enviados: number; entregues: number; lidos: number; falharam: number; sem_recibo: number;
    responderam: number; horas: number[];
    erros: Record<string, number>;
  };
  const porTpl = new Map<string, Linha>();
  const total: Linha = {
    template_id: "", nome: "", corpo: null,
    enviados: 0, entregues: 0, lidos: 0, falharam: 0, sem_recibo: 0,
    responderam: 0, horas: [], erros: {},
  };

  const conta = (l: Linha, d: any) => {
    l.enviados++;
    const e = String(d.entrega ?? "");
    if (e === "failed") {
      l.falharam++;
      const cod = codigoMeta(d.erro) ?? "sem_codigo";
      l.erros[cod] = (l.erros[cod] ?? 0) + 1;
    } else if (CHEGOU.has(e)) {
      l.entregues++;
      if (e === "read") l.lidos++;
    } else {
      // `wait` (recibo não voltou) ou nulo (o join por id não achou). São
      // coisas diferentes da falha e da entrega: contá-los como entregues
      // afundaria a taxa de resposta; como falha, inventaria um problema.
      l.sem_recibo++;
    }
    const h = d.horas_ate_resposta == null ? null : Number(d.horas_ate_resposta);
    if (h != null && h <= horas) { l.responderam++; l.horas.push(h); }
  };

  for (const d of data ?? []) {
    const k = String(d.template_id ?? "—");
    let l = porTpl.get(k);
    if (!l) {
      const meta = nomeDe.get(k);
      l = {
        template_id: k, nome: meta?.nome ?? k, corpo: meta?.corpo ?? null,
        enviados: 0, entregues: 0, lidos: 0, falharam: 0, sem_recibo: 0,
        responderam: 0, horas: [], erros: {},
      };
      porTpl.set(k, l);
    }
    conta(l, d);
    conta(total, d);
  }

  const mediana = (ns: number[]) => {
    if (!ns.length) return null;
    const s = [...ns].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
  };

  const fmt = (l: Linha) => ({
    template_id: l.template_id,
    nome: l.nome,
    corpo: l.corpo,
    enviados: l.enviados,
    entregues: l.entregues,
    lidos: l.lidos,
    falharam: l.falharam,
    sem_recibo: l.sem_recibo,
    responderam: l.responderam,
    // sobre os ENTREGUES — ver a nota do topo
    taxa_resposta: l.entregues ? Math.round((100 * l.responderam) / l.entregues) : null,
    mediana_horas: mediana(l.horas),
    // as falhas agrupadas e traduzidas: é o que diz se o problema é do texto ou
    // dos números da lista
    erros: Object.entries(l.erros)
      .sort((a, b) => b[1] - a[1])
      .map(([cod, n]) => ({
        codigo: cod,
        n,
        texto: cod === "sem_codigo" ? "sem código da Meta" : traduzErroMeta(`Meta ${cod}`).texto,
      })),
  });

  const campanhas = [...porTpl.values()].sort((a, b) => b.enviados - a.enviados).map(fmt);

  return Response.json({
    campanhas: {
      dias, horas, so_cloud: soCloud,
      linhas: campanhas,
      total: fmt(total),
      janelas: JANELAS,
    },
  });
}
