// Saúde do canal de WhatsApp — o alerta que não existia.
//
// O modo de falha real, já vivido (§28.3): o app deixou de estar inscrito na
// WABA e o sistema ficou **mudo por horas**. Nada quebrou na tela, nada apareceu
// no log, ninguém foi avisado. Mensagem enviada ficava em `wait` para sempre e
// nenhuma chegava.
//
// ---------------------------------------------------------------------------
// O SINAL: recibo que não volta
//
// Quem promove `wait → success → read` é o webhook. Então, se há mensagens
// nossas paradas em `wait` há mais de alguns minutos, **o webhook não está
// entregando** — e essa é a mesma porta por onde entram as mensagens das
// clientes. Um sintoma, duas doenças descartadas de uma vez.
//
// É melhor sinal que "faz X horas que ninguém escreve": isso acontece todo
// domingo, e um alarme que dispara todo domingo deixa de ser lido.
//
// ---------------------------------------------------------------------------
// O QUE ESTE ARQUIVO NÃO FAZ
//
// Não fala com a Graph API. É de propósito: isto roda junto do carregamento do
// board, e uma chamada externa ali colocaria a tela na dependência da latência
// da Meta. O diagnóstico profundo (`subscribed_apps`, `health_status`) mora na
// rota de admin, sob demanda — lá o custo é de quem pediu.

export type Saude = {
  estado: "ok" | "sem_sinal" | "suspeito" | "mudo";
  presas: number;             // enviadas paradas em `wait` há mais de MINUTOS_PRESA
  minutos_sem_recibo: number | null;
  titulo: string;
  detalhe: string;
};

/** Uma mensagem leva segundos para ser confirmada. 15 min é folga larga. */
const MINUTOS_PRESA = 15;
/** Uma ou duas presas é número errado ou bloqueio; a partir daí é o canal. */
const PRESAS_GRAVE = 3;

type Sb = { from: (t: string) => any };

export async function diagnosticar(sb: Sb, linhaId: string | null): Promise<Saude> {
  // Sem linha própria configurada não há o que vigiar aqui.
  if (!linhaId) {
    return { estado: "ok", presas: 0, minutos_sem_recibo: null, titulo: "", detalhe: "" };
  }

  const agora = Date.now();
  const desde24h = new Date(agora - 24 * 3600_000).toISOString();
  const corte = new Date(agora - MINUTOS_PRESA * 60_000).toISOString();

  const [presasR, reciboR] = await Promise.all([
    sb.from("mensagens").select("id", { count: "exact", head: true })
      .eq("linha_id", linhaId).eq("enviada_por", "operator").eq("status", "wait")
      .gte("criada_em", desde24h).lt("criada_em", corte),
    // O recibo é o que o webhook escreve. `failed` conta: é recibo também —
    // significa que a Meta respondeu, ou seja, o caminho de volta está vivo.
    sb.from("mensagens").select("criada_em")
      .eq("linha_id", linhaId).in("status", ["success", "read", "failed"])
      .order("criada_em", { ascending: false }).limit(1),
  ]);

  const presas: number = presasR?.count ?? 0;
  const ultimo = reciboR?.data?.[0]?.criada_em ? new Date(reciboR.data[0].criada_em).getTime() : null;
  const minutos = ultimo ? Math.floor((agora - ultimo) / 60_000) : null;

  if (presas >= PRESAS_GRAVE) {
    return {
      estado: "mudo",
      presas, minutos_sem_recibo: minutos,
      titulo: `${presas} mensagens enviadas sem confirmação`,
      detalhe:
        "Quem confirma a entrega é o mesmo canal por onde as mensagens das clientes chegam. " +
        "Com esse número de mensagens paradas, é provável que o sistema esteja sem receber nada — " +
        "e sem receber, ninguém percebe.",
    };
  }
  if (presas > 0) {
    return {
      estado: "suspeito",
      presas, minutos_sem_recibo: minutos,
      titulo: `${presas} mensagem${presas > 1 ? "ns" : ""} sem confirmação`,
      detalhe:
        "Pode ser só um número que não recebe no WhatsApp. Se o número subir nos próximos minutos, " +
        "é o canal.",
    };
  }
  // Nada preso, mas também nada confirmado há muito tempo: não dá para dizer
  // que está bom. Dizer "ok" aqui seria afirmar o que não se sabe.
  if (minutos !== null && minutos > 12 * 60) {
    return {
      estado: "sem_sinal",
      presas: 0, minutos_sem_recibo: minutos,
      titulo: `Sem tráfego há ${Math.floor(minutos / 60)} h`,
      detalhe: "Nenhuma mensagem confirmada nesse período. Pode ser só um dia parado.",
    };
  }
  return { estado: "ok", presas: 0, minutos_sem_recibo: minutos, titulo: "", detalhe: "" };
}
