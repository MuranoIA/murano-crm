import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// O LADRILHO DO MAPA, servido por nós (28/09/2026).
//
// A bolha de localização desenha a miniatura com quatro ladrilhos do
// OpenStreetMap. Eles poderiam ser pedidos direto do navegador — e é por três
// razões que passam por aqui:
//
//   1. PRIVACIDADE. Pedindo do navegador, o endereço da cliente sai da máquina
//      do consultor para um terceiro, com `Referer` do CRM junto. Aqui quem
//      pede é o servidor, e o que ele pede é um QUADRADO do mapa (z/x/y), não
//      um par de coordenadas: no zoom 17 isso é um quarteirão, não uma casa.
//   2. POLÍTICA DE USO do OSM, que exige um `User-Agent` que identifique quem
//      chama. Navegador nenhum deixa definir isso.
//   3. CACHE. O ladrilho é imutável por construção, então ele é guardado por
//      uma semana na borda e para sempre no navegador. Duas clientes do mesmo
//      bairro compartilham a imagem.
//
// ⚠️ Volume: a base inteira tem 61 mensagens de localização (56 em 30 dias).
// Quatro ladrilhos cacheados por bolha, e só quando ela entra na tela.
//
// Falhar aqui não pode quebrar a conversa: a bolha esconde a miniatura no
// `onError` e continua sendo o cartão de texto que já era.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const ESPELHOS = ["a", "b", "c"];
const MAX_Z = 19;

export async function GET(req: Request) {
  // a sessão do CRM — não é para virar proxy aberto de imagem de terceiro
  if (!cookies().get("crm_sessao")?.value) {
    return new Response("não autenticado", { status: 401 });
  }

  const p = new URL(req.url).searchParams;
  const z = Number(p.get("z"));
  const x = Number(p.get("x"));
  const y = Number(p.get("y"));
  // validação fechada: são os três únicos números possíveis, e sem ela isto
  // seria um caminho para pedir qualquer coisa ao servidor do OSM
  const limite = 2 ** z;
  const ok =
    Number.isInteger(z) && z >= 0 && z <= MAX_Z &&
    Number.isInteger(x) && x >= 0 && x < limite &&
    Number.isInteger(y) && y >= 0 && y < limite;
  if (!ok) return new Response("parâmetros inválidos", { status: 400 });

  const espelho = ESPELHOS[(x + y) % ESPELHOS.length];
  try {
    const r = await fetch(`https://${espelho}.tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: {
        // exigido pela política de uso do OSM: quem chama tem de se identificar
        "User-Agent": "MuranoPulse/1.0 (CRM interno; contato: ia@muranoprofessional.com.br)",
        Accept: "image/png,image/*",
      },
      // uma semana na borda: o desenho do mapa muda devagar, e o ladrilho é o
      // mesmo para todo mundo
      next: { revalidate: 604800 },
    });
    if (!r.ok) return new Response("ladrilho indisponível", { status: 502 });
    return new Response(r.body, {
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=604800, s-maxage=604800, immutable",
      },
    });
  } catch {
    return new Response("ladrilho indisponível", { status: 502 });
  }
}
