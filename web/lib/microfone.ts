/**
 * Diagnóstico do microfone — por que o navegador recusou, em português e sem
 * mandar ninguém para o lugar errado.
 *
 * Existe porque a recusa do `getUserMedia` chega SEMPRE com o mesmo nome
 * (`NotAllowedError`) para causas que se consertam em lugares opostos:
 *
 *  · o quadro (iframe) não recebeu permissão de microfone — o navegador nem
 *    chegou a perguntar, e não há nada no cadeado para o usuário liberar;
 *  · o usuário clicou em bloquear — aí o cadeado é exatamente o caminho;
 *  · a permissão do site JÁ ESTÁ CONCEDIDA e a recusa veio de fora do
 *    navegador (privacidade do Windows, política da empresa, extensão).
 *
 * O terceiro caso é o que motivou este módulo, em 31/08/2026: o CRM afirmava
 * "verifique a permissão do navegador" para quem já tinha o microfone ligado
 * no cadeado. Erro que não diz o que fazer vira diagnóstico errado (§37, §53).
 */

export type EstadoQuadro = "topo" | "liberado" | "bloqueado" | "desconhecido";

/**
 * O CRM roda DENTRO de um iframe: o hub interno o embute (§17) e o board embute
 * o /chat na lupa (§41). Em iframe cross-origin o padrão do navegador para
 * `microphone` é `self` — só o site do topo. Sem o pai delegar
 * (`<iframe allow="microphone">`), o getUserMedia é recusado com
 * **NotAllowedError e SEM PROMPT NENHUM**.
 *
 * Medido em 31/08/2026 (Chrome 151, iframe cross-origin, microfone falso):
 * sem `allow` → `allowsFeature('microphone') === false` e
 * `NotAllowedError: Permission denied`; com `allow="microphone"` → política
 * `true` e gravação normal. É por isso que este estado vem antes de qualquer
 * palpite sobre o cadeado.
 */
export function quadroDoMicrofone(): EstadoQuadro {
  if (typeof window === "undefined") return "desconhecido";
  if (window.self === window.top) return "topo";
  // `permissionsPolicy` é o nome novo; `featurePolicy` é o que o Chrome ainda expõe
  const pol: any = (document as any).permissionsPolicy ?? (document as any).featurePolicy;
  if (typeof pol?.allowsFeature === "function") {
    try { return pol.allowsFeature("microphone") ? "liberado" : "bloqueado"; } catch { /* abaixo */ }
  }
  // Em iframe e sem como consultar a política: não dá para cravar. Quem lê isto
  // precisa citar as duas hipóteses em vez de escolher a errada com confiança.
  return "desconhecido";
}

/**
 * O que o navegador guarda para ESTE site. `granted` com recusa na cara é a
 * assinatura do bloqueio vindo de fora do navegador — e é o que separa
 * "libere no cadeado" (inútil, ele já liberou) de "o problema é o Windows".
 *
 * Firefox não conhece o nome `microphone` nesta API e lança: vira "desconhecida",
 * nunca uma afirmação falsa.
 */
export async function permissaoDoMicrofone(): Promise<"granted" | "denied" | "prompt" | "desconhecida"> {
  try {
    const p = await (navigator as any).permissions?.query?.({ name: "microphone" as PermissionName });
    const s = p?.state;
    return s === "granted" || s === "denied" || s === "prompt" ? s : "desconhecida";
  } catch {
    return "desconhecida";
  }
}

/** O nome técnico nunca é jogado fora: sem ele o próximo diagnóstico recomeça do zero (§22.6.1). */
function detalhe(e: any): string {
  const nome = String(e?.name ?? "").trim();
  const msg = String(e?.message ?? "").trim();
  const t = [nome, msg].filter(Boolean).join(": ");
  return t ? ` (${t})` : "";
}

/**
 * Mensagem em português para as recusas do getUserMedia. A nativa
 * ("Permission denied", "Requested device not found") não diz a ninguém o que fazer.
 *
 * É assíncrona porque consultar a permissão guardada é o único jeito de saber
 * que o cadeado já está liberado — e é justamente esse o caso em que a versão
 * anterior mandava o usuário ao cadeado.
 */
export async function explicarErroMicrofone(e: any): Promise<string> {
  const nome = String(e?.name ?? "");

  if (typeof navigator !== "undefined" && !navigator.mediaDevices) {
    return "Este navegador não expõe o microfone nesta página — costuma ser endereço http. " +
           "Abra o CRM por https." + detalhe(e);
  }

  if (nome === "NotAllowedError" || nome === "SecurityError") {
    const quadro = quadroDoMicrofone();

    if (quadro === "bloqueado") {
      return "O CRM está aberto dentro de um quadro (o hub, ou a lupa do board) que não recebeu " +
             "permissão de microfone — por isso o navegador nem chegou a perguntar, e não adianta " +
             "procurar no cadeado. Enquanto isso não é liberado no quadro, abra o CRM direto em " +
             "crm.muranoprofessional.com.br." + detalhe(e);
    }

    const permissao = await permissaoDoMicrofone();

    if (permissao === "granted") {
      return "O navegador JÁ tem permissão de microfone para este site, e mesmo assim a captura foi " +
             "recusada — então não é o cadeado. Confira o microfone no Windows " +
             "(Configurações → Privacidade e segurança → Microfone, com acesso liberado para o navegador), " +
             "se alguma extensão ou política da empresa está bloqueando, e se outro programa está com o " +
             "microfone aberto." + detalhe(e);
    }

    if (quadro === "desconhecido") {
      return "Não consegui abrir o microfone. Duas causas possíveis: a permissão foi negada para este " +
             "site (libere no ícone do cadeado) ou o quadro em que o CRM está aberto não recebeu " +
             "permissão de microfone — nesse segundo caso o cadeado não resolve, e a saída é abrir o CRM " +
             "direto em crm.muranoprofessional.com.br." + detalhe(e);
    }

    return "Permissão de microfone negada. Libere o microfone para este site no ícone do cadeado, " +
           "ao lado do endereço." + detalhe(e);
  }

  if (nome === "NotFoundError" || nome === "OverconstrainedError") {
    return "Nenhum microfone encontrado neste computador." + detalhe(e);
  }
  if (nome === "NotReadableError" || nome === "AbortError") {
    return "O microfone existe, mas o sistema não deixou abri-lo agora — normalmente porque outro " +
           "programa está usando (uma reunião, uma chamada) ou porque o Windows está negando o acesso." +
           detalhe(e);
  }
  return "Não foi possível acessar o microfone." + detalhe(e);
}

/**
 * Falha do GRAVADOR, não do microfone. São coisas diferentes e ficavam no mesmo
 * `catch`: quando o MediaRecorder não aceitava nenhum formato, a tela mandava o
 * usuário conferir a permissão de um microfone que tinha aberto sem problema.
 */
export function explicarErroGravador(e: any): string {
  return "O microfone abriu, mas este navegador não conseguiu iniciar a gravação. " +
         "Use o Chrome ou o Edge atualizados." + detalhe(e);
}
