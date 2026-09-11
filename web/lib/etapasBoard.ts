// As COLUNAS do board — e a régua que decide em qual delas um cliente está.
//
// Isto morava dentro de `app/page.tsx`. Saiu de lá quando o /chat ganhou o
// filtro por etapa (§68): as duas telas precisam concordar sobre o NOME, a
// ORDEM, a COR e, principalmente, a REGRA de cada etapa. Duas cópias
// divergiriam no primeiro ajuste da régua — e a divergência apareceria como
// "o board diz que ela está em Vender novamente, o chat diz Ociosos", que é o
// tipo de defeito que ninguém reporta porque parece implausível.
//
// ⚠️ A régua real do board NÃO é a coluna `etapa` da view. A view resolve três
// etapas (ociosos / tentativa_contato / negociacao / prospeccao); as duas de
// VENDA vêm de `vw_venda_card` (nota fiscal, 0105) e `sem_cadastro` é decidido
// na rota do funil. Quem só lê `etapa` da view classifica errado 344 das 1.113
// conversas de hoje — medido em 11/09/2026.

export const COLUNAS = [
  { key: "prospeccao", titulo: "Lista de prospecção", status: "A prospectar", cor: "#8b5cf6", sub: "carteira nunca contatada", subLong: "cliente cadastrado no WinThor que ainda não conversou",
    regras: "Um card cai aqui quando é cliente da sua carteira (WinThor, pelo RCA atual) que:\n• NUNCA teve conversa com operador — nunca foi contatado, ou entrou na sua carteira por troca de RCA e ainda não foi abordado por você;\n• E não comprou no mês corrente.\n\nAqui está o resto da carteira que ainda não virou conversa. O selo de ciclo de compra (Na hora / Atrasado…) ajuda a priorizar quem ligar primeiro.\n\nAutomação: ao disparar o 1º template ele vira conversa e migra pra Tentativa de contato; se o cliente responder → Negociação; se comprar no mês → Pedido emitido." },
  { key: "sem_cadastro", titulo: "Sem cadastro", status: "A definir", cor: "#b45309", sub: "não encontrado no WinThor", subLong: "contato que o ERP não reconhece — ainda não foi decidido se vira cliente",
    regras: "Um card cai aqui quando as DUAS coisas valem:\n• não há conversa nas linhas que você está vendo;\n• o contato não foi encontrado no WinThor (nem por CPF, nem por telefone, nem por nome).\n\nSão os clientes novos, os finais e os que ainda não foram decididos — o lugar de olhar antes de cadastrar ou descartar.\n\n⚠ “Não encontrado” é o que o sistema conseguiu apurar, não uma certeza: se o cadastro existir com outro nome e outro telefone, ele não é achado.\n\nAutomação: assim que o CPF for preenchido e o cadastro existir no WinThor, o vínculo aparece em até 10 minutos e o card migra sozinho para a Lista de prospecção — não há botão de mover." },
  { key: "ociosos", titulo: "Ociosos", status: "Parado", cor: "#94a3b8", sub: "parado +24h", subLong: "cliente falou por último há +24h — só um template reabre a conversa",
    regras: "Um card cai aqui quando:\n• o cliente já conversou e falou por último há +24h sem novo template (a janela de 24h do WhatsApp fechou — só um template reabre a conversa);\n• uma venda de mês anterior expirou e não houve nada depois.\n\n(Quem nunca foi contatado agora fica na Lista de prospecção, não aqui.)\n\nAutomação: sai daqui sozinho quando você dispara um template (→ Tentativa de contato) ou o cliente responde (→ Negociação)." },
  { key: "tentativa_contato", titulo: "Tentativa de contato", status: "Nova", cor: "#1a7fee", sub: "template enviado, sem resposta", subLong: "você mandou template, aguardando a 1ª resposta do cliente",
    regras: "Um card cai aqui quando:\n• a última mensagem real é do operador E é um template (você disparou e aguarda a 1ª resposta).\n\nAutomações:\n• cliente responde → Negociação;\n• passou +24h sem resposta → Ociosos;\n• parado +4 dias → o botão TEMPLATE reaparece pra reenviar." },
  { key: "negociacao", titulo: "Negociação", status: "Em andamento", cor: "#0e9fd6", sub: "conversa ativa (últimas 24h)", subLong: "troca ativa dentro da janela de 24h",
    regras: "Um card cai aqui quando:\n• há troca ativa nas últimas 24h (o cliente falou por último há menos de 24h, ou você falou fora de template).\n\nAutomações:\n• alerta vermelho 'AGUARDA RESPOSTA' se o cliente falou por último e você está +10 min sem responder (some ao clicar no card, volta se ele mandar msg nova);\n• passou 24h sem novo template → Ociosos;\n• fechou venda no mês → Pedido Emitido." },
  { key: "pedido_emitido", titulo: "Pedido emitido", status: "Vendida", cor: "#16a34a", sub: "comprou nos últimos 3 dias", subLong: "venda nos últimos 3 dias; depois vai para Vender novamente",
    regras: "Um card cai aqui quando há nota fiscal faturada no WinThor nos ÚLTIMOS 3 DIAS (fuso de Brasília).\n\nAutomações:\n• 3 dias após a compra o card vai para VENDER NOVAMENTE;\n• se comprar de novo, volta para cá na hora;\n• o selo R$ mostra o que ele comprou na janela de 18 dias — não o total do mês, que zeraria no dia 1º e mostraria R$ 0 num card que está aqui por causa de uma compra.\n\nO total R$ do cabeçalho é do MÊS (o número comercial que o time acompanha), então ele não coincide com esta coluna de propósito.\n\nConversa aberta tem precedência: se a cliente respondeu nas últimas 24h, o card fica em Negociação." },
  { key: "vender_novamente", titulo: "Vender novamente", status: "Recomprar", cor: "#0e7490", sub: "comprou de 3 a 18 dias atrás", subLong: "saiu de Pedido emitido e ainda não voltou a comprar",
    regras: "O cliente cai aqui 3 DIAS depois da compra, vindo de Pedido emitido.\n\nAutomações:\n• se comprar de novo, volta na hora para Pedido emitido;\n• se passarem 15 dias aqui sem nova compra (18 desde a compra), vai para Lista de prospecção;\n• o selo R$ mostra o que ele comprou na janela — não o total do mês, que zeraria no dia 1º.\n\nConversa aberta tem precedência: se a cliente respondeu nas últimas 24h, o card fica em Negociação." },
] as const;

