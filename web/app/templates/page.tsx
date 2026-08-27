"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { aplicarVariaveis, variaveisDe } from "../../lib/templateVars";

// ---------------------------------------------------------------------------
// /templates — a tela do CONSULTOR (migration 0110).
//
// Duas coisas, nesta ordem, e a ordem é o laudo inteiro:
//
//   1. os templates que ele PODE USAR hoje;
//   2. o compositor para sugerir um novo;
//   3. as sugestões dele, com o estado e há quanto tempo esperam.
//
// A tentação é inverter 1 e 2 ("a tela é de criar"). Isso a transformaria numa
// caixa de sugestões e enterraria o único uso diário — e ler o que já existe é
// o antídoto da sugestão duplicada: quem abre para sugerir e dá de cara com um
// texto quase igual resolve sem gerar trabalho para o admin nem custo na Meta.
//
// ⚠️ A palavra "Meta" NÃO aparece em nenhuma sugestão. A tela do admin diz
// "Enviando para a Meta…" porque lá é isso mesmo; reaproveitar esse texto aqui
// faria a consultora esperar uma aprovação "em minutos" de algo que ainda nem
// foi lido por um humano. O destino da análise é o administrador, e está escrito
// ACIMA do botão — é a última coisa lida antes do gesto.
// ---------------------------------------------------------------------------

const M = {
  wine: "#621244", roxo: "#7b2d8b", roxoSoft: "#f1e6f4", azul: "#1a5fa8",
  laranja: "#dd4222", bg: "#f5edf4", surface: "#ffffff", border: "#e0cfdb",
  ink: "#241327", muted: "#9a8098", gray: "#6f5c6d", verde: "#1a6b3c",
};

const NOME_EXEMPLO = "Maria";

/** Cor do selo de cada um dos cinco estados. O rótulo vem do servidor. */
const CORES: Record<string, { cor: string; bg: string; borda: string }> = {
  analise_admin:       { cor: "#8a5a00", bg: "#fff7e6", borda: "#f3ddad" },
  aprovada_nao_criada: { cor: "#1a5fa8", bg: "#e8f1fb", borda: "#c3ddf5" },
  analise_meta:        { cor: "#1a5fa8", bg: "#e8f1fb", borda: "#c3ddf5" },
  pronta:              { cor: "#1a6b3c", bg: "#e7f6ec", borda: "#bfe6cd" },
  recusada:            { cor: "#b3261e", bg: "#fdeae9", borda: "#f2c4c0" },
  recusada_meta:       { cor: "#b3261e", bg: "#fdeae9", borda: "#f2c4c0" },
};

type Sug = {
  id: number; nome: string; corpo: string; rodape: string | null;
  cabecalho_tipo: string | null; cabecalho_texto: string | null;
  justificativa: string | null; motivo: string | null;
  status: string; criado_em: string; espera_dias: number;
  estado: { chave: string; rotulo: string };
};

