import { sbAdmin, guardaAdmin, texto } from "../../../../lib/adminApi";
import {
  subirImagemDeCabecalho, criarTemplate, statusNaMeta, apagarNaMeta, metaNomeDe,
} from "../../../../lib/whatsappTemplates";

export const dynamic = "force-dynamic";

// Criar template do WhatsApp por dentro do sistema (migration 0090).
//
// O que esta rota faz que a /api/templates não faz: aquela cadastra um PONTEIRO
// para um template que já existe no RD (nome + id, texto fora daqui). Esta CRIA
// o template na Meta — texto, cabeçalho e imagem — e guarda o cadastro completo.
//
// Escopo de escrita: só a WABA de WHATSAPP_WABA_ID, que hoje é a linha piloto.
// O token do CRM sequer enxerga a WABA de produção desde 15/08 (§20.4), então o
// raio disto é a conta piloto por construção, não por trava em código.

const COLS =
  "id,nome,ativo,padrao,criado_em,canal,meta_nome,meta_id,idioma,categoria," +
  "corpo,rodape,cabecalho_tipo,cabecalho_texto,imagem_path,usa_nome,status,motivo_recusa,criado_por,atualizado_em";

const IMAGENS_ACEITAS = ["image/jpeg", "image/png"];
const TAMANHO_MAX = 5 * 1024 * 1024;   // teto da Meta para imagem de cabeçalho

/** Traduz o status da Meta para o que a tela mostra. */
function legivel(status: string | null): string | null {
  const s = String(status ?? "").toUpperCase();
  if (!s) return null;
  const mapa: Record<string, string> = {
    APPROVED: "aprovado", PENDING: "em análise", REJECTED: "recusado",
    PAUSED: "pausado", DISABLED: "desativado", IN_APPEAL: "em recurso",
    PENDING_DELETION: "sendo removido",
  };
  return mapa[s] ?? s.toLowerCase();
}

export async function GET() {
  const g = guardaAdmin("ver os templates");
  if (g.erro) return g.erro;

  const db = sbAdmin();
  const { data, error } = await db.from("crm_templates").select(COLS).order("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Sincroniza o status dos templates da Cloud com a Meta a cada abertura da
  // tela. É uma chamada só (lista a conta inteira), e sem isso o admin fica
  // olhando "em análise" para sempre — a Meta não avisa ninguém quando aprova.
  //
  // Falha aqui NÃO derruba a listagem: a tela ainda serve para ver o que existe,
  // e o aviso diz que o status pode estar velho.
  let avisoMeta: string | null = null;
  const linhas = (data ?? []) as any[];
  const daCloud = linhas.filter((t) => t.canal === "cloud" && t.meta_nome);
  if (daCloud.length) {
    try {
      const naMeta = await statusNaMeta();
      for (const t of daCloud) {
        const m = naMeta.get(t.meta_nome);
        const novo = m?.status ?? "REMOVIDO_NA_META";
        const motivo = m?.motivo ?? null;
        if (novo !== t.status || motivo !== t.motivo_recusa) {
          t.status = novo; t.motivo_recusa = motivo;
          await db.from("crm_templates")
            .update({ status: novo, motivo_recusa: motivo, meta_id: m?.id ?? t.meta_id, atualizado_em: new Date().toISOString() })
            .eq("id", t.id);
        }
      }
    } catch (e: any) {
      avisoMeta = `Não consegui falar com a Meta agora — o status abaixo pode estar desatualizado. (${e?.message ?? e})`;
    }
  }

  return Response.json({
    "templates-whatsapp": linhas.map((t) => ({ ...t, status_legivel: legivel(t.status) })),
    aviso: avisoMeta,
    waba: (process.env.WHATSAPP_WABA_ID ?? "").replace(/[^\x21-\x7E]/g, "") || null,
  });
}

export async function POST(req: Request) {
  const g = guardaAdmin("criar template");
  if (g.erro) return g.erro;

  // multipart porque pode vir arquivo junto — JSON exigiria base64 no corpo
  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: "envio inválido" }, { status: 400 }); }

  const nome = texto(form.get("nome"));
  const corpo = texto(form.get("corpo"));
  const categoria = texto(form.get("categoria")) || "MARKETING";
  const rodape = texto(form.get("rodape"));
  const cabecalhoTexto = texto(form.get("cabecalho_texto"));
  const arquivo = form.get("imagem");
  const temImagem = arquivo instanceof File && arquivo.size > 0;

  if (!nome) return Response.json({ error: "dê um nome ao template" }, { status: 400 });
  if (!corpo) return Response.json({ error: "o texto do template não pode ficar vazio" }, { status: 400 });
  if (corpo.length > 1024) return Response.json({ error: "o texto passa de 1024 caracteres, o limite da Meta" }, { status: 400 });
  if (rodape.length > 60) return Response.json({ error: "o rodapé passa de 60 caracteres, o limite da Meta" }, { status: 400 });
  if (cabecalhoTexto.length > 60) return Response.json({ error: "o cabeçalho passa de 60 caracteres, o limite da Meta" }, { status: 400 });
  if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(categoria)) {
    return Response.json({ error: "categoria inválida" }, { status: 400 });
  }
  if (temImagem && cabecalhoTexto) {
    // a Meta aceita UM cabeçalho por template; deixar os dois passarem faria a
    // recusa acontecer lá, minutos depois, sem o admin entender por quê
    return Response.json({ error: "escolha imagem OU cabeçalho de texto — a Meta aceita só um" }, { status: 400 });
  }

  // {{1}} é o primeiro nome do cliente. É a única variável que o envio sabe
  // preencher hoje; qualquer outra viraria template aprovado e inenviável.
  const variaveis = corpo.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  const usaNome = variaveis.length > 0;
  if (variaveis.some((v) => !/\{\{\s*1\s*\}\}/.test(v))) {
    return Response.json({ error: "por enquanto só {{1}} (o primeiro nome do cliente) é aceito no texto" }, { status: 400 });
  }

  const db = sbAdmin();
  const metaNome = metaNomeDe(nome);
  const { data: jaTem } = await db.from("crm_templates").select("id").eq("meta_nome", metaNome).maybeSingle();
  if (jaTem) return Response.json({ error: `já existe um template com o identificador "${metaNome}"` }, { status: 409 });

  // ---- imagem: sobe para o nosso bucket E para a Meta -----------------------
  // São dois destinos com finalidades diferentes, e os dois são necessários:
  // o handle da Meta serve para APROVAR o template (é o exemplo que o revisor
  // vê); o arquivo no bucket é o que será enviado a cada disparo, por URL
  // assinada na hora. O handle não serve para enviar, e o link não serve para
  // aprovar — trocar um pelo outro quebra em momentos diferentes.
  let imagemPath: string | null = null;
  let handle: string | null = null;
  if (temImagem) {
    const f = arquivo as File;
    if (!IMAGENS_ACEITAS.includes(f.type)) {
      return Response.json({ error: "a imagem precisa ser JPEG ou PNG" }, { status: 400 });
    }
    if (f.size > TAMANHO_MAX) {
      return Response.json({ error: "a imagem passa de 5 MB, o limite da Meta" }, { status: 400 });
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const ext = f.type === "image/png" ? "png" : "jpg";
    imagemPath = `templates/${metaNome}-${Date.now()}.${ext}`;

    const { error: eUp } = await sbAdmin().storage.from("wa-midia")
      .upload(imagemPath, bytes, { contentType: f.type, upsert: true });
    if (eUp) return Response.json({ error: `não consegui guardar a imagem: ${eUp.message}` }, { status: 500 });

    try {
      handle = await subirImagemDeCabecalho(bytes, f.type, `${metaNome}.${ext}`);
    } catch (e: any) {
      return Response.json({ error: `a Meta recusou a imagem: ${e?.message ?? e}` }, { status: 502 });
    }
  }

  // ---- criação na Meta ------------------------------------------------------
  let criado: { id: string; status: string };
  try {
    criado = await criarTemplate({
      metaNome, categoria: categoria as any, idioma: "pt_BR", corpo, usaNome,
      rodape: rodape || null,
      cabecalhoTexto: cabecalhoTexto || null,
      imagemHandle: handle,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }

  // Só grava depois que a Meta aceitou. Gravar antes deixaria template fantasma
  // na nossa lista se a criação falhasse — e alguém tentaria enviá-lo.
  const { data, error } = await db.from("crm_templates").insert({
    nome,
    canal: "cloud",
    meta_nome: metaNome,
    meta_id: criado.id || null,
    idioma: "pt_BR",
    categoria,
    corpo,
    rodape: rodape || null,
    cabecalho_tipo: handle ? "imagem" : cabecalhoTexto ? "texto" : "nenhum",
    cabecalho_texto: cabecalhoTexto || null,
    imagem_path: imagemPath,
    usa_nome: usaNome,
    status: criado.status || "PENDING",
    ativo: true,
    padrao: false,
    criado_por: g.email,
  }).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    ok: true,
    template: { ...(data as any), status_legivel: legivel((data as any).status) },
    aviso: "Enviado para análise da Meta. Costuma levar de alguns minutos a algumas horas; o status atualiza sozinho ao abrir esta tela.",
  });
}

