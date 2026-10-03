"use client";

import { useCallback, useEffect, useState } from "react";
import type { Atendente, CampanhaResumo, Disparo as DisparoAnterior, PainelInicial } from "./_dados/painel";
import { Disparo } from "./Disparo";
import { Vazio } from "./Vazio";
import { BOTAO_CONTORNO, CAMPO, CHIP, ROTULO } from "./estilo";

type Campanha = CampanhaResumo;
type Alvo = {
  cliente_id: string; nome: string | null; codcli: number | null; rca: number | null;
  carteira_origem: string | null; enviado_em: string | null; respondeu_em: string | null;
  atendente: string | null; distribuido_em: string | null; motivo: string | null;
};

const dataHora = (s: string | null) =>
  s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Belem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const nomeDoEndereco = (e: string, lista: Atendente[]) =>
  lista.find((a) => a.endereco === e)?.nome ?? (e.startsWith("u:") ? e.slice(2).split("@")[0] : e);

// ---------------------------------------------------------------------------
// CAMPANHA: distribuir em rodízio quem responder ao disparo (demanda #52)
//
// ⚠️ ESTA TELA NÃO DISPARA, e diz isso logo no alto. O disparo continua em
// Administração › Templates, onde já tem prévia de quem recebe, motivos de
// corte, anti-repetição, custo e upload de planilha. Aqui a campanha se prende
// a um disparo QUE JÁ ACONTECEU — que foi o que o próprio dono sugeriu no fim
// do pedido ("selecionar o disparo ocorrido hoje às xx horas").
//
// Rebater aquela tela aqui criaria duas telas de disparo, e elas divergiriam na
// primeira mudança — o defeito que a §27.4 registrou com dois módulos de nomes
// parecidos, agora com dinheiro em jogo (cada template custa).
// ---------------------------------------------------------------------------
export function Campanhas({ inicial, aoErro }: { inicial: PainelInicial; aoErro: (t: string) => void }) {
  // ⚠️ NASCE COM OS DADOS do servidor (spec §2.3). A rota só é chamada DEPOIS,
  // quando alguma coisa muda — criar, encerrar — e não para a primeira pintura.
  const [dados, setDados] = useState<{ disparos: DisparoAnterior[]; atendentes: Atendente[]; campanhas: Campanha[] }>({
    disparos: inicial.disparos, atendentes: inicial.atendentes, campanhas: inicial.campanhas,
  });
  const [montando, setMontando] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);

  const recarregar = useCallback(() => {
    fetch("/api/admin/campanha-distribuicao")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
        return j;
      })
      .then((j) => setDados({ disparos: j.disparos, atendentes: j.atendentes, campanhas: j.campanhas }))
      .catch((e) => aoErro(String(e?.message ?? e)));
  }, [aoErro]);

  return (
    <section className="rounded-2xl bg-v2-superficie p-4 shadow-e1 ring-1 ring-v2-linha sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[18px] font-bold tracking-[-0.01em]">Campanhas de distribuição</h2>
            <span className="text-[12.5px] tabular-nums text-v2-tinta-fraca">
              {dados.campanhas.filter((c) => c.ativa).length} distribuindo · {dados.campanhas.length} no total
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-v2-tinta-fraca">
            Quando a cliente <b className="text-v2-tinta">responde</b> a um disparo, ela é transferida sozinha para o
            próximo atendente da fila — e a fila dá a volta.
          </p>
        </div>
        <button
          data-ripple
          onClick={() => setMontando((v) => !v)}
          className={[
            "flex h-10 shrink-0 items-center rounded-lg px-4 text-[13.5px] font-semibold",
            montando
              ? "bg-v2-superficie text-v2-tinta ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie-2"
              : "bg-v2-azul text-white shadow-e1 hover:bg-v2-azul-forte",
          ].join(" ")}
        >
          {montando ? "Cancelar" : "+ Nova campanha"}
        </button>
      </div>
      <p className="mt-3 max-w-2xl rounded-xl bg-v2-superficie-2 px-3 py-2.5 text-[12.5px] leading-[18px] text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha">
        O disparo acontece <b className="text-v2-tinta">aqui</b> — template, carteiras, filtros ou planilha, com a
        prévia de quem recebe e o custo antes de qualquer coisa sair. A tela de{" "}
        <a href="/admin" className="text-v2-azul underline">Administração › Templates</a> continua funcionando e tem
        filtros que esta ainda não expõe (produto, financeiro, geografia).
      </p>

      {montando && (
        <Montar
          disparos={dados.disparos}
          atendentes={dados.atendentes}
          aoErro={aoErro}
          aoCriar={() => { setMontando(false); recarregar(); }}
        />
      )}

      {!dados.campanhas.length && !montando && (
        <Vazio texto="Nenhuma campanha ainda. Crie a primeira em “+ Nova campanha”." />
      )}

      {!!dados.campanhas.length && (
        <h3 className="m-0 mt-6 text-[12px] font-bold uppercase tracking-[0.08em] text-v2-tinta-fraca">
          Campanhas <span className="tabular-nums">{dados.campanhas.length}</span>
        </h3>
      )}
      {dados.campanhas.map((c) => (
        <Card
          key={c.id}
          c={c}
          atendentes={dados.atendentes}
          aberta={aberta === c.id}
          aoAbrir={() => setAberta(aberta === c.id ? null : c.id)}
          aoErro={aoErro}
          aoMudar={recarregar}
        />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Montar: escolher o disparo, a fila e a janela
// ---------------------------------------------------------------------------
function Montar({
  disparos, atendentes, aoErro, aoCriar,
}: {
  disparos: DisparoAnterior[]; atendentes: Atendente[];
  aoErro: (t: string) => void; aoCriar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [chave, setChave] = useState("");
  const [fila, setFila] = useState<string[]>([]);
  const [janela, setJanela] = useState(7);
  const [ocupado, setOcupado] = useState(false);
  // ⚠️ DOIS CAMINHOS, e o dono decidiu os dois (29/09/2026):
  //   `agora`    dispara aqui mesmo — é como as próximas campanhas vão nascer;
  //   `anterior` prende a campanha a um disparo que JÁ aconteceu — ele chamou
  //              de exceção, para o disparo de hoje que já saiu.
  const [modo, setModo] = useState<"agora" | "anterior">("agora");
  // o que o disparo desta tela produziu: é ele que define quem entra na campanha
  const [feito, setFeito] = useState<null | { de: string; ate: string; templateEnvioId: string | null; enviados: number }>(null);
  // ⚠️ ESTADO, não `useRef`: o portal do "Disparar agora" (#65) só acontece
  // quando o Disparo RE-RENDERIZA sabendo que o alvo existe. Com `useRef` o
  // elemento aparece sem avisar ninguém, e o botão nunca chega ao rodapé.
  const [rodape, setRodape] = useState<HTMLDivElement | null>(null);
  const d = modo === "anterior" ? disparos.find((x) => x.chave === chave) : null;

  // ⚠️ A ORDEM DO CLIQUE É A ORDEM DO RODÍZIO. Sem isto a fila seria a ordem
  // alfabética da lista, e "o primeiro que responder vai para o primeiro da
  // lista" deixaria de ser verdade.
  const alternar = (e: string) =>
    setFila((f) => (f.includes(e) ? f.filter((x) => x !== e) : [...f, e]));

  async function criar() {
    const janelaDisparo = modo === "agora"
      ? (feito ? { de: feito.de, ate: feito.ate, template_id: feito.templateEnvioId } : null)
      : (d ? { de: d.de, ate: d.ate, template_id: d.template_id } : null);
    if (!janelaDisparo) return aoErro(modo === "agora" ? "dispare primeiro" : "escolha o disparo");
    setOcupado(true);
    try {
      const r = await fetch("/api/admin/campanha-distribuicao", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome, ...janelaDisparo, atendentes: fila, janela_dias: janela }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
      aoCriar();
    } catch (e) {
      aoErro(String((e as any)?.message ?? e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl bg-v2-superficie-2 p-4 ring-1 ring-inset ring-v2-linha sm:p-5">
      <h3 className="m-0 text-[16px] font-bold tracking-[-0.01em]">Nova campanha</h3>

      <label className="mt-4 block max-w-xl">
        <span className={ROTULO}>Nome da campanha</span>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex.: reativação da carteira vaga"
          className={CAMPO}
        />
      </label>

      <div className="mt-5">
        <span className={ROTULO}>De onde vem o público</span>
        {/* controle segmentado: uma escolha entre duas, quadrado como as abas */}
        <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row">
          {([["agora", "Disparar agora"], ["anterior", "Usar um disparo que já aconteceu"]] as const).map(([k, r]) => (
            <button
              key={k}
              data-ripple
              aria-pressed={modo === k}
              onClick={() => setModo(k)}
              className={[
                "flex h-10 items-center justify-center rounded-lg px-4 text-[13px] font-semibold ring-1 ring-inset",
                modo === k ? "bg-v2-vinho text-white ring-v2-vinho" : "bg-v2-superficie text-v2-tinta ring-v2-linha-forte hover:bg-v2-vinho-claro",
              ].join(" ")}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {modo === "agora" && (
        <>
          {feito ? (
            <p className="mt-3 rounded-xl bg-v2-azul-claro px-3 py-2.5 text-[13px] leading-5 text-v2-azul">
              Disparo concluído: <b className="tabular-nums">{feito.enviados}</b> templates enviados. Agora escolha a
              fila do rodízio e crie a campanha — ela já nasce ligada a este disparo.
            </p>
          ) : (
            <Disparo aoErro={aoErro} aoEnviado={setFeito} alvoBotao={rodape} />
          )}
        </>
      )}

      <label className={["mt-4 block max-w-xl", modo === "anterior" ? "" : "hidden"].join(" ")}>
        <span className={ROTULO}>Disparo que já aconteceu</span>
        <select value={chave} onChange={(e) => setChave(e.target.value)} className={CAMPO}>
          <option value="">escolha…</option>
          {disparos.map((x) => (
            <option key={x.chave} value={x.chave}>
              {dataHora(x.de)} · {x.total} cliente{x.total > 1 ? "s" : ""}
              {x.carteiras.length ? ` · ${x.carteiras.join(", ")}` : ""}
            </option>
          ))}
        </select>
        {!disparos.length && (
          <span className="mt-1 block text-[12px] text-v2-laranja">
            Nenhum disparo em massa nos últimos 30 dias.
          </span>
        )}
      </label>

      <div className="mt-5">
        <span className={ROTULO}>Fila do rodízio — a ordem é a ordem do clique</span>
        <p className="mt-0.5 text-[12px] leading-4 text-v2-tinta-fraca">
          A primeira que responder vai para o 1º; a segunda, para o 2º; e assim até dar a volta.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {atendentes.map((a) => {
            const i = fila.indexOf(a.endereco);
            return (
              <button
                key={a.endereco}
                data-ripple
                aria-pressed={i >= 0}
                onClick={() => alternar(a.endereco)}
                className={[
                  CHIP,
                  i >= 0
                    ? "bg-v2-azul text-white ring-v2-azul"
                    : "bg-v2-superficie text-v2-tinta ring-v2-linha-forte hover:bg-v2-azul-claro",
                ].join(" ")}
              >
                {i >= 0 && <span className="mr-1 tabular-nums opacity-80">{i + 1}º</span>}
                {a.nome}
                {a.tipo === "atendimento" && <span className="ml-1 opacity-70">·{a.papel}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mt-5 block max-w-xs">
        <span className={ROTULO}>Resposta conta até</span>
        <select value={janela} onChange={(e) => setJanela(Number(e.target.value))} className={CAMPO}>
          {[1, 3, 7, 15, 30].map((n) => (
            <option key={n} value={n}>{n} dia{n > 1 ? "s" : ""} depois do envio</option>
          ))}
        </select>
      </label>

      {/* ⚠️ Dizer o que NÃO acontece é metade da tela: sem isto, alguém monta a
          campanha achando que ela vai arrancar as conversas de quem já atende. */}
      <p className="mt-5 max-w-2xl rounded-xl bg-v2-superficie px-3 py-2.5 text-[12.5px] leading-[18px] text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha">
        Quem <b className="text-v2-tinta">já tem dono</b> não é distribuído — a conversa fica com quem está
        atendendo, e a linha aparece na planilha com o motivo. A carteira do cliente não muda; o que muda é quem
        atende o diálogo.
      </p>

      {/* #65 — pedido do dono: "Criar campanha" no canto inferior ESQUERDO e
          "Disparar agora" no inferior DIREITO, lado a lado.
          O de disparar vem de dentro do `Disparo` por portal (`rodape`): ele
          depende de seis estados internos de lá, e subi-los para cá só para
          mover um botão seria reescrever um componente para mudar um lugar. */}
      <div className="mt-4 flex flex-col gap-2 border-t border-v2-linha pt-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          data-ripple
          disabled={!nome || !fila.length || ocupado || (modo === "anterior" ? !d : !feito)}
          onClick={criar}
          className="flex h-11 w-full items-center justify-center rounded-lg bg-v2-azul px-5 text-[14px] font-semibold text-white shadow-e1 hover:bg-v2-azul-forte disabled:bg-v2-linha-forte disabled:shadow-none sm:w-auto"
        >
          <span className="tabular-nums">
            {ocupado
              ? "criando…"
              : modo === "anterior" && d
                ? `Criar campanha com ${d.total} cliente${d.total > 1 ? "s" : ""}`
                : feito
                  ? `Criar campanha com ${feito.enviados} cliente${feito.enviados > 1 ? "s" : ""}`
                  : "Criar campanha"}
          </span>
        </button>
        {/* o lugar do "Disparar agora". Fica vazio quando o modo é "usar um
            disparo anterior" — ali não há o que disparar. */}
        <div ref={setRodape} className="sm:ml-auto" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O card da campanha, com a planilha que se alimenta sozinha
// ---------------------------------------------------------------------------
function Card({
  c, atendentes, aberta, aoAbrir, aoErro, aoMudar,
}: {
  c: Campanha; atendentes: Atendente[]; aberta: boolean;
  aoAbrir: () => void; aoErro: (t: string) => void; aoMudar: () => void;
}) {
  const [alvos, setAlvos] = useState<Alvo[] | null>(null);

  useEffect(() => {
    if (!aberta) return;
    let vivo = true;
    const puxar = () =>
      fetch(`/api/admin/campanha-distribuicao?id=${c.id}`)
        .then((r) => r.json())
        .then((j) => vivo && setAlvos(j.alvos ?? []))
        .catch(() => {});
    puxar();
    // a planilha "se alimenta sozinha": a distribuição acontece no webhook, e
    // não há evento nosso para ouvir. 20 s é curto para parecer viva e longo
    // para não virar o vício de polling da §15.1 — e só enquanto o card está
    // ABERTO na tela de um admin.
    const t = setInterval(puxar, 20_000);
    return () => { vivo = false; clearInterval(t); };
  }, [aberta, c.id]);

  const baixar = () => {
    if (!alvos?.length) return;
    const cab = ["nome", "codigo", "rca", "carteira_origem", "atendente", "enviado_em", "respondeu_em", "motivo"];
    const linhas = alvos.map((a) => [
      a.nome ?? "", a.codcli ?? "", a.rca ?? "", a.carteira_origem ?? "",
      a.atendente ? nomeDoEndereco(a.atendente, atendentes) : "",
      a.enviado_em ?? "", a.respondeu_em ?? "", a.motivo ?? "",
    ]);
    // `;` e BOM: é o que o Excel em pt-BR abre sem pedir importação (§36.3)
    const bom = String.fromCharCode(0xfeff);
    const csv = bom + [cab, ...linhas].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `campanha-${c.id}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  async function encerrar(ativa: boolean) {
    try {
      const r = await fetch("/api/admin/campanha-distribuicao", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: c.id, ativa }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `erro ${r.status}`);
      aoMudar();
    } catch (e) { aoErro(String((e as any)?.message ?? e)); }
  }

  const feitos = c.feitos ?? 0;
  const total = c.total ?? 0;

  return (
    <article className="mt-2.5 rounded-2xl bg-v2-superficie ring-1 ring-v2-linha transition-shadow hover:shadow-e1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:p-4">
        <button
          data-ripple
          onClick={aoAbrir}
          aria-expanded={aberta}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left"
        >
          <span
            aria-hidden
            className={["mt-0.5 shrink-0 text-[12px] text-v2-tinta-fraca transition-transform", aberta ? "rotate-90" : ""].join(" ")}
          >
            ▶
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold tracking-[-0.01em]">{c.nome}</span>
            <span className="mt-0.5 block text-[12px] leading-4 tabular-nums text-v2-tinta-fraca">
              disparo de {dataHora(c.disparo_de)} · {c.atendentes.length} na fila · janela de {c.janela_dias}d
            </span>
          </span>
        </button>
        <span
          className={[
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            c.ativa ? "bg-v2-azul-claro text-v2-azul" : "bg-v2-superficie-2 text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha",
          ].join(" ")}
        >
          {c.ativa ? "distribuindo" : "encerrada"}
        </span>
        <button
          data-ripple
          onClick={() => encerrar(!c.ativa)}
          className="flex h-9 shrink-0 items-center rounded-lg px-3 text-[12.5px] font-semibold text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie-2"
        >
          {c.ativa ? "Encerrar" : "Reativar"}
        </button>

        {/* quanto da campanha já andou: o número que o admin procura primeiro */}
        <div className="w-full">
          <div className="flex items-baseline justify-between text-[12px] text-v2-tinta-fraca">
            <span>distribuídos</span>
            <span className="tabular-nums">
              <b className="text-v2-tinta">{feitos}</b> de {total}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-v2-superficie-2 ring-1 ring-inset ring-v2-linha">
            <div
              className={["h-full", c.ativa ? "bg-v2-azul" : "bg-v2-linha-forte"].join(" ")}
              style={{ width: `${total ? Math.min(100, (feitos / total) * 100) : 0}%` }}
            />
          </div>
        </div>
      </div>

      {aberta && (
        <div className="border-t border-v2-linha p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-v2-tinta-fraca">
            <span className="mr-0.5 font-semibold uppercase tracking-[0.08em]">Fila</span>
            {c.atendentes.map((e, i) => (
              <span
                key={e}
                className={[
                  "rounded-lg px-2 py-1 tabular-nums",
                  i === c.proximo && c.ativa
                    ? "bg-v2-azul font-semibold text-white"
                    : "bg-v2-superficie-2 text-v2-tinta ring-1 ring-inset ring-v2-linha",
                ].join(" ")}
              >
                {i + 1}º {nomeDoEndereco(e, atendentes)}
                {i === c.proximo && c.ativa && " · é a vez"}
              </span>
            ))}
            <button
              data-ripple
              onClick={baixar}
              disabled={!alvos?.length}
              className={["ml-auto", BOTAO_CONTORNO].join(" ")}
            >
              Baixar planilha
            </button>
          </div>

          {/* enquanto a planilha não chega: o formato das linhas, não um texto solto */}
          {!alvos && (
            <div className="mt-3 space-y-1.5" aria-label="carregando">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="esqueleto h-8" />
              ))}
            </div>
          )}
          {alvos && !alvos.length && <Vazio texto="Ninguém nesta campanha ainda." />}
          {!!alvos?.length && (
            <div className="rolagem mt-3 max-h-96 overflow-auto rounded-xl ring-1 ring-inset ring-v2-linha">
              <table className="w-full border-collapse text-left text-[12.5px]">
                <thead className="sticky top-0 bg-v2-superficie-2 text-[11px] uppercase tracking-[0.06em] text-v2-tinta-fraca">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Cliente</th>
                    <th className="px-3 py-2 text-right font-semibold">Cód.</th>
                    <th className="px-3 py-2 text-right font-semibold">RCA</th>
                    <th className="px-3 py-2 font-semibold">Era de</th>
                    <th className="px-3 py-2 font-semibold">Foi para</th>
                    <th className="px-3 py-2 font-semibold">Enviado</th>
                    <th className="px-3 py-2 font-semibold">Respondeu</th>
                  </tr>
                </thead>
                <tbody>
                  {alvos.map((a) => (
                    <tr key={a.cliente_id} className="border-t border-v2-linha hover:bg-v2-superficie-2">
                      <td className="max-w-[220px] truncate px-3 py-2 font-medium">{a.nome ?? a.cliente_id}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.codcli ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.rca ?? "—"}</td>
                      <td className="px-3 py-2">{a.carteira_origem ?? "—"}</td>
                      <td className="px-3 py-2">
                        {a.atendente ? (
                          <b className="text-v2-azul">{nomeDoEndereco(a.atendente, atendentes)}</b>
                        ) : a.motivo ? (
                          <span className="text-v2-laranja">{a.motivo}</span>
                        ) : (
                          <span className="text-v2-tinta-fraca">aguardando resposta</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-v2-tinta-fraca">{dataHora(a.enviado_em)}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-v2-tinta-fraca">{dataHora(a.respondeu_em)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
