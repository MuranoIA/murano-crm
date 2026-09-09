import { sbAdmin, guardaAdmin, corpo } from "../../../../lib/adminApi";
import { lerConfigChamadas, definirConfigChamadas, linhaCalling } from "../../../../lib/whatsappCalling";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Interruptor de CHAMADA da linha, na conta da Meta.
//
// Por que precisa existir: calling NÃO vem ligado num número da Cloud API. Sem
// este passo, `/api/chat/ligacao` responde erro do Graph e ninguém entende por
// quê — o token está certo, o número está certo, e mesmo assim não liga. É o
// mesmo tipo de armadilha do webhook "validado mas não assinado" (§16.4).
//
// Escreve na conta da Meta, então:
//   · só admin (guardaAdmin);
//   · a linha é sempre `linhaCalling()` (0124) — a escolha do admin em
//     /admin → Linhas, com fallback pra env WHATSAPP_PHONE_NUMBER_ID. NUNCA
//     vem de parâmetro de request: só entre linhas já cadastradas em
//     `chat_linha`, nunca um phone_number_id arbitrário digitado na hora —
//     mesmo espírito de proteção da §20.3 original ("o número oficial de
//     produção não pode ser alcançado por engano"), por outro caminho.
//   · ⚠️ Não é a mesma escolha de `linhaPadrao()` (0123, mensagem). São
//     interruptores separados de propósito: calling tem pré-requisito PRÓPRIO
//     por número (pagamento, campo `calls` assinado, este mesmo interruptor)
//     que não deve mudar sozinho quando alguém troca só a linha de mensagem.
//
// O que esta rota NÃO resolve (não é código, é conta — ver §22):
//   · limite de mensagens da WABA >= 2.000/24h, exigência da Meta para calling;
//   · assinar o campo `calls` no webhook, que é toggle no painel.
// ---------------------------------------------------------------------------

export async function GET() {
  const g = guardaAdmin("ver a configuração de chamadas");
  if (g.erro) return g.erro;

  const linha = await linhaCalling(sbAdmin());
  if (!linha) return Response.json({ error: "WHATSAPP_PHONE_NUMBER_ID não configurado na Vercel" }, { status: 500 });

  try {
    return Response.json({ linha, calling: await lerConfigChamadas(linha) });
  } catch (e: any) {
    // erro do Graph aqui costuma ser o próprio diagnóstico (permissão do token,
    // linha fora da Cloud API) — devolve o texto em vez de engolir
    return Response.json({ linha, error: e?.message ?? String(e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const g = guardaAdmin("ligar ou desligar as chamadas");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b || typeof b.ligado !== "boolean") {
    return Response.json({ error: "informe { ligado: true | false }" }, { status: 400 });
  }

  const linha = await linhaCalling(sbAdmin());
  try {
    await definirConfigChamadas(b.ligado, linha);
    return Response.json({ ok: true, ligado: b.ligado, calling: await lerConfigChamadas(linha) });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}
