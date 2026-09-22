// O esqueleto tem o FORMATO da tela real: barra, lista à esquerda, conversa no
// centro. É o que faz a espera parecer curta — a pessoa já sabe onde as coisas
// vão estar quando chegarem. Um spinner giraria no meio de lugar nenhum.
//
// Ele aparece enquanto o servidor busca a primeira página da lista. Na fase 0,
// o chat antigo mostrava tela pintada e VAZIA por 7 segundos.
export default function Carregando() {
  return (
    <div className="v2 flex h-dvh flex-col overflow-hidden">
      <div className="h-12 shrink-0 bg-v2-vinho pt-[env(safe-area-inset-top)]" />
      <div className="flex min-h-0 flex-1">
        <div className="w-full shrink-0 border-r border-v2-linha bg-v2-superficie p-3 md:w-[320px] lg:w-[344px]">
          <div className="esqueleto h-11 w-full rounded-xl" />
          <div className="mt-3 flex gap-1.5">
            {[64, 82, 74].map((w, i) => (
              <div key={i} className="esqueleto h-8 rounded-full" style={{ width: w }} />
            ))}
          </div>
          <div className="mt-4 space-y-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="esqueleto size-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="esqueleto h-3.5 w-1/2" />
                  <div className="esqueleto mt-2 h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 md:block" />
      </div>
    </div>
  );
}
