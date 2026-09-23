// ---------------------------------------------------------------------------
// OS EMOJI DA CAIXA DE MENSAGEM (22/09/2026)
//
// Os mais usados numa conversa de venda por WhatsApp, não a lista inteira do
// teclado: grade fixa, sem categoria nem busca. Cobre o gesto real ("mandar um
// 😊 ou um 👍") sem o custo de uma biblioteca de picker só para isso — mesma
// decisão que o chat de hoje tomou em 09/09.
//
// Mora em `lib/` porque o chat-v2 não importa nada de `app/chat/` (regra da
// spec). O chat de hoje segue com a cópia dele, dentro do arquivo de 6.800
// linhas: mexer lá para poupar 12 linhas de constante encostaria numa tela que
// duas outras frentes estão editando agora, e que vai ser apagada na fase 7.
//
// São 40, e isso não é por acaso: em 10 colunas cabem em 4 linhas, sem rolagem.
// ---------------------------------------------------------------------------
export const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "🙂", "😉", "😍", "😘", "🥰",
  "😎", "🤔", "😅", "😢", "😭", "😡", "😴", "🙏", "👍", "👎",
  "👏", "🙌", "💪", "🤝", "👋", "✅", "❌", "⚠️", "🔥", "🎉",
  "🎂", "🥳", "❤️", "💜", "😇", "🤷", "😬", "😮", "🫶", "📦",
] as const;
