// ---------------------------------------------------------------------------
// O LAÇO DE ENVIO EM MASSA — roda no NAVEGADOR, e isso não é preguiça.
//
// Uma campanha de 800 clientes leva minutos de parede. Rota da Vercel tem
// teto de tempo; o laço morreria no meio, sem ninguém saber quantos saíram.
// Por isso ele vive na aba aberta, com progresso à vista — o mesmo desenho que
// a tela de Administração › Templates usa desde a §26.2.
//
// ⚠️ DUPLICAÇÃO CONSCIENTE, COM PRAZO. Existe um laço equivalente dentro de
// `app/admin/page.tsx`. Não o extraí de lá porque aquele arquivo passa de 4.500
// linhas e outras frentes mexem nele — e o dono já decidiu (29/09/2026) que a
// tela antiga sai quando ele mandar. Quando sair, este arquivo fica como o
// único, e nada mais precisa ser feito.
//
// O que NÃO está duplicado, e é o que importa: as REGRAS de quem recebe. Elas
// moram em `lib/publicoDisparo.ts` e `lib/publicoManual.ts`, e as duas telas
// chamam a mesma rota de prévia. Duas definições de "quem recebe" custariam
// dinheiro em cima de quem não devia receber.
// ---------------------------------------------------------------------------

export type AlvoEnvio = {
  envio_id: string;
  cliente: string;
  primeiro_nome: string;
};

export type FalhaEnvio = { cliente: string; erro: string };

export type Progresso = { feitos: number; ok: number; falhas: number; total: number };

/** Envios em paralelo. Seis: a pausa de 1,8 s que existia aqui era herança da
 *  cota do RD Conversas, compartilhada com o ETL (§14.5) — e os dois saíram na
 *  0131. Quem protege contra excesso agora é a retentativa abaixo, não um
 *  temporizador calibrado para um fornecedor que não existe mais. */
export const CONCORRENCIA = 6;

/** Códigos da Meta que significam "devagar", não "errado" — vale tentar de novo.
 *  O formato aqui é `Graph NNNNN` (lib/whatsapp.ts), não `Meta NNNNN`, que é o
 *  do webhook assíncrono. */
const RETRY_GRAPH = new Set(["130429", "131056", "80007", "131048"]);
const BACKOFF_MS = [1500, 3000, 6000];

async function enviarUm(
  alvo: AlvoEnvio,
  opts: { templateEnvioId?: string | null; variaveisExtras?: string[] },
): Promise<{ ok: boolean; erro?: string }> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      const r = await fetch("/api/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: alvo.envio_id,
          // separa o custo da Meta entre campanha e avulso — e é por `origem`
          // que a campanha acha depois quem recebeu o quê
          origem: "massa",
          ...(opts.templateEnvioId ? { template_id: opts.templateEnvioId } : {}),
          // só quando o template pede mais de um campo: com um campo só, o
          // servidor põe o primeiro nome sozinho, que é o de sempre
          ...(opts.variaveisExtras?.length
            ? { variaveis: [alvo.primeiro_nome, ...opts.variaveisExtras] }
            : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && !j.error) return { ok: true };
      const erro: string = j.error || `HTTP ${r.status}`;
      const cod = /\bGraph\s+(\d{2,6})\b/.exec(erro)?.[1];
      const valeTentar = (r.status === 429 || (cod && RETRY_GRAPH.has(cod))) && tentativa < BACKOFF_MS.length;
      if (valeTentar) { await new Promise((res) => setTimeout(res, BACKOFF_MS[tentativa])); continue; }
      return { ok: false, erro };
    } catch (e: any) {
      // ⚠️ SEM nova tentativa por erro de REDE, de propósito. Quando o `fetch`
      // estoura não dá para saber se a resposta se perdeu ANTES de o servidor
      // falar com a Meta ou DEPOIS — e depois significa que o template JÁ SAIU.
      // Tentar de novo mandaria em dobro: R$ 0,43 a mais e a cliente recebendo
      // duas vezes. As tentativas acima são seguras porque a Meta disse
      // "devagar" e a mensagem não saiu.
      return {
        ok: false,
        erro: `${e?.message || "erro de rede"} — a mensagem PODE ter saído: confira no chat antes de reenviar`,
      };
    }
  }
}

export async function enviarEmMassa(
  alvos: AlvoEnvio[],
  opts: {
    templateEnvioId?: string | null;
    variaveisExtras?: string[];
    aoProgresso?: (p: Progresso) => void;
    parar?: () => boolean;
  },
): Promise<{ ok: number; falhas: FalhaEnvio[]; enviados: number }> {
  const total = alvos.length;
  let proximo = 0, ok = 0, feitos = 0;
  const falhas: FalhaEnvio[] = [];
  opts.aoProgresso?.({ feitos: 0, ok: 0, falhas: 0, total });

  async function faixa() {
    while (proximo < total) {
      if (opts.parar?.()) return;
      const i = proximo++;
      const a = alvos[i];
      const r = await enviarUm(a, opts);
      feitos += 1;
      if (r.ok) ok += 1;
      else falhas.push({ cliente: a.cliente, erro: r.erro ?? "erro" });
      opts.aoProgresso?.({ feitos, ok, falhas: falhas.length, total });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, total) }, faixa));
  return { ok, falhas, enviados: feitos };
}