export type EtapaBoard = (typeof COLUNAS)[number]["key"];

export const TITULO_ETAPA: Record<EtapaBoard, string> =
  Object.fromEntries(COLUNAS.map((c) => [c.key, c.titulo])) as Record<EtapaBoard, string>;
export const COR_ETAPA: Record<EtapaBoard, string> =
  Object.fromEntries(COLUNAS.map((c) => [c.key, c.cor])) as Record<EtapaBoard, string>;

// Duas etapas descrevem, por definição, quem NÃO tem conversa: prospecção é
// "nunca foi contatado" e sem cadastro é "não há conversa nas linhas visíveis".
// Elas existem no filtro do chat (some faria o olho procurar onde foram, que é
// a regra da casa para os contadores da sidebar), mas a lista vazia precisa
// dizer que o vazio é estrutural, e não um filtro que deu errado.
export const ETAPAS_SEM_CONVERSA: EtapaBoard[] = ["prospeccao", "sem_cadastro"];

// ---------------------------------------------------------------------------
// A régua
// ---------------------------------------------------------------------------

// O que a régua precisa saber de um cliente. Serve tanto para uma linha da
// view do funil quanto para uma conversa da sidebar do chat — os dois têm
// estes campos, e é justamente isso que permite uma régua só.
export type AlvoDeEtapa = {
  cliente_id: string;
  etapa?: string | null;          // a etapa CRUA da view (ociosos/tentativa/negociacao/prospeccao)
  ultima_atividade?: string | null;
  sem_cadastro?: boolean | null;
  codcli?: number | string | null;
  telefone?: string | null;
};

// Uma linha de `vw_venda_card` (0105): uma por cliente, com a etapa de venda
// já decidida no banco pela idade da compra.
export type LinhaDeVenda = {
  cliente_id?: string | null;
  codcli?: number | string | null;
  telefone?: string | null;
  etapa: string;                  // "pedido_emitido" | "vender_novamente"
  vendedor_slug?: string | null;
  conversa_aberta?: boolean | null;
};

export type LinhaDescartada = {
  cliente_id?: string | null;
  codcli?: number | string | null;
  tel8?: string | null;
};

const tel8 = (t: unknown) => String(t ?? "").replace(/\D/g, "").slice(-8);
const ehSintetico = (id: string) => /^(winthor|venda):/.test(id);
const codDe = (alvo: AlvoDeEtapa): number | null => {
  if (alvo.codcli != null && alvo.codcli !== "") {
    const n = Number(alvo.codcli);
    if (!isNaN(n)) return n;
  }
  if (typeof alvo.cliente_id === "string" && ehSintetico(alvo.cliente_id)) {
    const n = Number(alvo.cliente_id.slice(alvo.cliente_id.indexOf(":") + 1));
    if (!isNaN(n)) return n;
  }
  return null;
};

