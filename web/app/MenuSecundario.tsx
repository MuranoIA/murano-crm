"use client";
import { useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// MENU SECUNDÁRIO — o "⋯" que recolhe as telas de apoio.
//
// Pedido do usuário (14/09/2026): enxugar a barra do topo. Quatro itens saíram
// do menu do funil (Relatórios, Visões da Carteira, Ranking, Tickets) e quatro
// do menu do chat (Relatórios, Visões, Catálogo, Tickets). Os repetidos entram
// UMA vez; os que só existem em uma das telas entram assim mesmo — então as
// duas telas passam a oferecer as seis.
//
// Isto mora num componente, e não copiado nas duas telas, pelo motivo de
// sempre neste projeto: duas listas de menu divergiriam no primeiro item novo,
// e a divergência apareceria como "no chat tem, no funil não" — exatamente o
// que este menu existe para acabar.
//
// ⚠️ O NOME NÃO É "itens em manutenção", e é de propósito.
//
// O usuário sugeriu esse rótulo. Ele descreve bem os links — que estão sendo
// revisados — mas descreveria MAL o que o board pendura aqui pelo `children`:
// as ações de admin do Ranking, entre elas "Rodar desfile", que dispara a tela
// de parabéns em TODAS as TVs neste instante. Dizer "em manutenção" sobre um
// botão que age na produção agora é o tipo de rótulo que faz alguém clicar
// achando que não acontece nada — ou não clicar achando que está quebrado.
//
// "Mais telas" é neutro e verdadeiro para os dois casos, e a dica explica o
// resto sem prometer nada errado.
// ---------------------------------------------------------------------------

/** As cores da tela que hospeda o menu. O funil usa `RD`, o chat usa `M`. */
export type CoresMenu = {
  texto: string;      // cor do rótulo na barra
  ink: string;        // cor do texto dentro do dropdown
  surface: string;    // fundo do dropdown
  border: string;
  sombra: string;
};

export const ITENS_SECUNDARIOS: {
  href: string; rotulo: string; externo?: boolean; dica?: string;
}[] = [
  { href: "/relatorios", rotulo: "📈 Relatórios" },
  { href: "/visoes", rotulo: "🔭 Visões" },
  // ⚠️ NÃO é a mesma coisa que "Visões" acima, apesar do nome quase igual
  // (§27.4): esta é o módulo "Gestão de Carteira" do murano-app, um app
  // externo, e aquela é a tela `/visoes` daqui. Foi o próprio usuário quem
  // notou que as duas precisavam entrar.
  { href: "https://app.muranoprofessional.com.br/gestao-carteira", externo: true,
    rotulo: "🗂️ Visões da Carteira",
    dica: "Segmentação da carteira do time IS — Top 30, recorrentes, consolidação e reativação (módulo do murano-app)" },
  { href: "/catalogos", rotulo: "📖 Catálogo" },
  { href: "/tickets", rotulo: "🎫 Tickets" },
];

export function MenuSecundario({ cores, children, aoNavegar }: {
  cores: CoresMenu;
  /** Itens extras da tela que hospeda — o funil passa o bloco do Ranking. */
  children?: React.ReactNode;
  /** Chamado ao escolher qualquer item (o menu ☰ do celular fecha por aqui). */
  aoNavegar?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const fechar = () => { setAberto(false); aoNavegar?.(); };

  const item = {
    display: "flex", alignItems: "center", gap: 8, width: "100%",
    textAlign: "left" as const, background: "transparent", border: "none",
    padding: "9px 12px", fontSize: 13, fontWeight: 600, color: cores.ink,
    cursor: "pointer", textDecoration: "none" as const, fontFamily: "inherit",
  };

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setAberto((v) => !v)}
        title="Mais telas — estas estão sendo revisadas, mas seguem disponíveis para explorar"
        aria-label="Mais telas"
        style={{
          // Quadrado pequeno, como o usuário pediu: não compete com os itens
          // principais, só indica que há mais coisa atrás.
          //
          // ⚠️ ALTURA: 24, e a história importa. Enquanto ele morava DENTRO do
          // <nav> do chat — uma faixa com `overflow: auto` cujos itens medem
          // 21px — qualquer coisa acima de 21 fazia a barra inteira ganhar
          // SETAS DE ROLAGEM nos dois eixos, e por isso ele era 20. Desde
          // 14/09/2026 ele fica FORA do nav, no fim da barra ao lado do nome,
          // onde os vizinhos são pílulas de ~26px. Se algum dia ele voltar para
          // dentro do nav, a trava dos 21px volta junto — e só a foto mostra,
          // porque `tsc` e `next build` não sabem a altura de nada.
          width: 24, height: 24, display: "inline-flex", alignItems: "center",
          justifyContent: "center", marginLeft: 6, flexShrink: 0,
          fontSize: 14, lineHeight: 1, fontWeight: 700, fontFamily: "inherit",
          color: cores.texto, background: aberto ? cores.border : "transparent",
          border: `1px solid ${cores.border}`, borderRadius: 6, cursor: "pointer",
          padding: 0,
        }}
      >
        ⋯
      </button>

      {aberto && (
        <>
          {/* a cortina fecha ao clicar fora — o mesmo gesto dos outros menus */}
          <div onClick={() => setAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 100 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 101,
            minWidth: 232, background: cores.surface, border: `1px solid ${cores.border}`,
            borderRadius: 10, boxShadow: cores.sombra, overflow: "hidden",
          }}>
            <div style={{
              padding: "8px 12px 5px", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5,
              textTransform: "uppercase", color: cores.texto, opacity: 0.75,
            }}>
              em revisão — disponíveis
            </div>
            {ITENS_SECUNDARIOS.map((i) => (
              i.externo ? (
                // `target="_top"` porque o CRM roda dentro do iframe do hub
                // (§17): sem isso o app externo abriria DENTRO do nosso quadro.
                <a key={i.href} href={i.href} target="_top" title={i.dica} onClick={fechar}
                   style={{ ...item, borderTop: `1px solid ${cores.border}` }}>
                  {i.rotulo}
                </a>
              ) : (
                <Link key={i.href} href={i.href} title={i.dica} onClick={fechar}
                      style={{ ...item, borderTop: `1px solid ${cores.border}` }}>
                  {i.rotulo}
                </Link>
              )
            ))}
            {children}
          </div>
        </>
      )}
    </div>
  );
}
