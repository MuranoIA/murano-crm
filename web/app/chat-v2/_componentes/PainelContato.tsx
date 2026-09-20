"use client";

import { useEffect, useState } from "react";
import { dinheiro, telefoneBonito } from "./formato";
import type { Conversa } from "./tipos";

// O ERP ao lado da conversa. É a vantagem que o RD Conversas não tem — e no
// chat antigo ela **some no celular** (`!isMobile`, achado 3 do laudo), que é
// justamente o aparelho que vai virar o app.
//
// Aqui o painel existe em toda largura: coluna no desktop, folha que sobe no
// celular (quem decide é o CSS da Casca, não um `window.innerWidth` em JS).
//
// O NÚMERO HERÓI: no painel antigo o valor faturado divide 268 px com outros
// dois blocos iguais e **trunca** — quanto maior a cliente, mais cedo o número
// some (§58.3). Aqui ele ocupa a coluna inteira, e o resto é apoio.

type Dados = {
  compras: { compras: number; ultima_compra: string | null; dias_sem_comprar: number | null; total_liquido: number | null; cidade: string | null; rca_oficial: string | null } | null;
  funil: { etapa: string | null; venda_valor: number | null; sem_cadastro: boolean | null } | null;
  ultimas_notas: { data_fat: string; valor: number; num_nota: number | null; filial: string | null }[];
};

