// Catálogo de catálogos. Cada card abre um catálogo (site murano-catalogo, aba nova).
// Novos catálogos entram aqui — o hub (/catalogos) lê desta lista.
export type Catalogo = {
  slug: string;
  titulo: string;
  desc: string;
  emoji: string;
  cor: string;   // cor de destaque do card
  tag: string;   // etiqueta curta
  url: string;   // link do catálogo (abre em nova aba)
};

export const CATALOGOS: Catalogo[] = [
  {
    slug: "produtos",
    titulo: "Catálogo de Produtos",
    desc: "Catálogo completo da Murano e Maxiline — busca por nome, marca e categoria, com fotos, tamanhos e descrição.",
    emoji: "📚",
    cor: "#57163f",
    tag: "Completo",
    url: "https://murano-catalogo.vercel.app/produtos",
  },
  {
    slug: "saldao-de-verao",
    titulo: "Saldão de Verão",
    desc: "Campanha promocional — descontos de até 43% OFF em Murano e Maxiline. Busca por nome e ordenação por preço.",
    emoji: "☀️",
    cor: "#f97316",
    tag: "Promoção",
    url: "https://murano-catalogo.vercel.app/saldao-de-verao",
  },
];
