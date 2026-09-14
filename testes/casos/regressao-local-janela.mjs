// -----------------------------------------------------------------------------
// Regressão — localização fora da janela de 24h é recusada NA HORA, com motivo.
//
// Relatado em 12/09/2026: "envio de localização não está funcionando". No banco,
// **12 tentativas naquele dia, entre 13:46 e 14:59, todas para a mesma cliente,
// todas `failed` com Meta 131047** — a janela de 24h estava fechada.
//
// O envio não estava quebrado. O defeito era a rota deixar clicar: ela
// respondia `ok`, a Meta ACEITAVA a chamada (devolvendo um `wamid` de verdade)
// e a falha só voltava minutos depois pelo webhook. Duas daquelas tentativas
// seguem presas em `status: "wait"` até hoje, sem recibo nenhum.
//
// ⚠️ Por isso a guarda tinha de ser PROATIVA. Tratar `e.foraDaJanela` no
// `catch`, como as rotas irmãs fazem, NÃO pega este caso: não há exceção para
// pegar quando a Meta aceita e falha depois.
//
// ⚠️ Este caso ENVELHECE a mensagem da cliente de ensaio de propósito — é a
// única forma de exercitar a janela fechada sem esperar um dia. Mexe só na
// faixa reservada do ensaio, que nunca chega à Meta, e desfaz no fim.
// -----------------------------------------------------------------------------
import { clienteEscreve, idFicticio, resolverLinha, limparEnsaio } from "../simulacao.mjs";

export const ciclo = "Regressão — localização respeita a janela de 24h";

/** Fora da faixa dos outros casos, para duas suítes não brigarem. */
const N = 97;

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  const ID = idFicticio(N);
  await resolverLinha(db);

  await t.passo("1. a cliente escreve — a janela abre", "✅", async () => {
    const r = await clienteEscreve(N, "[QA] qual é o endereço da loja?", `Cliente Ensaio ${N}`);
    api.igual(r.status, 200, "webhook da cliente de ensaio");
    db.anotarRastro(`ensaio ${ID}`, async () => { await limparEnsaio(db.sb); });
    return ID;
  });

  await t.passo("2. com a janela ABERTA, a localização sai", "✅", async () => {
    const cfg = await db.sb.from("crm_config").select("locais").eq("id", 1).maybeSingle();
    const locais = (cfg.data?.locais ?? []);
    if (!Array.isArray(locais) || !locais.length) {
      throw new Error("PULAR:nenhum endereço cadastrado em /admin → Mecanismos");
    }
    const r = await api.chamar("/api/chat/localizacao", {
      metodo: "POST", sessao: api.SESSOES.admin, corpo: { cliente_id: ID, local: 0 },
    });
    api.status(r, 200, "POST localização com a janela aberta");
    api.ok(r.json?.ok, `esperava ok:true, veio ${JSON.stringify(r.json).slice(0, 160)}`);
    return `enviada para "${r.json?.local}"`;
  });

  await t.passo("3. com a janela FECHADA, recusa na hora e diz o motivo", "✅", async () => {
    // Envelhece a fala da cliente em 25h. É o que a Meta enxergaria.
    const ontem = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const { error } = await db.sb.from("mensagens")
      .update({ criada_em: ontem })
      .eq("cliente_id", ID).eq("enviada_por", "customer");
    api.ok(!error, `não consegui envelhecer a mensagem: ${error?.message}`);

    const r = await api.chamar("/api/chat/localizacao", {
      metodo: "POST", sessao: api.SESSOES.admin, corpo: { cliente_id: ID, local: 0 },
    });
    api.igual(r.status, 422, `esperava 422 (fora da janela), veio ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    api.ok(r.json?.foraDaJanela === true, "a resposta deveria marcar `foraDaJanela: true`");
    api.ok(/24h|24 h/i.test(String(r.json?.error ?? "")),
      `o recado deveria nomear a janela: "${r.json?.error}"`);
    api.ok(/TEMPLATE/i.test(String(r.json?.error ?? "")),
      `o recado deveria dizer a SAÍDA (template): "${r.json?.error}"`);

    // e o PEDIDO de localização segue a mesma régua
    const p = await api.chamar("/api/chat/localizacao", {
      metodo: "POST", sessao: api.SESSOES.admin, corpo: { cliente_id: ID, pedir: true },
    });
    api.igual(p.status, 422, `o pedido de localização deveria recusar igual, veio ${p.status}`);
    api.ok(p.json?.foraDaJanela === true, "o pedido também deveria marcar `foraDaJanela: true`");

    return `422 nos dois caminhos · "${String(r.json?.error).slice(0, 80)}…"`;
  });

  await t.passo("4. nada ficou pendurado em `wait` por causa da recusa", "✅", async () => {
    // A recusa acontece ANTES de falar com a Meta, então não pode ter nascido
    // linha nenhuma — era justamente o sintoma do relato: mensagem espelhada,
    // enviada, e presa em `wait` para sempre.
    const { data } = await db.sb.from("mensagens")
      .select("id,status,conteudo").eq("cliente_id", ID).eq("enviada_por", "operator");
    const presas = (data ?? []).filter((m) => m.status === "wait" && String(m.conteudo).startsWith("📍"));
    // a do passo 2 (janela aberta) é legítima e pode estar em `wait` — o recibo
    // do ensaio não volta. O que não pode é ter MAIS de uma.
    api.ok(presas.length <= 1,
      `${presas.length} localizações presas em wait — a recusa não deveria espelhar nada`);
    return `${(data ?? []).length} envio(s) no total, ${presas.length} em wait`;
  });

  await t.passo("5. a faixa de ensaio sai do banco", "✅", async () => {
    return (await limparEnsaio(db.sb)).join(" · ");
  });
}
