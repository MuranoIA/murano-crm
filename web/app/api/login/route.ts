export const dynamic = "force-dynamic";

// Login por usuário/senha DESATIVADO (31/07/2026): o acesso ao CRM é somente via
// "Entrar com Google" (Supabase Auth). Endpoint mantido apenas para responder de forma
// clara a chamadas antigas.
export async function POST() {
  return Response.json(
    { error: 'Login por senha desativado. Use "Entrar com Google".' },
    { status: 410 },
  );
}
