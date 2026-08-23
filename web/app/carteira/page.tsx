"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

// Gestão de Carteira — move contatos entre carteiras NO RD CONVERSAS.
//
// Tela de supervisão, restrita a admin (a guarda de verdade é no servidor, em
// /api/carteira; aqui é só o que a pessoa vê). Identidade Murano, mesma paleta
// de /admin e /chat.
//
// A regra que governa o desenho: a operação é LENTA por natureza — a API do RD
// sustenta ~48 chamadas por minuto e a cota é compartilhada com o ETL. Uma
// carteira inteira leva minutos. Então a tela não finge que é instantânea:
// mostra progresso real, deixa o supervisor ver quem falhou e permite repetir
// só o que falhou (a transferência é idempotente do lado do RD).

const M = {
  wine: "#621244", roxo: "#7b2d8b", roxoSoft: "#f1e6f4", azul: "#1a5fa8",
  laranja: "#dd4222", bg: "#f5edf4", surface: "#ffffff", border: "#e0cfdb",
  ink: "#241327", muted: "#9a8098", gray: "#6f5c6d", verde: "#1a6b3c",
};

const LOTE_RENDER = 200; // linhas desenhadas por vez (a maior carteira passa de 800)

type Carteira = { slug: string; cor: string | null; time: string | null; nome_rd: string | null; total: number };
type Cliente = { id: string; nome_completo: string | null; telefone: string | null; canal: string | null; carteira: string | null };
type Falha = { id: string; erro: string; recuperavel: boolean };
type Aba = "transferir" | "historico" | "conflitos";

// Conflito de atribuição: quem ATENDE (carteira no RD) x quem FATURA (RCA do WinThor).
// `classe` vem da view vw_carteira_conflito (migration 0093) e é o que separa o que
// precisa de correção do que é o negócio funcionando normalmente.
type Conflito = {
  cliente_id: string; nome_completo: string | null; codcli: number | null;
  carteira_rd: string | null; carteira_do_rca: string | null;
  rca_num: number | null; rca_nome: string | null;
  time_rd: string | null; time_rca: string | null;
  classe: "mesmo_time" | "entre_times" | "rca_fora_do_crm";
  no_board: boolean; ultima_atividade: string | null; telefone: string | null;
};
type ResumoConf = { total: number; mesmo_time: number; entre_times: number; rca_fora_do_crm: number; invisiveis: number };

type Historico = {
  id: number; cliente_id: string; nome: string | null; de_carteira: string | null; para_carteira: string;
  por: string; observacao: string | null; sucesso: boolean; erro: string | null; criada_em: string;
};

const th = {
  textAlign: "left" as const, fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
  textTransform: "uppercase" as const, color: M.muted, padding: "8px 10px",
  borderBottom: `2px solid ${M.border}`, background: M.surface, position: "sticky" as const, top: 0, zIndex: 1,
};
const td = { padding: "7px 10px", fontSize: 13, borderBottom: `1px solid ${M.bg}`, verticalAlign: "middle" as const };

function Botao({ children, onClick, cor = M.roxo, disabled, titulo }: {
  children: React.ReactNode; onClick: () => void; cor?: string; disabled?: boolean; titulo?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={titulo}
      style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", borderRadius: 8,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
        color: "#fff", background: cor, border: `1px solid ${cor}` }}>
      {children}
    </button>
  );
}

const telefoneBonito = (t: string | null) => {
  const d = String(t ?? "").replace(/\D/g, "");
  if (d.length < 10) return t ?? "—";
  const nac = d.startsWith("55") ? d.slice(2) : d;
  const ddd = nac.slice(0, 2), resto = nac.slice(2);
  return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
};

