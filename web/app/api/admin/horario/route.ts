import { sbAdmin, guardaAdmin, corpo, texto } from "../../../../lib/adminApi";
import { foraDoHorario } from "../../../../lib/foraDeHorario";

export const dynamic = "force-dynamic";

// Horário de atendimento e resposta automática fora dele
// (`chat_horario_atendimento`, linha única id=1, migration 0085).
//
// A funcionalidade existe desde 16/08 e NUNCA rodou: nasce desligada de
// propósito, porque manda mensagem para cliente real, e não havia como ligá-la
// sem SQL. Esta rota é o interruptor que faltava.
//
// A escrita é sempre um upsert em id=1: a tabela é de linha única, e um insert
// distraído criaria uma segunda configuração que o webhook nunca leria (ele
// filtra por id=1) — a pessoa mexeria numa tela que não afeta nada.

const COLS = "ativo,inicio,fim,dias_semana,mensagem,intervalo_horas,atualizado_em";

const PADRAO = {
  ativo: false,
  inicio: "08:00:00",
  fim: "18:00:00",
  dias_semana: [1, 2, 3, 4, 5],
  mensagem: "Olá! Recebemos sua mensagem 💜 Nosso atendimento é de segunda a sexta, das 8h às 18h. Assim que abrirmos, um consultor responde por aqui.",
  intervalo_horas: 12,
};

/** "8:00" ou "08:00" -> "08:00:00"; devolve null se não for hora válida. */
function hora(v: unknown): string | null {
  const m = texto(v).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}

export async function GET() {
  const g = guardaAdmin("ver o horário de atendimento");
  if (g.erro) return g.erro;

  const { data, error } = await sbAdmin().from("chat_horario_atendimento").select(COLS).eq("id", 1).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const cfg = data ?? PADRAO;
  return Response.json({
    horario: cfg,
    // a tela mostra "agora estamos fora do horário" usando exatamente a mesma
    // função que o webhook usa para decidir — se divergirem, é bug, não estilo
    foraAgora: foraDoHorario(cfg as any),
  });
}

export async function PUT(req: Request) {
  const g = guardaAdmin("alterar o horário de atendimento");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  const inicio = hora(b.inicio), fim = hora(b.fim);
  if (!inicio || !fim) return Response.json({ error: "horário inválido — use hh:mm" }, { status: 400 });
  if (inicio >= fim) return Response.json({ error: "o início precisa ser antes do fim" }, { status: 400 });

  const brutos: unknown[] = Array.isArray(b.dias_semana) ? b.dias_semana : [];
  const dias: number[] = [...new Set(brutos.map((d) => Number(d)))].sort((x, y) => x - y);
  if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return Response.json({ error: "dia da semana inválido" }, { status: 400 });
  }
  if (!dias.length) {
    // sem nenhum dia, TODA hora é fora do horário e a automação responderia
    // sempre — que não é o que quem desmarcou tudo quis dizer
    return Response.json({ error: "escolha ao menos um dia — para não responder nunca, desligue a automação" }, { status: 400 });
  }

  const mensagem = texto(b.mensagem);
  if (!mensagem) return Response.json({ error: "a mensagem não pode ficar vazia" }, { status: 400 });
  if (mensagem.length > 1000) return Response.json({ error: "mensagem longa demais (máx. 1000 caracteres)" }, { status: 400 });

  const intervalo = Number(b.intervalo_horas);
  if (!Number.isInteger(intervalo) || intervalo < 1 || intervalo > 168) {
    return Response.json({ error: "o intervalo precisa estar entre 1 e 168 horas" }, { status: 400 });
  }

  const { data, error } = await sbAdmin().from("chat_horario_atendimento").upsert({
    id: 1,
    ativo: b.ativo === true,
    inicio, fim,
    dias_semana: dias,
    mensagem,
    intervalo_horas: intervalo,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "id" }).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, horario: data, foraAgora: foraDoHorario(data as any) });
}
