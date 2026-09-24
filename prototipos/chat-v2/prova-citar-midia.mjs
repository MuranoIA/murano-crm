// -----------------------------------------------------------------------------
// A CITAÇÃO MOSTRA A MÍDIA CITADA (demanda #29, 23/09/2026)
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   node prototipos/chat-v2/prova-citar-midia.mjs
//
// O caso real: o vendedor manda cinco fotos, a cliente responde "vou querer 2
// desse" marcando UMA delas. No v2 não aparecia nada — nem miniatura, nem
// rótulo —, então a pergunta que importa ("qual delas?") ficava sem resposta.
//
// A prova monta esse caso na conversa de ENSAIO e confere na tela. Tudo o que
// ela escreve é apagado no fim (`finally`), e nada sai para a cliente.
//
// ⚠️ Os 205 recheios existem de propósito: com eles a foto citada fica FORA do
// lote de 200 da thread, que é o caminho em que a tela depende do `citadas` do
// servidor. Era exatamente aí que estava o defeito — a rota devolve uma LISTA e
// a tela guardava a lista crua num objeto, então `citadas[wamid]` era sempre
// `undefined`. Sem os recheios, a citação apareceria pelo outro caminho (a
// mensagem está na tela) e o teste passaria com o código quebrado.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const MARCA = `prova-citar-midia.${Date.now()}`;

// ⚠️ A LINHA vem da própria conversa de ensaio, não de uma constante. `filtroLinhas`
// esconde tudo o que não está na seleção de `crm_config.linhas_visiveis`, e o
// número em uso já mudou mais de uma vez: com o id errado o caso é montado,
// some da thread inteira, e a prova acusa um defeito que não existe (foi o que
// aconteceu na 1ª rodada desta prova).
const { data: ref } = await sb.from("mensagens")
  .select("linha_id").eq("cliente_id", ENSAIO).not("linha_id", "is", null).limit(1).maybeSingle();
const LINHA = ref?.linha_id ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
if (!LINHA) { console.log("❌ a conversa de ensaio não existe — rode ensaio.mjs criar"); process.exit(1); }

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const agora = Date.now();
const emIso = (msAtras) => new Date(agora - msAtras).toISOString();
const base = (id, extra) => ({
  id, cliente_id: ENSAIO, tipo: "mensagem", status: "success", linha_id: LINHA, ...extra,
});

const FOTO = `${MARCA}.foto`;
const AUDIO = `${MARCA}.audio`;
// uma imagem de VERDADE no bucket (1×1 vermelho), para a prova afirmar que a
// miniatura CARREGA, e não só que a tag existe. Some no `finally`.
const CAMINHO = `ensaio/${MARCA}.png`;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const linhas = [
  base(FOTO, {
    enviada_por: "operator", conteudo: null, criada_em: emIso(9_000_000),
    midia_tipo: "image", midia_mime: "image/png", midia_nome: "catalogo-3.jpg", midia_path: CAMINHO,
  }),
  base(AUDIO, {
    enviada_por: "operator", conteudo: null, criada_em: emIso(8_900_000),
    midia_tipo: "audio", midia_mime: "audio/ogg", midia_nome: "recado.ogg",
  }),
  // os recheios: empurram a foto e o áudio para fora do lote de 200
  ...Array.from({ length: 205 }, (_, i) =>
    base(`${MARCA}.enche.${i}`, {
      enviada_por: i % 2 ? "customer" : "operator",
      conteudo: `recheio ${i}`, criada_em: emIso(8_800_000 - i * 1000),
    })),
  base(`${MARCA}.resp1`, {
    enviada_por: "customer", conteudo: "Vou querer 2 desse", criada_em: emIso(60_000),
    resposta_a: FOTO,
  }),
  base(`${MARCA}.resp2`, {
    enviada_por: "customer", conteudo: "E o que voce falou nesse", criada_em: emIso(30_000),
    resposta_a: AUDIO,
  }),
];

const limpar = async () => {
  await sb.storage.from("wa-midia").remove([CAMINHO]).catch(() => {});
  return sb.from("mensagens").delete().like("id", `${MARCA}%`);
};

