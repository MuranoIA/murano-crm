// -----------------------------------------------------------------------------
// UMA LIGAÇÃO DE VERDADE, ponta a ponta.
//
//   node prototipos/chat-v2/prova-ligacao-real.mjs --cliente <id> [--segundos 25]
//
// ⚠️ ISTO TOCA UM TELEFONE DE VERDADE e é cobrado por minuto. Só rode com
// autorização explícita e para um número combinado. `SIMULACAO_ENVIO` NÃO cobre
// ligação — ele guarda só `lib/whatsapp.ts` (mensagem, mídia, template).
//
// O microfone é FALSO (um tom sintético, flags do Chrome): serve para provar a
// cadeia — oferta SDP, sinalização pelo webhook, resposta aplicada, conexão
// WebRTC, registro em `chat_ligacao` —, não para julgar qualidade de som.
//
// Desliga sozinho depois de `--segundos`, para não ficar chamando à toa.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const arg = (n, p) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : p; };
const CLIENTE = arg("--cliente", "");
const SEGUNDOS = Number(arg("--segundos", "25"));
if (!CLIENTE) { console.error("faltou --cliente <id>"); process.exit(2); }

const passos = [];
const ok = (n, d = "") => passos.push({ n, ok: true, d });
const falha = (n, d = "") => passos.push({ n, ok: false, d });

const ultimaLigacao = async () => {
  const { data } = await sb.from("chat_ligacao")
    .select("id,direcao,status,call_id,iniciada_em,atendida_em,encerrada_em,duracao_seg,motivo,erro")
    .eq("cliente_id", CLIENTE).order("id", { ascending: false }).limit(1);
  return data?.[0] ?? null;
};

const antes = await ultimaLigacao();
console.log("última ligação ANTES:", antes ? `#${antes.id} ${antes.status}` : "nenhuma");

// microfone falso: headless não tem entrada de áudio, e sem isto o
// `getUserMedia` falha antes de qualquer coisa interessante acontecer
const chrome = await subirChrome({ porta: 9430, microfone: true });
try {
  const aba = await novaAba(chrome);
  await aba.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await aba.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(CLIENTE)}`, { esperar: 7000 });

  const temBotao = await aba.ate(
    `[...document.querySelectorAll('button')].some(b => /Ligar pelo WhatsApp/i.test(b.getAttribute('title')||''))`,
    { ms: 20_000 },
  );
  if (!temBotao) {
    falha("o botão de ligar aparece", "o servidor disse que não há linha para discar");
  } else {
    ok("o botão de ligar aparece");

    const clicou = await aba.js(`
      const b = [...document.querySelectorAll('button')]
        .find(x => /Ligar pelo WhatsApp/i.test(x.getAttribute('title')||''));
      if (!b) return false; b.click(); return true;`);
    clicou ? ok("clicou em ligar") : falha("clicou em ligar");

    // a barra de chamada aparece assim que a Meta aceita a discagem
    const barra = await aba.ate(
      `/Chamando|Tocando no aparelho|Conectando o áudio|Em conversa/.test(document.body.textContent||'')`,
      { ms: 25_000 },
    );
    if (!barra) {
      const recado = await aba.js(`
        const d = [...document.querySelectorAll('div')].filter(x => (x.className||'').includes('entrar'));
        return d.length ? (d[d.length-1].textContent||'').slice(0,300) : null;`);
      falha("a chamada é aceita pela Meta", recado ?? "sem barra e sem recado");
    } else {
      ok("a chamada é aceita pela Meta — a barra de chamada aparece");

      // acompanha o estado enquanto toca
      const linha = [];
      for (let i = 0; i < SEGUNDOS; i++) {
        const t = await aba.js(`
          const b = document.body.textContent || '';
          const m = b.match(/Chamando…|Tocando no aparelho do cliente…|Conectando o áudio…|Em conversa|Conexão instável…/);
          return m ? m[0] : null;`);
        if (t && linha[linha.length - 1] !== t) linha.push(t);
        await espera(1000);
      }
      ok("estados observados", linha.join(" -> ") || "nenhum");

      const durante = await ultimaLigacao();
      if (durante && (!antes || durante.id !== antes.id)) {
        ok("a ligação foi registrada em chat_ligacao",
          `#${durante.id} ${durante.direcao}/${durante.status} call_id=${durante.call_id ? "sim" : "não"}`);
        durante.call_id
          ? ok("a Meta devolveu o call_id (a discagem saiu de verdade)")
          : falha("a Meta devolveu o call_id", `erro: ${durante.erro ?? "—"}`);
      } else {
        falha("a ligação foi registrada em chat_ligacao", "nenhuma linha nova");
      }

      // ---- desliga ------------------------------------------------------
      await aba.js(`
        const b = [...document.querySelectorAll('button')]
          .find(x => /Desligar/i.test((x.textContent||'')));
        if (b) b.click(); return true;`);
      await espera(3000);

      const pergunta = await aba.js(`return /no que deu\\?/i.test(document.body.textContent||'');`);
      pergunta
        ? ok("ao encerrar, a tela pergunta no que deu (a tabulação por voz)")
        : falha("ao encerrar, a tela pergunta no que deu");
      await aba.foto("ligacao-real");

      await espera(2000);
      const depois = await ultimaLigacao();
      depois && ["concluida", "nao_atendida", "recusada", "cancelada", "falhou"].includes(depois.status)
        ? ok("a ligação fechou no banco", `${depois.status}${depois.duracao_seg != null ? ` · ${depois.duracao_seg}s falados` : ""}`)
        : falha("a ligação fechou no banco", `status = ${depois?.status}`);
    }
  }

  aba.excecoes.length
    ? falha("sem exceção no console", aba.excecoes.slice(0, 2).join(" | "))
    : ok("sem exceção no console");
} finally {
  fecharChrome(chrome);
}

const bons = passos.filter((p) => p.ok).length;
for (const p of passos) console.log(`${p.ok ? "OK  " : "FALHA"} ${p.n}${p.d ? ` — ${p.d}` : ""}`);
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
