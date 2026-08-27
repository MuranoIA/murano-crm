// A lista de campos da ficha de cadastro (0109) — uma fonte, dois usos.
//
// Usos: o FORMULÁRIO que o consultor preenche no chat, e a MENSAGEM que ele
// manda para a cliente pedindo os dados. Se fossem dois textos independentes,
// divergiriam no primeiro ajuste: o consultor pediria oito coisas e o
// formulário teria dez — e alguém perguntaria de novo, que é exatamente o
// problema que a ficha existe para acabar.
//
// ⚠️ A lista real de campos do WinThor NÃO está no código de propósito. Mora em
// `crm_config.cadastro_campos`, editável em /admin, porque quem sabe o que o
// ERP exige é quem cadastra. O default da migration é um ponto de partida
// honesto, não uma verdade — ver o comentário da 0109.

export type CampoCadastro = {
  k: string;
  rotulo: string;
  ajuda?: string;
  obrigatorio?: boolean;
};

/** Usado quando a config ainda não chegou — nunca deixa a tela sem formulário. */
export const CAMPOS_PADRAO: CampoCadastro[] = [
  { k: "cpf_cnpj", rotulo: "CPF ou CNPJ", obrigatorio: true },
  { k: "nome", rotulo: "Nome completo / Razão social", obrigatorio: true },
  { k: "telefone", rotulo: "Telefone", obrigatorio: true },
];

/** Higieniza o que veio do banco: linha sem `k` ou sem rótulo não vira campo. */
export function lerCampos(bruto: unknown): CampoCadastro[] {
  if (!Array.isArray(bruto)) return CAMPOS_PADRAO;
  const campos = bruto
    .filter((c: any) => c && typeof c.k === "string" && c.k.trim() && typeof c.rotulo === "string" && c.rotulo.trim())
    .map((c: any) => ({
      k: String(c.k).trim(),
      rotulo: String(c.rotulo).trim(),
      ajuda: c.ajuda ? String(c.ajuda).trim() : undefined,
      obrigatorio: c.obrigatorio === true,
    }));
  return campos.length ? campos : CAMPOS_PADRAO;
}

/**
 * A mensagem que pede os dados à cliente.
 *
 * Numerada porque é assim que a pessoa responde do outro lado — uma lista sem
 * número vira um parágrafo, e o consultor recebe as informações fora de ordem
 * e sem saber o que faltou. O rótulo vai como está no cadastro, com a ajuda
 * entre parênteses; nada é inventado aqui.
 */
export function textoPedidoDeDados(campos: CampoCadastro[], primeiroNome?: string): string {
  const ola = primeiroNome ? `Oi, ${primeiroNome}! ` : "Oi! ";
  const linhas = campos.map((c, i) => `${i + 1}. ${c.rotulo}${c.ajuda ? ` (${c.ajuda})` : ""}`);
  return (
    `${ola}Para eu abrir seu cadastro e já liberar seus pedidos, me manda esses dados, por favor:\n\n` +
    linhas.join("\n") +
    `\n\nPode mandar tudo numa mensagem só. 💜`
  );
}

/** O que falta para a ficha poder ser salva. Vazio = pode salvar. */
export function faltando(campos: CampoCadastro[], dados: Record<string, string>): string[] {
  return campos
    .filter((c) => c.obrigatorio && !String(dados[c.k] ?? "").trim())
    .map((c) => c.rotulo);
}

/**
 * A ficha em texto, para o botão "copiar". É o formato que quem digita no
 * WinThor vai ler ao lado da tela do ERP — campo por linha, na ordem do
 * cadastro, sem os vazios (linha em branco só atrapalha quem confere).
 */
export function fichaEmTexto(campos: CampoCadastro[], dados: Record<string, string>): string {
  return campos
    .map((c) => [c.rotulo, String(dados[c.k] ?? "").trim()] as const)
    .filter(([, v]) => v)
    .map(([r, v]) => `${r}: ${v}`)
    .join("\n");
}
