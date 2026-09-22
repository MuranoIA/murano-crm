import { NextResponse, type NextRequest } from "next/server";
import { ehOutraTela, layoutEfetivo } from "./lib/chatLayout";

// ---------------------------------------------------------------------------
// QUAL CHAT ESTA PESSOA VÊ — decidido no SERVIDOR, antes de qualquer JS.
//
// Fase 6 do chat-v2 (CLAUDE.md §73): o piloto é por pessoa (`acesso.chat_layout`,
// 0095). O desenho em vigor já era lido pelo /chat antigo — mas pela
// `/api/chat`, DEPOIS do JS carregar, porque os desenhos de lá são paletas da
// mesma tela. O chat-v2 é OUTRA tela: descobrir isso no navegador faria a
// pessoa ver o chat antigo por um instante e depois pular, a cada abertura.
//
// Por que aqui, e não no /chat:
//   · o chat antigo não é editado (§73.2) — ele é a volta segura;
//   · TODAS as portas de entrada apontam para `/chat`: o iframe do hub (§17, via
//     `crm_tela`), o link do board (§40.1), o push (§72), o F5. Decidindo aqui,
//     nenhuma delas precisa saber que existe um v2.
//
// O matcher é o `/chat` EXATO: `/chat/indicadores` não passa por aqui, e nenhuma
// outra rota do CRM paga esta consulta.
//
// FALHA PARA O LADO DO QUE JÁ FUNCIONA: sem sessão, sem env, consulta lenta ou
// com erro — segue para o chat de hoje. Um piloto que não acende é um incômodo;
// o chat não abrir seria um atendimento parado.
// ---------------------------------------------------------------------------

export const config = { matcher: ["/chat"] };

/** acima disto o chat de hoje abre direto: esperar o banco não vale uma tela parada */
const PRAZO_MS = 2500;

// ---- a decisão fica guardada por UM MINUTO --------------------------------
// Medido: a consulta levou 1,3 s a partir da máquina de desenvolvimento, e a
// primeira versão (sem memória) estourou o prazo e cobrava isso de TODA
// abertura do /chat. Em produção a função roda perto do banco e é bem menos,
// mas uma ida ao banco por navegação continua sendo custo sem ganho: o piloto
// muda uma vez por dia, não por clique.
//
// Então o desenho decidido vai num cookie de 60 s, AMARRADO AO USUÁRIO (sair e
// entrar como outra pessoa no mesmo navegador não herda a decisão da anterior).
// Preço aceito: ligar ou desligar um piloto leva até um minuto para valer.
const COOKIE = "crm_chat_desenho";
const MEMORIA_S = 60;

/** null = não deu para saber (sem env, erro, prazo): quem chama cai no chat de hoje */
async function lerDesenho(usuario: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  // A chave nova (`sb_secret_…`) vai só no `apikey`; como Bearer ela é recusada
  // por não ser JWT. A antiga (JWT) aceita os dois.
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PRAZO_MS);
  try {
    const [g, p] = await Promise.all([
      fetch(`${url}/rest/v1/chat_layout?select=layout&id=eq.1`, { headers, signal: ctl.signal, cache: "no-store" }),
      fetch(`${url}/rest/v1/acesso?select=chat_layout&email=eq.${encodeURIComponent(usuario)}`, {
        headers, signal: ctl.signal, cache: "no-store",
      }),
    ]);
    if (!g.ok || !p.ok) return null;
    const global = ((await g.json()) as any[])[0]?.layout;
    const piloto = ((await p.json()) as any[])[0]?.chat_layout;
    // a MESMA régua do resto do CRM: piloto ganha do global, valor desconhecido
    // ou sem tela construída cai no padrão
    return layoutEfetivo(global, piloto);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function middleware(req: NextRequest) {
  const sessao = req.cookies.get("crm_sessao")?.value;
  if (!sessao) return NextResponse.next();
  // a mesma identidade de `lib/chatUsuario.ts`: o e-mail do login Google, ou o
  // próprio valor da sessão no login por senha (que não acha linha em `acesso`
  // e fica no desenho global — o certo, já que o piloto é por e-mail)
  const usuario = req.cookies.get("crm_email")?.value || sessao;

  const guardado = req.cookies.get(COOKIE)?.value ?? "";
  const [quem, oQue] = guardado.split("|");
  const lembrado = quem === usuario && !!oQue;
  const lido = lembrado ? oQue : await lerDesenho(usuario);
  const desenho = lido ?? "original";

  // Só guarda decisão que VEIO DO BANCO. Guardar a de uma consulta que falhou
  // prenderia a pessoa fora do piloto por um minuto por causa de uma rede lenta.
  const guardar = (r: NextResponse) => {
    if (lembrado || lido === null) return r;
    const seguro = req.nextUrl.protocol === "https:";
    r.cookies.set(COOKIE, `${usuario}|${desenho}`, {
      path: "/", maxAge: MEMORIA_S, httpOnly: true,
      // no iframe do hub o documento de topo é outro site (§17/§64): sem
      // None+Secure o navegador descarta o cookie lá dentro
      ...(seguro ? { sameSite: "none" as const, secure: true } : { sameSite: "lax" as const }),
    });
    return r;
  };

  if (!ehOutraTela(desenho as any)) {
    // o desenho decidido vai num cabeçalho: é como se confere, de fora, que a
    // consulta funcionou (um `original` aqui com piloto ligado é o sintoma de
    // env ausente ou prazo estourado) — não carrega dado nenhum da pessoa
    const r = NextResponse.next();
    r.headers.set("x-chat-desenho", lido === null ? "original (consulta falhou)" : `${desenho}${lembrado ? " (lembrado)" : ""}`);
    return guardar(r);
  }

  // redireciona preservando tudo: `?cliente=` (board, push, F5) e `embed=1`
  // (a lupa do board, §41). O v2 lê os dois.
  const destino = req.nextUrl.clone();
  destino.pathname = "/chat-v2";
  return guardar(NextResponse.redirect(destino, 307));
}
