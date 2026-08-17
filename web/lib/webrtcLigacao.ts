"use client";

// ---------------------------------------------------------------------------
// WebRTC da ligação — só o navegador, sem nenhum conhecimento do Graph.
//
// O áudio NÃO passa pelo nosso servidor. Ele corre direto entre esta aba e a
// infraestrutura da Meta; o servidor faz apenas a sinalização (troca de SDP e
// comandos). Por isso este arquivo não sabe o que é `call_id`, permissão ou
// carteira: ele recebe/produz SDP e entrega um <audio> tocando.
//
// UMA DECISÃO QUE PARECE DETALHE E NÃO É — ICE não-trickle:
// o Graph aceita UM SDP completo, não um fluxo de candidatos ICE avulsos (não há
// endpoint para "mais um candidato"). Então esperamos a coleta de candidatos
// TERMINAR antes de mandar a oferta/resposta. Sem isso o SDP sai sem candidato
// nenhum e a chamada conecta... muda para nada: liga e fica mudo dos dois lados.
// O timeout existe porque `icegatheringstatechange` às vezes não dispara
// 'complete' — melhor mandar o que já foi coletado do que travar a discagem.
// ---------------------------------------------------------------------------

const STUN = [{ urls: "stun:stun.l.google.com:19302" }];
const TIMEOUT_ICE = 3000;

export type EstadoRtc = "novo" | "conectando" | "conectado" | "caiu" | "encerrado";

export class LigacaoRtc {
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private remoto = new MediaStream();
  /** <audio> que toca a voz da outra ponta. Criado sob demanda, removido no fim. */
  private el: HTMLAudioElement | null = null;
  private aoMudar: (e: EstadoRtc) => void;

  constructor(aoMudar: (e: EstadoRtc) => void = () => {}) {
    this.aoMudar = aoMudar;
  }

  /** true se este navegador tem o necessário (http:// em rede local não tem). */
  static suportado(): boolean {
    return typeof window !== "undefined"
      && typeof RTCPeerConnection !== "undefined"
      && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  private async montar(): Promise<RTCPeerConnection> {
    // pede o microfone ANTES de qualquer coisa: é o passo que pode ser negado
    // pelo usuário, e falhar aqui é bem mais barato do que falhar depois de a
    // chamada já estar tocando no telefone da cliente.
    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });

    const pc = new RTCPeerConnection({ iceServers: STUN });
    for (const t of this.local.getTracks()) pc.addTrack(t, this.local);

    pc.ontrack = (ev) => {
      for (const t of ev.streams[0]?.getTracks() ?? [ev.track]) this.remoto.addTrack(t);
      if (!this.el) {
        this.el = document.createElement("audio");
        this.el.autoplay = true;
        // fora da árvore do React de propósito: um <audio> controlado por estado
        // seria remontado a cada render e cortaria o áudio no meio da frase
        document.body.appendChild(this.el);
      }
      this.el.srcObject = this.remoto;
      void this.el.play().catch(() => { /* autoplay bloqueado: o clique de atender já é o gesto */ });
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") this.aoMudar("conectado");
      else if (s === "connecting") this.aoMudar("conectando");
      else if (s === "failed" || s === "disconnected") this.aoMudar("caiu");
      else if (s === "closed") this.aoMudar("encerrado");
    };

