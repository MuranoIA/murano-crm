import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { lerCrmConfig, filtroLinhas, VIEW_FUNIL_TELA } from "../../../../lib/crmConfig";
import { textoDoTemplate } from "../../../../lib/templateTexto";
import { nomeComCodigo } from "../../../../lib/nomeCliente";
import { Pdf, winAnsi, type Cor } from "../../../../lib/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // zlib e Buffer — o gerador de PDF não roda em edge
export const maxDuration = 60;

/**
 * A conversa inteira em PDF, para baixar.
 *
 * ESCOPO — mesma régua do /api/chat/thread, de propósito: exige sessão do CRM e
 * NÃO filtra por carteira. `mensagens` guarda a carteira de QUANDO a mensagem
 * saiu, então filtrar por ela cortaria o histórico de quem trocou de RCA — e um
 * documento com buraco no meio é pior que documento nenhum.
 *
 * SELEÇÃO DE LINHAS: obedece `linhas_visiveis` como a tela, via `filtroLinhas`.
 * O PDF esconde o que a tela esconde — senão o botão de baixar viraria a porta
 * dos fundos daquela seleção.
 *
 * ⚠️ Houve aqui um `?historico=1`, para trazer também o que a seleção esconde.
 * Ele dependia da chave `historico_rd`, removida com o RD (§69) junto do botão
 * que a ligava. Um parâmetro que nunca pode ser verdadeiro é código morto que
 * ninguém percebe estar quebrado — saiu inteiro.
 */
