import { sbAdmin, guardaAdmin } from "../../../../../lib/adminApi";
import { buscarClientesPorNome, buscarClientePorCodigo } from "../../../../../lib/publicoManual";

export const dynamic = "force-dynamic";

// Resolve UMA entrada da lista digitada — antes de ela virar uma linha na
// tabela visual. `?nome=` devolve sugestões reais do WinThor (autocomplete,
// nunca texto livre); `?codcli=` confere um código na hora, para o "+" da
// digitação por código dizer NA HORA se aquele número existe, em vez de só na
// prévia.
export async function GET(req: Request) {
  const g = guardaAdmin("buscar cliente para o disparo em massa");
  if (g.erro) return g.erro;

  const url = new URL(req.url);
  const nome = url.searchParams.get("nome");
  const codcliRaw = url.searchParams.get("codcli");

  try {
    if (codcliRaw != null) {
      const codcli = Number(codcliRaw);
      if (!Number.isFinite(codcli) || codcli <= 0) {
        return Response.json({ error: "código inválido" }, { status: 400 });
      }
      const item = await buscarClientePorCodigo(sbAdmin(), codcli);
      return Response.json({ item });
    }
    if (nome != null) {
      const itens = await buscarClientesPorNome(sbAdmin(), nome);
      return Response.json({ itens });
    }
    return Response.json({ error: "informe ?nome= ou ?codcli=" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
