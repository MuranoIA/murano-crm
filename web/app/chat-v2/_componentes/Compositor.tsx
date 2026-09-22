"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGravador } from "./audio";

// ---------------------------------------------------------------------------
// A CAIXA DE TEXTO — e a razão principal de o chat ter sido reconstruído.
//
// No chat antigo o texto mora em `useState("")` dentro do componente de 5.400
// linhas (`app/chat/page.tsx:1382`): cada tecla redesenha lista, conversa e
// painel. A fase 0 mediu 1 long task de até 136 ms por 20 teclas, com a pior
// interação em 272 ms numa das rodadas.
//
// Aqui o texto NÃO SOBE. Ele nasce e morre neste componente; o pai só recebe o
// evento "enviar". Digitar não pode custar nada ao resto da tela — medido
// depois: zero long task.
// ---------------------------------------------------------------------------

export type Resposta = { id: number; atalho: string; texto: string; carteira: string | null };
/** a rota (a mesma do chat de hoje) chama o texto de `corpo` */
const emResposta = (r: any): Resposta => ({
  id: Number(r?.id),
  atalho: String(r?.atalho ?? ""),
  texto: String(r?.corpo ?? r?.texto ?? ""),
  carteira: r?.carteira ?? null,
});

/** Os três gestos que o compositor expõe para fora. */
/** Os gestos que vêm de FORA do compositor. `escrever` põe um texto na caixa
 *  sem enviar (o "Pedir os dados" da ficha): o texto continua morando aqui e
 *  não sobe de componente — quem chama só entrega a frase. */
export type Gesto = (qual: "audio" | "anexo" | "soltar" | "escrever", arquivos?: File[], texto?: string) => void;

