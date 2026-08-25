"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { aplicarVariaveis } from "../../lib/templateVars";

// Painel administrativo — reúne o que até aqui só existia no SQL Editor do
// Supabase: quem entra no sistema, quais são os vendedores, o horário de
// atendimento e as linhas de WhatsApp. Também o cadastro de templates do
// WhatsApp e o disparo em massa, que é onde uma campanha é montada.
//
// O que NÃO entra aqui, de propósito: metas, música dos parabéns e respostas
// rápidas já têm tela onde são usadas (board e chat). Trazer tudo para cá
// afastaria a configuração do lugar onde ela faz sentido.
//
// Identidade Murano, mesma paleta de /chat e /chat/indicadores.
const M = {
  wine: "#621244", roxo: "#7b2d8b", roxoSoft: "#f1e6f4", azul: "#1a5fa8",
  laranja: "#dd4222", bg: "#f5edf4", surface: "#ffffff", border: "#e0cfdb",
  ink: "#241327", muted: "#9a8098", gray: "#6f5c6d", verde: "#1a6b3c",
};

type Aba = "usuarios" | "carteiras" | "horario" | "linhas" | "templates-whatsapp" | "paginas-legais" | "chat-layout" | "crm-config" | "pendencias";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "usuarios", rotulo: "👥 Usuários" },
  { id: "carteiras", rotulo: "🧑‍💼 Vendedores" },
  { id: "horario", rotulo: "🕗 Horário" },
  { id: "linhas", rotulo: "📞 Linhas" },
  { id: "templates-whatsapp", rotulo: "📨 Templates" },
  { id: "chat-layout", rotulo: "🎨 Desenho do chat" },
  { id: "crm-config", rotulo: "⚙️ Mecanismos" },
  { id: "pendencias", rotulo: "⚠️ Pendências" },
  { id: "paginas-legais", rotulo: "📄 Páginas legais" },
];

const cap = (s: any) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");

const PAPEIS = ["admin", "home", "vendedor"] as const;
const DIAS = [
  { n: 0, r: "Dom" }, { n: 1, r: "Seg" }, { n: 2, r: "Ter" }, { n: 3, r: "Qua" },
  { n: 4, r: "Qui" }, { n: 5, r: "Sex" }, { n: 6, r: "Sáb" },
];
const TIMES = [
  { v: "", r: "—" }, { v: "IS", r: "IS — vendas internas" },
  { v: "GC", r: "GC — grandes contas" }, { v: "ISR", r: "ISR — reativação" },
];

// --- peças de UI -----------------------------------------------------------
const inputBase = {
  padding: "7px 9px", fontSize: 13, fontFamily: "inherit", color: M.ink,
  background: M.surface, border: `1px solid ${M.border}`, borderRadius: 7, outline: "none",
};
const th = {
  textAlign: "left" as const, fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
  textTransform: "uppercase" as const, color: M.muted, padding: "8px 10px", borderBottom: `2px solid ${M.border}`,
};
const td = { padding: "8px 10px", fontSize: 13, borderBottom: `1px solid ${M.bg}`, verticalAlign: "middle" as const };

function Botao({ children, onClick, cor = M.roxo, disabled, titulo }: {
  children: React.ReactNode; onClick: () => void; cor?: string; disabled?: boolean; titulo?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={titulo}
      style={{ padding: "6px 13px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", borderRadius: 8,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
        color: "#fff", background: cor, border: `1px solid ${cor}` }}>
      {children}
    </button>
  );
}

function BotaoLeve({ children, onClick, cor = M.gray, titulo }: {
  children: React.ReactNode; onClick: () => void; cor?: string; titulo?: string;
}) {
  return (
    <button onClick={onClick} title={titulo}
      style={{ padding: "6px 11px", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", borderRadius: 8,
        cursor: "pointer", color: cor, background: "transparent", border: `1px solid ${M.border}` }}>
      {children}
    </button>
  );
}

function Recado({ tipo, children }: { tipo: "erro" | "ok" | "aviso"; children: React.ReactNode }) {
  const cor = tipo === "erro" ? "#b3261e" : tipo === "ok" ? M.verde : "#8a6100";
  const fundo = tipo === "erro" ? "rgba(179,38,30,.07)" : tipo === "ok" ? "rgba(26,107,60,.08)" : "rgba(221,160,34,.12)";
  return (
    <div style={{ margin: "0 0 14px", padding: "9px 12px", fontSize: 13, fontWeight: 600, lineHeight: 1.5,
      color: cor, background: fundo, border: `1px solid ${cor}33`, borderRadius: 8 }}>
      {children}
    </div>
  );
}

function Bloco({ titulo, ajuda, children }: { titulo: string; ajuda?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: M.surface, border: `1px solid ${M.border}`, borderRadius: 12, padding: 18, marginBottom: 18 }}>
      <h2 style={{ fontSize: 15, fontWeight: 800, color: M.wine, margin: "0 0 4px" }}>{titulo}</h2>
      {ajuda && <p style={{ fontSize: 12.5, color: M.gray, margin: "0 0 14px", lineHeight: 1.55 }}>{ajuda}</p>}
      {children}
    </section>
  );
}

const Selo = ({ ok, sim, nao }: { ok: boolean; sim: string; nao: string }) => (
  <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap",
    color: ok ? M.verde : M.muted, background: ok ? "rgba(26,107,60,.1)" : M.bg,
    border: `1px solid ${ok ? "rgba(26,107,60,.25)" : M.border}` }}>
    {ok ? sim : nao}
  </span>
);

