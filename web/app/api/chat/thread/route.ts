import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { lerCrmConfig, filtroLinhas } from "../../../../lib/crmConfig";

export const dynamic = "force-dynamic";

// Thread completa de uma conversa (tela de chat). Diferente do /api/mensagens do
// card ampliado, devolve id/status/tipo (pros ticks de entrega e selo de template)
// e um lote maior. Mesma decisão do /api/mensagens: NÃO escopa por carteira —
// mensagens guardam a carteira de QUANDO foram enviadas (RCA anterior), filtrar
// por ela cortaria o histórico de quem trocou de RCA.
export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const cliente_id = new URL(req.url).searchParams.get("cliente_id");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Interruptor das conversas do RD (0098). A lista já não oferece essas
  // conversas, mas um link antigo ou o botão voltar ainda chegam aqui — e a
  // thread é onde o conteúdo apareceria por inteiro.
  const cfgThread = await lerCrmConfig(sb);
  let msgsQ = sb.from("mensagens")
    .select("id,conteudo,enviada_por,tipo,status,criada_em,midia_tipo,midia_mime,midia_nome,midia_path,linha_id,reacao,resposta_a,erro")
    .eq("cliente_id", cliente_id);
  msgsQ = filtroLinhas(msgsQ, cfgThread);

  const [{ data: cli }, { data, error }, { data: notas }, { data: transferencias }, { data: linhas }, { data: ligacoes }] =
    await Promise.all([
    sb.from("clientes").select("id,nome_completo,telefone,carteira").eq("id", cliente_id).maybeSingle(),
    msgsQ.order("criada_em", { ascending: false }).limit(200),
    // notas internas (migration 0080) — vêm à parte e o front intercala pela data.
    // Todas, sem limite de janela: são poucas por conversa, e esconder uma nota
    // que caiu fora das 200 últimas mensagens seria perder um recado da equipe.
    sb.from("chat_nota")
      .select("id,autor,texto,criada_em")
      .eq("cliente_id", cliente_id)
      .order("criada_em", { ascending: true }),
    // histórico de transferências (0081) — o "registro" pedido no P1 aparece na
    // própria conversa, no ponto em que a passagem aconteceu
    sb.from("chat_transferencia")
      .select("id,de_carteira,para_carteira,por,observacao,criada_em")
      .eq("cliente_id", cliente_id)
      .order("criada_em", { ascending: true }),
    // catálogo das linhas (0080 multi-linha) — para rotular por qual número a
    // conversa corre
    sb.from("chat_linha").select("phone_number_id,rotulo,numero"),
    // ligações (0087) — nos dois canais. Aparecem como marco na thread, no ponto
    // em que aconteceram, como as transferências. Não vêm de `mensagens` de
    // propósito: ligação não é mensagem (ver cabeçalho da 0087).
    sb.from("chat_ligacao")
      .select("id,canal,direcao,status,por,carteira,iniciada_em,atendida_em,encerrada_em,duracao_seg,motivo,observacao,call_id")
      .eq("cliente_id", cliente_id)
      .order("iniciada_em", { ascending: true })
      .limit(200),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const mensagens = (data ?? [])
    .filter((m: any) => m.tipo !== "evento_sistema")
    .reverse(); // cronológico (mais antiga em cima)

  // ---- template antigo: mostrar o TEXTO, não o identificador ---------------
  // Disparos anteriores gravaram "[template] promocao" no conteúdo — o vendedor
  // via o nome técnico e não o que a cliente leu. Os novos já gravam o texto
  // (send-template), mas o histórico não se reescreve sozinho: aqui a troca é
  // só de EXIBIÇÃO, buscando o corpo no cadastro pelo identificador.
  const pendentes = mensagens
    .map((m: any) => /^\[template\]\s+(\S+)/.exec(String(m.conteudo ?? ""))?.[1])
    .filter(Boolean) as string[];
  if (pendentes.length) {
    const { data: tpls } = await sb
      .from("crm_templates")
      .select("meta_nome,corpo")
      .in("meta_nome", [...new Set(pendentes)]);
    const corpoDe = new Map((tpls ?? []).map((t: any) => [t.meta_nome, t.corpo]));
    const primeiroNome = String(cli?.nome_completo ?? "").trim().split(/\s+/)[0] || "cliente";
    for (const m of mensagens as any[]) {
      const nome = /^\[template\]\s+(\S+)/.exec(String(m.conteudo ?? ""))?.[1];
      const corpo = nome ? corpoDe.get(nome) : null;
      if (corpo) m.conteudo = String(corpo).replace(/\{\{\s*1\s*\}\}/g, primeiroNome);
    }
  }

  // por qual linha esta conversa corre: a da última mensagem que tem linha.
  // Sem linha = conversa do RD Conversas (o ETL não tem esse conceito).
  const rotulos = new Map((linhas ?? []).map((l: any) => [l.phone_number_id, l.rotulo]));
  const ultimaComLinha = [...mensagens].reverse().find((m: any) => m.linha_id);
  const linha = ultimaComLinha
    ? { id: ultimaComLinha.linha_id, rotulo: rotulos.get(ultimaComLinha.linha_id) ?? "linha nova", canal: "whatsapp" }
    // o número oficial também tem cadastro desde a 0089 (id sintético 'rd'), e o
    // rótulo vem de lá — assim o cabeçalho da conversa e o filtro da sidebar
    // chamam o mesmo número pelo mesmo nome
    : { id: "rd", rotulo: rotulos.get("rd") ?? "RD Conversas", canal: "rd" };

  return Response.json({
    cliente: cli ? { id: cli.id, nome: cli.nome_completo, telefone: cli.telefone, carteira: cli.carteira } : null,
    linha,
    mensagens,
    notas: notas ?? [],
    transferencias: transferencias ?? [],
    ligacoes: ligacoes ?? [],
    atualizado_em: new Date().toISOString(),
  });
}
