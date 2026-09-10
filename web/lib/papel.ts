// Papel efetivo a partir do cookie `crm_sessao`. Quatro tokens:
//   "admin"     -> vê TODAS as carteiras + tem B.I. Conversas / Ranking / Sincronizar / Disparo em massa
//   "home"      -> vê TODAS as carteiras, mas SEM aquelas 4 features (nível intermediário)
//   "pos-venda" -> igual a "home" no que enxerga; papel próprio para o time de pós-venda
//   <slug>      -> vendedor: vê só a própria carteira, também SEM as 4 features
// A tabela `acesso` guarda os papéis QUE o e-mail pode assumir (papeis[]); a troca de papel
// (multi-papel: Romulo=admin|vendedor, Joas=admin|home) reescreve o cookie via /api/trocar-papel.
//
// ⚠️ "vê todas as carteiras" NÃO é o mesmo que "não tem atendimentos próprios".
// Desde as demandas da Lais, admin, home e pos-venda também ATENDEM: têm conversas
// atribuídas a si, transferem para si e para outros, e a marca de leitura deles vale
// como a de qualquer um. O que eles não têm é RCA e carteira comercial — o endereço de
// atendimento dessas pessoas é o e-mail. Quem resolve isso é
// `lib/chatEscopo.enderecoDeAtendimento`, e não este arquivo: aqui mora o ESCOPO DE
// VISÃO (o que se enxerga), lá mora a IDENTIDADE DE ATENDIMENTO (de quem é a conversa).
// Misturar os dois era a saída tentadora e daria uma carteira de mentira à Lais, que
// contaminaria board, disparo em massa, relatórios e fila de prospecção — `carteira_config`
// é a tabela de vendedor COM RCA e alimenta umas trinta rotas comerciais.
export type Papel = "admin" | "home" | "pos-venda" | "vendedor";

/** Os papéis que existem, na ordem em que fazem sentido numa lista. */
export const PAPEIS: readonly Papel[] = ["admin", "home", "pos-venda", "vendedor"] as const;

export const ehPapel = (v: unknown): v is Papel => (PAPEIS as readonly string[]).includes(v as string);

/** Rótulo para a tela. Um lugar só: o board e o /admin tinham cada um o seu ternário. */
export const rotuloDePapel = (p: string | null | undefined): string =>
  p === "admin" ? "Admin" : p === "home" ? "Home" : p === "pos-venda" ? "Pós-venda" : "Vendedor";

// Os papéis sem carteira comercial — enxergam todas. `pos-venda` entra junto de home:
// decidido com o usuário em 09/09/2026 (vê tudo, sem as 4 features de admin). É papel
// próprio, e não apelido de "home", para poder ganhar regra própria depois sem remexer
// em quem já usa.
export const PAPEIS_QUE_VEEM_TUDO: readonly string[] = ["admin", "home", "pos-venda"];

export function papelDe(sessao: string | null | undefined): Papel | null {
  if (!sessao) return null;
  if (PAPEIS_QUE_VEEM_TUDO.includes(sessao)) return sessao as Papel;
  return "vendedor";
}

// admin, home e pos-venda enxergam todas as carteiras (sem escopo por vendedor).
export const veTudo = (sessao: string | null | undefined): boolean =>
  !!sessao && PAPEIS_QUE_VEEM_TUDO.includes(sessao);

// carteira efetiva do escopo: null = todas (admin/home/pos-venda); senão o slug do vendedor.
export const carteiraDe = (sessao: string | null | undefined): string | null =>
  veTudo(sessao) ? null : (sessao ?? null);

// só admin tem as 4 features restritas (sincronizar, disparo em massa, B.I., ranking).
export const podeAdmin = (sessao: string | null | undefined): boolean => sessao === "admin";

// token de cookie p/ um papel + carteira (usado no login e na troca de papel).
// ⚠️ Escrito pela NEGATIVA de propósito: com o ternário anterior
// ("admin" ? : "home" ? : carteira), um papel novo caía silenciosamente no ramo do
// vendedor e virava um cookie de carteira vazia — a pessoa logava e não enxergava nada,
// sem nenhum erro visível. Agora só `vendedor` usa a carteira, e todo papel novo funciona
// sem ninguém precisar lembrar deste arquivo.
export const tokenDePapel = (papel: Papel, carteira: string | null): string =>
  papel === "vendedor" ? (carteira ?? "") : papel;
