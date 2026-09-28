import { situacaoDoTelefone, acharOuCriarContato } from "./contatoDoErp";
import { tel8De } from "./telefone";

// ---------------------------------------------------------------------------
// Público do disparo em massa DECLARADO por código de cliente — lista digitada
// ou planilha. É o terceiro jeito de montar o público de uma campanha, ao lado
// do automático (`lib/publicoDisparo.ts`, por filtro) e do assistente (mesmo
// arquivo, conversando). Os três terminam no MESMO lugar: `montarPublico`, que
// aplica as proteções de custo (número morto, lixeira, anti-repetição,
// conversa aberta) — só os filtros de SEGMENTAÇÃO (carteira, etapa, "não
// comprou no período") não fazem sentido aqui, porque a lista já é a
// segmentação.
//
// Por dentro, toda entrada vira `codcli` — nunca nome solto. Digitar por nome
// abre busca com sugestões reais do WinThor (`buscarClientesPorNome`); a
// pessoa escolhe o registro antes de a entrada existir na lista, então não há
// como um "Maria Silva" ambíguo entrar sem que alguém tenha escolhido QUAL
// Maria Silva.
// ---------------------------------------------------------------------------

const COLS_ERP = "codcli,cpf,nome,telefone,cidade,estado,rca_num";

/**
 * Teto de UMA campanha por lista digitada ou planilha.
 *
 * Decisão do usuário (18/09/2026): "que siga independente da quantidade de
 * nomes na lista, respeitando apenas o teto de 5 mil". Era 500 — número que
 * vinha de a conferência ser uma ida ao banco por código dentro de uma rota de
 * 60 s. Isso não é mais um limite da lista: a tela confere em LOTES
 * (`LOTE_RESOLVER`), então o total deixou de importar para o tempo de cada
 * chamada. O teto que sobra é o de negócio.
 */
export const LIMITE_LISTA = 5000;

/**
 * Quantos códigos uma chamada de conferência aceita. Não é o teto da lista: é
 * o que cabe com folga nos 60 s da rota (56 códigos custaram ~49 s no regime
 * antigo, e resolver contato é escrita de verdade em `clientes`). A tela manda
 * a lista em fatias deste tamanho.
 */
export const LOTE_RESOLVER = 250;

/** Lotes de 200: uma URL com `in.(…)` de 5.000 códigos estoura o limite de tamanho. */
const LOTE_CONSULTA = 200;

/**
 * A partir de quantos códigos vale ler `clientes` inteira em vez de consultar um
 * contato por código.
 *
 * Medido em 18/09/2026: uma consulta `like %tel8` custa ~190 ms e um lote de 250
 * fazia 250 delas (28 s). Ler a tabela inteira leva ~1,2 s (5.211 linhas, 6
 * páginas) — então acima de umas dezenas de códigos a leitura única ganha, e o
 * cruzamento vira memória. Abaixo disso a consulta por código continua sendo a
 * mais barata (e não puxa 5 mil linhas para conferir três nomes).
 *
 * ⚠️ Custo cresce com a base de contatos: com 20 mil contatos são ~5 s por lote.
 * Se a tabela crescer muito, o caminho é uma função no banco que devolva só os
 * contatos dos telefones pedidos.
 */
const LIMIAR_LEITURA_UNICA = 30;

/** telefone (8 últimos dígitos) -> contatos que casam. O mesmo critério de `acharOuCriarContato`. */
async function mapaDeContatos(db: any): Promise<Map<string, any[]>> {
  const mapa = new Map<string, any[]>();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from("clientes")
      .select("id,nome_completo,carteira,telefone,cpf").order("id", { ascending: true }).range(de, de + 999);
    if (error) throw new Error(error.message);
    for (const c of data ?? []) {
      const t8 = tel8De(String(c.telefone ?? ""));
      if (t8.length !== 8) continue;
      const l = mapa.get(t8);
      if (l) l.push(c); else mapa.set(t8, [c]);
    }
    if (!data || data.length < 1000) break;
  }
  return mapa;
}

export type ItemErp = { codcli: number; nome: string; cidade: string | null; estado: string | null };

/** Autocomplete por nome — nunca texto livre além deste ponto. Até 20 candidatos. */
export async function buscarClientesPorNome(db: any, termo: string): Promise<ItemErp[]> {
  const t = termo.trim();
  if (t.length < 2) return [];
  const { data, error } = await db.from("wth_carteira").select(COLS_ERP)
    .ilike("nome", `%${t}%`).order("nome", { ascending: true }).limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    codcli: Number(r.codcli), nome: String(r.nome ?? ""), cidade: r.cidade ?? null, estado: r.estado ?? null,
  }));
}