export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const cliente_id = params.get("cliente_id");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const cfg = await lerCrmConfig(sb);
  // As fotos dobram ou triplicam o tempo da rota (cada uma é um download do
  // Storage). Quem só quer o texto pede `?fotos=0` e recebe o documento na hora.
  const querFotos = params.get("fotos") !== "0";

  // Teto de mensagens. Uma cliente de anos passa de mil; o documento continua
  // sendo o registro da conversa, mas alguém precisa dizer que foi cortado — e
  // o corte é pelo COMEÇO, porque o fim é o que interessa.
  const TETO = 2500;

  const COLS = "id,conteudo,enviada_por,tipo,status,criada_em,midia_tipo,midia_mime,midia_nome,midia_path,linha_id,reacao,erro,localizacao";
  const consultaMsgs = (cols: string) => {
    const q = sb.from("mensagens").select(cols).eq("cliente_id", cliente_id)
      .order("criada_em", { ascending: false }).limit(TETO + 1);
    return filtroLinhas(q, cfg);
  };

  const [cliRes, funilRes, msgsRes, notasRes, transfRes, ligRes, linhasRes] = await Promise.all([
    sb.from("clientes").select("id,nome_completo,telefone,carteira").eq("id", cliente_id).maybeSingle(),
    sb.from(VIEW_FUNIL_TELA).select("cliente,codcli,etapa").eq("cliente_id", cliente_id).maybeSingle(),
    consultaMsgs(COLS),
    sb.from("chat_nota").select("id,autor,texto,criada_em").eq("cliente_id", cliente_id).order("criada_em", { ascending: true }),
    sb.from("chat_transferencia").select("de_carteira,para_carteira,por,observacao,criada_em").eq("cliente_id", cliente_id).order("criada_em", { ascending: true }),
    sb.from("chat_ligacao").select("direcao,status,por,iniciada_em,duracao_seg,motivo,observacao").eq("cliente_id", cliente_id).order("iniciada_em", { ascending: true }).limit(300),
    sb.from("chat_linha").select("phone_number_id,rotulo"),
  ]);

  // rede de proteção da coluna `localizacao` (0115), igual à da thread: perder o
  // cartão de mapa é aceitável, perder o documento inteiro não
  let brutas: any[] = (msgsRes.data as any[]) ?? [];
  let erroMsg: any = msgsRes.error;
  if (erroMsg && /localizacao/i.test(erroMsg.message ?? "")) {
    const r2 = await consultaMsgs(COLS.replace(",localizacao", ""));
    brutas = (r2.data as any[]) ?? []; erroMsg = r2.error;
  }
  if (erroMsg) return Response.json({ error: erroMsg.message }, { status: 500 });

  const cortado = brutas.length > TETO;
  const mensagens = brutas.slice(0, TETO).filter((m) => m.tipo !== "evento_sistema").reverse();
  const cli: any = cliRes.data ?? null;
  const funil: any = funilRes.data ?? null;
  await textoDoTemplate(sb, mensagens, cli?.nome_completo ?? funil?.cliente);

  const nome = String(funil?.cliente || cli?.nome_completo || "Contato sem nome").trim();
  const nomeExibido = nomeComCodigo(nome, funil?.codcli);
  const rotuloLinha = new Map(((linhasRes.data as any[]) ?? []).map((l) => [l.phone_number_id, l.rotulo]));

  // ---- fotos ---------------------------------------------------------------
  // Só JPEG entra embutido; o resto vira marcador (ver o cabeçalho de lib/pdf).
  // Limites por documento, para a rota não estourar os 60 s nem a memória da
  // função: uma conversa de salão tem foto demais para baixar todas.
  // ⚠️ O ORÇAMENTO É EM BYTES, não só em quantidade. A foto entra no PDF do
  // jeito que o WhatsApp mandou (não há como recomprimir sem uma biblioteca de
  // imagem), e uma conversa de salão com 53 fotos produziu um documento de
  // 45 MB — medido em 09/09/2026. Documento que não cabe num e-mail não é
  // documento. As mais RECENTES entram primeiro; o que não couber vira
  // marcador, e a capa diz quantas ficaram de fora.
  //
  // E ha um PRAZO, alem do orcamento. O mesmo documento levou 14 s numa medicao
  // e 155 s em outra (09/09/2026) -- o que muda e a rede ate o Storage, que nao
  // esta sob nosso controle. Sem prazo, a funcao estoura os 60 s da Vercel e o
  // usuario recebe um erro em vez do documento. Com prazo, ele recebe o
  // documento com menos fotos, e a capa diz quantas ficaram de fora.
  const MAX_FOTOS = 40, MAX_BYTES = 2.5 * 1024 * 1024, ORCAMENTO = 12 * 1024 * 1024;
  const PRAZO_FOTOS = 25_000;
  const candidatas = querFotos
    ? mensagens.filter((m) => (m.midia_tipo === "image" || m.midia_tipo === "sticker")
        && m.midia_path && /jpe?g/i.test(String(m.midia_mime ?? "")))
    : [];
  const paraBaixar = candidatas.slice(-MAX_FOTOS); // as mais recentes, se houver corte
  const brutas_fotos = new Map<string, Buffer>();
  const baixando = Promise.all(paraBaixar.map(async (m) => {
    try {
      const { data } = await sb.storage.from("wa-midia").download(m.midia_path as string);
      if (!data) return;
      const buf = Buffer.from(await data.arrayBuffer());
      if (buf.length <= MAX_BYTES) brutas_fotos.set(m.id, buf);
    } catch { /* foto que não desce vira marcador — nunca derruba o documento */ }
  }));
  // As que não chegarem a tempo seguem baixando até a função morrer; o que
  // importa é que o documento sai com o que já está na mão.
  await Promise.race([baixando, new Promise((r) => setTimeout(r, PRAZO_FOTOS))]);
  // gasta o orçamento de trás para frente: numa conversa longa, a foto que
  // interessa é a de ontem, não a de abril
  const baixadas = new Map<string, Buffer>();
  let gasto = 0;
  for (let i = paraBaixar.length - 1; i >= 0; i--) {
    const buf = brutas_fotos.get(paraBaixar[i].id);
    if (!buf || gasto + buf.length > ORCAMENTO) continue;
    baixadas.set(paraBaixar[i].id, buf);
    gasto += buf.length;
  }

  // ---- linha do tempo ------------------------------------------------------
  type Item =
    | { em: string; k: "msg"; m: any }
    | { em: string; k: "nota"; n: any }
    | { em: string; k: "marco"; texto: string };
  const itens: Item[] = [
    ...mensagens.map((m): Item => ({ em: m.criada_em, k: "msg", m })),
    ...(((notasRes.data as any[]) ?? []).map((n): Item => ({ em: n.criada_em, k: "nota", n }))),
    ...(((transfRes.data as any[]) ?? []).map((t): Item => ({
      em: t.criada_em, k: "marco",
      texto: `Conversa transferida${t.de_carteira ? ` de ${cap(t.de_carteira)}` : ""} ${t.para_carteira ? `para ${cap(t.para_carteira)}` : "para a fila de espera"}${t.por ? ` por ${t.por}` : ""}${t.observacao ? ` — ${t.observacao}` : ""}`,
    }))),
    ...(((ligRes.data as any[]) ?? []).map((l): Item => ({
      em: l.iniciada_em, k: "marco",
      texto: `Ligação ${l.direcao === "entrada" ? "recebida" : "realizada"} · ${l.status ?? "?"}${l.duracao_seg ? ` · ${duracao(l.duracao_seg)}` : ""}${l.motivo ? ` · ${l.motivo}` : ""}${l.observacao ? ` — ${l.observacao}` : ""}`,
    }))),
  ].sort((a, b) => String(a.em).localeCompare(String(b.em)));

  const pdf = montar({
    pdf: new Pdf({ titulo: `Conversa — ${nomeExibido}` }),
    nomeExibido, cli, funil, itens, itensCortados: cortado,
    baixadas, geradoPor: sessao,
    linhas: [...new Set(mensagens.map((m) => rotuloLinha.get(m.linha_id) ?? (m.linha_id ? "linha nova" : rotuloLinha.get("rd") ?? "RD Conversas")))],
    fotosOmitidas: querFotos ? Math.max(0, candidatas.length - baixadas.size) : candidatas.length,
    semFotos: !querFotos,
  });

  const arquivo = `conversa-${slug(nomeExibido)}-${new Date().toISOString().slice(0, 10)}.pdf`;

  // ---- o PDF NÃO volta no corpo da resposta -------------------------------
  //
  // A Vercel corta o corpo de uma função em 4,5 MB — foi o que derrubou o envio
  // de mídia em 29/08/2026 (PR #150), e um documento com 50 fotos passa disso
  // com folga (medido: 12,6 MB na conversa mais pesada do banco). A saída é a
  // mesma que aquele PR adotou e que o /api/chat/midia já usava: os bytes vão
  // para o Storage e o navegador baixa direto de lá. Um caminho só, sem um
  // limite invisível esperando a primeira conversa grande.
  //
  // Mesmo bucket privado da mídia, porque é o mesmo tipo de dado — conversa de
  // cliente — e o acesso continua sendo por URL assinada de vida curta.
  const caminho = `conversas-pdf/${cliente_id}/${arquivo}`;
  const up = await sb.storage.from("wa-midia").upload(caminho, pdf, {
    contentType: "application/pdf", upsert: true,
  });
  if (up.error) return Response.json({ error: `falha ao guardar o PDF: ${up.error.message}` }, { status: 500 });

  // Um PDF por cliente: o anterior sai agora, na geração seguinte. Sem isto o
  // bucket cresceria para sempre e ninguém notaria — não há cron limpando aqui.
  try {
    const { data: antigos } = await sb.storage.from("wa-midia").list(`conversas-pdf/${cliente_id}`);
    const sobras = (antigos ?? []).map((f) => `conversas-pdf/${cliente_id}/${f.name}`).filter((c) => c !== caminho);
    if (sobras.length) await sb.storage.from("wa-midia").remove(sobras);
  } catch { /* sobra no bucket não é motivo para negar o download */ }

  // `download` faz o Supabase mandar Content-Disposition: attachment com este
  // nome — sem isso o navegador ABRIRIA o PDF numa aba, e dentro do iframe do
  // hub isso é uma aba que o usuário não pediu.
  const { data: assinada, error: erroUrl } = await sb.storage.from("wa-midia")
    .createSignedUrl(caminho, 600, { download: arquivo });
  if (erroUrl || !assinada?.signedUrl) {
    return Response.json({ error: erroUrl?.message ?? "falha ao assinar a URL" }, { status: 500 });
  }
  return Response.json({ url: assinada.signedUrl, arquivo, bytes: pdf.length });
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

