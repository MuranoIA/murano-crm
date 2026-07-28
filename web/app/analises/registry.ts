// Catálogo de análises. Novas análises entram aqui — o hub (/analises) e o visualizador
// (/analises/[slug]) leem desta lista. tipo:
//   "embed"   -> abre dentro do app num iframe (/analises/[slug])
//   "externo" -> abre em nova aba
//   "interno" -> rota interna do próprio app (url = caminho, ex.: "/analises/x")
export type Analise = {
  slug: string;
  titulo: string;
  desc: string;
  emoji: string;
  cor: string;    // cor de destaque do card
  tag: string;    // etiqueta curta
  tipo: "embed" | "externo" | "interno";
  url: string;
};

export const ANALISES: Analise[] = [
  {
    slug: "bi-conversas",
    titulo: "B.I. de Conversas",
    desc: "Volume de conversas, horários de pico, tempo de resposta e conversão de conversa em venda.",
    emoji: "💬",
    cor: "#0e9fd6",
    tag: "Conversas",
    tipo: "embed",
    url: "https://bi-conversas-murano.netlify.app/",
  },
];

export const analiseBySlug = (slug: string) => ANALISES.find((a) => a.slug === slug) ?? null;