/** Um código, conferido na hora — para o "+" da lista digitada por código. */
export async function buscarClientePorCodigo(db: any, codcli: number): Promise<ItemErp | null> {
  const { data, error } = await db.from("wth_carteira").select(COLS_ERP).eq("codcli", codcli).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { codcli: Number(data.codcli), nome: String(data.nome ?? ""), cidade: data.cidade ?? null, estado: data.estado ?? null };
}

/** O formato que `montarPublico` já sabe consumir (o mesmo que a `vw_funil_visivel` devolve). */
export type CardManual = {
  cliente_id: string; cliente: string; vendedor: string | null; etapa: null;
  ultima_atividade: null; telefone: string; venda_valor: null; rd_cliente_id: null; codcli: number;
};

export type ResolucaoLista = {
  cards: CardManual[];
  /** codcli que não deu para alcançar, e por quê — nunca some em silêncio (§36.1). */
  semAlcance: { codcli: number; nome: string | null; motivo: string }[];
};

/**
 * Transforma uma lista de codcli em cards prontos para `montarPublico`.
 *
 * Reusa `acharOuCriarContato` — a MESMA peça do botão "+" do chat e da aba
 * Minha carteira (§35.2/§38): cliente que já conversou reaproveita o contato
 * que já existe; quem nunca falou ganha um agora, do mesmo jeito, sem um
 * segundo caminho de identidade para o mesmo número. Só roda quando o admin
 * pede para "Conferir" — nunca a cada tecla, porque provisiona contato de
 * verdade (escreve em `clientes`).
 */
export async function resolverListaManual(db: any, codclis: number[]): Promise<ResolucaoLista> {
  const unicos = [...new Set(codclis.filter((n) => Number.isFinite(n) && n > 0))];
  if (!unicos.length) return { cards: [], semAlcance: [] };

  // ⚠️ EM LOTES, e não `.in("codcli", unicos)` com a lista inteira. Dois erros
  // silenciosos moram aí: a URL com milhares de códigos passa do tamanho que o
  // servidor aceita, e — pior — o PostgREST corta a resposta em 1.000 linhas
  // SEM avisar (§61.2). Com a lista inteira, do milésimo código em diante
  // clientes que existem no WinThor voltavam como "código não existe", e o
  // recado culpava a planilha. Cada lote de 200 volta com no máximo 200 linhas.
  const consultas: Promise<{ data: any[] | null; error: any }>[] = [];
  for (let de = 0; de < unicos.length; de += LOTE_CONSULTA) {
    consultas.push(
      db.from("wth_carteira").select(COLS_ERP).in("codcli", unicos.slice(de, de + LOTE_CONSULTA)),
    );
  }
  const [lotes, { data: cfgCart, error: e2 }] = await Promise.all([
    Promise.all(consultas),
    db.from("carteira_config").select('rca_num,slug').eq("ativo", true),
  ]);
  const erroLote = lotes.find((l) => l.error)?.error;
  if (erroLote) throw new Error(erroLote.message);
  if (e2) throw new Error(e2.message);
  const erp = lotes.flatMap((l) => l.data ?? []);

  const porCod = new Map<number, any>(erp.map((r: any) => [Number(r.codcli), r]));
  const slugPorRca = new Map<number, string>(
    (cfgCart ?? []).filter((c: any) => c.rca_num != null).map((c: any) => [Number(c.rca_num), c.slug]),
  );

  const cards: CardManual[] = [];
  const semAlcance: ResolucaoLista["semAlcance"] = [];
  let algumNovoComCpf = false;

  // Lista grande: lê os contatos UMA vez e cruza em memória (ver LIMIAR_LEITURA_UNICA).
  const contatos = unicos.length > LIMIAR_LEITURA_UNICA ? await mapaDeContatos(db) : null;

  /**
   * Resolve os códigos em PARALELO (lotes de 8), não um a um.
   *
   * ⚠️ Achado medindo antes de decidir (16/09/2026): com o laço em série e
   * `acharOuCriarContato` rodando a reconciliação por item, 56 códigos levaram
   * ~49s — perto do teto de 60s da rota. `pularReconciliacao: true` some com a
   * parte redundante (a função reconcilia a BASE INTEIRA a cada chamada, não só
   * o contato — rodá-la 56 vezes no mesmo pedido não traz nada que uma vez não
   * traga); o lote de 8 aproveita que são chamadas de rede, não CPU.
   */
  const LOTE = 8;
  for (let de = 0; de < unicos.length; de += LOTE) {
    const fatia = unicos.slice(de, de + LOTE);
    await Promise.all(fatia.map(async (cod) => {
      const row = porCod.get(cod);
      if (!row) { semAlcance.push({ codcli: cod, nome: null, motivo: "código não existe no WinThor" }); return; }

      const sit = situacaoDoTelefone(row.telefone);
      if (!sit.pode) {
        semAlcance.push({
          codcli: cod, nome: row.nome,
          motivo: sit.motivo === "sem_telefone"
            ? "sem telefone no cadastro do WinThor"
            : `telefone incompleto no cadastro (${sit.bruto})`,
        });
        return;
      }

      const slug = row.rca_num != null ? (slugPorRca.get(Number(row.rca_num)) ?? null) : null;
      let resolvido;
      try {
        resolvido = await acharOuCriarContato(db, {
          telefone: sit.telefone,
          nome: row.nome,
          erp: { codcli: row.codcli, nome: row.nome, cpf: row.cpf, carteira: slug },
          pularReconciliacao: true,
          candidatos: contatos ? (contatos.get(tel8De(sit.telefone)) ?? []) : undefined,
        });
        // um contato recém-criado entra no mapa: dois códigos com o mesmo
        // telefone no mesmo lote acham o MESMO contato, e não criam dois
        if (contatos && !resolvido.ja_existia) {
          contatos.set(tel8De(sit.telefone), [{
            id: resolvido.cliente_id, nome_completo: resolvido.nome, carteira: resolvido.carteira,
            telefone: resolvido.telefone, cpf: row.cpf ?? null,
          }]);
        }
      } catch (e: any) {
        semAlcance.push({ codcli: cod, nome: row.nome, motivo: `erro ao preparar o contato: ${e?.message ?? e}` });
        return;
      }

      if (!resolvido.ja_existia && row.cpf) algumNovoComCpf = true;
      cards.push({
        cliente_id: resolvido.cliente_id, cliente: resolvido.nome, vendedor: resolvido.carteira,
        etapa: null, ultima_atividade: null, telefone: resolvido.telefone, venda_valor: null,
        rd_cliente_id: null, codcli: cod,
      });
    }));
  }

  // A reconciliação pulada acima acontece UMA vez aqui, para o lote inteiro —
  // é a mesma chamada, só que uma vez em vez de N. Falhar não pode custar o
  // público já resolvido: o cron de 10 min pega de qualquer jeito.
  if (algumNovoComCpf) {
    try { await db.rpc("wth_reconciliar_vinculos"); } catch { /* o cron pega */ }
  }

  return { cards, semAlcance };
}

