import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";
import { situacaoDoTelefone, impedimentoDe } from "../../../../lib/contatoDoErp";
import { escopoCarteira } from "../../../../lib/verComo";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Minha carteira — a aba "Contatos" do chat.
//
// Pedido do usuário (25/08/2026): além das quatro filas, *"ter também toda
// minha carteira... como se fosse mesmo a função contatos do whatsapp"*.
//
// ---------------------------------------------------------------------------
// POR QUE ROTA PRÓPRIA, E NÃO MAIS UM RECORTE DE /api/chat
//
// As quatro filas existentes são recortes da lista que o chat JÁ tem em memória
// — custam zero. A carteira são até **961 registros por vendedor** que hoje não
// são buscados. Enfiá-los no carregamento inicial encareceria toda abertura do
// chat por causa de uma aba que quase nunca é a primeira. Aqui é buscada só
// quando alguém abre a aba, e uma vez por sessão.
//
// ---------------------------------------------------------------------------
// A IDENTIDADE, QUE É O PONTO DELICADO
//
// O board identifica o cliente de prospecção por `winthor:<codcli>` — id
// sintético, sem thread, que serve para desenhar um card e nada mais. O chat
// precisa do contato REAL para abrir conversa e enviar.
//
// A solução é não misturar as duas listas: **a carteira é chaveada por
// `codcli`**, a de conversas por `cliente_id`. O dropdown alterna entre elas, e
// como não há merge, não há como nascer card duplicado — que é o risco de
// forçar a mesma view a servir os dois usos.
//
// Cada linha carrega os dois identificadores, com `cliente_id` já resolvido:
//   1. `wth_vinculo` (casado por CPF) — 4.441 dos 4.691
//   2. senão, um `clientes` com o mesmo telefone (8 últimos dígitos, §16.3)
//   3. senão NULO — a linha aparece inerte, com o motivo. Some em silêncio
//      seria a doença que a tela de Pendências existe para curar (§36).
//
// ---------------------------------------------------------------------------
// O TERCEIRO CASO NÃO ERA UM CASO SÓ (09/09/2026)
//
// Relato do usuário: clientes da carteira apareciam com "sem contato" e não
// abriam. A suspeita levantada era outra tabela de telefone no ERP (contato de
// cobrança, de entrega). **Medido e descartado:** `psv_contato` e `wth_ciclo`
// repetem o mesmo número, e recuperam ZERO dos que estão sem; casar por nome
// também dá zero. O telefone que falta, falta mesmo.
//
// O que a medição achou foi outra coisa. Dos 118 inertes das 7 carteiras:
//
//   24  o telefone do ERP é PERFEITO (DDD + 9 dígitos) — só nunca ninguém criou
//       o contato. O provisionamento em massa de 37.4 rodou uma vez, em agosto;
//       quem entrou na carteira depois ficou de fora e ninguém percebeu.
//   31  telefone quebrado no cadastro (sem DDD, ou com um dígito a mais)
//   63  cadastro sem telefone nenhum
//
// Então a linha deixou de ter dois estados (abre / não abre) e passou a ter
// três, porque as ações são diferentes: o primeiro grupo abre no clique, e os
// outros dois pedem o número ao consultor — que é quem está com a cliente na
// frente — e mandam a correção para quem edita o WinThor.
// ---------------------------------------------------------------------------

