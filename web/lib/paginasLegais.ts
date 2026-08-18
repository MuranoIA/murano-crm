import { createClient } from "@supabase/supabase-js";

// Dados que preenchem /privacidade e /termos (`paginas_legais`, migration 0088).
//
// A leitura é feita com service_role porque a tabela tem RLS ligado sem policy,
// como todo o resto do banco (§12.5) — e porque a página é renderizada no
// servidor: a chave nunca chega ao navegador de quem lê a política.

export type DadosLegais = {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  endereco: string;
  cidade_uf: string;
  cep: string;
  telefone: string;
  whatsapp: string;
  email_contato: string;
  encarregado: string;
  email_privacidade: string;
  retencao_meses: number;
  vigencia: string;
};

export const COLS_LEGAIS =
  "nome_fantasia,razao_social,cnpj,endereco,cidade_uf,cep,telefone,whatsapp," +
  "email_contato,encarregado,email_privacidade,retencao_meses,vigencia,atualizado_em,atualizado_por";

/** Usado quando a tabela ainda não existe ou o banco não responde. */
export const PADRAO_LEGAIS: DadosLegais = {
  nome_fantasia: "Murano Professional",
  razao_social: "",
  cnpj: "",
  endereco: "",
  cidade_uf: "",
  cep: "",
  telefone: "",
  whatsapp: "",
  email_contato: "",
  encarregado: "",
  email_privacidade: "",
  retencao_meses: 60,
  vigencia: "",
};

/**
 * Nunca lança. Uma página de política que devolve 500 é pior do que uma página
 * com um campo a menos: a Meta lê essa URL para liberar o app, e um erro
 * momentâneo do banco no instante da revisão custaria o ciclo inteiro.
 */
export async function lerDadosLegais(): Promise<DadosLegais> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return PADRAO_LEGAIS;
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await sb.from("paginas_legais").select(COLS_LEGAIS).eq("id", 1).maybeSingle();
    return data ? { ...PADRAO_LEGAIS, ...(data as any) } : PADRAO_LEGAIS;
  } catch {
    return PADRAO_LEGAIS;
  }
}

/** "2026-08-18" -> "18 de agosto de 2026". Vazio devolve vazio. */
export function dataPorExtenso(iso: string): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${Number(m[3])} de ${meses[Number(m[2]) - 1]} de ${m[1]}`;
}

/**
 * Como a empresa se identifica no texto: razão social com o nome fantasia entre
 * parênteses, ou o que houver. Sem isso, cada frase precisaria de um `??` e o
 * texto ficaria ilegível no código.
 */
export function identificacao(d: DadosLegais): string {
  if (d.razao_social && d.nome_fantasia && d.razao_social !== d.nome_fantasia) {
    return `${d.razao_social} ("${d.nome_fantasia}")`;
  }
  return d.razao_social || d.nome_fantasia || "a empresa";
}

/** Campos que a Meta e a LGPD cobram. Alimenta o aviso do /admin — não a página pública. */
export const OBRIGATORIOS: { campo: keyof DadosLegais; rotulo: string }[] = [
  { campo: "razao_social", rotulo: "Razão social" },
  { campo: "cnpj", rotulo: "CNPJ" },
  { campo: "endereco", rotulo: "Endereço" },
  { campo: "cidade_uf", rotulo: "Cidade/UF" },
  { campo: "email_privacidade", rotulo: "E-mail de privacidade" },
];

export function pendencias(d: DadosLegais): string[] {
  return OBRIGATORIOS.filter((o) => !String(d[o.campo] ?? "").trim()).map((o) => o.rotulo);
}
