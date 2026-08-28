// -----------------------------------------------------------------------------
// Ciclo 0 — fundação. Não está no `casos_de_uso_teste_ciclos.md`: é o chão em
// que os outros oito pisam. Se um destes passos falha, o resultado dos demais
// não quer dizer nada.
//
// Mede também o ESTADO DOS INTERRUPTORES, porque quase toda regra deste CRM é
// função deles (§44/§45): a mesma tela responde coisas diferentes com o modo
// migração ligado ou desligado, e um relatório que não diz em que posição as
// chaves estavam é um relatório sem sentido.
// -----------------------------------------------------------------------------
import { modoMigracaoDe } from "../ajuda.mjs";

export const ciclo = "Ciclo 0 — fundação (plataforma, config e sessões)";

export default async function (t) {
  const { db, api } = t;

  await t.passo("banco responde e as tabelas centrais existem", "✅", async () => {
    const n = {
      clientes: await db.contar("clientes"),
      mensagens: await db.contar("mensagens"),
      disparos: await db.contar("disparos_template"),
    };
    api.ok(n.clientes > 0 && n.mensagens > 0, `contagens suspeitas: ${JSON.stringify(n)}`);
    return `clientes ${n.clientes} · mensagens ${n.mensagens} · disparos ${n.disparos}`;
  });

  await t.passo("`contar` não devolve zero silencioso para relação inexistente", "✅", async () => {
    // O teste do próprio instrumento (§4.6 da definição: um teste que passa de
    // primeira é suspeito — este é o que prova que ele falha quando deve).
    // Medido em 27/08: com `head:true`, supabase-js devolve `error: null` e
    // `count: null` para tabela que não existe. `?? 0` ali vira zero silencioso.
    let lancou = false;
    try { await db.contar("tabela_que_nao_existe_zzz"); } catch { lancou = true; }
    api.ok(lancou, "contar() devolveu número para uma tabela inexistente — o instrumento mente");
    return "confirmado: relação inexistente lança, não devolve 0";
  });

  await t.passo("estado dos interruptores (crm_config) registrado", "✅", async () => {
    const c = await db.lerConfig();
    api.ok(c, "crm_config id=1 não existe");
    t.config = c;
    const mm = modoMigracaoDe(c);
    return [
      `ciclo_ativo=${c.ciclo_ativo} · numero_envio=${c.numero_envio} · historico_rd=${c.historico_rd}`,
      `carteira_rd_ativa=${c.carteira_rd_ativa} · linhas_visiveis=${JSON.stringify(c.linhas_visiveis)}`,
      `sla_minutos=${"sla_minutos" in c ? c.sla_minutos : "(coluna ausente — 0114 não aplicada)"}`,
      `MODO MIGRAÇÃO: ${mm ? "LIGADO" : "desligado"}`,
    ].join("\n");
  });

  await t.passo("migration 0114 — objetos no banco batem com o código em disco", "✅", async () => {
    const alvos = ["vw_disparo_desfecho", "chat_resolucao", "vw_chat_resolucao", "vw_chat_espera"];
    const faltando = [];
    for (const a of alvos) if (!(await db.existe(a)).ok) faltando.push(a);
    const temCol = "sla_minutos" in ((await db.lerConfig()) ?? {});
    api.ok(
      faltando.length === 0 && temCol,
      `a 0114 está em disco (supabase/migrations/0114_*.sql) e o código a referencia, mas o banco não tem: ` +
      `${faltando.join(", ")}${temCol ? "" : `${faltando.length ? " + " : ""}crm_config.sla_minutos`}. ` +
      `Enquanto isso, tempo de resolução, alerta de SLA e desempenho de campanha não produzem número.`,
    );
    return "0114 aplicada";
  });

  await t.passo("linhas de WhatsApp cadastradas (chat_linha)", "✅", async () => {
    const { data, error } = await db.sb.from("chat_linha").select("phone_number_id,rotulo,numero,ativo").order("rotulo");
    api.ok(!error, error?.message);
    const ativas = data.filter((l) => l.ativo);
    api.ok(ativas.length > 0, "nenhuma linha ativa");
    return data.map((l) => `${l.ativo ? "ativa " : "inativa"} ${l.phone_number_id} · ${l.rotulo} · ${l.numero ?? "—"}`).join("\n");
  });

  await t.passo("carteiras ativas (carteira_config é a fonte única, §14.1)", "✅", async () => {
    const { data, error } = await db.sb.from("carteira_config").select('slug,rca_num,"time",ativo').eq("ativo", true).order("slug");
    api.ok(!error, error?.message);
    api.ok(data.length > 0, "nenhuma carteira ativa");
    api.ok(data.some((c) => c.slug === "romulo"), "a carteira `romulo`, usada como sessão de teste, não está ativa");
    return data.map((c) => `${c.slug} (RCA ${c.rca_num}, ${c.time})`).join(" · ");
  });

  // -- daqui para baixo precisa do servidor ---------------------------------
  const exigeServidor = () => { if (!t.servidorNoAr) throw new Error(`PULAR:servidor fora do ar em ${api.BASE}`); };

  await t.passo("servidor no ar e /api/chat responde ao consultor", "✅", async () => {
    exigeServidor();
    const r = await api.get("/api/chat", api.SESSOES.romulo);
    api.status(r, 200, "GET /api/chat como romulo");
    api.ok(Array.isArray(r.json?.conversas), "resposta sem `conversas`");
    return `${r.json.conversas.length} conversas · ${r.ms} ms · layout=${r.json.layout ?? "?"} · modo_migracao=${r.json.modo_migracao}`;
  });

  await t.passo("sem cookie de sessão a rota do chat NÃO entrega dado", "✅", async () => {
    exigeServidor();
    const r = await api.get("/api/chat", api.SESSOES.anonimo);
    api.ok(r.status === 401 || r.status === 403,
      `esperado 401/403 sem sessão, veio ${r.status} — ${(r.texto ?? "").slice(0, 200)}`);
    return `HTTP ${r.status}`;
  });

  await t.passo("escopo por carteira: o consultor não vê a lista do admin", "✅", async () => {
    exigeServidor();
    const [rv, ra] = await Promise.all([
      api.get("/api/chat", api.SESSOES.romulo),
      api.get("/api/chat", api.SESSOES.admin),
    ]);
    api.status(rv, 200, "chat como romulo");
    api.status(ra, 200, "chat como admin");
    const v = rv.json.conversas.length, a = ra.json.conversas.length;
    api.ok(v <= a, `consultor (${v}) vendo MAIS que o admin (${a}) — escopo invertido`);
    const donos = new Set(rv.json.conversas.map((c) => c.vendedor));
    const alheias = [...donos].filter((d) => d && d !== "romulo");
    api.ok(alheias.length === 0, `consultor vendo conversa de outra carteira: ${alheias.join(", ")}`);
    return `romulo ${v} · admin ${a} · carteiras na lista do consultor: ${[...donos].map((d) => d ?? "(fila)").join(", ")}`;
  });

  await t.passo("as 4 features restritas exigem admin (podeAdmin)", "✅", async () => {
    exigeServidor();
    const r = await api.get("/api/admin/disparo-massa", api.SESSOES.romulo);
    api.ok(r.status === 403 || r.status === 401,
      `disparo em massa aberto ao consultor: HTTP ${r.status}`);
    const rh = await api.get("/api/admin/disparo-massa", api.SESSOES.home);
    api.ok(rh.status === 403 || rh.status === 401,
      `disparo em massa aberto ao papel home: HTTP ${rh.status}`);
    const ra = await api.get("/api/admin/disparo-massa", api.SESSOES.admin);
    api.status(ra, 200, "disparo em massa como admin");
    return `consultor ${r.status} · home ${rh.status} · admin ${ra.status}`;
  });
}
