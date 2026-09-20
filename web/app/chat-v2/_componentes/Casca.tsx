"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListaConversas } from "./ListaConversas";
import { Conversa as TelaConversa } from "./Conversa";
import { PainelContato } from "./PainelContato";
import { Ripple } from "./Ripple";
import { Snackbars, useAvisos } from "./Avisos";
import { enviarArquivos, type Progresso } from "./anexos";
import type { Nota, Transferencia } from "./Thread";
import { nomeLimpo } from "./formato";
import { SEM_RECORTE, type Recortes } from "./Filtros";
import { useRealtimeDoChat } from "./realtime";
import {
  useAvisoDeChegada, usePermissaoDeNotificacao, usePonteDoHub, usePush, useTituloDaAba,
} from "./notificacoes";
import { lembrarTelaAtual } from "../../lembrarTela";
import type { Ligacao } from "../../../lib/ligacaoDados";
import type { ApiLigacao } from "./Ligacao";
import type { Gesto } from "./Compositor";
import type { Conversa, Fila, Lista, Mensagem, Thread } from "./tipos";

// pesado e raro: quem não manda template não baixa este código
const Templates = dynamic(() => import("./Templates"), { ssr: false });
const Transferir = dynamic(() => import("./Dialogos").then((m) => m.Transferir), { ssr: false });
const Resolver = dynamic(() => import("./Dialogos").then((m) => m.Resolver), { ssr: false });
const Encaminhar = dynamic(() => import("./Dialogos").then((m) => m.Encaminhar), { ssr: false });

// ⚠️ A camada de ligação é dinâmica pela ORDEM, não pela condição: ela precisa
// estar montada SEMPRE (é ela que faz a campainha tocar quando a cliente liga),
// mas o `RTCPeerConnection`, o `getUserMedia` e a máquina de estados não podem
// estar no pedaço de JS da primeira pintura. Chega um instante depois, com a
// tela já de pé — e não envolve nada, para não arrastar a lista para fora do
// SSR (ver o cabeçalho de Ligacao.tsx).
const CamadaLigacao = dynamic(() => import("./Ligacao"), { ssr: false });

// ---------------------------------------------------------------------------
// A casca: três regiões, uma escolha de fila, uma conversa aberta.
//
// LAYOUT É CSS, NÃO JAVASCRIPT. O chat antigo decide com `window.innerWidth`,
// e por isso a lupa do board (um iframe de 500 px) e o celular acabam no mesmo
// ramo por acidente. Aqui as três regiões são `flex` com pontos de corte do
// Tailwind: dentro do iframe do hub ou da lupa, a media query responde à
// largura DAQUELE quadro, e o layout se adapta sozinho.
//
// O único uso de estado para layout é "tem conversa aberta?" — que é estado de
// navegação, não de tamanho de tela.
// ---------------------------------------------------------------------------

/**
 * O INCREMENTAL (`?desde=`): o que chegou é sempre mais novo que o que está na
 * tela, então a regra é acrescentar — nunca substituir.
 *
 * ⚠️ A primeira versão desta função descartava o que fosse mais antigo que o
 * lote recebido, e o teste pegou na hora: ao enviar uma mensagem, a fala da
 * cliente SUMIA da tela. Aquela regra é da FOTO (abaixo), não daqui.
 *
 * A bolha `tmp:` morre quando a mesma fala, do mesmo lado, volta do servidor —
 * senão a mensagem aparece em dobro por um instante.
 */
function juntarNovas(atual: Mensagem[], chegou: Mensagem[]): Mensagem[] {
  if (!chegou.length) return atual;
  const porId = new Set(chegou.map((m) => m.id));
  const sobrevive = atual.filter((m) => {
    if (porId.has(m.id)) return false;
    if (!m.id.startsWith("tmp:")) return true;
    const gemea = chegou.find(
      (c) => c.enviada_por !== "customer" && (c.conteudo ?? "") === (m.conteudo ?? ""),
    );
    return !gemea;
  });
  return [...sobrevive, ...chegou].sort((a, b) => (a.criada_em < b.criada_em ? -1 : 1));
}

