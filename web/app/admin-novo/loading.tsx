// O esqueleto com o FORMATO REAL das duas seções (spec §2.1): com `loading.tsx`
// a página faz streaming — o primeiro byte leva isto, e o conteúdo entra depois
// no mesmo documento. Sem ele, o primeiro byte esperaria as consultas inteiras
// e a tela ficaria em branco nesse tempo.
export default function Carregando() {
  return (
    <div className="v2 min-h-dvh bg-v2-fundo">
      <div className="h-[46px] bg-v2-vinho" />
      <main className="mx-auto max-w-3xl px-4 py-5">
        {[0, 1].map((i) => (
          <div key={i} className="mb-4 rounded-2xl bg-v2-superficie p-4 shadow-e1 ring-1 ring-v2-linha">
            <div className="h-4 w-48 rounded bg-v2-superficie-2" />
            <div className="mt-2 h-3 w-full rounded bg-v2-superficie-2" />
            <div className="mt-4 space-y-1">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="h-10 rounded-xl bg-v2-superficie-2" />
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
