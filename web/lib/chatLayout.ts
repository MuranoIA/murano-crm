// Catálogo dos desenhos possíveis do /chat e a régua de qual está em vigor.
//
// Este arquivo é a FONTE ÚNICA de duas coisas que não podem divergir:
//
//   1. quais desenhos existem e o que cada um defende (o texto que o admin lê
//      antes de escolher — vem do laudo em `prototipos/laudo-ux-chat.md`);
//   2. quais deles têm implementação de verdade (`implementado`).
//
// O item 2 mora aqui, e não no banco, de propósito: quem sabe se a Direção 2
// existe é o deploy que está no ar, não uma coluna. Se estivesse nos dois
// lugares, divergiriam no primeiro deploy — e o admin conseguiria "estabelecer
// para todos" um desenho que ninguém construiu, que é justamente o erro que
// esta separação evita. Ver o comentário longo da migration 0095.
//
// Ao implementar uma direção: virar `implementado: true` aqui é o último passo,
// depois de a tela existir. É o gesto que a torna selecionável no /admin.

export type LayoutId = "original" | "continuidade" | "bancada" | "fila" | "balcao";

export const LAYOUT_PADRAO: LayoutId = "original";

export type Layout = {
  id: LayoutId;
  rotulo: string;
  /** uma linha, para a lista */
  resumo: string;
  /** a tese da direção — por que ela existe */
  tese: string;
  /** o que ela resolve, do laudo */
  ganhos: string[];
  /** o que ela sacrifica. Toda direção sacrifica algo; esconder isso é o que
   *  transforma uma escolha informada em aposta. */
  sacrificios: string[];
  risco: "nenhum" | "baixo" | "alto";
  prazo: string;
  /** arquivo do protótipo no repositório. Não guardamos a URL do artifact
   *  publicado: ela é um link privado e este repositório é público (§15.5). */
  prototipo: string | null;
  /** false = existe como protótipo, mas não há tela construída. A rota do
   *  /admin recusa ativar; a tela mostra como "em avaliação". */
  implementado: boolean;
};

