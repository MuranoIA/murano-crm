// ---------------------------------------------------------------------------
// RECIBO DE ENTREGA da Meta — sent → delivered → read (ou failed).
//
// Vive aqui, e não dentro do route.ts, por um motivo prático: um `route.ts` do
// Next só pode exportar handlers (§35.2), então lógica que precisa de teste
// não pode morar lá. E esta precisa: são seis ramos, e o defeito que ela
// conserta era invisível justamente por não ter nenhum.
// ---------------------------------------------------------------------------

/**
 * Falha de ESCRITA — a única que merece 503 e reenvio da Meta.
 *
 * Payload que não sabemos ler segue em 200: ali reenviar não conserta, só
 * repete para sempre. Reenviar é seguro porque todo upsert é por wamid
 * (idempotente): a mensagem que já entrou entra de novo como a mesma linha.
 */
export class FalhaAoGravar extends Error {
  readonly gravacao = true;
}
export const ehFalhaAoGravar = (e: unknown): boolean => Boolean((e as any)?.gravacao);


/**
 * Quanto tempo um recibo sem linha correspondente ainda merece insistência.
 *
 * A corrida com a rota de envio dura menos de 2 s (medido em 30 dias: a maior
 * distância entre o Graph responder e a linha entrar no banco foi 1,58 s).
 * Acima disto não é corrida — é recibo de mensagem que não é nossa, enviada
 * por outra ferramenta no mesmo número — e insistir faria a Meta reenviar o
 * lote inteiro para sempre.
 */
