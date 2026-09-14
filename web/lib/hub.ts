/**
 * A origem do hub — o único remetente de `postMessage` em que esta tela confia.
 *
 * O CRM roda dentro de um `<iframe>` do hub (§17), e desde 14/09/2026 é o hub
 * quem recebe o push de mensagem nova: em iframe cross-origin o navegador
 * recusa a permissão de notificação **antes de perguntar** (medido), então a
 * inscrição só pode nascer no documento de topo. O caminho de volta — "abra
 * esta conversa" — é `postMessage`, e `message` é um canal aberto: qualquer
 * página que embuta esta aqui consegue postar.
 *
 * Por isso a origem é constante, e não algo lido do próprio evento. Um
 * `event.origin.endsWith("muranoprofessional.com.br")` pareceria equivalente e
 * não é: `muranoprofessional.com.br.evil.com` passa nesse teste.
 *
 * A env existe para o teste local, onde o "hub" é outra porta do 127.0.0.1 —
 * porta diferente já é outra origem, que é exatamente a relação que hub e CRM
 * têm em produção.
 */
export const ORIGEM_HUB = (
  process.env.NEXT_PUBLIC_HUB_ORIGIN ?? "https://app.muranoprofessional.com.br"
).trim();
