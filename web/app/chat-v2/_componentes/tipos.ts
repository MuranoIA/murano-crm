// Tipos que a tela e o servidor compartilham. Ficam num arquivo só para não
// haver duas definições da mesma conversa — o tipo é o contrato entre a carga
// do servidor (`_dados/`) e o que a tela desenha.
export type { Conversa, Lista } from "../_dados/lista";
export type { Mensagem, Thread } from "../_dados/thread";

/** Os recortes da sidebar. Um estado só: dois controles para a mesma escolha
 *  acabam se contradizendo (CLAUDE.md §32 e §68.2). */
export type Fila = "todas" | "nao_lidas" | "favoritas" | "fila" | "resolvidas";

export const FILAS: { id: Fila; rotulo: string; curto: string }[] = [
  { id: "todas", rotulo: "Todas", curto: "Todas" },
  { id: "nao_lidas", rotulo: "Não lidas", curto: "Não lidas" },
  { id: "favoritas", rotulo: "Favoritas", curto: "Favoritas" },
  { id: "fila", rotulo: "Fila de espera", curto: "Fila" },
  { id: "resolvidas", rotulo: "Resolvidas", curto: "Resolvidas" },
];
