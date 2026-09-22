// -----------------------------------------------------------------------------
// BUG DE 22/09/2026: o chat de hoje (/chat) parou de mandar ÁUDIO.
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   node prototipos/chat-v2/prova-audio-webm.mjs
//
// O chat antigo grava no Chrome como `audio/webm` e conta com o SERVIDOR para
// reescrever o container em Ogg antes de mandar à Meta. Desde o PR #237, a
// classificação de mídia segue a lista da Meta — onde `audio/webm` não existe —,
// o arquivo virava "documento" e a conversão era pulada.
//
// Esta prova refaz o caminho EXATO do chat antigo, de dentro do navegador:
//   1. grava 2 s de WebM/Opus com o MediaRecorder do Chrome, do microfone
//      sintético que o driver liga (um tom; a permissão é aceita sozinha);
//   2. `assinar` → PUT no Storage → `enviar-midia`, com mime `audio/webm`,
//      como `app/chat/page.tsx` faz;
//   3. confere a resposta (tipo `audio`) e a linha gravada (`audio/ogg`).
//
// Medido em 22/09: SEM a correção a mesma rota respondeu `tipo: document`,
// "formato de áudio não aceito — foi como documento", e guardou `audio/webm`.
// COM ela, `tipo: audio` e `audio/ogg`.
//
// ⚠️ Conversa de ENSAIO: o número dela nunca é enviado de verdade
// (`lib/simulacaoEnvio`, `ehTelefoneDeEnsaio`), com ou sem SIMULACAO_ENVIO.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { sb, ENV } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const SUPA = ENV.NEXT_PUBLIC_SUPABASE_URL || ENV.SUPABASE_URL;

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9451, microfone: true });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 3000 });

  // `a.js` embrulha numa função comum: o assíncrono vai como promessa devolvida
  const r = await a.js(`
    return (async () => {
      const mime = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mime)) return { erro: 'este Chrome não grava webm/opus' };
      // o MICROFONE, como o chat antigo — o Chrome sobe com um microfone
      // sintético (um tom) e a permissão aceita. A primeira versão usava um
      // oscilador: sem tela ele nasce suspenso, gravou 110 bytes de silêncio e,
      // com resume(), travou esperando um gesto que nunca vem.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const pedacos = [];
      rec.ondataavailable = (e) => e.data.size && pedacos.push(e.data);
      await new Promise((ok) => { rec.onstop = ok; rec.start(); setTimeout(() => rec.stop(), 2000); });
      stream.getTracks().forEach((t) => t.stop());
      // exatamente o arquivo que o chat antigo monta (app/chat/page.tsx, onstop)
      const blob = new Blob(pedacos, { type: rec.mimeType || mime });
      const file = new File([blob], 'audio-' + Date.now() + '.webm', { type: 'audio/webm' });

      const ass = await fetch('/api/chat/enviar-midia/assinar', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cliente_id: ${JSON.stringify(ENSAIO)}, nome: file.name, mime: file.type, tamanho: file.size }) });
      const s = await ass.json().catch(() => null);
      if (!ass.ok) return { etapa: 'assinar', status: ass.status, s };

      const put = await fetch(${JSON.stringify(SUPA)} + '/storage/v1/object/upload/sign/wa-midia/' + s.path + '?token=' + encodeURIComponent(s.token),
        { method: 'PUT', headers: { 'content-type': file.type, 'x-upsert': 'true' }, body: file });
      if (!put.ok) return { etapa: 'storage', status: put.status };

      const res = await fetch('/api/chat/enviar-midia', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cliente_id: ${JSON.stringify(ENSAIO)}, path: s.path, mime: s.mime, nome: s.nome }) });
      return { tamanho: file.size, mimeEnviado: s.mime, status: res.status, corpo: await res.json().catch(() => null) };
    })();`);
  if (r.erro) throw new Error(r.erro);
  conferir(r.status === 200, "o envio do áudio gravado em webm é aceito", JSON.stringify(r).slice(0, 220));
  conferir(r.corpo?.tipo === "audio", "ele sai como ÁUDIO, não como documento", `mime enviado ${r.mimeEnviado} → tipo ${r.corpo?.tipo}`);

  if (r.corpo?.wamid) {
    const { data } = await sb.from("mensagens").select("midia_tipo,midia_mime,midia_nome").eq("id", r.corpo.wamid).maybeSingle();
    conferir(data?.midia_mime === "audio/ogg" && data?.midia_tipo === "audio",
      "o arquivo guardado foi convertido para Ogg (o que o WhatsApp entrega)",
      `${data?.midia_tipo} · ${data?.midia_mime} · ${data?.midia_nome}`);
  }
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
