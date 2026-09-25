// ---------------------------------------------------------------------------
// Aviso de entrega ao cliente pelo WhatsApp — o lado do Pulse do card #19 do
// Entregas (murano-app). CONTRATO: hub e Pulse dividem o MESMO banco; o hub é
// dono da fila (`ent_aviso_cliente`), das regras de quando avisar e do job no
// pg_cron; o Pulse é o ÚNICO que fala com a Meta.
//
// A rota `POST /api/interno/avisos-entrega` só confere o segredo e chama
// `processarAvisos`. Toda a regra mora aqui, com as dependências INJETADAS
// (banco, envio à Meta, contato, linha), para ser testada sem servidor e sem
// mandar mensagem a ninguém (`testes/unit/avisos-entrega.test.mjs`).
//
// As funções do hub que isto chama (SECURITY DEFINER, EXECUTE só service_role):
//   ent_avisos_pegar(p_limite)      -> marca 'enviando' e devolve os itens
//   ent_aviso_registrar(id, status, motivo, wamid, telefone)
//
// ⚠️ Item que ficar em 'enviando' (a rota caiu no meio) NUNCA volta sozinho —
// decisão do contrato: preferimos perder um aviso a mandar dois. Por isso o
// registro do 'enviado' vem ANTES de espelhar a mensagem no chat: se o espelho
// falhar, o aviso continua contado e não é repetido.
// ---------------------------------------------------------------------------
import { createHash, timingSafeEqual } from "node:crypto";
import { normalizarTelefone } from "./telefone";
import { traduzErroMeta } from "./erroMeta";
import { aplicarVariaveis } from "./templateVars";

export const CABECALHO_SEGREDO = "x-entregas-aviso-segredo";

/** Um item de `ent_avisos_pegar`, como o contrato define. */
export type ItemAviso = {
  id: string;
  tipo: string;              // 'saiu' | 'proxima'
  meta_nome: string;
  idioma: string | null;
  codcli: number | null;
  pedido: number | null;
  primeiro_nome: string | null;
  telefone_cru: string | null;
  link_token: string;
};

export type ResultadoAvisos = {
  processados: number;
  enviados: number;
  pulados: number;
  falhos: number;
  // devolvidos à fila por erro passageiro (rede, 5xx, limite de taxa). Fora do
  // contrato mínimo — campo a mais, que o hub pode ignorar.
  adiados: number;
};

/**
 * O segredo confere? Devolve o STATUS HTTP de recusa, ou `null` se passou.
 *
 *   env ausente  -> 503 (o serviço não está configurado — não é culpa de quem chamou)
 *   errado/vazio -> 401
 *
 * Comparação em TEMPO CONSTANTE sobre o hash dos dois lados: `timingSafeEqual`
 * exige tamanhos iguais, e comparar o tamanho antes vazaria o tamanho do
 * segredo. O hash iguala os tamanhos sem vazar nada.
 */
export function recusaDoSegredo(recebido: string | null | undefined, esperado: string | null | undefined): 401 | 503 | null {
  const esp = String(esperado ?? "").trim();
  if (!esp) return 503;
  const rec = String(recebido ?? "").trim();
  if (!rec) return 401;
  const a = createHash("sha256").update(rec).digest();
  const b = createHash("sha256").update(esp).digest();
  return timingSafeEqual(a, b) ? null : 401;
}

/**
 * Telefone do cadastro do WinThor -> número da Meta, ou `null` se não dá.
 *
 * A mesma normalização do resto do Pulse (`normalizarTelefone`: DDD válido, 55
 * na frente), mais UMA regra do dono (card #19, pergunta 7): número de celular
 * antigo, sem o nono dígito — 10 dígitos (12 com o 55) cujo número local começa
 * com 7 ou 8 — ganha o 9. Sem isso o aviso iria para um número que a Meta
 * recusa (131026), e a cliente não saberia que o pedido saiu.
 *
 * ⚠️ Local começando com 9 NÃO ganha o 9 (a regra do dono é 7 ou 8). Medido em
 * 25/09/2026: 179 cadastros ativos têm 10 dígitos com local começando em 9.
 */
export function telefoneDoAviso(cru: string | null | undefined): string | null {
  const n = normalizarTelefone(String(cru ?? ""));
  if (!n) return null;
  if (n.length === 12 && (n[4] === "7" || n[4] === "8")) return `${n.slice(0, 4)}9${n.slice(4)}`;
  return n;
}