const hex = (h: string): Cor => [
  parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255,
];
// paleta Murano: vinho é a marca, azul é a nossa fala, papel amarelo é nota interna
const VINHO = hex("#621244"), AZUL = hex("#1a5fa8");
const TINTA = hex("#1f1b24"), CINZA = hex("#6b6577"), BORDA = hex("#dcd8e0");
const BOLHA_CLI = hex("#f4f2f6"), BOLHA_NOS = hex("#e8f0fa"), NOTA = hex("#fdf6da"), NOTA_BORDA = hex("#e8d9a0");

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "contato";
const duracao = (seg: number) => `${Math.floor(seg / 60)}min ${seg % 60}s`;

// Brasília (BRT, UTC-3) — o mesmo fuso do resto do sistema. Sem isto o documento
// dataria as mensagens em UTC e a conversa da noite apareceria no dia seguinte.
const BRT = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
const diaBR = (iso: string) => { const d = BRT(iso); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };
const horaBR = (iso: string) => { const d = BRT(iso); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const diaPorExtenso = (iso: string) => `${DIAS[BRT(iso).getUTCDay()]}, ${diaBR(iso)}`;

const TIQUE: Record<string, string> = {
  wait: "enviada", success: "entregue", read: "lida", checked: "lida", failed: "NÃO ENTREGUE",
};

function montar(a: {
  pdf: Pdf; nomeExibido: string; cli: any; funil: any;
  itens: any[]; itensCortados: boolean; baixadas: Map<string, Buffer>;
  geradoPor: string; linhas: string[];
  fotosOmitidas: number; semFotos: boolean;
}): Buffer {
  const p = a.pdf;
  const T = (s: string) => winAnsi(s);

  // ---- capa ---------------------------------------------------------------
  p.retangulo(0, 0, p.largura, 76, { fundo: VINHO });
  p.texto(p.margem, 20, T(a.nomeExibido), { fonte: "negrito", tam: 15, cor: [1, 1, 1] });
  const sub = [
    a.cli?.telefone ?? "sem telefone",
    a.cli?.carteira ? `carteira ${cap(a.cli.carteira)}` : null,
    a.funil?.etapa ? String(a.funil.etapa).replace(/_/g, " ") : null,
  ].filter(Boolean).join("  ·  ");
  p.texto(p.margem, 46, T(sub), { tam: 9.5, cor: hex("#e2cfdd") });
  p.y = 92;

  const msgs = a.itens.filter((i) => i.k === "msg");
  const periodo = msgs.length ? `${diaBR(msgs[0].em)} a ${diaBR(msgs[msgs.length - 1].em)}` : "sem mensagens";
  const ficha = [
    // ⚠️ "mensagem" + "s" dá "mensagems": o plural muda a raiz (-gem → -gens).
    // Conferido no PDF gerado de verdade — a capa dizia "174 mensagems".
    `${msgs.length} ${msgs.length === 1 ? "mensagem" : "mensagens"}  ·  ${periodo}`,
    a.linhas.filter(Boolean).length ? `Número: ${a.linhas.filter(Boolean).join(", ")}` : null,
    `Gerado por ${a.geradoPor} em ${diaBR(new Date().toISOString())} às ${horaBR(new Date().toISOString())}`,
    a.itensCortados ? "⚠ Conversa longa: o documento traz as mensagens mais recentes." : null,
    a.semFotos ? "As fotos foram omitidas a pedido."
      : a.fotosOmitidas
        ? (a.fotosOmitidas === 1
            ? "1 imagem não pôde ser embutida — aparece como marcador."
            : `${a.fotosOmitidas} imagens não puderam ser embutidas — aparecem como marcador.`)
        : null,
  ].filter(Boolean) as string[];
  p.retangulo(p.margem, p.y, p.larguraUtil, ficha.length * 12 + 14, { fundo: hex("#faf8fb"), borda: BORDA, raio: 5 });
  ficha.forEach((l, i) => p.texto(p.margem + 10, p.y + 8 + i * 12, T(l.replace("⚠", "!")), { tam: 8.5, cor: CINZA }));
  p.y += ficha.length * 12 + 14 + 14;

  // ---- linha do tempo -----------------------------------------------------
  let diaAtual = "";
  for (const item of a.itens) {
    const dia = diaBR(item.em);
    if (dia !== diaAtual) {
      diaAtual = dia;
      p.garantirEspaco(30);
      const rot = T(diaPorExtenso(item.em));
      const w = p.larguraTexto(rot, "negrito", 8) + 16;
      const x = p.margem + (p.larguraUtil - w) / 2;
      p.linha(p.margem, p.y + 9, x - 6, p.y + 9);
      p.linha(x + w + 6, p.y + 9, p.largura - p.margem, p.y + 9);
      p.retangulo(x, p.y + 1, w, 16, { fundo: hex("#f0edf2"), raio: 8 });
      p.texto(x + 8, p.y + 5, rot, { fonte: "negrito", tam: 8, cor: CINZA });
      p.y += 26;
    }
    if (item.k === "marco") { marco(p, T(item.texto), horaBR(item.em)); continue; }
    if (item.k === "nota") { nota(p, T, item.n); continue; }
    bolha(p, T, item.m, a.baixadas.get(item.m.id));
  }

  if (!a.itens.length) {
    p.texto(p.margem, p.y, T("Esta conversa ainda não tem mensagens."), { fonte: "italico", tam: 10, cor: CINZA });
  }

  // ---- rodapé -------------------------------------------------------------
  p.aoFinalizar((d, pag, total) => {
    d.linha(d.margem, d.altura - 34, d.largura - d.margem, d.altura - 34);
    // O documento leva nome, telefone e conversa de uma cliente: quem receber
    // uma cópia solta precisa saber o que tem na mão.
    d.texto(d.margem, d.altura - 27, T(`Murano Professional · documento interno · ${a.nomeExibido}`), { tam: 7.5, cor: CINZA });
    const r = T(`Página ${pag} de ${total}`);
    d.texto(d.largura - d.margem - d.larguraTexto(r, "normal", 7.5), d.altura - 27, r, { tam: 7.5, cor: CINZA });
  });

  return p.finalizar();
}

/** Bolha de mensagem: cliente à esquerda, nós à direita — como na tela. */
function bolha(p: Pdf, T: (s: string) => string, m: any, foto?: Buffer) {
  const nosso = m.enviada_por !== "customer";
  const larg = p.larguraUtil * 0.74;
  const padding = 9;
  const larguraTexto = larg - padding * 2;

  const linhas: string[] = [];
  // O conteúdo de uma mensagem de mídia costuma SER o nome do arquivo (ou um
  // marcador antigo como "[image]"). Com a foto embutida logo acima, escrever
  // "IMG-20260823-WA0025.jpg" embaixo dela é ruído — e sem a foto quem diz o
  // que houve ali é o marcador, que já carrega o nome.
  const bruto = String(m.conteudo ?? "").trim();
  // sem acento, sem caixa e com o espacamento achatado: as comparacoes abaixo
  // olham texto escrito por gente e por webhook, que difere em quebra de linha
  // e espaco a toa sem querer dizer outra coisa
  const semAcento = (x: string) =>
    x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const ehRotuloDaMidia = !!m.midia_tipo && (
    bruto === String(m.midia_nome ?? "")
    // "[image]" (marcador antigo do webhook) e "Áudio" (o rótulo por extenso,
    // que é o que a lista de conversas mostra) dizem a mesma coisa que a bolha
    // já vai dizer com a foto ou com o marcador logo abaixo
    || /^\[[^\]]+\]$/.test(bruto)
    // compara o texto JA SANITIZADO: o webhook poe um emoji de microfone na
    // frente do rotulo do audio, e comparar o texto bruto nunca casaria -- a
    // bolha saia com "Audio" sobre "[Audio: audio-....ogg]" (visto em 09/09)
    || semAcento(T(bruto).trim()) === semAcento(rotuloMidia(m.midia_tipo))
  );
  // ponto no mapa (0115). O `conteudo` de uma localização costuma SER o endereço
  // ou as próprias coordenadas, e aí a bolha saa com a mesma informação duas
  // vezes -- visto em 09/09/2026: "-1.3496655, -48.3739442" e, logo abaixo,
  // "[localização] (-1.3496655, -48.3739442)".
  const l = m.localizacao;
  const txtLoc = l
    ? T(`[localização] ${l.nome || ""} ${l.endereco || ""}`.trim() + ` (${l.lat}, ${l.lng})`)
    : "";
  const corpo = ehRotuloDaMidia ? "" : T(bruto);
  const corpoJaEstaNaLocalizacao = !!corpo && !!txtLoc
    && semAcento(txtLoc).includes(semAcento(corpo));
  if (corpo && !corpoJaEstaNaLocalizacao) linhas.push(...p.quebrar(corpo, larguraTexto, "normal", 9.5));
  else if (bruto && !corpo && !ehRotuloDaMidia) linhas.push("(emoji)"); // sobrou vazio depois do WinAnsi
  if (txtLoc) linhas.push(...p.quebrar(txtLoc, larguraTexto, "normal", 9.5));
  // mídia que não virou imagem embutida entra como marcador honesto, com o nome
  // do arquivo — assim quem lê sabe que houve um anexo ali
  if (m.midia_tipo && !foto) {
    linhas.push(T(`[${rotuloMidia(m.midia_tipo)}${m.midia_nome ? `: ${m.midia_nome}` : ""}]`));
  }
  let imgW = 0, imgH = 0, ref: { nome: string } | null = null;
  if (foto) {
    const reg = p.addJpeg(foto);
    if (reg) {
      const maxW = Math.min(larguraTexto, m.midia_tipo === "sticker" ? 110 : 250);
      const maxH = 260;
      const escala = Math.min(maxW / reg.w, maxH / reg.h, 1);
      imgW = reg.w * escala; imgH = reg.h * escala; ref = { nome: reg.nome };
    } else {
      linhas.push(T(`[${rotuloMidia(m.midia_tipo)}${m.midia_nome ? `: ${m.midia_nome}` : ""}]`));
    }
  }
  // depois da foto, e não antes: com a imagem embutida a bolha TEM conteúdo,
  // e o aviso ali embaixo era só ruído (visto em 09/09/2026 na conversa de teste)
  if (!linhas.length && !ref) linhas.push("(sem conteúdo)");

  const rodape = [
    m.tipo === "template" ? "template" : m.tipo === "auto" ? "automática" : null,
    nosso ? TIQUE[String(m.status ?? "")] ?? null : null,
    m.reacao ? "reagiu" : null,
  ].filter(Boolean).join(" · ");
  const alturaRodape = rodape || m.erro ? 11 : 0;
  const linhasErro = m.erro ? p.quebrar(T(String(m.erro)), larguraTexto, "italico", 7.5) : [];

  const alturaTexto = linhas.length * 12;
  const alturaImg = ref ? imgH + 6 : 0;
  const h = 14 + alturaImg + alturaTexto + alturaRodape + linhasErro.length * 9 + 8;

  p.garantirEspaco(h + 6);
  const x = nosso ? p.margem + p.larguraUtil - larg : p.margem;
  p.retangulo(x, p.y, larg, h, { fundo: nosso ? BOLHA_NOS : BOLHA_CLI, borda: BORDA, raio: 7 });
  p.texto(x + padding, p.y + 5, T(`${nosso ? "Murano" : "Cliente"} · ${horaBR(m.criada_em)}`),
    { fonte: "negrito", tam: 7, cor: nosso ? AZUL : CINZA });

  let cursor = p.y + 15;
  if (ref) { p.imagem(ref.nome, x + padding, cursor, imgW, imgH); cursor += imgH + 6; }
  linhas.forEach((l) => { p.texto(x + padding, cursor, l, { tam: 9.5, cor: TINTA }); cursor += 12; });
  if (rodape) { p.texto(x + padding, cursor, T(rodape), { tam: 7, cor: CINZA }); cursor += 11; }
  linhasErro.forEach((l) => { p.texto(x + padding, cursor, l, { fonte: "italico", tam: 7.5, cor: hex("#a32c12") }); cursor += 9; });

  p.y += h + 6;
}

