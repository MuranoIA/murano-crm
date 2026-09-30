// Estado vazio no padrão do Café Code (demanda #92): caixa tracejada com o texto
// centralizado — "não há nada" precisa parecer de propósito, não tela quebrada.
export function Vazio({ texto }: { texto: string }) {
  return (
    <p className="mt-4 rounded-2xl border border-dashed border-v2-linha-forte px-4 py-8 text-center text-[13px] leading-5 text-v2-tinta-fraca">
      {texto}
    </p>
  );
}
