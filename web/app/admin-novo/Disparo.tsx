"use client";

import { useEffect, useRef, useState } from "react";
import { enviarEmMassa, type AlvoEnvio, type FalhaEnvio, type Progresso } from "../../lib/envioEmMassa";

// ---------------------------------------------------------------------------
// O DISPARO, DENTRO DA CAMPANHA (demanda #52, decisão do dono em 29/09/2026:
// "crie todo o mecanismo do disparo dentro dessa nova feature").
//
// ⚠️ A TELA É NOVA; AS REGRAS NÃO. Quem decide o público continua sendo
// `lib/publicoDisparo.ts` (filtros, anti-repetição, número morto, lixeira,
// custo) e `lib/publicoManual.ts` (planilha) — esta tela chama a MESMA rota de
// prévia que a de Administração › Templates. Duas definições de "quem recebe"
// custariam dinheiro em cima de quem não devia receber, e a divergência só
// apareceria depois do envio.
//
// ⚠️ O QUE ESTA TELA AINDA NÃO EXPÕE: os filtros de produto, financeiro,
// geografia e preditivo, que a tela antiga tem. Estão todos na rota e
// continuam valendo por lá. Aqui ficam os que o pedido nomeia — carteira,
// etapa, tempo parado, anti-repetição, cota por consultor e teto. Preferi
// dizer isto a fingir paridade que não medi.
// ---------------------------------------------------------------------------

type Template = {
  id: number | string; nome: string; canal: string; padrao: boolean;
  envio_id: string | null; corpo: string | null; campos: string[]; status: string | null;
};
type Carteira = { slug: string; cor: string | null; time: string | null };
type Previa = {
  total: number;
  selecionados: AlvoEnvio[];
  cortes: Record<string, number>;
  porVendedor: Record<string, number>;
  avisos?: string[];
};

const ETAPAS = [
  { k: "ociosos", r: "Ociosos" },
  { k: "tentativa_contato", r: "Tentativa de contato" },
  { k: "negociacao", r: "Negociação" },
  { k: "prospeccao", r: "Prospecção" },
  { k: "vender_novamente", r: "Vender novamente" },
] as const;

const CUSTO = 0.43;