/** Nota interna: papel amarelo e o aviso de que a cliente nunca viu isto. */
function nota(p: Pdf, T: (s: string) => string, n: any) {
  const larg = p.larguraUtil * 0.86;
  const linhas = p.quebrar(T(String(n.texto ?? "")), larg - 20, "normal", 9);
  const h = linhas.length * 11 + 26;
  p.garantirEspaco(h + 6);
  const x = p.margem + (p.larguraUtil - larg) / 2;
  p.retangulo(x, p.y, larg, h, { fundo: NOTA, borda: NOTA_BORDA, raio: 5 });
  p.texto(x + 10, p.y + 5, T(`NOTA INTERNA — não enviada à cliente · ${n.autor ?? ""} · ${horaBR(n.criada_em)}`),
    { fonte: "negrito", tam: 7, cor: hex("#7a5c12") });
  linhas.forEach((l, i) => p.texto(x + 10, p.y + 17 + i * 11, l, { tam: 9, cor: hex("#4a3c10") }));
  p.y += h + 6;
}

/** Transferência e ligação: centralizados, como marco da conversa. */
function marco(p: Pdf, texto: string, hora: string) {
  const linhas = p.quebrar(`${texto} · ${hora}`, p.larguraUtil * 0.8, "italico", 8);
  p.garantirEspaco(linhas.length * 11 + 8);
  linhas.forEach((l) => {
    const x = p.margem + (p.larguraUtil - p.larguraTexto(l, "italico", 8)) / 2;
    p.texto(x, p.y, l, { fonte: "italico", tam: 8, cor: CINZA });
    p.y += 11;
  });
  p.y += 6;
}

const rotuloMidia = (t: string) =>
  ({ image: "Imagem", audio: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha" } as Record<string, string>)[t] ?? "Anexo";
