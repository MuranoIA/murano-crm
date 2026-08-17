"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// Painel administrativo — reúne o que até aqui só existia no SQL Editor do
// Supabase: quem entra no sistema, quais são os vendedores, o horário de
// atendimento e as linhas de WhatsApp.
//
// O que NÃO entra aqui, de propósito: templates, metas, música dos parabéns e
// respostas rápidas já têm tela onde são usados (board e chat). Trazer tudo
// para cá afastaria a configuração do lugar onde ela faz sentido — o admin que
// quer trocar o template está olhando o board, não este painel.
//
// Identidade Murano, mesma paleta de /chat e /chat/indicadores.
const M = {
  wine: "#621244", roxo: "#7b2d8b", roxoSoft: "#f1e6f4", azul: "#1a5fa8",
  laranja: "#dd4222", bg: "#f5edf4", surface: "#ffffff", border: "#e0cfdb",
  ink: "#241327", muted: "#9a8098", gray: "#6f5c6d", verde: "#1a6b3c",
};

type Aba = "usuarios" | "carteiras" | "horario" | "linhas";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "usuarios", rotulo: "👥 Usuários" },
  { id: "carteiras", rotulo: "🧑‍💼 Vendedores" },
  { id: "horario", rotulo: "🕗 Horário" },
  { id: "linhas", rotulo: "📞 Linhas" },
];

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
    </Moldura>
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

// --- moldura ---------------------------------------------------------------
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
          </div>
        )}
      </div>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "20px 18px 60px" }}>{children}</div>
    </div>
  );
}
