// -----------------------------------------------------------------------------
// CAMPANHA: DISTRIBUIR EM RODÍZIO QUEM RESPONDE (demanda #52, 29/09/2026)
//
//   ENSAIO_VISIVEL=1 npx next start -p 3120     (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-campanha-rodizio.mjs
//
// O caso de uso do dono: uma carteira ficou vaga, centenas de clientes sem
// atendimento. Dispara-se um template; conforme respondem, caem na fila e
// alguém transfere UM POR UM, à mão.
//
// A prova monta a coisa inteira na faixa reservada de ENSAIO e exercita o
// caminho de verdade — o webhook da Meta, não a função SQL direto:
//
//   4 clientes de ensaio -> disparo de massa -> campanha com DOIS atendentes
//   -> as respostas chegam pelo POST do webhook, uma a uma
//
// Com dois atendentes e três respostas, o rodízio tem de dar a volta: A, B, A.
// O quarto cliente TEM DONO, e serve para provar que a campanha não arranca
// conversa da mão de quem já atende.
//
// ⚠️ Tudo o que ela cria é apagado no `finally` — clientes, mensagens, disparos,
// campanha e transferências. O incidente de 10/09 (clientes falsos na sidebar
// dos consultores por meia hora) foi exatamente uma limpeza que não rodou.
// -----------------------------------------------------------------------------
import { sb } from "../../testes/db.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const COOKIE = { crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" };

// faixa reservada (web/lib/ensaio.ts): 55 91 9 0000-00NN nunca chega à Meta
const TEL = ["5591900000" + "81", "5591900000" + "82", "5591900000" + "83", "5591900000" + "84"];
const ID = TEL.map((t) => `wa:${t}`);
const MARCA = `campanha-${Date.now()}`;

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

let campanhaId = null;
const chrome = await subirChrome({ porta: 9581 });

