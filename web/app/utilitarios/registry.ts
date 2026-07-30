// Utilitários do CRM. Novos utilitários entram aqui — o hub (/utilitarios) lê desta lista.
export type Utilitario = {
  slug: string;
  titulo: string;
  desc: string;
  emoji: string;
  cor: string;
  tag: string;
  url: string; // rota interna
};

export const UTILITARIOS: Utilitario[] = [
  {
    slug: "foto-ranking",
    titulo: "Foto no Ranking",
    desc: "Envie sua foto para aparecer ao lado do seu nome no ranking de vendas. Você só altera a sua própria foto.",
    emoji: "📸",
    cor: "#7c5cfc",
    tag: "Ranking",
    url: "/utilitarios/foto-ranking",
  },
];