export default function Page() {
  const [aba, setAba] = useState<Aba>("transferir");
  const [carteiras, setCarteiras] = useState<Carteira[]>([]);
  const [avisoRd, setAvisoRd] = useState<string | null>(null);
  const [slug, setSlug] = useState<string>("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState("");
  const [observacao, setObservacao] = useState("");
  const [visiveis, setVisiveis] = useState(LOTE_RENDER);

  const [confirmando, setConfirmando] = useState(false);
  const [progresso, setProgresso] = useState<{ total: number; feitos: number; falhas: Falha[] } | null>(null);
  const rodando = useRef(false);

  const [historico, setHistorico] = useState<Historico[]>([]);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const [resumoConf, setResumoConf] = useState<ResumoConf | null>(null);
  const [classeConf, setClasseConf] = useState<"mesmo_time" | "entre_times" | "rca_fora_do_crm" | "todos">("mesmo_time");
  const [carregandoConf, setCarregandoConf] = useState(false);
  const [dias, setDias] = useState(30);
  const [histTruncado, setHistTruncado] = useState(false);

  // --- carga -----------------------------------------------------------------
  const carregar = useCallback(async (qualSlug: string) => {
    setCarregando(true); setErro(null);
    try {
      const r = await fetch(`/api/carteira${qualSlug ? `?slug=${encodeURIComponent(qualSlug)}` : ""}`, { cache: "no-store" });
      if (r.status === 401 || r.status === 403) { setSemAcesso(true); return; }
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "falha ao carregar");
      setCarteiras(j.carteiras ?? []);
      setAvisoRd(j.avisoRd ?? null);
      setClientes(j.clientes ?? []);
      setSelecionados(new Set());
      setVisiveis(LOTE_RENDER);
    } catch (e: any) {
      setErro(e?.message ?? "falha ao carregar");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(slug); }, [slug, carregar]);

  const carregarHistorico = useCallback(async (d: number) => {
    try {
      const r = await fetch(`/api/carteira/historico?dias=${d}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "falha");
      setHistorico(j.linhas ?? []);
      setHistTruncado(!!j.truncado);
    } catch (e: any) { setErro(e?.message ?? "falha ao carregar histórico"); }
  }, []);

  useEffect(() => { if (aba === "historico") carregarHistorico(dias); }, [aba, dias, carregarHistorico]);

  // A lista inteira cabe numa resposta (445 linhas hoje), então busca tudo uma vez e
  // filtra no cliente: trocar de classe não vale uma ida ao servidor.
  const carregarConflitos = useCallback(async () => {
    setCarregandoConf(true);
    try {
      const r = await fetch("/api/carteira/conflitos", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.erro ?? "falhou");
      setConflitos(j.linhas ?? []);
      setResumoConf(j.resumo ?? null);
    } catch { setConflitos([]); setResumoConf(null); }
    finally { setCarregandoConf(false); }
  }, []);
  useEffect(() => { if (aba === "conflitos") carregarConflitos(); }, [aba, carregarConflitos]);

  const conflitosVisiveis = useMemo(
    () => (classeConf === "todos" ? conflitos : conflitos.filter((c) => c.classe === classeConf)),
    [conflitos, classeConf]
  );

  // --- filtro local (sem nova query, como pede o desenho) ---------------------
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return clientes;
    const so = t.replace(/\D/g, "");
    return clientes.filter((c) =>
      (c.nome_completo ?? "").toLowerCase().includes(t) ||
      (so.length >= 3 && (c.telefone ?? "").includes(so)));
  }, [clientes, busca]);

  const mostrados = filtrados.slice(0, visiveis);
  const todosVisiveisMarcados = mostrados.length > 0 && mostrados.every((c) => selecionados.has(c.id));

  const alternar = (id: string) => setSelecionados((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const alternarTodos = () => setSelecionados((s) => {
    const n = new Set(s);
    if (todosVisiveisMarcados) mostrados.forEach((c) => n.delete(c.id));
    else mostrados.forEach((c) => n.add(c.id));
    return n;
  });

  const carteiraAtual = carteiras.find((c) => c.slug === slug) ?? null;
  const destinos = carteiras.filter((c) => c.slug !== slug && c.nome_rd);
  const semNoRd = carteiras.filter((c) => !c.nome_rd);

  // --- transferência em lote --------------------------------------------------
  // O servidor processa o que couber no tempo dele e devolve `restantes`; aqui a
  // gente reenvia até esvaziar. É o mesmo padrão de orçamento do ETL: trabalho
  // limitado por chamada, continuidade explícita.
  const transferir = async () => {
    if (rodando.current) return;
    rodando.current = true;
    setConfirmando(false); setErro(null); setOk(null);

    let fila = [...selecionados];
    const total = fila.length;
    let feitos = 0;
    const falhas: Falha[] = [];
    setProgresso({ total, feitos, falhas: [] });

    try {
      while (fila.length) {
        const r = await fetch("/api/carteira", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ para: destino, ids: fila, observacao: observacao || null }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? "falha na transferência");

        feitos += j.feitos ?? 0;
        falhas.push(...(j.falhas ?? []));
        if (j.avisoEspelho) setErro(j.avisoEspelho);
        setProgresso({ total, feitos, falhas: [...falhas] });
        fila = j.restantes ?? [];
      }
      const nome = carteiras.find((c) => c.slug === destino)?.slug ?? destino;
      setOk(`${feitos} de ${total} transferido(s) para ${nome}.${falhas.length ? ` ${falhas.length} falhou/falharam.` : ""}`);
      await carregar(slug);
    } catch (e: any) {
      setErro(e?.message ?? "falha na transferência");
    } finally {
      rodando.current = false;
    }
  };

  const repetirFalhas = () => {
    if (!progresso?.falhas.length) return;
    setSelecionados(new Set(progresso.falhas.map((f) => f.id)));
    setProgresso(null);
    setConfirmando(true);
  };

  // --- telas ------------------------------------------------------------------
  if (semAcesso) {
    return (
      <Moldura aba={aba} setAba={setAba} esconder>
        <Cartao>
          <div style={{ fontSize: 14, color: M.gray }}>
            Esta tela é restrita a administradores. Se você precisa transferir carteiras, peça a liberação do papel <b>admin</b>.
          </div>
        </Cartao>
      </Moldura>
    );
  }

  return (
    <Moldura aba={aba} setAba={setAba}>
      {erro && <Faixa cor={M.laranja}>{erro}</Faixa>}
      {ok && <Faixa cor={M.verde}>{ok}</Faixa>}
      {avisoRd && <Faixa cor={M.laranja}>{avisoRd}</Faixa>}

      {aba === "transferir" && (
        <>
          {/* Bloco 1 — seletor de carteira */}
          <Cartao titulo="Carteira de origem"
            ajuda="A contagem vem do nosso espelho (clientes.carteira), que o ETL preenche a partir do RD.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {carteiras.map((c) => (
                <button key={c.slug} onClick={() => { setSlug(c.slug === slug ? "" : c.slug); setBusca(""); setProgresso(null); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 999,
                    fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                    color: slug === c.slug ? "#fff" : M.ink,
                    background: slug === c.slug ? M.roxo : M.surface,
                    border: `1px solid ${slug === c.slug ? M.roxo : M.border}`,
                  }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: c.cor ?? M.muted, display: "inline-block" }} />
                  {c.slug}
                  <span style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.75 }}>{c.total}</span>
                  {!c.nome_rd && <span title="não existe no RD Conversas — não pode receber transferências">⚠️</span>}
                </button>
              ))}
            </div>
            {semNoRd.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: M.laranja }}>
                ⚠️ Sem carteira correspondente no RD: <b>{semNoRd.map((c) => c.slug).join(", ")}</b>. Crie no painel do RD para poder transferir para elas.
              </div>
            )}
          </Cartao>

          {!slug && !carregando && (
            <Cartao><div style={{ fontSize: 14, color: M.gray }}>Escolha uma carteira acima para ver os clientes.</div></Cartao>
          )}

          {slug && (
            <Cartao titulo={`Clientes de ${slug}`}>
              {carregando ? (
                <div style={{ fontSize: 13, color: M.muted }}>Carregando…</div>
              ) : clientes.length === 0 ? (
                <div style={{ fontSize: 14, color: M.gray }}>Esta carteira está sem clientes.</div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                    <input value={busca} onChange={(e) => { setBusca(e.target.value); setVisiveis(LOTE_RENDER); }}
                      placeholder="Buscar por nome ou telefone…"
                      style={{ flex: "1 1 240px", padding: "8px 10px", fontSize: 13, fontFamily: "inherit", color: M.ink,
                        background: M.surface, border: `1px solid ${M.border}`, borderRadius: 8, outline: "none" }} />
                    <div style={{ fontSize: 12.5, color: M.gray }}>
                      {filtrados.length} de {clientes.length}
                      {selecionados.size > 0 && <> · <b style={{ color: M.roxo }}>{selecionados.size} selecionado(s)</b></>}
                    </div>
                    {selecionados.size > 0 && (
                      <button onClick={() => setSelecionados(new Set())}
                        style={{ fontSize: 12, fontFamily: "inherit", background: "none", border: "none", color: M.gray, cursor: "pointer", textDecoration: "underline" }}>
                        limpar seleção
                      </button>
                    )}
                  </div>

                  <div onScroll={(e) => {
                        const el = e.currentTarget;
                        if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
                          setVisiveis((v) => (v < filtrados.length ? v + LOTE_RENDER : v));
                        }
                      }}
                    style={{ maxHeight: 460, overflowY: "auto", border: `1px solid ${M.border}`, borderRadius: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ ...th, width: 36 }}>
                            <input type="checkbox" checked={todosVisiveisMarcados} onChange={alternarTodos}
                              title="Selecionar/limpar os visíveis" />
                          </th>
                          <th style={th}>Nome</th>
                          <th style={th}>Telefone</th>
                          <th style={th}>Canal</th>
                          <th style={th}>Carteira</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mostrados.map((c) => (
                          <tr key={c.id} onClick={() => alternar(c.id)}
                            style={{ cursor: "pointer", background: selecionados.has(c.id) ? M.roxoSoft : "transparent" }}>
                            <td style={td}>
                              <input type="checkbox" checked={selecionados.has(c.id)} onChange={() => alternar(c.id)}
                                onClick={(e) => e.stopPropagation()} />
                            </td>
                            <td style={{ ...td, fontWeight: 600 }}>{c.nome_completo ?? <span style={{ color: M.muted }}>sem nome</span>}</td>
                            <td style={{ ...td, color: M.gray }}>{telefoneBonito(c.telefone)}</td>
                            <td style={{ ...td, color: M.gray }}>{c.canal ?? "—"}</td>
                            <td style={{ ...td, color: M.gray }}>{c.carteira ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {visiveis < filtrados.length && (
                      <div style={{ padding: 10, textAlign: "center", fontSize: 12, color: M.muted }}>
                        mostrando {mostrados.length} de {filtrados.length} — role para carregar mais
                      </div>
                    )}
                  </div>

                  {/* Bloco 3 — barra de ações */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
                    <select value={destino} onChange={(e) => setDestino(e.target.value)}
                      style={{ padding: "8px 10px", fontSize: 13, fontFamily: "inherit", color: M.ink,
                        background: M.surface, border: `1px solid ${M.border}`, borderRadius: 8 }}>
                      <option value="">Transferir para…</option>
                      {destinos.map((c) => <option key={c.slug} value={c.slug}>{c.slug}{c.time ? ` (${c.time})` : ""}</option>)}
                    </select>
                    <input value={observacao} onChange={(e) => setObservacao(e.target.value)}
                      placeholder="Observação (opcional)"
                      style={{ flex: "1 1 200px", padding: "8px 10px", fontSize: 13, fontFamily: "inherit", color: M.ink,
                        background: M.surface, border: `1px solid ${M.border}`, borderRadius: 8, outline: "none" }} />
                    <Botao onClick={() => setConfirmando(true)}
                      disabled={!selecionados.size || !destino || !!progresso}
                      titulo={!destino ? "Escolha o destino" : !selecionados.size ? "Selecione ao menos um cliente" : undefined}>
                      Transferir {selecionados.size || ""} cliente{selecionados.size === 1 ? "" : "s"}
                    </Botao>
                  </div>
                </>
              )}
            </Cartao>
          )}

          {progresso && (
            <Cartao titulo="Transferência">
              <Progresso p={progresso} />
              {progresso.falhas.length > 0 && progresso.feitos + progresso.falhas.length >= progresso.total && (
                <div style={{ marginTop: 12 }}>
                  <Botao onClick={repetirFalhas} cor={M.laranja}>Repetir as {progresso.falhas.length} que falharam</Botao>
                  <span style={{ marginLeft: 10, fontSize: 12, color: M.gray }}>
                    repetir é seguro: o RD aceita a mesma atribuição de novo
                  </span>
                </div>
              )}
              {progresso.feitos + progresso.falhas.length >= progresso.total && (
                <button onClick={() => setProgresso(null)}
                  style={{ marginLeft: 10, marginTop: 12, fontSize: 12, fontFamily: "inherit", background: "none", border: "none", color: M.gray, cursor: "pointer", textDecoration: "underline" }}>
                  fechar
                </button>
              )}
            </Cartao>
          )}
        </>
      )}

      {aba === "historico" && (
        <Cartao titulo="Histórico de transferências">
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {[7, 30].map((d) => (
              <button key={d} onClick={() => setDias(d)}
                style={{ padding: "5px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", borderRadius: 8, cursor: "pointer",
                  color: dias === d ? "#fff" : M.gray, background: dias === d ? M.roxo : M.surface,
                  border: `1px solid ${dias === d ? M.roxo : M.border}` }}>
                últimos {d} dias
              </button>
            ))}
          </div>
          {historico.length === 0 ? (
            <div style={{ fontSize: 14, color: M.gray }}>Nenhuma transferência no período.</div>
          ) : (
            <>
              {histTruncado && (
                <div style={{ fontSize: 12, color: M.laranja, marginBottom: 8 }}>
                  Mostrando as 500 mais recentes — há mais no período.
                </div>
              )}
              <div style={{ maxHeight: 520, overflowY: "auto", border: `1px solid ${M.border}`, borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Quando</th><th style={th}>Cliente</th><th style={th}>De</th>
                      <th style={th}>Para</th><th style={th}>Por</th><th style={th}>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((h) => (
                      <tr key={h.id}>
                        <td style={{ ...td, color: M.gray, whiteSpace: "nowrap" }}>
                          {new Date(h.criada_em).toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" })}
                        </td>
                        <td style={{ ...td, fontWeight: 600 }}>{h.nome ?? h.cliente_id}</td>
                        <td style={{ ...td, color: M.gray }}>{h.de_carteira ?? "—"}</td>
                        <td style={{ ...td, fontWeight: 600, color: M.roxo }}>{h.para_carteira}</td>
                        <td style={{ ...td, color: M.gray, fontSize: 12 }}>{h.por}</td>
                        <td style={td}>
                          {h.sucesso
                            ? <span style={{ color: M.verde, fontWeight: 700, fontSize: 12 }}>✓ ok</span>
                            : <span style={{ color: M.laranja, fontWeight: 700, fontSize: 12 }} title={h.erro ?? ""}>✕ {h.erro ?? "falhou"}</span>}
                          {h.observacao && <div style={{ fontSize: 11, color: M.muted }}>{h.observacao}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Cartao>
      )}

      {aba === "conflitos" && (
        <Cartao titulo="Conflitos de atribuição">
          <div style={{ fontSize: 13, color: M.gray, lineHeight: 1.55, marginBottom: 12 }}>
            Duas atribuições convivem e podem discordar: <b>quem atende</b> (carteira no RD
            Conversas) e <b>quem fatura</b> (RCA oficial no WinThor). Discordar nem sempre é erro —
            o IS e o ISR atendem muito cliente cujo RCA pertence a outra equipe. Por isso a lista
            vem separada: só o primeiro grupo pede correção.
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {([
              ["mesmo_time", `Precisa corrigir (${resumoConf?.mesmo_time ?? 0})`, "Quem atende e quem fatura são do MESMO time e mesmo assim discordam — quase sempre transferência feita de um lado só."],
              ["entre_times", `Entre times (${resumoConf?.entre_times ?? 0})`, "Times diferentes, ambos no CRM. Pode ser legítimo."],
              ["rca_fora_do_crm", `RCA fora do CRM (${resumoConf?.rca_fora_do_crm ?? 0})`, "O RCA oficial não é de nenhuma carteira ativa (GC ou vendedor de fora). Normal — mas estes clientes NÃO aparecem no board nem no chat."],
              ["todos", `Todos (${resumoConf?.total ?? 0})`, "A lista inteira."],
            ] as const).map(([id, rotulo, dica]) => (
              <button key={id} onClick={() => setClasseConf(id as any)} title={dica}
                style={{ padding: "5px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", borderRadius: 8, cursor: "pointer",
                  color: classeConf === id ? "#fff" : M.gray,
                  background: classeConf === id ? (id === "mesmo_time" ? M.laranja : M.roxo) : M.surface,
                  border: `1px solid ${classeConf === id ? (id === "mesmo_time" ? M.laranja : M.roxo) : M.border}` }}>
                {rotulo}
              </button>
            ))}
          </div>

          {!!resumoConf?.invisiveis && (
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, background: "#fff7ed", border: `1px solid #f0c987`, borderRadius: 8, padding: "9px 12px", marginBottom: 12 }}>
              <b>{resumoConf.invisiveis} clientes com conversa não aparecem no board nem no chat.</b>{" "}
              O board só mostra quem tem vínculo com um RCA de carteira ativa; quando o RCA oficial é
              de outra equipe, o cliente some da tela mesmo estando em atendimento. Corrigir exige
              decidir de quem é o cliente — não é ajuste de tela.
            </div>
          )}

          {carregandoConf ? (
            <div style={{ fontSize: 14, color: M.gray }}>Carregando…</div>
          ) : conflitosVisiveis.length === 0 ? (
            <div style={{ fontSize: 14, color: M.gray }}>Nenhum conflito neste grupo.</div>
          ) : (
            <div style={{ maxHeight: 560, overflowY: "auto", border: `1px solid ${M.border}`, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Cliente</th><th style={th}>Atende (RD)</th>
                    <th style={th}>Fatura (RCA)</th><th style={th}>Última atividade</th><th style={th}>No board</th>
                  </tr>
                </thead>
                <tbody>
                  {conflitosVisiveis.slice(0, LOTE_RENDER).map((c) => (
                    <tr key={c.cliente_id}>
                      <td style={{ ...td, fontWeight: 600 }}>
                        {c.nome_completo ?? c.cliente_id}
                        <div style={{ fontSize: 11, color: M.muted }}>
                          {telefoneBonito(c.telefone)}{c.codcli ? ` · cod ${c.codcli}` : ""}
                        </div>
                      </td>
                      <td style={{ ...td, color: M.roxo, fontWeight: 700 }}>
                        {c.carteira_rd ?? "—"}
                        {c.time_rd && <span style={{ color: M.muted, fontWeight: 600, fontSize: 11 }}> · {c.time_rd}</span>}
                      </td>
                      <td style={td}>
                        <span style={{ fontWeight: 700 }}>{c.carteira_do_rca ?? "fora do CRM"}</span>
                        <div style={{ fontSize: 11, color: M.muted }}>{c.rca_nome ?? `RCA ${c.rca_num ?? "—"}`}</div>
                      </td>
                      <td style={{ ...td, color: M.gray, whiteSpace: "nowrap", fontSize: 12 }}>
                        {c.ultima_atividade
                          ? new Date(c.ultima_atividade).toLocaleDateString("pt-BR", { timeZone: "America/Belem" })
                          : "sem conversa"}
                      </td>
                      <td style={td}>
                        {c.no_board
                          ? <span style={{ color: M.verde, fontWeight: 700, fontSize: 12 }}>✓ sim</span>
                          : <span style={{ color: M.laranja, fontWeight: 700, fontSize: 12 }} title="Invisível no board e no chat">✕ não</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {conflitosVisiveis.length > LOTE_RENDER && (
                <div style={{ fontSize: 12, color: M.gray, padding: "8px 10px" }}>
                  Mostrando {LOTE_RENDER} de {conflitosVisiveis.length}.
                </div>
              )}
            </div>
          )}
        </Cartao>
      )}

      {confirmando && (
        <Confirmacao
          quantos={selecionados.size}
          de={carteiraAtual?.slug ?? "—"}
          para={destino}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={transferir}
        />
      )}
    </Moldura>
  );
}

// --- peças ------------------------------------------------------------------

function Progresso({ p }: { p: { total: number; feitos: number; falhas: Falha[] } }) {
  const tratados = p.feitos + p.falhas.length;
  const pct = p.total ? Math.round((tratados / p.total) * 100) : 0;
  const terminou = tratados >= p.total;
  return (
    <>
      <div style={{ fontSize: 13, color: M.ink, fontWeight: 600 }}>
        {terminou ? "Concluída" : `Transferindo ${tratados + 1} de ${p.total}…`}
        {" "}<span style={{ color: M.gray, fontWeight: 400 }}>({p.feitos} ok{p.falhas.length ? `, ${p.falhas.length} com falha` : ""})</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: M.bg, marginTop: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: p.falhas.length ? M.laranja : M.roxo, transition: "width .3s" }} />
      </div>
      {!terminou && (
        <div style={{ fontSize: 11.5, color: M.muted, marginTop: 6 }}>
          A API do RD aceita cerca de 48 chamadas por minuto, e essa cota é dividida com a sincronização.
          Pode deixar a aba aberta — a transferência continua de onde parou a cada bloco.
        </div>
      )}
      {p.falhas.length > 0 && (
        <div style={{ marginTop: 10, maxHeight: 160, overflowY: "auto", border: `1px solid ${M.border}`, borderRadius: 8 }}>
          {p.falhas.map((f) => (
            <div key={f.id} style={{ padding: "6px 10px", fontSize: 12, borderBottom: `1px solid ${M.bg}`, color: M.gray }}>
              <b style={{ color: M.ink }}>{f.id}</b> — {f.erro}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Confirmacao({ quantos, de, para, onCancelar, onConfirmar }: {
  quantos: number; de: string; para: string; onCancelar: () => void; onConfirmar: () => void;
}) {
  return (
    <div onClick={onCancelar}
      style={{ position: "fixed", inset: 0, background: "rgba(36,19,39,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: M.surface, borderRadius: 12, padding: 20, maxWidth: 460, width: "100%", border: `1px solid ${M.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: M.wine, marginBottom: 10 }}>Confirmar transferência</div>
        <div style={{ fontSize: 14, color: M.ink, lineHeight: 1.5 }}>
          Transferir <b>{quantos}</b> cliente{quantos === 1 ? "" : "s"} de <b>{de}</b> para <b>{para}</b>?
        </div>
        <div style={{ fontSize: 12, color: M.gray, marginTop: 12, lineHeight: 1.5 }}>
          A mudança vale no <b>RD Conversas</b> e no CRM. Ela <b>não</b> altera o RCA do WinThor —
          até o ERP ser ajustado, esses clientes aparecem como divergência de carteira.
          <br />
          Não há como desfazer pela API: dá para mover de volta para outra carteira, nunca para “sem carteira”.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onCancelar}
            style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", borderRadius: 8, cursor: "pointer",
              color: M.gray, background: M.surface, border: `1px solid ${M.border}` }}>
            Cancelar
          </button>
          <Botao onClick={onConfirmar}>Transferir</Botao>
        </div>
      </div>
    </div>
  );
}

function Faixa({ cor, children }: { cor: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "9px 12px", borderRadius: 8, background: M.surface, border: `1px solid ${cor}`, color: cor, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Cartao({ titulo, ajuda, children }: { titulo?: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: M.surface, border: `1px solid ${M.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      {titulo && <div style={{ fontSize: 14, fontWeight: 800, color: M.wine, marginBottom: ajuda ? 4 : 12 }}>{titulo}</div>}
      {ajuda && <div style={{ fontSize: 12, color: M.muted, marginBottom: 12 }}>{ajuda}</div>}
      {children}
    </div>
  );
}

function Moldura({ aba, setAba, esconder, children }: {
  aba: Aba; setAba: (a: Aba) => void;
  esconder?: boolean; children: React.ReactNode;
}) {
  const abas = [
    { id: "transferir" as const, rotulo: "↪ Transferir" },
    { id: "historico" as const, rotulo: "🕘 Histórico" },
    { id: "conflitos" as const, rotulo: "⚠️ Conflitos" },
  ];
  return (
    <div style={{ minHeight: "100vh", background: M.bg, color: M.ink, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${M.laranja}, ${M.wine}, ${M.roxo})` }} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 18px", background: M.surface, borderBottom: `1px solid ${M.border}`, flexWrap: "wrap" }}>
        <Link href="/admin" style={{ color: M.gray, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Administração</Link>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: M.wine }}>🗂️ Gestão de Carteira</div>
        {!esconder && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {abas.map((a) => (
              <button key={a.id} onClick={() => setAba(a.id)}
                style={{ padding: "6px 13px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", borderRadius: 8,
                  color: aba === a.id ? "#fff" : M.gray, background: aba === a.id ? M.roxo : M.bg,
                  border: `1px solid ${aba === a.id ? M.roxo : M.border}` }}>
                {a.rotulo}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "20px 18px 60px" }}>{children}</div>
    </div>
  );
}
