import { sbAdmin, guardaAdmin, corpo, texto } from "../../../lib/adminApi";
import {
  atribuirCarteira, carteirasDoRd, slugDaCarteira, explicarErro, esperaEntreChamadas,
} from "../../../lib/carteiraRd";

export const dynamic = "force-dynamic";

// Gestão de Carteira — move contatos entre carteiras NO RD CONVERSAS.
//
// Três sistemas guardam uma ideia de "carteira" e esta rota mexe em dois:
//   · RD Conversas (`current_wallet`)  -> a escrita real acontece aqui
//   · `clientes.carteira` no Supabase  -> espelho; atualizado junto (ver abaixo)
//   · RCA do WinThor (`wth_carteira`)  -> dono comercial no ERP. NÃO é tocado:
//     o murano-clientes-v2 é somente leitura (§10.1) e `wth_carteira` é
//     reescrita a cada 10 min pelo `wth-sync-tudo`. Transferir aqui portanto
//     ACENDE uma linha em `vw_divergencia_carteira` até o ERP ser ajustado —
//     a tela avisa isso em texto.
//
// POR QUE O ESPELHO É ESCRITO AQUI (e não deixado para o ETL, como manda a
// regra geral do §10.11): o ETL grava `clientes.carteira` UMA ÚNICA VEZ, quando
// vê o contato pela primeira vez (src/etl/run.ts, o `clientes.set` mora dentro
// do laço dos `novos`); contato já conhecido pula a checagem que traria o
// `current_wallet` novo. Verificado em 19/08/2026: vale no incremental e no
// full. Sem a escrita daqui, a transferência simplesmente nunca apareceria no
// board, no chat nem no funil — para sempre. Como o ETL não sobrescreve esse
// campo em contato conhecido, não há a disputa que a regra do §10.11 evita.

const LIMITE_PAGINA = 1000;   // teto do PostgREST
const RENDER_MAX = 60_000;    // corte de tempo por requisição de lote (ms)

type Cliente = { id: string; nome_completo: string | null; telefone: string | null; canal: string | null; carteira: string | null };

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- GET: carteiras disponíveis + clientes de uma delas ---------------------

export async function GET(req: Request) {
  const g = guardaAdmin("gerenciar carteiras");
  if (g.erro) return g.erro;

  const url = new URL(req.url);
  const slug = texto(url.searchParams.get("slug"));

  try {
    const sb = sbAdmin();

    const { data: cfg, error: eCfg } = await sb
      .from("carteira_config").select("slug,cor,time").eq("ativo", true).order("slug");
    if (eCfg) throw new Error(`carteira_config: ${eCfg.message}`);

    // Nomes de exibição vêm do RD, porque é o que a API de escrita exige. Uma
    // carteira configurada aqui que não exista lá NÃO pode receber ninguém — a
    // tela precisa saber disso antes de o supervisor selecionar 300 clientes.
    let nomesRd: string[] = [];
    let avisoRd: string | null = null;
    try {
      nomesRd = await carteirasDoRd();
    } catch (e: any) {
      avisoRd = `Não foi possível ler as carteiras do RD (${e?.message ?? e}). A transferência fica indisponível até isso voltar.`;
    }
    const porSlug = new Map(nomesRd.map((n) => [slugDaCarteira(n), n]));

    const carteiras = await Promise.all((cfg ?? []).map(async (c: any) => {
      const { count } = await sb
        .from("clientes").select("*", { count: "exact", head: true }).eq("carteira", c.slug);
      return {
        slug: c.slug as string,
        cor: (c.cor ?? null) as string | null,
        time: (c.time ?? null) as string | null,
        nome_rd: porSlug.get(c.slug) ?? null,   // null = não existe no RD
        total: count ?? 0,
      };
    }));

    let clientes: Cliente[] = [];
    if (slug) {
      for (let de = 0; ; de += LIMITE_PAGINA) {
        const { data, error } = await sb
          .from("clientes").select("id,nome_completo,telefone,canal,carteira")
          .eq("carteira", slug).order("nome_completo", { ascending: true })
          .range(de, de + LIMITE_PAGINA - 1);
        if (error) throw new Error(`clientes: ${error.message}`);
        clientes = clientes.concat((data ?? []) as Cliente[]);
        if ((data?.length ?? 0) < LIMITE_PAGINA) break;
      }
    }

    return Response.json({ carteiras, clientes, avisoRd });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "falha ao carregar" }, { status: 500 });
  }
}

