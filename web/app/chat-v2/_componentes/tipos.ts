// Tipos que a tela e o servidor compartilham. Ficam num arquivo só para não
// haver duas definições da mesma conversa — o tipo é o contrato entre a carga
// do servidor (`_dados/`) e o que a tela desenha.
export type { Conversa, Lista } from "../_dados/lista";
export type { Mensagem, Thread } from "../_dados/thread";

/** Os recortes da sidebar. Um estado só: dois controles para a mesma escolha
 *  acabam se contradizendo (CLAUDE.md §32 e §68.2). */
export type Fila = "todas" | "nao_lidas" | "recados" | "favoritas" | "fila" | "resolvidas" | "carteira";

export const FILAS: { id: Fila; rotulo: string; curto: string }[] = [
  // "Meus atendimentos", como no chat de hoje: são as conversas abertas que
  // estão COM A PESSOA (sem a fila de espera e sem as encerradas). "Todas"
  // sugeria a base inteira e confundiu no piloto (22/09) — o id segue "todas".
  { id: "todas", rotulo: "Meus atendimentos", curto: "Meus atendimentos" },
  { id: "nao_lidas", rotulo: "Não lidas", curto: "Não lidas" },
  // Recados da supervisão (0129): nota interna de OUTRA pessoa que eu ainda não
  // vi. Ao lado de "Não lidas" porque as duas respondem "tem alguma coisa
  // esperando por MIM?" — uma da cliente, a outra da supervisão.
  { id: "recados", rotulo: "Recados", curto: "Recados" },
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
  /** o telefone acima veio de uma troca pelo chat, ainda não feita no WinThor */
  telefone_trocado?: boolean;
  /** o começo da última mensagem (só de quem já conversou; `?previa=1`) */
  ultima_mensagem?: string | null;
  ultima_enviada_por?: string | null;
};
