// ---------------------------------------------------------------------------
// A MINIATURA DO MAPA — a conta de qual pedaço do mundo desenhar.
//
// Pedido do dono (28/09/2026): a localização já vira cartão, mas ainda exige um
// clique para ver ONDE é. A miniatura responde isso de relance.
//
// ⚠️ A pergunta que veio junto foi "se não for deixar lento". Medido antes de
// fazer: a base inteira tem **61 mensagens de localização, 56 nos últimos 30
// dias** — cerca de duas por dia. Não é um tipo de mensagem que apareça em
// volume; e ainda assim a miniatura é `loading="lazy"`, então só custa quando a
// bolha entra na tela.
//
// COMO É FEITA, e por que não é um provedor de mapa estático:
//
// Um "static map" de uma linha (Google, Mapbox, Maptiler) resolveria com UMA
// requisição, mas todos pedem chave e cobram. O que existe sem chave são os
// LADRILHOS do OpenStreetMap — imagens de 256×256 endereçadas por z/x/y. Então
// a conta abaixo escolhe **quatro ladrilhos** (2×2) em volta do ponto e diz em
// que deslocamento desenhá-los para o ponto ficar no CENTRO da janela.
//
// Por que 2×2 sempre dá certo: escolhendo o vizinho do lado em que o ponto está
// mais perto da borda, ele cai no miolo do mosaico (entre 128 e 384 px dos 512).
// A janela de 244×132 centrada nele fica então entre −6 e +506 — dentro do
// mosaico em qualquer caso. Com 3 colunas o pior caso sumiria, mas seriam seis
// requisições em vez de quatro.
//
// O ALFINETE é desenhado por cima, em CSS, no centro da janela: pedir um mapa
// "com marcador" é justamente o que obrigaria a um provedor com chave.
// ---------------------------------------------------------------------------

/** 17 ≈ 1,2 m por pixel: a janela cobre ~290 m, que é o quarteirão do endereço */
export const ZOOM_MAPA = 17;
export const LARGURA_MAPA = 244;
export const ALTURA_MAPA = 132;
const LADRILHO = 256;

export type PedacoDeMapa = {
  /** os quatro ladrilhos, já na ordem de desenho */
  ladrilhos: { z: number; x: number; y: number; esq: number; topo: number }[];
  largura: number;
  altura: number;
};

/**
 * Onde o ponto cai no mapa do mundo, em pixels, no zoom dado.
 * É a projeção de Mercator esférica — a mesma que todo mapa de ladrilhos usa.
 */
function emPixels(lat: number, lng: number, z: number) {
  const n = LADRILHO * 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const seno = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI)) * n;
  return { x, y, n };
}

/** os quatro ladrilhos e seus deslocamentos, para o ponto ficar no centro */
export function pedacoDeMapa(lat: number, lng: number, z = ZOOM_MAPA): PedacoDeMapa | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -85 || lat > 85 || lng < -180 || lng > 180) return null;

  const { x, y, n } = emPixels(lat, lng, z);
  const tx = Math.floor(x / LADRILHO);
  const ty = Math.floor(y / LADRILHO);
  // o vizinho do lado em que o ponto está mais perto da borda
  const vx = x - tx * LADRILHO < LADRILHO / 2 ? tx - 1 : tx;
  const vy = y - ty * LADRILHO < LADRILHO / 2 ? ty - 1 : ty;

  // canto superior esquerdo do mosaico, em pixels do mundo
  const ox = vx * LADRILHO;
  const oy = vy * LADRILHO;
  // …e o deslocamento que põe o ponto no centro da janela
  const esq = LARGURA_MAPA / 2 - (x - ox);
  const topo = ALTURA_MAPA / 2 - (y - oy);

  const maxT = 2 ** z;
  const ladrilhos: PedacoDeMapa["ladrilhos"] = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      // dá a volta no mundo na horizontal; na vertical não existe volta
      const cx = ((vx + i) % maxT + maxT) % maxT;
      const cy = vy + j;
      if (cy < 0 || cy >= maxT) continue;
      ladrilhos.push({ z, x: cx, y: cy, esq: esq + i * LADRILHO, topo: topo + j * LADRILHO });
    }
  }
  return ladrilhos.length ? { ladrilhos, largura: LARGURA_MAPA, altura: ALTURA_MAPA } : null;
}

/** o endereço do ladrilho NA NOSSA rota — nunca o do OSM direto (ver a rota) */
export const urlDoLadrilho = (t: { z: number; x: number; y: number }) =>
  `/api/chat/mapa?z=${t.z}&x=${t.x}&y=${t.y}`;