// --- POST: transferir um lote ----------------------------------------------
//
// A requisição processa o quanto couber em RENDER_MAX e devolve o que sobrou em
// `restantes`; o cliente reenvia. Isso existe porque a trava é dupla e nenhuma
// das duas some com esforço: a API do RD sustenta ~48 chamadas/min (§14.5) e a
// função serverless tem teto de execução. Uma carteira de 800 contatos leva
// ~17 min de qualquer jeito — o que dá para escolher é se isso acontece com
// barra de progresso ou com um timeout no meio e ninguém sabendo onde parou.

export async function POST(req: Request) {
  const g = guardaAdmin("transferir carteira");
  if (g.erro) return g.erro;

  const body = await corpo(req);
  const para = texto(body?.para);
  const observacao = texto(body?.observacao) || null;
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map((v: unknown) => texto(v)).filter(Boolean) : [];

  if (!para) return Response.json({ error: "carteira de destino ausente" }, { status: 400 });
  if (!ids.length) return Response.json({ error: "nenhum cliente selecionado" }, { status: 400 });

  try {
    const sb = sbAdmin();

    // destino tem de ser carteira ativa do CRM **e** existir no RD
    const { data: cfg, error: eCfg } = await sb
      .from("carteira_config").select("slug").eq("ativo", true).eq("slug", para).maybeSingle();
    if (eCfg) throw new Error(`carteira_config: ${eCfg.message}`);
    if (!cfg) return Response.json({ error: `carteira "${para}" não está ativa no CRM` }, { status: 400 });

    const nomeRd = (await carteirasDoRd()).find((n) => slugDaCarteira(n) === para);
    if (!nomeRd) {
      return Response.json(
        { error: `a carteira "${para}" não existe no RD Conversas — crie-a lá antes de transferir` },
        { status: 400 },
      );
    }

    // origem de cada contato, para o histórico. Lida ANTES de escrever, senão
    // o `de_carteira` sai igual ao destino e o registro perde o sentido.
    const origem = new Map<string, string | null>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb
        .from("clientes").select("id,carteira").in("id", ids.slice(i, i + 200));
      if (error) throw new Error(`clientes: ${error.message}`);
      for (const r of data ?? []) origem.set(r.id, r.carteira ?? null);
    }

    const inicio = Date.now();
    const feitos: string[] = [];
    const falhas: { id: string; erro: string; recuperavel: boolean }[] = [];
    let restantes: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      if (Date.now() - inicio > RENDER_MAX) { restantes = ids.slice(i); break; }
      const id = ids[i];

      if (origem.get(id) === para) { feitos.push(id); continue; } // já está lá: nada a fazer

      const r = await atribuirCarteira(id, nomeRd);
      if (r.ok) feitos.push(id);
      else falhas.push({ id, erro: explicarErro(r.status, r.erro), recuperavel: r.recuperavel });

      if (i < ids.length - 1) await dormir(esperaEntreChamadas);
    }

    // Espelho + histórico em lote: todos os sucessos deste pedaço foram para a
    // MESMA carteira, então um update resolve. Se esta parte falhar, o RD já
    // mudou e o nosso banco não — por isso o erro sobe em vez de ser engolido:
    // repetir a transferência é idempotente (o RD responde 204 de novo).
    let avisoEspelho: string | null = null;
    if (feitos.length) {
      const { error: eUp } = await sb.from("clientes").update({ carteira: para }).in("id", feitos);
      if (eUp) avisoEspelho = `Transferido no RD, mas o espelho local falhou (${eUp.message}). Repita a operação — ela é idempotente.`;
    }

    const linhas = [
      ...feitos.map((id) => ({
        cliente_id: id, de_carteira: origem.get(id) ?? null, para_carteira: para,
        por: g.email ?? "desconhecido", observacao, sucesso: true, erro: null as string | null,
      })),
      ...falhas.map((f) => ({
        cliente_id: f.id, de_carteira: origem.get(f.id) ?? null, para_carteira: para,
        por: g.email ?? "desconhecido", observacao, sucesso: false, erro: f.erro,
      })),
    ];
    if (linhas.length) {
      const { error: eHist } = await sb.from("carteira_transferencia").insert(linhas);
      // histórico é registro, não a operação: falhar aqui não invalida o que já
      // foi feito no RD, então vira aviso e não erro da requisição.
      if (eHist) avisoEspelho = (avisoEspelho ? avisoEspelho + " " : "") + `Histórico não gravado: ${eHist.message}`;
    }

    return Response.json({ feitos: feitos.length, falhas, restantes, avisoEspelho });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "falha ao transferir" }, { status: 500 });
  }
}