/**
 * Monta o classificador. É um construtor (e não uma função solta) porque a
 * régua depende de três conjuntos que se carregam uma vez por requisição — e
 * indexá-los a cada cliente seria O(n²) numa lista de mil conversas.
 *
 * `slugsAtivos` reproduz o recorte do board, que só monta card de venda para as
 * carteiras de `carteira_config` (§10.9). Sem ele, uma venda lançada por um RCA
 * de fora viraria "Pedido emitido" no chat sem card correspondente no board.
 *
 * Devolve `null` para quem NÃO tem coluna no board: o cliente descartado (some
 * do board por decisão) e o caso raro de a view dizer `pedido_emitido` sem
 * nota fiscal casada, que o board também descarta (`etapa !== "pedido_emitido"`
 * em /api/funil). `null` some de todo filtro de etapa e continua na lista
 * normal — é o equivalente honesto de "este cliente não está em coluna nenhuma".
 */
export function classificadorDeEtapa(dados: {
  vendas: LinhaDeVenda[];
  descartados?: LinhaDescartada[];
  slugsAtivos?: string[] | null;
}): (alvo: AlvoDeEtapa) => EtapaBoard | null {
  const slugs = dados.slugsAtivos && dados.slugsAtivos.length ? new Set(dados.slugsAtivos) : null;

  const vendaPorId = new Map<string, LinhaDeVenda>();
  const vendaPorCod = new Map<number, LinhaDeVenda>();
  const vendaPorTel = new Map<string, LinhaDeVenda>();
  for (const v of dados.vendas ?? []) {
    // `conversa_aberta` tem precedência sobre a venda: a cliente que respondeu
    // nas últimas 24h fica na coluna da CONVERSA, porque reabordar quem já está
    // falando com você é ruído (0105). É a mesma linha que o /api/funil usa
    // para não tirá-la das outras colunas.
    if (v.conversa_aberta) continue;
    if (slugs && !slugs.has(String(v.vendedor_slug ?? ""))) continue;
    if (v.cliente_id) vendaPorId.set(v.cliente_id, v);
    if (v.codcli != null) vendaPorCod.set(Number(v.codcli), v);
    const t = tel8(v.telefone);
    if (t.length === 8) vendaPorTel.set(t, v);
  }

  const descCli = new Set<string>(), descCod = new Set<number>(), descTel = new Set<string>();
  for (const d of dados.descartados ?? []) {
    if (d.cliente_id) descCli.add(d.cliente_id);
    if (d.codcli != null) descCod.add(Number(d.codcli));
    if (d.tel8) descTel.add(String(d.tel8));
  }

  return (alvo: AlvoDeEtapa): EtapaBoard | null => {
    const id = String(alvo.cliente_id ?? "");
    const cod = codDe(alvo);
    const t = tel8(alvo.telefone);

    // lixeira: some do board por qualquer identificador
    if (descCli.size || descCod.size || descTel.size) {
      if (id && descCli.has(id)) return null;
      if (cod != null && descCod.has(cod)) return null;
      if (t.length === 8 && descTel.has(t)) return null;
    }

    // venda (nota fiscal) ganha das etapas de conversa — é a coluna separada
    const venda = (id && !ehSintetico(id) ? vendaPorId.get(id) : undefined)
      ?? (cod != null ? vendaPorCod.get(cod) : undefined)
      ?? (t.length === 8 ? vendaPorTel.get(t) : undefined);
    if (venda) {
      return venda.etapa === "pedido_emitido" || venda.etapa === "vender_novamente"
        ? (venda.etapa as EtapaBoard)
        : null;
    }

    // A view diz que vendeu, mas não há nota fiscal casada: o board descarta
    // este card (`etapa !== "pedido_emitido"`). Inerte hoje — nenhuma conversa
    // chega assim —, está aqui para a régua não mentir se voltar a acontecer.
    if (alvo.etapa === "pedido_emitido") return null;

    // "Sem cadastro" é decisão de apresentação da rota do funil, não da view:
    // sem conversa visível, quem decide a coluna é o cadastro no ERP (§50.3).
    if (!alvo.ultima_atividade && alvo.sem_cadastro && id && !ehSintetico(id)) return "sem_cadastro";

    const e = String(alvo.etapa ?? "");
    return (COLUNAS as readonly { key: string }[]).some((c) => c.key === e) ? (e as EtapaBoard) : null;
  };
}
