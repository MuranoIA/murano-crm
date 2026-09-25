// Variáveis de um template do WhatsApp — os `{{1}}`, `{{2}}`… do corpo aprovado
// na Meta, que o consultor preenche na hora de enviar (compositor do botão
// TEMPLATE, no chat).
//
// Este módulo é PURO de propósito: as mesmas funções rodam no servidor
// (send-template, cadastro do admin) e no navegador. Se a régua morasse só no
// servidor, a tela deixaria digitar algo que a Meta recusa e o erro só
// apareceria depois do clique; se morasse só na tela, a rota confiaria no que o
// navegador mandou. Sem estado, sem env, sem import de nada — é o que permite
// importar dos dois lados.

/** Limite do corpo de um template na Meta, já com as variáveis substituídas. */
export const LIMITE_CORPO = 1024;

/**
 * Números das variáveis presentes no corpo, em ordem e sem repetição.
 * `"Oi {{1}}, {{2}}"` → `[1, 2]`.
 */
export function variaveisDe(corpo?: string | null): number[] {
  const achados = String(corpo ?? "").match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  const nums = achados.map((m) => Number(m.replace(/\D/g, "")));
  return [...new Set(nums)].filter((n) => n > 0).sort((a, b) => a - b);
}

/**
 * A Meta recusa parâmetro com quebra de linha, tabulação ou mais de quatro
 * espaços seguidos. Em vez de barrar o consultor por isso — que é o tipo de
 * coisa que acontece ao colar texto e que ninguém deveria precisar saber — o
 * valor é higienizado antes de sair.
 */
