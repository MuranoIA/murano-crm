"use client";
import { useEffect, useMemo, useState } from "react";

type Card = {
  cliente_id: string;
  cliente: string;
  vendedor: string;
  etapa: string;
  ultima_atividade: string;
  ultima_mensagem: string | null;
  ultima_enviada_por: string | null;
};

function limpaMsg(s: string | null): string {
  return String(s ?? "").replace(/^\*[^*]+\*\s*/, "").replace(/\s+/g, " ").trim();
}

const MIN_ALERTA = 10; // cliente respondeu e vendedor está há >10 min sem responder
function ehAlerta(c: Card): boolean {
  if (c.ultima_enviada_por !== "customer") return false;
  return Date.now() - new Date(c.ultima_atividade).getTime() > MIN_ALERTA * 60 * 1000;
}

const URL_CHAT = "https://app.tallos.com.br/app/chat"; // deep link do RD Conversas (por cliente_id)

// Paleta inspirada no RD Station CRM
const RD = {
  bg: "#eef0f4",
  surface: "#ffffff",
  colHeader: "#eae5f2",
  border: "#d3dae5",
  navy: "#111d33",
  gray: "#616b79",
  grayLight: "#7d8695",
  cyan: "#0ea3dc",
  cyanSoft: "#daeffb",
  wine: "#57163f",
  wineSoft: "#efe6eb",
  cream: "#e7d7dc",
};

function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }} aria-label="Murano">
      <rect width="100" height="100" rx="18" fill="#57163f" />
      <path d="M31 74 C 31 48, 33 36, 47 28" fill="none" stroke="#e7d7dc" strokeWidth="9.5" strokeLinecap="round" />
      <path d="M53 74 C 53 48, 55 36, 69 28" fill="none" stroke="#e7d7dc" strokeWidth="9.5" strokeLinecap="round" />
    </svg>
  );
}

const COLUNAS = [
  { key: "tentativa_contato", titulo: "Tentativa de contato", status: "Nova", cor: "#1a7fee" },
  { key: "negociacao", titulo: "Negociação", status: "Em andamento", cor: "#0e9fd6" },
  { key: "pedido_emitido", titulo: "Pedido emitido", status: "Vendida", cor: "#16a34a" },
] as const;

const CoresVendedor: Record<string, string> = {
  romulo: "#ea6a08",
  kamilly: "#9333ea",
  luana: "#0d9488",
};

function tempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
function diasInativo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function ehHoje(iso: string): boolean {
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10) === hoje;
}
function dataHora(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function dataCurta(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}
const DIAS_RECONTATO = 4; // tentativa de contato parada há >= 4 dias -> recontactar
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Page() {
  const [cards, setCards] = useState<Card[]>([]);
  const [templatesHoje, setTemplatesHoje] = useState<Record<string, number>>({});
  const [templatesAutoHoje, setTemplatesAutoHoje] = useState<Record<string, number>>({});
  const [disparos, setDisparos] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [atualizado, setAtualizado] = useState<string>("—");
  const [erro, setErro] = useState<string>("");
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [sessao, setSessao] = useState<{ role: string; carteira: string | null } | null>(null);
  const [checando, setChecando] = useState(true);

  async function load() {
    try {
      const r = await fetch("/api/funil", { cache: "no-store" });
      const j = await r.json();
      if (j.error) { setErro(j.error); return; }
      setErro("");
      setCards(j.cards ?? []);
      setTemplatesHoje(j.templatesHoje ?? {});
      setTemplatesAutoHoje(j.templatesAutoHoje ?? {});
      setDisparos(j.disparos ?? {});
      setAtualizado(new Date().toLocaleTimeString("pt-BR"));
    } catch (e: any) {
      setErro(String(e?.message ?? e));
    } finally {
      setCarregando(false);
    }
  }

  async function recontatar(clienteId: string, clienteNome: string) {
    if (!confirm(`Enviar template de recontato para ${clienteNome}?\n\n⚠️ Envia uma mensagem REAL no WhatsApp (com custo).`)) return;
    setEnviando(clienteId);
    try {
      const r = await fetch("/api/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId }),
      });
      const j = await r.json();
      if (!r.ok || j.error) alert("Falha ao enviar: " + (j.error ?? r.status));
      else await load();
    } catch (e: any) {
      alert("Erro: " + (e?.message ?? e));
    } finally {
      setEnviando(null);
    }
  }

  async function sair() {
    await fetch("/api/logout", { method: "POST" });
    setSessao(null);
  }

  // checa a sessão ao montar
  useEffect(() => {
    fetch("/api/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setSessao(s))
      .catch(() => setSessao(null))
      .finally(() => setChecando(false));
  }, []);

  // carrega o board só quando autenticado
  useEffect(() => {
    if (!sessao) return;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [sessao]);

  const vendedores = useMemo(
    () => [...new Set(cards.map((c) => c.vendedor).filter(Boolean))].sort(),
    [cards]
  );
  const visiveis = useMemo(() => {
    let r = filtro === "todos" ? cards : cards.filter((c) => c.vendedor === filtro);
    const q = busca.trim().toLowerCase();
    if (q) r = r.filter((c) => (c.cliente ?? "").toLowerCase().includes(q));
    return r;
  }, [cards, filtro, busca]);
  const tplHoje =
    filtro === "todos"
      ? Object.values(templatesHoje).reduce((a, b) => a + b, 0)
      : templatesHoje[filtro] ?? 0;
  const tplAutoHoje =
    filtro === "todos"
      ? Object.values(templatesAutoHoje).reduce((a, b) => a + b, 0)
      : templatesAutoHoje[filtro] ?? 0;

  const chip = (label: string, val: string, cor?: string) => {
    const ativo = filtro === val;
    return (
      <button
        key={val}
        onClick={() => setFiltro(val)}
        style={{
          display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
          background: ativo ? RD.cyanSoft : RD.surface,
          color: ativo ? "#0b7fb0" : RD.gray,
          border: `1px solid ${ativo ? "#bfe6f8" : RD.border}`,
          borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600,
        }}
      >
        {cor && <span style={{ width: 8, height: 8, borderRadius: 8, background: cor }} />}
        {label}
      </button>
    );
  };

  if (checando) return <div style={{ padding: 40, color: RD.gray, fontSize: 14 }}>Verificando sessão…</div>;
  if (!sessao) return <Login onLogin={setSessao} />;

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ height: 3, background: RD.wine }} />
      {/* Top bar */}
      <div style={{ background: RD.surface, borderBottom: `1px solid ${RD.border}`, padding: "0 26px" }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", height: 56, display: "flex", alignItems: "center", gap: 12 }}>
          <Logo size={26} />
          <b style={{ fontSize: 16, letterSpacing: 0.2 }}>CRM</b>
          <span style={{ marginLeft: 8, color: RD.cyan, fontWeight: 700, fontSize: 14, borderBottom: `2px solid ${RD.cyan}`, paddingBottom: 18, marginTop: 20 }}>Negociações</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, background: RD.wineSoft, border: "1px solid #e8d8e1", borderRadius: 20, padding: "4px 13px 4px 5px" }}>
            <span style={{ width: 22, height: 22, borderRadius: 20, background: RD.wine, color: RD.cream, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>
              {sessao.role === "admin" ? "A" : cap(sessao.carteira ?? "?").charAt(0)}
            </span>
            <b style={{ fontSize: 12.5, color: RD.wine }}>{sessao.role === "admin" ? "Admin" : cap(sessao.carteira ?? "")}</b>
          </span>
          <button
            onClick={sair}
            style={{ background: "transparent", border: `1px solid ${RD.border}`, color: RD.gray, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            Sair
          </button>
        </div>
      </div>

      <main style={{ padding: "18px 26px", maxWidth: 1440, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="🔍  Buscar negociação..."
            style={{
              width: 240, padding: "8px 12px", fontSize: 13, color: RD.navy,
              background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 8, outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {chip("Todos", "todos")}
            {vendedores.map((v) => chip(cap(v), v, CoresVendedor[v] ?? RD.grayLight))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: RD.cyanSoft, border: "1px solid #bfe6f8", borderRadius: 10, padding: "6px 14px" }}>
              <span style={{ fontSize: 10.5, color: "#0b7fb0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>
                Templates hoje
              </span>
              <b style={{ fontSize: 18, color: "#0b7fb0", lineHeight: 1 }}>{tplHoje}</b>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f8e6ec", border: "1px solid #ecc6d2", borderRadius: 10, padding: "6px 14px" }}>
              <span style={{ fontSize: 10.5, color: "#9c1f47", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>
                Automáticos hoje
              </span>
              <b style={{ fontSize: 18, color: "#9c1f47", lineHeight: 1 }}>{tplAutoHoje}</b>
            </div>
            <span style={{ color: RD.gray, fontSize: 12.5 }}>
              {erro ? <span style={{ color: "#e5484d" }}>erro: {erro}</span> : `${visiveis.length} negociações · ${atualizado}`}
            </span>
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, alignItems: "start" }}>
          {COLUNAS.map((col) => {
            let doGrupo = visiveis.filter((c) => c.etapa === col.key);
            if (busca.trim()) {
              // na busca: ordena por data da última mensagem (mais recente primeiro) p/ separar homônimos
              doGrupo = [...doGrupo].sort(
                (a, b) => new Date(b.ultima_atividade).getTime() - new Date(a.ultima_atividade).getTime()
              );
            } else if (col.key === "tentativa_contato") {
              // ordem decrescente de inatividade: mais dias parados no topo
              doGrupo = [...doGrupo].sort(
                (a, b) => new Date(a.ultima_atividade).getTime() - new Date(b.ultima_atividade).getTime()
              );
            }
            // cards com alerta (cliente esperando >10 min) vão pro TOPO da coluna
            doGrupo = [...doGrupo.filter(ehAlerta), ...doGrupo.filter((c) => !ehAlerta(c))];
            const nHoje = doGrupo.filter((c) => ehHoje(c.ultima_atividade)).length;
            return (
              <section key={col.key} style={{ background: RD.colHeader, borderRadius: 10, border: `1px solid ${RD.border}`, overflow: "hidden" }}>
                <div style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 4, height: 15, borderRadius: 3, background: RD.wine }} />
                    <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.4, color: RD.wine, textTransform: "uppercase", textShadow: "0 1px 0 rgba(255,255,255,0.6)" }}>
                      {col.titulo}
                    </span>
                    <span style={{ color: RD.gray, fontSize: 13, fontWeight: 700 }}>({doGrupo.length})</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 20, padding: "2px 10px", fontSize: 10.5, fontWeight: 700, color: RD.gray, boxShadow: "0 1px 1px rgba(16,32,64,0.04)" }}>
                      <span style={{ width: 6, height: 6, borderRadius: 6, background: col.cor }} />
                      hoje · <b style={{ color: RD.navy, fontSize: 11.5 }}>{nHoje}</b>
                    </span>
                  </div>
                </div>

                <div style={{ padding: "4px 8px 10px", display: "flex", flexDirection: "column", gap: 8, maxHeight: "76vh", overflowY: "auto" }}>
                  {carregando && doGrupo.length === 0 ? (
                    <p style={{ color: RD.grayLight, fontSize: 13, padding: 8 }}>carregando…</p>
                  ) : doGrupo.length === 0 ? (
                    <p style={{ color: RD.grayLight, fontSize: 13, padding: 8 }}>Nenhuma negociação</p>
                  ) : (
                    <>
                    {doGrupo.slice(0, 60).map((c) => {
                      const recontactar = col.key === "tentativa_contato" && diasInativo(c.ultima_atividade) >= DIAS_RECONTATO;
                      const ultimoDisparo = col.key === "tentativa_contato" ? disparos[c.cliente_id] : undefined;
                      // disparo há MENOS de 4 dias => botão desativado (aguardando resposta).
                      // após 4 dias sem resposta, o botão TEMPLATE volta a liberar.
                      const disparoRecente = !!ultimoDisparo && diasInativo(ultimoDisparo) < DIAS_RECONTATO;
                      const alerta = ehAlerta(c);
                      return (
                        <article
                          key={c.cliente_id}
                          onClick={() => window.open(`${URL_CHAT}/${c.cliente_id}`, "rdconversas")}
                          title="Abrir conversa no RD Conversas"
                          style={{
                            cursor: "pointer",
                            background: disparoRecente ? "#fffdf5" : recontactar ? "#fdf7fb" : RD.surface,
                            border: `1px solid ${disparoRecente ? "#f3ddad" : recontactar ? "#ecdae4" : RD.border}`,
                            borderLeft: `3px solid ${disparoRecente ? "#e08a00" : recontactar ? "#57163f" : RD.border}`,
                            borderRadius: 8, padding: "11px 13px", boxShadow: "0 1px 2px rgba(16,32,64,0.05)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                            <span style={{ width: 11, height: 11, borderRadius: 3, background: col.cor }} />
                            <span style={{ fontSize: 11.5, color: RD.gray, fontWeight: 600 }}>{col.status}</span>
                            {alerta && (
                              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, color: "#dc2626", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 8, background: "#dc2626", animation: "pulse-alert 1.1s ease-in-out infinite" }} />
                                AGUARDA RESPOSTA
                              </span>
                            )}
                            {disparoRecente ? (
                              <span
                                title={`Template enviado ${tempoRelativo(ultimoDisparo!)} atrás — botão liberado após ${DIAS_RECONTATO} dias sem resposta`}
                                style={{
                                  marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5,
                                  background: "#fff7e6", color: "#b76e00", border: "1px solid #f3ddad",
                                  borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800, letterSpacing: 0.2,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: 6, background: "#e08a00" }} />
                                AGUARDANDO RESPOSTA
                              </span>
                            ) : recontactar ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); recontatar(c.cliente_id, c.cliente); }}
                                disabled={enviando === c.cliente_id}
                                title="Enviar template (mensagem real no WhatsApp)"
                                style={{
                                  marginLeft: "auto", cursor: enviando === c.cliente_id ? "wait" : "pointer",
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  background: "#f8e6ec", color: "#9c1f47", border: "1px solid #ecc6d2",
                                  borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: 6, background: "#b02350" }} />
                                {enviando === c.cliente_id ? "ENVIANDO…" : "TEMPLATE"}
                              </button>
                            ) : null}
                          </div>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: RD.navy, lineHeight: 1.3 }}>
                            {c.cliente}
                            <span style={{ marginLeft: 7, fontSize: 12, fontWeight: 600, color: RD.grayLight, whiteSpace: "nowrap" }}>
                              {dataCurta(c.ultima_atividade)}
                            </span>
                          </div>
                          {c.ultima_mensagem ? (
                            <div style={{ marginTop: 7, display: "flex", justifyContent: c.ultima_enviada_por === "customer" ? "flex-start" : "flex-end" }}>
                              <div
                                style={{
                                  maxWidth: "94%",
                                  background: c.ultima_enviada_por === "customer" ? "#f2f4f7" : "#eaf6fd",
                                  border: `1px solid ${c.ultima_enviada_por === "customer" ? "#e4e8ee" : "#cfeafb"}`,
                                  borderRadius: 12,
                                  borderTopLeftRadius: c.ultima_enviada_por === "customer" ? 3 : 12,
                                  borderTopRightRadius: c.ultima_enviada_por === "customer" ? 12 : 3,
                                  padding: "6px 9px 4px",
                                  boxShadow: "0 1px 1.5px rgba(16,32,64,0.05)",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 11.5, lineHeight: 1.35, color: RD.navy,
                                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                                  }}
                                >
                                  {limpaMsg(c.ultima_mensagem)}
                                </div>
                                <div style={{ marginTop: 2, textAlign: "right", fontSize: 9, color: RD.grayLight, letterSpacing: 0.2 }}>
                                  {dataHora(c.ultima_atividade)}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ marginTop: 3, fontSize: 11, color: RD.grayLight }}>
                              última msg · {dataHora(c.ultima_atividade)}
                            </div>
                          )}
                          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: RD.gray, fontWeight: 600 }}>
                              <span style={{ width: 7, height: 7, borderRadius: 7, background: CoresVendedor[c.vendedor] ?? RD.grayLight }} />
                              {cap(c.vendedor)}
                            </span>
                            <span style={{ color: recontactar ? "#d92d20" : RD.grayLight, fontSize: 11, fontWeight: recontactar ? 700 : 400 }}>
                              · {tempoRelativo(c.ultima_atividade)}{recontactar ? " parado" : ""}
                            </span>
                          </div>
                        </article>
                      );
                    })}
                    {doGrupo.length > 60 && (
                      <div style={{ textAlign: "center", color: RD.grayLight, fontSize: 11.5, fontWeight: 600, padding: "6px 0 2px" }}>
                        + {doGrupo.length - 60} mais
                      </div>
                    )}
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (s: { role: string; carteira: string | null }) => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function entrar(e: any) {
    e.preventDefault();
    setErro("");
    setEntrando(true);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, pass }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? "Falha no login"); return; }
      const s = await fetch("/api/session").then((x) => x.json());
      onLogin(s);
    } catch (err: any) {
      setErro(String(err?.message ?? err));
    } finally {
      setEntrando(false);
    }
  }

  const inp = { padding: "9px 12px", border: `1px solid ${RD.border}`, borderRadius: 8, fontSize: 13, outline: "none" } as const;

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 320, background: RD.surface, border: `1px solid ${RD.border}`, borderRadius: 14, padding: 28, boxShadow: "0 8px 30px rgba(16,32,64,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <Logo size={32} />
          <b style={{ fontSize: 17 }}>CRM · Funil</b>
        </div>

        <button
          disabled
          title="Disponível após configurar o Google no Supabase Auth"
          style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${RD.border}`, background: "#f7f9fb", color: RD.grayLight, fontWeight: 600, fontSize: 13, cursor: "not-allowed", marginBottom: 6 }}
        >
          Entrar com Google (em breve)
        </button>
        <div style={{ textAlign: "center", color: RD.grayLight, fontSize: 11, margin: "12px 0" }}>— ou admin —</div>

        <form onSubmit={entrar} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Usuário" autoFocus style={inp} />
          <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Senha" type="password" style={inp} />
          {erro && <div style={{ color: "#e5484d", fontSize: 12 }}>{erro}</div>}
          <button type="submit" disabled={entrando} style={{ padding: 10, borderRadius: 8, border: "none", background: RD.wine, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            {entrando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
