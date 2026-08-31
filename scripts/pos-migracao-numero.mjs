// -----------------------------------------------------------------------------
// Depois de migrar um número para a nossa WABA: põe o CRM em dia.
//
//     node scripts/pos-migracao-numero.mjs <phone_number_id> "<+55 91 ...>" "<rótulo>"
//     node scripts/pos-migracao-numero.mjs <phone_number_id> --conferir
//
// POR QUE ISTO EXISTE: `crm_config.linhas_visiveis` é uma LISTA FIXA. Um número
// que não está nela não aparece no board nem no chat — as conversas entram no
// banco normalmente e ninguém as vê. Sem erro, sem log, sem nada na tela. É o
// modo de falha mais caro possível no dia de um lançamento, e é fácil demais
// esquecer no meio de uma migração.
//
// O script é IDEMPOTENTE: rodar duas vezes não duplica nada.
// -----------------------------------------------------------------------------
import { sb, ENV } from "../testes/db.mjs";

const [, , idBruto, arg2, arg3] = process.argv;
const soConferir = arg2 === "--conferir";
const id = String(idBruto ?? "").trim();

if (!id) {
  console.log(`
uso:
  node scripts/pos-migracao-numero.mjs <phone_number_id> "<numero>" "<rotulo>"
  node scripts/pos-migracao-numero.mjs <phone_number_id> --conferir

exemplo:
  node scripts/pos-migracao-numero.mjs 1234567890 "+55 91 2018-2357" "Murano Pro (oficial)"
`);
  process.exit(1);
}
if (!/^\d{10,20}$/.test(id)) {
  console.error(`ERRO: "${id}" não parece um phone_number_id (só dígitos).`);
  console.error("      Não é o telefone — é o id que a Meta mostra em WhatsApp Manager > Números.");
  process.exit(1);
}

const linha = (t = "") => console.log(t);
const passo = (t) => console.log(`\n── ${t}`);

// ---------------------------------------------------------------------------
// 1. cadastro da linha (dá rótulo ao número no cabeçalho da conversa)
// ---------------------------------------------------------------------------
passo("chat_linha");
const { data: jaTem } = await sb.from("chat_linha").select("*").eq("phone_number_id", id).maybeSingle();
if (jaTem) {
  linha(`   já cadastrado: ${jaTem.numero} · ${jaTem.rotulo} · ${jaTem.ativo ? "ativo" : "INATIVO"}`);
  if (!jaTem.ativo && !soConferir) {
    await sb.from("chat_linha").update({ ativo: true }).eq("phone_number_id", id);
    linha("   → reativado (linha inativa não é usada para enviar)");
  }
} else if (soConferir) {
  linha("   ✗ NÃO cadastrado — o cabeçalho da conversa ficaria sem etiqueta");
} else {
  const numero = String(arg2 ?? "").trim();
  const rotulo = String(arg3 ?? "").trim();
  if (!numero || !rotulo) {
    console.error("   ERRO: para cadastrar preciso do número e do rótulo.");
    console.error('   ex.: node scripts/pos-migracao-numero.mjs 123 "+55 91 2018-2357" "Murano Pro (oficial)"');
    process.exit(1);
  }
  const { error } = await sb.from("chat_linha").insert({ phone_number_id: id, numero, rotulo, ativo: true });
  if (error) { console.error("   ERRO:", error.message); process.exit(1); }
  linha(`   ✓ cadastrado: ${numero} · ${rotulo}`);
}

// ---------------------------------------------------------------------------
// 2. VISIBILIDADE — a parte que some em silêncio
// ---------------------------------------------------------------------------
passo("crm_config.linhas_visiveis");
const { data: cfg } = await sb.from("crm_config").select("linhas_visiveis,numero_envio").eq("id", 1).maybeSingle();
const atual = Array.isArray(cfg?.linhas_visiveis) ? cfg.linhas_visiveis : null;

if (atual === null) {
  linha("   está NULO = todas as linhas ativas aparecem. Nada a fazer — o número novo já entra.");
} else if (atual.includes(id)) {
  linha(`   ✓ ${id} já está na lista: [${atual.join(", ")}]`);
} else if (soConferir) {
  linha(`   ✗ ${id} FORA da lista [${atual.join(", ")}]`);
  linha("     → as conversas desse número NÃO apareceriam no board nem no chat");
} else {
  const nova = [...atual, id];
  const { error } = await sb.from("crm_config").update({ linhas_visiveis: nova }).eq("id", 1);
  if (error) { console.error("   ERRO:", error.message); process.exit(1); }
  linha(`   ✓ acrescentado. Agora: [${nova.join(", ")}]`);
  linha("     (sem isto as conversas do número novo ficariam invisíveis, sem erro nenhum)");
}

