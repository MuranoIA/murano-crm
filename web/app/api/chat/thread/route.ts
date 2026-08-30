import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { lerCrmConfig, filtroLinhas } from "../../../../lib/crmConfig";
import { canalDeResposta, linhaDaConversa } from "../../../../lib/whatsapp";

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

  // ---- histórico do RD, a um clique (0103) ---------------------------------
  // `?historico=1` traz TAMBÉM as mensagens das linhas que `linhas_visiveis`
  // esconde. Sem o parâmetro, a thread mostra só o número em uso e devolve
  // quantas ficaram de fora, para a tela oferecer o botão. É o mesmo gesto que
  // o RD Conversas faz — e evita carregar 23 mensagens por conversa que quase
  // nunca serão lidas.
  const querHistorico = new URL(req.url).searchParams.get("historico") === "1"
    && cfgThread.historico_rd;

  // ---- PAGINAÇÃO PARA TRÁS (item 4 da fila) -------------------------------
  // A thread trazia 200 mensagens e **parava sem avisar**: numa cliente de anos,
  // a conversa mais antiga simplesmente não existia para quem rolava. Agora a
  // tela pede `?antes=<criada_em>` e recebe o lote anterior.
  //
  // Cursor por DATA e não por offset: o offset se desloca quando chega mensagem
  // nova enquanto a pessoa rola, e o resultado é repetir ou pular uma bolha.
  const antes = new URL(req.url).searchParams.get("antes");
  const LOTE = 200;

  // `localizacao` (0115) entra aqui: sem ela a bolha nao tem como desenhar o
  // cartao de mapa, e a mensagem volta a ser so o texto do endereco.
  const COLS_MSG = "id,conteudo,enviada_por,tipo,status,criada_em,midia_tipo,midia_mime,midia_nome,midia_path,linha_id,reacao,resposta_a,erro,localizacao";

  // ---- CHEGADA INDIVIDUAL (`?desde=`) -------------------------------------
  //
  // O caminho de cima devolve a conversa INTEIRA: 200 mensagens, ~82 KB, mais
  // seis consultas de apoio (cliente, notas, transferencias, linhas, ligacoes,
  // janela de 24h). Isso e o certo ao ABRIR uma conversa, e o errado para
  // mostrar UMA mensagem que acabou de chegar -- e era o que o chat fazia a
  // cada aviso do Realtime. Numa rajada de dez mensagens em dez segundos, eram
  // dez recargas completas da thread empilhadas sobre dez recargas completas da
  // lista de conversas (a rota mais cara do chat, 1,3 a 2,2 s cada), e o
  // resultado era o que o usuario relatou: nada por ~10 s, e entao tudo junto.
  //
  // Aqui a pergunta e outra e cabe num indice: "o que existe depois desta
  // data?". Devolve uma linha, e a bolha aparece na hora.
  //
  // Cursor por DATA, e nao por quantidade, pelo mesmo motivo do `antes`: a
  // conversa cresce enquanto a resposta viaja, e um offset ja teria escorregado.
  const desde = new URL(req.url).searchParams.get("desde");
  if (desde) {
    let q = sb.from("mensagens").select(COLS_MSG)
      .eq("cliente_id", cliente_id).gt("criada_em", desde);
    if (!querHistorico) q = filtroLinhas(q, cfgThread);
    // teto generoso: se a pessoa ficou com a aba em segundo plano por muito
    // tempo, o poll de 60 s (que recarrega tudo) conserta o que passar daqui.
    let { data, error } = await q.order("criada_em", { ascending: true }).limit(100);
    if (error && /localizacao/i.test(error.message ?? "")) {
      let q2 = sb.from("mensagens").select(COLS_MSG.replace(",localizacao", ""))
        .eq("cliente_id", cliente_id).gt("criada_em", desde);
      if (!querHistorico) q2 = filtroLinhas(q2, cfgThread);
      const r2 = await q2.order("criada_em", { ascending: true }).limit(100);
      data = r2.data as any; error = r2.error as any;
    }
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const novas = (data ?? []).filter((m: any) => m.tipo !== "evento_sistema");

    // ---- os TIQUES das mensagens que ja estao na tela ---------------------
    //
    // O aviso do Realtime tambem dispara quando o `status` de uma mensagem
    // ANTIGA muda (wait -> success -> read): e o recibo da Meta chegando pelo
    // webhook. `?desde=` nunca alcancaria isso -- ela so olha para a frente --,
    // e sem este trecho o tique congelaria ate o poll de 60 s, num lugar onde a
    // equipe repara: "ela leu ou nao?".
    //
    // Sao 40 linhas de tres colunas, no mesmo indice da consulta acima. Alem
    // dai o recibo ja chegou ha muito tempo.
    const { data: est } = await sb.from("mensagens")
      .select("id,status,erro").eq("cliente_id", cliente_id)
      .order("criada_em", { ascending: false }).limit(40);
    // O nome do cliente so e buscado quando ha template no lote -- e o unico
    // uso dele aqui, e a esmagadora maioria dos lotes nao tem nenhum.
    if (novas.some((m: any) => /^\[template\]\s+\S+/.test(String(m.conteudo ?? "")))) {
      const { data: c } = await sb.from("clientes").select("nome_completo").eq("id", cliente_id).maybeSingle();
      await textoDoTemplate(sb, novas, c?.nome_completo);
    }
    return Response.json({ incremental: true, mensagens: novas, estados: est ?? [], atualizado_em: new Date().toISOString() });
  }

  let msgsQ = sb.from("mensagens").select(COLS_MSG).eq("cliente_id", cliente_id);
  if (antes) msgsQ = msgsQ.lt("criada_em", antes);
  if (!querHistorico) msgsQ = filtroLinhas(msgsQ, cfgThread);

  const [{ data: cli }, { data, error }, { data: notas }, { data: transferencias }, { data: linhas }, { data: ligacoes }] =
    await Promise.all([
    sb.from("clientes").select("id,nome_completo,telefone,carteira").eq("id", cliente_id).maybeSingle(),
    // pede UM a mais que o lote: é assim que se sabe que ainda há mais para
    // trás sem uma segunda consulta de contagem
    msgsQ.order("criada_em", { ascending: false }).limit(LOTE + 1),
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

  // ---- rede de protecao: a coluna `localizacao` nasce na 0115 --------------
  //
  // Sem isto, deploy antes da migration derruba a thread INTEIRA: o PostgREST
  // recusa a consulta por causa de UMA coluna e a rota devolve 500 para toda
  // conversa, de todo usuario -- o chat para de abrir. Medido em 27/08/2026,
  // com a 0115 ainda nao aplicada.
  //
  // O webhook (linha ~161) e o /api/chat/localizacao (linha ~131) ja fazem
  // exatamente esta segunda tentativa; aqui faltava. Perder o cartao de mapa e
  // aceitavel; perder a conversa nao e.
  let linhasMsg: any[] | null = data as any;
  let erroMsg: { message?: string } | null = error as any;
  if (erroMsg && /localizacao/i.test(erroMsg.message ?? "")) {
    let q2 = sb.from("mensagens")
      .select(COLS_MSG.replace(",localizacao", ""))
      .eq("cliente_id", cliente_id);
    if (antes) q2 = q2.lt("criada_em", antes);
    if (!querHistorico) q2 = filtroLinhas(q2, cfgThread);
    const r2 = await q2.order("criada_em", { ascending: false }).limit(LOTE + 1);
    linhasMsg = r2.data as any;
    erroMsg = r2.error as any;
    if (!erroMsg) console.warn("[chat/thread] coluna localizacao ausente (aplicar 0115) - thread sem o cartao de mapa");
  }
  if (erroMsg) return Response.json({ error: erroMsg.message }, { status: 500 });

  const bruto = linhasMsg ?? [];
  const temMais = bruto.length > LOTE;
  const mensagens = bruto
    .slice(0, LOTE)
    .filter((m: any) => m.tipo !== "evento_sistema")
    .reverse(); // cronológico (mais antiga em cima)

  // ---- template antigo: mostrar o TEXTO, não o identificador ---------------
  // Disparos anteriores gravaram "[template] promocao" no conteúdo — o vendedor
  // via o nome técnico e não o que a cliente leu. Os novos já gravam o texto
  // (send-template), mas o histórico não se reescreve sozinho: aqui a troca é
  // só de EXIBIÇÃO, buscando o corpo no cadastro pelo identificador.
  await textoDoTemplate(sb, mensagens, cli?.nome_completo);

  // por qual linha esta conversa corre: a da última mensagem que tem linha.
  // Sem linha = conversa do RD Conversas (o ETL não tem esse conceito).
  const rotulos = new Map((linhas ?? []).map((l: any) => [l.phone_number_id, l.rotulo]));
  const ultimaComLinha = [...mensagens].reverse().find((m: any) => m.linha_id);
  // ⚠️ TRÊS casos, não dois. O código antigo tinha só dois e por isso mentia:
  //
  //   tem mensagem com linha_id  -> aquela linha
  //   tem mensagem SEM linha_id  -> RD Conversas (o ETL não tem esse conceito)
  //   NÃO TEM MENSAGEM NENHUMA   -> linha nenhuma
  //
  // O terceiro caía no segundo, e um contato recém-criado — que nunca trocou
  // uma palavra com ninguém — aparecia no cabeçalho etiquetado
  // "MURANO PRO (RD CONVERSAS)". Além de falso, nomeia justamente o sistema que
  // o modo migração diz não existir (§44). Visto em produção em 27/08.
  const semConversa = mensagens.length === 0;
  const linha = ultimaComLinha
    ? { id: ultimaComLinha.linha_id, rotulo: rotulos.get(ultimaComLinha.linha_id) ?? "linha nova", canal: "whatsapp" }
    : semConversa
      // sem etiqueta: a tela não desenha o chip, em vez de chutar um número
      ? null
      // o número oficial também tem cadastro desde a 0089 (id sintético 'rd'), e o
      // rótulo vem de lá — assim o cabeçalho da conversa e o filtro da sidebar
      // chamam o mesmo número pelo mesmo nome
      : { id: "rd", rotulo: rotulos.get("rd") ?? "RD Conversas", canal: "rd" };

  // Por qual canal ESTA conversa vai sair — já com a escolha do admin aplicada
  // (0102). A tela precisa disto para calcular a janela de 24h da linha CERTA:
  // a janela é por número, então um cliente que respondeu há 10 min no RD NÃO
  // tem janela aberta na Cloud. Sem isso a tela liberaria o campo de texto e o
  // envio falharia com 131047, perdendo o que a pessoa escreveu.
  const canalEnvio = await canalDeResposta(sb, cliente_id).catch(() => "rd" as const);

  // ...e por qual NÚMERO. Com duas linhas Cloud vivas ao mesmo tempo, "cloud"
  // não é resposta suficiente: a janela é por par (número, cliente), então
  // contar sobre todas as linhas Cloud juntas volta a mentir — só que de um
  // jeito mais difícil de perceber, porque as duas são "cloud".
  const linhaEnvio = canalEnvio === "whatsapp"
    ? await linhaDaConversa(sb, cliente_id).catch(() => null)
    : null;

  // Quantas mensagens a seleção de linhas está escondendo. Duas contagens de
  // cabeçalho (o total menos o visível) em vez de negar o filtro: a negação de
  // `filtroLinhas` teria de ser escrita à mão e divergiria dele no primeiro
  // ajuste — e o sintoma seria um botão prometendo histórico que não existe.
  let historicoOculto = 0;
  if (cfgThread.historico_rd && !querHistorico) {
    const base = () => sb.from("mensagens").select("*", { count: "exact", head: true })
      .eq("cliente_id", cliente_id).neq("tipo", "evento_sistema");
    const [tudo, visivel] = await Promise.all([base(), filtroLinhas(base(), cfgThread)]);
    historicoOculto = Math.max(0, (tudo.count ?? 0) - (visivel.count ?? 0));
  }

  return Response.json({
    cliente: cli ? { id: cli.id, nome: cli.nome_completo, telefone: cli.telefone, carteira: cli.carteira } : null,
    canal_envio: canalEnvio,
    // por qual número esta conversa será respondida (null = RD, ou desconhecido)
    linha_envio: linhaEnvio,
    // quantas mensagens existem em linhas escondidas (0 = nada a oferecer)
    historico_oculto: historicoOculto,
    // veio COM o histórico? a tela usa para rotular as antigas e não reoferecer
    historico_carregado: querHistorico,
    // ainda há mensagens mais antigas que este lote? a tela usa para oferecer
    // "carregar anteriores" em vez de terminar em silêncio
    tem_mais: temMais,
    // este lote é uma continuação? nesse caso a tela NÃO recarrega notas,
    // transferências e ligações — elas já vieram inteiras no primeiro
    continuacao: !!antes,
    linha,
    mensagens,
    notas: notas ?? [],
    transferencias: transferencias ?? [],
    ligacoes: ligacoes ?? [],
    atualizado_em: new Date().toISOString(),
  });
}

/**
 * Troca "[template] nome_tecnico" pelo TEXTO que a cliente leu.
 *
 * Mora aqui, e nao em linha, porque os dois caminhos da rota precisam dela: a
 * thread inteira e o lote incremental. Um disparo pode chegar pelo `?desde=`
 * como qualquer outra mensagem, e se so o caminho de cima soubesse traduzir,
 * a bolha nasceria com o identificador tecnico e so viraria texto no proximo
 * recarregamento -- diferenca que ninguem associaria a esta funcao.
 */
async function textoDoTemplate(sb: any, mensagens: any[], nomeCompleto?: string | null) {
  const pendentes = mensagens
    .map((m: any) => /^\[template\]\s+(\S+)/.exec(String(m.conteudo ?? ""))?.[1])
    .filter(Boolean) as string[];
  if (!pendentes.length) return;
  const { data: tpls } = await sb
    .from("crm_templates")
    .select("meta_nome,corpo")
    .in("meta_nome", [...new Set(pendentes)]);
  const corpoDe = new Map((tpls ?? []).map((t: any) => [t.meta_nome, t.corpo]));
  const primeiroNome = String(nomeCompleto ?? "").trim().split(/\s+/)[0] || "cliente";
  for (const m of mensagens) {
    const nome = /^\[template\]\s+(\S+)/.exec(String(m.conteudo ?? ""))?.[1];
    const corpo = nome ? corpoDe.get(nome) : null;
    if (corpo) m.conteudo = String(corpo).replace(/\{\{\s*1\s*\}\}/g, primeiroNome);
  }
}
