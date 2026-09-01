import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { papelDe, carteiraDe } from "../../../lib/papel";
import { verComo } from "../../../lib/verComo";

export const dynamic = "force-dynamic";

// Retorna a sessão atual a partir do cookie "crm_sessao" ("admin" | "home" | <slug>).
// Também devolve `papeis` (os papéis que o e-mail logado PODE assumir) p/ o seletor de
// papel no board — quem tem >1 papel (Romulo, Joas) pode trocar via /api/trocar-papel.
export async function GET() {
  const s = cookies().get("crm_sessao")?.value;
  if (!s) return Response.json({ error: "não autenticado" }, { status: 401 });
  const role = papelDe(s);
  const carteira = carteiraDe(s);

  // papéis disponíveis: precisa do e-mail (cookie setado no login Google). Sem e-mail
  // (login admin por senha/env), o único papel é o atual.
  const email = cookies().get("crm_email")?.value ?? null;
  let papeis: string[] = role ? [role] : [];
  if (email) {
    try {
      const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key) {
        const sb = createClient(url, key, { auth: { persistSession: false } });
        const { data } = await sb.from("acesso").select("papeis,papel,ativo").eq("email", email).maybeSingle();
        if (data && data.ativo !== false) {
          const ps: string[] = (data.papeis && data.papeis.length ? data.papeis : [data.papel]).filter(Boolean);
          if (ps.length) papeis = ps;
        }
      }
    } catch { /* mantém o fallback [role] */ }
  }

  // `ver_como`: a carteira que admin/home escolheu simular (null = todas). O
  // board e o chat leem daqui para nascer ja com a selecao certa depois de um
  // recarregamento -- sem isso a tela viria estreitada pelo servidor com o
  // seletor dizendo "Todos", que e o pior dos dois mundos.
  return Response.json({ role, carteira, papeis, email, ver_como: verComo() });
}
