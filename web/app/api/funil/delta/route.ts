import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";
import { lerCrmConfig, filtroLinhas } from "../../../../lib/crmConfig";
import { semEnsaio } from "../../../../lib/ensaio";

export const dynamic = "force-dynamic";

/**
 * DELTA DO BOARD — o que mudou desde `desde`, e só isso.
 *
 * Por que esta rota existe
 * -----------------------
 * O board já não fazia polling curto (isso morreu em 03/08, §15.1): o Postgres
 * avisa por broadcast e o front reage. O problema era a REAÇÃO — cada aviso
 * chamava `/api/funil` inteiro, que pagina três views e cruza faturamento
 * (~3,4s medido, §12.6). Numa rajada de campanha isso é o board inteiro
 * reconstruído dezenas de vezes para mover um card.
 *
 * Aqui a reação custa uma consulta de índice mais N chamadas de linha única.
 *
 * Por que o navegador NÃO assina `mensagens` direto
 * -------------------------------------------------
 * Seria o caminho óbvio (`postgres_changes`), e ele FALHA EM SILÊNCIO:
 * `mensagens` está com RLS ligado SEM policy desde 03/08 (§12.5), então a chave
 * anon não enxerga linha nenhuma e o Realtime, que respeita RLS, não entrega
 * evento nenhum. O board pararia de atualizar sem erro em lugar nenhum. Abrir
 * SELECT para anon reabriria exatamente o buraco que aquela migration fechou
 * (anon lia 59.586 mensagens e 4.752 clientes).
 *
 * E o `cliente_id` também não pode viajar pelo canal de broadcast: o canal é
 * PÚBLICO (o board autentica por cookie próprio, não por Supabase Auth, §15.4)
 * e `cliente_id` pode ser `wa:<telefone>`, ou seja, PII. É a mesma régua que a
 * §22.2 aplicou à ligação, onde o broadcast leva só o id opaco da Meta.
 *
 * Então: o aviso continua sendo o broadcast anônimo de sempre ("mexeu na
 * carteira X"), e é AQUI, no servidor, com service_role e o cookie na mão, que
 * se descobre QUEM mudou.
 */

/** Teto de clientes por delta. Acima disso não vale remendar card a card. */
const TETO = 60;
/** Quantas RPCs em paralelo. Linha única cada, mas não vale saturar a instância. */
const LOTE = 10;