    this.pc = pc;
    return pc;
  }

  /** Espera a coleta de candidatos ICE fechar (ver nota no topo). */
  private static async esperarIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      const pronto = () => {
        if (pc.iceGatheringState !== "complete") return;
        pc.removeEventListener("icegatheringstatechange", pronto);
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(() => {
        pc.removeEventListener("icegatheringstatechange", pronto);
        resolve();   // manda o que já tem — melhor que travar
      }, TIMEOUT_ICE);
      pc.addEventListener("icegatheringstatechange", pronto);
    });
  }

  /** Chamada que NÓS originamos: produz a oferta. */
  async oferta(): Promise<string> {
    const pc = await this.montar();
    this.aoMudar("conectando");
    await pc.setLocalDescription(await pc.createOffer({ offerToReceiveAudio: true }));
    await LigacaoRtc.esperarIce(pc);
    return pc.localDescription?.sdp ?? "";
  }

  /** Chamada RECEBIDA: aplica a oferta da cliente e produz a resposta. */
  async resposta(sdpOferta: string): Promise<string> {
    const pc = await this.montar();
    this.aoMudar("conectando");
    await pc.setRemoteDescription({ type: "offer", sdp: sdpOferta });
    await pc.setLocalDescription(await pc.createAnswer());
    await LigacaoRtc.esperarIce(pc);
    return pc.localDescription?.sdp ?? "";
  }

  /**
   * Aplica o SDP que veio pelo webhook. Idempotente de propósito: o mesmo evento
   * pode chegar duas vezes (a Meta reentrega), e reaplicar uma descrição remota
   * já aceita derrubaria a chamada com InvalidStateError.
   */
  async aplicarRemoto(sdp: string, tipo: "offer" | "answer"): Promise<void> {
    if (!this.pc || !sdp) return;
    if (tipo === "answer" && this.pc.signalingState !== "have-local-offer") return;
    await this.pc.setRemoteDescription({ type: tipo, sdp });
  }

  /** Microfone no mudo. Continua enviando o fluxo — só sem áudio. */
  mudo(ligado: boolean): void {
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !ligado;
  }

  get mudoAtivo(): boolean {
    const t = this.local?.getAudioTracks()?.[0];
    return Boolean(t && !t.enabled);
  }

  /**
   * Desliga tudo. O `stop()` em cada track é obrigatório: sem ele a luz do
   * microfone continua acesa depois da chamada — o usuário acha, com razão, que
   * ainda está sendo ouvido.
   */
  encerrar(): void {
    for (const t of this.local?.getTracks() ?? []) t.stop();
    for (const t of this.remoto.getTracks()) this.remoto.removeTrack(t);
    try { this.pc?.close(); } catch { /* já fechada */ }
    if (this.el) {
      this.el.srcObject = null;
      this.el.remove();
      this.el = null;
    }
    this.pc = null;
    this.local = null;
    this.aoMudar("encerrado");
  }
}

/**
 * O CRM roda DENTRO de um iframe no hub interno (§17). Isso muda o diagnóstico
 * do microfone de um jeito que custou uma sessão para descobrir:
 *
 * em iframe cross-origin, o padrão do navegador para `microphone` é `self` — só
 * o site do topo. Sem o pai delegar (`<iframe allow="microphone">`), o
 * getUserMedia é recusado com **NotAllowedError, e SEM PROMPT NENHUM**. O erro é
 * idêntico ao de "o usuário clicou em bloquear", mas a solução é o oposto: não
 * há nada que o usuário possa liberar no cadeado — a permissão nem chega a ser
 * pedida, e o painel do site sequer lista "Microfone".
 *
 * `true` = a política do quadro está bloqueando, e mandar o usuário ao cadeado
 * seria mandá-lo caçar uma opção que não existe.
 */
export function microfoneBloqueadoPeloQuadro(): boolean {
  if (typeof window === "undefined" || window.self === window.top) return false;
  // `permissionsPolicy` é o nome novo; `featurePolicy` é o que o Chrome ainda expõe
  const pol: any = (document as any).permissionsPolicy ?? (document as any).featurePolicy;
  if (typeof pol?.allowsFeature === "function") {
    try { return !pol.allowsFeature("microphone"); } catch { /* cai no default abaixo */ }
  }
  // Em iframe e sem como consultar a política: não dá para cravar, então a
  // mensagem cita as duas hipóteses em vez de escolher a errada com confiança.
  return true;
}

/**
 * Mensagem de erro em português para as recusas do getUserMedia. A mensagem
 * nativa ("Requested device not found") não diz a ninguém o que fazer.
 */
export function explicarErroMicrofone(e: any): string {
  const nome = String(e?.name ?? "");
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    if (microfoneBloqueadoPeloQuadro()) {
      return "O CRM está aberto dentro do hub, e o quadro não recebeu permissão de microfone — " +
             "por isso o navegador nem chegou a perguntar (não adianta procurar no cadeado). " +
             "Corrige-se no hub, liberando o microfone para o quadro do CRM. " +
             "Enquanto isso, abra o CRM direto em crm.muranoprofessional.com.br para ligar.";
    }
    return "Permissão de microfone negada. Libere o microfone para este site no ícone do cadeado, ao lado do endereço.";
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") {
    return "Nenhum microfone encontrado neste computador.";
  }
  if (nome === "NotReadableError") {
    return "O microfone está em uso por outro programa.";
  }
  return e?.message ?? "Não foi possível acessar o microfone.";
}
