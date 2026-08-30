// -----------------------------------------------------------------------------
// Ciclo 3 — disparo em massa, do template à resposta.
//
// ⚠️ ENVIAR É PROIBIDO (§0). Este caso usa SÓ a prévia
// (`POST /api/admin/disparo-massa` com `acao: "previa"`), que não manda nada:
// ela escolhe e explica o público. Dá para validar público, cortes, ranking e o
// corte `numero_morto` sem uma mensagem sequer. Paro antes do botão de confirmar.
// -----------------------------------------------------------------------------
import { modoMigracaoDe } from "../ajuda.mjs";

export const ciclo = "Ciclo 3 — disparo em massa (SÓ PRÉVIA — enviar é proibido)";

const previa = (api, filtros, sessao) =>
  api.post("/api/admin/disparo-massa", { acao: "previa", filtros }, sessao ?? api.SESSOES.admin);

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(ciclo inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  let cfgDisparo = null;

  // ---------------------------------------------------------------- passos 1-2
  await t.passo("1-2. consultar templates e o status de aprovação de cada um", "✅", async () => {
    const r = await api.get("/api/admin/disparo-massa", api.SESSOES.admin);
    api.status(r, 200, "GET /api/admin/disparo-massa");
    // ⚠️ a resposta vem ANINHADA em "disparo-massa" (a tela do /admin monta as
    // abas por chave). Ler `r.json.templates` devolve undefined em silêncio — foi
    // o que fez este teste acusar "nenhum template" com 4 aprovados no banco.
    cfgDisparo = r.json?.["disparo-massa"] ?? {};
    const tpls = cfgDisparo.templates ?? [];
    api.ok(tpls.length > 0, "nenhum template disponível para campanha");
    // §26.3: a entrada sintética "Padrão do sistema" tem de existir, senão a
    // tela não consegue fazer o que o board fazia.
    // ⚠️ CORRIGIDO EM 30/08/2026: esta linha exigia a opção sempre, e reprovava.
    // Não era defeito — a rota a esconde de propósito com o MODO MIGRAÇÃO ligado
    // (§44/§45): oferecer o template do painel do RD numa tela que não nomeia
    // mais o RD, e cujo envio já vai para a Cloud, seria prometer alcance que
    // ela não tem. A regra do teste passa a ser condicional, como a do app.
    const cfgMig = modoMigracaoDe(await db.lerConfig());
    const temPadrao = tpls.some((x) => Number(x.id) === 0);
    if (cfgMig) {
      api.ok(!temPadrao, "modo migração ligado, mas `Padrão do sistema` (id 0) ainda aparece — a tela nomearia o RD");
    } else {
      api.ok(temPadrao, "a opção sintética `Padrão do sistema` (id 0) sumiu — §26.3");
    }
    // Cloud só entra se a Meta aprovou; senão o envio falharia com 132001.
    const cloudNaoAprovado = tpls.filter((x) => x.canal === "cloud" && String(x.status ?? "").toUpperCase() !== "APPROVED");
    api.igual(cloudNaoAprovado.length, 0,
      `template Cloud não aprovado oferecido para campanha: ${cloudNaoAprovado.map((x) => x.nome).join(", ")} — daria 132001 na cara da cliente`);
    return tpls.map((x) => `${x.nome} [${x.canal}${x.status ? " " + x.status : ""}${x.padrao ? " ★" : ""}]`).join(" · ");
  });

  // ------------------------------------------------------------------ passo 3
  await t.passo("3. montar o público por segmento (carteira, etapa, tempo parado)", "✅", async () => {
    const r = await previa(api, { carteiras: ["romulo"], diasMin: 0, diasRecontato: 4, limite: 20 });
    api.status(r, 200, "prévia por carteira");
    const j = r.json ?? {};
    // a lista do público chama-se `selecionados` (não `publico`) — ler a chave
    // errada devolve [] e o teste passaria sem testar nada
    const pub = j.selecionados ?? [];
    api.ok(Array.isArray(pub), `a prévia não devolveu \`selecionados\`: ${Object.keys(j).join(", ")}`);
    api.ok(pub.length > 0, `a prévia devolveu público VAZIO para a carteira romulo (total=${j.total}) — ` +
      `com ${JSON.stringify(j.cortes)} de cortes, nenhuma campanha seria possível`);
    api.ok(pub.length <= 20, `o limite pedido era 20 e vieram ${pub.length}`);
    const fora = pub.filter((c) => c.vendedor && c.vendedor !== "romulo");
    api.igual(fora.length, 0, `o filtro por carteira vazou: ${fora.slice(0, 3).map((c) => c.vendedor).join(", ")}`);
    return `${pub.length} selecionados de ${j.total} · cortes: ${JSON.stringify(j.cortes)}`;
  });

  // ------------------------------------------------------------------ passo 4
  await t.passo("4. o sistema corta quem já está em conversa ativa", "✅", async () => {
    // `diasMin` é o "tempo parado": com 30, quem falou nos últimos 30 dias sai
    // por `ativo_demais`. É o corte que evita reabordar quem já está falando.
    const r = await previa(api, { carteiras: [], diasMin: 30, diasRecontato: 4, limite: 50 });
    api.status(r, 200, "prévia com tempo parado de 30 dias");
    const cortes = r.json?.cortes ?? {};
    api.ok("ativo_demais" in cortes, `o motivo de corte \`ativo_demais\` sumiu — motivos: ${Object.keys(cortes).join(", ")}`);
    return Object.entries(cortes).map(([k, v]) => `${k} ${v}`).join(" · ");
  });

  // ------------------------------------------------------------------ passo 5
  await t.passo("5. o sistema corta quem falhou em disparo anterior", "⛔ (o doc diz que não existe)", async () => {
    // §61: implementado como corte `numero_morto`. O documento está DESATUALIZADO.
    const r = await previa(api, { carteiras: [], diasMin: 0, diasRecontato: 0, limite: 50 });
    api.status(r, 200, "prévia");
    const cortes = r.json?.cortes ?? {};
    api.ok("numero_morto" in cortes,
      `o corte \`numero_morto\` não existe na resposta — motivos: ${Object.keys(cortes).join(", ")}`);

    // e a régua é a certa: só falha DO NÚMERO, não janela fechada nem erro nosso
    const { data: falhas } = await db.sb.from("mensagens")
      .select("erro").eq("status", "failed").not("erro", "is", null).limit(200);
    const cods = {};
    for (const f of falhas ?? []) {
      const m = /\b(1310\d\d|1311\d\d)\b/.exec(String(f.erro));
      if (m) cods[m[1]] = (cods[m[1]] ?? 0) + 1;
    }
    return `corte \`numero_morto\` presente (valor ${cortes.numero_morto}). ` +
      `Códigos de falha no banco: ${Object.entries(cods).map(([c, n]) => `${c}×${n}`).join(", ") || "nenhum"}. ` +
      `⚠️ O documento marca este passo como ⛔ e ele FUNCIONA — desatualizado (§61).`;
  });

  // ------------------------------------------------------------------ passo 6
  await t.passo("6. variável de texto livre da campanha", "✅", async () => {
    const tpls = cfgDisparo?.templates ?? [];
    api.ok(tpls.length > 0, "sem templates carregados no passo 1-2, este passo não mede nada");
    const comCampos = tpls.filter((x) => Array.isArray(x.campos) && x.campos.length > 0);
    // §26.5: campos de {{2}} em diante são pedidos uma vez para a campanha
    return comCampos.length
      ? `templates que pedem campo da campanha: ${comCampos.map((x) => `${x.nome} (${x.campos.length})`).join(", ")}`
      : "nenhum template com campo além de {{1}} hoje — o nome sozinho é preenchido pelo servidor";
  });

  // ---------------------------------------------------------------- passos 7-8
  t.pular("7-8. rodar o disparo / fechar a aba no meio", "✅",
    "RECUSADO por segurança (§0): enviar é proibido. Cada template é cobrado e vai para clientes reais. " +
    "Parei na prévia, que é onde mora toda a decisão de público.");

  // ------------------------------------------------------------------ passo 9
  await t.passo("9. agendar o disparo para amanhã", "⛔", async () => {
    const r = await api.post("/api/admin/disparo-massa",
      { acao: "agendar", quando: "2026-08-28T08:00:00-03:00", filtros: {} }, api.SESSOES.admin);
    api.status(r, 400, "ação de agendamento deveria ser desconhecida");
    return `confirmado ⛔: a rota só aceita \`previa\` (HTTP ${r.status} para \`agendar\`). ` +
      `O laço de envio roda no navegador (§26.2), então agendar exige mover o envio para o servidor.`;
  });

  // --------------------------------------------------------------- passos 10-11
  await t.passo("10-11. taxa de resposta e entregue/lido por campanha", "⛔", async () => {
    const r = await api.get("/api/admin/campanhas?dias=30", api.SESSOES.admin);
    api.status(r, 200, "GET /api/admin/campanhas");
    const c = r.json?.campanhas ?? {};
    if (c.indisponivel) {
      return `⚠️ MUDANÇA DE ESTADO: a tela existe (rota /api/admin/campanhas, nova), mas responde ` +
        `\`indisponivel\` porque a migration 0114 não está aplicada. Motivo: ${String(c.motivo).slice(0, 90)}. ` +
        `Ou seja: deixou de ser "não existe" e passou a ser "existe e está sem os objetos do banco".`;
    }
    api.ok(Array.isArray(c.linhas), "a resposta não traz `linhas`");
    const tot = c.total ?? {};
    return `campanhas: ${c.linhas.length} template(s) · enviados ${tot.enviados} · entregues ${tot.entregues} · ` +
      `lidos ${tot.lidos} · responderam ${tot.responderam} · taxa ${tot.taxa_resposta}%`;
  });
}