export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const carteira = carteiraDe(sessao);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes" }, { status: 500 });
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const desde = new URL(req.url).searchParams.get("desde");
  if (!desde || isNaN(Date.parse(desde))) {
    return Response.json({ error: "parâmetro `desde` ausente ou inválido" }, { status: 400 });
  }
  // Fecha o cursor AGORA, antes de consultar. Fechar depois abriria uma janela
  // em que uma mensagem chegada durante a consulta entraria no cursor sem ter
  // entrado no resultado — e sumiria para sempre, porque o delta seguinte parte
  // de um ponto à frente dela.
  const ate = new Date().toISOString();

  // ⚠️ SOBREPOSIÇÃO DE 60s — sem ela o card SOME, e some em silêncio.
  //
  // Medido em 11/09: o teste de navegador passava e falhava alternadamente. A
  // causa são três relógios que não concordam, e o delta ficava no meio:
  //
  //  1. `criada_em` da mensagem recebida vem do `timestamp` da Meta, que tem
  //     resolução de SEGUNDO — já nasce até 1s no passado;
  //  2. o broadcast chega ~500ms depois do POST, e nada garante que o aviso que
  //     acordou ESTE delta seja o da mensagem que interessa (num dia de trabalho
  //     há aviso de outras carteiras o tempo todo);
  //  3. quem calcula `ate` é o Next e quem carimba `criada_em` é o Postgres —
  //     máquinas diferentes, relógios diferentes.
  //
  // Bastava a mensagem ter `criada_em` um pouco antes de um cursor que já
  // avançou por outro aviso para ela nunca mais entrar em janela nenhuma: o
  // card só apareceria no load completo, minutos depois. Reler os últimos 60s a
  // cada delta custa pouco (o upsert do front é idempotente) e fecha os três.
  const janela = new Date(Date.parse(desde) - 60_000).toISOString();

  const cfg = await lerCrmConfig(sb);

  // ---- quem mudou -------------------------------------------------------
  // `filtroLinhas` é a implementação única da visibilidade por número (§32.5).
  // Ela é o PORTÃO: mensagem numa linha escondida não move card nenhum, então o
  // delta nunca traz para a tela uma conversa que a seleção manda esconder.
  //
  // `semEnsaio` pela mesma razão que /api/funil o aplica: a faixa de ensaio
  // escreve no banco de PRODUÇÃO, e em 10/09 25 conversas falsas ficaram meia
  // hora na tela dos consultores. Um caminho novo até o board que não filtrasse
  // a faixa traria o incidente de volta por uma porta nova.
  let qMsg = semEnsaio(sb.from("mensagens").select("cliente_id,criada_em"))
    .gt("criada_em", janela).lte("criada_em", ate)
    .neq("tipo", "evento_sistema")
    .order("criada_em", { ascending: false })
    .limit(2000);
  qMsg = filtroLinhas(qMsg, cfg);

  // O trigger do board (0069) também dispara em `disparos_template`, e o board
  // usa esse mapa para marcar "aguardando resposta". Sem ele o selo do card só
  // apareceria no próximo load completo.
  let qDisp = semEnsaio(sb.from("disparos_template").select("cliente_id,criada_em"))
    .gt("criada_em", janela).lte("criada_em", ate)
    .order("criada_em", { ascending: false }).limit(500);
  if (carteira) qDisp = qDisp.eq("vendedor", carteira);

  const [rMsg, rDisp] = await Promise.all([qMsg, qDisp]);
  if (rMsg.error) return Response.json({ error: rMsg.error.message }, { status: 500 });

  const ids: string[] = [];
  const vistos = new Set<string>();
  for (const m of (rMsg.data ?? []) as any[]) {
    if (m.cliente_id && !vistos.has(m.cliente_id)) { vistos.add(m.cliente_id); ids.push(m.cliente_id); }
  }
  const disparos: Record<string, string> = {};
  for (const d of (rDisp.data ?? []) as any[]) {
    if (!d.cliente_id) continue;
    if (!disparos[d.cliente_id]) disparos[d.cliente_id] = d.criada_em;
    if (!vistos.has(d.cliente_id)) { vistos.add(d.cliente_id); ids.push(d.cliente_id); }
  }

  const vazio = { ate, truncado: false, cards: [], remover: [], disparos: {} };
  // Mudou demais para remendar card a card (campanha em massa, ETL despejando
  // lote). Devolve o cursor mesmo assim: o front recarrega inteiro e não fica
  // pedindo a mesma janela gigante de novo.
  if (ids.length > TETO) {
    return Response.json({ ...vazio, truncado: true, motivo: ids.length + " clientes mudaram" });
  }
  if (!ids.length) return Response.json(vazio);

  // ---- o card ao vivo, um por cliente -----------------------------------
  // `get_funil_card` recalcula a linha NA HORA, direto das tabelas — é o que faz
  // o card se mover em 1-2s em vez de esperar o refresh da matview, que hoje
  // anda ~2 min atrás (medido em 11/09).
  //
  // ⚠️ A RPC reproduz `vw_funil`, que NÃO filtra por linha (medido: 4.379
  // clientes com atividade contra 1.132 na view da tela). Quem garante a
  // visibilidade é o portão lá em cima. Se um dia voltar a existir tráfego numa
  // linha escondida, o sintoma será a PRÉVIA do card citar uma mensagem que a
  // tela esconde — o card em si continua legítimo, porque só chega aqui quem
  // recebeu mensagem numa linha visível.
  const vivos: any[] = [];
  for (let i = 0; i < ids.length; i += LOTE) {
    const fatia = ids.slice(i, i + LOTE);
    const rs = await Promise.all(fatia.map((id) =>
      sb.rpc("get_funil_card", { p_cliente_id: id }).then((r: any) => (r.error ? null : r.data))
    ));
    for (const r of rs) {
      const linha = Array.isArray(r) ? r[0] : r;
      if (linha && linha.cliente_id) vivos.push(linha);
    }
  }

  // ---- as mesmas regras que /api/funil aplica ---------------------------
  // Um card não é só a linha da view: a rota do board ainda decide lixeira,
  // escopo, coluna "Sem cadastro" e quem saiu para as colunas de venda. Se o
  // delta pulasse isso, o card voltaria pela porta dos fundos na coluna errada —
  // ou pior, um cliente da lixeira reapareceria ao mandar mensagem.
  const tel8 = (t: any) => String(t ?? "").replace(/\D/g, "").slice(-8);
  const codclis = [...new Set(vivos.map((c) => c.codcli).filter((x) => x != null).map(Number))];
  const COLS_VENDA = "etapa,dias,vendedor_slug,codcli,cliente,cliente_id,telefone,pedidos,valor,ultima_compra,conversa_aberta";

  let qVenda = sb.from("vw_venda_card").select(COLS_VENDA);
  // Casa pelos DOIS identificadores: nem toda linha de venda tem `cliente_id`
  // (o vínculo por CPF falha quando o contato não tem CPF), e nem todo card de
  // conversa tem `codcli`. Procurar só por um deles deixaria passar o cliente
  // que está na coluna de venda — e ele apareceria em duas colunas.
  qVenda = codclis.length
    ? qVenda.or("cliente_id.in.(" + ids.join(",") + "),codcli.in.(" + codclis.join(",") + ")")
    : qVenda.in("cliente_id", ids);

  const [rDesc, rVenda] = await Promise.all([
    sb.from("wth_descartados").select("cliente_id,codcli,tel8"),
    qVenda,
  ]);

  const descRows = (rDesc.data ?? []) as any[];
  const descCli = new Set(descRows.map((d) => d.cliente_id).filter(Boolean));
  const descCod = new Set(descRows.map((d) => d.codcli).filter((x) => x != null).map(Number));
  const descTel = new Set(descRows.map((d) => d.tel8).filter(Boolean));
  const ehDescartado = (c: any): boolean => {
    if (c.cliente_id && descCli.has(c.cliente_id)) return true;
    if (c.rd_cliente_id && descCli.has(c.rd_cliente_id)) return true;
    if (c.codcli != null && descCod.has(Number(c.codcli))) return true;
    const t = tel8(c.telefone);
    return t.length === 8 && descTel.has(t);
  };

  // O escopo do vendedor vale também aqui: sem isto o valor faturado de um
  // cliente de outra carteira vazaria pelo selo do card.
  const vendaRows = ((rVenda.data ?? []) as any[]).filter((r) => !carteira || r.vendedor_slug === carteira);
  const valCli = new Map<string, number>();
  const valCod = new Map<number, number>();
  // Quem está numa coluna de venda — MENOS quem tem conversa aberta, que fica na
  // coluna da conversa porque reabordar quem já está falando com você é ruído
  // (decisão 3 da §42.2).
  const naVenda = new Set<string>();
  const naVendaCod = new Set<number>();
  for (const r of vendaRows) {
    const v = +(r.valor ?? 0);
    if (r.cliente_id) valCli.set(r.cliente_id, v);
    if (r.codcli != null) valCod.set(Number(r.codcli), v);
    if (r.conversa_aberta) continue;
    if (r.cliente_id) naVenda.add(r.cliente_id);
    if (r.codcli != null) naVendaCod.add(Number(r.codcli));
  }
  const ehDeVenda = (c: any) =>
    naVenda.has(c.cliente_id) || (c.codcli != null && naVendaCod.has(Number(c.codcli)));

  const cards: any[] = [];
  const remover: string[] = [];
  for (const c of vivos) {
    // Escopo: vendedor só recebe card da própria carteira. A trava é aqui, no
    // servidor — o front não pode ser a única régua de quem vê o quê.
    if (carteira && c.vendedor !== carteira) { remover.push(c.cliente_id); continue; }
    if (ehDescartado(c) || ehDeVenda(c) || c.etapa === "pedido_emitido") { remover.push(c.cliente_id); continue; }

    // "Sem cadastro": sem conversa visível, quem decide a coluna é o cadastro no
    // ERP (§50.3). Mesma régua da rota do board, palavra por palavra.
    if (!c.ultima_atividade && c.sem_cadastro && !/^(winthor|venda):/.test(String(c.cliente_id))) {
      c.etapa = "sem_cadastro";
    }
    const v = c.cliente_id && valCli.has(c.cliente_id)
      ? valCli.get(c.cliente_id)!
      : (c.codcli != null ? valCod.get(Number(c.codcli)) ?? null : null);
    c.venda_valor = v && v > 0 ? v : null;
    // `ciclo` e `msgs_ocultas` não vêm no delta de propósito: o motor de ciclo
    // está atrás do interruptor do /admin e muda em escala de dias, não de
    // mensagem; e `msgs_ocultas` só existe para card SEM atividade visível, que
    // por definição não é o caso de quem acabou de receber mensagem. Os dois
    // chegam no próximo load completo, e o front preserva o que o card já tinha
    // — então nada pisca.
    cards.push(c);
  }

  // ⚠️ O caminho INVERSO não é coberto aqui, e é de propósito: cliente que
  // COMPRA deveria migrar para a coluna Pedido emitido, mas quem dispara este
  // delta é mensagem, não nota fiscal — o faturamento entra pelo `wth-sync-tudo`
  // e não emite broadcast nenhum. Essa migração continua chegando pelo load
  // completo (rede de proteção de 5 min), como sempre chegou.
  return Response.json({ ate, truncado: false, cards, remover, disparos });
}
