import { headers } from "next/headers";
import { sbAdmin, guardaAdmin, corpo, texto } from "../../../../lib/adminApi";
import { COLS_LEGAIS, PADRAO_LEGAIS, pendencias, type DadosLegais } from "../../../../lib/paginasLegais";

export const dynamic = "force-dynamic";

// Variáveis das páginas públicas /privacidade e /termos
// (`paginas_legais`, linha única id=1, migration 0088).
//
// A escrita é sempre upsert em id=1, pelo mesmo motivo da rota de horário: a
// tabela é de linha única e um insert distraído criaria uma segunda
// configuração que as páginas nunca leriam — o admin editaria uma tela que não
// muda nada no site publicado.

/** URL onde as páginas estão sendo servidas — é o que se cola no painel da Meta. */
function origem(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

function urls(base: string) {
  return {
    privacidade: `${base}/privacidade`,
    termos: `${base}/termos`,
    // A Meta pede uma URL de "instruções de exclusão de dados". Não é página
    // separada de propósito: instrução solta, fora da política, envelhece
    // sozinha e passa a contradizer o documento principal.
    exclusao: `${base}/privacidade#exclusao-de-dados`,
  };
}

export async function GET() {
  const g = guardaAdmin("ver as páginas legais");
  if (g.erro) return g.erro;

  const { data, error } = await sbAdmin().from("paginas_legais").select(COLS_LEGAIS).eq("id", 1).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const dados = { ...PADRAO_LEGAIS, ...((data ?? {}) as any) } as DadosLegais;
  return Response.json({
    "paginas-legais": dados,   // a tela lê por este nome (mesmo da aba)
    pendencias: pendencias(dados),
    urls: urls(origem()),
    atualizado_em: (data as any)?.atualizado_em ?? null,
    atualizado_por: (data as any)?.atualizado_por ?? null,
  });
}

const LIMITE: Record<string, number> = {
  nome_fantasia: 120, razao_social: 200, cnpj: 30, endereco: 200, cidade_uf: 120,
  cep: 20, telefone: 40, whatsapp: 40, email_contato: 160, encarregado: 160, email_privacidade: 160,
};

export async function PUT(req: Request) {
  const g = guardaAdmin("alterar as páginas legais");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  const campo: Record<string, string> = {};
  for (const [nome, max] of Object.entries(LIMITE)) {
    const v = texto(b[nome]);
    if (v.length > max) return Response.json({ error: `${nome}: máximo de ${max} caracteres` }, { status: 400 });
    campo[nome] = v;
  }

  // E-mail preenchido precisa ser e-mail: este valor é impresso numa página
  // pública como o canal oficial de LGPD — um endereço com erro de digitação
  // vira pedido de exclusão que nunca chega a ninguém.
  for (const c of ["email_contato", "email_privacidade"]) {
    if (campo[c] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campo[c])) {
      return Response.json({ error: `${c}: e-mail inválido` }, { status: 400 });
    }
  }

  const retencao = Number(b.retencao_meses);
  if (!Number.isInteger(retencao) || retencao < 1 || retencao > 240) {
    return Response.json({ error: "a retenção precisa estar entre 1 e 240 meses" }, { status: 400 });
  }

  const vigencia = texto(b.vigencia);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigencia)) {
    return Response.json({ error: "data de vigência inválida" }, { status: 400 });
  }

  const { data, error } = await sbAdmin().from("paginas_legais").upsert({
    id: 1,
    ...campo,
    retencao_meses: retencao,
    vigencia,
    atualizado_em: new Date().toISOString(),
    atualizado_por: g.email,
  }, { onConflict: "id" }).select(COLS_LEGAIS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const dados = { ...PADRAO_LEGAIS, ...(data as any) } as DadosLegais;
  const falta = pendencias(dados);
  return Response.json({
    ok: true,
    "paginas-legais": dados,
    pendencias: falta,
    urls: urls(origem()),
    // vira sufixo do "salvo com sucesso" na tela: salvar com campo faltando é
    // permitido (rascunho), mas não pode passar despercebido
    aviso: falta.length ? `Ainda falta preencher: ${falta.join(", ")}.` : undefined,
  });
}
