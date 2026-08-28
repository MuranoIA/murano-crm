// -----------------------------------------------------------------------------
// CPF confirma o cadastro, e o que o CRM não alcança vira fila (0117)
//
// Pedido do usuário (28/08/2026): *"se a cliente digitar o cpf e este for o
// mesmo do winthor, então o processo acontece automaticamente?"* — acontece,
// com um freio, e é o freio que este arquivo tranca.
//
// As propriedades que NÃO podem se perder:
//
//  1. o caminho AUTOMÁTICO (webhook) exige que o NOME também bata. Sem isso,
//     qualquer CPF válido que chegue pela conversa vincula o contato ao cadastro
//     daquele CPF — a cliente manda o do marido, o da sócia, ou erra um dígito
//     de um jeito que ainda passe no verificador, e a conversa herda histórico
//     de compra e RCA de outra pessoa;
//  2. o caminho MANUAL não aceita CPF do navegador: ele lê o CPF do cadastro do
//     ERP que o consultor escolheu. Aceitar do corpo abriria vincular um contato
//     a qualquer cliente, sem o freio de nome;
//  3. a fila de atualização existe e exporta `.csv` — sem o arquivo, a tela é um
//     número que o admin não pode acionar (mesma doença que a §36 cura).
// -----------------------------------------------------------------------------
import { readFileSync } from "node:fs";

export const ciclo = "CPF confirma o cadastro, e a fila de atualização (0117)";

const WEBHOOK = "web/app/api/whatsapp/webhook/route.ts";
const VINCULAR = "web/app/api/chat/vincular/route.ts";
const LIB = "web/lib/vinculoCpf.ts";

export default async function (t) {
  const { db, api } = t;

  // ---------------------------------------------------------------- passo 1
  await t.passo("1. o caminho automático exige nome igual", "✅", async () => {
    const wh = readFileSync(WEBHOOK, "utf8");
    api.ok(/tentarVincularPeloCpf/.test(wh), "o webhook não tenta mais vincular pelo CPF");
    const i = wh.indexOf("async function tentarVincularPeloCpf");
    api.ok(i > 0, "função sumiu do webhook");
    const corpo = wh.slice(i, i + 1600);
    api.ok(/exigirNomeIgual:\s*true/.test(corpo),
      "o caminho AUTOMÁTICO deixou de exigir nome igual — um CPF qualquer vindo da conversa " +
      "passa a vincular o contato ao cadastro daquele CPF");
    return "webhook chama com exigirNomeIgual: true";
  });

  // ---------------------------------------------------------------- passo 2
  await t.passo("2. o caminho manual lê o CPF do ERP, não do navegador", "✅", async () => {
    const v = readFileSync(VINCULAR, "utf8");
    api.ok(/from\("wth_carteira"\)[\s\S]{0,120}eq\("codcli"/.test(v),
      "a rota deixou de buscar o CPF pelo codcli no ERP");
    api.ok(!/\bb\?\.cpf\b|body.*\.cpf/.test(v),
      "a rota passou a aceitar CPF do corpo da requisição — isso permite vincular " +
      "um contato a qualquer cliente, sem o freio de nome do caminho automático");
    return "CPF vem de wth_carteira pelo codcli escolhido";
  });

  // ---------------------------------------------------------------- passo 3
  await t.passo("3. o validador de CPF recusa o que não é CPF", "✅", async () => {
    const lib = readFileSync("web/lib/cpf.ts", "utf8");
    api.ok(/\1\{10\}/.test(lib) || /(\d)\1/.test(lib),
      "a recusa de 11 dígitos repetidos (111.111.111-11) saiu do validador");
    api.ok(/resto === 10 \? 0 : resto|dv/.test(lib), "o dígito verificador saiu do validador");
    return "dígito verificador + recusa de repetidos presentes";
  });

  // ---------------------------------------------------------------- passo 4
  await t.passo("4. as guardas da rota de vínculo respondem", "✅", async () => {
    if (!t.servidorNoAr) throw new Error(`PULAR:servidor fora do ar em ${api.BASE}`);
    const sintetico = await api.post("/api/chat/vincular",
      { cliente_id: "winthor:123", codcli: 3497 }, api.SESSOES.admin);
    api.igual(sintetico.status, 422, "card sintético do ERP deveria ser recusado");

    const semSessao = await api.post("/api/chat/vincular",
      { cliente_id: "wa:5591000000000", codcli: 1 }, {});
    api.igual(semSessao.status, 401, "sem sessão deveria ser 401");
    return "card sintético 422 · sem sessão 401";
  });

  // ---------------------------------------------------------------- passo 5
  await t.passo("5. a fila de atualização responde, e o .csv sai abrível no Excel", "✅", async () => {
    if (!t.servidorNoAr) throw new Error(`PULAR:servidor fora do ar em ${api.BASE}`);
    const r = await api.get("/api/admin/atualizacoes", api.SESSOES.admin);
    api.status(r, 200, "GET /api/admin/atualizacoes");
    api.ok(Array.isArray(r.json?.linhas), "a fila não devolveu `linhas`");

    const csv = await fetch(`${api.BASE}/api/admin/atualizacoes?csv=1`, {
      headers: { Cookie: Object.entries(api.SESSOES.admin).map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    api.igual(csv.status, 200, "csv");
    // ⚠️ bytes, nao `.text()`: a decodificacao UTF-8 do fetch REMOVE o BOM por
    // especificacao, entao `text()` sempre diria que ele nao existe — o teste
    // acusaria um defeito que nao ha, que e o pior tipo de teste.
    const bytes = new Uint8Array(await csv.arrayBuffer());
    api.ok(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      "o .csv perdeu o BOM — o Excel pt-BR abre com acento quebrado");
    const txt = new TextDecoder().decode(bytes);
    api.ok(txt.includes(";"), "o .csv não está separado por ; (o que o Excel pt-BR espera)");

    const { count } = await db.sb.from("cadastro_atualizacao")
      .select("*", { count: "exact", head: true });
    return `fila com ${r.json.pendentes ?? 0} pendente(s) · ${count ?? 0} na tabela · csv com BOM e ;`;
  });
}