export default function Templates() {
  const [d, setD] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [compondo, setCompondo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const [nome, setNome] = useState("");
  const [corpo, setCorpo] = useState("");
  const [cab, setCab] = useState("");
  const [rodape, setRodape] = useState("");
  const [porque, setPorque] = useState("");
  // Imagem de cabecalho. A Meta aceita UM cabecalho: escolher imagem apaga o
  // titulo e vice-versa -- barrar aqui evita a recusa chegar depois, e evita o
  // template nascer invalido.
  const [imagem, setImagem] = useState<File | null>(null);
  const [previaImg, setPreviaImg] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/templates/sugestoes", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j?.error ?? `erro ${r.status}`); return; }
      setD(j); setErro(null);
    } catch (e: any) { setErro(String(e?.message ?? e)); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const LIM = d?.limites ?? { nome: 60, corpo: 1024, cabecalho: 60, rodape: 60 };

  // ⚠️ O contador conta o texto FINAL, já substituído — é o que a Meta mede, e
  // é o que `conferirVariaveis` cobra no envio. Contar o corpo cru deixaria
  // passar um texto que estoura só depois do nome entrar.
  const previa = aplicarVariaveis(corpo, [NOME_EXEMPLO]);
  const campos = variaveisDe(corpo);
  const foraDeOrdem = campos.some((n, i) => n !== i + 1);
  const soPrimeiro = campos.every((n) => n === 1);
  const temLinkCurto = /\b(bit\.ly|encurta|tinyurl|cutt\.ly|goo\.gl)\b/i.test(corpo);

  const problemas: string[] = [];
  if (previa.length > LIM.corpo) problemas.push(`o texto final tem ${previa.length} caracteres — o limite é ${LIM.corpo}`);
  if (foraDeOrdem) problemas.push("a numeração dos campos está fora de sequência: use {{1}}, depois {{2}}…");
  if (!soPrimeiro) problemas.push("só {{1}} é preenchido sozinho (o primeiro nome da cliente); os outros você digita a cada envio");
  if (cab.length > LIM.cabecalho) problemas.push(`o título passa de ${LIM.cabecalho} caracteres`);
  if (rodape.length > LIM.rodape) problemas.push(`o rodapé passa de ${LIM.rodape} caracteres`);
  const podeEnviar = nome.trim().length >= 3 && corpo.trim().length >= 10 && porque.trim().length >= 5 && !problemas.length;

  function trocarImagem(f: File | null) {
    setImagem(f);
    setPreviaImg((antiga) => { if (antiga) URL.revokeObjectURL(antiga); return f ? URL.createObjectURL(f) : null; });
    if (f) setCab("");            // um cabeçalho só
  }

  function limpar() {
    setNome(""); setCorpo(""); setCab(""); setRodape(""); setPorque("");
    trocarImagem(null);
    if (imgRef.current) imgRef.current.value = "";
  }

  async function enviar() {
    setOcupado(true); setErro(null); setOk(null);
    try {
      // multipart quando há imagem; JSON quando não há. A rota aceita os dois —
      // mandar sempre multipart faria o caso comum (só texto) carregar um
      // envelope que ninguém precisa.
      const campos = {
        nome: nome.trim(), corpo: corpo.trim(),
        cabecalho_tipo: imagem ? "imagem" : cab.trim() ? "texto" : "",
        cabecalho_texto: cab.trim(),
        rodape: rodape.trim(),
        justificativa: porque.trim(),
      };
      let r: Response;
      if (imagem) {
        const fd = new FormData();
        Object.entries(campos).forEach(([k, v]) => fd.set(k, v));
        fd.set("imagem", imagem);
        r = await fetch("/api/templates/sugestoes", { method: "POST", body: fd });
      } else {
        r = await fetch("/api/templates/sugestoes", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(campos),
        });
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j?.error ?? `erro ${r.status}`); return; }
      setOk(j?.aviso ?? "Enviado."); limpar(); setCompondo(false); void carregar();
    } finally { setOcupado(false); }
  }

  /** Recusada → repovoa o compositor com o texto, para corrigir sem redigitar. */
  function corrigir(s: Sug) {
    setNome(s.nome); setCorpo(s.corpo);
    setCab(s.cabecalho_texto ?? ""); setRodape(s.rodape ?? "");
    setPorque(s.justificativa ?? "");
    setCompondo(true);
    setTimeout(() => document.getElementById("compositor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }

  const inputBase: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: 13.5,
    fontFamily: "inherit", color: M.ink, background: M.bg,
    border: `1px solid ${M.border}`, borderRadius: 9, outline: "none",
  };
  const Rotulo = ({ children, conta }: { children: React.ReactNode; conta?: string }) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, marginTop: 12 }}>
      <label style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: M.muted }}>{children}</label>
      {conta && <span style={{ marginLeft: "auto", fontSize: 11, color: M.muted, fontVariantNumeric: "tabular-nums" }}>{conta}</span>}
    </div>
  );

  const sugestoes: Sug[] = d?.sugestoes ?? [];
  const prontos: any[] = d?.prontos ?? [];

  return (
    <div style={{ minHeight: "100vh", background: M.bg, fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif", color: M.ink }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "22px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <a href="/" style={{ fontSize: 13, color: M.gray, textDecoration: "none", fontWeight: 600 }}>← Board</a>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: M.wine, letterSpacing: -0.3 }}>Templates</h1>
        </div>

        {erro && <Recado tipo="erro">{erro}</Recado>}
        {ok && <Recado tipo="ok">{ok}</Recado>}
        {!d && !erro && <p style={{ fontSize: 13, color: M.gray }}>Carregando…</p>}

        {/* ---- 1. PRONTOS PARA USAR --------------------------------------- */}
        {d && (
          <section style={{ background: M.surface, border: `1px solid ${M.border}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
            <h2 style={{ margin: "0 0 3px", fontSize: 16, fontWeight: 800, color: M.wine }}>Prontos para usar</h2>
            <p style={{ margin: "0 0 14px", fontSize: 12.5, color: M.gray, lineHeight: 1.55 }}>
              O que você já pode enviar hoje, pelo botão TEMPLATE dentro da conversa.
              Template é a única mensagem que reabre uma conversa depois das 24 h.
            </p>
            {!prontos.length ? (
              <Vazio>Nenhum template disponível ainda.</Vazio>
            ) : prontos.map((t: any) => (
              <div key={t.id} style={{ borderTop: `1px solid ${M.bg}`, padding: "11px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13.5 }}>{t.nome}</b>
                  {t.padrao && <Selo cor={M.wine} bg={M.roxoSoft} borda={M.border}>padrão</Selo>}
                </div>
                <TextoComoACliente corpo={t.corpo} />
              </div>
            ))}
          </section>
        )}

        {/* ---- 2. SUGERIR --------------------------------------------------- */}
        {d && (
          <section id="compositor" style={{ background: M.surface, border: `1px solid ${M.border}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
            <h2 style={{ margin: "0 0 3px", fontSize: 16, fontWeight: 800, color: M.wine }}>Criar um template</h2>
            <p style={{ margin: 0, fontSize: 12.5, color: M.gray, lineHeight: 1.55 }}>
              Escreva o texto e o título da mensagem. Todo template passa por <b>análise</b>
              antes de entrar no ar — você acompanha o resultado aqui embaixo.
            </p>

            {!compondo ? (
              <button onClick={() => setCompondo(true)}
                style={{ marginTop: 14, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, fontFamily: "inherit",
                  color: "#fff", background: M.azul, border: "none", borderRadius: 10, cursor: "pointer" }}>
                Criar template
              </button>
            ) : (
              <>
                <Rotulo conta={`${nome.length}/${LIM.nome}`}>Nome (só para você e o administrador reconhecerem)</Rotulo>
                <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={LIM.nome}
                  placeholder="Ex.: Novidades do mês" style={inputBase} />

                <Rotulo conta={`${previa.length}/${LIM.corpo}`}>Mensagem</Rotulo>
                <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={5}
                  placeholder={`Oi, {{1}}! Chegaram novidades que combinam com o seu salão…`}
                  style={{ ...inputBase, resize: "vertical", lineHeight: 1.5 }} />
                <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button onClick={() => setCorpo((c) => c + "{{1}}")}
                    style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", color: M.wine, background: M.roxoSoft,
                      border: `1px solid ${M.border}`, borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>
                    + nome da cliente
                  </button>
                  <button onClick={() => setCorpo((c) => c + `{{${campos.length + 1}}}`)}
                    style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", color: M.gray, background: M.bg,
                      border: `1px solid ${M.border}`, borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>
                    + campo a preencher
                  </button>
                  <span style={{ fontSize: 11, color: M.muted }}>
                    {campos.length <= 1 ? "sai num clique no card" : `você digita ${campos.length - 1} campo(s) a cada envio`}
                  </span>
                </div>

                <Rotulo>Imagem no topo da mensagem (opcional)</Rotulo>
                <input ref={imgRef} type="file" accept="image/jpeg,image/png" style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > 5 * 1024 * 1024) { setErro("a imagem passa de 5 MB, o limite do WhatsApp"); return; }
                    trocarImagem(f);
                  }} />
                {previaImg ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <img src={previaImg} alt="" style={{ width: 92, height: 92, objectFit: "cover", borderRadius: 10, border: `1px solid ${M.border}` }} />
                    <div>
                      <div style={{ fontSize: 12.5, color: M.ink, fontWeight: 600 }}>{imagem?.name}</div>
                      <button onClick={() => { trocarImagem(null); if (imgRef.current) imgRef.current.value = ""; }}
                        style={{ marginTop: 5, fontSize: 12, fontWeight: 700, fontFamily: "inherit", color: M.laranja,
                          background: "transparent", border: `1px solid ${M.border}`, borderRadius: 8,
                          padding: "4px 11px", cursor: "pointer" }}>
                        Remover imagem
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => imgRef.current?.click()}
                    style={{ padding: "9px 14px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
                      color: M.wine, background: M.roxoSoft, border: `1px solid ${M.border}`,
                      borderRadius: 9, cursor: "pointer" }}>
                    🖼️ Escolher imagem
                  </button>
                )}
                <p style={{ fontSize: 11, color: M.muted, margin: "5px 0 0" }}>
                  JPEG ou PNG, até 5 MB. O WhatsApp aceita <b>um</b> cabeçalho: com imagem, o título fica de fora.
                </p>

                <Rotulo conta={`${cab.length}/${LIM.cabecalho}`}>
                  {imagem ? "Título (indisponível com imagem)" : "Título, no topo da mensagem (opcional)"}
                </Rotulo>
                <input value={cab} onChange={(e) => setCab(e.target.value)} maxLength={LIM.cabecalho}
                  disabled={!!imagem} placeholder={imagem ? "a imagem já é o cabeçalho" : ""}
                  style={{ ...inputBase, opacity: imagem ? 0.5 : 1 }} />

                <Rotulo conta={`${rodape.length}/${LIM.rodape}`}>Rodapé (opcional)</Rotulo>
                <input value={rodape} onChange={(e) => setRodape(e.target.value)} maxLength={LIM.rodape}
                  placeholder="Ex.: Murano Professional" style={inputBase} />

                <Rotulo>Por que este texto ajuda a vender</Rotulo>
                <textarea value={porque} onChange={(e) => setPorque(e.target.value)} rows={2}
                  placeholder="Em que situação você usaria, e o que espera que a cliente responda."
                  style={{ ...inputBase, resize: "vertical" }} />

                {/* PRÉVIA — nunca com {{1}} cru: ninguém julga um texto com chaves
                    no meio. Vai um nome de exemplo, e a tela diz que os outros
                    campos são digitados na hora do envio. */}
                <Rotulo>Como a cliente vai ler</Rotulo>
                <div style={{ background: "#e8f6ff", border: "1px solid #cfeafb", borderRadius: 12, borderTopLeftRadius: 4, padding: "10px 13px" }}>
                  {previaImg && (
                    <img src={previaImg} alt="" style={{ display: "block", width: "100%", maxHeight: 190, objectFit: "cover", borderRadius: 8, marginBottom: 7 }} />
                  )}
                  {cab.trim() && !previaImg && <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 3 }}>{cab}</div>}
                  <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {previa || <span style={{ color: M.muted }}>o texto aparece aqui</span>}
                  </div>
                  {rodape.trim() && <div style={{ fontSize: 11.5, color: M.gray, marginTop: 5 }}>{rodape}</div>}
                </div>
                <p style={{ fontSize: 11, color: M.muted, margin: "5px 0 0" }}>
                  “{NOME_EXEMPLO}” é só exemplo — na hora do envio entra o nome de cada cliente.
                </p>

                {temLinkCurto && (
                  <p style={{ fontSize: 12, color: "#8a5a00", background: "#fff7e6", border: "1px solid #f3ddad",
                    borderRadius: 9, padding: "8px 11px", margin: "10px 0 0", lineHeight: 1.5 }}>
                    Link encurtado é o que mais causa recusa. Se der, escreva o endereço completo.
                  </p>
                )}
                {problemas.map((p) => (
                  <p key={p} style={{ fontSize: 12, color: M.laranja, margin: "8px 0 0" }}>• {p}</p>
                ))}

                {/* O DESTINO, acima do botão — é a última coisa lida antes do
                    gesto. Inclui a recusa: esconder que ela existe não protege
                    ninguém, só a transforma em surpresa. */}
                <div style={{ marginTop: 16, padding: "11px 13px", background: M.roxoSoft, borderRadius: 10, fontSize: 12.5, color: M.ink, lineHeight: 1.6 }}>
                  <b>O que acontece depois:</b> o texto passa por análise e você recebe a
                  resposta aqui — aprovado, ou recusado com um motivo que dá para corrigir e
                  reenviar. Depois de aprovado, o template ainda é registrado no WhatsApp
                  antes de aparecer para você usar na conversa.
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button disabled={!podeEnviar || ocupado} onClick={enviar}
                    style={{ padding: "10px 18px", fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", color: "#fff",
                      background: !podeEnviar || ocupado ? M.muted : M.azul, border: "none", borderRadius: 10,
                      cursor: !podeEnviar || ocupado ? "default" : "pointer" }}>
                    {ocupado ? "Enviando…" : "Enviar para análise"}
                  </button>
                  <button onClick={() => { setCompondo(false); limpar(); }}
                    style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", color: M.gray,
                      background: "transparent", border: `1px solid ${M.border}`, borderRadius: 10, cursor: "pointer" }}>
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* ---- 3. MINHAS SUGESTÕES ----------------------------------------- */}
        {d && (
          <section style={{ background: M.surface, border: `1px solid ${M.border}`, borderRadius: 12, padding: 18 }}>
            <h2 style={{ margin: "0 0 3px", fontSize: 16, fontWeight: 800, color: M.wine }}>
              {d.sou_admin ? "Templates da equipe" : "Meus templates"}
            </h2>
            <p style={{ margin: "0 0 12px", fontSize: 12.5, color: M.gray }}>
              {d.sou_admin
                ? "Você avalia em Administração → Templates → Sugestões."
                : "Os que você criou, e em que pé estão."}
            </p>
            {!sugestoes.length ? (
              <Vazio>Você ainda não criou nenhum template.</Vazio>
            ) : sugestoes.map((s) => {
              const c = CORES[s.estado.chave] ?? CORES.analise_admin;
              return (
                <div key={s.id} style={{ borderTop: `1px solid ${M.bg}`, padding: "12px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <b style={{ fontSize: 13.5 }}>{s.nome}</b>
                    <Selo cor={c.cor} bg={c.bg} borda={c.borda}>{s.estado.rotulo}</Selo>
                    {s.estado.chave === "analise_admin" && (
                      <span style={{ fontSize: 11, color: M.muted }}>
                        {s.espera_dias === 0 ? "enviada hoje" : `esperando há ${s.espera_dias} dia${s.espera_dias > 1 ? "s" : ""}`}
                      </span>
                    )}
                  </div>
                  <TextoComoACliente corpo={s.corpo} cabecalho={s.cabecalho_texto} rodape={s.rodape} />
                  {s.motivo && (
                    <p style={{ fontSize: 12.5, color: "#b3261e", background: "#fdeae9", border: "1px solid #f2c4c0",
                      borderRadius: 9, padding: "8px 11px", margin: "8px 0 0", lineHeight: 1.5 }}>
                      <b>Motivo:</b> {s.motivo}
                    </p>
                  )}
                  {s.status === "recusado" && (
                    <button onClick={() => corrigir(s)}
                      style={{ marginTop: 8, padding: "6px 13px", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                        color: "#fff", background: M.azul, border: "none", borderRadius: 8, cursor: "pointer" }}>
                      Corrigir e reenviar
                    </button>
                  )}
                  {s.status === "pendente" && (
                    <button onClick={async () => {
                      if (!confirm(`Apagar o template "${s.nome}"?`)) return;
                      const r = await fetch(`/api/templates/sugestoes?id=${s.id}`, { method: "DELETE" });
                      const j = await r.json().catch(() => ({}));
                      if (!r.ok) setErro(j?.error ?? `erro ${r.status}`); else { setOk(j?.aviso ?? "Apagada."); void carregar(); }
                    }}
                      style={{ marginTop: 8, marginLeft: 8, padding: "6px 13px", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
                        color: M.gray, background: "transparent", border: `1px solid ${M.border}`, borderRadius: 8, cursor: "pointer" }}>
                      Apagar
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

/** A bolha, com um nome de exemplo no lugar de {{1}} — nunca as chaves cruas. */
function TextoComoACliente({ corpo, cabecalho, rodape }: { corpo: string; cabecalho?: string | null; rodape?: string | null }) {
  return (
    <div style={{ background: "#e8f6ff", border: "1px solid #cfeafb", borderRadius: 12, borderTopLeftRadius: 4, padding: "9px 12px", maxWidth: 560 }}>
      {cabecalho && <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 3 }}>{cabecalho}</div>}
      <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", color: M.ink }}>
        {aplicarVariaveis(corpo ?? "", [NOME_EXEMPLO])}
      </div>
      {rodape && <div style={{ fontSize: 11, color: M.gray, marginTop: 4 }}>{rodape}</div>}
    </div>
  );
}

function Selo({ children, cor, bg, borda }: { children: React.ReactNode; cor: string; bg: string; borda: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.2, color: cor, background: bg,
      border: `1px solid ${borda}`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: M.muted, margin: 0 }}>{children}</p>;
}

function Recado({ tipo, children }: { tipo: "erro" | "ok"; children: React.ReactNode }) {
  const c = tipo === "erro"
    ? { cor: "#b3261e", bg: "#fdeae9", borda: "#f2c4c0" }
    : { cor: M.verde, bg: "#e7f6ec", borda: "#bfe6cd" };
  return (
    <div style={{ margin: "0 0 14px", padding: "10px 13px", fontSize: 13, lineHeight: 1.5,
      color: c.cor, background: c.bg, border: `1px solid ${c.borda}`, borderRadius: 10 }}>
      {children}
    </div>
  );
}