/** Os components do envio, EXATAMENTE como o contrato (seção 5) define. */
export function componentesDoAviso(item: Pick<ItemAviso, "primeiro_nome" | "pedido" | "link_token">): unknown[] {
  return [
    {
      type: "body",
      parameters: [
        // parâmetro vazio é recusa da Meta (132000); o hub manda o nome já
        // formatado, e "cliente" é só a rede para cadastro sem nome
        { type: "text", text: String(item.primeiro_nome ?? "").trim() || "cliente" },
        { type: "text", text: String(item.pedido ?? "") },
      ],
    },
    {
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: String(item.link_token ?? "") }],
    },
  ];
}

/**
 * Códigos da Meta em que repetir DAQUI A POUCO resolve: limite de taxa. Não
 * estão na lista "rede/5xx" do contrato, mas pertencem à mesma família — a
 * causa é passageira e o hub desiste sozinho depois de 3 tentativas.
 */
const PASSAGEIROS = new Set([130429, 131056, 80007]);

/**
 * O que fazer com um erro do envio:
 *   'pendente' — rede, 5xx da Meta, limite de taxa: devolve à fila.
 *   'falhou'   — a Meta RECUSOU (4xx com código): repetir dá o mesmo resultado.
 * O motivo guarda a tradução E o texto cru da Meta — a §22.6.1 custou horas por
 * ter perdido a explicação original.
 */
export function classificarFalha(err: any): { status: "pendente" | "falhou"; motivo: string } {
  const cru = String(err?.message ?? err ?? "erro desconhecido").slice(0, 500);
  const http = Number(err?.httpStatus);
  const codigo = err?.graphCode;
  if (Number.isFinite(http) && http >= 500) return { status: "pendente", motivo: `instabilidade da Meta: ${cru}` };
  if (codigo != null && PASSAGEIROS.has(Number(codigo))) return { status: "pendente", motivo: `limite da Meta: ${cru}` };
  if (codigo != null || (Number.isFinite(http) && http >= 400)) {
    const t = traduzErroMeta(codigo != null ? `Meta ${codigo} — ${cru}` : cru);
    return { status: "falhou", motivo: t.conhecido ? `${t.texto} (${cru})` : cru };
  }
  // sem resposta da Meta: rede, tempo esgotado, DNS
  return { status: "pendente", motivo: `sem resposta da Meta: ${cru}` };
}

export type DepsAvisos = {
  sb: any;                                   // cliente Supabase com service_role
  enviar: (to: string, nome: string, idioma: string, components: unknown[], de: string | null) => Promise<{ wamid: string }>;
  acharContato: (sb: any, opts: any) => Promise<{ cliente_id: string; carteira: string | null; telefone: string }>;
  linhaDe: (sb: any, clienteId: string) => Promise<string | null>;
  limite?: number;
  agora?: () => Date;
};

async function registrar(sb: any, id: string, status: string, motivo: string | null, wamid: string | null, tel: string | null) {
  const { error } = await sb.rpc("ent_aviso_registrar", {
    p_id: id, p_status: status, p_motivo: motivo, p_wamid: wamid, p_telefone: tel,
  });
  if (error) throw new Error(`ent_aviso_registrar: ${error.message}`);
}

/** Dados do ERP do cliente: é o que faz o contato nascer com dono e CPF certos. */
async function erpDoCliente(sb: any, codcli: number | null) {
  if (codcli == null) return null;
  const { data, error } = await sb.from("wth_carteira").select("codcli,nome,cpf,rca_num").eq("codcli", codcli).maybeSingle();
  if (error) throw new Error(`wth_carteira: ${error.message}`);
  if (!data) return null;
  let carteira: string | null = null;
  if (data.rca_num != null) {
    const { data: cc } = await sb.from("carteira_config").select("slug").eq("rca_num", data.rca_num).eq("ativo", true).maybeSingle();
    carteira = cc?.slug ?? null;
  }
  return { codcli: data.codcli, nome: data.nome ?? null, cpf: data.cpf ?? null, carteira };
}

/** Corpo cadastrado de cada modelo, para o chat mostrar o texto que a cliente leu. */
async function corposDosModelos(sb: any, nomes: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!nomes.length) return m;
  try {
    const { data } = await sb.from("crm_templates").select("meta_nome,corpo").in("meta_nome", nomes);
    for (const t of data ?? []) if (t?.meta_nome && t?.corpo) m.set(String(t.meta_nome), String(t.corpo));
  } catch { /* sem o corpo, a bolha mostra o nome do modelo */ }
  return m;
}

