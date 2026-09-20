import "server-only";
import { banco, type Sessao } from "./servidor";
import { VIEW_CHAT_LISTA } from "../../../lib/crmConfig";
import { semEnsaio } from "../../../lib/ensaio";
import { carregarAtribuicoes, aplicaEscopo, donoEfetivo, emLotes } from "../../../lib/chatEscopo";

// ---------------------------------------------------------------------------
// A lista de conversas do chat-v2.
//
// Mesma FONTE e mesmas REGRAS do `/api/chat` (escopo por carteira, dono efetivo
// depois das transferências, fila de não atribuídos, ids sintéticos fora). O
// que muda é o tamanho do que se pede:
//
//   /api/chat        traz a lista INTEIRA em toda chamada — medido na fase 0:
//                    32,3 idas ao banco e 2,9 MB para desenhar ~15 linhas.
//   lerLista(60)     traz a primeira página, que é o que a tela mostra.
//
// A tela completa a lista depois, em segundo plano, por `/api/chat-v2/lista`,
// que chama ESTA MESMA função sem limite. Uma implementação, dois chamadores:
// se a régua de escopo mudar, muda para os dois (a §71.1 já registrou o preço
// de duas fontes para a mesma pergunta).
//
// ⚠️ O que ainda NÃO entra aqui, e por quê:
//   · etapa do board (§68) — exige `vw_venda_card` + descartados, 2 consultas;
//   · linha/número de cada conversa — exige varrer `vw_chat_linha_cliente`
//     (5,5 idas na fase 0), e com um número só em operação (§69) o filtro por
//     número não tem o que separar hoje;
//   · SLA / quem está esperando — `vw_chat_espera`.
// Entram quando a fase pedir, medindo o custo de cada um.
// ---------------------------------------------------------------------------

const COLS =
  "cliente_id,cliente,vendedor,etapa,telefone,ultima_atividade,ultima_mensagem,ultima_enviada_por,codcli";

export type Conversa = {
  cliente_id: string;
  cliente: string | null;
  vendedor: string | null;
  carteira_dona: string | null;
  transferida_de: string | null;
  etapa: string | null;
  telefone: string | null;
  ultima_atividade: string;
  ultima_mensagem: string | null;
  ultima_enviada_por: string | null;
  codcli: number | null;
  nao_lida: boolean;
  favorita: boolean;
  na_fila: boolean;
  status: string;
  motivo: string | null;
};

export type Contagens = {
  todas: number;
  nao_lidas: number;
  favoritas: number;
  fila: number;
  resolvidas: number;
};

export type Lista = {
  conversas: Conversa[];
  /** true quando ainda há conversas além das que vieram (limite atingido) */
  tem_mais: boolean;
  /** contadores dos chips, sobre a lista INTEIRA (ver `contarFilas`) */
  contagens?: Contagens;
  vendedores: { slug: string; cor: string | null }[];
  meu_usuario: string;
  minha_carteira: string | null;
  em: string;
};

const semSinteticos = (q: any) =>
  semEnsaio(q.not("cliente_id", "like", "venda:%").not("cliente_id", "like", "winthor:%"));

