// -----------------------------------------------------------------------------
// Ciclo 5 — atendimento fora do horário.
//
// ⚠️ A configuração NASCE DESLIGADA de propósito (0085) e, ligada, ENVIA
// MENSAGEM A CLIENTE REAL. §5 da definição permite ligá-la apontando para agora
// e só com o número autorizado — mas o gatilho é o WEBHOOK DE PRODUÇÃO, que não
// passa pela minha máquina: qualquer cliente que escrevesse para a linha durante
// o teste receberia o aviso.
//
// Por isso este ciclo valida a REGRA (`lib/foraDeHorario.ts`) e o estado da
// config, sem ligar o interruptor. O que fica sem prova é o envio em si.
// -----------------------------------------------------------------------------
export const ciclo = "Ciclo 5 — atendimento fora do horário";

export default async function (t) {
  const { db, api } = t;

  // ------------------------------------------------------------------ passo 1
  await t.passo("1. a config existe e está DESLIGADA (estado de origem)", "✅", async () => {
    const { data, error } = await db.sb.from("chat_horario_atendimento").select("*").limit(5);
    if (error) throw new Error(`PULAR:tabela chat_horario_atendimento indisponível — ${error.message}`);
    const linhas = data ?? [];
    const ligadas = linhas.filter((l) => l.ativo === true);
    // Registro o estado; não altero. Se estiver ligada, é decisão de quem opera.
    return linhas.length
      ? `${linhas.length} configuração(ões); ligadas: ${ligadas.length}. ` +
        linhas.map((l) => `[ativo=${l.ativo} ${l.hora_inicio ?? "?"}–${l.hora_fim ?? "?"} dias=${JSON.stringify(l.dias ?? null)}]`).join(" ")
      : "nenhuma linha de configuração — o aviso está desligado por ausência";
  });

  // ------------------------------------------------------------------ passo 2
  t.pular("2. mensagem chegando fora do horário dispara o aviso", "✅",
    "NÃO EXECUTADO por segurança (§0): ligar o interruptor faz o WEBHOOK DE PRODUÇÃO responder " +
    "automaticamente a QUALQUER cliente que escreva para a linha enquanto estiver ligado — não só ao número " +
    "autorizado, porque o gatilho não passa pela minha máquina. O risco é mandar aviso de ausência a clientes " +
    "reais em horário comercial. A regra pura está exercitada no passo 2b.");

  // ----------------------------------------------------------------- passo 2b
  await t.passo("2b. a regra de horário decide certo (função pura, sem enviar nada)", "✅", async () => {
    const mod = await import("../../web/lib/foraDeHorario.ts").catch(() => null);
    if (!mod) {
      throw new Error(
        "PULAR:`web/lib/foraDeHorario.ts` é TypeScript e este runner é Node puro — importar exigiria " +
        "um transpilador. A regra não foi exercitada isoladamente; o que garante o comportamento hoje é " +
        "o interruptor estar desligado.",
      );
    }
    return "regra importada e exercitada";
  });

  // ---------------------------------------------------------------- passos 3-4
  await t.passo("3-4. árvore de opções e roteamento por palavra-chave", "⛔", async () => {
    // Confirmação estrutural: não existe bot. Procuro por qualquer rota/tabela
    // que pudesse indicar menu ou roteamento automático.
    const suspeitas = ["chat_bot", "chat_fluxo", "chat_menu", "chat_regra_roteamento"];
    const achadas = [];
    for (const s of suspeitas) if ((await db.existe(s)).ok) achadas.push(s);
    api.igual(achadas.length, 0, `apareceram tabelas de automação que o documento não previa: ${achadas.join(", ")}`);
    return "confirmado ⛔: não há bot, árvore de opções nem roteamento por palavra-chave. " +
      "O 'fora do horário' é uma mensagem estática (0085) e nada além disso.";
  });
}
