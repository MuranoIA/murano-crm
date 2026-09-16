import { guardaAdmin } from "../../../../../lib/adminApi";
import { lerPlanilhaCodigos } from "../../../../../lib/planilhaCodigos";

export const dynamic = "force-dynamic";

// Só EXTRAI os códigos da planilha — não resolve cliente, não confere
// telefone, não aplica proteção nenhuma. Isso acontece depois, no MESMO
// caminho da lista digitada (POST /api/admin/disparo-massa com `codclis`):
// duas planilhas com os mesmos códigos e uma lista digitada com os mesmos
// códigos têm de terminar exatamente no mesmo público, sempre.
export async function POST(req: Request) {
  const g = guardaAdmin("subir planilha de público");
  if (g.erro) return g.erro;

  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: "envio inválido" }, { status: 400 }); }

  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File)) return Response.json({ error: "nenhum arquivo enviado" }, { status: 400 });

  const ext = arquivo.name.toLowerCase().split(".").pop();
  if (ext !== "xlsx" && ext !== "csv") {
    return Response.json({ error: "envie um arquivo .xlsx ou .csv" }, { status: 400 });
  }
  // 5 MB é generoso pra uma coluna de códigos — barra arquivo errado cedo,
  // não depois de gastar tempo tentando abrir.
  if (arquivo.size > 5 * 1024 * 1024) {
    return Response.json({ error: "arquivo maior que 5 MB — confira se é mesmo uma lista de códigos" }, { status: 400 });
  }

  try {
    const buffer = await arquivo.arrayBuffer();
    const leitura = await lerPlanilhaCodigos(buffer, arquivo.name);
    return Response.json(leitura);
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}
