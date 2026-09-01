import { cookies } from "next/headers";
import { carteiraDe, veTudo } from "./papel";

// ---------------------------------------------------------------------------
// "Ver como <vendedor>" — o escopo que admin/home escolhem para enxergar o
// sistema pelos olhos de UMA carteira.
//
// A escolha já existia em duas telas, SEPARADAS e só de tela: os chips do board
// (`app/page.tsx`) e o dropdown da sidebar do chat. Escolher no board não valia
// no chat, nenhuma das duas sobrevivia a um recarregamento, e nenhuma alcançava
// os indicadores, os relatórios ou as visões — que são escopados no SERVIDOR.
// Este cookie é a mesma escolha, feita uma vez e valendo em todas as telas.
//
// ---------------------------------------------------------------------------
// TRÊS REGRAS QUE NÃO PODEM SER AFROUXADAS
//
// 1. **Estreita, nunca alarga.** Só é lido quando a sessão já vê tudo
//    (admin/home). Um vendedor com o cookie na mão continua preso à própria
//    carteira — e é por isso que ele é `httpOnly`: quem grava é a rota
//    `/api/ver-como`, que confere o papel e confere o slug contra
//    `carteira_config`. Nada além dela escreve aqui.
//
// 2. **É escopo, não papel.** `podeAdmin` continua valendo: quem simula não
//    perde as telas de administração no meio do caminho, nem precisa sair da
//    simulação para sincronizar ou disparar. Por isso `/admin` fica de fora.
//
// 3. **NÃO troca a identidade de quem escreve.** `usuarioDaSessao()` (marca de
//    leitura, autoria de nota, de transferência e de encerramento) continua
//    sendo a pessoa de verdade. Se a simulação virasse identidade, o admin
//    abrindo uma conversa zeraria o "não lida" do vendedor — e ele perderia a
//    própria fila sem entender por quê.
//
// Pela mesma razão, as checagens de AUTORIZAÇÃO (transferir, vincular, salvar
// cadastro, ligar) seguem lendo `carteiraDe(sessao)` direto: quem simula não
// deve ser bloqueado pelo próprio filtro. É a régua da §31.2 — esconder não
// pode virar agir sem saber, e permissão se resolve contra o dado autoritativo.
// ---------------------------------------------------------------------------

export const COOKIE_VER_COMO = "crm_ver_como";

/** Slug que admin/home está simulando agora, ou null. Nunca vale para vendedor. */
export function verComo(): string | null {
  const c = cookies();
  if (!veTudo(c.get("crm_sessao")?.value)) return null;
  const v = c.get(COOKIE_VER_COMO)?.value?.trim();
  return v ? v : null;
}

/**
 * A carteira do escopo de LEITURA. É o que as rotas devem usar no lugar de
 * `carteiraDe(sessao)` para decidir o que aparece na tela.
 *
 * Dois degraus explícitos, não uma coalescência: para o vendedor vale sempre a
 * própria carteira, e o cookie nem é olhado.
 */
export function escopoCarteira(): string | null {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!veTudo(sessao)) return carteiraDe(sessao);
  return verComo();
}