export const JANELA_RECIBO_ORFAO_S = 300;
/** Esperas entre as tentativas de aplicar um recibo que chegou cedo demais. */
export const ESPERAS_RECIBO_MS = [400, 600, 900];
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function aplicarRecibo(
  sb: any, st: any, opcoes: { esperas?: number[] } = {},
): Promise<void> {
  const esperas = opcoes.esperas ?? ESPERAS_RECIBO_MS;
  const wamid = String(st.id ?? "");
  const status = String(st.status ?? "");
  if (!wamid || !status) return;
  // Mapeia para o vocabulário que o banco já usa (herdado do RD):
  // wait = só enviada · success = entregue · read = lida
  const mapa: Record<string, string> = {
    sent: "wait",
    delivered: "success",
    read: "read",
    failed: "failed",
  };
  // O motivo da falha vai para o BANCO, não só para o log (migration 0091).
  // Ficava em console.error: a explicação da Meta vivia na Vercel, some com o
  // tempo, e na tela sobrava "falhou" sem causa. Em erro fora da documentação
  // pública — a maioria destes — o texto da Meta é a única pista que existe.
  //
  // Junta todos os campos que a Meta manda, filtrando vazios: `title` costuma
  // ser genérico, `details` é onde mora a causa, e às vezes um deles vem como
  // string VAZIA (§22.6.1) — por isso concatenar, nunca `??`.
  const e0 = (st.errors ?? [])[0] ?? null;
  const explicacao = e0
    ? [e0.code ? `Meta ${e0.code}` : "", e0.title, e0.message, e0.error_data?.details]
        .map((p: unknown) => String(p ?? "").trim())
        .filter(Boolean)
        .join(" — ")
        .slice(0, 500)
    : null;

  if (status === "failed") {
    console.error("[wa-webhook] envio falhou:", JSON.stringify(st.errors ?? st));
  }

  // ORDEM dos recibos. A Meta NÃO garante a ordem de entrega: `delivered` e
  // `read` vêm em POSTs separados, atendidos por invocações concorrentes, então
  // o último a ser APLICADO pode ser o mais antigo. Sem esta guarda um
  // `delivered` atrasado rebaixa para "entregue" uma mensagem que a cliente já
  // leu — e a bolha perde o tique azul sozinha, sem nada ter acontecido.
  const ORDEM: Record<string, number> = { wait: 1, success: 2, read: 3 };
  const novo = mapa[status] ?? status;
  const atrasados = Object.keys(ORDEM).filter((s) => ORDEM[s] < (ORDEM[novo] ?? 0));

  // `sent` é o primeiro degrau: não existe estado abaixo dele para avançar, e a
  // linha que a rota de envio grava já nasce em "wait", que é o mesmo que ele
  // diz. Sair aqui não perde nada — e evita que o recibo MAIS COMUM da corrida
  // gaste ~2 s de espera e termine pedindo à Meta um reenvio do lote inteiro
  // (que reentregaria as mensagens da cliente e repetiria o push do vendedor).
  if (!atrasados.length && status !== "failed") return;

  const patch = {
    status: novo,
    // limpa o erro anterior quando a mensagem volta a andar (reenvio bem
    // sucedido não pode continuar exibindo a falha de antes)
    ...(status === "failed" ? { erro: explicacao ?? "falha sem detalhe da Meta" } : { erro: null }),
  };

  /** Aplica o recibo. `failed` vale sempre; os outros só avançam. */
  const aplicar = async (): Promise<boolean> => {
    let q = sb.from("mensagens").update(patch).eq("id", wamid);
    if (status !== "failed") q = q.in("status", atrasados);
    // `.select()` é o que revela QUANTAS linhas casaram: sem ele, um UPDATE
    // que não achou nada é indistinguível de um que deu certo.
    const { data, error } = await q.select("id");
    if (error) throw new FalhaAoGravar(`update status: ${error.message}`);
    return Boolean(data?.length);
  };
  const existe = async (): Promise<boolean> => {
    const { data } = await sb.from("mensagens").select("id").eq("id", wamid).maybeSingle();
    return Boolean(data);
  };

  // ZERO linhas casadas — e o PostgREST não chama isso de erro, devolve
  // sucesso. Duas causas OPOSTAS se escondem aí, e é preciso separá-las:
  //
  //   a linha já está igual ou adiante -> nada a fazer (recibo fora de ordem)
  //   a linha ainda NÃO EXISTE         -> o recibo ganhou a corrida do envio
  //
  // ⚠️ A segunda é o defeito que fazia a mensagem ENTREGUE E LIDA ficar com um
  // tique só, como se nunca tivesse saído do aparelho. A rota de envio só grava
  // DEPOIS que o Graph responde; até lá o UPDATE daqui não achava nada, ninguém
  // reclamava, e em seguida o envio inseria a linha com "wait" — que ficava lá
  // para sempre, porque o recibo que a corrigiria já tinha sido descartado.
  for (let i = 0; ; i++) {
    if (await aplicar()) return;
    if (await existe()) {
      // A linha existe mas o UPDATE não casou. Ou ela já está igual/adiante
      // (nada a fazer), ou ela NASCEU entre o UPDATE e esta leitura — a mesma
      // corrida, só que uma ida de rede mais estreita. Uma última tentativa
      // separa os dois de graça: no primeiro caso não casa de novo; no
      // segundo, aplica. Sem ela o recibo se perderia nessa fresta.
      await aplicar();
      return;
    }
    if (i >= esperas.length) break;
    await dormir(esperas[i]);
  }

  // Ainda não apareceu. Recibo fresco = a corrida foi mais longa que a espera
  // acima (envio lento, partida a frio): 503 faz a Meta reenviar, e aí a linha
  // já existe. É a mesma rede que a mensagem recebida usa.
  const idadeS = Number(st.timestamp) ? Date.now() / 1000 - Number(st.timestamp) : 0;
  if (idadeS <= JANELA_RECIBO_ORFAO_S) {
    throw new FalhaAoGravar(`recibo chegou antes da mensagem: ${wamid}`);
  }
  console.warn("[wa-webhook] recibo sem mensagem nossa (outra ferramenta no mesmo número?):", wamid, status);
}
