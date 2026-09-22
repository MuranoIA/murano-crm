import "server-only";
import { banco } from "./servidor";
import { lerCrmConfig, filtroLinhas } from "../../../lib/crmConfig";
import { textoDoTemplate } from "../../../lib/templateTexto";

// ---------------------------------------------------------------------------
// As mensagens de uma conversa, para a PRIMEIRA PINTURA no servidor.
//
// A tela continua falando com `/api/chat/thread` depois: é ela que pagina para
// trás (`?antes=`), busca o que chegou (`?desde=`) e traz notas, transferências
// e ligações. Aqui é só o que precisa estar no HTML para a conversa aparecer
// junto com a lista, sem esperar JS.
//
// Medido na fase 0: do clique até a thread chegar, 1,68 s. No v2 o caso de
// entrar direto numa conversa (o link do board, o push, o F5) não paga isso.
// ---------------------------------------------------------------------------

export type Mensagem = {
  id: string;
  conteudo: string | null;
  enviada_por: string | null;
  tipo: string | null;
  status: string | null;
  criada_em: string;
  midia_tipo: string | null;
  midia_mime: string | null;
  midia_nome: string | null;
  reacao: string | null;
  resposta_a: string | null;
  erro: string | null;
  /** SÓ DO NAVEGADOR — nunca vem do servidor. A bolha de um anexo que ainda
   *  está subindo: a prévia é o próprio arquivo (`URL.createObjectURL`) e `pct`
   *  é o andamento do upload. Some quando a linha de verdade chega. */
  local?: { url: string | null; pct: number | null };
};

export type Thread = {
  cliente_id: string;
  /** ⚠️ Sem `codcli`: ele NÃO existe em `public.clientes` (vem da view da
   *  lista, que é materializada). O cabeçalho mostra "cód. N" quando a conversa
   *  está na lista, e omite quando não está — omitir é melhor que inventar. */
  cliente: { nome: string | null; telefone: string | null } | null;
  mensagens: Mensagem[];
  /** true quando há conversa mais antiga do que o lote devolvido */
  tem_mais: boolean;
};

const COLS =
  "id,conteudo,enviada_por,tipo,status,criada_em,midia_tipo,midia_mime,midia_nome,reacao,resposta_a,erro";

export async function lerThread(cliente_id: string, limite = 40): Promise<Thread> {
  const sb = banco();
  const cfg = await lerCrmConfig(sb);

  // pede UM a mais que o limite: é assim que se sabe que ainda há passado, sem
  // uma segunda consulta de contagem (mesma regra do `/api/chat/thread`)
  let q = sb.from("mensagens").select(COLS).eq("cliente_id", cliente_id);
  q = filtroLinhas(q, cfg);
  const [msgsRes, clienteRes] = await Promise.all([
    q.order("criada_em", { ascending: false }).limit(limite + 1),
    // ⚠️ `codcli` NÃO É COLUNA DE `clientes` — pedi-lo aqui fazia o PostgREST
    // devolver ERRO, não uma linha sem o campo (§62.6). O efeito era mudo e
    // grande: `cliente` vinha nulo, a conversa não tinha de onde nascer e a
    // tela abria em "Escolha uma conversa à esquerda". Ou seja, o link do
    // board, o push e o F5 dentro de um atendimento — os três casos que a
    // primeira carga no servidor existe para atender — caíam numa tela vazia.
    sb.from("clientes").select("nome_completo,telefone").eq("id", cliente_id).maybeSingle(),
  ]);

  const cruas = (msgsRes.data ?? []).filter((m: any) => m.tipo !== "evento_sistema");
  const tem_mais = cruas.length > limite;
  const mensagens = cruas.slice(0, limite).reverse() as Mensagem[];

  const c: any = clienteRes.data;
  // "[template] nome_tecnico" vira a frase que a cliente leu. A tradução mora
  // em lib/ porque a thread e o PDF a usam — duas cópias fariam o documento
  // baixado mostrar o identificador técnico. Reescreve `conteudo` no lugar, e
  // só faz uma consulta a mais quando há template no lote.
  await textoDoTemplate(sb, mensagens, c?.nome_completo ?? null);
  return {
    cliente_id,
    cliente: c ? { nome: c.nome_completo ?? null, telefone: c.telefone ?? null } : null,
    mensagens,
    tem_mais,
  };
}
