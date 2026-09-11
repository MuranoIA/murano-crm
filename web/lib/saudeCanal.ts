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
// nossas paradas em `wait` há mais de alguns minutos, **o webhook pode não estar
// entregando** — e essa é a mesma porta por onde entram as mensagens das
// clientes. Um sintoma, duas doenças descartadas de uma vez.
//
// É melhor sinal que "faz X horas que ninguém escreve": isso acontece todo
// domingo, e um alarme que dispara todo domingo deixa de ser lido.
//
// ---------------------------------------------------------------------------
// ⚠️ MENSAGEM PRESA NÃO É, SOZINHA, CANAL MUDO
//
// A primeira versão escalava para "mudo" contando só as presas. Em 31/08/2026
// isso deu falso alarme vermelho: 5 presas do ensaio (`testes/casos/
// ciclo10-equipe-simultanea.mjs`, Ato 4, que manda de verdade para os números
// autorizados) enquanto o canal entregava normalmente — 21 recibos nas 12 h
// anteriores, o último 13 min antes do alarme.
//
// A pergunta que separa uma coisa da outra é **"chegou algum recibo DEPOIS da
// presa mais nova?"**. Se chegou, o caminho de volta estava vivo depois de
// termos mandado aquelas — logo o problema é DAQUELAS MENSAGENS (número que
// não recebe, arquivo recusado, bloqueio), não do canal.
//
// É melhor que uma lista de números de teste: não precisa de config, não põe
// telefone em repositório público (§15.5), e vale igual para causa real —
// cinco clientes que nos bloquearam também não são canal mudo.
//
// O alarme de verdade continua disparando: canal morto não produz recibo
// nenhum depois das presas, e aí cai em "mudo" como antes.
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
  /** Houve recibo depois da presa mais nova? É o que descarta "canal mudo". */
  canal_confirmado: boolean;
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
    return { estado: "ok", presas: 0, minutos_sem_recibo: null, canal_confirmado: true, titulo: "", detalhe: "" };
  }

  const agora = Date.now();
  const desde24h = new Date(agora - 24 * 3600_000).toISOString();
  const corte = new Date(agora - MINUTOS_PRESA * 60_000).toISOString();

  const [presasR, reciboR] = await Promise.all([
    // Conta E traz a mais nova na mesma ida: é a data dela que datamos o recibo
    // contra. Duas consultas separadas dariam duas fotos de instantes
    // diferentes, e a comparação entre elas seria de mentira.
    sb.from("mensagens").select("criada_em", { count: "exact" })
      .eq("linha_id", linhaId).eq("enviada_por", "operator").eq("status", "wait")
      .gte("criada_em", desde24h).lt("criada_em", corte)
      .order("criada_em", { ascending: false }).limit(1),
    // O recibo é o que o webhook escreve. `failed` conta: é recibo também —
    // significa que a Meta respondeu, ou seja, o caminho de volta está vivo.
    sb.from("mensagens").select("criada_em")
      .eq("linha_id", linhaId).in("status", ["success", "read", "failed"])
      .order("criada_em", { ascending: false }).limit(1),
  ]);

  const presas: number = presasR?.count ?? 0;
  const maisNovaPresa = presasR?.data?.[0]?.criada_em
    ? new Date(presasR.data[0].criada_em).getTime() : null;
  const ultimo = reciboR?.data?.[0]?.criada_em ? new Date(reciboR.data[0].criada_em).getTime() : null;
  const minutos = ultimo ? Math.floor((agora - ultimo) / 60_000) : null;

  // A prova de vida: recibo posterior à presa mais nova. Sem presa nenhuma a
  // pergunta não se aplica, e um recibo qualquer já basta.
  const canalConfirmado =
    ultimo !== null && (maisNovaPresa === null || ultimo > maisNovaPresa);

  if (presas >= PRESAS_GRAVE && !canalConfirmado) {
    return {
      estado: "mudo",
      presas, minutos_sem_recibo: minutos, canal_confirmado: false,
      titulo: `${presas} mensagens enviadas sem confirmação`,
      detalhe:
        "Quem confirma a entrega é o mesmo canal por onde as mensagens das clientes chegam. " +
        "Nenhuma confirmação chegou depois delas, então é provável que o sistema esteja sem " +
        "receber nada — e sem receber, ninguém percebe.",
    };
  }
  if (presas > 0) {
    const nEnt = presas > 1 ? "mensagens" : "mensagem";
    return {
      estado: "suspeito",
      presas, minutos_sem_recibo: minutos, canal_confirmado: canalConfirmado,
      titulo: `${presas} ${nEnt} sem confirmação`,
      detalhe: canalConfirmado
        ? `O canal está entregando — houve confirmação depois ${presas > 1 ? "delas" : "dela"}. ` +
          `Então o problema é ${presas > 1 ? "dessas mensagens" : "dessa mensagem"}, não do sistema: ` +
          "número que não recebe no WhatsApp, arquivo recusado ou cliente que bloqueou."
        : "Pode ser só um número que não recebe no WhatsApp. Se o número subir nos próximos minutos, " +
          "é o canal.",
    };
  }
  // Nada preso, mas também nada confirmado há muito tempo: não dá para dizer
  // que está bom. Dizer "ok" aqui seria afirmar o que não se sabe.
  if (minutos !== null && minutos > 12 * 60) {
    return {
      estado: "sem_sinal",
      presas: 0, minutos_sem_recibo: minutos, canal_confirmado: false,
      titulo: `Sem tráfego há ${Math.floor(minutos / 60)} h`,
      detalhe: "Nenhuma mensagem confirmada nesse período. Pode ser só um dia parado.",
    };
  }
  return { estado: "ok", presas: 0, minutos_sem_recibo: minutos, canal_confirmado: canalConfirmado, titulo: "", detalhe: "" };
}