export function Disparo({
  aoErro, aoEnviado,
}: {
  aoErro: (t: string) => void;
  /** avisa a campanha: o disparo terminou, e estes são os limites dele */
  aoEnviado: (r: { de: string; ate: string; templateEnvioId: string | null; enviados: number }) => void;
}) {
  const [cfg, setCfg] = useState<{ templates: Template[]; carteiras: Carteira[] } | null>(null);
  const [tpl, setTpl] = useState<string>("");
  const [carteiras, setCarteiras] = useState<string[]>([]);
  const [etapas, setEtapas] = useState<string[]>(["ociosos", "tentativa_contato"]);
  const [diasMin, setDiasMin] = useState(0);
  const [diasRecontato, setDiasRecontato] = useState(4);
  const [porVendedor, setPorVendedor] = useState(0);
  const [limite, setLimite] = useState(50);
  const [extras, setExtras] = useState<string[]>([]);

  const [planilha, setPlanilha] = useState<{ nome: string; codclis: number[] } | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [prog, setProg] = useState<Progresso | null>(null);
  const [falhas, setFalhas] = useState<FalhaEnvio[]>([]);
  const parar = useRef(false);

  useEffect(() => {
    fetch("/api/admin/disparo-massa")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
        return j["disparo-massa"];
      })
      .then((d) => setCfg({ templates: d.templates ?? [], carteiras: d.carteiras ?? [] }))
      .catch((e) => aoErro(String(e?.message ?? e)));
  }, [aoErro]);

  const template = cfg?.templates.find((t) => String(t.id) === tpl) ?? null;
  // `{{1}}` é o primeiro nome, que o servidor preenche sozinho; daqui em diante
  // é a mesma palavra para a campanha inteira, como a tela do RD faz
  const camposExtras = (template?.campos ?? []).slice(1);

  async function montar() {
    setOcupado(true); setPrevia(null);
    try {
      const corpo: any = planilha
        // ⚠️ a PLANILHA pula os filtros, e é assim de propósito (decisão de
        // 16/09): "a planilha já é o resultado curado". A tela desliga os
        // filtros para a pessoa não achar que eles valem.
        ? { acao: "previa", cards: planilha.codclis.map((c) => ({ codcli: c })) }
        : {
            acao: "previa",
            carteiras, etapas, diasMin, diasRecontato, porVendedor, limite,
            canal: template?.canal ?? null,
          };
      const r = await fetch("/api/admin/disparo-massa", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
      setPrevia({
        total: j.total ?? j.selecionados?.length ?? 0,
        selecionados: j.selecionados ?? [],
        cortes: j.cortes ?? {},
        porVendedor: j.porVendedor ?? {},
        avisos: j.avisos ?? [],
      });
    } catch (e) {
      aoErro(String((e as any)?.message ?? e));
    } finally {
      setOcupado(false);
    }
  }

  async function enviar() {
    if (!previa?.selecionados.length) return;
    if (!confirm(
      `Enviar ${previa.selecionados.length} templates?\n\n` +
      `Custo estimado: R$ ${(previa.selecionados.length * CUSTO).toFixed(2)}.\n` +
      `Não dá para desfazer: cada mensagem sai para a cliente.`,
    )) return;

    parar.current = false;
    setFalhas([]);
    const de = new Date().toISOString();
    const r = await enviarEmMassa(previa.selecionados, {
      templateEnvioId: template?.envio_id ?? null,
      variaveisExtras: camposExtras.length ? extras : undefined,
      aoProgresso: setProg,
      parar: () => parar.current,
    });
    setFalhas(r.falhas);
    // a janela do disparo é o que a campanha usa para saber quem recebeu — e
    // ela é fechada AQUI, com folga de um minuto para cada lado, porque os
    // envios em paralelo terminam fora de ordem
    aoEnviado({
      de: new Date(new Date(de).getTime() - 60_000).toISOString(),
      ate: new Date(Date.now() + 60_000).toISOString(),
      templateEnvioId: template?.envio_id ?? null,
      enviados: r.ok,
    });
  }

  const lerPlanilha = (f: File) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const txt = String(leitor.result ?? "");
      // CSV simples: a primeira coluna é o código. Aceita `;` e `,`, com ou sem
      // cabeçalho — quem monta a planilha não deve ter de adivinhar o formato.
      const codigos = txt.split(/\r?\n/).map((l) => {
        const primeira = l.split(/[;,\t]/)[0]?.replace(/["']/g, "").trim() ?? "";
        return Number(primeira);
      }).filter((n) => Number.isInteger(n) && n > 0);
      if (!codigos.length) return aoErro("não achei códigos de cliente na primeira coluna da planilha");
      setPlanilha({ nome: f.name, codclis: [...new Set(codigos)] });
      setPrevia(null);
    };
    leitor.readAsText(f);
  };

  if (!cfg) return <p className="mt-3 text-[13px] text-v2-tinta-fraca">carregando…</p>;

  return (
    <div className="mt-3 rounded-2xl bg-v2-superficie-2 p-3">
      <h4 className="text-[12px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">1 · O template</h4>
      <select
        value={tpl}
        onChange={(e) => { setTpl(e.target.value); setPrevia(null); }}
        className="mt-1 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-3 py-2 text-[14px] outline-none focus:border-v2-azul"
      >
        <option value="">escolha…</option>
        {cfg.templates.map((t) => (
          <option key={String(t.id)} value={String(t.id)}>
            {t.nome}{t.padrao ? " ★" : ""}
          </option>
        ))}
      </select>
      {template?.corpo && (
        <p className="mt-1 whitespace-pre-wrap rounded-xl bg-v2-superficie px-3 py-2 text-[12.5px] leading-[18px] text-v2-tinta-fraca">
          {template.corpo}
        </p>
      )}
      {camposExtras.map((_, i) => (
        <input
          key={i}
          value={extras[i] ?? ""}
          onChange={(e) => setExtras((v) => { const n = [...v]; n[i] = e.target.value; return n; })}
          placeholder={`o que entra em {{${i + 2}}} — vale para a campanha inteira`}
          className="mt-1 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-3 py-2 text-[13.5px] outline-none focus:border-v2-azul"
        />
      ))}

      <h4 className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">
        2 · Quem recebe
      </h4>

      {/* PLANILHA — e quando ela existe, os filtros ficam desligados */}
      <div className="mt-1 flex flex-wrap items-center gap-2 rounded-xl bg-v2-superficie px-3 py-2">
        <span className="text-[12.5px] text-v2-tinta-fraca">Planilha (1ª coluna = código do cliente):</span>
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) lerPlanilha(f); }}
          className="text-[12px]"
        />
        {planilha && (
          <span className="flex items-center gap-2 text-[12.5px] text-v2-azul">
            {planilha.nome} · {planilha.codclis.length} códigos
            <button
              onClick={() => { setPlanilha(null); setPrevia(null); }}
              className="rounded-full px-2 py-0.5 text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha"
            >
              tirar
            </button>
          </span>
        )}
      </div>

      <fieldset disabled={!!planilha} className={planilha ? "pointer-events-none opacity-45" : ""}>
        {planilha && (
          <p className="mt-2 text-[12px] text-v2-laranja">
            Com planilha os filtros ficam desligados — ela já é a lista final.
          </p>
        )}

        <div className="mt-2">
          <span className="text-[12px] text-v2-tinta-fraca">Carteiras (nenhuma = todas)</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {cfg.carteiras.map((c) => (
              <button
                key={c.slug}
                onClick={() => setCarteiras((v) => v.includes(c.slug) ? v.filter((x) => x !== c.slug) : [...v, c.slug])}
                className={[
                  "rounded-full px-3 py-1 text-[12.5px] font-medium ring-1 ring-inset",
                  carteiras.includes(c.slug)
                    ? "bg-v2-azul text-white ring-v2-azul"
                    : "bg-v2-superficie text-v2-tinta ring-v2-linha-forte",
                ].join(" ")}
              >
                {c.slug}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2">
          <span className="text-[12px] text-v2-tinta-fraca">Etapas do funil</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ETAPAS.map((e) => (
              <button
                key={e.k}
                onClick={() => setEtapas((v) => v.includes(e.k) ? v.filter((x) => x !== e.k) : [...v, e.k])}
                className={[
                  "rounded-full px-3 py-1 text-[12.5px] font-medium ring-1 ring-inset",
                  etapas.includes(e.k)
                    ? "bg-v2-azul text-white ring-v2-azul"
                    : "bg-v2-superficie text-v2-tinta ring-v2-linha-forte",
                ].join(" ")}
              >
                {e.r}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Numero rotulo="Parado há (dias)" v={diasMin} set={setDiasMin} />
          <Numero rotulo="Sem template há (dias)" v={diasRecontato} set={setDiasRecontato} />
          <Numero rotulo="Cota por consultor" v={porVendedor} set={setPorVendedor} />
          <Numero rotulo="Teto do disparo" v={limite} set={setLimite} />
        </div>
      </fieldset>

      <button
        data-ripple
        disabled={ocupado || (!planilha && !etapas.length)}
        onClick={montar}
        className="mt-3 rounded-full bg-v2-superficie px-4 py-2 text-[13.5px] font-semibold text-v2-azul ring-1 ring-inset ring-v2-linha-forte disabled:opacity-50"
      >
        {ocupado ? "montando…" : "Ver quem vai receber"}
      </button>

      {previa && (
        <div className="mt-3 rounded-xl bg-v2-superficie p-3">
          <p className="text-[13.5px]">
            <b>{previa.selecionados.length}</b> clientes ·{" "}
            <span className="text-v2-tinta-fraca">
              custo estimado R$ {(previa.selecionados.length * CUSTO).toFixed(2)}
            </span>
          </p>
          {!!Object.keys(previa.cortes).length && (
            <p className="mt-1 text-[12px] leading-[17px] text-v2-tinta-fraca">
              fora:{" "}
              {Object.entries(previa.cortes).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(" · ")}
            </p>
          )}
          {previa.avisos?.map((a, i) => (
            <p key={i} className="mt-1 text-[12px] text-v2-laranja">{a}</p>
          ))}
          <ul className="mt-2 max-h-40 overflow-auto text-[12.5px] text-v2-tinta-fraca">
            {previa.selecionados.slice(0, 50).map((s) => <li key={s.envio_id}>{s.cliente}</li>)}
            {previa.selecionados.length > 50 && <li>…e mais {previa.selecionados.length - 50}</li>}
          </ul>

          {!prog && (
            <button
              data-ripple
              disabled={!previa.selecionados.length || (!planilha && !template?.envio_id)}
              onClick={enviar}
              className="mt-2 rounded-full bg-v2-laranja px-4 py-2 text-[14px] font-semibold text-white disabled:bg-v2-linha-forte"
            >
              Disparar agora
            </button>
          )}
        </div>
      )}

      {prog && (
        <div className="mt-3 rounded-xl bg-v2-superficie p-3">
          <p className="text-[13.5px] font-semibold">
            {prog.feitos} de {prog.total} · {prog.ok} enviados · {prog.falhas} falhas
          </p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-v2-superficie-2">
            <div className="h-full bg-v2-azul" style={{ width: `${(prog.feitos / Math.max(1, prog.total)) * 100}%` }} />
          </div>
          {/* ⚠️ a aba precisa ficar ABERTA: o laço roda aqui, não no servidor */}
          <p className="mt-1 text-[12px] text-v2-tinta-fraca">
            Deixe esta aba aberta até o fim — o envio roda aqui.
          </p>
          {prog.feitos < prog.total && (
            <button
              onClick={() => { parar.current = true; }}
              className="mt-2 rounded-full px-3 py-1 text-[12.5px] text-v2-erro ring-1 ring-inset ring-v2-linha"
            >
              Parar
            </button>
          )}
          {!!falhas.length && (
            <ul className="mt-2 max-h-32 overflow-auto text-[12px] text-v2-erro">
              {falhas.slice(0, 20).map((f, i) => <li key={i}>{f.cliente}: {f.erro}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Numero({ rotulo, v, set }: { rotulo: string; v: number; set: (n: number) => void }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-v2-tinta-fraca">{rotulo}</span>
      <input
        type="number"
        min={0}
        value={v}
        onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
        className="mt-0.5 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-2 py-1.5 text-[13.5px] tabular-nums outline-none focus:border-v2-azul"
      />
    </label>
  );
}
