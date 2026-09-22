// Formatação de tela. Tudo aqui é puro e testável, e não conhece React.

const BRT = "America/Belem";

const hh = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: BRT });
const dia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: BRT });
const diaLongo = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: BRT });
const diaCurto = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: BRT });

export const hora = (iso: string) => hh.format(new Date(iso));

/** Na lista: hoje mostra a hora, ontem mostra "ontem", antes mostra a data.
 *  É o que o WhatsApp faz, e é a informação que decide se vale abrir. */
export function quando(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const agora = new Date();
  const mesmoDia = dia.format(d) === dia.format(agora);
  if (mesmoDia) return hh.format(d);
  const ontem = new Date(agora.getTime() - 86_400_000);
  if (dia.format(d) === dia.format(ontem)) return "ontem";
  return diaCurto.format(d);
}

/** Separador de dia na thread. */
export function diaDaMensagem(iso: string): string {
  const d = new Date(iso);
  const agora = new Date();
  if (dia.format(d) === dia.format(agora)) return "hoje";
  const ontem = new Date(agora.getTime() - 86_400_000);
  if (dia.format(d) === dia.format(ontem)) return "ontem";
  return diaLongo.format(d);
}

export const chaveDoDia = (iso: string) => dia.format(new Date(iso)) + "/" + new Date(iso).getFullYear();

/** Iniciais para o avatar. Nome vazio ou só número cai numa inicial neutra. */
export function iniciais(nome: string | null | undefined): string {
  // ⚠️ só letras: a base tem nomes com parêntese e emoji, e sem isto o avatar
  // saía "L(" — visto na primeira foto do v2
  const limpo = String(nome ?? "")
    .replace(/^[A-Z]?\d+\s*-\s*/i, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .trim();
  if (!limpo) return "·";
  const partes = limpo.split(/\s+/).filter((p) => p.length > 1);
  if (!partes.length) return limpo.slice(0, 1).toUpperCase();
  const a = partes[0][0];
  const b = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (a + b).toUpperCase();
}

// Tons de avatar. São variações de superfície, não cores de marca: a cor com
// significado nesta tela é o azul (ação) e o laranja (precisa de resposta), e
// avatar colorido demais roubaria a atenção deles.
const TONS = ["#efe6ee", "#e7ecf4", "#eceee7", "#f3ebe4", "#e9e9f0", "#f0e8ec"];

export function tomDoAvatar(chave: string): string {
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) >>> 0;
  return TONS[h % TONS.length];
}

/** "K4580 - KAREN DE JESUS" → nome sem o código, que já aparece ao lado. */
export function nomeLimpo(nome: string | null | undefined): string {
  const s = String(nome ?? "").trim();
  return s.replace(/^[A-Z]?\d+\s*-\s*/i, "").trim() || s || "Sem nome";
}

export function telefoneBonito(tel: string | null | undefined): string {
  const d = String(tel ?? "").replace(/\D/g, "");
  if (d.length < 10) return String(tel ?? "");
  const nac = d.startsWith("55") ? d.slice(2) : d;
  const ddd = nac.slice(0, 2);
  const resto = nac.slice(2);
  const meio = resto.length > 8 ? resto.slice(0, resto.length - 4) : resto.slice(0, 4);
  const fim = resto.slice(-4);
  return `(${ddd}) ${meio}-${fim}`;
}

export const dinheiro = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));

/** Prévia da conversa na lista: uma linha, sem quebra, com quem falou. */
export function previa(c: { ultima_mensagem: string | null; ultima_enviada_por: string | null }): string {
  const txt = String(c.ultima_mensagem ?? "").replace(/\s+/g, " ").trim();
  if (!txt) return "sem mensagem";
  return c.ultima_enviada_por === "customer" ? txt : `Você: ${txt}`;
}