try {
  const env = await sb.storage.from("wa-midia").upload(CAMINHO, PNG, { contentType: "image/png", upsert: true });
  if (env.error) throw new Error(`nao consegui subir a imagem de prova: ${env.error.message}`);
  const { error } = await sb.from("mensagens").upsert(linhas, { onConflict: "id" });
  if (error) throw new Error(`não consegui montar o caso: ${error.message}`);

  // ---- o contrato da rota, que é onde o defeito nascia ----
  const r = await fetch(`${BASE}/api/chat/thread?cliente_id=${encodeURIComponent(ENSAIO)}`, {
    headers: { cookie: "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br" },
  });
  const j = await r.json();
  conferir(Array.isArray(j.citadas), "a rota devolve `citadas` como LISTA (e não como mapa)", typeof j.citadas);
  const daFoto = (j.citadas ?? []).find((c) => c.id === FOTO);
  conferir(!!daFoto, "a foto citada vem do servidor mesmo estando fora do lote de 200");
  conferir(daFoto?.midia_tipo === "image" && daFoto?.midia_nome === "catalogo-3.jpg",
    "…e vem com os campos de mídia, que são o que identifica QUAL foto", JSON.stringify(daFoto?.midia_tipo));

  // ---- a tela ----
  const chrome = await subirChrome({ porta: 9475 });
  try {
    const a = await novaAba(chrome);
    await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
    await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 5000 });
    await a.ate(`document.querySelector('textarea')`, { ms: 20_000 });
    await a.ate(`document.body.innerHTML.includes("Vou querer 2 desse")`, { ms: 20_000 });
    // ⚠️ esperar pela CITAÇÃO, não por um tempo fixo. As mensagens vêm no HTML
    // do servidor, mas o trecho citado chega depois, na chamada que completa a
    // thread — com meio segundo de espera a prova reprovava um código correto.
    await a.ate(`!!document.querySelector('[data-msg="${MARCA}.resp1"] img[src*="/api/chat/midia"]')`, { ms: 15_000 });
    // e esperar o arquivo chegar: a miniatura é `loading="lazy"` e passa por um
    // 302 para a URL assinada do bucket
    await a.ate(
      `(() => { const i = document.querySelector('[data-msg="${MARCA}.resp1"] img[src*="/api/chat/midia"]'); return !!i && i.complete && i.naturalWidth > 0; })()`,
      { ms: 15_000 },
    );

    const naCitacao = await a.js(`
      const bolha = document.querySelector('[data-msg="${MARCA}.resp1"]');
      if (!bolha) return { achou: false };
      const img = bolha.querySelector('img[src*="/api/chat/midia"]');
      return {
        achou: true,
        temImg: !!img,
        carregou: !!img && img.complete && img.naturalWidth > 0,
        src: img ? img.getAttribute('src') : null,
        texto: bolha.textContent,
      };`);
    conferir(naCitacao?.achou, "a bolha da resposta está na tela");
    conferir(naCitacao?.temImg, "a citação mostra a MINIATURA da foto marcada");
    conferir(String(naCitacao?.src ?? "").includes(encodeURIComponent(FOTO)),
      "…e a miniatura é a da foto certa, não de outra", String(naCitacao?.src ?? "").slice(-30));
    conferir(String(naCitacao?.texto ?? "").includes("catalogo-3.jpg"),
      "…com o nome do arquivo ao lado, para quem mandou cinco parecidas");
    conferir(naCitacao?.carregou, "…e a imagem CARREGA de verdade (URL assinada do bucket)");

    const doAudio = await a.js(`
      const b = document.querySelector('[data-msg="${MARCA}.resp2"]');
      return b ? b.textContent : null;`);
    conferir(String(doAudio ?? "").includes("recado.ogg") || String(doAudio ?? "").includes("Áudio"),
      "citação de ÁUDIO aparece com rótulo, não como \"mídia\"", String(doAudio ?? "").slice(0, 60));

    await a.foto("citar-midia");
    const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
    conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
  } finally { fecharChrome(chrome); }
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  const { error } = await limpar();
  conferir(!error, "a prova não deixou rastro (as mensagens de teste foram apagadas)", error?.message ?? "");
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