const PAGE = 1000;

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  // vendedor vê a própria carteira; admin/home veem todas e usam os chips de
  // vendedor que a sidebar já tem
  const minha = escopoCarteira();

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: cfg } = await sb.from("carteira_config").select("slug,rca_num").eq("ativo", true);
  const rcas = (cfg ?? []).filter((c: any) => !minha || c.slug === minha).map((c: any) => c.rca_num);
  const slugPorRca = new Map((cfg ?? []).map((c: any) => [c.rca_num, c.slug]));
  if (!rcas.length) return Response.json({ carteira: [] });

  const clientes: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("wth_carteira")
      .select("codcli,nome,telefone,tel8,cidade,rca_num")
      .in("rca_num", rcas).eq("ativo", true)
      .order("nome").range(from, from + PAGE - 1);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    clientes.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  if (!clientes.length) return Response.json({ carteira: [] });

  // ---- resolve o contato: vínculo primeiro, telefone depois ----------------
  const codclis = clientes.map((c) => c.codcli);
  const porCodcli = new Map<number, string>();
  // Os lotes existem por causa do tamanho da URL (um `in.(...)` com 4 mil
  // codclis nao passa), NAO por causa do banco. Mas eles eram disparados EM
  // SERIE: para uma carteira de 685 clientes, 3 idas de ~260 ms cada.
  // Medido: 787 ms em serie contra 278 ms com os mesmos lotes em paralelo.
  const LOTE_VINC = 800;
  const pedacos: number[][] = [];
  for (let i = 0; i < codclis.length; i += LOTE_VINC) pedacos.push(codclis.slice(i, i + LOTE_VINC));
  const vincRes = await Promise.all(
    pedacos.map((p) => sb.from("wth_vinculo").select("codcli,cliente_id").in("codcli", p)),
  );
  for (const r of vincRes) {
    for (const v of (r as any).data ?? []) porCodcli.set(Number((v as any).codcli), (v as any).cliente_id);
  }

  // ---- os que sobraram: casa por telefone --------------------------------
  //
  // Isto varria a tabela `clientes` INTEIRA (5.040 linhas, 6 paginas
  // sequenciais, ~1.050 ms medidos) para montar um mapa por tel8 -- e usava
  // esse mapa para resolver, na pratica, entre 5 e 30 contatos:
  //
  //     romulo 5 · luana 30 · kamilly 22 · milene 14 · anne 8 · thiago 6 · thamires 13
  //
  // O comentario antigo dizia que 300 consultas `like` seriam mais caras que
  // ler a tabela toda. A premissa estava certa e a conclusao nao: nao sao 300
  // consultas, e UMA consulta com os poucos telefones que faltam. Medido: 182 ms.
  const faltam = clientes.filter((c) => !porCodcli.has(Number(c.codcli)) && c.tel8);
  const porTel8 = new Map<string, string>();
  if (faltam.length) {
    const alvos = [...new Set(faltam.map((c) => String(c.tel8)).filter((t) => t.length === 8))];
    // Teto defensivo: se um dia a maioria da carteira ficar sem vinculo, a
    // consulta dirigida deixa de ser dirigida (URL enorme) e a varredura volta
    // a ser o caminho barato. Hoje o maior caso e 30.
    const dirigida = alvos.length > 0 && alvos.length <= 400;
    if (dirigida) {
      for (let i = 0; i < alvos.length; i += 100) {
        const bloco = alvos.slice(i, i + 100);
        const { data } = await sb.from("clientes").select("id,telefone")
          // preferencia estavel: o menor id ganha, como na varredura antiga
          .order("id", { ascending: true })
          .or(bloco.map((t) => `telefone.like.*${t}`).join(","));
        for (const cl of data ?? []) {
          const t8 = String((cl as any).telefone ?? "").replace(/\D/g, "").slice(-8);
          if (t8.length === 8 && !porTel8.has(t8)) porTel8.set(t8, (cl as any).id);
        }
      }
    } else {
      for (let from = 0; ; from += PAGE) {
        const { data } = await sb.from("clientes").select("id,telefone")
          .order("id", { ascending: true })   // desempate: `range` sem `order` nao tem ordem prometida entre paginas
          .range(from, from + PAGE - 1);
        for (const cl of data ?? []) {
          const t8 = String((cl as any).telefone ?? "").replace(/\D/g, "").slice(-8);
          // preferencia estavel: o primeiro que aparecer fica; o telefone e a
          // chave fraca, e trocar de contato entre recargas confundiria mais
          if (t8.length === 8 && !porTel8.has(t8)) porTel8.set(t8, (cl as any).id);
        }
        if (!data || data.length < PAGE) break;
      }
    }
  }

  const carteira = clientes.map((c) => {
    const cliente_id = porCodcli.get(Number(c.codcli)) ?? (c.tel8 ? porTel8.get(c.tel8) ?? null : null);
    const sit = situacaoDoTelefone(c.telefone);
    return {
      codcli: c.codcli,
      cliente_id,
      cliente: c.nome,
      telefone: c.telefone ?? null,
      cidade: c.cidade ?? null,
      vendedor: slugPorRca.get(c.rca_num) ?? null,
      // sem contato ainda, mas o número do cadastro serve: o clique cria o
      // contato e abre a conversa (POST desta mesma aba, com o codcli)
      criar_no_clique: !cliente_id && sit.pode,
      // o CRM não consegue sozinho — precisa do número, que só quem está com a
      // cliente na frente tem. A linha continua clicável: ela abre o campo.
      precisa_telefone: !cliente_id && !sit.pode,
      impedimento: cliente_id ? null : impedimentoDe(sit),
    };
  });

  return Response.json({
    carteira,
    total: carteira.length,
    sem_contato: carteira.filter((c) => !c.cliente_id).length,
    // o que ainda depende de alguém digitar — é o número que vale acompanhar,
    // porque o outro grupo se resolve sozinho no primeiro clique
    sem_telefone: carteira.filter((c) => c.precisa_telefone).length,
  });
}
