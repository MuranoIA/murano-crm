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
 * na frente), mais a regra do dono (card #19, pergunta 7, revista em
 * 25/09/2026) para o número de 10 dígitos (12 com o 55), sem o nono dígito:
 *
 *   local começando com 7, 8 ou 9 -> celular antigo: ganha o 9
 *   local começando com 2, 3, 4 ou 5 -> FIXO: não há WhatsApp -> null
 *                                      (a rota registra 'pulado', telefone_invalido)
 *
 * Sem o 9 o aviso iria para um número que a Meta recusa (131026), e a cliente
 * não saberia que o pedido saiu. O 9 entrou na lista depois de medido: 179
 * cadastros ativos tinham 10 dígitos com local começando em 9 (25/09/2026).
 *
 * ⚠️ Local começando com 0, 1 ou 6 fica como está — o dono não decidiu, e
 * nenhuma das duas regras vale para ele. Se a Meta recusar, cai em 'falhou'
 * com a explicação.
 */
export const LOCAL_CELULAR_SEM_NOVE = new Set(["7", "8", "9"]);
export const LOCAL_FIXO = new Set(["2", "3", "4", "5"]);

export function telefoneDoAviso(cru: string | null | undefined): string | null {
  const n = normalizarTelefone(String(cru ?? ""));
  if (!n) return null;
  if (n.length === 12) {
    const local = n[4];
    if (LOCAL_CELULAR_SEM_NOVE.has(local)) return `${n.slice(0, 4)}9${n.slice(4)}`;
    if (LOCAL_FIXO.has(local)) return null;
  }
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
  //
  // ⚠️ O FUNIL IGNORA ESTA MENSAGEM (decisão do dono, 25/09/2026, migration
  // 0143). A marca é `aviso_entrega: true`, gravada AQUI — e não o nome do
  // modelo, que é configurável no hub e mudaria por baixo das views. As views
  // do board e do chat e a `get_funil_card` tiram a linha marcada de toda
  // conta de "última mensagem": o card fica onde estaria sem o aviso. A
  // mensagem continua na conversa (a vendedora vê o que a cliente recebeu).
  //
  // Pelo mesmo motivo NÃO grava em `disparos_template`: o board lê aquela
  // tabela para "aguardando resposta", para a atividade efetiva do card e para
  // o anti-repetição do disparo em massa — qualquer um dos três moveria o
  // card. O registro do aviso é a fila do hub (`ent_aviso_cliente`: status,
  // wamid, telefone, motivo), e o status de entrega chega pela linha abaixo.
  //
  // ⚠️ Ordem de deploy: a coluna vem da 0143. Sem ela o upsert falha (e o
  // catch engole) — aplicar a migration ANTES de publicar este código.
  const corpo = corpos.get(item.meta_nome);
  const conteudo = corpo
    ? aplicarVariaveis(corpo, [String(item.primeiro_nome ?? "").trim() || "cliente", String(item.pedido ?? "")])
    : `[template] ${item.meta_nome}`;
  try {
    await sb.from("mensagens").upsert({
      id: wamid, cliente_id: contato.cliente_id, vendedor_carteira: contato.carteira ?? null,
      enviada_por: "bot", tipo: "template", conteudo, status: "wait",
      criada_em: agora().toISOString(), linha_id: linha, aviso_entrega: true,
    }, { onConflict: "id" });
  } catch { /* o webhook de status ainda atualiza a linha, se ela existir */ }
}

// ---------------------------------------------------------------------------
// MODO DE TESTE (25/09/2026). Para o dono receber os dois avisos no PRÓPRIO
// celular antes de ligar o envio real. Mesma porta (o segredo), mesma rota,
// corpo `{ teste: { telefone, tipo, nome?, pedido? } }`.
//
// O que ele NÃO faz, e é o motivo de existir separado do fluxo da fila:
//   - não chama `ent_avisos_pegar` nem `ent_aviso_registrar` (a fila do hub
//     fica intocada — nenhum aviso de cliente é "gasto" por um teste);
//   - não grava em `mensagens` nem em `disparos_template` (teste não é
//     conversa de cliente);
//   - ignora `ent_aviso_config.ligado`: o teste serve justamente para ANTES
//     de ligar. Só exige `meta_nome` cadastrado.
// Os components saem da MESMA `componentesDoAviso` do envio real — o teste
// prova o formato que a cliente vai receber, não uma cópia dele.
// ---------------------------------------------------------------------------

