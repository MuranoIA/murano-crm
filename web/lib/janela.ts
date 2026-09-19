import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Em que tamanho de janela a tela está — e o que cada tamanho pode mostrar.
//
// Por que existe (demanda 11): a consultora divide o monitor em duas janelas do
// Chrome e o CRM fica com METADE da largura — 683 px num monitor de 1366, 960
// num de 1920. A tela só conhecia dois tamanhos, "celular" (menos de 768) e
// "mesa" (todo o resto), e meia janela cai justamente no meio: larga demais para
// o desenho de celular, estreita demais para o de mesa. O chat tentava três
// colunas (lista 320 + conversa + painel do cliente 320) e deixava a conversa
// com ~320 px, com botões um em cima do outro; o board empurrava "Sair" para
// fora da tela.
//
// ---- de onde vem a ideia -------------------------------------------------
// Material Design 3 chama isso de "window size classes": em vez de perguntar "é
// celular?", pergunta-se em qual FAIXA de largura a janela está, e cada faixa
// tem um arranjo próprio (compact / medium / expanded). Aqui as três faixas
// seguem os cortes que o projeto já tinha, mais um novo:
//
//   compacta   < 768     uma coluna por vez. É o `isMobile` de sempre — mantido
//                        idêntico de propósito, o desenho de celular funciona.
//   média      768–1183  duas colunas (lista + conversa). O painel do cliente
//                        deixa de ser coluna e vira uma folha lateral que abre
//                        por cima — o "side sheet" do Material.
//   expandida  ≥ 1184    três colunas, como sempre foi.
//
// O 1184 não é gosto: lista 320 + painel 320 + uma conversa que não seja um
// aperto (~540) somam ~1180. Abaixo disso a conversa perde o que a torna útil.
//
// ---- por que NÃO uma biblioteca de componentes ---------------------------
// O app é estilo inline de ponta a ponta (não há uma única `@media` nem folha
// de estilo), e o que falta não é um botão mais bonito: é REGRA de arranjo por
// largura. MUI/Emotion, Tailwind ou similares obrigariam a reescrever as
// milhares de linhas de JSX para ganhar o que aqui se resolve com um número e um
// gancho — e colocariam um segundo sistema de estilo convivendo com o primeiro.
// Do Material vem o CONCEITO (classes de janela, lista-detalhe, folha lateral),
// que é o que resolve o problema; a implementação continua sendo a do projeto.
// ---------------------------------------------------------------------------

/** Abaixo disto: uma coluna por vez (celular). Idêntico ao `isMobile` antigo. */
export const LIMITE_CELULAR = 768;

/** Abaixo disto a navegação do produto (Funil, Chat, Orçamento…) já não cabe na
 *  barra junto com identidade, tema e "Sair" — medido: com 960 px "Sair" ficava
 *  14 px fora da tela, e com 768 o cabeçalho transbordava 206 px. Recolhe no ☰. */
export const LIMITE_NAVEGACAO = 1064;

/** A partir daqui cabem três colunas no chat sem sufocar a conversa. */
export const LIMITE_TRES_COLUNAS = 1184;

export type ClasseJanela = "compacta" | "media" | "expandida";

export function classeDaJanela(largura: number): ClasseJanela {
  if (largura < LIMITE_CELULAR) return "compacta";
  if (largura < LIMITE_TRES_COLUNAS) return "media";
  return "expandida";
}

/**
 * A largura da JANELA, e não da tela. Dentro de um iframe (a lupa do board, o
 * hub) `innerWidth` é a largura do quadro — e é isso que se quer: a lupa tem
 * ~500 px e cai sozinha no desenho de celular, sem código próprio.
 *
 * Arredonda PARA BAIXO em múltiplos de 8: arrastar a borda da janela dispara
 * dezenas de eventos por segundo, e sem isso cada pixel re-renderizaria telas de
 * milhares de linhas — com o arredondamento o React descarta o `setState` de
 * valor igual. Para baixo, e não "para o mais próximo", porque os limites acima
 * são múltiplos de 8: assim 767 continua sendo celular e 768 continua não sendo,
 * exatamente como o `innerWidth < 768` de antes.
 *
 * Nasce como "mesa" (1280) e ajusta no primeiro efeito, o mesmo estado inicial
 * que o `isMobile` antigo tinha — ler `window` no render daria hidratação
 * divergente entre servidor e cliente.
 */
export function useLarguraJanela(inicial = 1280): number {
  const [largura, setLargura] = useState(inicial);
  useEffect(() => {
    const ler = () => setLargura(Math.floor(window.innerWidth / 8) * 8);
    ler();
    window.addEventListener("resize", ler);
    return () => window.removeEventListener("resize", ler);
  }, []);
  return largura;
}
