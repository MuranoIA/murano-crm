// O hook de virtualização mudou de casa: agora mora em `lib/virtualizacao.tsx`,
// porque tem dois donos — esta tela e o /chat-v2 (prototipos/chat-v2/spec.md).
//
// Este arquivo só reexporta, para o chat antigo continuar importando "./virtual"
// sem nenhuma alteração. **Cópia seria pior**: duas versões divergem no primeiro
// ajuste, e foi exatamente essa dívida que a §41.2 do CLAUDE.md pagou ao apagar
// o `conversa.tsx`.
export { useVirtualizacao, JanelaVirtual } from "../../lib/virtualizacao";
export type { AlcanceVirtual } from "../../lib/virtualizacao";
