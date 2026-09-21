// Tipos que a tela e o servidor compartilham. Ficam num arquivo só para não
// haver duas definições da mesma conversa — o tipo é o contrato entre a carga
// do servidor (`_dados/`) e o que a tela desenha.
export type { Conversa, Lista } from "../_dados/lista";
export type { Mensagem, Thread } from "../_dados/thread";

/** Os recortes da sidebar. Um estado só: dois controles para a mesma escolha
 *  acabam se contradizendo (CLAUDE.md §32 e §68.2). */
export type Fila = "todas" | "nao_lidas" | "favoritas" | "fila" | "resolvidas" | "carteira";

export const FILAS: { id: Fila; rotulo: string; curto: string }[] = [
  { id: "todas", rotulo: "Todas", curto: "Todas" },
  { id: "nao_lidas", rotulo: "Não lidas", curto: "Não lidas" },
  { id: "favoritas", rotulo: "Favoritas", curto: "Favoritas" },
  { id: "fila", rotulo: "Fila de espera", curto: "Fila" },
  { id: "resolvidas", rotulo: "Resolvidas", curto: "Resolvidas" },
  // A AGENDA, não uma fila de conversas (§38): todo cliente do RCA, com ou sem
  // conversa. Fica por último porque é outra pergunta — "com quem eu ainda não
  // falei?" — e não tem contador de atendimento.
  { id: "carteira", rotulo: "Minha carteira", curto: "Carteira" },
];

/** Um cliente da agenda (`/api/chat/carteira`). A chave é o `codcli`, não o
 *  `cliente_id`: quem nunca conversou não tem contato ainda (§38.1). */
export type ItemCarteira = {
  codcli: number;
  cliente_id: string | null;
  cliente: string | null;
  telefone: string | null;
  cidade: string | null;
  vendedor: string | null;
  /** sem contato, mas o telefone do cadastro serve: o clique cria e abre */
  criar_no_clique?: boolean;
  /** sem contato e sem telefone utilizável: alguém precisa digitar o número */
  precisa_telefone?: boolean;
  impedimento?: string | null;
};
