// -----------------------------------------------------------------------------
// REGRESSÃO — o painel afirmava "sem cadastro no WinThor" para cliente que TEM.
//
// Relatado com print em 28/08/2026, depois de um disparo de template: contatos
// que a equipe sabe serem clientes antigos apareciam como se fossem novos.
//
// Não eram novos: **trocaram de número**. O cadastro velho continua no ERP, com
// CPF e vínculo; o número novo entrou como outra linha em `clientes`, sem CPF —
// e o vínculo casa por CPF (§10.5), então nunca se forma.
//
// O que torna isso defeito nosso, e não buraco de dado: a VIEW JÁ SABIA. Para os
// casos do print ela devolve `sem_cadastro = false` (encontrou o nome no ERP) e
// o painel escrevia o contrário, porque decidia pela ausência de `codcli`. Duas
// telas do mesmo sistema afirmando coisas opostas sobre a mesma pessoa.
//
// Medido: 52 contatos sem vínculo com homônimo JÁ vinculado ao ERP.
//
// ⚠️ Nada aqui fixa nome ou id de cliente: o repositório é público (§15.5), e um
// teste que depende de uma pessoa específica quebra quando ela é corrigida.
// -----------------------------------------------------------------------------
import { readFileSync } from "node:fs";

export const ciclo = "Regressão — trocou de número (painel dizia 'sem cadastro')";

const PAGINA = "web/app/chat/page.tsx";

/** Pagina uma relacao inteira (o PostgREST corta em 1000 e nao avisa). */
async function tudo(db, rel, colunas) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.sb.from(rel).select(colunas).range(de, de + 999);
    if (error) throw new Error(`${rel}: ${error.message}`);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return linhas;
}

const chaveNome = (n) =>
  String(n ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();

/**
 * Contatos sem vinculo cujo NOME existe em `wth_carteira`.
 *
 * Casamento em MEMORIA de proposito: a versao ingenua fazia duas consultas por
 * contato (~10 mil round-trips) e estourava o tempo. Aqui sao ~20 consultas.
 */
async function trocaramDeNumero(db) {
  const [clientes, vinculos, erp] = await Promise.all([
    tudo(db, "clientes", "id,nome_completo"),
    tudo(db, "wth_vinculo", "cliente_id"),
    tudo(db, "wth_carteira", "codcli,nome,ativo"),
  ]);
  const temVinculo = new Set(vinculos.map((v) => v.cliente_id));
  const noErp = new Map();
  for (const w of erp) {
    if (w.ativo !== true) continue;
    const k = chaveNome(w.nome);
    if (k.length >= 8 && !noErp.has(k)) noErp.set(k, w.codcli);
  }
  const achados = [];
  for (const c of clientes) {
    if (temVinculo.has(c.id)) continue;
    const k = chaveNome(c.nome_completo);
    if (k.length >= 8 && noErp.has(k)) achados.push({ ...c, codcli: noErp.get(k) });
  }
  return achados;
}

export default async function (t) {
  const { db, api } = t;
  let amostra = [];

  // ---------------------------------------------------------------- passo 1
  await t.passo("1. a tela não afirma 'sem cadastro' quando há candidato no ERP", "✅", async () => {
    const src = readFileSync(PAGINA, "utf8");
    api.ok(/erp_candidatos/.test(src),
      "o painel voltou a ignorar `erp_candidatos`: quem trocou de número aparece como cliente novo");
    api.ok(!/Sem cadastro no WinThor — contato ainda não vinculado/.test(src),
      "a frase que afirmava 'sem cadastro' sem consultar o ERP pelo nome voltou ao código");
    return "painel consome `erp_candidatos` e não afirma mais o que não sabe";
  });

  // ---------------------------------------------------------------- passo 2
  await t.passo("2. existe gente nessa situação, e a rota acha o candidato", "✅", async () => {
    if (!t.servidorNoAr) throw new Error(`PULAR:servidor fora do ar em ${api.BASE}`);
    amostra = await trocaramDeNumero(db);
    if (!amostra.length) return "ninguém nessa situação hoje — nada a provar";

    const alvo = amostra[0];
    const r = await api.get(`/api/chat/contato?cliente_id=${encodeURIComponent(alvo.id)}`, api.SESSOES.admin);
    api.status(r, 200, "GET /api/chat/contato");
    api.ok(!r.json.compras, "o alvo deveria estar SEM vínculo — teste desatualizado");
    api.ok((r.json.erp_candidatos ?? []).length > 0,
      `a rota não devolveu candidato do ERP para um contato cujo nome existe em wth_carteira ` +
      `(codcli ${alvo.codcli}) — o painel voltaria a dizer "cliente novo"`);
    return `${amostra.length} contato(s) nessa situação na amostra; a rota devolve o candidato do ERP`;
  });

  // ---------------------------------------------------------------- passo 3
  await t.passo("3. a tela decide pelo candidato, não pelo `sem_cadastro` da view", "✅", async () => {
    // ⚠️ A primeira versão deste passo exigia `sem_cadastro === false` para quem
    // tem homônimo no ERP, e falhou — corretamente. A view casa nome pelo
    // `nome_norm` dela; este teste casa em memória, normalizando acento. As duas
    // réguas não são a mesma, então "a view sempre acha o que eu acho" é uma
    // afirmação forte demais, e sobre algo que a correção nem controla.
    //
    // O invariante que IMPORTA, e que a correção de fato garante: a tela decide
    // pelo candidato que a ROTA devolve, não pelo `sem_cadastro` da view. Foi a
    // leitura do `codcli` nulo que produzia a contradição original.
    const src = readFileSync(PAGINA, "utf8");
    const i = src.indexOf("candidatos.length ? (");
    api.ok(i > 0, "o painel deixou de ramificar por `candidatos.length`");

    const naoEncontrei = src.indexOf("Não encontrei este contato no WinThor");
    api.ok(naoEncontrei > i,
      "a frase 'não encontrei' voltou a vir ANTES do ramo do candidato — quem trocou de " +
      "número volta a ser anunciado como cliente novo");

    if (!amostra.length) return "sem amostra; o invariante estrutural está de pé";
    const { data: f } = await db.sb
      .from("vw_funil_visivel").select("sem_cadastro,codcli").eq("cliente_id", amostra[0].id).maybeSingle();
    // Reportado, não exigido: serve para enxergar a divergência das duas réguas.
    return `painel ramifica pelo candidato · na amostra a view diz ` +
      `sem_cadastro=${f?.sem_cadastro} e codcli=${f?.codcli ?? "null"}`;
  });
}