export function Compositor({
  podeEnviar,
  janelaAberta,
  enviando,
  progresso,
  locais,
  aoEnviar,
  aoTemplate,
  aoArquivos,
  aoLocal,
  aoNota,
  aoErro,
  aoRegistrarGesto,
  citando,
  aoCancelarCitacao,
}: {
  podeEnviar: boolean;
  janelaAberta: boolean;
  enviando: boolean;
  /** "2 de 3 · 45%" enquanto sobe arquivo; null quando não há envio em curso */
  progresso: string | null;
  locais: { nome: string; endereco?: string }[];
  aoEnviar: (texto: string) => void;
  aoTemplate: () => void;
  aoArquivos: (arquivos: File[], legenda: string) => void;
  aoLocal: (indice: number) => void;
  aoNota: (texto: string) => void;
  aoErro: (msg: string) => void;
  /** publica para cima os gestos que só existem aqui dentro: gravar, anexar e
   *  receber arquivos soltos na conversa. É o que permite o `?acao=` da lupa do
   *  board disparar o microfone (§50.1) e o arrasto acontecer sobre a THREAD
   *  inteira sem que o texto suba de componente — quem manda continua sendo
   *  este componente, com a MESMA função do clipe e do colar. */
  aoRegistrarGesto?: (fn: Gesto | null) => void;
  /** a mensagem que esta resposta está citando, e o trecho a mostrar */
  citando?: { id: string; trecho: string; minha: boolean } | null;
  aoCancelarCitacao?: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [nota, setNota] = useState(false);
  const [clipe, setClipe] = useState(false);
  const [respostas, setRespostas] = useState<Resposta[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const campo = useRef<HTMLTextAreaElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const { gravando, segundos, gravar, parar } = useGravador((f) => aoArquivos([f], ""), aoErro);

  // ---- UM caminho só para todo arquivo que entra ------------------------
  // Clipe, colar e arrastar terminam aqui. Três cópias divergiriam no primeiro
  // ajuste — e a divergência apareceria como "pelo clipe vai com legenda, pelo
  // arrasto vai sem".
  const mandar = useCallback(
    (fs: File[]) => {
      if (!fs.length) return;
      const legenda = texto.trim();
      aoArquivos(fs, legenda);
      if (legenda) setTexto("");
    },
    [aoArquivos, texto],
  );

  useEffect(() => {
    if (!aoRegistrarGesto) return;
    aoRegistrarGesto((qual, fs, t) => {
      if (qual === "audio") void gravar();
      else if (qual === "soltar") mandar(fs ?? []);
      else if (qual === "escrever") {
        // sem janela não há mensagem livre: escrever na caixa um texto que não
        // pode sair seria convidar a um envio que falha
        if (!janelaAberta) {
          aoErro("A janela de 24h está fechada — só um template reabre a conversa.");
          return;
        }
        setNota(false);
        setTexto(t ?? "");
        // depois do render, para o cursor ir ao FIM do texto que acabou de entrar
        setTimeout(() => {
          const el = campo.current;
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        }, 20);
      }
      else arquivo.current?.click();
    });
    return () => aoRegistrarGesto(null);
  }, [aoRegistrarGesto, gravar, mandar, janelaAberta, aoErro]);

  // cresce até ~5 linhas e depois rola por dentro.
  // ⚠️ `height = "0px"` antes de ler o `scrollHeight`: com "auto" o navegador
  // devolve o valor anterior e a caixa nunca encolhe (§51 do CLAUDE.md).
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [texto]);

  // as respostas rápidas são buscadas UMA vez, na primeira vez que a pessoa
  // digita "/" — quem nunca usa o recurso não paga por ele
  const carregarRespostas = useCallback(() => {
    if (respostas) return;
    fetch("/api/chat/respostas")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      // ⚠️ A rota devolve `corpo`, não `texto` (é a mesma do chat de hoje, que
      // lê `corpo`). Sem este mapa, colar uma resposta punha `undefined` na
      // caixa, e filtrar por um trecho que não batesse no atalho chamava
      // `.toLowerCase()` em `undefined` — a tela inteira caía.
      .then((j) => setRespostas((j.respostas ?? []).map(emResposta)))
      .catch(() => setRespostas([]));
  }, [respostas]);

  // ---- CRIAR resposta rápida (paridade, lacuna 12) ------------------------
  // O chat de hoje salva o texto da caixa como resposta nova. Aqui o mesmo
  // gesto mora no rodapé do menu do "/": quem procurou um atalho e não achou
  // está exatamente no momento de criá-lo. Vendedor cria a PESSOAL; admin e
  // home, a da casa — quem decide é o servidor, pela sessão.
  const [criando, setCriando] = useState<{ atalho: string; texto: string } | null>(null);
  const [salvandoResp, setSalvandoResp] = useState(false);
  function salvarResposta() {
    if (!criando || salvandoResp) return;
    const atalho = criando.atalho.replace(/^\//, "").trim();
    const corpo = criando.texto.trim();
    if (!atalho || !corpo) return;
    setSalvandoResp(true);
    fetch("/api/chat/respostas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atalho, corpo, titulo: corpo.slice(0, 40) }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
        return j;
      })
      .then((j) => {
        const nova = emResposta(j.resposta);
        setRespostas((rs) => [...(rs ?? []), nova].sort((a, b) => a.atalho.localeCompare(b.atalho)));
        setCriando(null);
        // a resposta recém-criada já vai para a caixa: foi para usar que ela nasceu
        setTexto(nova.texto);
        setMenu(false);
        campo.current?.focus();
      })
      .catch((e) => aoErro(`Não consegui salvar a resposta: ${e?.message ?? e}`))
      .finally(() => setSalvandoResp(false));
  }

  const filtro = menu ? texto.slice(1).toLowerCase() : "";
  // fechar o menu desfaz um formulário de criação pela metade
  useEffect(() => { if (!menu) setCriando(null); }, [menu]);
  const sugestoes = (respostas ?? []).filter(
    (r) => !filtro || r.atalho.toLowerCase().includes(filtro) || r.texto.toLowerCase().includes(filtro),
  );

  useEffect(() => setMarcado(0), [filtro, menu]);

  function mudou(v: string) {
    setTexto(v);
    const abriu = v.startsWith("/");
    if (abriu && !menu) carregarRespostas();
    setMenu(abriu);
  }

  // escolher "responder" precisa levar o cursor para a caixa: sem isso a
  // pessoa vê o trecho aparecer e ainda tem de clicar no campo para escrever
  useEffect(() => {
    if (citando) campo.current?.focus();
  }, [citando?.id]);

  function colar(r: Resposta) {
    setTexto(r.texto);
    setMenu(false);
    campo.current?.focus();
  }

  function enviar() {
    const t = texto.trim();
    if (!t || !podeEnviar || enviando) return;
    // a NOTA não vai para a cliente. É o mesmo campo com outro destino — e a
    // caixa muda de cor para isso ficar óbvio ANTES de alguém escrever.
    if (nota) aoNota(t);
    else aoEnviar(t);
    // a caixa esvazia NA HORA: quem manda já está pensando na próxima frase, e
    // esperar o servidor para limpar faria a mensagem parecer não enviada
    setTexto("");
    setMenu(false);
  }

  function tecla(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menu && sugestoes.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMarcado((m) => (m + 1) % sugestoes.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMarcado((m) => (m - 1 + sugestoes.length) % sugestoes.length); return; }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); colar(sugestoes[marcado]); return; }
      if (e.key === "Escape") { setMenu(false); return; }
    }
    // Enter envia, Shift+Enter quebra linha — o que todo mundo já espera de um
    // chat. No celular o Enter do teclado virtual quebra linha, e quem manda é
    // o botão: `isComposing` evita cortar a palavra de quem usa teclado com
    // composição (acentos em alguns teclados Android).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar();
    }
  }

  const iconeBotao = "grid size-10 shrink-0 place-items-center rounded-full";

  return (
    <div className="relative shrink-0 border-t border-v2-linha bg-v2-superficie px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {/* ---- respostas rápidas ------------------------------------------- */}
      {menu && (
        <div className="absolute inset-x-3 bottom-[calc(100%-4px)] z-10 max-h-64 overflow-y-auto rounded-xl bg-v2-superficie p-1 shadow-e3 ring-1 ring-v2-linha">
          {respostas === null ? (
            <p className="px-3 py-2 text-[13px] text-v2-tinta-fraca">carregando…</p>
          ) : sugestoes.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-v2-tinta-fraca">Nenhuma resposta rápida com esse atalho.</p>
          ) : (
            !criando && sugestoes.map((r, i) => (
              <button
                key={r.id}
                data-ripple
                onMouseEnter={() => setMarcado(i)}
                onClick={() => colar(r)}
                className={[
                  "block w-full rounded-lg px-3 py-2 text-left",
                  i === marcado ? "bg-v2-azul-claro" : "hover:bg-v2-superficie-2",
                ].join(" ")}
              >
                <span className="text-[13px] font-semibold text-v2-azul">/{r.atalho}</span>
                <span className="ml-2 text-[10px] uppercase tracking-wide text-v2-tinta-fraca">
                  {r.carteira ? "pessoal" : "da casa"}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-v2-tinta-fraca">{r.texto}</span>
              </button>
            ))
          )}
          {respostas !== null && (
            criando ? (
              <div className="border-t border-v2-linha p-2">
                <input
                  autoFocus
                  value={criando.atalho}
                  onChange={(e) => setCriando({ ...criando, atalho: e.target.value.replace(/[^a-zA-Z0-9/]/g, "") })}
                  placeholder="atalho (ex.: pix)"
                  aria-label="Atalho da resposta"
                  className="h-9 w-full rounded-lg border border-v2-linha-forte px-2.5 text-[13.5px] focus:border-v2-azul focus:outline-none"
                />
                <textarea
                  value={criando.texto}
                  onChange={(e) => setCriando({ ...criando, texto: e.target.value })}
                  rows={3}
                  placeholder="O texto que vai para a caixa"
                  aria-label="Texto da resposta"
                  className="mt-1.5 w-full resize-none rounded-lg border border-v2-linha-forte px-2.5 py-1.5 text-[13.5px] focus:border-v2-azul focus:outline-none"
                />
                <div className="mt-1 flex justify-end gap-2">
                  <button data-ripple onClick={() => setCriando(null)} className="rounded-full px-3 py-1 text-[13px] text-v2-tinta-fraca">
                    Cancelar
                  </button>
                  <button
                    data-ripple
                    disabled={salvandoResp || !criando.atalho.replace("/", "").trim() || !criando.texto.trim()}
                    onClick={salvarResposta}
                    className="rounded-full bg-v2-azul px-3 py-1 text-[13px] font-semibold text-white disabled:bg-v2-linha-forte"
                  >
                    {salvandoResp ? "salvando…" : "Salvar"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                data-ripple
                onClick={() => setCriando({ atalho: texto.slice(1).trim(), texto: "" })}
                className="mt-1 block w-full rounded-lg border-t border-v2-linha px-3 py-2 text-left text-[13px] font-medium text-v2-azul hover:bg-v2-superficie-2"
              >
                ＋ Nova resposta rápida{filtro ? ` /${texto.slice(1).trim()}` : ""}
              </button>
            )
          )}
        </div>
      )}

      {/* ---- menu do clipe ------------------------------------------------ */}
      {clipe && (
        <div className="absolute bottom-[calc(100%-4px)] left-3 z-10 w-72 overflow-hidden rounded-xl bg-v2-superficie p-1 shadow-e3 ring-1 ring-v2-linha">
          <button
            data-ripple
            onClick={() => { setClipe(false); arquivo.current?.click(); }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-v2-superficie-2"
          >
            <span aria-hidden className="text-v2-azul">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 16V6a2 2 0 0 1 2-2h9l5 5v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
                <path d="M14 4v6h6" />
              </svg>
            </span>
            <span className="text-[14px]">Arquivo, foto ou vídeo</span>
          </button>

          {/* localização por ENDEREÇO SALVO, não pela posição do navegador: a
              cliente pergunta onde fica a loja, e dentro de iframe a
              geolocalização seria recusada sem prompt (§49.1) */}
          {locais.length === 0 ? (
            <p className="px-3 py-2 text-[12px] leading-4 text-v2-tinta-fraca">
              Nenhum endereço cadastrado — o administrador cadastra em Administração → Mecanismos.
            </p>
          ) : (
            locais.map((l, i) => (
              <button
                key={i}
                data-ripple
                onClick={() => { setClipe(false); aoLocal(i); }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-v2-superficie-2"
              >
                <span aria-hidden className="text-v2-azul">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
                    <circle cx="12" cy="10" r="2.5" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px]">{l.nome}</span>
                  {l.endereco && <span className="block truncate text-[12px] text-v2-tinta-fraca">{l.endereco}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <input
        ref={arquivo}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = ""; // permite escolher o MESMO arquivo de novo
          mandar(fs);
        }}
      />

      {/* ---- respondendo a uma mensagem ------------------------------------
          Fica ACIMA da caixa, como no WhatsApp: o trecho tem de estar visível
          enquanto se escreve, senão a pessoa esquece a que está respondendo e
          a citação vira ruído em vez de contexto. */}
      {citando && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border-l-[3px] border-v2-azul bg-v2-superficie-2 px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-v2-azul">
              respondendo {citando.minha ? "você" : "a cliente"}
            </span>
            <span className="line-clamp-2 break-words text-[12.5px] leading-4 text-v2-tinta-fraca">
              {citando.trecho}
            </span>
          </span>
          {aoCancelarCitacao && (
            <button
              data-ripple
              onClick={aoCancelarCitacao}
              title="Não responder a esta mensagem"
              aria-label="Cancelar a citação"
              className="grid size-7 shrink-0 place-items-center rounded-full text-v2-tinta-fraca hover:bg-v2-superficie"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* ---- o que está subindo ------------------------------------------- */}
      {progresso && (
        <p className="mb-2 flex items-center gap-2 rounded-lg bg-v2-azul-claro px-3 py-1.5 text-[12.5px] text-v2-azul">
          <span className="size-1.5 animate-pulse rounded-full bg-v2-azul" aria-hidden />
          {progresso}
        </p>
      )}

      {/* ---- gravando ------------------------------------------------------ */}
      {gravando && (
        <div className="mb-2 flex items-center gap-3 rounded-2xl bg-v2-erro-claro px-3 py-2">
          <span className="size-2.5 animate-pulse rounded-full bg-v2-erro" aria-hidden />
          <span className="flex-1 text-[13px] tabular-nums text-v2-erro">
            Gravando… {String(Math.floor(segundos / 60)).padStart(2, "0")}:{String(segundos % 60).padStart(2, "0")}
          </span>
          <button data-ripple onClick={() => parar(true)} className="rounded-lg px-2 py-1 text-[13px] text-v2-tinta-fraca">
            Cancelar
          </button>
          <button
            data-ripple
            onClick={() => parar(false)}
            className="rounded-full bg-v2-azul px-3 py-1.5 text-[13px] font-semibold text-white"
          >
            Enviar áudio
          </button>
        </div>
      )}

      {/* ---- a janela fechada troca a caixa pelo caminho que funciona ------
          ...mas a NOTA INTERNA continua possível: ela não vai para a cliente,
          então a janela de 24h não tem nada a ver com ela. */}
      {!janelaAberta && !nota ? (
        <div className="flex items-center gap-2 rounded-2xl bg-v2-laranja-claro px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[12.5px] leading-4 text-v2-laranja">
            Passaram-se mais de 24h desde a última mensagem dela. Só um template reabre a conversa.
          </p>
          <button
            data-ripple
            onClick={() => setNota(true)}
            title="Escrever uma nota interna (não vai para a cliente)"
            className="shrink-0 rounded-full px-2 py-1.5 text-[13px] text-v2-laranja hover:bg-white/60"
          >
            Nota
          </button>
          <button
            data-ripple
            onClick={aoTemplate}
            className="shrink-0 rounded-full bg-v2-laranja px-3 py-1.5 text-[13px] font-semibold text-white"
          >
            Template
          </button>
        </div>
      ) : (
        <div
          className={[
            "flex items-end gap-1 rounded-2xl border px-2 py-1.5",
            nota
              ? "border-amber-300 bg-amber-50 focus-within:border-amber-400"
              : "border-v2-linha-forte bg-v2-superficie focus-within:border-v2-azul",
          ].join(" ")}
        >
          <button
            data-ripple
            onClick={() => setNota((v) => !v)}
            aria-pressed={nota}
            title={nota ? "Voltar a escrever para a cliente" : "Nota interna — não vai para a cliente"}
            className={[iconeBotao, nota ? "bg-amber-200 text-amber-900" : "text-v2-tinta-fraca hover:bg-v2-superficie-2"].join(" ")}
            aria-label="Nota interna"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 4h14v11l-5 5H5V4Z" />
              <path d="M19 15h-5v5" />
            </svg>
          </button>

          {!nota && (
            <>
              <button
                data-ripple
                onClick={() => setClipe((v) => !v)}
                aria-pressed={clipe}
                title="Anexar arquivo ou enviar um endereço"
                className={[iconeBotao, "text-v2-tinta-fraca hover:bg-v2-superficie-2"].join(" ")}
                aria-label="Anexar"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M21 11.5 12.5 20a5 5 0 1 1-7-7l8-8a3.5 3.5 0 1 1 5 5l-8 8a2 2 0 1 1-3-3l7.5-7.5" />
                </svg>
              </button>

              <button
                data-ripple
                onClick={aoTemplate}
                title="Enviar um template"
                className="hidden size-10 shrink-0 place-items-center rounded-full text-v2-tinta-fraca hover:bg-v2-superficie-2 sm:grid"
                aria-label="Template"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5h16v11H8l-4 4V5Z" />
                </svg>
              </button>
            </>
          )}

          <textarea
            ref={campo}
            rows={1}
            value={texto}
            onChange={(e) => mudou(e.target.value)}
            onKeyDown={tecla}
            // COLAR ARQUIVO (Ctrl+V de um print, por exemplo). A guarda é
            // obrigatória: sem ela, colar TEXTO — que é o uso comum do Ctrl+V
            // aqui — pararia de funcionar.
            onPaste={(e) => {
              const fs = Array.from(e.clipboardData?.files ?? []);
              if (!fs.length) return; // colagem de texto segue o caminho normal
              e.preventDefault();
              mandar(fs);
            }}
            disabled={!podeEnviar}
            // ⚠️ nada de placeholder comprido: o `scrollHeight` de um textarea
            // VAZIO conta a altura do placeholder, e um texto de duas linhas faz
            // a caixa nunca voltar ao tamanho de uma linha (§51).
            placeholder={nota ? "Nota interna" : "Mensagem"}
            title="Enter envia · Shift+Enter quebra linha · / abre as respostas rápidas"
            className="max-h-[120px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 leading-5 outline-none placeholder:text-v2-tinta-fraca disabled:opacity-60"
          />

          {/* microfone quando não há texto, enviar quando há: é o gesto que todo
              mundo já conhece, e economiza um botão numa barra que no celular
              tem 360 px para dividir */}
          {!nota && !texto.trim() ? (
            <button
              data-ripple
              onClick={() => (gravando ? parar(false) : gravar())}
              disabled={!podeEnviar}
              title="Gravar áudio"
              className={[iconeBotao, "text-v2-tinta-fraca hover:bg-v2-superficie-2 disabled:opacity-50"].join(" ")}
              aria-label="Gravar áudio"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
          ) : (
            <button
              data-ripple
              onClick={enviar}
              disabled={!podeEnviar || !texto.trim() || enviando}
              title={nota ? "Salvar nota" : "Enviar"}
              className={[
                iconeBotao,
                "text-white transition-colors disabled:bg-v2-linha-forte disabled:text-white/70",
                nota ? "bg-amber-600" : "bg-v2-azul",
              ].join(" ")}
              aria-label={nota ? "Salvar nota" : "Enviar"}
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12 20 4l-7 16-2.5-6.5L4 12Z" />
              </svg>
            </button>
          )}
        </div>
      )}

      {nota && (
        <p className="mt-1.5 text-center text-[11.5px] text-amber-700">
          Isto fica só para a equipe — a cliente não vê.
        </p>
      )}
    </div>
  );
}