export function limparVariavel(v: unknown): string {
  return String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * Corpo com cada `{{n}}` trocado pelo valor digitado — é o texto que a cliente
 * vai ler, e o que fica gravado em `mensagens`. Campo ainda vazio continua
 * aparecendo como `{{n}}`: na pré-visualização isso mostra o que falta, em vez
 * de abrir um buraco no meio da frase.
 */
export function aplicarVariaveis(corpo: string, valores: string[]): string {
  return String(corpo).replace(/\{\{\s*(\d+)\s*\}\}/g, (bruto, n) => {
    const v = valores[Number(n) - 1];
    return v ? v : bruto;
  });
}

/**
 * A Meta exige numeração seguida a partir de `{{1}}` — um corpo com `{{1}}` e
 * `{{3}}` é recusado na criação. Cobrado no cadastro, onde dá para corrigir.
 */
export function erroDeNumeracao(corpo: string): string | null {
  const vars = variaveisDe(corpo);
  const esperado = vars.map((_, i) => i + 1);
  if (vars.join(",") === esperado.join(",")) return null;
  return "numere os campos em sequência a partir de {{1}} — a Meta recusa {{1}} seguido de {{3}}";
}

/**
 * Mensagem de erro legível, ou `null` se dá para enviar. Mesma régua na tela
 * (que desabilita o botão) e na rota (que não confia na tela).
 *
 * `corpo` nulo é o template do RD Conversas: o texto mora no painel deles, então
 * aqui só dá para conferir que os campos foram preenchidos.
 */
export function conferirVariaveis(corpo: string | null | undefined, valores: string[]): string | null {
  const limpos = valores.map(limparVariavel);
  if (limpos.some((v) => !v)) return "nenhum campo do template pode ficar vazio";

  if (!corpo) return null;

  const vars = variaveisDe(corpo);
  if (limpos.length !== vars.length) {
    return `este template tem ${vars.length} campo${vars.length === 1 ? "" : "s"} para preencher`;
  }
  const texto = aplicarVariaveis(corpo, limpos);
  if (texto.length > LIMITE_CORPO) {
    return `o texto final ficou com ${texto.length} caracteres — o limite da Meta é ${LIMITE_CORPO}`;
  }
  return null;
}

// --- botões do template (0122) ----------------------------------------------
// O pedido comparou com o RD Conversas, que deixa anexar um botão (CTA — link
// ou telefone — ou Resposta rápida) ao criar o template. Aqui o cadastro cria
// o template DE VERDADE na Meta (§24), então o botão tem de ir no componente
// `BUTTONS` da criação — mesmo formato na TELA (admin), na ROTA
// (templates-whatsapp) e no BANCO (`crm_templates.botoes`), para não converter
// ida e volta. `QUICK_REPLY` volta como mensagem de texto comum no webhook (o
// `type: "button"` que `/api/whatsapp/webhook` já trata, §16.3) — nenhuma
// mudança lá foi necessária. `URL` e `PHONE_NUMBER` só abrem link/discador no
// aparelho da cliente; não geram resposta nenhuma.
export type BotaoTemplate = {
  tipo: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  texto: string;              // rótulo do botão, até 25 caracteres
  valor?: string | null;      // URL (tipo URL) ou telefone em E.164 (tipo PHONE_NUMBER)
  // Só para URL DINÂMICA (link terminando em `{{1}}`): o valor de exemplo da
  // parte variável que o revisor da Meta vê. A Meta exige na criação e recusa
  // sem ele — ver `urlDinamica`.
  exemplo?: string | null;
};

/**
 * O link termina na parte variável `{{1}}`? É o botão de URL DINÂMICA da Meta:
 * o começo do link é fixo e aprovado, o fim é preenchido a cada envio (ex.: o
 * token do rastreio da entrega). A Meta aceita UMA variável por botão, SEMPRE
 * no fim do link, e sempre `{{1}}` — o número é por botão, não do corpo.
 */
export function urlDinamica(valor?: string | null): boolean {
  return /\{\{\s*1\s*\}\}$/.test(String(valor ?? "").trim());
}

/**
 * Erro legível do botão de link, ou `null`. Separado de `validarBotoes` porque
 * a regra do link dinâmico tem três armadilhas próprias, e cada uma vira uma
 * recusa da Meta minutos depois, sem dizer qual foi:
 *   - variável em qualquer lugar que não o FIM do link;
 *   - número diferente de 1, ou mais de uma variável;
 *   - exemplo ausente, com espaço, ou que já traz o link inteiro.
 */
export function erroDoLink(b: BotaoTemplate): string | null {
  const t = String(b.texto ?? "").trim();
  const v = String(b.valor ?? "").trim();
  if (!/^https?:\/\/.+/i.test(v)) return `o link do botão "${t}" precisa começar com http:// ou https://`;
  const vars = v.match(/\{\{[^}]*\}\}/g) ?? [];
  if (!vars.length) return null;
  if (vars.length > 1 || !urlDinamica(v)) {
    return `o link do botão "${t}" só pode ter uma parte variável, {{1}}, no final do endereço`;
  }
  if (/^https?:\/\/\{\{/i.test(v)) {
    return `o link do botão "${t}" precisa de um endereço fixo antes da parte variável`;
  }
  const ex = String(b.exemplo ?? "").trim();
  if (!ex) return `informe um exemplo da parte variável do botão "${t}" — a Meta exige para aprovar`;
  if (/\s/.test(ex)) return `o exemplo do botão "${t}" não pode ter espaço`;
  if (/^https?:\/\//i.test(ex)) {
    return `o exemplo do botão "${t}" é só a parte que entra no lugar de {{1}}, não o link inteiro`;
  }
  return null;
}

// Limites que a TELA respeita, mais estreitos que o teto real da Meta (ela
// aceita até 10 botões, 2 URL, 1 telefone). Igual à experiência do RD Conversas
// que originou o pedido — "um botão de cada tipo, dois no total" — só que com 3
// em vez de 2, porque "duas respostas rápidas" é um caso comum e negar isso na
// nossa tela sem motivo da Meta seria mais restritivo do que precisa.
export const MAX_BOTOES = 3;
export const MAX_URL = 1;
export const MAX_TELEFONE = 1;
export const MAX_TEXTO_BOTAO = 25;

/**
 * Valida a lista de botões e devolve na ORDEM que a Meta exige: os de
 * call-to-action (URL/telefone) antes dos de resposta rápida — misturar as duas
 * famílias fora dessa ordem é recusado na criação, silenciosamente reordenado
 * pela Meta em algumas contas e não em outras; melhor não depender disso.
 */
export function validarBotoes(botoes: BotaoTemplate[]): { erro: string | null; ordenados: BotaoTemplate[] } {
  if (botoes.length > MAX_BOTOES) {
    return { erro: `no máximo ${MAX_BOTOES} botões por template`, ordenados: botoes };
  }
  const qtdUrl = botoes.filter((b) => b.tipo === "URL").length;
  const qtdTel = botoes.filter((b) => b.tipo === "PHONE_NUMBER").length;
  if (qtdUrl > MAX_URL) return { erro: "só um botão de link por template", ordenados: botoes };
  if (qtdTel > MAX_TELEFONE) return { erro: "só um botão de telefone por template", ordenados: botoes };

  for (const b of botoes) {
    const t = String(b.texto ?? "").trim();
    if (!t) return { erro: "todo botão precisa de um texto", ordenados: botoes };
    if (t.length > MAX_TEXTO_BOTAO) return { erro: `o texto do botão "${t}" passa de ${MAX_TEXTO_BOTAO} caracteres`, ordenados: botoes };
    if (b.tipo === "URL") {
      const erroLink = erroDoLink(b);
      if (erroLink) return { erro: erroLink, ordenados: botoes };
    }
    if (b.tipo === "PHONE_NUMBER") {
      const v = String(b.valor ?? "").trim();
      if (!/^\+?[0-9]{8,15}$/.test(v)) return { erro: `o telefone do botão "${t}" não parece válido — use o formato +55DDNÚMERO`, ordenados: botoes };
    }
  }

  const cta = botoes.filter((b) => b.tipo === "URL" || b.tipo === "PHONE_NUMBER");
  const respostas = botoes.filter((b) => b.tipo === "QUICK_REPLY");
  return { erro: null, ordenados: [...cta, ...respostas] };
}