export function PainelContato({
  conversa,
  aoFechar,
  aoAviso,
}: {
  conversa: Conversa;
  aoFechar: () => void;
  aoAviso?: (texto: string, ok: boolean) => void;
}) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setD(null);
    setErro(null);
    fetch(`/api/chat/contato?cliente_id=${encodeURIComponent(conversa.cliente_id)}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j?.error ?? `erro ${r.status}`)))))
      .then((j) => vivo && setD(j))
      .catch((e) => vivo && setErro(String(e.message ?? e)));
    return () => {
      // a resposta pode chegar depois de a pessoa trocar de conversa: sem esta
      // guarda, o painel da cliente A aparece dentro da conversa da cliente B
      // (§70 do CLAUDE.md, onde isso custou produção)
      vivo = false;
    };
  }, [conversa.cliente_id]);

  const c = d?.compras;
  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-v2-linha bg-v2-superficie">
      <header className="flex shrink-0 items-center gap-2 border-b border-v2-linha px-3 py-2.5">
        <h2 className="flex-1 text-[13px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">Cliente</h2>
        <button
          data-ripple
          onClick={aoFechar}
          aria-label="Fechar"
          className="grid size-8 place-items-center rounded-full text-v2-tinta-fraca hover:bg-v2-superficie-2"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className="rolagem min-h-0 flex-1 overflow-y-auto p-3">
        {erro && <p className="rounded-lg bg-v2-erro-claro px-3 py-2 text-[12.5px] text-v2-erro">{erro}</p>}

        {!d && !erro && (
          <div className="space-y-2">
            <div className="esqueleto h-16 w-full" />
            <div className="esqueleto h-10 w-full" />
            <div className="esqueleto h-24 w-full" />
          </div>
        )}

        {d && (
          <>
            {/* --- o número herói --------------------------------------- */}
            <div className="rounded-2xl bg-v2-superficie-2 p-3">
              <p className="text-[11px] uppercase tracking-wide text-v2-tinta-fraca">Comprado (líquido)</p>
              <p className="mt-0.5 text-[26px] font-bold leading-8 tabular-nums text-v2-tinta">
                {dinheiro(c?.total_liquido ?? null)}
              </p>
              <p className="mt-0.5 text-[12px] text-v2-tinta-fraca">
                {c?.compras ? `${c.compras} compras` : "sem compra registrada"}
                {c?.cidade ? ` · ${c.cidade}` : ""}
              </p>
            </div>

            {/* --- os de apoio ------------------------------------------- */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-v2-linha p-2.5">
                <p className="text-[11px] text-v2-tinta-fraca">Sem comprar há</p>
                <p className="text-[17px] font-semibold tabular-nums">
                  {c?.dias_sem_comprar != null ? `${c.dias_sem_comprar} d` : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-v2-linha p-2.5">
                <p className="text-[11px] text-v2-tinta-fraca">Faturado no mês</p>
                <p className="text-[17px] font-semibold tabular-nums">{dinheiro(d.funil?.venda_valor ?? null)}</p>
              </div>
            </div>

            <dl className="mt-3 space-y-1.5 text-[12.5px]">
              <Linha rotulo="Telefone" valor={telefoneBonito(conversa.telefone)} />
              <Linha rotulo="Código" valor={conversa.codcli ? String(conversa.codcli) : "—"} />
              <Linha rotulo="RCA oficial" valor={c?.rca_oficial ?? "—"} />
              <Linha rotulo="Etapa no board" valor={d.funil?.etapa ?? "—"} />
              <Linha rotulo="Carteira" valor={conversa.vendedor ?? (conversa.na_fila ? "na fila" : "—")} />
            </dl>

            {/* ---- dar nome (e CPF) a quem chegou pela fila ---------------
                O contato que o webhook cria tem o nome do PERFIL do WhatsApp,
                que às vezes é o próprio número. E o CPF é o que liga ao ERP: o
                reconciliador casa CPF a cada 10 min e o histórico de compra
                aparece sozinho (§43.3) — por isso a ficha aqui é só nome+CPF.

                ⚠️ Cliente JÁ vinculado não tem formulário: o cadastro é do
                WinThor e é ele que manda no nome (§46). */}
            {conversa.cliente_id.startsWith("wa:") && !conversa.codcli && (
              <div className="mt-4 rounded-2xl border border-v2-linha p-3">
                {!editando ? (
                  <button
                    data-ripple
                    onClick={() => {
                      setNome(conversa.cliente ?? "");
                      setCpf("");
                      setEditando(true);
                    }}
                    className="w-full rounded-full bg-v2-azul-claro px-3 py-2 text-[13px] font-semibold text-v2-azul"
                  >
                    Salvar contato (nome e CPF)
                  </button>
                ) : (
                  <>
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-wide text-v2-tinta-fraca">Nome</span>
                      <input
                        value={nome}
                        onChange={(e) => setNome(e.target.value)}
                        className="mt-1 h-10 w-full rounded-xl border border-v2-linha-forte px-3 focus:border-v2-azul focus:outline-none"
                      />
                    </label>
                    <label className="mt-2 block">
                      <span className="text-[11px] uppercase tracking-wide text-v2-tinta-fraca">CPF ou CNPJ</span>
                      <input
                        value={cpf}
                        onChange={(e) => setCpf(e.target.value)}
                        inputMode="numeric"
                        placeholder="só números"
                        className="mt-1 h-10 w-full rounded-xl border border-v2-linha-forte px-3 focus:border-v2-azul focus:outline-none"
                      />
                    </label>
                    <p className="mt-2 text-[11.5px] leading-4 text-v2-tinta-fraca">
                      Com o CPF preenchido, o vínculo com o cadastro do WinThor aparece em até 10 minutos, junto com o
                      histórico de compra.
                    </p>
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        data-ripple
                        onClick={() => setEditando(false)}
                        className="rounded-full px-3 py-1.5 text-[13px] text-v2-tinta-fraca"
                      >
                        Cancelar
                      </button>
                      <button
                        data-ripple
                        disabled={salvando || nome.trim().length < 2}
                        onClick={() => {
                          setSalvando(true);
                          fetch("/api/chat/contato", {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              cliente_id: conversa.cliente_id,
                              nome: nome.trim(),
                              ...(cpf.trim() ? { cpf: cpf.trim() } : {}),
                            }),
                          })
                            .then(async (r) => {
                              const j = await r.json().catch(() => ({}));
                              if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
                              return j;
                            })
                            .then((j) => {
                              setEditando(false);
                              aoAviso?.(j?.aviso ?? "Contato salvo.", true);
                            })
                            .catch((e) => aoAviso?.(String(e?.message ?? e), false))
                            .finally(() => setSalvando(false));
                        }}
                        className="rounded-full bg-v2-azul px-3 py-1.5 text-[13px] font-semibold text-white disabled:bg-v2-linha-forte"
                      >
                        {salvando ? "salvando…" : "Salvar"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {d.funil?.sem_cadastro && (
              <p className="mt-3 rounded-lg bg-v2-laranja-claro px-3 py-2 text-[12px] leading-4 text-v2-laranja">
                Não encontrei este contato no WinThor. Com o CPF preenchido, o vínculo aparece em até 10 minutos.
              </p>
            )}

            {d.ultimas_notas?.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">
                  Últimas notas
                </h3>
                <ul className="space-y-1">
                  {d.ultimas_notas.map((n, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[12.5px]">
                      <span className="tabular-nums text-v2-tinta-fraca">
                        {new Date(n.data_fat).toLocaleDateString("pt-BR", { timeZone: "America/Belem" })}
                      </span>
                      <span className="flex-1 truncate text-v2-tinta-fraca">
                        nota {n.num_nota ?? "—"}
                        {n.filial ? ` · ${n.filial}` : ""}
                      </span>
                      <span className="font-medium tabular-nums">{dinheiro(n.valor)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 shrink-0 text-v2-tinta-fraca">{rotulo}</dt>
      <dd className="min-w-0 flex-1 truncate font-medium">{valor}</dd>
    </div>
  );
}
