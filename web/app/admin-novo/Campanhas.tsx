"use client";

import { useCallback, useEffect, useState } from "react";
import type { Atendente, CampanhaResumo, Disparo as DisparoAnterior, PainelInicial } from "./_dados/painel";
import { Disparo } from "./Disparo";

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
    <section className="mt-4 rounded-2xl bg-v2-superficie p-4 shadow-e1 ring-1 ring-v2-linha">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-[15px] font-semibold">Campanhas de distribuição</h2>
        <button
          data-ripple
          onClick={() => setMontando((v) => !v)}
          className="rounded-full bg-v2-azul px-3 py-1.5 text-[13px] font-semibold text-white"
        >
          {montando ? "Cancelar" : "Nova campanha"}
        </button>
      </div>
      <p className="mt-1 text-[13px] leading-5 text-v2-tinta-fraca">
        Quando a cliente <b className="text-v2-tinta">responde</b> a um disparo, ela é transferida sozinha para o
        próximo atendente da fila — e a fila dá a volta.
      </p>
      <p className="mt-2 rounded-xl bg-v2-superficie-2 px-3 py-2 text-[12.5px] leading-[18px] text-v2-tinta-fraca">
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
        <p className="mt-4 text-[13px] text-v2-tinta-fraca">Nenhuma campanha ainda.</p>
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
    <div className="mt-4 rounded-2xl bg-v2-superficie-2 p-3">
      <label className="block">
        <span className="text-[12px] font-medium uppercase tracking-wide text-v2-tinta-fraca">Nome da campanha</span>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex.: reativação da carteira vaga"
          className="mt-1 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-3 py-2 text-[14px] outline-none focus:border-v2-azul"
        />
      </label>

      <div className="mt-3 flex gap-1.5">
        {([["agora", "Disparar agora"], ["anterior", "Usar um disparo que já aconteceu"]] as const).map(([k, r]) => (
          <button
            key={k}
            data-ripple
            onClick={() => setModo(k)}
            className={[
              "rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1 ring-inset",
              modo === k ? "bg-v2-vinho text-white ring-v2-vinho" : "bg-v2-superficie text-v2-tinta ring-v2-linha-forte",
            ].join(" ")}
          >
            {r}
          </button>
        ))}
      </div>

      {modo === "agora" && (
        <>
          {feito ? (
            <p className="mt-2 rounded-xl bg-v2-azul-claro px-3 py-2 text-[13px] text-v2-azul">
              Disparo concluído: <b>{feito.enviados}</b> templates enviados. Agora escolha a fila do rodízio e crie a
              campanha — ela já nasce ligada a este disparo.
            </p>
          ) : (
            <Disparo aoErro={aoErro} aoEnviado={setFeito} />
          )}
        </>
      )}

      <label className={["mt-3 block", modo === "anterior" ? "" : "hidden"].join(" ")}>
        <span className="text-[12px] font-medium uppercase tracking-wide text-v2-tinta-fraca">
          Disparo que já aconteceu
        </span>
        <select
          value={chave}
          onChange={(e) => setChave(e.target.value)}
          className="mt-1 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-3 py-2 text-[14px] outline-none focus:border-v2-azul"
        >
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

      <div className="mt-3">
        <span className="text-[12px] font-medium uppercase tracking-wide text-v2-tinta-fraca">
          Fila do rodízio — a ordem é a ordem do clique
        </span>
        <p className="mt-0.5 text-[12px] text-v2-tinta-fraca">
          A primeira que responder vai para o 1º; a segunda, para o 2º; e assim até dar a volta.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {atendentes.map((a) => {
            const i = fila.indexOf(a.endereco);
            return (
              <button
                key={a.endereco}
                data-ripple
                onClick={() => alternar(a.endereco)}
                className={[
                  "rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1 ring-inset",
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

      <label className="mt-3 block max-w-xs">
        <span className="text-[12px] font-medium uppercase tracking-wide text-v2-tinta-fraca">
          Resposta conta até
        </span>
        <select
          value={janela}
          onChange={(e) => setJanela(Number(e.target.value))}
          className="mt-1 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-3 py-2 text-[14px] outline-none focus:border-v2-azul"
        >
          {[1, 3, 7, 15, 30].map((n) => (
            <option key={n} value={n}>{n} dia{n > 1 ? "s" : ""} depois do envio</option>
          ))}
        </select>
      </label>

      {/* ⚠️ Dizer o que NÃO acontece é metade da tela: sem isto, alguém monta a
          campanha achando que ela vai arrancar as conversas de quem já atende. */}
      <p className="mt-3 rounded-xl bg-v2-superficie px-3 py-2 text-[12.5px] leading-[18px] text-v2-tinta-fraca">
        Quem <b className="text-v2-tinta">já tem dono</b> não é distribuído — a conversa fica com quem está
        atendendo, e a linha aparece na planilha com o motivo. A carteira do cliente não muda; o que muda é quem
        atende o diálogo.
      </p>

      <button
        data-ripple
        disabled={!nome || !fila.length || ocupado || (modo === "anterior" ? !d : !feito)}
        onClick={criar}
        className="mt-3 rounded-full bg-v2-azul px-4 py-2 text-[14px] font-semibold text-white disabled:bg-v2-linha-forte"
      >
        {ocupado
          ? "criando…"
          : modo === "anterior" && d
            ? `Criar campanha com ${d.total} cliente${d.total > 1 ? "s" : ""}`
            : feito
              ? `Criar campanha com ${feito.enviados} cliente${feito.enviados > 1 ? "s" : ""}`
              : "Criar campanha"}
      </button>
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

  return (
    <div className="mt-3 rounded-2xl bg-v2-superficie-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button data-ripple onClick={aoAbrir} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[14px] font-semibold">{c.nome}</span>
          <span className="block text-[12px] text-v2-tinta-fraca">
            disparo de {dataHora(c.disparo_de)} · {c.feitos ?? 0} de {c.total ?? 0} distribuídos ·{" "}
            {c.atendentes.length} na fila · janela de {c.janela_dias}d
          </span>
        </button>
        <span
          className={[
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            c.ativa ? "bg-v2-azul-claro text-v2-azul" : "bg-v2-superficie text-v2-tinta-fraca",
          ].join(" ")}
        >
          {c.ativa ? "distribuindo" : "encerrada"}
        </span>
        <button
          data-ripple
          onClick={() => encerrar(!c.ativa)}
          className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha-forte"
        >
          {c.ativa ? "Encerrar" : "Reativar"}
        </button>
      </div>

      {aberta && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-v2-tinta-fraca">
            <span>fila:</span>
            {c.atendentes.map((e, i) => (
              <span
                key={e}
                className={[
                  "rounded-full px-2 py-0.5",
                  i === c.proximo && c.ativa ? "bg-v2-azul text-white" : "bg-v2-superficie ring-1 ring-inset ring-v2-linha",
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
              className="ml-auto rounded-full bg-v2-superficie px-2.5 py-1 font-medium text-v2-azul ring-1 ring-inset ring-v2-linha-forte disabled:opacity-50"
            >
              Baixar planilha
            </button>
          </div>

          {!alvos && <p className="mt-2 text-[12.5px] text-v2-tinta-fraca">carregando…</p>}
          {alvos && (
            <div className="mt-2 max-h-96 overflow-auto rounded-xl bg-v2-superficie">
              <table className="w-full text-left text-[12.5px]">
                <thead className="sticky top-0 bg-v2-superficie-2 text-[11px] uppercase tracking-wide text-v2-tinta-fraca">
                  <tr>
                    <th className="px-2 py-1.5">Cliente</th>
                    <th className="px-2 py-1.5">Cód.</th>
                    <th className="px-2 py-1.5">RCA</th>
                    <th className="px-2 py-1.5">Era de</th>
                    <th className="px-2 py-1.5">Foi para</th>
                    <th className="px-2 py-1.5">Enviado</th>
                    <th className="px-2 py-1.5">Respondeu</th>
                  </tr>
                </thead>
                <tbody>
                  {alvos.map((a) => (
                    <tr key={a.cliente_id} className="border-t border-v2-linha">
                      <td className="max-w-[220px] truncate px-2 py-1.5">{a.nome ?? a.cliente_id}</td>
                      <td className="px-2 py-1.5 tabular-nums">{a.codcli ?? "—"}</td>
                      <td className="px-2 py-1.5 tabular-nums">{a.rca ?? "—"}</td>
                      <td className="px-2 py-1.5">{a.carteira_origem ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {a.atendente ? (
                          <b className="text-v2-azul">{nomeDoEndereco(a.atendente, atendentes)}</b>
                        ) : a.motivo ? (
                          <span className="text-v2-laranja">{a.motivo}</span>
                        ) : (
                          <span className="text-v2-tinta-fraca">aguardando resposta</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-v2-tinta-fraca">{dataHora(a.enviado_em)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-v2-tinta-fraca">{dataHora(a.respondeu_em)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
