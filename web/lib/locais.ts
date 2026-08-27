// Endereços que o consultor pode enviar como localização no chat (0111).
//
// Moram em `crm_config.locais`, editáveis em /admin — quem sabe a coordenada
// certa é quem está na loja, não quem faz deploy. Mesmo padrão de
// `cadastro_campos` e `texto_pausa`.
//
// A Murano tem duas filiais (Venus e MK Cosméticos, §12.3), então é lista.

export type Local = {
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
};

/**
 * Higieniza o que veio do banco. Coordenada é o campo que mais dá errado ao ser
 * digitada à mão — vírgula no lugar do ponto, hemisfério trocado, texto colado
 * do Google Maps inteiro. Linha inválida **não vira endereço**: melhor faltar um
 * botão do que mandar a cliente para o meio do Atlântico.
 */
export function lerLocais(bruto: unknown): Local[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((l: any) => ({
      nome: String(l?.nome ?? "").trim(),
      endereco: String(l?.endereco ?? "").trim(),
      lat: Number(String(l?.lat ?? "").toString().replace(",", ".")),
      lng: Number(String(l?.lng ?? "").toString().replace(",", ".")),
    }))
    .filter((l) =>
      l.nome && l.endereco &&
      Number.isFinite(l.lat) && Number.isFinite(l.lng) &&
      Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180 &&
      // 0,0 é o "Ilha Nula" no golfo da Guiné: quase sempre é campo vazio que
      // virou zero, nunca um endereço de verdade.
      !(l.lat === 0 && l.lng === 0));
}

/** Link curto do botão "Compartilhar" — é um redirecionador, não tem coordenada. */
const LINK_CURTO = /(maps\.app\.goo\.gl|goo\.gl\/maps)/i;

/**
 * Aceita o que se cola do Google Maps — as duas formas que as pessoas usam.
 *
 * 1. **Coordenada crua** (`-1.4558, -48.5044`): botão direito no ponto do mapa,
 *    o primeiro item do menu já é a coordenada, e clicar copia.
 * 2. **O link inteiro da barra de endereço**, colado do jeito que vier.
 *
 * A 2 existe porque a 1 quase ninguém descobre sozinho. E o botão que todo
 * mundo tenta primeiro — "Compartilhar" — devolve um link CURTO
 * (`maps.app.goo.gl/…`) que **não carrega coordenada nenhuma**: é só um
 * redirecionador. Recusamos explicitamente, para a tela poder dizer o que fazer
 * em vez de mostrar "inválido" diante de um link que parece perfeito.
 *
 * ⚠️ A ordem de leitura do link importa. Num endereço do Maps o `@` é o
 * **centro da tela** — muda se a pessoa arrastou o mapa antes de copiar. O pino
 * de verdade está em `!3d…!4d…`. Ler o `@` primeiro daria um ponto plausível e
 * levemente errado, que é o pior tipo de erro aqui: ninguém confere.
 */
export function lerCoordenadas(txt: string): { lat: number; lng: number } | null {
  const s = String(txt ?? "");
  if (LINK_CURTO.test(s)) return null;

  const m =
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(s) ??      // o pino
    /[?&]q=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(s) ??   // ?q=lat,lng
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(s) ??           // centro do mapa
    /(-?\d{1,3}[.,]\d+)\s*[,;]\s*(-?\d{1,3}[.,]\d+)/.exec(s); // colada à mão
  if (!m) return null;

  const lat = Number(m[1].replace(",", ".")), lng = Number(m[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Por que esta linha não foi aceita, em português.
 *
 * "1 com problema" não ajuda quem está cadastrando: o erro quase sempre é um
 * caso conhecido, e dizer qual resolve na hora.
 */
export function problemaCoordenada(txt: string): string | null {
  const s = String(txt ?? "").trim();
  if (!s) return "falta a coordenada ou o link do Google Maps";
  if (LINK_CURTO.test(s))
    return "este é o link do botão Compartilhar, que não carrega a coordenada — copie o endereço da barra do navegador, ou clique com o botão direito no mapa e copie a coordenada";
  if (lerCoordenadas(s)) return null;
  return "não achei uma coordenada aqui — deve parecer com -1.4558, -48.5044";
}
