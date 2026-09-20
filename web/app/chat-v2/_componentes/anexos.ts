"use client";

import { recadoDeLimite, limiteDe } from "../../../lib/midia";

// ---------------------------------------------------------------------------
// Enviar arquivo: três passos, e nenhum deles passa o arquivo pelo nosso
// servidor.
//
//   1. `enviar-midia/assinar` confere sessão, tamanho e limite e devolve um
//      endereço no Storage — todas as recusas caras acontecem aqui, ANTES de um
//      byte subir;
//   2. o navegador sobe direto no Supabase Storage;
//   3. `enviar-midia` recebe só o caminho, baixa e repassa para a Meta.
//
// ⚠️ O passo 2 NÃO pode passar pela nossa rota: a Vercel corta o corpo de
// qualquer requisição em 4,5 MB antes de a função rodar (medido em produção,
// 29/08/2026) — era isso que fazia PDF pequeno passar e PDF grande falhar.
//
// ⚠️ XHR e não `fetch`, porque só ele dá `upload.onprogress`: num arquivo de
// dezenas de MB, tela parada é indistinguível de tela travada.
// ---------------------------------------------------------------------------

export type Progresso = { feito: number; total: number; pct: number | null; nome: string };

function subirParaStorage(file: Blob, path: string, token: string, aoAndar: (pct: number) => void) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return Promise.reject(new Error("Storage não configurado (NEXT_PUBLIC_SUPABASE_URL)"));
  const url = `${base}/storage/v1/object/upload/sign/wa-midia/${path}?token=${encodeURIComponent(token)}`;
  return new Promise<void>((ok, erro) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url, true);
    x.setRequestHeader("content-type", file.type || "application/octet-stream");
    x.setRequestHeader("x-upsert", "true");
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) aoAndar(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    x.onload = () =>
      x.status >= 200 && x.status < 300 ? ok() : erro(new Error(`falha ao subir o arquivo (${x.status})`));
    x.onerror = () => erro(new Error("conexão caiu durante o envio do arquivo"));
    x.onabort = () => erro(new Error("envio do arquivo cancelado"));
    x.send(file);
  });
}

export async function enviarArquivos(
  cliente_id: string,
  arquivos: File[],
  legenda: string,
  aoProgresso: (p: Progresso | null) => void,
): Promise<{ enviados: number; falhas: { nome: string; razao: string }[]; pararTudo: string | null }> {
  const falhas: { nome: string; razao: string }[] = [];
  let enviados = 0;

  for (let i = 0; i < arquivos.length; i++) {
    const file = arquivos[i];
    const mime = file.type || "application/octet-stream";
    aoProgresso({ feito: i, total: arquivos.length, pct: null, nome: file.name });

    // o limite é conferido AQUI também, e não só no servidor: recusar antes de
    // subir 40 MB é a diferença entre um aviso imediato e um minuto perdido
    if (file.size > limiteDe(mime)) {
      falhas.push({ nome: file.name, razao: recadoDeLimite(mime, file.size) });
      continue;
    }

    try {
      const ass = await fetch("/api/chat/enviar-midia/assinar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cliente_id, nome: file.name, mime, tamanho: file.size }),
      });
      const a = await ass.json().catch(() => null);
      if (!ass.ok) {
        // 501 vale para a conversa inteira (canal errado): insistir nos
        // seguintes só repete o mesmo erro
        if (ass.status === 501) return { enviados, falhas, pararTudo: a?.error ?? "canal não aceita mídia" };
        falhas.push({ nome: file.name, razao: a?.error ?? `erro ${ass.status}` });
        continue;
      }

      // barra só a partir de 2 MB: abaixo disso o número pisca e some antes de
      // alguém conseguir ler
      const mostraPct = file.size > 2 * 1024 * 1024;
      await subirParaStorage(file, a.path, a.token, (pct) => {
        if (mostraPct) aoProgresso({ feito: i, total: arquivos.length, pct, nome: file.name });
      });
      // 100% aqui seria mentira: o arquivo subiu para o NOSSO bucket, a cliente
      // ainda não recebeu nada
      aoProgresso({ feito: i, total: arquivos.length, pct: null, nome: file.name });

      const r = await fetch("/api/chat/enviar-midia", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cliente_id,
          path: a.path,
          mime: a.mime,
          nome: a.nome,
          ...(i === 0 && legenda ? { legenda } : null),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        if (j?.foraDaJanela || r.status === 501) {
          return {
            enviados,
            falhas,
            pararTudo: j?.foraDaJanela
              ? "Fora da janela de 24h — mande um template para reabrir a conversa."
              : (j?.error ?? `erro ${r.status}`),
          };
        }
        falhas.push({
          nome: file.name,
          razao:
            r.status === 504
              ? "o arquivo subiu, mas o envio demorou demais e foi cortado — tente de novo"
              : (j?.error ?? `erro ${r.status}`),
        });
        continue;
      }
      enviados++;
    } catch (e: any) {
      falhas.push({ nome: file.name, razao: String(e?.message ?? e) });
    }
  }

  aoProgresso(null);
  return { enviados, falhas, pararTudo: null };
}