// ---------------------------------------------------------------------------
// OS CONTADORES DOS CHIPS, sem baixar a lista inteira.
//
// O contador de não lidas precisa olhar TODAS as conversas — é o que o chat
// antigo resolve trazendo os 2,9 MB de sempre, e é por isso que o número só
// existe depois de a lista inteira chegar (e, lá, escondido num dropdown).
//
// Aqui a pergunta é outra: para CONTAR não é preciso a prévia da mensagem, que
// é o que pesa. Quatro colunas curtas sobre 4 mil linhas são ~240 kB no
// servidor, contra 2,7 MB que iriam para o navegador — e o browser recebe cinco
// números.
// ---------------------------------------------------------------------------
// ⚠️ NÃO entra no caminho da primeira pintura. Medido em 19/09: calculada
// dentro da carga da página, ela levou a lista de 994 ms para 3.816 ms — são 5
// consultas paginadas sobre 4 mil linhas, e a tela ficou esperando por cinco
// números enquanto tinha 60 conversas prontas para desenhar. Agora a tela pede
// os contadores depois que já apareceu (`/api/chat-v2/contagens`).
export async function contarFilas(s: Sessao): Promise<Contagens> {
  const sb = banco();
  const [{ data: favoritos }, { data: leituras }, { data: estados }, atrib] = await Promise.all([
    sb.from("chat_favorito").select("cliente_id").eq("usuario", s.usuario),
    sb.from("chat_leitura").select("cliente_id,lida_ate").eq("usuario", s.usuario),
    sb.from("chat_conversa").select("cliente_id,status"),
    carregarAtribuicoes(sb),
  ]);
  const PAGE = 1000;
  const MAGRAS = "cliente_id,vendedor,ultima_atividade,ultima_enviada_por";

  const linhas: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = semSinteticos(sb.from(VIEW_CHAT_LISTA).select(MAGRAS))
      .not("ultima_atividade", "is", null)
      .order("cliente_id", { ascending: true })
      .range(from, from + PAGE - 1);
    // sem carteira (admin/home) conta tudo; com carteira, a própria mais a fila
    if (s.carteira) q = q.or(`vendedor.eq.${s.carteira},vendedor.is.null`);
    const { data } = await q;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const lidaAte = new Map((leituras ?? []).map((l: any) => [l.cliente_id, l.lida_ate]));
  const favs = new Set((favoritos ?? []).map((f: any) => f.cliente_id));
  const estado = new Map((estados ?? []).map((e: any) => [e.cliente_id, e.status]));

  const c: Contagens = { todas: 0, nao_lidas: 0, favoritas: 0, fila: 0, resolvidas: 0 };
  for (const l of linhas) {
    const dono = donoEfetivo(l.cliente_id, l.vendedor ?? null, atrib);
    const naFila = dono === null;
    // fora do meu escopo (transferida para outra carteira) não conta
    if (s.carteira && !naFila && dono !== s.carteira) continue;
    const resolvida = estado.get(l.cliente_id) === "resolvida";
    const marca = lidaAte.get(l.cliente_id);
    const naoLida =
      l.ultima_enviada_por === "customer" && (!marca || new Date(l.ultima_atividade) > new Date(marca));

    if (naFila) c.fila++;
    else if (resolvida) c.resolvidas++;
    else {
      c.todas++;
      if (naoLida) c.nao_lidas++;
    }
    if (favs.has(l.cliente_id)) c.favoritas++;
  }
  return c;
}