// --- página ----------------------------------------------------------------
export default function Admin() {
  const [aba, setAba] = useState<Aba>("usuarios");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [semPermissao, setSemPermissao] = useState(false);
  const [carregando, setCarregando] = useState(false);

  const [dados, setDados] = useState<any>(null);
  const [edicoes, setEdicoes] = useState<Record<string, any>>({});
  const [novo, setNovo] = useState<any>({});

  const carregar = useCallback(async (qual: Aba) => {
    setCarregando(true); setErro(null); setEdicoes({});
    try {
      const r = await fetch(`/api/admin/${qual}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.status === 403) { setSemPermissao(true); return; }
      if (!r.ok) { setErro(j?.error ?? `erro ${r.status}`); return; }
      setDados(j);
    } catch (e: any) {
      setErro(e?.message ?? String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(aba); }, [aba, carregar]);

  // Pendências é a única aba com filtro no servidor (grupo), então tem o próprio
  // carregador — o genérico monta a URL sem querystring.
  const carregarPendencias = useCallback(async (grupo: string | null) => {
    setCarregando(true); setErro(null);
    try {
      const r = await fetch(`/api/admin/pendencias${grupo ? `?grupo=${encodeURIComponent(grupo)}` : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j?.error ?? `erro ${r.status}`); return; }
      setDados(j);
    } catch (e: any) { setErro(e?.message ?? String(e)); }
    finally { setCarregando(false); }
  }, []);

  // Identidade estável de propósito: `avisar` entra nas dependências do efeito
  // que busca a prévia do disparo, que varre a vw_funil inteira. Recriado a
  // cada render, faria a prévia ser refeita sem nada ter mudado.
  const avisar = useCallback((t: "erro" | "ok", m: string) => {
    if (t === "erro") setErro(m); else setOk(m);
  }, []);

  async function enviar(qual: Aba, metodo: "POST" | "PATCH" | "PUT", corpo: any, sucesso: string) {
    setErro(null); setOk(null);
    try {
      const r = await fetch(`/api/admin/${qual}`, {
        method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j?.error ?? `erro ${r.status}`); return false; }
      setOk(j?.aviso ? `${sucesso} ${j.aviso}` : sucesso);
      setNovo({});
      await carregar(qual);
      return true;
    } catch (e: any) {
      setErro(e?.message ?? String(e));
      return false;
    }
  }

  // valor corrente de um campo: o que está sendo editado, ou o que veio do banco
  const val = (chave: string, campo: string, original: any) =>
    edicoes[chave]?.[campo] !== undefined ? edicoes[chave][campo] : original;
  const editar = (chave: string, campo: string, valor: any) =>
    setEdicoes((e) => ({ ...e, [chave]: { ...e[chave], [campo]: valor } }));
  const sujo = (chave: string) => !!edicoes[chave] && Object.keys(edicoes[chave]).length > 0;

  if (semPermissao) {
    return (
      <Moldura aba={aba} setAba={() => {}} esconderAbas>
        <Recado tipo="erro">
          Esta área é restrita a administradores. Se você precisa de acesso, peça a um admin — ele consegue
          liberar aqui mesmo, na aba Usuários.
        </Recado>
      </Moldura>
    );
  }

  return (
    <Moldura aba={aba} setAba={(a) => { setAba(a); setOk(null); setErro(null); }}>
      {erro && <Recado tipo="erro">{erro}</Recado>}
      {ok && <Recado tipo="ok">{ok}</Recado>}
      {carregando && !dados && <p style={{ fontSize: 13, color: M.gray }}>Carregando…</p>}

      {aba === "usuarios" && dados?.usuarios && (
        <>
          <Bloco
            titulo="Quem entra no sistema"
            ajuda={<>
              <b>Papel de entrada</b> é como a pessoa entra ao logar. <b>Pode assumir</b> são os chapéus que
              ela alterna sem sair da conta. Vendedor enxerga só a própria carteira; <i>home</i> vê todas
              sem as funções administrativas; <i>admin</i> vê tudo.
            </>}
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
                <thead><tr>
                  <th style={th}>E-mail</th><th style={th}>Papel de entrada</th><th style={th}>Pode assumir</th>
                  <th style={th}>Carteira</th><th style={th}>Situação</th><th style={th} />
                </tr></thead>
                <tbody>
                  {dados.usuarios.map((u: any) => {
                    const euMesmo = dados.eu && dados.eu.toLowerCase() === u.email.toLowerCase();
                    const papeis: string[] = val(u.email, "papeis", u.papeis ?? [u.papel]);
                    return (
                      <tr key={u.email} style={{ background: euMesmo ? M.roxoSoft : undefined, opacity: u.ativo ? 1 : 0.55 }}>
                        <td style={{ ...td, fontWeight: 600 }}>
                          {u.email}{euMesmo && <span style={{ fontSize: 11, color: M.roxo, marginLeft: 6 }}>(você)</span>}
                        </td>
                        <td style={td}>
                          <select value={val(u.email, "papel", u.papel)} onChange={(e) => editar(u.email, "papel", e.target.value)}
                            style={{ ...inputBase, padding: "5px 7px" }}>
                            {PAPEIS.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                            {PAPEIS.map((p) => (
                              <label key={p} style={{ fontSize: 12, color: M.gray, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                                <input type="checkbox" checked={papeis.includes(p)}
                                  onChange={(e) => editar(u.email, "papeis",
                                    e.target.checked ? [...papeis, p] : papeis.filter((x) => x !== p))} />
                                {p}
                              </label>
                            ))}
                          </div>
                        </td>
                        <td style={td}>
                          <select value={val(u.email, "carteira", u.carteira ?? "")} onChange={(e) => editar(u.email, "carteira", e.target.value)}
                            style={{ ...inputBase, padding: "5px 7px" }}>
                            <option value="">—</option>
                            {dados.carteiras.map((c: string) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td style={td}><Selo ok={u.ativo} sim="ativo" nao="inativo" /></td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          {sujo(u.email) && (
                            <span style={{ marginRight: 6 }}>
                              <Botao onClick={() => enviar("usuarios", "PATCH", { email: u.email, ...edicoes[u.email] }, "Acesso atualizado.")}>
                                Salvar
                              </Botao>
                            </span>
                          )}
                          <BotaoLeve cor={u.ativo ? M.laranja : M.verde}
                            titulo={u.ativo ? "Tira o acesso, mantendo o histórico" : "Devolve o acesso"}
                            onClick={() => enviar("usuarios", "PATCH", { email: u.email, ativo: !u.ativo },
                              u.ativo ? "Acesso desativado." : "Acesso reativado.")}>
                            {u.ativo ? "Desativar" : "Reativar"}
                          </BotaoLeve>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Bloco>

          <Bloco titulo="Liberar acesso a alguém" ajuda="O e-mail precisa ser o mesmo da conta Google que a pessoa usa para entrar.">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input placeholder="pessoa@muranoprofessional.com.br" value={novo.email ?? ""}
                onChange={(e) => setNovo({ ...novo, email: e.target.value })} style={{ ...inputBase, minWidth: 280, flex: 1 }} />
              <select value={novo.papel ?? "vendedor"} onChange={(e) => setNovo({ ...novo, papel: e.target.value })} style={inputBase}>
                {PAPEIS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={novo.carteira ?? ""} onChange={(e) => setNovo({ ...novo, carteira: e.target.value })} style={inputBase}>
                <option value="">sem carteira</option>
                {dados.carteiras.map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Botao onClick={() => enviar("usuarios", "POST",
                { email: novo.email, papel: novo.papel ?? "vendedor", papeis: [novo.papel ?? "vendedor"], carteira: novo.carteira },
                "Acesso liberado.")}>
                Liberar acesso
              </Botao>
            </div>
          </Bloco>
        </>
      )}

      {aba === "carteiras" && dados?.carteiras && (
        <>
          <Bloco
            titulo="Vendedores e carteiras"
            ajuda={<>
              O <b>apelido</b> é a chave usada no sistema inteiro — nos clientes, nas mensagens e nas views —
              e por isso não muda depois de criado. O <b>RCA</b> liga ao WinThor e é o que traz o faturamento
              real. Carteira não se apaga: desativar tira da operação e preserva o histórico.
            </>}
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead><tr>
                  <th style={th}>Apelido</th><th style={th}>RCA</th><th style={th}>Time</th>
                  <th style={th}>ID no RD</th><th style={th}>Cor</th><th style={th}>Clientes</th>
                  <th style={th}>Situação</th><th style={th} />
                </tr></thead>
                <tbody>
                  {dados.carteiras.map((c: any) => (
                    <tr key={c.slug} style={{ opacity: c.ativo ? 1 : 0.55 }}>
                      <td style={{ ...td, fontWeight: 700 }}>{c.slug}</td>
                      <td style={td}>
                        <input value={val(c.slug, "rca_num", c.rca_num ?? "")} onChange={(e) => editar(c.slug, "rca_num", e.target.value)}
                          style={{ ...inputBase, width: 62, padding: "5px 7px" }} />
                      </td>
                      <td style={td}>
                        <select value={val(c.slug, "time", c.time ?? "")} onChange={(e) => editar(c.slug, "time", e.target.value)}
                          style={{ ...inputBase, padding: "5px 7px" }}>
                          {TIMES.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}
                        </select>
                      </td>
                      <td style={td}>
                        <input value={val(c.slug, "employee_id", c.employee_id ?? "")} onChange={(e) => editar(c.slug, "employee_id", e.target.value)}
                          placeholder="—" style={{ ...inputBase, width: 190, padding: "5px 7px", fontSize: 11.5 }} />
                      </td>
                      <td style={td}>
                        <input type="color" value={val(c.slug, "cor", c.cor ?? "#621244")} onChange={(e) => editar(c.slug, "cor", e.target.value)}
                          style={{ width: 34, height: 26, border: `1px solid ${M.border}`, borderRadius: 6, background: M.surface, cursor: "pointer" }} />
                      </td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: M.gray }}>{c.clientes.toLocaleString("pt-BR")}</td>
                      <td style={td}><Selo ok={c.ativo} sim="ativo" nao="inativo" /></td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        {sujo(c.slug) && (
                          <span style={{ marginRight: 6 }}>
                            <Botao onClick={() => enviar("carteiras", "PATCH", { slug: c.slug, ...edicoes[c.slug] }, "Carteira atualizada.")}>
                              Salvar
                            </Botao>
                          </span>
                        )}
                        <BotaoLeve cor={c.ativo ? M.laranja : M.verde}
                          onClick={() => enviar("carteiras", "PATCH", { slug: c.slug, ativo: !c.ativo },
                            c.ativo ? "Carteira desativada." : "Carteira reativada.")}>
                          {c.ativo ? "Desativar" : "Reativar"}
                        </BotaoLeve>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Bloco>

          <Bloco titulo="Novo vendedor"
            ajuda="Depois de criar aqui, libere o acesso da pessoa na aba Usuários — são duas coisas: a carteira (o dono comercial) e a conta que entra no sistema.">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input placeholder="apelido (ex.: milene)" value={novo.slug ?? ""}
                onChange={(e) => setNovo({ ...novo, slug: e.target.value })} style={{ ...inputBase, width: 190 }} />
              <input placeholder="RCA" value={novo.rca_num ?? ""}
                onChange={(e) => setNovo({ ...novo, rca_num: e.target.value })} style={{ ...inputBase, width: 80 }} />
              <select value={novo.time ?? ""} onChange={(e) => setNovo({ ...novo, time: e.target.value })} style={inputBase}>
                {TIMES.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}
              </select>
              <input placeholder="ID no RD (opcional)" value={novo.employee_id ?? ""}
                onChange={(e) => setNovo({ ...novo, employee_id: e.target.value })} style={{ ...inputBase, width: 200 }} />
              <Botao onClick={() => enviar("carteiras", "POST", novo, "Carteira criada.")}>Criar</Botao>
            </div>
          </Bloco>
        </>
      )}

      {aba === "horario" && dados?.horario && (
        <HorarioAba
          cfg={dados.horario} foraAgora={dados.foraAgora}
          salvar={(c) => enviar("horario", "PUT", c, "Horário salvo.")}
        />
      )}

      {aba === "linhas" && dados?.linhas && (
        <Bloco
          titulo="Linhas de WhatsApp"
          ajuda={<>
            O rótulo aparece no cabeçalho da conversa, para o vendedor saber por qual número está falando.
            <b> Esta tela não escolhe por onde a mensagem sai</b> — quem manda nisso é a variável
            <code style={{ fontSize: 11.5, background: M.bg, padding: "1px 5px", borderRadius: 4, margin: "0 3px" }}>WHATSAPP_PHONE_NUMBER_ID</code>
            na Vercel. Aqui é só o cadastro do que já existe na Meta.
          </>}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead><tr>
                <th style={th}>Rótulo</th><th style={th}>Número</th><th style={th}>phone_number_id</th>
                <th style={th}>Situação</th><th style={th} />
              </tr></thead>
              <tbody>
                {dados.linhas.map((l: any) => {
                  const enviando = dados.linhaDeEnvio === l.phone_number_id;
                  return (
                    <tr key={l.phone_number_id} style={{ opacity: l.ativo ? 1 : 0.55 }}>
                      <td style={td}>
                        <input value={val(l.phone_number_id, "rotulo", l.rotulo)}
                          onChange={(e) => editar(l.phone_number_id, "rotulo", e.target.value)}
                          style={{ ...inputBase, width: 210, padding: "5px 7px", fontWeight: 600 }} />
                        {enviando && <div style={{ fontSize: 11, fontWeight: 700, color: M.azul, marginTop: 3 }}>↑ é por esta que enviamos hoje</div>}
                      </td>
                      <td style={td}>
                        <input value={val(l.phone_number_id, "numero", l.numero ?? "")} placeholder="+55 91 …"
                          onChange={(e) => editar(l.phone_number_id, "numero", e.target.value)}
                          style={{ ...inputBase, width: 160, padding: "5px 7px" }} />
                      </td>
                      <td style={{ ...td, fontSize: 11.5, color: M.gray, fontVariantNumeric: "tabular-nums" }}>{l.phone_number_id}</td>
                      <td style={td}><Selo ok={l.ativo} sim="ativa" nao="inativa" /></td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        {sujo(l.phone_number_id) && (
                          <span style={{ marginRight: 6 }}>
                            <Botao onClick={() => enviar("linhas", "PATCH", { phone_number_id: l.phone_number_id, ...edicoes[l.phone_number_id] }, "Linha atualizada.")}>
                              Salvar
                            </Botao>
                          </span>
                        )}
                        <BotaoLeve cor={l.ativo ? M.laranja : M.verde}
                          onClick={() => enviar("linhas", "PATCH", { phone_number_id: l.phone_number_id, ativo: !l.ativo },
                            l.ativo ? "Linha desativada." : "Linha reativada.")}>
                          {l.ativo ? "Desativar" : "Reativar"}
                        </BotaoLeve>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 16, paddingTop: 16, borderTop: `1px solid ${M.bg}` }}>
            <input placeholder="phone_number_id" value={novo.phone_number_id ?? ""}
              onChange={(e) => setNovo({ ...novo, phone_number_id: e.target.value })} style={{ ...inputBase, width: 200 }} />
            <input placeholder="rótulo" value={novo.rotulo ?? ""}
              onChange={(e) => setNovo({ ...novo, rotulo: e.target.value })} style={{ ...inputBase, width: 190 }} />
            <input placeholder="número (opcional)" value={novo.numero ?? ""}
              onChange={(e) => setNovo({ ...novo, numero: e.target.value })} style={{ ...inputBase, width: 170 }} />
            <Botao onClick={() => enviar("linhas", "POST", novo, "Linha cadastrada.")}>Cadastrar linha</Botao>
          </div>
        </Bloco>
      )}

      {aba === "linhas" && <ChamadasVoz />}

      {aba === "templates-whatsapp" && dados?.["templates-whatsapp"] && (
        <TemplatesAba
          templates={dados["templates-whatsapp"]}
          avisoMeta={dados.aviso ?? null}
          recarregar={() => carregar("templates-whatsapp")}
          avisar={avisar}
        />
      )}

      {aba === "chat-layout" && dados?.["chat-layout"] && (
        <RedesenhoAba
          d={dados["chat-layout"]}
          estabelecer={(layout) =>
            enviar("chat-layout", "PUT", { layout }, "Desenho estabelecido para todos.")}
          piloto={(email, layout) =>
            enviar("chat-layout", "PATCH", { email, layout }, "Piloto atualizado.")}
        />
      )}

      {aba === "crm-config" && dados?.["crm-config"] && (
        <MecanismosAba
          d={dados["crm-config"]}
          salvar={(chave: string, valor: boolean | string[] | string | null) =>
            enviar("crm-config", "PUT", { chave, valor },
              valor ? "Mecanismo religado." : "Mecanismo desligado.")}
        />
      )}

      {aba === "pendencias" && dados?.pendencias && (
        <PendenciasAba d={dados.pendencias} recarregar={(gr) => carregarPendencias(gr)} />
      )}

      {aba === "paginas-legais" && dados?.["paginas-legais"] && (
        // `key` força o formulário a recarregar o que foi salvo: sem ela, o
        // estado local continuaria com o que estava digitado antes, e uma
        // correção feita pelo servidor (trim, por exemplo) ficaria invisível
        <PaginasLegaisAba
          key={dados.atualizado_em ?? "novo"}
          dados={dados["paginas-legais"]}
          urls={dados.urls}
          pendencias={dados.pendencias ?? []}
          atualizado={dados.atualizado_em}
          por={dados.atualizado_por}
          salvar={(c) => enviar("paginas-legais", "PUT", c, "Páginas atualizadas.")}
        />
      )}
    </Moldura>
  );
}

// --- chamadas de voz na linha de envio (migration 0087) ---------------------
// Estado próprio, e não dentro do `dados` da aba: fala com a META, não com o
// nosso banco — pode estar lenta ou fora do ar sem que isso derrube o cadastro
// de linhas ao lado.
function ChamadasVoz() {
  const [cfg, setCfg] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const ler = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch("/api/admin/ligacao", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j?.error ?? `erro ${r.status}`); setCfg(j); return; }
      setCfg(j);
    } catch (e: any) { setErro(e?.message ?? String(e)); }
  }, []);
  useEffect(() => { ler(); }, [ler]);

  const alternar = async (ligado: boolean) => {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/admin/ligacao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ligado }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErro(j?.error ?? `erro ${r.status}`);
      else setCfg(j);
    } finally { setOcupado(false); }
  };

  const ligado = String(cfg?.calling?.status ?? "").toUpperCase() === "ENABLED";

  return (
    <Bloco
      titulo="Chamadas de voz (WhatsApp)"
      ajuda={<>
        Liga a <b>ligação por voz</b> na linha de envio — é o que permite o botão 📞 do chat.
        A Meta <b>não</b> entrega isso ligado. Além deste interruptor, dois passos são feitos no
        painel da Meta e não têm como ser feitos daqui: assinar o campo <code style={{ fontSize: 11.5, background: M.bg, padding: "1px 5px", borderRadius: 4, margin: "0 3px" }}>calls</code>
        no webhook, e ter limite de mensagens de 2.000/24h na conta.
      </>}
    >
      {erro && <Recado tipo="erro">{erro}</Recado>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Selo ok={ligado} sim="chamadas ligadas" nao="chamadas desligadas" />
        <span style={{ fontSize: 12.5, color: M.gray }}>
          linha <b style={{ fontVariantNumeric: "tabular-nums" }}>{cfg?.linha ?? "—"}</b>
        </span>
        <span style={{ flex: 1 }} />
        <BotaoLeve onClick={ler}>Reconsultar</BotaoLeve>
        <Botao onClick={() => alternar(!ligado)} disabled={ocupado || !cfg?.linha}
          cor={ligado ? M.laranja : M.verde}
          titulo={ligado ? "clientes deixam de conseguir ligar para esta linha" : "habilita ligação nos dois sentidos"}>
          {ocupado ? "…" : ligado ? "Desligar chamadas" : "Ligar chamadas"}
        </Botao>
      </div>
    </Bloco>
  );
}

// --- aba de horário (estado próprio: é um formulário, não uma lista) --------
function HorarioAba({ cfg, foraAgora, salvar }: {
  cfg: any; foraAgora: boolean; salvar: (c: any) => Promise<boolean | undefined>;
}) {
  const [f, setF] = useState({
    ativo: cfg.ativo,
    inicio: String(cfg.inicio).slice(0, 5),
    fim: String(cfg.fim).slice(0, 5),
    dias_semana: cfg.dias_semana as number[],
    mensagem: cfg.mensagem as string,
    intervalo_horas: cfg.intervalo_horas as number,
  });
  const alternarDia = (n: number) =>
    setF({ ...f, dias_semana: f.dias_semana.includes(n) ? f.dias_semana.filter((d) => d !== n) : [...f.dias_semana, n].sort() });

  return (
    <Bloco
      titulo="Resposta automática fora do horário"
      ajuda="Quando alguém escreve fora do expediente, o sistema responde sozinho avisando que ninguém vai atender agora. Cada cliente recebe um aviso por vez, não um a cada mensagem."
    >
      {/* O aviso é forte de propósito: ligar isto manda mensagem para cliente
          real, e a funcionalidade nasceu desligada exatamente por isso. */}
      {!cfg.ativo && (
        <Recado tipo="aviso">
          Está <b>desligada</b>. Ao ligar, o sistema passa a enviar esta mensagem a clientes de verdade,
          automaticamente. Confira o texto e o horário antes.
        </Recado>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", marginBottom: 16 }}>
        <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })}
          style={{ width: 17, height: 17, cursor: "pointer" }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: f.ativo ? M.verde : M.gray }}>
          {f.ativo ? "Ligada" : "Desligada"}
        </span>
        <span style={{ fontSize: 12, color: M.muted }}>
          — neste momento estamos {foraAgora ? "FORA" : "DENTRO"} do horário configurado
        </span>
      </label>

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: M.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Expediente</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="time" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} style={inputBase} />
            <span style={{ fontSize: 13, color: M.gray }}>até</span>
            <input type="time" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} style={inputBase} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: M.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Dias</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {DIAS.map((d) => {
              const on = f.dias_semana.includes(d.n);
              return (
                <button key={d.n} onClick={() => alternarDia(d.n)}
                  style={{ padding: "6px 11px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", borderRadius: 7,
                    color: on ? "#fff" : M.gray, background: on ? M.roxo : M.surface, border: `1px solid ${on ? M.roxo : M.border}` }}>
                  {d.r}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: M.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Repetir no máximo a cada</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <input type="number" min={1} max={168} value={f.intervalo_horas}
              onChange={(e) => setF({ ...f, intervalo_horas: Number(e.target.value) })} style={{ ...inputBase, width: 70 }} />
            <span style={{ fontSize: 13, color: M.gray }}>horas, por cliente</span>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 800, color: M.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Mensagem enviada</div>
      <textarea value={f.mensagem} onChange={(e) => setF({ ...f, mensagem: e.target.value })} rows={4}
        style={{ ...inputBase, width: "100%", boxSizing: "border-box", resize: "vertical", lineHeight: 1.5 }} />
      <div style={{ fontSize: 11.5, color: M.muted, margin: "5px 0 16px" }}>{f.mensagem.length}/1000 caracteres</div>

      <Botao onClick={() => salvar({ ...f, inicio: `${f.inicio}:00`, fim: `${f.fim}:00` })} cor={M.wine}>
        Salvar horário
      </Botao>
    </Bloco>
  );
}

// --- templates do WhatsApp (migration 0090) --------------------------------
// Cria o template NA META, com texto e imagem opcional. Não confundir com a
// aba de templates do board (/api/templates): aquela cadastra um ponteiro para
// um template que vive no RD Conversas, cujo texto nunca esteve conosco.
//
// Estado próprio (não usa o `enviar` genérico da página) porque a criação vai
// em multipart — tem arquivo junto.
function TemplatesAba({ templates, avisoMeta, recarregar, avisar }: {
  templates: any[]; avisoMeta: string | null;
  recarregar: () => Promise<void>; avisar: (t: "erro" | "ok", m: string) => void;
}) {
  // Cadastrar template e disparar em massa são o mesmo assunto visto de dois
  // lados — quem monta uma campanha está escolhendo entre os templates que
  // acabou de cadastrar. Por isso dividem uma aba só, com esta chavinha, em vez
  // de duas abas no topo que obrigariam a ir e voltar para comparar o texto.
  const [vista, setVista] = useState<"cadastro" | "disparo" | "envios">("cadastro");
  // a config do disparo (templates prontos p/ envio, carteiras, extrato) só é
  // buscada quando alguém abre a seção — não custa nada a quem veio cadastrar
  const [cfgDisparo, setCfgDisparo] = useState<any>(null);
  const [carregandoDisparo, setCarregandoDisparo] = useState(false);
  const [cfgEnvios, setCfgEnvios] = useState<any>(null);

  const [f, setF] = useState<any>({ nome: "", categoria: "MARKETING", corpo: "", rodape: "", cabecalho_texto: "" });
  const [imagem, setImagem] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const corpoRef = useRef<HTMLTextAreaElement>(null);

  const daCloud = templates.filter((t) => t.canal === "cloud");
  const doRd = templates.filter((t) => t.canal !== "cloud");

  const corDoStatus = (s: string | null) => {
    const v = String(s ?? "").toUpperCase();
    if (v === "APPROVED") return M.verde;
    if (v === "PENDING" || v === "IN_APPEAL") return "#8a6100";
    if (!v) return M.muted;
    return M.laranja;
  };

  async function criar() {
    if (!f.nome.trim() || !f.corpo.trim()) { avisar("erro", "Nome e texto são obrigatórios."); return; }
    setEnviando(true);
    try {
      const fd = new FormData();
      for (const k of ["nome", "categoria", "corpo", "rodape", "cabecalho_texto"]) fd.append(k, f[k] ?? "");
      if (imagem) fd.append("imagem", imagem);
      const r = await fetch("/api/admin/templates-whatsapp", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { avisar("erro", j?.error ?? `erro ${r.status}`); return; }
      avisar("ok", j?.aviso ?? "Template criado.");
      setF({ nome: "", categoria: "MARKETING", corpo: "", rodape: "", cabecalho_texto: "" });
      setImagem(null);
      if (arquivoRef.current) arquivoRef.current.value = "";
      await recarregar();
    } catch (e: any) { avisar("erro", e?.message ?? String(e)); }
    finally { setEnviando(false); }
  }

  async function mexer(metodo: "PATCH" | "DELETE", corpo: any, sucesso: string) {
    try {
      const url = metodo === "DELETE"
        ? `/api/admin/templates-whatsapp?id=${corpo.id}`
        : "/api/admin/templates-whatsapp";
      const r = await fetch(url, {
        method: metodo,
        ...(metodo === "PATCH" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { avisar("erro", j?.error ?? `erro ${r.status}`); return; }
      avisar("ok", sucesso);
      await recarregar();
    } catch (e: any) { avisar("erro", e?.message ?? String(e)); }
  }

  // Insere o PRÓXIMO campo livre. Cada {{n}} é preenchido pelo consultor na hora
  // de enviar, no chat; o {{1}} chega lá com o primeiro nome da cliente já
  // dentro, por ser o uso mais comum — e pode ser trocado antes do envio.
  // A numeração tem de ser seguida a partir de {{1}}: a Meta recusa {{1}}+{{3}}.
  const inserirCampo = () => {
    const el = corpoRef.current;
    const pos = el?.selectionStart ?? f.corpo.length;
    const jaTem = (f.corpo.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length;
    const marca = `{{${jaTem + 1}}}`;
    setF({ ...f, corpo: `${f.corpo.slice(0, pos)}${marca}${f.corpo.slice(pos)}` });
    setTimeout(() => { el?.focus(); el?.setSelectionRange(pos + marca.length, pos + marca.length); }, 0);
  };

  const carregarDisparo = useCallback(async () => {
    setCarregandoDisparo(true);
    try {
      const r = await fetch("/api/admin/disparo-massa", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { avisar("erro", j?.error ?? `erro ${r.status}`); return; }
      setCfgDisparo(j["disparo-massa"]);
    } catch (e: any) { avisar("erro", e?.message ?? String(e)); }
    finally { setCarregandoDisparo(false); }
  }, [avisar]);

  useEffect(() => { if (vista === "disparo" && !cfgDisparo) carregarDisparo(); }, [vista, cfgDisparo, carregarDisparo]);

  const carregarEnvios = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/envios-template", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { avisar("erro", j?.error ?? `erro ${r.status}`); return; }
      setCfgEnvios(j["envios-template"]);
    } catch (e: any) { avisar("erro", e?.message ?? String(e)); }
  }, [avisar]);

  useEffect(() => { if (vista === "envios" && !cfgEnvios) carregarEnvios(); }, [vista, cfgEnvios, carregarEnvios]);

  const chave = (
    <div style={{ display: "flex", gap: 7, marginBottom: 16 }}>
      {([["cadastro", "📨 Templates cadastrados"], ["disparo", "📣 Disparo em massa"], ["envios", "📊 Envios"]] as const).map(([v, r]) => (
        <button key={v} onClick={() => setVista(v)}
          style={{ padding: "7px 15px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", borderRadius: 999,
            color: vista === v ? "#fff" : M.gray, background: vista === v ? M.wine : M.surface,
            border: `1px solid ${vista === v ? M.wine : M.border}` }}>
          {r}
        </button>
      ))}
    </div>
  );

  if (vista === "envios") {
    return (
      <>
        {chave}
        {!cfgEnvios && <p style={{ fontSize: 13, color: M.gray }}>Carregando…</p>}
        {cfgEnvios && <EnviosAba dados={cfgEnvios} />}
      </>
    );
  }

  if (vista === "disparo") {
    return (
      <>
        {chave}
        {carregandoDisparo && !cfgDisparo && <p style={{ fontSize: 13, color: M.gray }}>Carregando…</p>}
        {cfgDisparo && (
          <DisparoMassaAba cfg={cfgDisparo} avisar={avisar} recarregar={carregarDisparo} />
        )}
      </>
    );
  }

  return (
    <>
      {chave}
      <Bloco
        titulo="Criar template"
        ajuda={<>
          Template é a única forma de <b>começar uma conversa</b> ou de responder depois de 24 h sem
          mensagem do cliente — regra do WhatsApp, não nossa. Ele vai para <b>análise da Meta</b>, que
          costuma levar de minutos a algumas horas. Enquanto não for aprovado, não dá para enviar.
        </>}
      >
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={rotuloCampo}>Nome</label>
            <input value={f.nome} placeholder="ex.: Recontato de clientes" onChange={(e) => setF({ ...f, nome: e.target.value })}
              style={{ ...inputBase, width: 300 }} />
            <span style={{ fontSize: 11.5, color: M.muted }}>vira o identificador na Meta, sem acento nem espaço</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={rotuloCampo}>Tipo</label>
            <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} style={{ ...inputBase, width: 250 }}>
              <option value="MARKETING">Marketing — oferta, novidade, reativação</option>
              <option value="UTILITY">Utilidade — aviso sobre pedido em andamento</option>
            </select>
            <span style={{ fontSize: 11.5, color: M.muted }}>a Meta cobra preços diferentes por tipo</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <label style={rotuloCampo}>Texto da mensagem</label>
          <button onClick={inserirCampo} title="Insere um campo que o consultor preenche na hora de enviar"
            style={{ padding: "3px 9px", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
              borderRadius: 999, color: M.roxo, background: M.roxoSoft, border: `1px solid ${M.border}` }}>
            + campo a preencher
          </button>
          <span style={{ fontSize: 11.5, color: M.muted }}>
            o consultor digita cada campo no chat; o primeiro já vem com o nome da cliente
          </span>
        </div>
        <textarea ref={corpoRef} value={f.corpo} rows={5} onChange={(e) => setF({ ...f, corpo: e.target.value })}
          placeholder="Oi {{1}}, tudo bem? Chegaram novidades na Murano e separei algumas que combinam com o seu salão."
          style={{ ...inputBase, width: "100%", boxSizing: "border-box", resize: "vertical", lineHeight: 1.5 }} />
        <div style={{ fontSize: 11.5, color: M.muted, margin: "5px 0 16px" }}>
          {f.corpo.length}/1024 caracteres · sem link encurtado e sem promessa que a marca não cumpre — é o que mais causa recusa
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={rotuloCampo}>Imagem (opcional)</label>
            <input ref={arquivoRef} type="file" accept="image/jpeg,image/png"
              onChange={(e) => setImagem(e.target.files?.[0] ?? null)}
              style={{ ...inputBase, width: 300, padding: "5px 7px" }} />
            <span style={{ fontSize: 11.5, color: M.muted }}>JPEG ou PNG, até 5 MB — aparece acima do texto</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={rotuloCampo}>Ou título de texto</label>
            <input value={f.cabecalho_texto} disabled={!!imagem} maxLength={60}
              onChange={(e) => setF({ ...f, cabecalho_texto: e.target.value })}
              style={{ ...inputBase, width: 260, opacity: imagem ? 0.5 : 1 }} />
            <span style={{ fontSize: 11.5, color: M.muted }}>a Meta aceita um cabeçalho só</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={rotuloCampo}>Rodapé (opcional)</label>
            <input value={f.rodape} maxLength={60} onChange={(e) => setF({ ...f, rodape: e.target.value })}
              placeholder="Murano Professional" style={{ ...inputBase, width: 240 }} />
            <span style={{ fontSize: 11.5, color: M.muted }}>linha pequena no fim, até 60 caracteres</span>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <Botao cor={M.wine} onClick={criar} disabled={enviando}>
            {enviando ? "Enviando para a Meta…" : "Criar e enviar para análise"}
          </Botao>
        </div>
      </Bloco>

      <Bloco
        titulo="Templates desta linha"
        ajuda="Criados por nós na Meta. O status é reconsultado toda vez que esta tela abre — a Meta não avisa quando aprova."
      >
        {avisoMeta && <Recado tipo="aviso">{avisoMeta}</Recado>}
        {!daCloud.length && <p style={{ fontSize: 13, color: M.gray, margin: 0 }}>Nenhum template criado ainda.</p>}
        {daCloud.map((t) => (
          <div key={t.id} style={{ padding: "12px 0", borderBottom: `1px solid ${M.bg}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <b style={{ fontSize: 14 }}>{t.nome}</b>
              <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 20,
                color: corDoStatus(t.status), background: M.bg, border: `1px solid ${M.border}` }}>
                {t.status_legivel ?? "sem status"}
              </span>
              {t.padrao && <Selo ok sim="padrão" nao="" />}
              {t.cabecalho_tipo === "imagem" && <span style={{ fontSize: 11.5, color: M.gray }}>🖼️ com imagem</span>}
              {t.usa_nome && <span style={{ fontSize: 11.5, color: M.gray }}>usa o nome do cliente</span>}
              <span style={{ flex: 1 }} />
              {!t.padrao && String(t.status).toUpperCase() === "APPROVED" && (
                <BotaoLeve onClick={() => mexer("PATCH", { id: t.id, padrao: true }, "Padrão atualizado.")}
                  titulo="Passa a ser o template usado quando ninguém escolhe outro">tornar padrão</BotaoLeve>
              )}
              <BotaoLeve cor={t.ativo ? M.laranja : M.verde}
                onClick={() => mexer("PATCH", { id: t.id, ativo: !t.ativo }, t.ativo ? "Template desativado." : "Template reativado.")}>
                {t.ativo ? "Desativar" : "Reativar"}
              </BotaoLeve>
              <BotaoLeve cor={M.laranja}
                titulo="Apaga também na Meta — o nome fica bloqueado por 30 dias"
                onClick={() => {
                  if (!confirm(`Apagar "${t.nome}" também na Meta?\n\nIsso é irreversível, e o identificador "${t.meta_nome}" fica bloqueado por 30 dias.`)) return;
                  mexer("DELETE", { id: t.id }, "Template apagado.");
                }}>
                Apagar
              </BotaoLeve>
            </div>
            <div style={{ fontSize: 13, color: M.gray, marginTop: 6, whiteSpace: "pre-wrap" }}>{t.corpo}</div>
            {t.motivo_recusa && (
              <div style={{ fontSize: 12.5, color: M.laranja, marginTop: 5 }}>Motivo da recusa: {t.motivo_recusa}</div>
            )}
          </div>
        ))}
      </Bloco>

      {doRd.length > 0 && (
        <Bloco
          titulo="Templates do RD Conversas"
          ajuda="Cadastrados antes, apontando para o painel do RD. Não temos o texto deles — só o nome e o identificador — e por isso não dá para editar aqui."
        >
          {doRd.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 13.5, borderBottom: `1px solid ${M.bg}` }}>
              <b>{t.nome}</b>
              <code style={{ fontSize: 11.5, color: M.muted }}>{t.rd_template_id ?? "sem id"}</code>
              {t.padrao && <Selo ok sim="padrão" nao="" />}
              <span style={{ flex: 1 }} />
              <Selo ok={t.ativo} sim="ativo" nao="inativo" />
            </div>
          ))}
        </Bloco>
      )}
    </>
  );
}

const rotuloCampo = {
  fontSize: 11, fontWeight: 800, color: M.muted,
  textTransform: "uppercase" as const, letterSpacing: 0.6,
};

// --- páginas legais (migration 0088) ---------------------------------------
// Preenche as variáveis de /privacidade e /termos. O TEXTO das páginas mora no
// código, versionado; aqui ficam só os dados que mudam sem deploy — quem sabe o
// CNPJ certo é o financeiro, não quem faz deploy.
function PaginasLegaisAba({ dados, urls, pendencias, atualizado, por, salvar }: {
  dados: any; urls: any; pendencias: string[]; atualizado?: string | null; por?: string | null;
  salvar: (c: any) => Promise<boolean | undefined>;
}) {
  const [f, setF] = useState<any>({
    ...dados,
    vigencia: String(dados.vigencia ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
  });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  const Campo = ({ k, rotulo, dica, largura = 250, placeholder }: {
    k: string; rotulo: string; dica?: string; largura?: number; placeholder?: string;
  }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 800, color: M.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {rotulo}
        {pendencias.length > 0 && !String(f[k] ?? "").trim() && OBRIGATORIOS_ROTULO[k] && (
          <span style={{ color: M.laranja, marginLeft: 6 }}>• falta</span>
        )}
      </label>
      <input value={f[k] ?? ""} placeholder={placeholder} onChange={(e) => set(k, e.target.value)}
        style={{ ...inputBase, width: largura }} />
      {dica && <span style={{ fontSize: 11.5, color: M.muted }}>{dica}</span>}
    </div>
  );

  return (
    <>
      <Bloco
        titulo="Dados que preenchem as páginas públicas"
        ajuda={<>
          As páginas <b>/privacidade</b> e <b>/termos</b> abrem sem login — são elas que a Meta lê
          para tirar o app do modo Desenvolvimento. O texto delas está no código; aqui ficam as
          variáveis. <b>Campo em branco não vira traço na página: a linha simplesmente não aparece</b>,
          para não publicar "CNPJ: —" para cliente e revisor lerem.
        </>}
      >
        {pendencias.length > 0 && (
          <Recado tipo="aviso">
            Faltam dados que a Meta e a LGPD cobram: <b>{pendencias.join(", ")}</b>. Dá para salvar
            assim mesmo e completar depois, mas não mande as URLs para revisão antes de preencher.
          </Recado>
        )}

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 20 }}>
          <Campo k="nome_fantasia" rotulo="Nome fantasia" largura={230} />
          <Campo k="razao_social" rotulo="Razão social" largura={330} placeholder="como está no CNPJ" />
          <Campo k="cnpj" rotulo="CNPJ" largura={180} placeholder="00.000.000/0001-00" />
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 20 }}>
          <Campo k="endereco" rotulo="Endereço" largura={340} placeholder="rua, número, bairro" />
          <Campo k="cidade_uf" rotulo="Cidade / UF" largura={210}
            dica="também é o foro citado nos Termos" placeholder="Belém/PA" />
          <Campo k="cep" rotulo="CEP" largura={130} />
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 20 }}>
          <Campo k="telefone" rotulo="Telefone" largura={190} />
          <Campo k="whatsapp" rotulo="WhatsApp do atendimento" largura={220}
            dica="o número que o cliente vê publicado" />
          <Campo k="email_contato" rotulo="E-mail de contato" largura={280} />
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Campo k="encarregado" rotulo="Encarregado (LGPD)" largura={250}
            dica="pessoa ou setor responsável — art. 41" />
          <Campo k="email_privacidade" rotulo="E-mail de privacidade" largura={280}
            dica="para onde vão os pedidos de exclusão" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: M.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>
              Retenção
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <input type="number" min={1} max={240} value={f.retencao_meses ?? 60}
                onChange={(e) => set("retencao_meses", Number(e.target.value))} style={{ ...inputBase, width: 80 }} />
              <span style={{ fontSize: 13, color: M.gray }}>meses</span>
            </div>
            <span style={{ fontSize: 11.5, color: M.muted }}>tempo de guarda após o último contato</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: M.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>
              Vigente desde
            </label>
            <input type="date" value={f.vigencia} onChange={(e) => set("vigencia", e.target.value)}
              style={{ ...inputBase, width: 165 }} />
            <span style={{ fontSize: 11.5, color: M.muted }}>data no topo das duas páginas</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 22 }}>
          <Botao cor={M.wine} onClick={() => salvar(f)}>Salvar e publicar</Botao>
          <span style={{ fontSize: 12, color: M.muted }}>
            {atualizado
              ? `última alteração ${new Date(atualizado).toLocaleString("pt-BR")}${por ? ` por ${por}` : ""}`
              : "nunca editado"}
          </span>
        </div>
      </Bloco>

      <Bloco
        titulo="Endereços para colar no painel da Meta"
        ajuda="App Murano Pulse → Configurações → Básico. São estes três campos que faltam para sair do modo Desenvolvimento; a alteração feita acima aparece nas páginas na hora, sem deploy."
      >
        {[
          ["URL da Política de Privacidade", urls?.privacidade],
          ["URL dos Termos de Serviço", urls?.termos],
          ["Instruções de exclusão de dados", urls?.exclusao],
        ].map(([rotulo, url]) => (
          <div key={rotulo as string} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 9 }}>
            <span style={{ minWidth: 230, fontSize: 12.5, fontWeight: 700, color: M.ink }}>{rotulo}</span>
            <code style={{ fontSize: 12, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 6, padding: "4px 8px", color: M.gray }}>
              {url ?? "—"}
            </code>
            {url && (
              <a href={url as string} target="_blank" rel="noreferrer"
                style={{ fontSize: 12.5, fontWeight: 700, color: M.azul, textDecoration: "none" }}>
                abrir ↗
              </a>
            )}
          </div>
        ))}
      </Bloco>
    </>
  );
}

// rótulos dos campos que a Meta/LGPD cobram — espelha OBRIGATORIOS de lib/paginasLegais
const OBRIGATORIOS_ROTULO: Record<string, boolean> = {
  razao_social: true, cnpj: true, endereco: true, cidade_uf: true, email_privacidade: true,
};

// --- moldura ---------------------------------------------------------------
// --- disparo em massa (campanha) -------------------------------------------
// Mora DENTRO da aba Templates, na chave lá de cima: quem monta uma campanha
// está escolhendo entre os templates que acabou de cadastrar, e separar as duas
// coisas em abas de topo obrigaria a ir e voltar só para comparar o texto.
//
// O público é DECLARADO aqui — carteira, etapa, tempo parado — e conferido no
// servidor antes de qualquer envio (/api/admin/disparo-massa). Antes disto era
// um botão no board, e o público saía dos filtros que estivessem ligados na
// tela naquele momento: ação cara e irreversível amarrada ao estado de uma tela
// de trabalho, sem extrato do que tinha sido feito.
//
// O laço de envio mora no NAVEGADOR de propósito: a cota do RD é de ~48
// chamadas/min e é compartilhada com o ETL (§14.5), então centenas de envios
// não cabem no tempo de uma rota da Vercel. O ETL é pausado antes e retomado no
// fim, como o board já fazia.
const CUSTO_TEMPLATE = 0.43; // R$ por template disparado
const moedaBR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const ETAPAS: { key: string; rotulo: string; ajuda: string }[] = [
  { key: "ociosos", rotulo: "Ociosos", ajuda: "cliente falou por último há +24h — só um template reabre a conversa" },
  { key: "tentativa_contato", rotulo: "Tentativa de contato", ajuda: "template enviado, ainda sem resposta" },
  { key: "prospeccao", rotulo: "Lista de prospecção", ajuda: "da carteira no WinThor, nunca teve conversa" },
  { key: "negociacao", rotulo: "Negociação", ajuda: "conversa ativa nas últimas 24h — normalmente NÃO se dispara aqui" },
  { key: "pedido_emitido", rotulo: "Pedido emitido", ajuda: "comprou no mês corrente" },
];
const CORTE_ROTULO: Record<string, string> = {
  sem_contato: "sem contato no RD Conversas",
  sem_telefone: "sem telefone",
  descartado: "na lixeira",
  disparo_recente: "receberam template há pouco",
  ativo_demais: "parados há menos dias que o pedido",
  canal: "atendem pelo RD (o template é da Cloud)",
};

function DisparoMassaAba({ cfg, avisar, recarregar }: {
  cfg: any; avisar: (t: "erro" | "ok", m: string) => void; recarregar: () => Promise<void>;
}) {
  const templates: any[] = cfg.templates ?? [];
  // Começa no "Padrão do sistema" quando ele existe: era o default do modal do
  // board e é o único que alcança a base do RD. O ★ padrão da tabela vale para o
  // botão do card e para o chat, não para uma campanha.
  const padrao = templates.find((t) => t.id === 0) ?? templates.find((t) => t.padrao) ?? templates[0] ?? null;

  const [tplId, setTplId] = useState<number | null>(padrao?.id ?? null);
  const [extras, setExtras] = useState<string[]>([]);
  const [carteiras, setCarteiras] = useState<string[]>([]);
  const [etapas, setEtapas] = useState<string[]>(["ociosos", "tentativa_contato"]);
  const [diasMin, setDiasMin] = useState(0);
  const [diasRecontato, setDiasRecontato] = useState(4);
  const [limite, setLimite] = useState(20);

  const [previa, setPrevia] = useState<any>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [fase, setFase] = useState<"montar" | "confirmar" | "enviando" | "fim">("montar");
  const [prog, setProg] = useState<{ feitos: number; ok: number; falhas: number; total: number } | null>(null);
  const [falhas, setFalhas] = useState<{ cliente: string; erro: string }[]>([]);

  const tpl = templates.find((t) => t.id === tplId) ?? null;
  // {{1}} é sempre o primeiro nome da cliente; do {{2}} em diante quem preenche
  // é o admin, e o valor vale para a campanha inteira (é o que a tela do RD faz)
  const canalTpl: string | null = tpl?.canal ?? null;
  const camposExtras: number[] = (tpl?.campos ?? []).filter((n: number) => n > 1);
  const faltaPreencher = camposExtras.some((_, i) => !String(extras[i] ?? "").trim());

  // a prévia é recalculada sozinha a cada mudança de filtro, com respiro: são
  // ~4 mil linhas da vw_funil por chamada, não é para disparar a cada tecla
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      setCarregandoPrevia(true);
      try {
        const r = await fetch("/api/admin/disparo-massa", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            acao: "previa",
            filtros: { carteiras, etapas, diasMin, diasRecontato, limite, canal: canalTpl },
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) { avisar("erro", j?.error ?? `erro ${r.status}`); setPrevia(null); return; }
        setPrevia(j);
      } catch (e: any) {
        if (vivo) avisar("erro", e?.message ?? String(e));
      } finally {
        if (vivo) setCarregandoPrevia(false);
      }
    }, 400);
    return () => { vivo = false; clearTimeout(t); };
  }, [carteiras, etapas, diasMin, diasRecontato, limite, canalTpl, avisar]);

  const alternar = (lista: string[], set: (v: string[]) => void, v: string) =>
    set(lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  const selecionados: any[] = previa?.selecionados ?? [];
  const custo = selecionados.length * CUSTO_TEMPLATE;

  async function enviar() {
    setFase("enviando");
    setFalhas([]);
    // PAUSA o sync de fundo para liberar a cota do RD durante o envio; retoma no
    // finally, com retry — para nunca deixar pausado à toa.
    let pausei = false;
    try {
      const rp = await fetch("/api/sync-etl", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "pausar" }),
      });
      pausei = rp.ok;
      if (pausei) {
        // o servidor já espera os runners pararem (~18s). Se a cota ainda não
        // liberou, dá mais um respiro — enviar contra um run ativo é 429 na certa.
        const jp = await rp.json().catch(() => null);
        if (jp && jp.cotaLivre === false) await new Promise((res) => setTimeout(res, 12_000));
      }
    } catch {}

    let ok = 0, ruins = 0;
    const detalhe: { cliente: string; erro: string }[] = [];
    const total = selecionados.length;
    setProg({ feitos: 0, ok: 0, falhas: 0, total });
    try {
      for (let i = 0; i < total; i++) {
        const alvo = selecionados[i];
        let erro = "";
        try {
          const r = await fetch("/api/send-template", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cliente_id: alvo.envio_id,
              ...(tpl?.envio_id ? { template_id: tpl.envio_id } : {}),
              // só quando o template pede mais de um campo: com um campo só, o
              // servidor põe o primeiro nome sozinho — que é o de sempre
              ...(camposExtras.length
                ? { variaveis: [alvo.primeiro_nome, ...camposExtras.map((_, k) => extras[k])] }
                : {}),
            }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok && !j.error) ok++;
          else { ruins++; erro = j.error || `HTTP ${r.status}`; }
        } catch (e: any) { ruins++; erro = e?.message || "erro de rede"; }
        if (erro) detalhe.push({ cliente: alvo.cliente, erro });
        setProg({ feitos: i + 1, ok, falhas: ruins, total });
        if (i < total - 1) await new Promise((res) => setTimeout(res, 1800)); // throttle p/ não estourar 429
      }
    } finally {
      if (pausei) {
        for (let t = 0; t < 4; t++) {
          try {
            const rr = await fetch("/api/sync-etl", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "retomar" }),
            });
            if (rr.ok) break;
          } catch {}
          await new Promise((res) => setTimeout(res, 1500));
        }
      }
      setFalhas(detalhe);
      setFase("fim");
      await recarregar();
    }
  }

  // --- envio em andamento / concluído ---------------------------------------
  if (fase === "enviando" || fase === "fim") {
    const p = prog ?? { feitos: 0, ok: 0, falhas: 0, total: 0 };
    return (
      <Bloco titulo={fase === "enviando" ? "Enviando…" : p.falhas ? "Concluído com falhas" : "Concluído"}>
        <div style={{ fontSize: 13, color: M.gray, marginBottom: 10, fontWeight: 600 }}>
          {p.feitos}/{p.total} · ✔ {p.ok} enviados · ✖ {p.falhas} falharam
        </div>
        <div style={{ height: 10, background: M.bg, borderRadius: 6, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${p.total ? (p.feitos / p.total) * 100 : 0}%`, background: M.roxo, transition: "width .2s" }} />
        </div>
        {fase === "enviando" && (
          <div style={{ fontSize: 12, color: M.muted, marginTop: 10, lineHeight: 1.5 }}>
            Não feche esta aba até terminar. A sincronização de fundo está pausada (libera a cota do RD)
            e volta sozinha no fim.
          </div>
        )}
        {fase === "fim" && falhas.length > 0 && (
          <div style={{ marginTop: 12, background: "rgba(179,38,30,.06)", border: "1px solid rgba(179,38,30,.25)", borderRadius: 8, padding: "9px 12px", maxHeight: 190, overflow: "auto" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#b3261e", marginBottom: 6 }}>Motivos das falhas</div>
            {Object.entries(falhas.reduce((acc, f) => { acc[f.erro] = (acc[f.erro] ?? 0) + 1; return acc; }, {} as Record<string, number>))
              .sort((a, b) => b[1] - a[1])
              .map(([erro, n]) => (
                <div key={erro} style={{ fontSize: 12.5, color: M.ink, lineHeight: 1.55 }}><b>{n}×</b> {erro}</div>
              ))}
          </div>
        )}
        {fase === "fim" && (
          <div style={{ marginTop: 16 }}>
            <Botao cor={M.wine} onClick={() => { setFase("montar"); setProg(null); setFalhas([]); }}>
              Montar outro disparo
            </Botao>
          </div>
        )}
      </Bloco>
    );
  }

  // --- confirmação -----------------------------------------------------------
  if (fase === "confirmar") {
    return (
      <Bloco titulo="Confirmar disparo">
        <div style={{ fontSize: 13.5, color: M.ink, lineHeight: 1.6 }}>
          Vai enviar <b>{selecionados.length}</b> templates <b>reais no WhatsApp</b> — custo aproximado{" "}
          <b style={{ color: M.verde }}>{moedaBR(custo)}</b>. Isso é <b>irreversível</b>.
        </div>
        <div style={{ fontSize: 12.5, color: M.gray, marginTop: 8 }}>
          Template: <b>{tpl?.nome ?? "padrão do sistema"}</b>
          {tpl?.canal === "cloud" ? " · WhatsApp Cloud" : " · RD Conversas"}
        </div>
        {tpl?.corpo && (
          <div style={{ marginTop: 10, padding: "10px 12px", background: M.bg, border: `1px solid ${M.border}`, borderRadius: 8, fontSize: 13, color: M.ink, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {aplicarVariaveis(tpl.corpo, [selecionados[0]?.primeiro_nome ?? "Maria", ...extras])}
          </div>
        )}
        <div style={{ fontSize: 12, color: M.muted, marginTop: 10, maxHeight: 90, overflow: "auto", lineHeight: 1.55 }}>
          {selecionados.slice(0, 12).map((s) => s.cliente).join(" · ")}
          {selecionados.length > 12 ? ` +${selecionados.length - 12}` : ""}
        </div>
        <div style={{ display: "flex", gap: 9, marginTop: 18 }}>
          <BotaoLeve onClick={() => setFase("montar")}>Voltar</BotaoLeve>
          <Botao cor={M.wine} onClick={enviar}>Confirmar e enviar {selecionados.length}</Botao>
        </div>
      </Bloco>
    );
  }

  // --- montagem --------------------------------------------------------------
  return (
    <>
      <Bloco
        titulo="1. Template"
        ajuda={<>
          O texto vem do cadastro ao lado, em <b>Templates cadastrados</b> — é o que a cliente vai
          ler. Template da Cloud só entra nesta lista depois de <b>aprovado pela Meta</b>.
        </>}
      >
        {templates.length === 0 ? (
          <Recado tipo="aviso">
            Nenhum template disponível. Cadastre um em <b>📨 Templates cadastrados</b>, aqui ao lado,
            e espere a aprovação da Meta.
          </Recado>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {templates.map((t) => (
              <label key={t.id}
                style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", cursor: "pointer",
                  borderRadius: 10, background: tplId === t.id ? M.roxoSoft : M.surface,
                  border: `1px solid ${tplId === t.id ? M.roxo : M.border}` }}>
                <input type="radio" name="tpl" checked={tplId === t.id}
                  onChange={() => { setTplId(t.id); setExtras([]); }} style={{ marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>
                    {t.nome}
                    {t.padrao && <span style={{ fontSize: 11, color: M.roxo, marginLeft: 6 }}>★ padrão</span>}
                    <span style={{ fontSize: 11, fontWeight: 700, color: M.muted, marginLeft: 8 }}>
                      {t.canal === "cloud" ? "WhatsApp Cloud" : "RD Conversas"}
                    </span>
                    {t.tem_imagem && <span style={{ fontSize: 11, color: M.muted, marginLeft: 6 }}>· com imagem</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: M.gray, marginTop: 3, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {t.corpo ?? <i>{t.nota ?? "o texto deste template mora no painel do RD Conversas"}</i>}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        {camposExtras.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${M.bg}` }}>
            <div style={{ fontSize: 12.5, color: M.gray, marginBottom: 10, lineHeight: 1.55 }}>
              Este template tem campos a preencher. O primeiro é sempre o <b>primeiro nome da cliente</b>;
              os demais valem para <b>a campanha inteira</b>.
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {camposExtras.map((n, i) => (
                <div key={n} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={rotuloCampo}>{`campo ${n}`}</label>
                  <input value={extras[i] ?? ""} onChange={(e) => {
                    const v = [...extras]; v[i] = e.target.value; setExtras(v);
                  }} style={{ ...inputBase, width: 260 }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </Bloco>

      <Bloco
        titulo="2. Quem recebe"
        ajuda="O público é conferido no servidor e mostrado abaixo antes de qualquer envio. Sem carteira marcada, vale a equipe toda."
      >
        <div style={{ marginBottom: 6 }}><span style={rotuloCampo}>Carteiras</span></div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          {(cfg.carteiras ?? []).map((c: any) => {
            const on = carteiras.includes(c.slug);
            return (
              <button key={c.slug} onClick={() => alternar(carteiras, setCarteiras, c.slug)}
                style={{ padding: "5px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  borderRadius: 999, color: on ? "#fff" : M.gray, background: on ? (c.cor ?? M.roxo) : M.bg,
                  border: `1px solid ${on ? (c.cor ?? M.roxo) : M.border}` }}>
                {c.slug}
              </button>
            );
          })}
          {carteiras.length > 0 && <BotaoLeve onClick={() => setCarteiras([])}>limpar</BotaoLeve>}
        </div>

        <div style={{ marginBottom: 6 }}><span style={rotuloCampo}>Etapas do funil</span></div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16 }}>
          {ETAPAS.map((e) => {
            const on = etapas.includes(e.key);
            return (
              <button key={e.key} onClick={() => alternar(etapas, setEtapas, e.key)} title={e.ajuda}
                style={{ padding: "5px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  borderRadius: 999, color: on ? "#fff" : M.gray, background: on ? M.roxo : M.bg,
                  border: `1px solid ${on ? M.roxo : M.border}` }}>
                {e.rotulo}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={rotuloCampo}>Parado há pelo menos</label>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <input type="number" min={0} max={365} value={diasMin}
                onChange={(e) => setDiasMin(Math.max(0, Number(e.target.value) || 0))}
                style={{ ...inputBase, width: 80 }} />
              <span style={{ fontSize: 12.5, color: M.gray }}>dias</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={rotuloCampo}>Não repetir template por</label>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <input type="number" min={0} max={60} value={diasRecontato}
                onChange={(e) => setDiasRecontato(Math.min(60, Math.max(0, Number(e.target.value) || 0)))}
                style={{ ...inputBase, width: 80 }} />
              <span style={{ fontSize: 12.5, color: M.gray }}>dias</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={rotuloCampo}>Quantidade a enviar</label>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[10, 20, 30, 50, 100, 200].map((n) => (
                <button key={n} onClick={() => setLimite(n)}
                  style={{ minWidth: 42, padding: "6px 0", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                    borderRadius: 7, color: limite === n ? "#fff" : M.gray, background: limite === n ? M.roxo : M.bg,
                    border: `1px solid ${limite === n ? M.roxo : M.border}` }}>{n}</button>
              ))}
            </div>
          </div>
        </div>
      </Bloco>

      <Bloco
        titulo="3. Prévia"
        ajuda={"Havendo mais elegíveis que a quantidade pedida, vão os mais prioritários — "
          + (previa?.ciclo_ativo === false
              ? "tempo parado e ticket. (O motor de ciclo de compra está desligado em Mecanismos.)"
              : "urgência do ciclo de compra, tempo parado e ticket.")}
      >
        {carregandoPrevia && <p style={{ fontSize: 13, color: M.gray }}>Conferindo o público…</p>}
        {!carregandoPrevia && previa && (
          <>
            <div style={{ fontSize: 14.5, color: M.ink, lineHeight: 1.6 }}>
              <b>{previa.total}</b> clientes elegíveis · vão receber <b>{selecionados.length}</b> ·{" "}
              <b style={{ color: M.verde }}>{moedaBR(CUSTO_TEMPLATE)}</b> cada · total{" "}
              <b style={{ color: M.verde }}>{moedaBR(custo)}</b>
            </div>

            {tpl?.canal === "cloud" && !cfg.envioPadraoCloud && (
              <div style={{ marginTop: 12 }}>
                <Recado tipo="aviso">
                  Este template é da <b>WhatsApp Cloud</b>, então só alcança conversas que já correm por lá —
                  {" "}<b>{previa.cortes?.canal ?? 0}</b> contato(s) ficaram de fora por atenderem pelo RD
                  Conversas. Para falar com a base do RD, escolha um template do RD.
                </Recado>
              </div>
            )}

            {Object.entries(previa.cortes ?? {}).filter(([, n]) => Number(n) > 0).length > 0 && (
              <div style={{ fontSize: 12, color: M.muted, marginTop: 8, lineHeight: 1.6 }}>
                Ficaram de fora:{" "}
                {Object.entries(previa.cortes)
                  .filter(([, n]) => Number(n) > 0)
                  .map(([k, n]) => `${n} ${CORTE_ROTULO[k] ?? k}`)
                  .join(" · ")}
              </div>
            )}

            {selecionados.length > 0 && (
              <div style={{ marginTop: 14, maxHeight: 260, overflow: "auto", border: `1px solid ${M.border}`, borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={th}>Cliente</th><th style={th}>Carteira</th>
                    <th style={th}>Etapa</th><th style={th}>Parado</th><th style={th}>Canal</th>
                  </tr></thead>
                  <tbody>
                    {selecionados.map((s: any) => (
                      <tr key={s.envio_id}>
                        <td style={{ ...td, fontWeight: 600 }}>{s.cliente}</td>
                        <td style={td}>{s.vendedor ?? "—"}</td>
                        <td style={td}>{ETAPAS.find((e) => e.key === s.etapa)?.rotulo ?? s.etapa}</td>
                        <td style={td}>{s.dias == null ? "nunca falou" : `${s.dias} d`}</td>
                        <td style={td}>{s.canal === "whatsapp" ? "Cloud" : "RD"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
              <Botao cor={M.wine} disabled={!selecionados.length || !tpl || faltaPreencher}
                onClick={() => setFase("confirmar")}>
                Revisar ({selecionados.length})
              </Botao>
              {faltaPreencher && <span style={{ fontSize: 12.5, color: "#8a6100" }}>preencha os campos do template acima</span>}
              {!tpl && <span style={{ fontSize: 12.5, color: "#8a6100" }}>escolha um template</span>}
            </div>
          </>
        )}
      </Bloco>

      <Bloco titulo="Disparos dos últimos 30 dias" ajuda="Cada linha é um dia e um template — o extrato que o board não guardava.">
        {(cfg.historico ?? []).length === 0 ? (
          <p style={{ fontSize: 13, color: M.gray }}>Nenhum disparo registrado no período.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead><tr>
                <th style={th}>Dia</th><th style={th}>Template</th><th style={th}>Carteiras</th><th style={th}>Enviados</th>
              </tr></thead>
              <tbody>
                {cfg.historico.map((h: any) => (
                  <tr key={`${h.dia}|${h.template_id}`}>
                    <td style={td}>{h.dia.split("-").reverse().join("/")}</td>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{h.template_id}</td>
                    <td style={td}>{h.vendedores.join(", ") || "—"}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{h.enviados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>
    </>
  );
}

// --- envios de template (as duas pastilhas que viviam no board) -------------
// "Templates 2733" e "Automáticos 94" ficavam no cabeçalho do board sem nada
// que dissesse o que eram — e os rótulos enganavam: nada ali é automático.
// Aqui os dois números aparecem com nome próprio, lado a lado, e a diferença
// entre eles (o que a equipe disparou pelo painel do RD, fora do CRM) deixa de
// ser uma subtração que ninguém fazia.
const PERIODOS = [
  { k: "hoje", r: "Hoje" }, { k: "ontem", r: "Ontem" }, { k: "semana", r: "7 dias" },
  { k: "quinzena", r: "15 dias" }, { k: "mes", r: "Mês" },
] as const;

function EnviosAba({ dados }: { dados: any }) {
  const [per, setPer] = useState<(typeof PERIODOS)[number]["k"]>("mes");
  const linhas: any[] = dados.linhas ?? [];
  const tot = dados.total ?? { saiu: {}, crm: {} };
  const saiuTot = Number(tot.saiu?.[per] ?? 0);
  const crmTot = Number(tot.crm?.[per] ?? 0);
  // Pode dar negativo: as duas contagens vêm de fontes diferentes (o espelho de
  // mensagens e o nosso log de disparos), e o ETL pode ainda não ter trazido a
  // mensagem de um disparo recém-feito. Mostrar "-3 pelo painel do RD" seria
  // pior que mostrar zero e dizer que os números se encontram com o tempo.
  const fora = Math.max(0, saiuTot - crmTot);

  const num = (v: number, cor: string) => (
    <b style={{ fontSize: 27, fontWeight: 800, color: cor, lineHeight: 1.1 }}>{v.toLocaleString("pt-BR")}</b>
  );

  return (
    <>
      <Bloco
        titulo="Templates que saíram"
        ajuda={<>
          Template é a mensagem que <b>reabre uma conversa</b> passadas as 24 h — a única forma de
          falar com quem parou de responder, e a única que tem <b>custo por envio</b>. Estes números
          existem para responder duas perguntas: <i>quantos saíram</i> e <i>por onde</i>.
        </>}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
          {PERIODOS.map((p) => (
            <button key={p.k} onClick={() => setPer(p.k)}
              style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", borderRadius: 999,
                color: per === p.k ? "#fff" : M.gray, background: per === p.k ? M.roxo : M.bg,
                border: `1px solid ${per === p.k ? M.roxo : M.border}` }}>
              {p.r}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px", padding: "14px 16px", background: M.bg, border: `1px solid ${M.border}`, borderRadius: 12 }}>
            {num(saiuTot, M.wine)}
            <div style={{ fontSize: 13, fontWeight: 700, color: M.ink, marginTop: 4 }}>chegaram à cliente</div>
            <div style={{ fontSize: 12, color: M.gray, marginTop: 5, lineHeight: 1.5 }}>
              Todo template entregue na conversa, tenha saído daqui ou do painel do RD. Contado nas
              mensagens que o sistema tem espelhadas.
            </div>
          </div>
          <div style={{ flex: "1 1 220px", padding: "14px 16px", background: M.bg, border: `1px solid ${M.border}`, borderRadius: 12 }}>
            {num(crmTot, M.roxo)}
            <div style={{ fontSize: 13, fontWeight: 700, color: M.ink, marginTop: 4 }}>saíram por este CRM</div>
            <div style={{ fontSize: 12, color: M.gray, marginTop: 5, lineHeight: 1.5 }}>
              Botão do card, chat e disparo em massa. É a parte que este sistema registra por
              cliente, e a única que aparece no extrato do disparo em massa.
            </div>
          </div>
          <div style={{ flex: "1 1 220px", padding: "14px 16px", background: M.bg, border: `1px solid ${M.border}`, borderRadius: 12 }}>
            {num(fora, M.laranja)}
            <div style={{ fontSize: 13, fontWeight: 700, color: M.ink, marginTop: 4 }}>pelo painel do RD</div>
            <div style={{ fontSize: 12, color: M.gray, marginTop: 5, lineHeight: 1.5 }}>
              A diferença entre os dois: o que a equipe disparou fora daqui. Quanto menor, mais a
              operação já está acontecendo dentro do CRM.
            </div>
          </div>
        </div>
      </Bloco>

      <Bloco titulo="Por consultora" ajuda="Mesmo período escolhido acima. A carteira é a do contato, não quem clicou.">
        {linhas.length === 0 ? (
          <p style={{ fontSize: 13, color: M.gray, margin: 0 }}>Nenhum template no período.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
              <thead><tr>
                <th style={th}>Carteira</th>
                <th style={th}>Chegaram</th>
                <th style={th}>Por este CRM</th>
                <th style={th}>Pelo painel do RD</th>
              </tr></thead>
              <tbody>
                {[...linhas]
                  .sort((a, b) => Number(b.saiu?.[per] ?? 0) - Number(a.saiu?.[per] ?? 0))
                  .map((l) => {
                    const s = Number(l.saiu?.[per] ?? 0), c = Number(l.crm?.[per] ?? 0);
                    return (
                      <tr key={l.vendedor}>
                        <td style={{ ...td, fontWeight: 600 }}>{l.vendedor}</td>
                        <td style={td}>{s}</td>
                        <td style={td}>{c}</td>
                        <td style={{ ...td, color: s - c > 0 ? M.laranja : M.muted }}>{Math.max(0, s - c)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pendências — o que o board não consegue colocar em coluna nenhuma (0101).
//
// A tela NÃO resolve nada, e isso é deliberado: as ações de cada caso vêm
// depois. Ela existe para o problema ter dono agora, em vez de continuar sendo
// silêncio — foi assim que a conversa da §34 ficou invisível por meses, mesmo
// havendo uma métrica que a registrava.
//
// O .csv é a peça que faz a tela valer hoje: a maioria destes casos se resolve
// FORA do CRM (cadastro no WinThor), então o admin precisa levar a lista para
// quem cuida do ERP.
// ---------------------------------------------------------------------------
function PendenciasAba({ d, recarregar }: { d: any; recarregar: (grupo: string | null) => void }) {
  const linhas: any[] = d.linhas ?? [];
  const totais: Record<string, number> = d.totais ?? {};
  const grupoAtivo: string | null = d.grupo ?? null;
  const chaves = Object.keys(totais).sort();

  const dataBR = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

  function baixarCsv() {
    const cols = ["grupo", "codcli", "cliente_id", "nome", "telefone", "cpf", "carteira", "rca_num", "rca_nome", "detalhe", "ultima_atividade"];
    // ; como separador e BOM: é o que o Excel em pt-BR abre sem pedir importação
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    // BOM + CRLF escritos por codigo: escape em string de origem ja se perdeu
    // uma vez nesta linha, e o Excel precisa dos dois para abrir sem importacao
    const BOM = String.fromCharCode(0xFEFF);
    const linhasCsv = [cols.join(";"), ...linhas.map((l) => cols.map((c) => esc(l[c])).join(";"))];
    const csv = BOM + linhasCsv.join(String.fromCharCode(13, 10));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pendencias_${grupoAtivo ?? "todas"}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Bloco
      titulo="O que o board não consegue classificar"
      ajuda={
        <>
          Clientes e contatos que não cabem em nenhuma coluna — por falta de telefone, de
          cadastro no WinThor ou de carteira. <b>Nada aqui é resolvido por esta tela</b>: ela
          existe para nenhum caso ficar invisível enquanto as ações não existem. A maioria se
          conserta no cadastro do ERP, então leve o <code style={mono}>.csv</code> a quem cuida dele.
        </>
      }
    >
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        {[{ k: null as string | null, r: `Todas (${d.total ?? 0})` },
          ...chaves.map((g) => ({ k: g.slice(0, 1), r: `${g} (${totais[g]})` }))].map((c) => {
          const on = grupoAtivo === c.k;
          return (
            <button key={c.r} onClick={() => recarregar(c.k)}
              style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", borderRadius: 20,
                cursor: "pointer", color: on ? "#fff" : M.gray, background: on ? M.roxo : M.bg,
                border: `1px solid ${on ? M.roxo : M.border}` }}>
              {c.r}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto" }}>
          <Botao cor={M.azul} onClick={baixarCsv} disabled={!linhas.length}>⬇ .csv ({linhas.length})</Botao>
        </span>
      </div>

      {!linhas.length ? (
        <p style={{ fontSize: 13, color: M.verde, fontWeight: 700 }}>Nenhuma pendência neste grupo.</p>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: M.surface }}>
              <tr>
                {["Grupo", "Cliente", "Código", "Telefone", "Carteira / RCA", "Última conversa"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.slice(0, 600).map((l) => (
                <tr key={l.chave} title={l.detalhe}>
                  <td style={{ ...td, whiteSpace: "nowrap", fontSize: 11.5, color: M.gray }}>{l.grupo}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{l.nome ?? "—"}</td>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{l.codcli ?? "—"}</td>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: l.telefone ? M.ink : M.laranja }}>
                    {l.telefone ?? "sem telefone"}
                  </td>
                  <td style={td}>
                    {l.carteira ? cap(l.carteira) : <span style={{ color: M.muted }}>sem carteira</span>}
                    {l.rca_num ? <span style={{ color: M.gray }}> · RCA {l.rca_num}</span> : null}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{dataBR(l.ultima_atividade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {linhas.length > 600 && (
            <p style={{ fontSize: 12, color: M.gray, margin: "10px 0 0" }}>
              Mostrando 600 de {linhas.length} — o <b>.csv</b> traz a lista inteira.
            </p>
          )}
        </div>
      )}
    </Bloco>
  );
}

// ---------------------------------------------------------------------------
// Mecanismos — interruptores globais do CRM (`crm_config`, migration 0097).
//
// A tela mostra, para cada mecanismo, O QUE ele desliga e o que NÃO desliga.
// Sem essa lista o interruptor vira um botão que ninguém tem coragem de virar —
// e, virado, ninguém sabe explicar o que mudou na tela do vendedor no dia
// seguinte. Mesma razão pela qual a aba de redesenho mostra a tese e o
// sacrifício de cada direção em vez de só o nome.
//
// Desligar pede DOIS gestos, como estabelecer um desenho: muda a tela de todo
// mundo de uma vez. Religar pede um só — voltar ao estado anterior nunca deveria
// custar mais caro do que sair dele.
// ---------------------------------------------------------------------------
function MecanismosAba({ d, salvar }: { d: any; salvar: (chave: string, valor: boolean | string[] | string | null) => Promise<boolean> }) {
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // seleção de linhas em estado local: marcar NÃO aplica — aplicar é o segundo
  // gesto, como estabelecer um desenho (§29.4). Um clique acidental num
  // checkbox não deve trocar a tela de quinze pessoas.
  const linhasInfo = d.linhas ?? { opcoes: [], selecionadas: [] };
  const envio = d.envio ?? null;
  const [sel, setSel] = useState<string[]>(linhasInfo.selecionadas ?? []);
  const marcada = (id: string) => sel.includes(id);
  const alternar = (id: string) =>
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const mesmaSelecao =
    sel.length === (linhasInfo.selecionadas ?? []).length &&
    sel.every((x: string) => (linhasInfo.selecionadas ?? []).includes(x));

  const cfg = d.config ?? {};
  const mecanismos: any[] = d.mecanismos ?? [];
  // lido direto da config: acrescentar mecanismo é mexer só na rota, não aqui
  const ligado = (chave: string) => cfg[chave] !== false;

  const quando = (iso: string | null) => {
    if (!iso) return null;
    const dt = new Date(iso);
    return `${dt.toLocaleDateString("pt-BR")} às ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  const Lista = ({ titulo, itens, cor }: { titulo: string; itens: readonly string[]; cor: string }) => (
    <div style={{ flex: "1 1 260px", minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: cor, marginBottom: 6 }}>
        {titulo}
      </div>
      <ul style={{ margin: 0, paddingLeft: 17, fontSize: 12.5, color: M.gray, lineHeight: 1.65 }}>
        {itens.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );

  return (
    <>
      <Bloco
        titulo="Interruptores do sistema"
        ajuda={
          <>
            Mecanismos que podem ser <b>desligados e religados sem deploy</b>, para toda a equipe.
            Nada é apagado: o dado continua sendo sincronizado, só deixa de aparecer e de ser
            usado nos cálculos. Religar mostra o estado de agora, não um buraco.
          </>
        }
      >
        {mecanismos.map((m: any) => {
          const on = ligado(m.chave);
          const confirmandoEste = confirmando === m.chave;
          return (
            <div key={m.chave} style={{ border: `1px solid ${M.border}`, borderRadius: 10, padding: 15, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: M.wine, letterSpacing: -0.2 }}>{m.rotulo}</div>
                <Selo ok={on} sim="Ligado" nao="Desligado" />
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  {on ? (
                    confirmandoEste ? (
                      <>
                        <Botao cor={M.laranja} disabled={ocupado}
                          onClick={async () => {
                            setOcupado(true);
                            const deu = await salvar(m.chave, false);
                            setOcupado(false);
                            if (deu) setConfirmando(null);
                          }}>
                          {ocupado ? "Desligando…" : "Confirmar: desligar"}
                        </Botao>
                        <Botao cor={M.gray} onClick={() => setConfirmando(null)}>Cancelar</Botao>
                      </>
                    ) : (
                      <Botao cor={M.laranja} onClick={() => setConfirmando(m.chave)}>Desligar</Botao>
                    )
                  ) : (
                    <Botao disabled={ocupado}
                      onClick={async () => { setOcupado(true); await salvar(m.chave, true); setOcupado(false); }}>
                      {ocupado ? "Religando…" : "Religar"}
                    </Botao>
                  )}
                </div>
              </div>

              <p style={{ fontSize: 13, color: M.ink, margin: "0 0 12px", lineHeight: 1.55 }}>{m.resumo}</p>

              {confirmandoEste && (
                <div style={{ margin: "0 0 12px" }}>
                  <Recado tipo="aviso">
                    Isto muda a tela de <b>toda a equipe</b> na próxima atualização, não só a sua.
                    Confira as duas listas abaixo antes de confirmar — e lembre que religar é um clique.
                  </Recado>
                </div>
              )}

              <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                <Lista titulo={on ? "Desligar tira do ar" : "Está fora do ar"} itens={m.desliga} cor={M.laranja} />
                <Lista titulo="Continua funcionando" itens={m.mantem} cor={M.verde} />
              </div>

              {m.nota && (
                <p style={{ fontSize: 12, color: M.muted, margin: "12px 0 0", lineHeight: 1.55 }}>{m.nota}</p>
              )}
            </div>
          );
        })}

        {/* ---- número de ENVIO (0102) --------------------------------------
            Vem ANTES do seletor de visibilidade de propósito: "por qual número
            eu falo" é a pergunta que o vendedor sente; "o que eu vejo" é a que
            o supervisor ajusta. E o texto precisa separar as duas, senão o
            admin muda uma achando que mudou a outra. */}
        {envio && (
          <div style={{ border: `1px solid ${M.border}`, borderRadius: 10, padding: 15, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: M.wine, letterSpacing: -0.2 }}>{envio.rotulo}</div>
              <Selo ok={!!envio.atual} sim="Definido" nao="Automático" />
            </div>
            <p style={{ fontSize: 13, color: M.ink, margin: "0 0 12px", lineHeight: 1.55 }}>{envio.resumo}</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(envio.opcoes ?? []).map((o: any) => {
                const on = (envio.atual ?? null) === (o.v ?? null);
                return (
                  <label key={String(o.v)}
                    style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: ocupado ? "default" : "pointer",
                      border: `1px solid ${on ? M.roxo : M.border}`, background: on ? M.roxoSoft : M.surface,
                      borderRadius: 9, padding: "9px 11px" }}>
                    <input type="radio" name="numero_envio" checked={on} disabled={ocupado}
                      onChange={async () => {
                        if (on) return;
                        setOcupado(true);
                        await salvar("numero_envio", o.v ?? null);
                        setOcupado(false);
                      }}
                      style={{ marginTop: 2 }} />
                    <span style={{ minWidth: 0 }}>
                      <b style={{ fontSize: 13, color: M.ink, display: "block" }}>{o.rotulo}</b>
                      <span style={{ fontSize: 12, color: M.gray, lineHeight: 1.5 }}>{o.desc}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            <p style={{ fontSize: 12, color: M.muted, margin: "12px 0 0", lineHeight: 1.55 }}>
              Vale na hora, para o chat e para o board. Contato que só existe no nosso banco
              (criado pelo botão + ou por quem escreveu primeiro) sai sempre pelo Murano
              Professional, mesmo com o RD escolhido — o RD não conhece esse contato.
            </p>
          </div>
        )}

        {/* ---- seletor de linhas ------------------------------------------- */}
        <div style={{ border: `1px solid ${M.border}`, borderRadius: 10, padding: 15, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: M.wine, letterSpacing: -0.2 }}>{linhasInfo.rotulo}</div>
            <Selo ok={!!linhasInfo.tudo} sim="Todos os números" nao="Filtrado" />
            <div style={{ marginLeft: "auto" }}>
              <Botao disabled={ocupado || mesmaSelecao || sel.length === 0}
                titulo={sel.length === 0 ? "Marque ao menos um número" : mesmaSelecao ? "Nada mudou" : undefined}
                onClick={async () => { setOcupado(true); await salvar("linhas_visiveis", sel); setOcupado(false); }}>
                {ocupado ? "Aplicando…" : "Aplicar"}
              </Botao>
            </div>
          </div>

          <p style={{ fontSize: 13, color: M.ink, margin: "0 0 12px", lineHeight: 1.55 }}>{linhasInfo.resumo}</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 13 }}>
            {(linhasInfo.opcoes ?? []).map((l: any) => (
              <label key={l.phone_number_id}
                style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={marcada(l.phone_number_id)} onChange={() => alternar(l.phone_number_id)} />
                <b style={{ color: M.ink }}>{l.rotulo}</b>
                <span style={{ color: M.gray, fontVariantNumeric: "tabular-nums" }}>{l.numero ?? ""}</span>
              </label>
            ))}
            {!(linhasInfo.opcoes ?? []).length && (
              <span style={{ fontSize: 12.5, color: M.muted }}>Nenhuma linha ativa cadastrada.</span>
            )}
          </div>

          {!mesmaSelecao && sel.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Recado tipo="aviso">
                Isto muda a tela de <b>toda a equipe</b> na próxima atualização. Marcar de volta é um clique.
              </Recado>
            </div>
          )}

          <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
            <Lista titulo="Desmarcar tira do ar" itens={linhasInfo.desliga ?? []} cor={M.laranja} />
            <Lista titulo="Continua funcionando" itens={linhasInfo.mantem ?? []} cor={M.verde} />
          </div>
          {linhasInfo.nota && (
            <p style={{ fontSize: 12, color: M.muted, margin: "12px 0 0", lineHeight: 1.55 }}>{linhasInfo.nota}</p>
          )}
        </div>

        <p style={{ fontSize: 12, color: M.gray, margin: 0 }}>
          {cfg.atualizado_por
            ? <>Última mudança nesta tela: <b>{cfg.atualizado_por}</b>{quando(cfg.atualizado_em) ? `, em ${quando(cfg.atualizado_em)}` : ""}.</>
            : "Nenhum interruptor foi trocado ainda."}
        </p>
      </Bloco>
    </>
  );
}

// --- Desenho do chat (migration 0095) --------------------------------------
// Onde a decisão sobre o redesenho do /chat é tomada e registrada. Mostra as
// quatro opções com a tese e o SACRIFÍCIO de cada uma, porque escolher vendo só
// o lado bom não é escolher — é o que o laudo (`prototipos/laudo-ux-chat.md`)
// chama de aposta.
//
// Duas decisões de desenho desta tela em si:
//
// 1. Marcar o rádio NÃO aplica. Estabelecer um desenho troca a tela de trabalho
//    de sete pessoas; um clique acidental num rádio não deve fazer isso. Marcar
//    seleciona, e um segundo gesto confirma — o mesmo freio que o laudo cobra
//    dos erros caros do próprio chat.
// 2. Opção sem implementação aparece, mas não é selecionável. Esconder as três
//    direções até existirem tiraria justamente o material de comparação; deixar
//    ativá-las deixaria a equipe numa tela que não existe.
function RedesenhoAba({ d, estabelecer, piloto }: {
  d: any;
  estabelecer: (layout: string) => Promise<boolean>;
  piloto: (email: string, layout: string | null) => Promise<boolean>;
}) {
  const vigente: string = d.global?.layout ?? "original";
  const [sel, setSel] = useState<string>(vigente);
  const [confirmando, setConfirmando] = useState(false);

  const opcoes: any[] = d.opcoes ?? [];
  const pessoas: any[] = (d.pessoas ?? []).filter((p: any) => p.ativo);
  const emPiloto: any[] = d.pilotos ?? [];
  const ativaveis = opcoes.filter((o) => o.implementado);
  const rotuloDe = (id: string) => opcoes.find((o) => o.id === id)?.rotulo ?? id;

  const corRisco = (r: string) => (r === "alto" ? M.laranja : r === "baixo" ? M.verde : M.muted);
  const quando = (iso: string | null) => {
    if (!iso) return "—";
    const d2 = new Date(iso);
    return `${d2.toLocaleDateString("pt-BR")} às ${d2.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <>
      <Bloco
        titulo="O que está em vigor"
        ajuda={
          <>
            Este é o desenho que a equipe vê hoje no <b>/chat</b>. A auditoria de UX e os três
            protótipos estão em <code style={mono}>prototipos/</code> no repositório — o laudo
            completo, com o custo de cada tarefa em cliques, em{" "}
            <code style={mono}>prototipos/laudo-ux-chat.md</code>.
          </>
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: M.wine, letterSpacing: -0.3 }}>
            {rotuloDe(vigente)}
          </div>
          <div style={{ fontSize: 12.5, color: M.gray }}>
            {d.global?.atualizado_por
              ? <>estabelecido por <b>{d.global.atualizado_por}</b> em {quando(d.global.atualizado_em)}</>
              : "nunca foi trocado — é o desenho de origem"}
          </div>
          {emPiloto.length > 0 && (
            <span style={{ marginLeft: "auto" }}>
              <Selo ok sim={`${emPiloto.length} em piloto`} nao="" />
            </span>
          )}
        </div>
        {emPiloto.length > 0 && (
          <p style={{ fontSize: 12, color: M.gray, margin: "10px 0 0", lineHeight: 1.55 }}>
            Quem está em piloto <b>não</b> é afetado pelo desenho em vigor — vê o do piloto até
            sair dele. Lista mais abaixo.
          </p>
        )}
      </Bloco>

      <Bloco
        titulo="As opções"
        ajuda="Cada direção resolve problemas diferentes e sacrifica coisas diferentes. Marque uma para comparar; estabelecer para todos é o passo seguinte, com confirmação."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {opcoes.map((o) => {
            const marcada = sel === o.id;
            const ativa = vigente === o.id;
            return (
              <label key={o.id}
                style={{
                  display: "block", position: "relative", overflow: "hidden", cursor: o.implementado ? "pointer" : "default",
                  background: marcada ? M.roxoSoft : M.surface,
                  border: `1px solid ${marcada ? M.roxo : M.border}`, borderRadius: 12,
                  padding: "14px 16px 14px 20px", opacity: o.implementado ? 1 : 0.72,
                }}>
                {/* faixa de 4px — a assinatura visual do produto (skill murano-brand) */}
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
                  background: `linear-gradient(to bottom, ${M.azul}, #8a2a63, #3d0b2a)` }} />

                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <input type="radio" name="chat-layout" value={o.id} checked={marcada}
                    disabled={!o.implementado}
                    onChange={() => { setSel(o.id); setConfirmando(false); }}
                    style={{ accentColor: M.roxo, width: 16, height: 16, cursor: "inherit" }} />
                  <b style={{ fontSize: 14.5, color: M.ink }}>{o.rotulo}</b>
                  {ativa && <Selo ok sim="Em vigor" nao="" />}
                  {!o.implementado && (
                    <span title="Existe como protótipo; a tela ainda não foi construída"
                      style={{ fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 20,
                        color: M.laranja, background: "rgba(221,66,34,.08)", border: `1px solid rgba(221,66,34,.25)` }}>
                      Em avaliação
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 11.5, color: M.gray, whiteSpace: "nowrap" }}>
                    <span>risco de treinamento <b style={{ color: corRisco(o.risco) }}>{o.risco}</b></span>
                    <span>prazo <b style={{ color: M.ink }}>{o.prazo}</b></span>
                  </span>
                </div>

                <p style={{ fontSize: 13, color: M.ink, margin: "9px 0 0", fontWeight: 600, lineHeight: 1.5 }}>{o.resumo}</p>
                <p style={{ fontSize: 12.5, color: M.gray, margin: "6px 0 0", lineHeight: 1.6 }}>{o.tese}</p>

                <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", marginTop: 12 }}>
                  <div>
                    <div style={rotuloCol}>O que resolve</div>
                    <ul style={lista}>{o.ganhos.map((g: string, i: number) => <li key={i} style={item}>{g}</li>)}</ul>
                  </div>
                  <div>
                    <div style={{ ...rotuloCol, color: M.laranja }}>O que sacrifica</div>
                    <ul style={lista}>{o.sacrificios.map((s: string, i: number) => <li key={i} style={item}>{s}</li>)}</ul>
                  </div>
                </div>

                {o.prototipo && (
                  <p style={{ fontSize: 11.5, color: M.muted, margin: "11px 0 0" }}>
                    Protótipo navegável: <code style={mono}>{o.prototipo}</code> — abre no navegador com
                    duplo clique, sem build.
                  </p>
                )}
              </label>
            );
          })}
        </div>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${M.border}` }}>
          {sel === vigente ? (
            <p style={{ fontSize: 12.5, color: M.gray, margin: 0 }}>
              <b>{rotuloDe(sel)}</b> já é o desenho em vigor.
              {ativaveis.length === 1 && (
                <> Enquanto só um desenho estiver construído, não há o que trocar — as três
                direções acima estão aqui para avaliação.</>
              )}
            </p>
          ) : !confirmando ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Botao onClick={() => setConfirmando(true)}>Estabelecer {rotuloDe(sel)} para todos</Botao>
              <span style={{ fontSize: 12, color: M.gray }}>
                afeta {pessoas.length} {pessoas.length === 1 ? "pessoa" : "pessoas"} com acesso ativo
              </span>
            </div>
          ) : (
            <div style={{ background: M.roxoSoft, border: `1px solid ${M.roxo}`, borderRadius: 10, padding: "13px 15px" }}>
              <p style={{ fontSize: 13, color: M.ink, margin: "0 0 10px", lineHeight: 1.6 }}>
                Confirmar: <b>{rotuloDe(sel)}</b> passa a valer para <b>todos</b> os usuários na próxima
                vez que abrirem o chat. Dá para voltar a qualquer momento — <b>Original</b> continua
                sendo uma opção válida.
              </p>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                <Botao onClick={async () => { const ok = await estabelecer(sel); if (ok) setConfirmando(false); }}>
                  Sim, estabelecer para todos
                </Botao>
                <Botao onClick={() => setConfirmando(false)} cor={M.gray}>Cancelar</Botao>
              </div>
            </div>
          )}
        </div>
      </Bloco>

      <Bloco
        titulo="Piloto por pessoa"
        ajuda={
          <>
            Rodar um desenho novo em <b>uma conta só</b>, antes de impor a todos. Trocar a tela de
            toda a equipe de uma vez, sem ninguém ter usado, é o cenário em que um desenho bom morre
            por estranhamento — o que o vendedor reclamar depois de usar vale mais que qualquer item
            adivinhado numa lista. <b>Seguir o vigente</b> tira a pessoa do piloto.
          </>
        }
      >
        {pessoas.length === 0 ? (
          <p style={{ fontSize: 13, color: M.gray, margin: 0 }}>Nenhum acesso ativo.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead><tr>
                <th style={th}>E-mail</th>
                <th style={th}>Papel</th>
                <th style={th}>Vê hoje</th>
                <th style={th}>Piloto</th>
              </tr></thead>
              <tbody>
                {pessoas.map((p: any) => (
                  <tr key={p.email}>
                    <td style={{ ...td, fontWeight: 600 }}>{p.email}</td>
                    <td style={{ ...td, color: M.gray }}>{p.papel}{p.carteira ? ` · ${p.carteira}` : ""}</td>
                    <td style={td}>
                      {p.chat_layout
                        ? <b style={{ color: M.roxo }}>{rotuloDe(p.chat_layout)}</b>
                        : <span style={{ color: M.gray }}>{rotuloDe(vigente)}</span>}
                    </td>
                    <td style={td}>
                      <select
                        value={p.chat_layout ?? ""}
                        onChange={(e) => piloto(p.email, e.target.value || null)}
                        style={{ ...inputBase, padding: "5px 7px", fontSize: 12.5 }}
                      >
                        <option value="">Seguir o vigente</option>
                        {ativaveis.map((o) => (
                          <option key={o.id} value={o.id}>{o.rotulo}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      <Bloco titulo="Histórico de decisões" ajuda="Toda troca, global ou de piloto. Últimas 25.">
        {(d.historico ?? []).length === 0 ? (
          <p style={{ fontSize: 13, color: M.gray, margin: 0 }}>
            Nada trocado ainda — o chat está no desenho de origem.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead><tr>
                <th style={th}>Quando</th>
                <th style={th}>Escopo</th>
                <th style={th}>De</th>
                <th style={th}>Para</th>
                <th style={th}>Por</th>
              </tr></thead>
              <tbody>
                {d.historico.map((h: any, i: number) => (
                  <tr key={i}>
                    <td style={{ ...td, whiteSpace: "nowrap", color: M.gray }}>{quando(h.criada_em)}</td>
                    <td style={td}>
                      {h.escopo === "global"
                        ? <b style={{ color: M.wine }}>todos</b>
                        : <span style={{ color: M.gray }}>piloto · {h.alvo}</span>}
                    </td>
                    <td style={{ ...td, color: M.gray }}>{h.de ? rotuloDe(h.de) : "—"}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{rotuloDe(h.para)}</td>
                    <td style={{ ...td, color: M.gray }}>{h.por ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.historico_erro && (
          <p style={{ fontSize: 12, color: M.laranja, margin: "10px 0 0" }}>
            O histórico não pôde ser lido ({d.historico_erro}). A decisão em vigor, acima, não depende dele.
          </p>
        )}
      </Bloco>
    </>
  );
}

const mono = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "0.92em", background: M.bg, border: `1px solid ${M.border}`,
  borderRadius: 5, padding: "1px 5px",
};
const rotuloCol = {
  fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase" as const,
  color: M.verde, marginBottom: 5,
};
const lista = { margin: 0, paddingLeft: 17, display: "flex", flexDirection: "column" as const, gap: 4 };
const item = { fontSize: 12.5, color: M.gray, lineHeight: 1.5 };

function Moldura({ aba, setAba, esconderAbas, children }: {
  aba: Aba; setAba: (a: Aba) => void; esconderAbas?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", background: M.bg, color: M.ink, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${M.laranja}, ${M.wine}, ${M.roxo})` }} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 18px", background: M.surface, borderBottom: `1px solid ${M.border}`, flexWrap: "wrap" }}>
        <Link href="/" style={{ color: M.gray, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Board</Link>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: M.wine }}>⚙️ Administração</div>
        {!esconderAbas && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ABAS.map((a) => (
              <button key={a.id} onClick={() => setAba(a.id)}
                style={{ padding: "6px 13px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", borderRadius: 8,
                  color: aba === a.id ? "#fff" : M.gray, background: aba === a.id ? M.roxo : M.bg,
                  border: `1px solid ${aba === a.id ? M.roxo : M.border}` }}>
                {a.rotulo}
              </button>
            ))}
            {/* Gestão de carteira saiu do menu do board e passou a morar aqui. É LINK, não
                aba: /carteira é uma tela própria de 700 linhas que já funciona, e transformá-la
                em aba seria desmontá-la sem nenhum ganho para quem usa. */}
            <Link href="/carteira"
              title="Transferir contatos entre carteiras no RD Conversas, em massa"
              style={{ padding: "6px 13px", fontSize: 12.5, fontWeight: 700, borderRadius: 8, textDecoration: "none",
                color: M.gray, background: M.bg, border: `1px solid ${M.border}` }}>
              🗂️ Gestão de carteira
            </Link>
          </div>
        )}
      </div>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "20px 18px 60px" }}>{children}</div>
    </div>
  );
}
