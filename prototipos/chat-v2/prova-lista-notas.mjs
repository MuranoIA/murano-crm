// -----------------------------------------------------------------------------
// A LISTA DE NOTAS, COM SALTO ATÉ ELA (demanda #55, 29/09/2026)
//
//   ENSAIO_VISIVEL=1 npx next start -p 3120     (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-lista-notas.mjs
//
// O caso de uso do dono: "atualmente é necessário a consultora procurar a nota
// na conversa rolando a conversa, isso faz perder tempo".
//
// A prova monta o caso difícil de propósito: uma nota ANTIGA, com 120 mensagens
// depois dela. Assim a nota fica fora da janela virtual — e é exatamente aí que
// um "ir até aqui" falha em silêncio, porque `querySelector` não acha o que não
// foi montado.
//
// Tudo na faixa reservada de ensaio, apagado no `finally`.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const TEL = "5591900000" + "95";
const ID = `wa:${TEL}`;
const MARCA = `notas-${Date.now()}`;
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9621 });
let notaAntiga = null;
try {
  // ---- o cenário ---------------------------------------------------------
  await sb.from("clientes").upsert(
    { id: ID, nome_completo: "ENSAIO notas (não é cliente)", telefone: TEL, carteira: null },
    { onConflict: "id" },
  );
  const { data: ref } = await sb.from("mensagens")
    .select("linha_id").not("linha_id", "is", null).limit(1).maybeSingle();
  const LINHA = ref?.linha_id ?? null;

  const base = Date.now() - 6 * 3600_000;
  // a nota primeiro…
  const { data: nota } = await sb.from("chat_nota").insert({
    cliente_id: ID, autor: "ia@muranoprofessional.com.br",
    texto: `MARCADOR ${MARCA} — a nota que a lista tem de achar`,
    criada_em: new Date(base).toISOString(),
  }).select("id").single();
  notaAntiga = nota?.id ?? null;

  // …e 120 mensagens DEPOIS dela, para empurrá-la para fora da janela visível
  const msgs = Array.from({ length: 120 }, (_, i) => ({
    id: `${MARCA}.${i}`, cliente_id: ID,
    enviada_por: i % 2 ? "customer" : "operator", tipo: "mensagem",
    conteudo: `mensagem de ensaio ${i}`, status: "success",
    criada_em: new Date(base + (i + 1) * 60_000).toISOString(),
    linha_id: LINHA,
  }));
  for (let i = 0; i < msgs.length; i += 60) {
    await sb.from("mensagens").upsert(msgs.slice(i, i + 60), { onConflict: "id" });
  }

  // ---- a tela ------------------------------------------------------------
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ID)}`, { esperar: 3000 });
  await a.ate(`document.querySelector('textarea')`, { ms: 25_000 });
  await espera(1500);

  const botao = await a.js(`
    const b = document.querySelector('button[aria-label="Notas internas"]');
    return b ? { existe: true, badge: (b.textContent||'').trim() } : { existe: false };`);
  conferir(botao.existe, "o botão de nota continua onde sempre esteve", `badge "${botao.badge}"`);
  conferir(botao.badge === "1", "…com o número de notas da conversa, que é o que faz a lista ser descoberta");

  // a nota está FORA da tela: é o caso que importa
  const antes = await a.js(`
    const el = document.querySelector('.rolagem [data-item^="nota-"]');
    if (!el) return { montada: false };
    const r = el.getBoundingClientRect();
    return { montada: true, visivel: r.top > 0 && r.bottom < window.innerHeight };`);
  conferir(!antes.montada || !antes.visivel, "a nota começa FORA da vista — é o caso que faz perder tempo",
    JSON.stringify(antes));

  await a.js(`document.querySelector('button[aria-label="Notas internas"]').click(); return true;`);
  const abriu = await a.ate(`/Escrever nota interna/.test(document.body.textContent || '')`, { ms: 8000 });
  const menu = await a.js(`
    const m = document.querySelector('[role="menu"]');
    return m ? {
      // ⚠️ sem cortar em 40: o corte comia o fim do marcador e a prova acusava
      // ausência do que estava lá (aconteceu na 1ª rodada)
      itens: [...m.querySelectorAll('[role="menuitem"]')].map(x => x.textContent.trim()),
      temLista: /notas desta conversa/i.test(m.textContent || ''),
    } : null;`);
  conferir(abriu && !!menu, "o botão abre um menu, não liga a nota direto");
  conferir(
    menu?.itens.some((i) => /Escrever nota/.test(i)),
    "com a função que já existia em primeiro — e no mesmo lugar de sempre",
  );
  conferir(
    menu?.temLista && menu.itens.some((i) => /MARCADOR/.test(i)),
    "…e a lista de notas desta conversa, que é o que faltava",
    menu?.itens.join(" | ").slice(0, 80),
  );
  await a.foto("lista-notas-menu");

  // ---- o salto -----------------------------------------------------------
  await a.js(`
    const m = document.querySelector('[role="menu"]');
    const b = [...m.querySelectorAll('[role="menuitem"]')].find(x => /MARCADOR/.test(x.textContent||''));
    b.click(); return true;`);
  await espera(2000);

  const depois = await a.js(`
    const el = document.querySelector('.rolagem [data-item^="nota-"]');
    if (!el) return { montada: false };
    const r = el.getBoundingClientRect();
    const caixa = el.querySelector('div');
    return {
      montada: true,
      visivel: r.top > 0 && r.bottom < window.innerHeight,
      realce: caixa ? caixa.className.includes('ring-2') : false,
    };`);
  conferir(depois.montada, "clicar na nota MONTA o item, mesmo fora da janela virtual", JSON.stringify(depois));
  conferir(depois.visivel, "…e a conversa salta até ela");
  conferir(depois.realce, "…com realce, para não ser preciso procurar de novo o que se acabou de pedir");
  await a.foto("lista-notas-salto");

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  if (notaAntiga) await sb.from("chat_nota").delete().eq("id", notaAntiga);
  await sb.from("mensagens").delete().like("id", `${MARCA}%`);
  await sb.from("chat_conversa").delete().eq("cliente_id", ID);
  await sb.from("clientes").delete().eq("id", ID);
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