export function Casca({
  inicial,
  threadInicial,
  embutido,
}: {
  inicial: Lista;
  threadInicial: Thread | null;
  /** a lupa do board (`?embed=1`): uma conversa só, sem a navegação do produto.
   *  Vem do SERVIDOR e não de `location.search` para que o cabeçalho nunca
   *  pisque dentro do quadro antes de o JS decidir escondê-lo. */
  embutido: boolean;
}) {
  const [lista, setLista] = useState<Conversa[]>(inicial.conversas);
  const [completa, setCompleta] = useState(!inicial.tem_mais);
  const [carregandoLista, setCarregandoLista] = useState(false);

  const [fila, setFila] = useState<Fila>("todas");
  const [busca, setBusca] = useState("");

  const [aberta, setAberta] = useState<string | null>(threadInicial?.cliente_id ?? null);
  const [mensagens, setMensagens] = useState<Mensagem[]>(threadInicial?.mensagens ?? []);
  const [temMais, setTemMais] = useState(!!threadInicial?.tem_mais);
  const [carregandoThread, setCarregandoThread] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [painelAberto, setPainelAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [templates, setTemplates] = useState(false);
  // o que veio junto da thread: notas, transferências e os trechos citados
  const [notas, setNotas] = useState<Nota[]>([]);
  const [transferencias, setTransferencias] = useState<Transferencia[]>([]);
  const [ligacoes, setLigacoes] = useState<Ligacao[]>([]);
  // Pode ligar para esta conversa? Vem RESOLVIDO do servidor, pela mesma
  // `conversaNaCloud()` que a rota de ligação usa para decidir — a tela não
  // deduz do rótulo da linha, que é outra pergunta.
  const [podeLigar, setPodeLigar] = useState(false);
  const [citadas, setCitadas] = useState<Record<string, { conteudo: string | null; enviada_por: string | null }>>({});
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [locais, setLocais] = useState<{ nome: string; endereco?: string }[]>([]);
  const [dialogo, setDialogo] = useState<null | "transferir" | "resolver">(null);
  const [encaminhando, setEncaminhando] = useState<Mensagem | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // A conversa aberta pode NÃO estar na lista: `vw_chat_conversa` é
  // materializada e só atualiza a cada 2 min (0139), então uma conversa que
  // acabou de nascer — ou um link do board para alguém fora do recorte — abriria
  // numa tela vazia. Esta é a conversa montada a partir da própria thread.
  const [avulsa, setAvulsa] = useState<Conversa | null>(
    threadInicial?.cliente
      ? {
          cliente_id: threadInicial.cliente_id,
          cliente: threadInicial.cliente.nome,
          telefone: threadInicial.cliente.telefone,
          codcli: null, // não vem de `clientes`; a lista é que o traz
          vendedor: null, carteira_dona: null, transferida_de: null, etapa: null,
          ultima_atividade: "", ultima_mensagem: null, ultima_enviada_por: null,
          nao_lida: false, favorita: false, na_fila: false, status: "aberta", motivo: null,
        }
      : null,
  );

  const { avisos, avisar, fechar } = useAvisos();

  // qual conversa está na tela AGORA, lido no momento em que a resposta chega.
  // É a guarda da §70: sem ela, a thread da cliente A aparece dentro da B.
  const abertaRef = useRef<string | null>(aberta);
  useEffect(() => {
    abertaRef.current = aberta;
  }, [aberta]);

  // a mensagem mais nova que já temos: é o cursor do incremental `?desde=`
  const msgsRef = useRef<Mensagem[]>(mensagens);
  useEffect(() => {
    msgsRef.current = mensagens;
  }, [mensagens]);

  const [precisaCompleta, setPrecisaCompleta] = useState(false);
  const [contagensServidor, setContagensServidor] = useState<Record<string, number> | null>(null);

  // ---- os recortes da fase 4 (consultor, número, coluna do board) ---------
  // `precisaExtras` é o que autoriza a lista completa a vir COM etapa e linha.
  // São 2 consultas a mais no servidor e uma varredura de 4 mil clientes; quem
  // não abre os filtros não paga por nenhuma das duas.
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [precisaExtras, setPrecisaExtras] = useState(false);
  const [recortes, setRecortes] = useState<Recortes>(SEM_RECORTE);
  const [comExtras, setComExtras] = useState(false);

  // ---- a camada de ligação publica para cá o botão de discar --------------
  // `useCallback` sem dependências: se esta função mudasse de identidade, o
  // efeito que publica dispararia a cada render e o laço não teria fim.
  const [ligacao, setLigacao] = useState<ApiLigacao | null>(null);
  // ponte para os dois gestos que moram dentro do compositor (o texto não sobe,
  // e estes também não precisam subir — só o gatilho)
  const gesto = useRef<Gesto | null>(null);
  const registrarGesto = useCallback((fn: Gesto | null) => {
    gesto.current = fn;
  }, []);
  const publicarLigacao = useCallback((api: ApiLigacao | null) => setLigacao(api), []);

  // os contadores dos chips: pedidos DEPOIS da pintura, porque contar varre as
  // ~4 mil conversas. Enquanto não chegam, o chip aparece sem número — nunca
  // com zero, que seria mentira.
  const recarregarContagens = useCallback(() => {
    fetch("/api/chat-v2/contagens")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => setContagensServidor(j))
      .catch(() => {});
  }, []);
  useEffect(() => {
    // dentro da lupa não há chips para numerar: a tela mostra UMA conversa
    if (embutido) return;
    recarregarContagens();
  }, [recarregarContagens, embutido]);

  // endereços salvos (crm_config.locais): uma consulta por sessão, e o menu do
  // clipe já abre com eles
  useEffect(() => {
    fetch("/api/chat/localizacao")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => setLocais(j.locais ?? []))
      .catch(() => {});
  }, []);

  // ---- o resto da lista, SÓ QUANDO PRECISA -------------------------------
  //
  // A primeira página (60 conversas) já veio no HTML, e os contadores dos chips
  // vieram de uma rota que devolve cinco números — então a tela abre completa
  // sem baixar tudo.
  //
  // ⚠️ A primeira versão puxava a lista inteira em segundo plano, sempre: a
  // pintura melhorou (7,4 s → 1 s) mas a sessão continuava custando 2,7 MB,
  // medidos. As 4 mil conversas só são necessárias para buscar, filtrar por
  // outro recorte ou rolar até o fim — e é nesses três momentos que elas vêm.
  useEffect(() => {
    // A lista completa vem uma vez; se a pessoa abrir os filtros DEPOIS, ela
    // volta uma segunda vez trazendo etapa e número. Duas idas no pior caso, e
    // só para quem filtra.
    const faltaExtras = precisaExtras && !comExtras;
    if ((completa && !faltaExtras) || (!precisaCompleta && !precisaExtras)) return;
    let vivo = true;
    setCarregandoLista(true);
    fetch(`/api/chat-v2/lista${precisaExtras ? "?etapas=1&linhas=1" : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`lista: ${r.status}`))))
      .then((j: Lista) => {
        if (!vivo) return;
        setLista(j.conversas);
        setCompleta(true);
        if (precisaExtras) setComExtras(true);
      })
      .catch(() => {
        /* fica com a primeira página: degradar é melhor que tela vazia */
      })
      .finally(() => vivo && setCarregandoLista(false));
    return () => {
      vivo = false;
    };
  }, [completa, precisaCompleta, precisaExtras, comExtras]);

  // recarrega a lista visível (só o que já temos: página ou completa)
  const recarregarLista = useCallback(() => {
    // a lupa não tem lista para recarregar (§41.3): buscar as ~4 mil conversas
    // para desenhar UMA seria o desperdício que a §15.1 corrigiu no board
    if (embutido) return;
    const extras = comExtras ? "&etapas=1&linhas=1" : "";
    const url = completa ? `/api/chat-v2/lista?${extras.slice(1)}` : `/api/chat-v2/lista?limite=60${extras}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Lista) => setLista(j.conversas))
      .catch(() => {});
    recarregarContagens();
  }, [completa, comExtras, embutido, recarregarContagens]);

  // ---- abrir uma conversa -------------------------------------------------
  const abrir = useCallback((id: string) => {
    setAberta(id);
    abertaRef.current = id; // antes do render: a guarda precisa valer já
    setMensagens([]);
    setTemMais(false);
    setLigacoes([]);
    setPodeLigar(false);
    setCarregandoThread(true);
    // a conversa aberta mora na URL: o voltar do navegador funciona, o F5
    // mantém a tela, e o link do board continua valendo (§64.4)
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("cliente", id);
      window.history.replaceState(null, "", u);
      // ⚠️ Trocar de conversa NÃO é uma navegação: a URL muda por
      // `replaceState`, o `usePathname` não se mexe e o efeito do LembrarTela
      // nunca rodaria. Sem esta chamada, a volta do SSO dentro do hub acerta o
      // chat e erra a conversa (§64.4). A função já sabe não gravar no embutido.
      lembrarTelaAtual();
    } catch {}

    fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`thread: ${r.status}`))))
      .then((j) => {
        if (abertaRef.current !== id) return; // trocou de conversa no meio
        setMensagens(j.mensagens ?? []);
        setTemMais(!!j.tem_mais);
        setNotas(j.notas ?? []);
        setTransferencias(j.transferencias ?? []);
        setLigacoes(j.ligacoes ?? []);
        setPodeLigar(!!j.pode_ligar);
        setCitadas(j.citadas ?? {});
        if (j.cliente) {
          setAvulsa({
            cliente_id: id,
            cliente: j.cliente.nome ?? null,
            telefone: j.cliente.telefone ?? null,
            codcli: null,
            vendedor: j.cliente.carteira ?? null,
            carteira_dona: j.cliente.carteira ?? null,
            transferida_de: null, etapa: null,
            ultima_atividade: "", ultima_mensagem: null, ultima_enviada_por: null,
            nao_lida: false, favorita: false, na_fila: false, status: "aberta", motivo: null,
          });
        }
      })
      .catch(() => abertaRef.current === id && setMensagens([]))
      .finally(() => abertaRef.current === id && setCarregandoThread(false));

    // ---- marcar como lida -------------------------------------------------
    // SÓ QUEM ATENDE marca — a régua mora no servidor (`/api/chat/lida`), que
    // recusa quem está apenas conferindo a conversa de outra pessoa. A tela
    // apaga o marcador na hora e não espera resposta: se o servidor recusar, o
    // próximo carregamento devolve o "não lida", que é o certo.
    setLista((atual) => atual.map((c) => (c.cliente_id === id ? { ...c, nao_lida: false } : c)));
    fetch("/api/chat/lida", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cliente_id: id }),
    })
      .then(() => recarregarContagens())
      .catch(() => {});
  }, [recarregarContagens]);

  const fechar_ = useCallback(() => {
    setAberta(null);
    abertaRef.current = null;
    setMensagens([]);
    setLigacoes([]);
    setPodeLigar(false);
    setPainelAberto(false);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("cliente");
      window.history.replaceState(null, "", u);
    } catch {}
  }, []);

  // ---- o complemento da conversa que veio no HTML ------------------------
  //
  // A carga do servidor traz as mensagens — é o que faz o link do board, o push
  // e o F5 dentro de um atendimento abrirem a conversa sem esperar JS. Ela NÃO
  // traz notas, transferências, ligações nem o "pode ligar", que exigem outras
  // consultas e não valem o atraso da primeira pintura. Eles chegam aqui,
  // depois de a tela já estar de pé — e só isso é aproveitado da resposta: as
  // mensagens já estão na tela e trocá-las apagaria o que chegou no meio.
  const jaCompletou = useRef(false);
  useEffect(() => {
    const id = threadInicial?.cliente_id;
    if (!id || jaCompletou.current) return;
    jaCompletou.current = true;
    fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (abertaRef.current !== id) return;
        setNotas(j.notas ?? []);
        setTransferencias(j.transferencias ?? []);
        setLigacoes(j.ligacoes ?? []);
        setPodeLigar(!!j.pode_ligar);
        setCitadas((c) => ({ ...c, ...(j.citadas ?? {}) }));
      })
      .catch(() => {});
  }, [threadInicial?.cliente_id]);

  const carregarAntigas = useCallback(() => {
    const id = abertaRef.current;
    const atuais = msgsRef.current;
    if (!id || !atuais.length) return;
    setCarregandoAntigas(true);
    const cursor = atuais[0].criada_em;
    fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(id)}&antes=${encodeURIComponent(cursor)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`antes: ${r.status}`))))
      .then((j) => {
        if (abertaRef.current !== id) return;
        setMensagens((atual) => [...(j.mensagens ?? []), ...atual]);
        setTemMais(!!j.tem_mais);
        // `continuacao: true` não recarrega notas nem transferências — elas já
        // vieram inteiras no primeiro lote. As citadas, sim: são do lote.
        setCitadas((c) => ({ ...c, ...(j.citadas ?? {}) }));
      })
      .catch(() => {})
      .finally(() => abertaRef.current === id && setCarregandoAntigas(false));
  }, []);

  // ---- o que chegou depois: incremental, não a thread inteira -------------
  //
  // 7,8 kB em vez de 82 kB, e um índice em vez de seis consultas (§65.3). O
  // `estados` vem junto porque o aviso do Realtime também dispara quando o
  // TIQUE de uma mensagem antiga muda — sem isso o ✓✓ congelaria até o poll.
  const apanharNovas = useCallback(() => {
    const id = abertaRef.current;
    if (!id) return;
    const atuais = msgsRef.current;
    // âncora nunca é uma bolha otimista: a data dela é do relógio do NAVEGADOR,
    // e um relógio adiantado faria o `desde` pular mensagens para sempre
    const reais = atuais.filter((m) => !m.id.startsWith("tmp:"));
    const desde = reais.length ? reais[reais.length - 1].criada_em : null;
    if (!desde) return;
    fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(id)}&desde=${encodeURIComponent(desde)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (abertaRef.current !== id) return;
        const estados: Mensagem[] = j.estados ?? [];
        setMensagens((atual) => {
          const comEstado = estados.length
            ? atual.map((m) => {
                const e = estados.find((x: any) => x.id === m.id);
                return e ? { ...m, status: e.status ?? m.status, erro: (e as any).erro ?? m.erro } : m;
              })
            : atual;
          return juntarNovas(comEstado, j.mensagens ?? []);
        });
      })
      .catch(() => {});
  }, []);

  // ---- Realtime: o Postgres avisa, o navegador não pergunta ---------------
  //
  // Um socket, dois canais: `board` (chegou mensagem) e `chat-presenca` (quem
  // está em qual conversa). Ver `_componentes/realtime.ts`. Sem isto a
  // alternativa é polling, que escala com o número de abas abertas e não com o
  // trabalho (§15.1).
  const presentes = useRealtimeDoChat({
    minhaCarteira: inicial.minha_carteira,
    meuRotulo: inicial.meu_rotulo,
    conversaAberta: aberta,
    aoChegarMensagem: apanharNovas,
    aoMudarLista: recarregarLista,
    semLista: embutido,
  });

  // rede de proteção: se o Realtime cair, 60 s é o pior atraso possível
  useEffect(() => {
    const t = setInterval(() => {
      apanharNovas();
      recarregarLista();
    }, 60_000);
    return () => clearInterval(t);
  }, [apanharNovas, recarregarLista]);

  // ---- avisar que chegou mensagem ----------------------------------------
  // Quatro degraus, do mais fraco ao mais forte: título da aba, bipe,
  // notificação do sistema e push com o app fechado. Ver `notificacoes.ts`.
  //
  // O número é GLOBAL de propósito (§23.5): ele diz que chegou mensagem e não
  // pode calar porque alguém filtrou a tela. Conversa ENCERRADA sai — o texto
  // do aviso diz "aguardando resposta", e uma conversa fechada não está. Nada
  // se perde: quando a cliente escreve numa encerrada, o webhook a reabre.
  // ⚠️ SOBRE A LISTA INTEIRA, nunca sobre a primeira página. Com as 60
  // primeiras o título dizia "(6)" enquanto o chip dizia 16 — medido em
  // 20/09/2026, e é o tipo de número que ensina a não confiar na tela. Antes de
  // os contadores do servidor chegarem, o valor é `null`: os dois avisos ficam
  // calados em vez de anunciar zero.
  const naoLidas = useMemo<number | null>(() => {
    if (completa) return lista.filter((c) => c.nao_lida && !c.na_fila && c.status !== "resolvida").length;
    return contagensServidor ? contagensServidor.nao_lidas : null;
  }, [lista, completa, contagensServidor]);
  // dentro da lupa o título da aba é do BOARD, e a lista nem é carregada:
  // sobrescrevê-lo daria um número que a tela hospedeira não explica
  useTituloDaAba(embutido ? null : naoLidas);
  useAvisoDeChegada(embutido ? null : naoLidas);
  usePermissaoDeNotificacao(!embutido);
  const push = usePush(!embutido);

  // o "Responder" do push chega por `postMessage` do hub — e a origem é a trava
  usePonteDoHub(embutido, (id) => abrir(id));

  // ---- `?acao=` — o card do board pedindo um gesto ------------------------
  // Os ícones 📞 🎤 📎 do card abrem esta tela embutida já executando a ação. É
  // assim que o card os oferece SEM reimplementar WebRTC, gravador e upload:
  // quem executa é o dono deles, aqui (§50.1).
  const acaoFeita = useRef(false);
  useEffect(() => {
    if (!embutido || acaoFeita.current || !aberta) return;
    let acao: string | null = null;
    try { acao = new URLSearchParams(window.location.search).get("acao"); } catch {}
    if (!acao) return;
    // ligar espera a camada dinâmica chegar; anexo e áudio, o compositor
    if (acao === "ligar" && !ligacao) return;
    acaoFeita.current = true;
    // a thread ainda está pintando: abrir o seletor de arquivo ou o microfone
    // no meio disso deixa a tela piscando atrás do diálogo
    const t = setTimeout(() => {
      const conversa = lista.find((c) => c.cliente_id === aberta) ?? avulsa;
      if (acao === "ligar") ligacao?.ligar(aberta, nomeLimpo(conversa?.cliente ?? null));
      else gesto.current?.(acao as "audio" | "anexo");
    }, 350);
    return () => clearTimeout(t);
  }, [embutido, aberta, ligacao, lista, avulsa]);


  // ---- ENVIAR -------------------------------------------------------------
  //
  // A bolha aparece ANTES de o servidor confirmar. Se falhar, ela não some: vira
  // uma bolha com o motivo traduzido e um botão de reenviar — porque sumir é o
  // pior desfecho possível (a pessoa acha que mandou).
  const enviarTexto = useCallback(
    (texto: string, idExistente?: string) => {
      const id = abertaRef.current;
      if (!id) return;
      const tmp = idExistente ?? `tmp:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
      const otimista: Mensagem = {
        id: tmp,
        conteudo: texto,
        enviada_por: "operator",
        tipo: "mensagem",
        status: "wait",
        criada_em: new Date().toISOString(),
        midia_tipo: null, midia_mime: null, midia_nome: null,
        reacao: null, resposta_a: null, erro: null,
      };
      setMensagens((atual) => [...atual.filter((m) => m.id !== tmp), otimista]);
      setEnviando(true);

      fetch("/api/send-message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cliente_id: id, texto }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
          return j;
        })
        .then(() => {
          if (abertaRef.current !== id) return;
          // o servidor gravou: o incremental traz a linha de verdade (com id
          // da Meta e tique), e `juntar` remove a otimista
          apanharNovas();
          recarregarLista();
        })
        .catch((e) => {
          const motivo = String(e?.message ?? e);
          if (abertaRef.current === id) {
            setMensagens((atual) =>
              atual.map((m) => (m.id === tmp ? { ...m, status: "failed", erro: motivo } : m)),
            );
          }
          avisar("A mensagem não saiu.", {
            tom: "erro",
            acao: { rotulo: "Reenviar", fazer: () => enviarTexto(texto, tmp) },
          });
        })
        .finally(() => setEnviando(false));
    },
    [apanharNovas, recarregarLista, avisar],
  );

  const reenviar = useCallback(
    (m: Mensagem) => {
      if (!m.conteudo) return;
      setMensagens((atual) => atual.filter((x) => x.id !== m.id));
      enviarTexto(m.conteudo, m.id.startsWith("tmp:") ? m.id : undefined);
    },
    [enviarTexto],
  );

  // ---- TEMPLATE -----------------------------------------------------------
  const enviarTemplate = useCallback(
    (t: { template_id: string; nome: string; variaveis: string[]; texto: string }) => {
      const id = abertaRef.current;
      if (!id) return;
      setEnviando(true);
      fetch("/api/send-template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cliente_id: id,
          template_id: t.template_id,
          // só manda `variaveis` quando o template pede campos: a rota recusa
          // lista vazia em template de um campo só, e preenche o nome sozinha
          ...(t.variaveis.length ? { variaveis: t.variaveis } : {}),
        }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
          return j;
        })
        .then(() => {
          setTemplates(false);
          avisar(`Template "${t.nome}" enviado.`, { tom: "ok" });
          apanharNovas();
          recarregarLista();
        })
        .catch((e) => avisar(String(e?.message ?? e), { tom: "erro" }))
        .finally(() => setEnviando(false));
    },
    [apanharNovas, recarregarLista, avisar],
  );

  // ---- ARQUIVOS: sobem direto para o Storage, não pelo nosso servidor -----
  const mandarArquivos = useCallback(
    async (arquivos: File[], legenda: string) => {
      const id = abertaRef.current;
      if (!id || !arquivos.length) return;
      setEnviando(true);
      const r = await enviarArquivos(id, arquivos, legenda, setProgresso);
      setEnviando(false);
      if (r.pararTudo) avisar(r.pararTudo, { tom: "erro" });
      for (const f of r.falhas) avisar(`${f.nome}: ${f.razao}`, { tom: "erro" });
      if (r.enviados) {
        avisar(r.enviados === 1 ? "Arquivo enviado." : `${r.enviados} arquivos enviados.`, { tom: "ok" });
        apanharNovas();
        recarregarLista();
      }
    },
    [apanharNovas, recarregarLista, avisar],
  );

  const mandarLocal = useCallback(
    (indice: number) => {
      const id = abertaRef.current;
      if (!id) return;
      setEnviando(true);
      fetch("/api/chat/localizacao", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cliente_id: id, local: indice }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
        })
        .then(() => {
          avisar("Endereço enviado.", { tom: "ok" });
          apanharNovas();
        })
        .catch((e) => avisar(String(e?.message ?? e), { tom: "erro" }))
        .finally(() => setEnviando(false));
    },
    [apanharNovas, avisar],
  );

  // ---- NOTA INTERNA: não vai para a cliente, e por isso não é `mensagens` --
  const mandarNota = useCallback(
    (texto: string) => {
      const id = abertaRef.current;
      if (!id) return;
      fetch("/api/chat/notas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cliente_id: id, texto }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
          return j;
        })
        .then((j) => {
          if (abertaRef.current !== id) return;
          const nova = j?.nota ?? {
            id: Date.now(),
            cliente_id: id,
            autor: inicial.meu_usuario,
            texto,
            criada_em: new Date().toISOString(),
          };
          setNotas((n) => [...n, nova]);
        })
        .catch((e) => avisar(String(e?.message ?? e), { tom: "erro" }));
    },
    [avisar, inicial.meu_usuario],
  );

  const apagarNota = useCallback(
    (n: Nota) => {
      setNotas((atual) => atual.filter((x) => x.id !== n.id));
      fetch("/api/chat/notas", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {});
    },
    [],
  );

  // ---- FAVORITAR: otimista, porque é uma marca pessoal e barata ------------
  const favoritar = useCallback(() => {
    const id = abertaRef.current;
    if (!id) return;
    const atual = lista.find((c) => c.cliente_id === id)?.favorita ?? false;
    setLista((l) => l.map((c) => (c.cliente_id === id ? { ...c, favorita: !atual } : c)));
    fetch("/api/chat/favorito", {
      method: atual ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cliente_id: id }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        recarregarContagens();
      })
      .catch(() => {
        setLista((l) => l.map((c) => (c.cliente_id === id ? { ...c, favorita: atual } : c)));
        avisar("Não consegui favoritar.", { tom: "erro" });
      });
  }, [lista, recarregarContagens, avisar]);

  // ---- TRANSFERIR / PEGAR / DEVOLVER: tudo a mesma tabela append-only -----
  const transferir = useCallback(
    (para: string | null, observacao: string) => {
      const id = abertaRef.current;
      if (!id) return;
      setOcupado(true);
      fetch("/api/chat/transferir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cliente_id: id, ...(para ? { para } : { devolver: true }), observacao }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
        })
        .then(() => {
          setDialogo(null);
          avisar(para ? `Conversa transferida para ${para}.` : "Conversa devolvida para a fila.", { tom: "ok" });
          recarregarLista();
          // a thread guarda o registro da passagem, no ponto em que aconteceu
          fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(id)}`)
            .then((r) => r.json())
            .then((j) => abertaRef.current === id && setTransferencias(j.transferencias ?? []))
            .catch(() => {});
        })
        .catch((e) => avisar(String(e?.message ?? e), { tom: "erro" }))
        .finally(() => setOcupado(false));
    },
    [recarregarLista, avisar],
  );

  // pegar da fila = transferir de ninguém para mim, reusando a mesma tabela
  // (§21): o histórico de quem puxou sai de graça
  const pegar = useCallback(() => {
    if (!inicial.minha_carteira) {
      avisar("Você não tem carteira — use Transferir para designar alguém.", { tom: "erro" });
      return;
    }
    transferir(inicial.minha_carteira, "pegou da fila");
  }, [inicial.minha_carteira, transferir, avisar]);

  // ---- RESOLVER / REABRIR -------------------------------------------------
  const mudarStatus = useCallback(
    (status: "aberta" | "resolvida", motivo?: string) => {
      const id = abertaRef.current;
      if (!id) return;
      setOcupado(true);
      fetch("/api/chat/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cliente_id: id, status, ...(motivo ? { motivo } : {}) }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
        })
        .then(() => {
          setDialogo(null);
          setLista((l) =>
            l.map((c) => (c.cliente_id === id ? { ...c, status, motivo: motivo ?? null } : c)),
          );
          avisar(status === "resolvida" ? "Conversa resolvida." : "Conversa reaberta.", { tom: "ok" });
          recarregarContagens();
        })
        .catch((e) => avisar(String(e?.message ?? e), { tom: "erro" }))
        .finally(() => setOcupado(false));
    },
    [recarregarContagens, avisar],
  );

  // ---- ENCAMINHAR ---------------------------------------------------------
  const encaminhar = useCallback(
    (para: string) => {
      const m = encaminhando;
      if (!m) return;
      setOcupado(true);
      fetch("/api/chat/encaminhar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mensagem_id: m.id, para }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
        })
        .then(() => {
          setEncaminhando(null);
          avisar("Mensagem encaminhada.", { tom: "ok" });
          recarregarLista();
        })
        .catch((e) => avisar(String(e?.message ?? e), { tom: "erro" }))
        .finally(() => setOcupado(false));
    },
    [encaminhando, recarregarLista, avisar],
  );

  // ---- recortes e contadores ---------------------------------------------
  // Com a lista inteira em mãos, conta daqui (é de graça e fica exato mesmo
  // depois de a tela mexer em alguma conversa). Sem ela, valem os números que o
  // servidor calculou sobre tudo — nunca os da primeira página, que diriam
  // "3 não lidas" quando há 17.
  const contagens = useMemo<Record<Fila, number | null>>(() => {
    if (!completa) {
      const s = contagensServidor;
      return {
        todas: s ? s.todas : null,
        nao_lidas: s ? s.nao_lidas : null,
        favoritas: s ? s.favoritas : null,
        fila: s ? s.fila : null,
        resolvidas: s ? s.resolvidas : null,
      };
    }
    return {
      todas: lista.filter((c) => !c.na_fila && c.status !== "resolvida").length,
      nao_lidas: lista.filter((c) => c.nao_lida && !c.na_fila && c.status !== "resolvida").length,
      favoritas: lista.filter((c) => c.favorita).length,
      fila: lista.filter((c) => c.na_fila).length,
      resolvidas: lista.filter((c) => c.status === "resolvida").length,
    };
  }, [lista, completa, contagensServidor]);

  // ---- os três recortes que cruzam (§23.5) --------------------------------
  //
  // Cada um conta DENTRO do que os outros já escolheram. Sem isso o chip
  // promete 12 e a lista entrega 3 — e o número na tela passa a ser folclore.
  //
  // ⚠️ A FILA DE ESPERA escapa do filtro por consultor: conversa sem dono não
  // pertence a carteira nenhuma, e escondê-la ao escolher um consultor faria
  // sumir justamente o que qualquer um pode pegar.
  const passaVend = useCallback(
    (c: Conversa) => !recortes.vendedor || c.na_fila || c.vendedor === recortes.vendedor,
    [recortes.vendedor],
  );
  const passaLinha = useCallback(
    (c: Conversa) => !recortes.linha || c.linha_id === recortes.linha,
    [recortes.linha],
  );
  const passaEtapa = useCallback(
    (c: Conversa) => !recortes.etapa || c.etapa_board === recortes.etapa,
    [recortes.etapa],
  );

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const so = t.replace(/\D/g, "");
    return lista.filter((c) => {
      if (!passaVend(c) || !passaLinha(c) || !passaEtapa(c)) return false;
      const passaFila =
        fila === "todas"
          ? !c.na_fila && c.status !== "resolvida"
          : fila === "nao_lidas"
            ? c.nao_lida && !c.na_fila && c.status !== "resolvida"
            : fila === "favoritas"
              ? c.favorita
              : fila === "fila"
                ? c.na_fila
                : c.status === "resolvida";
      if (!passaFila) return false;
      if (!t) return true;
      const nome = String(c.cliente ?? "").toLowerCase();
      const tel = String(c.telefone ?? "").replace(/\D/g, "");
      return nome.includes(t) || (so.length >= 3 && tel.includes(so));
    });
  }, [lista, fila, busca, passaVend, passaLinha, passaEtapa]);

  // ---- quem aparece no seletor de consultor -------------------------------
  //
  // Carteira SEM conversa some: opção que filtra para o vazio só atrapalha.
  // ⚠️ Quem atende SEM carteira entra SEMPRE, tenha conversa ou não — e essa é
  // a exceção à regra, não um descuido. Carteira sem conversa é uma opção
  // morta; uma PESSOA é outra coisa: o supervisor procura por ela justamente
  // para saber se está com alguma coisa, e "não aparece na lista" responde isso
  // do jeito errado, dizendo que ela não existe (§23.5).
  const consultores = useMemo(() => {
    // vendedor já vê só a própria carteira (o servidor recorta): "Todos" e o
    // próprio nome seriam a mesma lista
    if (inicial.minha_carteira) return [];
    const cor = new Map(inicial.vendedores.map((v) => [v.slug, v.cor]));
    const comConversa = new Set(
      lista.filter((c) => !c.na_fila && c.vendedor && !c.vendedor.startsWith("u:")).map((c) => c.vendedor as string),
    );
    const daCasa = inicial.atendentes.map((a) => ({ endereco: a.endereco, nome: a.nome, cor: null as string | null }));
    const carteiras = [...comConversa].sort().map((slug) => ({
      endereco: slug,
      nome: slug.charAt(0).toUpperCase() + slug.slice(1),
      cor: cor.get(slug) ?? null,
    }));
    return [...carteiras, ...daCasa];
  }, [lista, inicial.vendedores, inicial.atendentes, inicial.minha_carteira]);

  // contadores cruzados: cada dimensão conta sobre a lista já filtrada pelas
  // OUTRAS duas (e pela fila, que é o recorte de cima)
  const contagensDosRecortes = useMemo(() => {
    const naFila = (c: Conversa) =>
      fila === "todas" ? !c.na_fila && c.status !== "resolvida"
      : fila === "nao_lidas" ? c.nao_lida && !c.na_fila && c.status !== "resolvida"
      : fila === "favoritas" ? c.favorita
      : fila === "fila" ? c.na_fila
      : c.status === "resolvida";

    const porConsultor = new Map<string, number>();
    const porLinha = new Map<string, number>();
    const porEtapa = new Map<string, number>();
    for (const c of lista) {
      if (!naFila(c)) continue;
      if (passaLinha(c) && passaEtapa(c) && c.vendedor) {
        porConsultor.set(c.vendedor, (porConsultor.get(c.vendedor) ?? 0) + 1);
      }
      if (passaVend(c) && passaEtapa(c) && c.linha_id) {
        porLinha.set(c.linha_id, (porLinha.get(c.linha_id) ?? 0) + 1);
      }
      if (passaVend(c) && passaLinha(c) && c.etapa_board) {
        porEtapa.set(c.etapa_board, (porEtapa.get(c.etapa_board) ?? 0) + 1);
      }
    }
    return { porConsultor, porLinha, porEtapa };
  }, [lista, fila, passaVend, passaLinha, passaEtapa]);

  // a da lista ganha (tem dono, não lida, status); a avulsa é a rede de
  // proteção para quem ainda não entrou na view materializada
  const conversaAberta = useMemo(
    () => lista.find((c) => c.cliente_id === aberta) ?? (avulsa?.cliente_id === aberta ? avulsa : null),
    [lista, aberta, avulsa],
  );

  return (
    <div className="v2 flex h-dvh min-h-0 flex-col overflow-hidden">
      <Ripple />
      <Snackbars avisos={avisos} fechar={fechar} />

      {/* ---- app bar ------------------------------------------------------
          Dentro da lupa do board ela NÃO aparece: ali a tela mostra uma
          conversa só, dentro de um quadro que já tem cabeçalho, e um segundo
          "Chat" com botão de voltar disputaria a navegação da página que a
          hospeda (§41.5). */}
      {!embutido && (
        <header className="flex shrink-0 items-center gap-3 bg-v2-vinho px-3 text-white shadow-e2 pt-[env(safe-area-inset-top)]">
          <div className="flex h-12 items-center gap-3">
            <a
              href="/"
              data-ripple
              className="grid size-9 place-items-center rounded-full text-white/90 hover:bg-white/10"
              aria-label="Voltar ao board"
              title="Board"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="m14 6-6 6 6 6" />
              </svg>
            </a>
            <span className="text-[15px] font-semibold tracking-tight">Chat</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              v2 · fase 4
            </span>
          </div>

          <span className="ml-auto flex items-center gap-2">
            {/* `null` = ainda não sabemos se há push, e nesse estado nada é
                desenhado: um botão que pisca e some ao descobrir que já estava
                ativo é pior que esperar meio segundo. */}
            {push.estado !== null && (
              <button
                data-ripple
                onClick={() => push.alternar().then((m) => m && avisar(m, { tom: push.estado ? "neutro" : "ok" }))}
                disabled={push.ocupado}
                aria-pressed={push.estado}
                title={push.estado ? "Notificações ligadas neste aparelho" : "Receber aviso com o app fechado"}
                className={[
                  "grid size-9 place-items-center rounded-full",
                  push.estado ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10",
                ].join(" ")}
              >
                <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" />
                  <path d="M10.5 18.5a1.8 1.8 0 0 0 3 0" />
                  {!push.estado && <path d="m4 4 16 16" />}
                </svg>
              </button>
            )}
            <span className="truncate text-[12px] text-white/80">
              {inicial.minha_carteira ? `carteira ${inicial.minha_carteira}` : inicial.meu_usuario}
            </span>
          </span>
        </header>
      )}

      {/* ---- as três regiões ---------------------------------------------- */}
      <div className="flex min-h-0 flex-1">
        {/* No embutido a coluna de lista NÃO É DESENHADA — nem escondida por
            CSS. A lupa mostra UMA conversa; buscar as ~4 mil para montar uma
            lista invisível seria o desperdício que a §15.1 corrigiu, e a busca
            e os contadores continuariam rodando atrás do quadro. É por isso
            também que ali o `?cliente=` é resolvido direto na thread. */}
        {!embutido && (
        <div
          className={[
            "min-h-0 w-full shrink-0 border-r border-v2-linha md:w-[320px] lg:w-[344px]",
            aberta ? "hidden md:block" : "block",
          ].join(" ")}
        >
          <ListaConversas
            conversas={visiveis}
            selecionada={aberta}
            fila={fila}
            busca={busca}
            carregando={carregandoLista}
            completa={completa}
            contagens={contagens}
            aoAbrir={abrir}
            // os três gestos que exigem a lista inteira. Fora deles, a sessão
            // custa a primeira página e mais nada.
            aoTrocarFila={(f) => {
              setFila(f);
              if (f !== "todas") setPrecisaCompleta(true);
            }}
            aoBuscar={(t) => {
              setBusca(t);
              if (t.trim().length >= 2) setPrecisaCompleta(true);
            }}
            aoChegarNoFim={() => setPrecisaCompleta(true)}
            presentes={presentes}
            recortes={recortes}
            aoMudarRecortes={setRecortes}
            filtrosAbertos={filtrosAbertos}
            // abrir os filtros é o gesto que manda buscar a lista inteira COM
            // etapa e número — e é o único momento em que essa conta é paga
            aoAbrirFiltros={() => {
              setFiltrosAbertos((v) => !v);
              setPrecisaCompleta(true);
              setPrecisaExtras(true);
            }}
            consultores={consultores}
            linhas={inicial.linhas}
            contaPorConsultor={contagensDosRecortes.porConsultor}
            contaPorLinha={contagensDosRecortes.porLinha}
            contaPorEtapa={contagensDosRecortes.porEtapa}
          />
        </div>
        )}

        <div className={["min-h-0 min-w-0 flex-1", aberta || embutido ? "block" : "hidden md:block"].join(" ")}>
          <TelaConversa
            conversa={conversaAberta}
            mensagens={mensagens}
            notas={notas}
            transferencias={transferencias}
            citadas={citadas}
            temMais={temMais}
            carregando={carregandoThread}
            carregandoAntigas={carregandoAntigas}
            aoCarregarAntigas={carregarAntigas}
            aoVoltar={fechar_}
            aoAbrirContato={() => setPainelAberto((v) => !v)}
            painelAberto={painelAberto}
            enviando={enviando}
            progresso={
              progresso
                ? `enviando ${progresso.feito + 1} de ${progresso.total}${progresso.pct != null ? ` · ${progresso.pct}%` : ""} — ${progresso.nome}`
                : null
            }
            locais={locais}
            aoEnviar={enviarTexto}
            aoTemplate={() => setTemplates(true)}
            aoReenviar={reenviar}
            aoArquivos={mandarArquivos}
            aoLocal={mandarLocal}
            aoNota={mandarNota}
            aoApagarNota={apagarNota}
            aoEncaminhar={setEncaminhando}
            aoFavoritar={favoritar}
            aoTransferir={() => setDialogo("transferir")}
            aoResolver={() => setDialogo("resolver")}
            aoReabrir={() => mudarStatus("aberta")}
            aoPegar={pegar}
            aoErro={(msg) => avisar(msg, { tom: "erro" })}
            ligacoes={ligacoes}
            podeLigar={podeLigar}
            aoLigar={
              ligacao && aberta
                ? () => ligacao.ligar(aberta, nomeLimpo(conversaAberta?.cliente ?? null))
                : null
            }
            ligando={!!ligacao && (ligacao.ocupado || ligacao.emChamada)}
            presentes={aberta ? presentes[aberta] : undefined}
            aoRegistrarGesto={registrarGesto}
            semVoltar={embutido}
          />
        </div>

        {/* desktop largo: o ERP é COLUNA, ao lado da conversa */}
        {conversaAberta && painelAberto && (
          <div className="hidden min-h-0 w-[330px] shrink-0 xl:block">
            <PainelContato
              conversa={conversaAberta}
              aoFechar={() => setPainelAberto(false)}
              aoAviso={(t, ok) => { avisar(t, { tom: ok ? "ok" : "erro" }); if (ok) recarregarLista(); }}
            />
          </div>
        )}
      </div>

      {/* celular e telas médias: o mesmo painel sobe de baixo. No chat antigo
          ele simplesmente não existe abaixo de 768 px — e é o diferencial
          contra o RD (achado 3 do laudo de UX). */}
      {conversaAberta && painelAberto && (
        <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/30 xl:hidden" onClick={() => setPainelAberto(false)}>
          <div
            className="entrar max-h-[82%] overflow-hidden rounded-t-3xl bg-v2-superficie shadow-e3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-v2-linha-forte" />
            </div>
            <div className="h-[72vh]">
              <PainelContato
              conversa={conversaAberta}
              aoFechar={() => setPainelAberto(false)}
              aoAviso={(t, ok) => { avisar(t, { tom: ok ? "ok" : "erro" }); if (ok) recarregarLista(); }}
            />
            </div>
          </div>
        </div>
      )}

      {dialogo === "transferir" && conversaAberta && (
        <Transferir
          conversa={conversaAberta}
          vendedores={inicial.vendedores}
          ocupado={ocupado}
          aoFechar={() => setDialogo(null)}
          aoConfirmar={transferir}
        />
      )}

      {dialogo === "resolver" && (
        <Resolver ocupado={ocupado} aoFechar={() => setDialogo(null)} aoConfirmar={(m) => mudarStatus("resolvida", m)} />
      )}

      {encaminhando && (
        <Encaminhar
          trecho={encaminhando.conteudo ?? ""}
          conversas={lista.filter((c) => c.cliente_id !== aberta)}
          ocupado={ocupado}
          aoFechar={() => setEncaminhando(null)}
          aoConfirmar={encaminhar}
        />
      )}

      {/* A camada de ligação fica montada SEMPRE (é ela que faz a campainha
          tocar quando a cliente liga), mas chega depois da primeira pintura. */}
      <CamadaLigacao
        sessao={{ role: inicial.minha_carteira ? "vendedor" : "admin", carteira: inicial.minha_carteira }}
        aoMudar={() => {
          // a ligação virou um marco na thread e mexeu na lista
          const id = abertaRef.current;
          if (id) {
            fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(id)}`)
              .then((r) => r.json())
              .then((j) => abertaRef.current === id && setLigacoes(j.ligacoes ?? []))
              .catch(() => {});
          }
          recarregarLista();
        }}
        aoPublicar={publicarLigacao}
      />

      {templates && conversaAberta && (
        <Templates
          primeiroNome={nomeLimpo(conversaAberta.cliente).split(/\s+/)[0] ?? ""}
          enviando={enviando}
          aoFechar={() => setTemplates(false)}
          aoEnviar={enviarTemplate}
        />
      )}
    </div>
  );
}
