"use client";

import { useEffect, useRef, useState } from "react";
import { enviarEmMassa, type AlvoEnvio, type FalhaEnvio, type Progresso } from "../../lib/envioEmMassa";
import { telefoneBonito } from "../chat-v2/_componentes/formato";
import { BOTAO_CONTORNO, CAMPO, CHIP, CHIP_DESLIGADO, CHIP_LIGADO } from "./estilo";

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
/** o alvo com a ficha que a tabela mostra (demanda #56) */
type AlvoDetalhado = AlvoEnvio & {
  vendedor?: string | null;
  codcli?: number | null;
  cpf?: string | null;
  telefone?: string | null;
  rca?: number | null;
};

type Previa = {
  total: number;
  selecionados: AlvoDetalhado[];
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
        ? { acao: "previa", detalhe: true, cards: planilha.codclis.map((c) => ({ codcli: c })) }
        // ⚠️ OS FILTROS VÃO DENTRO DE `filtros`, e não no nível de cima
        // (demanda #54). Mandados soltos, a rota lia `b.filtros` = undefined e
        // rodava com TODOS os padrões: carteira nenhuma — ou seja, a base
        // inteira. O sintoma foi um disparo que deveria ser só de uma carteira
        // sair com clientes de quatro RCAs, e ninguém percebeu até a planilha
        // da campanha mostrar a coluna "era de".
        : {
            acao: "previa",
            // ⚠️ a tela mostra a TABELA (código, CPF, telefone, RCA), então
            // pede a ficha. A tela antiga não pede e não paga (#56).
            detalhe: true,
            canal: template?.canal ?? null,
            filtros: { carteiras, etapas, diasMin, diasRecontato, porVendedor, limite },
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

  // enquanto templates e carteiras não chegam: o formato do passo 1, não um
  // "carregando…" solto (a tela nunca fica em branco nem pula de altura)
  if (!cfg)
    return (
      <div className="mt-3 rounded-2xl bg-v2-superficie p-4 ring-1 ring-inset ring-v2-linha" aria-label="carregando">
        <div className="esqueleto h-4 w-32" />
        <div className="esqueleto mt-3 h-12 w-full" />
        <div className="esqueleto mt-6 h-4 w-40" />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="esqueleto h-9 w-24" />)}
        </div>
      </div>
    );

  return (
    <div className="mt-3 rounded-2xl bg-v2-superficie p-4 ring-1 ring-inset ring-v2-linha sm:p-5">
      <Passo n={1} titulo="O template" />
      <select
        value={tpl}
        onChange={(e) => { setTpl(e.target.value); setPrevia(null); }}
        className={CAMPO}
      >
        <option value="">escolha…</option>
        {cfg.templates.map((t) => (
          <option key={String(t.id)} value={String(t.id)}>
            {t.nome}{t.padrao ? " ★" : ""}
          </option>
        ))}
      </select>
      {template?.corpo && (
        <p className="mt-2 whitespace-pre-wrap rounded-xl bg-v2-superficie-2 px-3 py-2.5 text-[12.5px] leading-[18px] text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha">
          {template.corpo}
        </p>
      )}
      {camposExtras.map((_, i) => (
        <input
          key={i}
          value={extras[i] ?? ""}
          onChange={(e) => setExtras((v) => { const n = [...v]; n[i] = e.target.value; return n; })}
          placeholder={`o que entra em {{${i + 2}}} — vale para a campanha inteira`}
          className={CAMPO}
        />
      ))}

      <div className="mt-6">
        <Passo n={2} titulo="Quem recebe" />
      </div>

      {/* PLANILHA — e quando ela existe, os filtros ficam desligados */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl bg-v2-superficie-2 px-3 py-2.5 ring-1 ring-inset ring-v2-linha">
        <span className="text-[12.5px] text-v2-tinta-fraca">Planilha (1ª coluna = código do cliente):</span>
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) lerPlanilha(f); }}
          className="min-w-0 max-w-full text-[12px]"
        />
        {planilha && (
          <span className="flex items-center gap-2 text-[12.5px] text-v2-azul">
            <span className="tabular-nums">{planilha.nome} · {planilha.codclis.length} códigos</span>
            <button
              onClick={() => { setPlanilha(null); setPrevia(null); }}
              className="rounded-lg px-2 py-0.5 text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie"
            >
              tirar
            </button>
          </span>
        )}
      </div>

      <fieldset disabled={!!planilha} className={["m-0 min-w-0 border-0 p-0", planilha ? "pointer-events-none opacity-45" : ""].join(" ")}>
        {planilha && (
          <p className="mt-2 text-[12px] text-v2-laranja">
            Com planilha os filtros ficam desligados — ela já é a lista final.
          </p>
        )}

        <div className="mt-4">
          <span className="text-[12.5px] font-semibold text-v2-tinta-fraca">Carteiras <span className="font-normal">(nenhuma = todas)</span></span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {cfg.carteiras.map((c) => (
              <button
                key={c.slug}
                aria-pressed={carteiras.includes(c.slug)}
                onClick={() => setCarteiras((v) => v.includes(c.slug) ? v.filter((x) => x !== c.slug) : [...v, c.slug])}
                className={[CHIP, carteiras.includes(c.slug) ? CHIP_LIGADO : CHIP_DESLIGADO].join(" ")}
              >
                {c.slug}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <span className="text-[12.5px] font-semibold text-v2-tinta-fraca">Etapas do funil</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ETAPAS.map((e) => (
              <button
                key={e.k}
                aria-pressed={etapas.includes(e.k)}
                onClick={() => setEtapas((v) => v.includes(e.k) ? v.filter((x) => x !== e.k) : [...v, e.k])}
                className={[CHIP, etapas.includes(e.k) ? CHIP_LIGADO : CHIP_DESLIGADO].join(" ")}
              >
                {e.r}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        className={["mt-4 w-full sm:w-auto", BOTAO_CONTORNO].join(" ")}
      >
        {ocupado ? "montando…" : "Ver quem vai receber"}
      </button>

      {previa && (
        <div className="mt-6">
          <Passo n={3} titulo="Conferir e disparar" />
          <div className="mt-1.5 rounded-xl bg-v2-superficie-2 p-3 ring-1 ring-inset ring-v2-linha sm:p-4">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <Cifra rotulo="clientes" valor={String(previa.selecionados.length)} />
              <Cifra rotulo="custo estimado" valor={`R$ ${(previa.selecionados.length * CUSTO).toFixed(2)}`} />
            </div>
            {!!Object.keys(previa.cortes).length && (
              <p className="mt-2 text-[12px] leading-[17px] tabular-nums text-v2-tinta-fraca">
                fora:{" "}
                {Object.entries(previa.cortes).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(" · ")}
              </p>
            )}
            {previa.avisos?.map((a, i) => (
              <p key={i} className="mt-1 text-[12px] text-v2-laranja">{a}</p>
            ))}
            {/* ⚠️ A MESMA TABELA da campanha (demanda #56). A lista só com o
                nome não deixava conferir nada: dois clientes de nome parecido,
                um telefone errado ou um RCA fora do recorte passavam batidos —
                e o erro só aparecia depois do envio, com o custo já pago.

                200 linhas de teto, e a tela DIZ quantas ficaram de fora:
                desenhar cinco mil numa tabela trava a aba, e truncar em
                silêncio seria prometer uma conferência que não aconteceu. */}
            <div className="rolagem mt-3 max-h-72 overflow-auto rounded-lg bg-v2-superficie ring-1 ring-inset ring-v2-linha">
              <table className="w-full border-collapse text-left text-[12.5px]">
                <thead className="sticky top-0 bg-v2-superficie-2 text-[10.5px] uppercase tracking-wide text-v2-tinta-fraca">
                  <tr>
                    <th className="px-2 py-1.5 font-semibold">Cliente</th>
                    <th className="px-2 py-1.5 font-semibold">Cód.</th>
                    <th className="px-2 py-1.5 font-semibold">CPF/CNPJ</th>
                    <th className="px-2 py-1.5 font-semibold">Telefone</th>
                    <th className="px-2 py-1.5 font-semibold">RCA</th>
                    <th className="px-2 py-1.5 font-semibold">Consultor</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.selecionados.slice(0, 200).map((s) => (
                    <tr key={s.envio_id} className="border-t border-v2-linha">
                      <td className="max-w-[220px] truncate px-2 py-1.5">{s.cliente}</td>
                      <td className="px-2 py-1.5 tabular-nums text-v2-tinta-fraca">{s.codcli ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-v2-tinta-fraca">{s.cpf ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-v2-tinta-fraca">
                        {telefoneBonito(s.telefone)}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-v2-tinta-fraca">{s.rca ?? "—"}</td>
                      <td className="px-2 py-1.5 text-v2-tinta-fraca">{s.vendedor ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previa.selecionados.length > 200 && (
                <p className="border-t border-v2-linha px-2 py-1.5 text-[12px] tabular-nums text-v2-tinta-fraca">
                  …e mais {previa.selecionados.length - 200} — a tabela mostra as 200 primeiras
                </p>
              )}
            </div>

            {!prog && (
              <button
                data-ripple
                disabled={!previa.selecionados.length || (!planilha && !template?.envio_id)}
                onClick={enviar}
                className="mt-3 flex h-11 w-full items-center justify-center rounded-lg bg-v2-laranja px-5 text-[14px] font-semibold text-white shadow-e1 disabled:bg-v2-linha-forte disabled:shadow-none sm:w-auto"
              >
                Disparar agora
              </button>
            )}
          </div>
        </div>
      )}

      {prog && (
        <div className="mt-3 rounded-xl bg-v2-superficie-2 p-3 ring-1 ring-inset ring-v2-linha sm:p-4">
          <p className="text-[13.5px] font-semibold tabular-nums">
            {prog.feitos} de {prog.total} · {prog.ok} enviados · {prog.falhas} falhas
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-v2-superficie ring-1 ring-inset ring-v2-linha">
            <div className="h-full bg-v2-azul" style={{ width: `${(prog.feitos / Math.max(1, prog.total)) * 100}%` }} />
          </div>
          {/* ⚠️ a aba precisa ficar ABERTA: o laço roda aqui, não no servidor */}
          <p className="mt-1.5 text-[12px] text-v2-tinta-fraca">
            Deixe esta aba aberta até o fim — o envio roda aqui.
          </p>
          {prog.feitos < prog.total && (
            <button
              onClick={() => { parar.current = true; }}
              className="mt-2 flex h-9 items-center rounded-lg px-3 text-[12.5px] font-semibold text-v2-erro ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-erro-claro"
            >
              Parar
            </button>
          )}
          {!!falhas.length && (
            <ul className="rolagem m-0 mt-2 max-h-32 list-none overflow-auto p-0 text-[12px] text-v2-erro">
              {falhas.slice(0, 20).map((f, i) => <li key={i}>{f.cliente}: {f.erro}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Cabeçalho de passo: número num quadrado + título. A ordem é o roteiro do disparo. */
function Passo({ n, titulo }: { n: number; titulo: string }) {
  return (
    <h4 className="m-0 flex items-center gap-2 text-[14px] font-bold tracking-[-0.01em]">
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-v2-vinho text-[12px] font-bold tabular-nums text-white">
        {n}
      </span>
      {titulo}
    </h4>
  );
}

/** Um número grande com o rótulo embaixo — o que se confere antes de gastar. */
function Cifra({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-[24px] font-black leading-none tracking-[-0.02em] tabular-nums">{valor}</p>
      <p className="mt-1 text-[12px] text-v2-tinta-fraca">{rotulo}</p>
    </div>
  );
}

function Numero({ rotulo, v, set }: { rotulo: string; v: number; set: (n: number) => void }) {
  return (
    <label className="block min-w-0">
      <span className="block text-[12px] leading-4 text-v2-tinta-fraca">{rotulo}</span>
      <input
        type="number"
        min={0}
        value={v}
        onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
        className={[CAMPO, "tabular-nums"].join(" ")}
      />
    </label>
  );
}