export async function PATCH(req: Request) {
  const g = guardaAdmin("alterar template");
  if (g.erro) return g.erro;

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const id = Number(b?.id);
  if (!Number.isInteger(id)) return Response.json({ error: "id ausente" }, { status: 400 });

  const db = sbAdmin();
  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (typeof b.ativo === "boolean") patch.ativo = b.ativo;

  if (b.padrao === true) {
    // só um padrão por vez (índice único parcial já existente em crm_templates)
    const { data: alvo } = await db.from("crm_templates").select("canal,status").eq("id", id).maybeSingle();
    if (alvo?.canal === "cloud" && String(alvo?.status ?? "").toUpperCase() !== "APPROVED") {
      return Response.json({ error: "só um template aprovado pela Meta pode ser o padrão" }, { status: 409 });
    }
    await db.from("crm_templates").update({ padrao: false }).eq("padrao", true);
    patch.padrao = true;
  } else if (b.padrao === false) {
    patch.padrao = false;
  }

  const { data, error } = await db.from("crm_templates").update(patch).eq("id", id).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, template: { ...(data as any), status_legivel: legivel((data as any).status) } });
}

export async function DELETE(req: Request) {
  const g = guardaAdmin("apagar template");
  if (g.erro) return g.erro;

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "id ausente" }, { status: 400 });

  const db = sbAdmin();
  const { data: t } = await db.from("crm_templates").select("canal,meta_nome,padrao").eq("id", id).maybeSingle();
  if (!t) return Response.json({ error: "template não encontrado" }, { status: 404 });
  if (t.padrao) return Response.json({ error: "este é o template padrão — escolha outro padrão antes de apagar" }, { status: 409 });

  // Apagar na Meta é irreversível e o nome fica bloqueado por 30 dias para
  // recriação. Por isso a tela pede confirmação escrita antes de chegar aqui.
  if (t.canal === "cloud" && t.meta_nome) {
    try { await apagarNaMeta(t.meta_nome as string); }
    catch (e: any) { return Response.json({ error: `a Meta recusou apagar: ${e?.message ?? e}` }, { status: 502 }); }
  }

  const { error } = await db.from("crm_templates").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
