// O esqueleto com o FORMATO REAL da tela (spec §2.1): com `loading.tsx` a página
// faz streaming — o primeiro byte leva isto, e o conteúdo entra depois no mesmo
// documento. Sem ele, o primeiro byte esperaria as consultas inteiras e a tela
// ficaria em branco nesse tempo.
//
// Acompanha o layout do Painel (demanda #92): barra de 56px, título grande, a
// linha de abas e o cartão da lista em duas colunas no computador. Se o
// Painel mudar de forma, este muda junto — senão a tela "pula" ao carregar.
export default function Carregando() {
  return (
    <div className="v2 min-h-dvh bg-v2-fundo" aria-busy="true" aria-label="carregando">
      <div className="bg-v2-vinho pt-[env(safe-area-inset-top)] shadow-e2">
        <div className="h-14" />
      </div>
      <main className="mx-auto w-full max-w-5xl px-4 pt-5 sm:px-6 sm:pt-8">
        <div className="esqueleto h-8 w-56 sm:h-9" />
        <div className="esqueleto mt-2 h-4 w-full max-w-xl" />

        <div className="mt-5 flex gap-2">
          <div className="esqueleto h-10 w-52" />
          <div className="esqueleto h-10 w-32" />
        </div>

        <div className="mt-4 rounded-2xl bg-v2-superficie p-4 shadow-e1 ring-1 ring-v2-linha sm:p-5">
          <div className="esqueleto h-5 w-52" />
          <div className="esqueleto mt-2 h-3 w-full max-w-lg" />
          <div className="esqueleto mt-3 h-12 w-full max-w-2xl" />
          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            {[0, 1].map((g) => (
              <div key={g}>
                <div className="esqueleto h-3 w-32" />
                <div className="mt-3 space-y-1.5">
                  {[0, 1, 2, 3].map((j) => (
                    <div key={j} className="esqueleto h-12" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