export const LAYOUTS: Layout[] = [
  {
    id: "original",
    rotulo: "Original",
    resumo: "A tela de hoje, como a equipe já usa.",
    tese:
      "O desenho atual, construído ao longo de 2026 espelhando a posição de elementos do RD " +
      "Conversas. É o ponto de partida da auditoria e, principalmente, o caminho de volta: " +
      "enquanto 'original' for um valor válido, nenhum redesenho é irreversível.",
    ganhos: [
      "Zero treinamento — é o que a equipe já sabe usar",
      "O painel do ERP ao lado da conversa, que o RD não tem",
      "Transferência com histórico, busca por trigrama e indicadores por rajada já corretos",
    ],
    sacrificios: [
      "Não diz quantas clientes estão esperando sem abrir um menu",
      "A janela de 24h só se manifesta depois que a mensagem falha",
      "No celular, atende-se sem nenhum dado de compra",
      "A barra de chamada cobre a caixa de digitação",
    ],
    risco: "nenhum",
    prazo: "—",
    prototipo: null,
    implementado: true,
  },
  {
    id: "continuidade",
    rotulo: "1 · Continuidade",
    resumo: "Nada muda de lugar. Coisas passam a aparecer.",
    tese:
      "A equipe tem memória muscular do RD Conversas, e o orçamento inteiro de mudança foi " +
      "gasto nos quatro pontos que doem todo dia — sem mover nenhum elemento de lugar. É o " +
      "piso: quase tudo aqui é correção do que já existe, e vale mesmo que a escolha final " +
      "seja outra.",
    ganhos: [
      "Contadores das filas fora do menu — a primeira pergunta do dia custa zero clique",
      "Faixa permanente da janela de 24h, antes de a mensagem ser escrita",
      "O painel do cliente abre no resumo comercial, não no telefone",
      "Mobile resolvido: barra inferior, folha com o ERP, 100dvh e área segura",
      "Freios nos erros caros: motivo antes dos nomes na transferência, custo do template à vista, reenviar dentro da bolha",
    ],
    sacrificios: [
      "Não muda a forma do dia — continua sendo caça cronológica",
      "Mostra melhor o que existe, mas não diz o que fazer em seguida",
      "Não resolve a tabulação como problema cultural",
    ],
    risco: "baixo",
    prazo: "curto",
    prototipo: "prototipos/direcao-1-continuidade.html",
    // Construída em 24/08/2026. Tudo o que ela muda está atrás da flag `d1` em
    // `app/chat/page.tsx` — não há uma segunda árvore de JSX, e o desenho
    // original ficou intacto para o rollback ser exato.
    implementado: true,
  },
  {
    id: "bancada",
    rotulo: "4 · Bancada",
    resumo: "Nada de novo na tela. Tudo no mesmo ritmo.",
    tese:
      "Herda todas as correções da Direção 1 e não acrescenta nenhuma informação nova. " +
      "O que muda é que a tela passa a obedecer a uma grade: sete degraus de espaço, sete " +
      "de tipografia, três de raio, três alturas de controle, dois de elevação e cinco " +
      "famílias de cor com um trabalho cada. A 1 respondeu 'o que falta aparecer'; esta " +
      "responde 'por que a tela parece improvisada mesmo mostrando a coisa certa'.",
    ganhos: [
      "Uma régua vertical por coluna — hoje a sidebar tem três bordas esquerdas e a conversa duas",
      "Uma goteira só: tudo que tem borda começa em 16 px no desktop e 12 no compacto",
      "Contrastes acima do mínimo em todo o texto, inclusive o metadado que hoje reprova",
      "O painel do ERP mais largo, para o valor comprado parar de truncar",
      "Alvos de toque no piso de 44 px no celular; 28 e 32 no compacto, e nada fora disso",
    ],
    sacrificios: [
      "Peso 800 é abolido: a primeira impressão pode ser de tela mais 'apagada'",
      "A lista fica 20 px mais estreita para o painel do cliente respirar",
      "Não muda a forma do dia nem vende mais por conversa — isso continua sendo a 2 e a 3",
      "Entregue por partes: a densidade (agrupar mensagens) e os ícones ainda são os de hoje",
    ],
    risco: "baixo",
    prazo: "curto",
    prototipo: "prototipos/tema-premium.html",
    // Construída em 27/08/2026, na PRIMEIRA das três entregas do plano
    // (`prototipos/laudo-tema-premium.md` §11.4): paleta e escalas — itens 1-9,
    // 13-14, 19 e 24-26. Herda as correções da D1 pelo conjunto `CORRIGE` em
    // `app/chat/page.tsx`, e a geometria vem da tabela `GRADES` do mesmo
    // arquivo, cuja entrada `original` reproduz os literais de hoje para o
    // rollback ser exato.
    //
    // AINDA NÃO ENTREGUES, e por isso ausentes dos `ganhos` acima: agrupar
    // mensagens por autor (itens 12, 20-23, 27) e os ícones em SVG com os
    // estados e o acabamento (18, 28-31). Prometer nos `ganhos` o que a tela
    // não faz é o mesmo erro que `implementado` no banco evitaria.
    implementado: true,
  },
  {
    id: "fila",
    rotulo: "2 · Fila de trabalho",
    resumo: "A pergunta não é que conversas existem, é qual é a próxima.",
    tese:
      "A lista deixa de ser um extrato cronológico e vira ordem de serviço em seções — " +
      "esperando você, janela fechando, adiadas, sem dono. Adiar vira ação de primeira " +
      "classe, e o encerramento vem procurar o vendedor quando a conversa esfria. Aposta em " +
      "atender mais conversas por dia.",
    ganhos: [
      "Triagem em três segundos: a fila já vem ordenada pela espera mais longa",
      "A janela de 24h trava a caixa antes de a mensagem ser digitada",
      "Fechei a venda escreve, encerra e tabula num gesto — a tabulação deixa de ser voluntária",
      "Teclado para o dia inteiro: ⌘K, j/k, r, e, s, t",
      "Cartão de altura uniforme, que é o pré-requisito barato da virtualização",
    ],
    sacrificios: [
      "Maior custo de treinamento das três",
      "Quebra a lista única — e uma seção que classifica errado é pior que uma lista burra",
      "A ficha do ERP recua para caber a fila mais larga",
      "Exige dado novo: adiar não existe no banco hoje",
    ],
    risco: "alto",
    prazo: "médio",
    prototipo: "prototipos/direcao-2-fila-de-trabalho.html",
    implementado: false,
  },
  {
    id: "balcao",
    rotulo: "3 · Balcão",
    resumo: "Isto não é um help desk, é um balcão de venda.",
    tese:
      "A unidade de trabalho passa a ser a cliente, não a conversa: quatro números do ERP " +
      "fixos sob o cabeçalho, com a ação recomendada como botão que escreve a mensagem. A " +
      "coluna da direita responde ao momento — template, catálogo com preço, tabulação, " +
      "chamada. Aposta em vender mais por conversa.",
    ganhos: [
      "A vantagem do ERP deixa de ser uma aba e passa a ser o contexto permanente",
      "Janela fechada já mostra os templates com o texto ao lado",
      "Chegou foto: o catálogo com preço aparece com o botão de mandar",
      "A tabulação aparece como dossiê do momento, não como formulário",
      "Nasce no escuro, como o hub que embute este CRM",
    ],
    sacrificios: [
      "Maior ruptura com o mapa do RD — painel que se move divide opiniões",
      "Sugestão comercial defasada vira mensagem errada com ar de autoridade",
      "Custo de dados por conversa bem maior que hoje",
      "Prazo longo: exige catálogo com preço e ação recomendada, que não existem no chat",
    ],
    risco: "alto",
    prazo: "longo",
    prototipo: "prototipos/direcao-3-balcao.html",
    implementado: false,
  },
];

const PORID = new Map(LAYOUTS.map((l) => [l.id, l]));

export const ehLayout = (v: unknown): v is LayoutId => PORID.has(String(v ?? "") as LayoutId);

export const acharLayout = (v: unknown): Layout | null => PORID.get(String(v ?? "") as LayoutId) ?? null;

/** Só um desenho com tela construída pode ser ativado — global ou em piloto. */
export const podeAtivar = (v: unknown): boolean => acharLayout(v)?.implementado === true;

/**
 * O desenho que ESTE usuário vê. O piloto ganha do global de propósito: é para
 * isso que ele existe — testar na própria conta enquanto a equipe segue no que
 * está valendo.
 *
 * Qualquer valor desconhecido (coluna nova, typo aplicado por SQL manual, ou um
 * desenho cuja implementação foi removida do código) cai no padrão em vez de
 * deixar a tela sem desenho nenhum. Numa tela de trabalho, degradar para o que
 * a equipe conhece é sempre melhor que quebrar.
 */
export function layoutEfetivo(global: unknown, piloto?: unknown): LayoutId {
  if (podeAtivar(piloto)) return piloto as LayoutId;
  if (podeAtivar(global)) return global as LayoutId;
  return LAYOUT_PADRAO;
}