// ---------------------------------------------------------------------------
// 3. saúde do número na Meta — a resposta que diz de quem é o problema
// ---------------------------------------------------------------------------
passo("saúde na Graph API");
const token = (ENV.WHATSAPP_TOKEN ?? "").replace(/[^\x21-\x7E]/g, "");
if (!token) {
  linha("   PULADO: WHATSAPP_TOKEN ausente no .env desta máquina.");
} else {
  const g = async (caminho) => {
    const r = await fetch(`https://graph.facebook.com/v23.0/${caminho}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { ok: r.ok, body: await r.json().catch(() => ({})) };
  };

  const n = await g(`${id}?fields=display_phone_number,verified_name,quality_rating,account_mode,status,throughput,health_status`);
  if (!n.ok) {
    linha(`   ✗ a Graph recusou: ${n.body?.error?.message ?? "erro"}`);
    linha("     Código 100/200 aqui costuma significar que o TOKEN não enxerga a WABA");
    linha("     deste número — ou seja, é permissão de conta, não do número.");
  } else {
    const d = n.body;
    linha(`   número      : ${d.display_phone_number ?? "?"}  (${d.verified_name ?? "sem nome"})`);
    linha(`   modo        : ${d.account_mode ?? "?"}   status: ${d.status ?? "?"}`);
    linha(`   qualidade   : ${d.quality_rating ?? "?"}`);
    const hs = d.health_status?.entities ?? [];
    for (const e of hs) {
      const marca = e.can_send_message === "AVAILABLE" ? "✓" : "✗";
      linha(`   ${marca} ${String(e.entity_type).padEnd(16)} ${e.can_send_message}${
        e.errors?.length ? " — " + e.errors.map((x) => `${x.error_code} ${x.error_description}`).join("; ") : ""}`);
    }
    if (hs.some((e) => e.can_send_message !== "AVAILABLE")) {
      linha("     → enquanto qualquer linha acima não estiver AVAILABLE, o envio falha.");
    }
  }

  // A inscrição do app é passo SEPARADO e não dá erro em lugar nenhum quando
  // falta: recebe-se nada, e a única pista é mensagem parada em `wait`.
  // ⚠️ o nó do número NÃO devolve a WABA por `fields=whatsapp_business_account`
  // (medido: volta vazio, sem erro). Então a WABA vem da env, ou de um 3º
  // argumento — sem ela a checagem de inscrição do app não roda, e é justamente
  // ela que denuncia o defeito mais mudo que este projeto já teve.
  const wabaId = (process.argv[5] ?? ENV.WHATSAPP_WABA_ID ?? "").replace(/\D/g, "");
  if (!wabaId) {
    linha("   WABA        : desconhecida — passe o id como 4º argumento para eu conferir");
    linha("                 se o app está inscrito (sem inscrição, nada chega e ninguém avisa).");
  } else {
    const info = await g(`${wabaId}?fields=name`);
    linha(`   WABA        : ${wabaId} (${info.body?.name ?? "?"})`);
    const apps = await g(`${wabaId}/subscribed_apps`);
    const lista = apps.body?.data ?? [];
    if (!apps.ok) {
      linha(`   ✗ não consegui ler subscribed_apps: ${apps.body?.error?.message ?? ""}`);
    } else if (!lista.length) {
      linha("   ✗ NENHUM app inscrito nesta WABA — nada vai chegar pelo webhook.");
      linha("     Sintoma: mensagem enviada fica parada em `wait` para sempre e");
      linha("     nenhuma mensagem de cliente entra. Corrigir no painel da Meta.");
    } else {
      linha(`   ✓ apps inscritos: ${lista.map((a) => a.whatsapp_business_api_data?.name ?? a.id).join(", ")}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. o que ainda depende de gente
// ---------------------------------------------------------------------------
passo("o que este script NÃO faz");
linha(`   · WHATSAPP_PHONE_NUMBER_ID na Vercel — é o número PADRÃO, usado só quando`);
linha(`     a conversa não tem mensagem recebida (contato criado à mão). Trocar só`);
linha(`     se quiser que o padrão passe a ser este número.`);
linha(`   · assinar o campo \`calls\` no webhook, se for usar ligação (assinar`);
linha(`     \`messages\` NÃO assina \`calls\`).`);
linha(`   · conferir a aba Parceiros da WABA: parceiro herdado bloqueia o ENVIO`);
linha(`     sem dar pista no token, nas permissões nem no número.`);

linha("\npronto.");
process.exit(0);
