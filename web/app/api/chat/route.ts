import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../lib/papel";
import { usuarioDaSessao } from "../../../lib/chatUsuario";
import { carregarAtribuicoes, aplicaEscopo, emLotes, donoEfetivo } from "../../../lib/chatEscopo";
import { layoutEfetivo } from "../../../lib/chatLayout";
import { lerCrmConfig, VIEW_FUNIL_TELA, modoMigracao } from "../../../lib/crmConfig";

export const dynamic = "force-dynamic";

// Lista de conversas do CHAT (sidebar). Fonte: vw_funil (ou vw_funil_sem_rd, com
// as conversas do RD escondidas — 0098) — 1 linha por cliente com
// última mensagem/atividade, já com o dono (RCA atual) resolvido. Só clientes com
// conversa de verdade (ultima_atividade não nula — corta a fila de prospecção).
// Vendedor vê a própria carteira (filtro no SERVIDOR); admin/home veem tudo.
export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const carteira = carteiraDe(sessao);

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const COLS = "cliente_id,cliente,vendedor,etapa,telefone,ultima_atividade,ultima_mensagem,ultima_enviada_por,codcli";

  // Interruptor das conversas do RD (0098). Escondidas, a sidebar lista só o que
  // veio da Cloud: os ramos sem conversa da view irmã têm `ultima_atividade`
  // nula, e o `.not(..., "is", null)` abaixo já os corta — nenhum filtro extra.
  const cfg = await lerCrmConfig(sb);
  const fonte = VIEW_FUNIL_TELA;

  // Cards SINTÉTICOS (`venda:<codcli>`, `winthor:<codcli>`) não são conversa: não
  // têm thread, e clicar num deles não leva a lugar nenhum. A lista sempre teve
  // 39 deles — invisíveis entre 3.908 conversas do RD. Com o RD escondido eles
  // passariam a ser 39 de 41 itens, e o chat pareceria quebrado. O corte por
  // `ultima_atividade` não os pega: o card de venda carrega a data da nota.
  const soConversa = (q: any) => q.not("cliente_id", "like", "venda:%").not("cliente_id", "like", "winthor:%");

  // transferências vigentes (0081): mudam quem atende, sem tocar na carteira
  const atrib = await carregarAtribuicoes(sb);

  // paginado: o PostgREST corta em 1000 linhas
  const PAGE = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = soConversa(sb.from(fonte).select(COLS))
      .not("ultima_atividade", "is", null)
      .order("ultima_atividade", { ascending: false })
      .range(from, from + PAGE - 1);
    if (carteira) q = q.eq("vendedor", carteira);
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // O filtro acima é pela carteira do funil, então NÃO traz o que foi
  // transferido PARA mim de outra carteira — busca essas à parte.
  if (carteira) {
    const jaTem = new Set(out.map((c: any) => c.cliente_id));
    const recebidas = [...atrib.entries()]
      .filter(([id, a]) => a.para === carteira && !jaTem.has(id))
      .map(([id]) => id);
    for (const lote of emLotes(recebidas)) {
      const { data } = await soConversa(sb.from(fonte).select(COLS))
        .in("cliente_id", lote)
        .not("ultima_atividade", "is", null);
      out.push(...(data ?? []));
    }
  }

  // ---- FILA de não atribuídos (P2) ----------------------------------------
  // Conversa sem dono nenhum: sem carteira no funil e nunca transferida. É o
  // caso do contato novo que o webhook cria (`wa:<numero>`, sem cadastro no
  // WinThor) — hoje ele ficava invisível para os vendedores, porque o filtro
  // por carteira o descartava, e só o admin o via.
  //
  // A fila é visível para TODOS, de propósito: é dela que se puxa atendimento.
  // Buscada à parte porque o filtro por carteira acima nunca traz `null`.
  const filaCandidatos: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await soConversa(sb.from(fonte).select(COLS))
      .not("ultima_atividade", "is", null)
      .is("vendedor", null)
      .order("ultima_atividade", { ascending: false })
      .range(from, from + PAGE - 1);
    filaCandidatos.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  // `vendedor` nulo no funil não basta: pode ter sido transferida para alguém.
  // Sem dono efetivo = está mesmo na fila.
  const naFila = new Set(
    filaCandidatos
      .filter((c: any) => donoEfetivo(c.cliente_id, c.vendedor ?? null, atrib) === null)
      .map((c: any) => c.cliente_id),
  );
  const jaListado = new Set(out.map((c: any) => c.cliente_id));
  out.push(...filaCandidatos.filter((c: any) => naFila.has(c.cliente_id) && !jaListado.has(c.cliente_id)));

  // ids sintéticos (winthor:/venda:) não têm thread de mensagens — fora do chat
  const reais = out.filter((c: any) =>
    typeof c.cliente_id === "string" &&
    !c.cliente_id.startsWith("winthor:") && !c.cliente_id.startsWith("venda:")
  );

  // dono efetivo: tira o que foi transferido PRA FORA e marca o que chegou.
  // `vendedor` passa a ser quem atende hoje — é o que a tela mostra e filtra.
  // A fila entra fora do escopo: sem dono, não pertence a carteira nenhuma.
  const doEscopo = aplicaEscopo(reais.filter((c: any) => !naFila.has(c.cliente_id)), atrib, carteira);
  const daFila = reais
    .filter((c: any) => naFila.has(c.cliente_id))
    .map((c: any) => ({ ...c, vendedor: null, transferida_de: null, na_fila: true }));
  const conversas = [...doEscopo, ...daFila]
    .sort((a: any, b: any) => (a.ultima_atividade < b.ultima_atividade ? 1 : -1));

  // ---- não lidas + status (P0 itens 3 e 4) --------------------------------
  // "não lida" = tem mensagem DO CLIENTE mais recente que a marca de leitura
  // deste usuário. Sem marca, a conversa inteira conta como não lida.
  const usuario = usuarioDaSessao();
  const [{ data: leituras }, { data: estados }, { data: vendedores }, cfgLayout, meuAcesso] = await Promise.all([
    sb.from("chat_leitura").select("cliente_id,lida_ate").eq("usuario", usuario ?? ""),
    sb.from("chat_conversa").select("cliente_id,status,motivo"),
    // destinos possíveis de transferência (fonte única: carteira_config, §14.1)
    sb.from("carteira_config").select("slug,cor").eq("ativo", true).order("slug"),
    // desenho da tela em vigor para todos (0095) e o piloto desta pessoa.
    // Entram NESTE Promise.all de propósito: o /chat faz um load único, e duas
    // consultas em série aqui custariam round-trip a cada abertura da tela.
    sb.from("chat_layout").select("layout").eq("id", 1).maybeSingle(),
    // `usuario` é o e-mail no login Google e o valor da sessão no login por
    // senha ("admin"). Consultar sem ramo é de propósito: um valor que não é
    // e-mail simplesmente não acha linha, e a pessoa cai no desenho global —
    // que é o comportamento certo, já que o piloto é por e-mail.
    sb.from("acesso").select("chat_layout").eq("email", usuario ?? "").maybeSingle(),
  ]);
  const lidaAte = new Map((leituras ?? []).map((l: any) => [l.cliente_id, l.lida_ate]));
  const estado = new Map((estados ?? []).map((e: any) => [e.cliente_id, e]));

  for (const c of conversas) {
    const marca = lidaAte.get(c.cliente_id);
    c.nao_lida = c.ultima_enviada_por === "customer" &&
      (!marca || new Date(c.ultima_atividade) > new Date(marca));
    const e = estado.get(c.cliente_id);
    c.status = e?.status ?? "aberta";
    c.motivo = e?.motivo ?? null;
  }

  // ---- por qual NÚMERO cada conversa corre (migration 0089) ----------------
  // Operamos dois números ao mesmo tempo de propósito: o oficial (Murano Pro,
  // atendido pelo RD) e a linha piloto (Murano Shop, Cloud API). Sem esta
  // marcação a sidebar mistura os dois e o vendedor não sabe por onde está
  // falando até abrir a conversa.
  //
  // A view só conhece quem tem `linha_id` — conversa do RD não tem, porque o
  // conceito nasceu no webhook da Meta. Ausente da view = linha 'rd'.
  const [{ data: linhasCad }, daLinha] = await Promise.all([
    sb.from("chat_linha").select("phone_number_id,rotulo,numero").eq("ativo", true).order("rotulo"),
    (async () => {
      const m = new Map<string, string>();
      for (let from = 0; ; from += PAGE) {
        const { data } = await sb.from("vw_chat_linha_cliente")
          .select("cliente_id,linha_id").range(from, from + PAGE - 1);
        for (const l of data ?? []) m.set((l as any).cliente_id, (l as any).linha_id);
        if (!data || data.length < PAGE) break;
      }
      return m;
    })(),
  ]);

  const porLinha = new Map<string, number>();
  for (const c of conversas) {
    c.linha_id = daLinha.get(c.cliente_id) ?? "rd";
    porLinha.set(c.linha_id, (porLinha.get(c.linha_id) ?? 0) + 1);
  }

  // Linha que aparece nas conversas mas não está cadastrada entra assim mesmo,
  // com o id cru: some da tela seria pior — a conversa existiria sem lugar
  // nenhum no filtro, e ninguém descobriria que falta cadastrar a linha.
  const cadastradas = new Map((linhasCad ?? []).map((l: any) => [l.phone_number_id, l]));
  const linhas = [...new Set([...cadastradas.keys(), ...porLinha.keys()])]
    .map((id) => ({
      id,
      rotulo: cadastradas.get(id)?.rotulo ?? `linha ${id} (não cadastrada)`,
      numero: cadastradas.get(id)?.numero ?? null,
      total: porLinha.get(id) ?? 0,
    }))
    .filter((l) => l.total > 0)
    .sort((a, b) => b.total - a.total);

  return Response.json({
    conversas,
    linhas,
    vendedores: vendedores ?? [],
    nao_lidas: conversas.filter((c: any) => c.nao_lida && !c.na_fila).length,
    na_fila: conversas.filter((c: any) => c.na_fila).length,
    // qual desenho da tela esta pessoa deve ver (0095). O piloto ganha do
    // global; valor desconhecido cai no padrão em vez de deixar a tela sem
    // desenho. Hoje só 'original' tem implementação, então este campo sempre
    // vem 'original' — está aqui para a tela nova poder ler no dia em que
    // existir, sem mexer nesta rota outra vez.
    layout: layoutEfetivo(cfgLayout.data?.layout, meuAcesso.data?.chat_layout),
    // Fase C simulada: some o filtro por numero e a etiqueta da linha no
    // cabecalho -- com uma linha so, os dois viram enfeite que nomeia o RD.
    modo_migracao: modoMigracao(cfg),
    atualizado_em: new Date().toISOString(),
  });
}
