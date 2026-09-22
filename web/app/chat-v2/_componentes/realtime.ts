"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// O QUE O POSTGRES AVISA — num socket só.
//
// Dois canais, um cliente: `board` (mensagem nova ou tique que mudou) e
// `chat-presenca` (quem está em qual conversa). Dois `createBrowserClient`
// abririam dois websockets para o mesmo servidor, e o chat antigo já resolve
// assim — um cliente, dois canais.
//
// ⚠️ Os dois canais são PÚBLICOS e nada de identificável entra neles (§15.4). O
// `board` leva `{carteira}`; a presença leva um RÓTULO de exibição e um id de
// aba, nunca o e-mail.
//
// Sem Realtime (rede bloqueando websocket, chave ausente) nada quebra: o poll
// de 60 s da Casca cobre, mais devagar, e a presença simplesmente não aparece.
// ---------------------------------------------------------------------------

export function useRealtimeDoChat(opts: {
  minhaCarteira: string | null;
  /** como eu apareço para os outros. Vazio = não publico presença. */
  meuRotulo: string;
  /** a conversa que ESTOU olhando agora (null = nenhuma) */
  conversaAberta: string | null;
  /** chegou novidade nesta carteira: a bolha entra na hora */
  aoChegarMensagem: () => void;
  /** ...e a lista (cara) se refaz depois, coalescida */
  aoMudarLista: () => void;
  /** a lupa do board não carrega lista nenhuma: nela a recarga cara não vale */
  semLista?: boolean;
}) {
  const { minhaCarteira, meuRotulo, conversaAberta, semLista } = opts;

  // espelhos: os callbacks mudam a cada render do pai, e se entrassem nas
  // dependências o canal se reinscreveria a cada render — uma tempestade de
  // websockets em vez de uma inscrição
  const aoChegar = useRef(opts.aoChegarMensagem);
  aoChegar.current = opts.aoChegarMensagem;
  const aoLista = useRef(opts.aoMudarLista);
  aoLista.current = opts.aoMudarLista;

  const [presentes, setPresentes] = useState<Record<string, string[]>>({});
  const canalPresenca = useRef<any>(null);

  // id DESTA aba. É a chave de presença: sem ela, abrir o chat no PC e no
  // celular faria um registro derrubar o outro.
  const idDaAba = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()),
  );

  // a conversa aberta, lida na hora de publicar (e não como dependência: o
  // canal não pode ser refeito a cada clique na lista)
  const abertaRef = useRef(conversaAberta);
  abertaRef.current = conversaAberta;

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return;

    let cancelado = false;
    let board: any = null;
    let presenca: any = null;
    let balde: any = null;

    (async () => {
      try {
        const { createBrowserClient } = await import("@supabase/ssr");
        if (cancelado) return;
        const supa = createBrowserClient(url, anon);

        board = supa
          .channel("board")
          .on("broadcast", { event: "mudou" }, (msg: any) => {
            const cart = msg?.payload?.carteira ?? msg?.payload?.payload?.carteira ?? null;
            if (cart && minhaCarteira && cart !== minhaCarteira) return;
            // a bolha entra na hora; a lista (cara) espera um balde de 1,2 s,
            // senão uma rajada de dez mensagens vira dez recargas empilhadas
            aoChegar.current();
            if (semLista) return;
            if (!balde) {
              balde = setTimeout(() => {
                balde = null;
                aoLista.current();
              }, 1200);
            }
          })
          .subscribe();

        // ---- PRESENÇA (anti-colisão) -------------------------------------
        // Um canal para o time inteiro: cada aba publica em qual conversa está.
        // Com ~7 pessoas isso é barato; um canal por conversa exigiria entrar e
        // sair a cada clique na lista.
        if (!meuRotulo) return;
        presenca = supa.channel("chat-presenca", { config: { presence: { key: idDaAba.current } } });

        const recalcular = () => {
          const estado = presenca.presenceState() as Record<string, any[]>;
          const porConversa: Record<string, string[]> = {};
          for (const metas of Object.values(estado)) {
            for (const m of metas as any[]) {
              // ⚠️ filtra pelo RÓTULO, não pela chave da aba: senão a minha
              // segunda aba (o celular ao lado do PC) apareceria como se fosse
              // outra pessoa dentro da conversa
              if (!m?.cliente_id || !m?.rotulo || m.rotulo === meuRotulo) continue;
              const lista = (porConversa[m.cliente_id] ??= []);
              if (!lista.includes(m.rotulo)) lista.push(m.rotulo);
            }
          }
          setPresentes(porConversa);
        };

        presenca
          .on("presence", { event: "sync" }, recalcular)
          .on("presence", { event: "join" }, recalcular)
          .on("presence", { event: "leave" }, recalcular)
          .subscribe((status: string) => {
            if (status !== "SUBSCRIBED") return;
            canalPresenca.current = presenca;
            // publica onde estou AGORA: pode já haver conversa aberta (o link
            // do board, o push, o F5 dentro de um atendimento)
            presenca.track({ rotulo: meuRotulo, cliente_id: abertaRef.current });
          });
      } catch {
        /* sem Realtime: o poll de 60 s cobre e a presença não aparece */
      }
    })();

    return () => {
      cancelado = true;
      if (balde) clearTimeout(balde);
      try { board?.unsubscribe(); } catch {}
      try { presenca?.unsubscribe(); } catch {}
      canalPresenca.current = null;
    };
  }, [minhaCarteira, meuRotulo, semLista]);

  // republica sempre que troco de conversa (ou fecho a thread)
  useEffect(() => {
    const c = canalPresenca.current;
    if (!c || !meuRotulo) return;
    try { c.track({ rotulo: meuRotulo, cliente_id: conversaAberta }); } catch {}
  }, [conversaAberta, meuRotulo]);

  return presentes;
}
