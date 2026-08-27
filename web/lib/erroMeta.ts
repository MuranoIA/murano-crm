// Tradução dos erros de entrega da WhatsApp Cloud API para o que o vendedor
// precisa saber: o que aconteceu e o que fazer agora.
//
// O que a Meta manda, e o que aparecia na tela até aqui:
//
//   "Meta 131047 — Re-engagement message — Re-engagement message — Message
//    failed to send because more than 24 hours have passed since the customer
//    last replied to this number."
//
// Três defeitos num recado só: está em inglês, repete o título duas vezes
// (`title` e `message` vêm iguais nesse erro) e termina sem dizer o que fazer —
// justamente o que a pessoa parada na tela precisa.
//
// ⚠️ O texto cru NÃO é jogado fora. A §22.6.1 custou horas exatamente por ter
// perdido a explicação da Meta, e boa parte destes códigos não existe na
// documentação pública: o texto dela é a única pista quando o caso é novo. Ele
// vira `tecnico` e continua na tela, no `title` — some da leitura, não do
// diagnóstico.

type Traducao = { texto: string; acao?: string };

/**
 * Códigos observados em produção. Os que não estão aqui caem no texto da Meta,
 * limpo de repetição — pior que uma tradução, melhor que uma linha em branco.
 */
const TABELA: Record<string, Traducao> = {
  // --- janela de conversa ---
  "131047": {
    texto: "A janela de 24h fechou — o WhatsApp não entrega mensagem livre depois disso.",
    acao: "Envie um template para reabrir a conversa.",
  },
  "131051": { texto: "Tipo de mensagem não suportado pelo WhatsApp." },

  // --- número do destinatário ---
  "131026": {
    texto: "Este número não recebe no WhatsApp.",
    acao: "Confira o número com a cliente — pode estar errado, sem conta ou desativado.",
  },
  "131031": { texto: "A conta do WhatsApp da empresa está bloqueada.", acao: "Falar com o administrador." },

  // --- cobrança ---
  "131042": {
    texto: "A conta não está apta a cobrar por esta mensagem.",
    acao: "Falta vincular uma forma de pagamento à conta do WhatsApp — é com o financeiro.",
  },
  "131044": {
    texto: "A conta não está apta a cobrar por esta chamada.",
    acao: "Falta vincular uma forma de pagamento à conta do WhatsApp — é com o financeiro.",
  },

  // --- template ---
  "132001": {
    texto: "Este template não existe nesta conta do WhatsApp (ou não neste idioma).",
    acao: "Recadastre em Administração → Templates. Trocar de número troca de conta, e os templates não vão junto.",
  },
  "132000": {
    texto: "O número de campos preenchidos não bate com o template aprovado.",
    acao: "Confira os campos em Administração → Templates.",
  },
  "132005": { texto: "O texto enviado não corresponde ao template aprovado." },
  "132007": { texto: "O template foi recusado por violar a política da Meta." },
  "132012": { texto: "Um dos campos do template tem formato inválido." },
  "132015": { texto: "Este template está pausado por baixa qualidade.", acao: "Use outro template." },
  "132016": { texto: "Este template foi desativado por qualidade.", acao: "Crie um novo em Administração → Templates." },

  // --- limites ---
  "130429": { texto: "Muitas mensagens em pouco tempo.", acao: "Aguarde um instante e tente de novo." },
  "131048": { texto: "Limite de qualidade atingido: a Meta está segurando os envios desta conta." },
  "131056": { texto: "Muitas tentativas para este mesmo número em pouco tempo.", acao: "Aguarde antes de tentar de novo." },
  "80007": { texto: "Limite de envios da conta atingido." },

  // --- configuração / credenciais (não é erro do vendedor) ---
  "190": { texto: "A credencial do WhatsApp expirou.", acao: "Avisar o administrador — nenhum envio funciona até renovar." },
  "100": { texto: "A Meta recusou os dados do envio.", acao: "Avisar o administrador." },
  "133010": { texto: "O número da empresa não está registrado na Meta.", acao: "Avisar o administrador." },

  // --- chamada de voz ---
  "138000": { texto: "Chamadas de voz não estão ligadas nesta linha.", acao: "Ligar em Administração → Linhas." },
  "138006": { texto: "A cliente ainda não autorizou receber ligação.", acao: "Use “Pedir autorização” na conversa." },
  "138018": { texto: "A linha não está pronta para chamadas.", acao: "Avisar o administrador." },
};

/**
 * Códigos que significam **"este número não recebe"** — e só eles.
 *
 * A distinção decide se o disparo em massa acerta ou se sabota a si mesmo.
 * Medido no banco em 27/08, entre TODAS as falhas que existem:
 *
 *   131047 · 6 clientes · janela de 24h fechada
 *            -> é EXATAMENTE quem o template existe para alcançar. Excluir
 *               seria o oposto do objetivo.
 *   131042 · 2 clientes · problema de pagamento NOSSO
 *            -> punir o cliente por erro da nossa conta.
 *   131026 · 2 clientes · o número não recebe no WhatsApp
 *            -> permanente. É este.
 *
 * Por isso a lista é curta e cresce só com evidência: um código entra aqui
 * quando se sabe que reenviar não muda o resultado.
 */
export const FALHA_DO_NUMERO = new Set(["131026", "131051"]);

/** O código da Meta que a string guardada carrega, se carregar. */
export function codigoMeta(erro: string | null | undefined): string | null {
  const m = /\bMeta\s+(\d{2,6})\b/.exec(String(erro ?? ""));
  return m ? m[1] : null;
}

/**
 * Quebra a string guardada em partes e remove as repetidas. A Meta manda
 * `title` e `message` iguais em vários erros, e a concatenação do webhook não
 * tinha como saber disso — o resultado era a mesma frase duas vezes.
 */
function limparCru(erro: string): string {
  const partes = erro.split(" — ").map((p) => p.trim()).filter(Boolean);
  const vistas = new Set<string>();
  return partes
    .filter((p) => {
      const k = p.toLowerCase();
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    })
    .join(" — ");
}

/**
 * O recado para a tela.
 *
 * `texto`   — o que aconteceu, em português.
 * `acao`    — o que fazer agora (pode não existir).
 * `tecnico` — o que a Meta disse, sem repetição, para o `title` e para
 *             diagnóstico de caso novo. Nunca some.
 */
export function traduzErroMeta(erro: string | null | undefined): {
  texto: string; acao: string | null; tecnico: string; conhecido: boolean;
} {
  const cru = limparCru(String(erro ?? "").trim());
  if (!cru) {
    return { texto: "A Meta não explicou o motivo.", acao: null, tecnico: "", conhecido: false };
  }
  const cod = codigoMeta(cru);
  const t = cod ? TABELA[cod] : undefined;
  if (!t) return { texto: cru, acao: null, tecnico: cru, conhecido: false };
  return { texto: t.texto, acao: t.acao ?? null, tecnico: cru, conhecido: true };
}
