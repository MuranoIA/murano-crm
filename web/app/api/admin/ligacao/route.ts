import { guardaAdmin, corpo } from "../../../../lib/adminApi";
import { lerConfigChamadas, definirConfigChamadas } from "../../../../lib/whatsappCalling";
import { linhaDeEnvio } from "../../../../lib/whatsapp";

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
//   · age SOMENTE sobre WHATSAPP_PHONE_NUMBER_ID, a linha que já é a de envio.
//     A linha nunca vem por parâmetro — é o mesmo recorte da §20.3, e o motivo é
//     o mesmo: o número oficial de produção não pode ser alcançado por uma rota
//     nossa nem por engano.
//   · ⚠️ Usa `linhaDeEnvio()` (a env), não `linhaPadrao()` (0123, a escolha do
//     admin em Linhas). De propósito: calling tem pré-requisito PRÓPRIO por
//     número (pagamento, campo `calls` assinado, este mesmo interruptor) que
//     não deve mudar sozinho quando alguém troca só a linha padrão de mensagem
//     — isso ligaria/desligaria calling numa linha diferente da que a pessoa
//     pensa que está mexendo.
//
// O que esta rota NÃO resolve (não é código, é conta — ver §22):
//   · limite de mensagens da WABA >= 2.000/24h, exigência da Meta para calling;
//   · assinar o campo `calls` no webhook, que é toggle no painel.
// ---------------------------------------------------------------------------

export async function GET() {
  const g = guardaAdmin("ver a configuração de chamadas");
  if (g.erro) return g.erro;

  const linha = linhaDeEnvio();
  if (!linha) return Response.json({ error: "WHATSAPP_PHONE_NUMBER_ID não configurado na Vercel" }, { status: 500 });

  try {
    return Response.json({ linha, calling: await lerConfigChamadas() });
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

  try {
    await definirConfigChamadas(b.ligado);
    return Response.json({ ok: true, ligado: b.ligado, calling: await lerConfigChamadas() });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}