export async function lerLista(s: Sessao, limite: number | null = 60): Promise<Lista> {
  const sb = banco();
  const PAGE = 1000;

  const [atrib, favoritosRes, leiturasRes, estadosRes, vendedoresRes] = await Promise.all([
    carregarAtribuicoes(sb),
    sb.from("chat_favorito").select("cliente_id").eq("usuario", s.usuario),
    sb.from("chat_leitura").select("cliente_id,lida_ate").eq("usuario", s.usuario),
    sb.from("chat_conversa").select("cliente_id,status,motivo"),
    sb.from("carteira_config").select("slug,cor").eq("ativo", true).order("slug"),
  ]);

  // ---- as conversas do escopo ---------------------------------------------
  const linhas: any[] = [];
  const alvo = limite ?? Infinity;
  for (let from = 0; from < alvo; from += PAGE) {
    const pedaco = Math.min(PAGE, alvo - from);
    let q = semSinteticos(sb.from(VIEW_CHAT_LISTA).select(COLS))
      .not("ultima_atividade", "is", null)
      .order("ultima_atividade", { ascending: false })
      // desempate obrigatório: cada página é uma consulta, e sem ordem total o
      // Postgres pode repetir uma linha numa e omiti-la na outra
      .order("cliente_id", { ascending: true })
      .range(from, from + pedaco - 1);
    if (s.carteira) q = q.eq("vendedor", s.carteira);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
    if (!data || data.length < pedaco) break;
  }

  // ---- a FILA: conversa sem dono nenhum, visível para todos ---------------
  // Buscada à parte porque o filtro por carteira acima nunca traz `vendedor`
  // nulo. Com limite, só a primeira página dela — é uma fila curta (2 hoje).
  const filaBruta: any[] = [];
  {
    const pedaco = Math.min(PAGE, limite ?? PAGE);
    const { data } = await semSinteticos(sb.from(VIEW_CHAT_LISTA).select(COLS))
      .not("ultima_atividade", "is", null)
      .is("vendedor", null)
      .order("ultima_atividade", { ascending: false })
      .order("cliente_id", { ascending: true })
      .range(0, pedaco - 1);
    filaBruta.push(...(data ?? []));
  }

  // ---- o que foi transferido PARA mim de outra carteira -------------------
  if (s.carteira) {
    const jaTem = new Set(linhas.map((c) => c.cliente_id));
    const recebidas = [...atrib.entries()]
      .filter(([id, a]) => a.para === s.carteira && !jaTem.has(id))
      .map(([id]) => id);
    for (const lote of emLotes(recebidas)) {
      const { data } = await semSinteticos(sb.from(VIEW_CHAT_LISTA).select(COLS))
        .in("cliente_id", lote)
        .not("ultima_atividade", "is", null);
      linhas.push(...(data ?? []));
    }
  }

  // `vendedor` nulo na view não basta: a conversa pode ter sido transferida
  // para alguém. Sem dono efetivo = está mesmo na fila.
  const naFila = new Set(
    filaBruta.filter((c) => donoEfetivo(c.cliente_id, c.vendedor ?? null, atrib) === null).map((c) => c.cliente_id),
  );
  const jaListado = new Set(linhas.map((c) => c.cliente_id));
  linhas.push(...filaBruta.filter((c) => naFila.has(c.cliente_id) && !jaListado.has(c.cliente_id)));

  const doEscopo = aplicaEscopo(
    linhas.filter((c) => !naFila.has(c.cliente_id)),
    atrib,
    s.carteira,
  );
  const daFila = linhas
    .filter((c) => naFila.has(c.cliente_id))
    .map((c) => ({ ...c, vendedor: null, carteira_dona: c.vendedor ?? null, transferida_de: null, na_fila: true }));

  const lidaAte = new Map((leiturasRes.data ?? []).map((l: any) => [l.cliente_id, l.lida_ate]));
  const favoritas = new Set((favoritosRes.data ?? []).map((f: any) => f.cliente_id));
  const estado = new Map((estadosRes.data ?? []).map((e: any) => [e.cliente_id, e]));

  const conversas: Conversa[] = [...doEscopo, ...daFila]
    .map((c: any) => {
      const marca = lidaAte.get(c.cliente_id);
      const e: any = estado.get(c.cliente_id);
      return {
        ...c,
        na_fila: !!c.na_fila,
        // "não lida" = fala do cliente mais recente que a MINHA marca de leitura.
        // Sem marca, a conversa inteira conta como não lida.
        nao_lida:
          c.ultima_enviada_por === "customer" && (!marca || new Date(c.ultima_atividade) > new Date(marca)),
        favorita: favoritas.has(c.cliente_id),
        status: e?.status ?? "aberta",
        motivo: e?.motivo ?? null,
      } as Conversa;
    })
    .sort((a, b) => (a.ultima_atividade < b.ultima_atividade ? 1 : -1));

  return {
    conversas,
    tem_mais: limite !== null && linhas.length >= limite,
    vendedores: (vendedoresRes.data ?? []) as any[],
    meu_usuario: s.usuario,
    minha_carteira: s.carteira,
    em: new Date().toISOString(),
  };
}
