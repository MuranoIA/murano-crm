/**
 * Troca "[template] nome_tecnico" pelo TEXTO que a cliente leu.
 *
 * Disparos anteriores gravaram o identificador no conteúdo — o vendedor via o
 * nome técnico e não o que foi enviado. Os novos já gravam o texto
 * (send-template), mas o histórico não se reescreve sozinho: aqui a troca é só
 * de EXIBIÇÃO, buscando o corpo no cadastro pelo identificador.
 *
 * Mora em `lib/` porque agora tem dois donos — a thread do chat e o PDF da
 * conversa. Se cada um traduzisse por conta própria, o documento baixado
 * mostraria `[template] recontato_de_clientes` enquanto a tela ao lado mostra a
 * frase, e ninguém associaria a diferença a esta função.
 */
export async function textoDoTemplate(sb: any, mensagens: any[], nomeCompleto?: string | null) {
  const pendentes = mensagens
    .map((m: any) => /^\[template\]\s+(\S+)/.exec(String(m.conteudo ?? ""))?.[1])
    .filter(Boolean) as string[];
  if (!pendentes.length) return;
  const { data: tpls } = await sb
    .from("crm_templates")
    .select("meta_nome,corpo")
    .in("meta_nome", [...new Set(pendentes)]);
  const corpoDe = new Map((tpls ?? []).map((t: any) => [t.meta_nome, t.corpo]));
  const primeiroNome = String(nomeCompleto ?? "").trim().split(/\s+/)[0] || "cliente";
  for (const m of mensagens) {
    const nome = /^\[template\]\s+(\S+)/.exec(String(m.conteudo ?? ""))?.[1];
    const corpo = nome ? corpoDe.get(nome) : null;
    if (corpo) m.conteudo = String(corpo).replace(/\{\{\s*1\s*\}\}/g, primeiroNome);
  }
}