try {
  // ---- 1. o cenário ------------------------------------------------------
  for (let i = 0; i < TEL.length; i++) {
    await sb.from("clientes").upsert(
      {
        id: ID[i], nome_completo: `ENSAIO campanha ${i + 1} (não é cliente)`, telefone: TEL[i],
        // o QUARTO já tem dono: é o caso que a campanha não pode roubar
        carteira: i === 3 ? "thamires" : null,
      },
      { onConflict: "id" },
    );
  }

  // o disparo: o que a tela de Administração › Templates grava ao enviar
  const agora = new Date();
  await sb.from("disparos_template").insert(
    ID.map((id, i) => ({
      id: `${MARCA}.${i}`, cliente_id: id, telefone: TEL[i],
      // ⚠️ o 4º vai com vendedor NULO no disparo de propósito: assim
      // "thamires" NÃO entra nas carteiras de origem da campanha, e o dono dele
      // é de fora — que é o caso que a regra protege. Com ele como carteira de
      // origem, distribuir seria o CERTO (é a carteira vaga do caso de uso), e
      // a prova estaria medindo o contrário do que afirma.
      vendedor: null,
      template_id: MARCA, status: "enviado", origem: "massa",
      criada_em: new Date(agora.getTime() - 60_000).toISOString(),
    })),
  );

  const a = await novaAba(chrome);
  await a.cookies(COOKIE, BASE);
  // ⚠️ precisa ESTAR na origem antes de chamar a rota por caminho relativo: em
  // `about:blank` o `fetch('/api/...')` não tem base e falha ao montar a URL
  await a.ir(`${BASE}/admin-novo`, { esperar: 2000 });
  await a.ate(`/Campanhas de distribui/.test(document.body.textContent || '')`, { ms: 20_000 });

  // ---- 2. a campanha, pela rota ------------------------------------------
  const FILA = ["u:tatianaalves@muranoprofessional.com.br", "u:lais@muranoprofessional.com.br"];
  const criar = await a.js(`
    return fetch('/api/admin/campanha-distribuicao', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: ${JSON.stringify(JSON.stringify({
        nome: `PROVA ${MARCA}`,
        de: new Date(agora.getTime() - 120_000).toISOString(),
        ate: new Date(agora.getTime() + 60_000).toISOString(),
        template_id: MARCA, atendentes: FILA, janela_dias: 7,
      }))},
    }).then(async r => ({ status: r.status, corpo: await r.json().catch(() => ({})) }));`);
  campanhaId = criar?.corpo?.campanha?.id ?? null;
  conferir(criar.status === 200 && !!campanhaId, "a campanha é criada a partir de um disparo que já aconteceu",
    `${criar.corpo?.alvos ?? 0} alvos`);
  conferir(criar.corpo?.alvos === 4, "…com uma linha por cliente do disparo", `${criar.corpo?.alvos}`);

  // ---- 3. as respostas, pelo WEBHOOK -------------------------------------
  const responder = async (i, texto) => {
    const corpo = {
      object: "whatsapp_business_account",
      entry: [{
        id: "prova", changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "0", phone_number_id: "prova-campanha" },
            contacts: [{ profile: { name: `ENSAIO campanha ${i + 1}` }, wa_id: TEL[i] }],
            messages: [{
              from: TEL[i], id: `${MARCA}.msg.${i}.${texto.length}`,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: "text", text: { body: texto },
            }],
          },
        }],
      }],
    };
    const r = await fetch(`${BASE}/api/whatsapp/webhook`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
    });
    return r.status;
  };

  // ⚠️ UMA DE CADA VEZ, com espera: a ordem das respostas É a ordem do rodízio,
  // e disparar as três juntas testaria a corrida, não a regra. (A corrida tem
  // a sua própria trava: o `for update` na função SQL.)
  for (const i of [0, 1, 2]) {
    conferir((await responder(i, `resposta ${i}`)) === 200, `o webhook aceita a resposta ${i + 1}`);
    await espera(1200);
  }
  conferir((await responder(3, "resposta do que já tem dono")) === 200, "…e a do cliente que já tem dono");
  await espera(1500);

  const { data: alvos } = await sb.from("campanha_alvo")
    .select("cliente_id,atendente,respondeu_em,motivo,distribuido_em")
    .eq("campanha_id", campanhaId);
  const de = (id) => (alvos ?? []).find((x) => x.cliente_id === id) ?? {};

  conferir(de(ID[0]).atendente === FILA[0], "a 1ª resposta vai para o 1º da fila", String(de(ID[0]).atendente));
  conferir(de(ID[1]).atendente === FILA[1], "a 2ª vai para o 2º", String(de(ID[1]).atendente));
  conferir(
    de(ID[2]).atendente === FILA[0],
    "a 3ª DÁ A VOLTA e cai no 1º de novo — é o rodízio",
    String(de(ID[2]).atendente),
  );
  conferir(
    !de(ID[3]).atendente && /já tinha dono|ja tinha dono/.test(String(de(ID[3]).motivo ?? "")),
    "quem JÁ TEM DONO não é distribuído, e a planilha diz por quê",
    String(de(ID[3]).motivo ?? ""),
  );

  // ---- 4. a transferência é de verdade -----------------------------------
  const { data: transf } = await sb.from("chat_transferencia")
    .select("cliente_id,para_carteira,por").in("cliente_id", ID).eq("por", "campanha");
  conferir((transf ?? []).length === 3, "cada distribuição virou uma transferência de verdade", `${(transf ?? []).length} linhas`);
  conferir(
    (transf ?? []).every((t) => FILA.includes(t.para_carteira)),
    "…endereçada a quem estava na fila",
  );

  // ---- 5. responder de novo não redistribui ------------------------------
  const antes = JSON.stringify(de(ID[0]));
  await responder(0, "mandei outra mensagem");
  await espera(1200);
  const { data: alvos2 } = await sb.from("campanha_alvo")
    .select("cliente_id,atendente,respondeu_em").eq("campanha_id", campanhaId).eq("cliente_id", ID[0]).maybeSingle();
  const { data: t2 } = await sb.from("chat_transferencia").select("id").eq("cliente_id", ID[0]).eq("por", "campanha");
  conferir(
    alvos2?.atendente === FILA[0] && (t2 ?? []).length === 1,
    "a cliente mandar outra mensagem NÃO a distribui de novo",
    `${(t2 ?? []).length} transferência(s)`,
  );

  // ---- 6. a tela ---------------------------------------------------------
  await a.ir(`${BASE}/admin-novo`, { esperar: 2500 });
  await a.ate(`/Campanhas de distribui/.test(document.body.textContent || '')`, { ms: 20_000 });
  const noHtml = await a.js(`return /PROVA ${MARCA}/.test(document.body.textContent || '');`);
  conferir(noHtml, "a campanha aparece no painel novo");

  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /PROVA ${MARCA}/.test(x.textContent||''));
    if (b) b.click(); return true;`);
  await a.ate(`document.querySelector('table')`, { ms: 15_000 });
  const tabela = await a.js(`
    const t = document.querySelector('table');
    return {
      colunas: [...t.querySelectorAll('thead th')].map(x => x.textContent.trim()),
      linhas: t.querySelectorAll('tbody tr').length,
      texto: t.textContent.replace(/\\s+/g, ' '),
    };`);
  conferir(tabela.linhas === 4, "…com uma linha por cliente na planilha", `${tabela.linhas} linhas`);
  conferir(
    ["Cliente", "Cód.", "RCA", "Era de", "Foi para", "Enviado", "Respondeu"].every((c) => tabela.colunas.includes(c)),
    "e as colunas que o dono pediu",
    tabela.colunas.join(" · "),
  );
  conferir(/Tatiana/i.test(tabela.texto) && /Lais/i.test(tabela.texto), "mostrando para quem cada uma foi");
  await a.foto("campanha-rodizio");

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  // limpeza, na ordem das dependências
  if (campanhaId) await sb.from("campanha").delete().eq("id", campanhaId); // alvos vão em cascata
  await sb.from("chat_transferencia").delete().in("cliente_id", ID);
  await sb.from("disparos_template").delete().like("id", `${MARCA}%`);
  await sb.from("mensagens").delete().in("cliente_id", ID);
  await sb.from("chat_conversa").delete().in("cliente_id", ID);
  await sb.from("clientes").delete().in("id", ID);
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