export const TIPOS_AVISO = ["saiu", "proxima"] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];
export const NOME_TESTE = "Cliente teste";
export const PEDIDO_TESTE = 123456;
/** Token de exemplo (32 hex): o botão abre o rastreio com ele e cai em "link inválido" — é teste. */
export const TOKEN_TESTE = "0123456789abcdef0123456789abcdef";

export type PedidoTeste = { telefone: string; tipo: TipoAviso; nome: string; pedido: number };

/** Lê `corpo.teste`. `null` = não é teste; `{ erro }` = é teste, mas mal formado (400). */
export function lerPedidoTeste(corpo: unknown): PedidoTeste | { erro: string } | null {
  const t = (corpo as any)?.teste;
  if (t == null) return null;
  if (typeof t !== "object") return { erro: "teste deve ser um objeto" };
  if (!TIPOS_AVISO.includes(t.tipo)) return { erro: "tipo deve ser 'saiu' ou 'proxima'" };
  const telefone = String(t.telefone ?? "").trim();
  if (!telefone) return { erro: "telefone obrigatório" };
  const nome = t.nome == null ? NOME_TESTE : String(t.nome).trim().slice(0, 60);
  if (!nome) return { erro: "nome vazio" };
  const pedido = t.pedido == null ? PEDIDO_TESTE : Number(t.pedido);
  if (!Number.isInteger(pedido) || pedido <= 0) return { erro: "pedido deve ser inteiro positivo" };
  return { telefone, tipo: t.tipo, nome, pedido };
}

export type RespostaRota = { status: number; corpo: Record<string, unknown> };

export async function enviarTeste(
  deps: Pick<DepsAvisos, "sb" | "enviar" | "linhaDe">, p: PedidoTeste,
): Promise<RespostaRota> {
  const tel = telefoneDoAviso(p.telefone);
  if (!tel) return { status: 400, corpo: { teste: true, tipo: p.tipo, error: "telefone inválido (fixo ou fora do formato)" } };

  const { data: cfg, error } = await deps.sb.from("ent_aviso_config").select("meta_nome,idioma").eq("tipo", p.tipo).maybeSingle();
  if (error) return { status: 500, corpo: { teste: true, tipo: p.tipo, error: `ent_aviso_config: ${error.message}` } };
  const metaNome = String(cfg?.meta_nome ?? "").trim();
  if (!metaNome) {
    return { status: 409, corpo: { teste: true, tipo: p.tipo, error: `modelo do tipo '${p.tipo}' não cadastrado em ent_aviso_config.meta_nome` } };
  }

  // Linha de envio: a de uma conversa NOVA (forçada, senão a padrão do
  // cadastro). O id não existe de propósito — `linhaDaConversa` só LÊ
  // `mensagens` e, sem conversa, devolve a padrão. Não se chama
  // `acharOuCriarContato`: o teste não cria contato nem conversa.
  let linha: string | null = null;
  try { linha = await deps.linhaDe(deps.sb, `teste-aviso:${tel}`); } catch { linha = null; }

  console.info(`[avisos-entrega] TESTE tipo=${p.tipo} modelo=${metaNome} para=${tel} linha=${linha ?? "env"} pedido=${p.pedido}`);
  try {
    const { wamid } = await deps.enviar(
      tel, metaNome, cfg?.idioma || "pt_BR",
      componentesDoAviso({ primeiro_nome: p.nome, pedido: p.pedido, link_token: TOKEN_TESTE }),
      linha,
    );
    return { status: 200, corpo: { teste: true, tipo: p.tipo, enviado: true, wamid, telefone: tel } };
  } catch (e: any) {
    const c = classificarFalha(e);
    return { status: 502, corpo: { teste: true, tipo: p.tipo, enviado: false, error: c.motivo, telefone: tel } };
  }
}

/**
 * A decisão da rota, depois da porta: corpo com `teste` -> `enviarTeste` (e a
 * fila NÃO é tocada); sem `teste` -> `processarAvisos`, o fluxo de sempre.
 */
export async function atenderChamada(deps: DepsAvisos, corpo: unknown): Promise<RespostaRota> {
  const teste = lerPedidoTeste(corpo);
  if (teste !== null) {
    if ("erro" in teste) return { status: 400, corpo: { teste: true, error: teste.erro } };
    return enviarTeste(deps, teste);
  }
  const r = await processarAvisos(deps);
  return { status: 200, corpo: r };
}