/**
 * Janela em que "já recebeu este template" vale como sinal de envio INTERROMPIDO.
 * Doze horas cobrem um envio de 5.000 (2h30 no laço antigo, ~15-30 min agora)
 * retomado no mesmo dia, sem tratar como "duplicado" quem recebeu o mesmo
 * template numa campanha de semanas atrás.
 */
export const JANELA_RETOMADA_HORAS = 12;

/**
 * Quem, entre os selecionados, JÁ recebeu este template há pouco.
 *
 * Por que existe (18/09/2026): a planilha pula TODAS as proteções, inclusive a
 * anti-repetição — decisão do usuário, "a planilha já é o resultado curado". Mas
 * o envio é um laço na aba, e com 5.000 clientes ela fica aberta por muito
 * tempo. Se a aba fechar aos 3.000 e a mesma planilha for enviada de novo, os
 * primeiros 3.000 recebem em DOBRO (R$ 0,43 a mais cada e a cliente recebendo
 * duas vezes). A tela dizia "é só rodar de novo, que quem já recebeu fica de
 * fora" — o que era falso justamente para planilha.
 *
 * Isto NÃO reaplica a proteção: só INFORMA quem já recebeu, e a pessoa decide
 * (pular esses, ou enviar para todos de novo de propósito). A decisão continua
 * sendo dela, e a planilha continua valendo como o público inteiro.
 *
 * O `template_id` gravado por `/api/send-template` é o nome do template na Meta
 * (`meta_nome`) — o mesmo valor que a tela manda como `templateEnvioId`.
 */
export async function quemJaRecebeu(
  db: any, templateEnvioId: string, selecionados: { envio_id: string; cliente_id: string }[],
  horas: number = JANELA_RETOMADA_HORAS,
): Promise<string[]> {
  if (!templateEnvioId || !selecionados.length) return [];
  const desde = new Date(Date.now() - horas * 3_600_000).toISOString();
  const recebeu = new Set<string>();
  // ⚠️ paginado: o PostgREST corta em 1.000 linhas SEM avisar (§61.2), e um
  // envio interrompido aos 3.000 deixa 3.000 linhas para ler.
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from("disparos_template").select("cliente_id")
      .eq("template_id", templateEnvioId).gte("criada_em", desde)
      .order("id", { ascending: true }).range(de, de + 999);
    if (error) throw new Error(error.message);
    for (const l of data ?? []) if (l.cliente_id) recebeu.add(String(l.cliente_id));
    if (!data || data.length < 1000) break;
  }
  return selecionados
    .filter((s) => recebeu.has(String(s.envio_id)) || recebeu.has(String(s.cliente_id)))
    .map((s) => s.envio_id);
}
