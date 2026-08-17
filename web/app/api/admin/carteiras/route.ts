import { sbAdmin, guardaAdmin, corpo, texto, slugificar } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

// Vendedores e carteiras (`carteira_config`) — a fonte única que o ETL carrega
// no início e que as rotas de envio consultam para achar o employee_id do RD.
//
// O CLAUDE.md §14.1 comemora "adicionar vendedor = 1 linha no banco, sem
// deploy". Verdade, e ótimo para o código — mas essa linha só podia ser
// escrita no SQL Editor. Esta rota é o outro lado dessa decisão.
//
// SEM EXCLUSÃO: o slug é chave em `clientes.carteira`, `mensagens.
// vendedor_carteira`, `acesso.carteira` e nas views. Apagar a linha deixaria
// esses registros apontando para o nada. Desativar tira o vendedor da operação
// e preserva o histórico.

const COLS = "slug,rca_num,employee_id,cor,ativo,time,criado_em";
const TIMES = ["IS", "GC", "ISR"];

export async function GET() {
  const g = guardaAdmin("ver as carteiras");
  if (g.erro) return g.erro;

  const db = sbAdmin();
  const { data, error } = await db.from("carteira_config").select(COLS).order("ativo", { ascending: false }).order("slug");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // quantos contatos cada carteira tem hoje — o número que diz se desativar
  // alguém vai deixar clientes órfãos de dono
  const { data: clientes } = await db.from("clientes").select("carteira").not("carteira", "is", null).limit(20000);
  const contagem: Record<string, number> = {};
  for (const c of clientes ?? []) contagem[(c as any).carteira] = (contagem[(c as any).carteira] ?? 0) + 1;

  return Response.json({ carteiras: (data ?? []).map((c: any) => ({ ...c, clientes: contagem[c.slug] ?? 0 })) });
}

function validar(b: any): string | null {
  const time = texto(b.time);
  if (time && !TIMES.includes(time)) return `time precisa ser ${TIMES.join(", ")} ou vazio`;
  if (b.rca_num !== undefined && b.rca_num !== null && b.rca_num !== "") {
    const n = Number(b.rca_num);
    if (!Number.isInteger(n) || n <= 0) return "RCA precisa ser um número inteiro positivo";
  }
  const cor = texto(b.cor);
  if (cor && !/^#[0-9a-fA-F]{6}$/.test(cor)) return "cor precisa estar no formato #rrggbb";
  return null;
}

const numero = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

export async function POST(req: Request) {
  const g = guardaAdmin("cadastrar carteira");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  const slug = slugificar(b.slug);
  if (!slug) return Response.json({ error: "apelido inválido — use letras e números, sem espaço" }, { status: 400 });
  const problema = validar(b);
  if (problema) return Response.json({ error: problema }, { status: 400 });

  const db = sbAdmin();
  const { data: jaTem } = await db.from("carteira_config").select("slug").eq("slug", slug).maybeSingle();
  if (jaTem) return Response.json({ error: `a carteira "${slug}" já existe` }, { status: 409 });

  const { data, error } = await db.from("carteira_config").insert({
    slug,
    rca_num: numero(b.rca_num),
    employee_id: texto(b.employee_id) || null,
    cor: texto(b.cor) || null,
    time: texto(b.time) || null,
    ativo: true,
  }).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Aviso, não erro: as views vw_fila_prospeccao e vw_divergencia_carteira
  // trazem a lista de RCAs EMBUTIDA no SQL (§10.9). Carteira nova de IS ou GC
  // não aparece nelas até alguém editar as views por migration — e isso não dá
  // para fazer a partir daqui. Melhor dizer na hora do que deixar o admin
  // achar que terminou.
  const aviso = data?.time && data.time !== "ISR"
    ? `Carteira criada. Atenção: a fila de prospecção e o relatório de divergências têm a lista de RCAs escrita dentro das views — o RCA ${data.rca_num ?? "novo"} só entra nelas por migration.`
    : null;
  return Response.json({ ok: true, carteira: data, aviso });
}

export async function PATCH(req: Request) {
  const g = guardaAdmin("alterar carteira");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });
  const slug = texto(b.slug);
  if (!slug) return Response.json({ error: "apelido ausente" }, { status: 400 });
  const problema = validar(b);
  if (problema) return Response.json({ error: problema }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (b.rca_num !== undefined) patch.rca_num = numero(b.rca_num);
  if (b.employee_id !== undefined) patch.employee_id = texto(b.employee_id) || null;
  if (b.cor !== undefined) patch.cor = texto(b.cor) || null;
  if (b.time !== undefined) patch.time = texto(b.time) || null;
  if (typeof b.ativo === "boolean") patch.ativo = b.ativo;
  if (!Object.keys(patch).length) return Response.json({ error: "nada pra atualizar" }, { status: 400 });

  const db = sbAdmin();

  // Desativar a carteira sem tirar o acesso da pessoa deixaria um vendedor
  // logando num escopo que a operação considera encerrado: ele continua vendo
  // a carteira, mas ela sumiu das listas de destino de transferência e do
  // cadastro de novos acessos. Bloquear é mais claro do que consertar depois.
  if (patch.ativo === false) {
    const { data: comAcesso } = await db.from("acesso").select("email").eq("carteira", slug).eq("ativo", true);
    if (comAcesso?.length) {
      return Response.json({
        error: `${comAcesso.length} acesso(s) ainda usam esta carteira — desative em Usuários primeiro`,
      }, { status: 409 });
    }
  }

  const { data, error } = await db.from("carteira_config").update(patch).eq("slug", slug).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, carteira: data });
}
