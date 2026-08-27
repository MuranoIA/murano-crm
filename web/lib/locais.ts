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

/**
 * Aceita o que se cola do Google Maps.
 *
 * O gesto real de quem cadastra é: abrir o Maps, clicar com o botão direito no
 * ponto, "copiar coordenadas" — e colar. Sai `-1.4558, -48.5044`. Pedir dois
 * campos separados obrigaria a pessoa a recortar a vírgula à mão, que é onde
 * ela erra.
 */
export function lerCoordenadas(txt: string): { lat: number; lng: number } | null {
  const m = /(-?\d{1,3}[.,]\d+)\s*[,;]\s*(-?\d{1,3}[.,]\d+)/.exec(String(txt ?? ""));
  if (!m) return null;
  const lat = Number(m[1].replace(",", ".")), lng = Number(m[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
