import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function POST() {
  cookies().delete("crm_sessao");
  return Response.json({ ok: true });
}
