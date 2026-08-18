// Dados cadastrais usados pela Política de Privacidade (/privacidade) e pelos
// Termos de Uso (/termos). Ficam num arquivo só porque os dois documentos
// citam os mesmos dados — e porque endereço, CNPJ e e-mail de contato mudam
// com o tempo, e não se deve caçá-los espalhados em duas páginas de texto.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ ATENÇÃO — os campos marcados PENDENTE aparecem NA TELA como estão aqui.  │
// │ Foram deixados assim de propósito: um CNPJ ou endereço inventado num     │
// │ documento jurídico é pior do que um campo visivelmente em branco. Trocar │
// │ pelos dados reais ANTES de publicar as URLs no painel da Meta.           │
// └──────────────────────────────────────────────────────────────────────────┘

const PENDENTE = (campo: string) => `[PREENCHER: ${campo}]`;

export const EMPRESA = {
  nomeFantasia: "Murano Professional",
  razaoSocial: PENDENTE("razão social completa"),
  cnpj: PENDENTE("CNPJ"),
  endereco: PENDENTE("endereço completo, com CEP"),

  /** Canal onde o titular exerce os direitos da LGPD. Precisa ser monitorado. */
  emailContato: PENDENTE("e-mail de contato para privacidade"),
  /** Encarregado (DPO), art. 41 da LGPD. Pode ser a mesma pessoa do contato. */
  encarregado: PENDENTE("nome do encarregado pelo tratamento de dados"),

  site: "https://crm.muranoprofessional.com.br",
} as const;

/**
 * Prazo de guarda das conversas e das mídias após o último contato.
 *
 * DECISÃO DE NEGÓCIO, não técnica: cinco anos é o que se costuma adotar por
 * acompanhar a prescrição do art. 206 §5º I do Código Civil (cobrança de
 * dívida líquida) e o prazo de guarda de documentos fiscais. Encurtar é
 * legítimo e reduz exposição; alongar exige justificativa. Confirmar com
 * quem responde pelo jurídico antes de publicar.
 */
export const RETENCAO_ANOS = 5;

/**
 * Data da última revisão dos documentos. Atualizar À MÃO quando o texto mudar
 * de fato — data automática (`new Date()`) faria o documento anunciar uma
 * revisão que nunca houve, a cada carregamento da página.
 */
export const ATUALIZADO_EM = "16 de agosto de 2026";
