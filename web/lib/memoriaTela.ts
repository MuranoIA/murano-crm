// ---------------------------------------------------------------------------
// MEMÓRIA DE TELA — o estado que sobrevive à troca de rota.
//
// O PROBLEMA, relatado em 12/09/2026 duas vezes, de duas formas: "filtrei o
// board por produto, cliquei num card, voltei por Negociações e o filtro
// sumiu", e "ao alternar entre chat e board, eles recarregam em vez de manter o
// último estado".
//
// A causa é a mesma nas duas: board e chat são PÁGINAS diferentes do App
// Router. `router.push("/chat")` e `<Link href="/">` desmontam a árvore inteira
// da página que se deixa, e toda escolha da tela é `useState` — que morre na
// desmontagem. Na volta tudo nasce no padrão e a rota é buscada de novo.
//
// ⚠️ NÃO É PROBLEMA DE ROTEAMENTO, e fundir as duas telas numa rota só seria a
// correção errada: cada uma precisa de URL própria (é o que faz `?cliente=<id>`
// funcionar, o "voltar" do navegador funcionar e a volta do SSO cair na tela
// certa), e o Next carrega só o JS da tela aberta. O que faltava era uma camada
// de estado, não outra arquitetura.
//
// A camada é esta, e o truque é uma linha: a memória mora em ESCOPO DE MÓDULO.
// Um módulo carregado não é desmontado quando a rota muda — o app é uma SPA —,
// então a volta encontra tudo onde estava, sem serializar nada.
//
// Isto existe como lib, e não copiado nas duas telas, porque foi exatamente o
// tipo de duplicação que já custou caro aqui: o board tem três caches escritos
// à mão e duas guardas de coalescência, e as DUAS guardas nasceram com o mesmo
// defeito de descartar evento que chega durante o voo.
// ---------------------------------------------------------------------------

/** Transformações para o espelho em disco, quando o estado não é JSON puro. */
export type Transformadores<T> = {
  paraDisco: (v: T) => unknown;
  doDisco: (o: any) => T;
};

export type MemoriaTela<T> = {
  /** O que ficou guardado, ou `null` na primeira visita da aba. */
  ler: () => T | null;
  gravar: (v: T) => void;
  limpar: () => void;
};

/**
 * Memória das ESCOLHAS da pessoa (filtros, busca, ordenação).
 *
 * ⚠️ `sessionStorage`, NÃO `localStorage`, e a diferença é de negócio: filtro é
 * contexto de uma sessão de trabalho, não preferência. Em `localStorage` ele
 * sobreviveria ao fechamento do navegador, e uma semana depois alguém abriria a
 * tela filtrada por algo que esqueceu, concluiria que "sumiram clientes" e iria
 * atrás de um bug que não existe. Em `sessionStorage` vale enquanto a aba viver
 * — que é exatamente "ir à outra tela e voltar" — e sobrevive também ao F5.
 *
 * O espelho em disco serve só ao F5. Quem responde no caso comum é a variável
 * de módulo, que nem passa por JSON — e por isso guarda tipos que o JSON não
 * sabe representar (`Set`, `Map`) sem precisar de transformador nenhum.
 */
export function memoriaDeTela<T>(chave: string, t?: Transformadores<T>): MemoriaTela<T> {
  let vivo: T | null = null;
  let leuDisco = false;

  return {
    ler() {
      if (vivo) return vivo;
      // Uma tentativa só: com o disco ilegível (aba anônima, cota, JSON
      // corrompido) insistir a cada render seria pagar o erro repetidamente
      // para nunca ter resposta diferente.
      if (leuDisco || typeof window === "undefined") return vivo;
      leuDisco = true;
      try {
        const cru = window.sessionStorage.getItem(chave);
        if (cru) {
          const o = JSON.parse(cru);
          vivo = t ? t.doDisco(o) : (o as T);
        }
      } catch { /* sem memória: a tela abre no padrão, que é o de sempre */ }
      return vivo;
    },
    gravar(v: T) {
      vivo = v;
      try { window.sessionStorage.setItem(chave, JSON.stringify(t ? t.paraDisco(v) : v)); } catch {}
    },
    limpar() {
      vivo = null;
      try { window.sessionStorage.removeItem(chave); } catch {}
    },
  };
}

