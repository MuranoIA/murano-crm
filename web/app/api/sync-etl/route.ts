import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Repo/workflow do ETL (mesmo padrão de ids hardcoded do OPERADORES em send-template).
// O repo foi transferido do GitHub pessoal para a org da empresa e renomeado
// (romuloallbuquerque-netizen/rd-conversas-etl -> MuranoIA/murano-crm). A API do
// GitHub redireciona o nome antigo, mas o redirect não é garantia: nome fixo aqui
// é o atual. Espelho deste valor vive em wth_config.gh_etl_repo (pg_cron).
const REPO = "MuranoIA/murano-crm";
const WORKFLOW = "etl.yml";
const WORKFLOWS = ["etl.yml", "etl-fast.yml"]; // os dois concorrem pela cota do RD
const REF = "master";

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

function requireAdmin(): Response | null {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (sessao !== "admin") return Response.json({ error: "apenas admin pode sincronizar" }, { status: 403 });
  return null;
}

// Status do run mais recente do workflow — usado para desabilitar o botão enquanto já roda
// (o workflow tem concurrency group "etl", então disparar em cima de um run ativo só entra
// na fila; melhor já avisar na UI em vez de deixar clicar à toa).
export async function GET() {
  const negado = requireAdmin();
  if (negado) return negado;

  const token = process.env.GITHUB_ETL_TOKEN;
  if (!token) return Response.json({ error: "Config ausente na Vercel: GITHUB_ETL_TOKEN" }, { status: 500 });

  // runs do incremental + estado (ativo/pausado) do workflow
  const [rRuns, rWf] = await Promise.all([
    fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`, { headers: GH_HEADERS(token), cache: "no-store" }),
    fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`, { headers: GH_HEADERS(token), cache: "no-store" }),
  ]);
  const body: any = await rRuns.json().catch(() => ({}));
  if (!rRuns.ok) return Response.json({ error: body?.message || `GitHub ${rRuns.status}` }, { status: 502 });
  const wf: any = await rWf.json().catch(() => ({}));
  const paused = wf?.state === "disabled_manually"; // pausado = workflow desabilitado

  const run = body?.workflow_runs?.[0];
  if (!run) return Response.json({ running: false, paused, lastRun: null });

  return Response.json({
    running: run.status === "in_progress" || run.status === "queued",
    paused,
    lastRun: {
      status: run.status, conclusion: run.conclusion, event: run.event,
      createdAt: run.created_at, updatedAt: run.updated_at,
    },
  });
}

export async function POST(req: Request) {
  const negado = requireAdmin();
  if (negado) return negado;

  const token = process.env.GITHUB_ETL_TOKEN;
  if (!token) return Response.json({ error: "Config ausente na Vercel: GITHUB_ETL_TOKEN" }, { status: 500 });

  const acao = await req.json().then((b: any) => b?.acao).catch(() => undefined);

  // PAUSAR: desabilita os DOIS workflows (incremental + fast) e cancela o que está rodando.
  // Libera 100% da cota do RD pras ações do usuário (envio de template etc.).
  if (acao === "pausar") {
    for (const wf of WORKFLOWS) {
      await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/disable`, { method: "PUT", headers: GH_HEADERS(token) });
      const rr = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/runs?status=in_progress&per_page=15`, { headers: GH_HEADERS(token), cache: "no-store" });
      const jj: any = await rr.json().catch(() => ({}));
      for (const run of jj?.workflow_runs ?? []) {
        await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${run.id}/cancel`, { method: "POST", headers: GH_HEADERS(token) });
      }
    }
    return Response.json({ ok: true, paused: true });
  }

  // RETOMAR: reabilita os dois workflows (os crons voltam a rodar).
  if (acao === "retomar") {
    for (const wf of WORKFLOWS) {
      await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/enable`, { method: "PUT", headers: GH_HEADERS(token) });
    }
    return Response.json({ ok: true, paused: false });
  }

  // padrão: dispara um incremental agora (garante que não está pausado antes)
  await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/enable`, { method: "PUT", headers: GH_HEADERS(token) }).catch(() => {});
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: { ...GH_HEADERS(token), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: REF, inputs: { mode: "incremental" } }),
    }
  );
  if (r.status !== 204) {
    const body: any = await r.json().catch(() => ({}));
    return Response.json({ error: body?.message || `GitHub ${r.status}` }, { status: 502 });
  }
  return Response.json({ ok: true });
}
