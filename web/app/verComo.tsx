"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Aviso de que a tela está estreitada por um "ver como <vendedor>".
 *
 * O escopo mora num cookie e vale no SERVIDOR, em todas as telas (lib/verComo.ts).
 * Isso é o que torna a escolha útil — e também o que a torna perigosa: quem
 * esquecer que escolheu a Luana abre um relatório na segunda-feira vendo um
 * sétimo da operação e conclui que sumiu cliente. Este selo é o antídoto, e traz
 * a saída junto.
 *
 * NÃO aparece no board nem no /chat: as duas telas já mostram a escolha no
 * próprio seletor (chip aceso e botão do dropdown), e um selo flutuante ali
 * seria a mesma informação duas vezes, por cima do conteúdo, o dia inteiro.
 * Aparece em tudo o mais — relatórios, visões, indicadores —, onde ele é o
 * único sinal de que a tela não mostra a operação inteira.
 */
export default function VerComo() {
  const caminho = usePathname();
  const [carteira, setCarteira] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);

  // as telas que têm seletor próprio, e a lupa do board (um iframe nosso, dentro
  // do board — o selo apareceria duas vezes na mesma janela)
  const embutido = typeof window !== "undefined" && /[?&]embed=1(&|$)/.test(window.location.search);
  const temSeletor = caminho === "/" || caminho === "/chat";

  useEffect(() => {
    if (temSeletor || embutido) { setCarteira(null); return; }
    let vivo = true;
    fetch("/api/ver-como", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setCarteira(j?.carteira ?? null); })
      .catch(() => { /* sem o selo a tela segue funcionando, só sem o aviso */ });
    return () => { vivo = false; };
  }, [caminho, temSeletor, embutido]);

  if (!carteira) return null;

  const nome = carteira.charAt(0).toUpperCase() + carteira.slice(1);

  return (
    <div
      style={{
        position: "fixed", left: 12, bottom: `calc(12px + env(safe-area-inset-bottom, 0px))`,
        zIndex: 300, display: "flex", alignItems: "center", gap: 8,
        padding: "6px 10px", borderRadius: 999,
        background: "#621244", color: "#fff",
        boxShadow: "0 6px 20px rgba(28,14,27,.28)",
        fontSize: 12, fontWeight: 700, fontFamily: "inherit",
      }}
    >
      <span aria-hidden>👁️</span>
      <span>Vendo como {nome}</span>
      <button
        onClick={async () => {
          setSaindo(true);
          try {
            await fetch("/api/ver-como", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ carteira: null }),
            });
            // recarrega a tela inteira: o escopo é do servidor, e cada página
            // busca os próprios dados — pedir a cada uma que saiba desfazer
            // seria uma régua nova em cada tela, divergindo na primeira.
            window.location.reload();
          } catch {
            setSaindo(false);
          }
        }}
        disabled={saindo}
        style={{
          border: "1px solid rgba(255,255,255,.5)", background: "transparent", color: "#fff",
          borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 800,
          cursor: saindo ? "default" : "pointer", fontFamily: "inherit", opacity: saindo ? 0.6 : 1,
        }}
      >
        {saindo ? "saindo…" : "ver tudo"}
      </button>
    </div>
  );
}