/**
 * A SESSÃO, lida uma vez por aba.
 *
 * Relatado em 12/09/2026: *"ao alternar entre negociações e chat, sempre
 * aparece Verificando sessão"*. E aparecia mesmo — as duas telas travavam o
 * render INTEIRO até o `/api/session` responder, e a medição da abertura do
 * board mostrou essa chamada ocupando **816 ms sozinha, na frente de tudo**.
 *
 * É desnecessário pelo motivo mais simples: a sessão é a MESMA nas duas telas e
 * não muda ao navegar entre elas. Quem realmente a troca — `/api/trocar-papel`
 * — já recarrega a página, e aí o módulo morre junto.
 *
 * Então: a primeira tela da aba paga a espera, as seguintes leem daqui na hora
 * e revalidam por baixo. Se a revalidação trouxer outra coisa (papel diferente,
 * ou ninguém), a tela se corrige sozinha — é o mesmo stale-while-revalidate do
 * resto deste arquivo, aplicado à coisa que mais bloqueava.
 *
 * ⚠️ Só em memória, de propósito. Sessão em `sessionStorage` seria um cookie de
 * autorização espelhado em disco por conta própria: o servidor continua sendo o
 * dono da régua (toda rota lê o cookie `crm_sessao` e decide sozinha), e isto
 * aqui é só para a TELA não piscar. Nada de autorização depende deste valor.
 */
export type Sessao = { role: string; carteira: string | null; papeis?: string[]; email?: string | null };

let sessaoAtual: Sessao | null = null;

/**
 * ⚠️ UMA INSTÂNCIA SÓ, exportada — não uma fábrica.
 *
 * A primeira versão era `sessaoDaAba<T>()`, uma fábrica, e cada tela chamava a
 * sua. O resultado, medido no navegador: board e chat ficaram com memórias
 * SEPARADAS, e o portão "Verificando sessão…" continuou aparecendo ao trocar de
 * tela — a memória do chat não sabia o que a do board tinha acabado de
 * descobrir.
 *
 * É a mesma sessão, do mesmo cookie, para as duas telas. Duas cópias eram duas
 * verdades para um fato só — exatamente o que esta lib existe para evitar.
 */
export const memoriaDaSessao = {
  /** O que a ABA já sabe, ou `null` na primeira tela dela. */
  conhecida: (): Sessao | null => sessaoAtual,
  guardar(s: Sessao | null) { sessaoAtual = s; },
};

/**
 * A ÚLTIMA RESPOSTA DE UMA ROTA, para a volta pintar na hora.
 *
 * Só a memória das escolhas não resolve a queixa inteira: o filtro volta, mas a
 * tela fica em branco enquanto a rota responde. Aqui a tela repete a última
 * foto e busca a nova por baixo; quando ela chega, substitui. É a mesma régua
 * que as duas telas já praticam no Realtime — mostrar o que se sabe e corrigir
 * quando o servidor responde.
 *
 * ⚠️ NÃO vai para `sessionStorage`. O payload do board são ~2 MB, e serializar
 * isso a cada carregamento custaria mais do que a pintura economiza. Mora só em
 * memória, e portanto morre no F5 — que é o certo, porque F5 é justamente o
 * gesto de quem quer dado novo.
 */
export function fotoDeRota<T>(validoMs = 10 * 60_000) {
  let foto: { em: number; j: T } | null = null;
  return {
    guardar(j: T) { foto = { em: Date.now(), j }; },
    /** A foto, se ainda vale a pena mostrá-la; `null` se está velha ou não existe. */
    pegar(): T | null {
      if (!foto) return null;
      return Date.now() - foto.em < validoMs ? foto.j : null;
    },
  };
}
