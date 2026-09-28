import type { Cubo, Fila, Recortes } from "./tipos";

// ---------------------------------------------------------------------------
// OS NÚMEROS DOS FILTROS, derivados do cubo do servidor.
//
// Bug relatado pelo dono em 28/09/2026: os quadradinhos das colunas do board
// apareciam SEM número nenhum. A causa era estrutural — eles contavam sobre a
// lista inteira em memória, e a lista inteira só é baixada quando alguém abre
// um seletor de consultor (§fase 1: a tela abre com 60 conversas, não com as
// ~4 mil). A faixa das colunas saiu do painel de filtros em 28/09 e passou a
// ficar sempre visível, mas o gesto que mandava buscar o resto ficou para trás.
//
// O conserto NÃO é baixar a lista inteira — seriam 2,7 MB para desenhar sete
// números, exatamente o que a fase 1 tirou do caminho. É o servidor contar e
// mandar só os números (`contarFilas`, `Cubo`).
//
// ⚠️ A REGRA QUE ESTAS FUNÇÕES PRESERVAM (§23.5): cada contador conta DENTRO do
// que os outros seletores já escolheram. O número das colunas respeita o
// consultor escolhido; o dos consultores respeita a coluna escolhida; e nenhum
// dos dois se filtra por si mesmo, senão a única opção acesa mostraria o total
// e todas as outras, zero.
//
// ⚠️ A FILA DE ESPERA escapa do filtro por consultor, aqui como na lista
// (`passaVend` na Casca): conversa sem dono não pertence a carteira nenhuma, e
// escondê-la ao escolher um consultor faria sumir justamente o que qualquer um
// pode pegar. No cubo ela é a chave de dono vazia.
// ---------------------------------------------------------------------------
const FILAS_DO_CUBO: Fila[] = ["todas", "nao_lidas", "favoritas", "fila", "resolvidas", "recados"];

/** o cubo não carrega o número da linha — ver `podeDerivar` */
const passaDono = (k: string, rec: Recortes) => !rec.vendedor || k === "" || k === rec.vendedor;
const passaEtapa = (k: string, rec: Recortes) => !rec.etapa || k === rec.etapa;

/**
 * O cubo responde por consultor e por coluna, não por NÚMERO: hoje há uma linha
 * ativa só e o seletor nem aparece (§23.4). Se um dia houver duas, o recorte por
 * número volta a exigir a lista inteira — e é melhor a tela ficar sem número do
 * que mostrar um que ignora um filtro ligado.
 */
export const podeDerivar = (cubo: Cubo | null | undefined, rec: Recortes): cubo is Cubo =>
  !!cubo && !rec.linha;

/** quantas conversas em cada fila, dentro dos recortes ligados */
export function filasDoCubo(cubo: Cubo, rec: Recortes): Record<Fila, number | null> {
  const out = {} as Record<Fila, number | null>;
  for (const f of FILAS_DO_CUBO) {
    let n = 0;
    const porDono = cubo[f] ?? {};
    for (const [dono, porEtapa] of Object.entries(porDono)) {
      if (!passaDono(dono, rec)) continue;
      for (const [etapa, q] of Object.entries(porEtapa)) if (passaEtapa(etapa, rec)) n += q;
    }
    out[f] = n;
  }
  // agenda, não fila: o número dela mora no cabeçalho da própria lista
  out.carteira = null;
  return out;
}

/** quantas conversas da fila atual em cada coluna do board (ignora o recorte de coluna) */
export function etapasDoCubo(cubo: Cubo, fila: Fila, rec: Recortes): Map<string, number> {
  const m = new Map<string, number>();
  for (const [dono, porEtapa] of Object.entries(cubo[fila] ?? {})) {
    if (!passaDono(dono, rec)) continue;
    for (const [etapa, q] of Object.entries(porEtapa)) {
      if (!etapa) continue; // sem coluna do board: não há quadradinho para somar
      m.set(etapa, (m.get(etapa) ?? 0) + q);
    }
  }
  return m;
}

/** …e em cada consultor (ignora o recorte de consultor) */
export function consultoresDoCubo(cubo: Cubo, fila: Fila, rec: Recortes): Map<string, number> {
  const m = new Map<string, number>();
  for (const [dono, porEtapa] of Object.entries(cubo[fila] ?? {})) {
    if (!dono) continue; // fila de espera não tem consultor
    for (const [etapa, q] of Object.entries(porEtapa)) {
      if (!passaEtapa(etapa, rec)) continue;
      m.set(dono, (m.get(dono) ?? 0) + q);
    }
  }
  return m;
}
