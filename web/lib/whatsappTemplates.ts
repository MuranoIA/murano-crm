// Criar e consultar templates do WhatsApp direto na Meta (migration 0090).
//
// Por que isto existe: a API do RD Conversas NÃO tem endpoint de template (404
// em nove variantes, §2 do CLAUDE.md) — lá o template só nasce pelo painel
// deles. Na Cloud API o cadastro é nosso, então dá para criar por aqui.
//
// A versão do Graph é a MESMA do envio (v22.0). Isto é de propósito: template
// criado numa versão e enviado em outra é a classe de bug que custa horas, e
// subir a versão do envio é decisão de risco próprio (§16.5 item 4).
const GRAPH = "v22.0";
const APP_ID = "2654151365016843";   // app Murano Pulse — dono da sessão de upload

/** Mesma sanitização do lib/whatsapp.ts: token colado com caractere invisível já custou horas. */
function token(): string {
  const t = (process.env.WHATSAPP_TOKEN ?? "").replace(/[^\x21-\x7E]/g, "");
  if (!t) throw new Error("WHATSAPP_TOKEN ausente");
  return t;
}

function waba(): string {
  const w = (process.env.WHATSAPP_WABA_ID ?? "").replace(/[^\x21-\x7E]/g, "");
  if (!w) throw new Error("WHATSAPP_WABA_ID ausente — sem ela não há onde criar o template");
  return w;
}

/**
 * Junta TODOS os textos que o Graph manda, filtrando vazios.
 *
 * Nunca usar `??` entre eles: a Meta manda `error_data.details` como string
 * VAZIA nos erros de template e de chamada, e string vazia vence o `??` —
 * foi assim que a explicação real de um erro sumiu da tela por horas (§22.6.1).
 */
function explicar(j: any, resp: Response): string {
  const e = j?.error ?? {};
  const partes = [e.error_user_title, e.error_user_msg, e.error_data?.details, e.message]
    .map((p: unknown) => String(p ?? "").trim())
    .filter(Boolean);
  const codigo = e.code ? `Graph ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""}` : `HTTP ${resp.status}`;
  return partes.length ? `${codigo}: ${[...new Set(partes)].join(" — ")}` : codigo;
}

async function graph(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new Error(explicar(j, r));
  return j;
}

/**
 * Sobe a imagem do cabeçalho e devolve o `header_handle` que a criação exige.
 *
 * São DUAS chamadas, não uma: a primeira abre a sessão de upload, a segunda
 * manda os bytes. A primeira é POST — com GET o Graph responde
 * "(#100) Tried accessing nonexisting field (uploads)", que parece falta de
 * permissão e não é. Verificado ao vivo em 18/08/2026.
 */
export async function subirImagemDeCabecalho(bytes: Uint8Array, mime: string, nomeArquivo: string): Promise<string> {
  const sessao = await graph(`https://graph.facebook.com/${GRAPH}/${APP_ID}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      file_name: nomeArquivo,
      file_length: String(bytes.byteLength),
      file_type: mime,
      access_token: token(),
    }),
  });
  const id = String(sessao?.id ?? "");
  if (!id) throw new Error("a Meta não devolveu sessão de upload");

  const envio = await graph(`https://graph.facebook.com/${GRAPH}/${id}`, {
    method: "POST",
    headers: {
      // aqui é OAuth no header, não access_token no corpo — o corpo são os bytes
      Authorization: `OAuth ${token()}`,
      file_offset: "0",
      "Content-Type": "application/octet-stream",
    },
    body: bytes as any,
  });
  const handle = String(envio?.h ?? "");
  if (!handle) throw new Error("a Meta não devolveu o identificador da imagem");
  return handle;
}

export type NovoTemplate = {
  metaNome: string;             // minúsculo com underline — identificador na Meta
  categoria: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  idioma: string;               // pt_BR
  corpo: string;
  qtdVariaveis: number;         // quantos {{n}} o corpo tem — o consultor preenche cada um no envio
  rodape?: string | null;
  cabecalhoTexto?: string | null;
  imagemHandle?: string | null; // vindo de subirImagemDeCabecalho
};

// Valores de exemplo mandados à Meta na hora de aprovar, um por variável. O
// primeiro é um nome porque {{1}} chega pré-preenchido com o da cliente no
// compositor do chat — é o uso mais comum, não uma regra.
const EXEMPLOS = ["Maria", "chegou a reposição do reparador", "a tabela nova", "esta semana"];

/** Monta os componentes no formato da Meta. Separado para poder ser lido e conferido. */
export function componentesDe(t: NovoTemplate): unknown[] {
  const comps: any[] = [];

  if (t.imagemHandle) {
    comps.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [t.imagemHandle] } });
  } else if (t.cabecalhoTexto) {
    comps.push({ type: "HEADER", format: "TEXT", text: t.cabecalhoTexto });
  }

  // A Meta EXIGE um exemplo para CADA variável — um `example.body_text` com uma
  // lista de tamanho igual ao número de `{{n}}`. Sem isso, ou com a contagem
  // errada, a criação é recusada com uma mensagem que não diz isso claramente.
  // O exemplo é só o que o revisor da Meta lê; o valor real é digitado na hora
  // do envio, e por isso ele precisa ser plausível, não bonito.
  comps.push({
    type: "BODY",
    text: t.corpo,
    ...(t.qtdVariaveis > 0
      ? { example: { body_text: [Array.from({ length: t.qtdVariaveis }, (_, i) => EXEMPLOS[i] ?? "exemplo")] } }
      : {}),
  });

  if (t.rodape) comps.push({ type: "FOOTER", text: t.rodape });
  return comps;
}

export async function criarTemplate(t: NovoTemplate): Promise<{ id: string; status: string }> {
  const j = await graph(`https://graph.facebook.com/${GRAPH}/${waba()}/message_templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({
      name: t.metaNome,
      language: t.idioma,
      category: t.categoria,
      components: componentesDe(t),
    }),
  });
  return { id: String(j?.id ?? ""), status: String(j?.status ?? "PENDING") };
}

/** Status atual de cada template da conta, por nome. Usado para atualizar o que temos gravado. */
export async function statusNaMeta(): Promise<Map<string, { id: string; status: string; motivo: string | null }>> {
  const j = await graph(
    `https://graph.facebook.com/${GRAPH}/${waba()}/message_templates` +
    `?fields=name,status,id,rejected_reason&limit=200&access_token=${encodeURIComponent(token())}`,
  );
  const m = new Map<string, { id: string; status: string; motivo: string | null }>();
  for (const t of j?.data ?? []) {
    const motivo = String((t as any).rejected_reason ?? "").trim();
    m.set(String((t as any).name), {
      id: String((t as any).id ?? ""),
      status: String((t as any).status ?? ""),
      // a Meta manda "NONE" quando não houve recusa — guardar isso vira ruído na tela
      motivo: motivo && motivo.toUpperCase() !== "NONE" ? motivo : null,
    });
  }
  return m;
}

export async function apagarNaMeta(metaNome: string): Promise<void> {
  await graph(
    `https://graph.facebook.com/${GRAPH}/${waba()}/message_templates` +
    `?name=${encodeURIComponent(metaNome)}&access_token=${encodeURIComponent(token())}`,
    { method: "DELETE" },
  );
}

/**
 * Nome que a Meta aceita: minúsculo, dígitos e underline, até 512 caracteres.
 * Feito a partir do nome humano para ninguém precisar pensar em dois nomes.
 */
export function metaNomeDe(nomeHumano: string): string {
  return nomeHumano
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "template";
}