export async function processarAvisos(deps: DepsAvisos): Promise<ResultadoAvisos> {
  const { sb } = deps;
  const r: ResultadoAvisos = { processados: 0, enviados: 0, pulados: 0, falhos: 0, adiados: 0 };

  const { data, error } = await sb.rpc("ent_avisos_pegar", { p_limite: deps.limite ?? 20 });
  if (error) throw new Error(`ent_avisos_pegar: ${error.message}`);
  const itens: ItemAviso[] = Array.isArray(data) ? data : [];
  const corpos = await corposDosModelos(sb, [...new Set(itens.map((i) => i.meta_nome).filter(Boolean))]);

  for (const item of itens) {
    r.processados++;
    try {
      await processarUm(deps, item, corpos, r);
    } catch {
      // Só chega aqui se o próprio REGISTRO falhou (banco fora). O item fica em
      // 'enviando' — de propósito, ver o topo —, e os seguintes continuam: parar
      // o laço deixaria presos também os que nem chegaram a ser tentados.
      r.falhos++;
    }
  }
  return r;
}

async function processarUm(
  deps: DepsAvisos, item: ItemAviso, corpos: Map<string, string>, r: ResultadoAvisos,
): Promise<void> {
  const { sb } = deps;
  const agora = deps.agora ?? (() => new Date());

  const tel = telefoneDoAviso(item.telefone_cru);
  if (!tel) {
    await registrar(sb, item.id, "pulado", "telefone_invalido", null, item.telefone_cru ?? null);
    r.pulados++;
    return;
  }
  // Lista de "não contatar" / opt-out: NÃO EXISTE no Pulse hoje (conferido em
  // 25/09/2026 — nem tabela, nem coluna em `clientes`, nem tratamento de
  // "SAIR" no webhook). Quando existir, a checagem entra AQUI e registra
  // 'pulado' com motivo 'opt_out'.

  // Tudo antes do envio pode falhar sem risco: nada saiu ainda, então o item
  // volta para a fila em vez de ficar preso em 'enviando'.
  let contato: { cliente_id: string; carteira: string | null; telefone: string };
  let linha: string | null;
  try {
    const erp = await erpDoCliente(sb, item.codcli);
    contato = await deps.acharContato(sb, { telefone: tel, erp, nome: erp?.nome ?? null });
    linha = await deps.linhaDe(sb, contato.cliente_id);
  } catch (e: any) {
    await registrar(sb, item.id, "pendente", `preparo do envio: ${String(e?.message ?? e).slice(0, 300)}`, null, tel);
    r.adiados++;
    return;
  }

  let wamid: string;
  try {
    ({ wamid } = await deps.enviar(tel, item.meta_nome, item.idioma || "pt_BR", componentesDoAviso(item), linha));
  } catch (e: any) {
    const c = classificarFalha(e);
    await registrar(sb, item.id, c.status, c.motivo, null, tel);
    if (c.status === "pendente") r.adiados++; else r.falhos++;
    return;
  }

  await registrar(sb, item.id, "enviado", null, wamid, tel);
  r.enviados++;

  // Espelho no chat, como qualquer template enviado — mas como `bot`: não foi
  // a vendedora quem mandou. Falha aqui não desfaz o envio nem o registro.
  const corpo = corpos.get(item.meta_nome);
  const conteudo = corpo
    ? aplicarVariaveis(corpo, [String(item.primeiro_nome ?? "").trim() || "cliente", String(item.pedido ?? "")])
    : `[template] ${item.meta_nome}`;
  try {
    await sb.from("disparos_template").insert({
      id: wamid, cliente_id: contato.cliente_id, telefone: tel, vendedor: contato.carteira,
      operator_id: null, template_id: item.meta_nome, status: "sent",
    });
    await sb.from("mensagens").upsert({
      id: wamid, cliente_id: contato.cliente_id, vendedor_carteira: contato.carteira ?? null,
      enviada_por: "bot", tipo: "template", conteudo, status: "wait",
      criada_em: agora().toISOString(), linha_id: linha,
    }, { onConflict: "id" });
  } catch { /* o webhook de status ainda atualiza a linha, se ela existir */ }
}
