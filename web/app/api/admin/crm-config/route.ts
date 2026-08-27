import { sbAdmin, guardaAdmin, corpo } from "../../../../lib/adminApi";
import { lerCrmConfig, CRM_CONFIG_PADRAO, linhasVisiveis, tudoVisivel, modoMigracao, POSICAO_MIGRACAO } from "../../../../lib/crmConfig";
import { lerCampos, type CampoCadastro } from "../../../../lib/cadastroCampos";
import { lerLocais, type Local } from "../../../../lib/locais";

export const dynamic = "force-dynamic";

// Interruptores globais do CRM (`crm_config`, migration 0097). Hoje só o motor
// de ciclo de compra; os próximos mecanismos entram como coluna nova ali e como
// mais um item na lista `MECANISMOS` abaixo.
//
// A tela precisa de mais do que o booleano: precisa dizer O QUE cada chave
// desliga e o que ela NÃO desliga. Um interruptor de mecanismo sem essa lista é
// um botão que ninguém tem coragem de virar — e, virado, ninguém sabe explicar
// o que mudou na tela do vendedor no dia seguinte.

const MECANISMOS = [
  {
    chave: "ciclo_ativo",
    rotulo: "Motor de ciclo de compra",
    resumo:
      "Classificação preditiva de recompra: em que ponto do ciclo o cliente está, " +
      "quão urgente é falar com ele e qual ação sugerir.",
    desliga: [
      "Selo de situação no card do board (Na hora, Atrasado, Expansão, Recuperação, Reativação)",
      "Filtro “Ciclo compra” no cabeçalho do board, incluindo a prioridade “Urgentes (ligar hoje)”",
      "Aba Ciclo e a barra de % do ciclo no painel do contato, dentro do chat",
      "Peso da urgência no ranqueamento do disparo em massa",
      "Colunas de ciclo no Excel do relatório",
    ],
    mantem: [
      "Dias sem comprar, e o filtro “Tempo parado” do board",
      "Ticket médio, total de pedidos e última compra",
      "Valor faturado no mês e a coluna Pedido emitido",
    ],
    nota:
      "Nada é apagado. A tabela wth_ciclo continua sendo atualizada a cada 10 minutos " +
      "pelo sync do WinThor, então religar mostra o dado de agora, não um buraco.",
  },
  {
    chave: "historico_rd",
    rotulo: "Histórico do outro número na conversa",
    resumo:
      "Quando um cliente tem conversa num número que a seleção acima esconde, oferece " +
      "o botão “ver histórico anterior” dentro da thread — o mesmo gesto do RD Conversas.",
    desliga: [
      "O botão “ver histórico anterior” no chat e no card ampliado",
      "O acesso, pela tela, às mensagens do número escondido",
    ],
    mantem: [
      "As mensagens no banco — o ETL segue trazendo tudo",
      "A conversa do número em uso, que é o que a thread mostra por padrão",
      "A janela de 24h, que continua contando só o número de envio",
    ],
    nota:
      "Desligada, simula o cenário depois do corte: nenhum histórico do RD em lugar nenhum. " +
      "Medido em 25/08 com o RD escondido: 3.769 clientes da carteira têm histórico oculto, " +
      "88.523 mensagens ao todo — 2.553 deles conversaram nos últimos 30 dias.",
  },
  {
    chave: "carteira_rd_ativa",
    rotulo: "Carteira do RD como dono do cliente",
    resumo:
      "Hoje o dono de um cliente é o RCA do WinThor e, quando não há RCA, a tag “carteira " +
      "<nome>” do painel do RD. Desligar tira a segunda metade: só o RCA manda.",
    desliga: [
      "A tag de carteira do painel do RD como critério de dono, no board e no chat",
      "A presença, na carteira de um vendedor, de cliente que o WinThor não atribui a ele",
    ],
    mantem: [
      "O RCA do WinThor, que passa a ser o único critério — é o pedido",
      "Todos os clientes na tela: quem fica sem RCA vai para a fila de não atribuídos, de onde qualquer um pega",
      "A coluna `carteira_rd` no banco, intacta, para conferência",
    ],
    nota:
      "Medido em 26/08. Na carteira inteira: 4.420 clientes onde RCA e tag concordam (nada muda), " +
      "210 onde divergem (o RCA passa a mandar) e 335 que só têm a tag. Desses 335, 233 existem no " +
      "WinThor sob RCA de outro time — Francisco (2) 76, Jorge (53) 38, Maiara (9) 37, Henry (30) 29, " +
      "Administrativo Venus (11) 20 — ou seja, nunca foram do IS/ISR; para devolvê-los a um dono, " +
      "basta cadastrar aquele RCA em carteira_config. No board de hoje o efeito é menor: 78 cards " +
      "mudam de lugar, e NENHUM deles teve atividade nos últimos 30 dias.",
  },
]  as const;

// O seletor de linhas NÃO é um booleano, então não entra na lista acima: é uma
// escolha de conjunto. O texto mora aqui pelo mesmo motivo dos outros — a tela
// não deve inventar a explicação do que o admin está prestes a mudar.
const LINHAS_INFO = {
  rotulo: "Conversas visíveis, por número",
  resumo:
    "Quais números alimentam a classificação dos cards nas 5 colunas do board e a lista do " +
    "chat. Desmarcar um número não apaga nada: as conversas dele continuam no banco e o ETL " +
    "continua trazendo as novas.",
  desliga: [
    "Conversas do número desmarcado na lista do chat, na busca e na thread",
    "Última mensagem, prévia e tempo parado nos cards vindos dele",
    "Os gatilhos que levam esses cards para Negociação e Tentativa de contato",
  ],
  mantem: [
    "A régua das 5 colunas, intacta — só deixa de receber sinal daquele número",
    "A coluna Pedido emitido, que vem da nota fiscal e não da conversa",
    "O ETL, que segue ingerindo o RD normalmente para o banco",
    "O disparo em massa, que continua enxergando o contato real",
  ],
  nota:
    "Sem sinal de conversa, cada cliente cai onde a régua manda: quem está na carteira do " +
    "WinThor vai para Prospecção; quem foi contatado mas o ERP não alcança vai para Ociosos. " +
    "Ninguém some. Medido em 24/08, só com a Murano Professional marcada: 4.091 em " +
    "prospecção, 76 em ociosos, 1 em negociação.",
} as const;

const CHAVES = MECANISMOS.map((m) => m.chave) as readonly string[];

export async function GET() {
  const g = guardaAdmin("ver os interruptores do CRM");
  if (g.erro) return g.erro;

  const sb = sbAdmin();
  const cfg = await lerCrmConfig(sb);
  const { data: cc } = await sb.from("crm_config").select("cadastro_campos").eq("id", 1).maybeSingle();
  const campos: CampoCadastro[] = lerCampos((cc as any)?.cadastro_campos);
  const { data: cl } = await sb.from("crm_config").select("locais").eq("id", 1).maybeSingle();
  const locais: Local[] = lerLocais((cl as any)?.locais);

  // `padrao` viaja junto para a tela poder dizer "este é o estado de fábrica"
  // sem repetir a regra do lado do navegador.
  return Response.json({
    "crm-config": {
      config: cfg,
      padrao: CRM_CONFIG_PADRAO,
      mecanismos: MECANISMOS,
      // A chave mestra. Vem separada das outras porque não é mais um mecanismo
      // na lista: é o estado das quatro de baixo lidas juntas. A tela desenha
      // ela em cima e marca as outras como "definidas pelo modo migração"
      // enquanto estiver ligada — se as deixasse editáveis, dois controles
      // decidiriam a mesma coisa e ninguém saberia qual vence.
      migracao: {
        rotulo: "Modo migração — sem RD Conversas",
        ligado: modoMigracao(cfg),
        resumo:
          "O sistema como será quando o RD Conversas não existir mais. Ligando, o RD some da " +
          "tela inteira: conversas, histórico, carteira, a linha Murano Pro e as menções a ETL. " +
          "Os clientes passam a vir do espelho do WinThor e o dono é só o RCA.",
        desliga: [
          "Conversas, prévias e threads vindas do RD, e o botão “ver histórico anterior”",
          "A linha Murano Pro no filtro por número e na etiqueta do cabeçalho",
          "A tag de carteira do RD como dono — vale só o RCA do WinThor",
          "O selo “RCA n · RD x” dos cards e os avisos de divergência entre os dois",
          "O botão Sinc/Pause do ETL e o ↻ que puxa mensagens do RD",
        ],
        mantem: [
          "Todos os clientes: vêm da carteira do WinThor pelo RCA, contatados ou não",
          "As conversas do número próprio, os templates, a ligação e o disparo em massa",
          "TUDO no banco — as mensagens do RD continuam lá, e o ETL continua trazendo as novas",
        ],
        nota:
          "É reversível e não apaga nada: desligar devolve o RD à tela no estado de fábrica " +
          "(todas as linhas, histórico e carteira do RD de volta, envio no automático). Ligada, " +
          "espere um chat quase vazio no primeiro dia — hoje 92.864 mensagens são do RD contra " +
          "poucas dezenas do número próprio, e é exatamente essa a foto do dia seguinte ao corte.",
        // as quatro que o modo controla — a tela usa para travá-las
        controla: ["linhas_visiveis", "historico_rd", "carteira_rd_ativa", "numero_envio"],
      },
      // ENVIO ≠ VISIBILIDADE. São duas perguntas diferentes e a tela precisa
      // dizer isso, senão o admin muda uma achando que mudou a outra.
      // texto do aviso de pausa (0106): mora no banco porque quem sabe o tom
      // certo e o time, nao quem faz deploy
      pausa: {
        rotulo: "Aviso de pausa",
        resumo:
          "O que a cliente recebe quando o vendedor clica em ⏸ no chat. Só é enviado dentro " +
          "da janela de 24h — fora dela exigiria template, e um aviso de intervalo não vale isso. " +
          "A rota também recusa repetir para quem já foi avisado.",
        texto: cfg.texto_pausa,
      },
      // ---- campos da ficha de cadastro (0109) -----------------------------
      // A lista mora no banco porque quem sabe o que o WinThor exige e quem
      // cadastra, nao quem faz deploy. O MESMO array gera a mensagem que pede
      // os dados a cliente -- uma fonte, dois usos, sem risco de o consultor
      // pedir oito coisas e o formulario ter dez.
      // ---- enderecos que o consultor pode enviar como localizacao (0111) ---
      // Lista VAZIA nao e erro: sem endereco cadastrado o menu do clipe nem
      // mostra a opcao. E melhor faltar o botao do que ele mandar a cliente
      // para uma coordenada errada.
      locais: {
        rotulo: "Endereços para enviar no chat",
        resumo:
          "O consultor manda pelo 📎 do chat, e chega como cartão de mapa. NÃO usa a " +
          "localização do celular: o que a cliente pergunta é onde fica a loja, e a tela " +
          "vive dentro de iframe, onde o navegador recusa geolocalização sem prompt.",
        itens: locais,
      },
      cadastro: {
        rotulo: "Ficha de cadastro do cliente novo",
        resumo:
          "Os campos que o consultor preenche no chat com o que a cliente ditar, para " +
          "alguem depois digitar no WinThor. A mensagem que PEDE os dados e montada desta " +
          "mesma lista, entao corrigir aqui corrige os dois lugares.",
        campos: campos,
      },
      envio: {
        rotulo: "Número de envio",
        resumo:
          "Por qual número o CRM FALA: mensagem, template e ligação, em qualquer contato. " +
          "É diferente de quais conversas aparecem na tela — dá para acompanhar o histórico " +
          "do RD e já estar respondendo pelo número novo.",
        atual: cfg.numero_envio,
        opcoes: [
          { v: null, rotulo: "Automático (como hoje)",
            desc: "Responde pelo canal em que o cliente falou por último. Contato novo sai pela Cloud." },
          { v: "rd", rotulo: "Murano Pro (RD Conversas)",
            desc: "Tudo pelo número oficial. Mensagem livre só alcança quem o RD já conhece; template alcança qualquer número." },
          { v: "cloud", rotulo: "Murano Professional",
            desc: "Tudo pelo número novo. Para quem tem histórico no número antigo, a conversa chega como de um número desconhecido." },
        ],
      },
      linhas: {
        ...LINHAS_INFO,
        // as linhas vêm de `chat_linha` (§14.1: cadastro em tabela, não lista no
        // código) — ativar uma amanhã a faz aparecer aqui sozinha
        opcoes: cfg.linhas,
        selecionadas: linhasVisiveis(cfg),
        tudo: tudoVisivel(cfg),
      },
    },
  });
}

/** Liga ou desliga um mecanismo para TODO MUNDO. */
export async function PUT(req: Request) {
  const g = guardaAdmin("ligar ou desligar um mecanismo do CRM");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  // Uma chave por chamada: `{chave, valor}`. O formato antigo `{ciclo_ativo}`
  // continua aceito porque uma aba já aberta no navegador de alguém ainda manda
  // assim durante o deploy.
  const chave: string = typeof b.chave === "string" ? b.chave
    : typeof b.ciclo_ativo === "boolean" ? "ciclo_ativo" : "";
  // `valor` pode ser booleano (mecanismo), lista (linhas visíveis), string ou
  // NULO (número de envio). O fallback para `b.ciclo_ativo` só existe para o
  // formato antigo `{ciclo_ativo:bool}`, que uma aba já aberta ainda manda
  // durante o deploy — e só deve valer quando `valor` não veio de jeito nenhum.
  const valor = "valor" in b ? b.valor : b.ciclo_ativo;

  const sb = sbAdmin();
  const antes = await lerCrmConfig(sb);

  // ---- enderecos de localizacao ---------------------------------------------
  if (chave === "locais") {
    if (!Array.isArray(valor)) return Response.json({ error: "informe a lista de endereços" }, { status: 400 });
    // `lerLocais` descarta linha com coordenada invalida. Se o admin mandou 3 e
    // sobraram 2, ele precisa SABER -- senao salva achando que cadastrou e o
    // botao continua faltando no chat.
    const limpos = lerLocais(valor);
    if (valor.length && !limpos.length) {
      return Response.json({ error: "nenhum endereço válido — confira nome, endereço e as coordenadas" }, { status: 400 });
    }
    const { error } = await sb.from("crm_config").upsert({
      id: 1, locais: limpos,
      atualizado_por: g.email, atualizado_em: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const perdidos = valor.length - limpos.length;
    return Response.json({
      ok: true,
      aviso: perdidos > 0
        ? `${limpos.length} endereço(s) salvos. ${perdidos} foram descartados por coordenada inválida.`
        : limpos.length
          ? `${limpos.length} endereço(s) salvos. Já aparecem no 📎 do chat.`
          : "Nenhum endereço — a opção some do menu do chat.",
    });
  }

  // ---- campos da ficha de cadastro: lista, nao booleano ---------------------
  if (chave === "cadastro_campos") {
    const limpos = lerCampos(valor);
    if (!Array.isArray(valor) || !valor.length) {
      return Response.json({ error: "informe ao menos um campo" }, { status: 400 });
    }
    // chave duplicada faria dois campos gravarem no mesmo lugar, e o segundo
    // apagaria o primeiro em silencio na hora de salvar a ficha
    const ks = limpos.map((c) => c.k);
    if (new Set(ks).size !== ks.length) {
      return Response.json({ error: "ha identificadores repetidos na lista" }, { status: 400 });
    }
    const { error } = await sb.from("crm_config").upsert({
      id: 1, cadastro_campos: limpos,
      atualizado_por: g.email, atualizado_em: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, aviso: `Ficha com ${limpos.length} campos. A mensagem que pede os dados ja acompanha.` });
  }

  // ---- MODO MIGRAÇÃO: escreve as quatro chaves de uma vez -------------------
  // Não há coluna `modo_migracao` no banco de propósito (ver `modoMigracao()`
  // em lib/crmConfig.ts): o modo É a leitura das quatro. Aqui só se escreve o
  // conjunto — ligar põe as quatro na posição de migração, desligar devolve as
  // quatro ao CRM de sempre. Sem snapshot para guardar, e sem um quinto estado
  // que possa contradizer os outros.
  if (chave === "modo_migracao") {
    if (typeof valor !== "boolean") {
      return Response.json({ error: "informe o valor como true ou false" }, { status: 400 });
    }
    const ativas = antes.linhas.filter((l) => l.ativo).map((l) => l.phone_number_id);
    const semRd = ativas.filter((id) => id !== "rd");

    // Sem nenhuma linha própria não há para onde migrar: ligar o modo deixaria
    // o board inteiro em prospecção e o chat vazio, sem nada na tela dizendo por
    // quê. Melhor recusar com o motivo do que entregar uma tela morta.
    if (valor && !semRd.length) {
      return Response.json({
        error: "Não há nenhuma linha própria ativa além do RD — cadastre a linha da Cloud em chat_linha antes de migrar.",
      }, { status: 400 });
    }

    const novo = valor
      ? { linhas_visiveis: semRd, ...POSICAO_MIGRACAO }
      // Desligar devolve ao estado de fábrica: todas as linhas (NULO, para que
      // uma linha nova apareça sozinha — §32.1), histórico e carteira do RD de
      // volta, e envio no automático.
      : { linhas_visiveis: null, historico_rd: true, carteira_rd_ativa: true, numero_envio: null };

    const { data, error } = await sb.from("crm_config").upsert({
      id: 1, ...novo, atualizado_por: g.email, atualizado_em: new Date().toISOString(),
    }, { onConflict: "id" }).select("ciclo_ativo,linhas_visiveis,numero_envio,historico_rd,carteira_rd_ativa,atualizado_por,atualizado_em").single();
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({
      ok: true, config: data,
      aviso: valor
        ? "Modo migração LIGADO. O RD Conversas sumiu da tela inteira: conversas, histórico, carteira, linha e menções a ETL. Os clientes vêm do WinThor e o dono é o RCA. Nada foi apagado — desligar devolve tudo."
        : "Modo migração desligado. O RD Conversas voltou: conversas, histórico, carteira e envio no automático.",
    });
  }

  // ---- seletor de linhas: escolha de CONJUNTO, não booleano -----------------
  if (chave === "linhas_visiveis") {
    if (!Array.isArray(valor) || valor.some((v) => typeof v !== "string")) {
      return Response.json({ error: "informe a lista de linhas" }, { status: 400 });
    }
    const ativas = antes.linhas.filter((l) => l.ativo).map((l) => l.phone_number_id);
    const escolhidas = ativas.filter((id) => valor.includes(id));   // ignora id desconhecido

    // Zero linhas deixaria o board inteiro em prospecção/ociosos sem nada na
    // tela explicando por quê. Se um dia esse for o desenho desejado, ele é
    // outro interruptor ("fonte do board"), não um efeito colateral daqui.
    if (!escolhidas.length) {
      return Response.json({ error: "marque ao menos um número" }, { status: 400 });
    }

    // Tudo marcado grava NULO, não a lista: com a lista congelada, ativar uma
    // linha nova amanhã a deixaria invisível até alguém lembrar de marcá-la.
    const novo = escolhidas.length === ativas.length ? null : escolhidas;
    const { data, error } = await sb.from("crm_config").upsert({
      id: 1, linhas_visiveis: novo,
      atualizado_por: g.email, atualizado_em: new Date().toISOString(),
    }, { onConflict: "id" }).select("ciclo_ativo,linhas_visiveis,numero_envio,historico_rd,carteira_rd_ativa,atualizado_por,atualizado_em").single();
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const nomes = antes.linhas.filter((l) => escolhidas.includes(l.phone_number_id)).map((l) => l.rotulo);
    return Response.json({
      ok: true,
      config: data,
      aviso: novo === null
        ? "Todos os números voltaram a aparecer no board e no chat."
        : `Board e chat passam a enxergar só: ${nomes.join(", ")}. Os demais clientes caem em Prospecção e Ociosos. Quem estiver com a tela aberta vê na próxima atualização.`,
    });
  }

  // ---- texto do aviso de pausa ---------------------------------------------
  if (chave === "texto_pausa") {
    const t = String(valor ?? "").trim();
    if (t.length < 10) return Response.json({ error: "o aviso precisa de pelo menos 10 caracteres" }, { status: 400 });
    if (t.length > 900) return Response.json({ error: "o aviso ficou longo demais (máx. 900)" }, { status: 400 });
    const { error } = await sb.from("crm_config").upsert({
      id: 1, texto_pausa: t, atualizado_por: g.email, atualizado_em: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, aviso: "Aviso de pausa atualizado." });
  }

  // ---- número de envio: três estados, e um deles é NULO ---------------------
  if (chave === "numero_envio") {
    const v = valor === null || valor === "" ? null : String(valor);
    if (v !== null && v !== "rd" && v !== "cloud") {
      return Response.json({ error: "número de envio inválido" }, { status: 400 });
    }
    const { data, error } = await sb.from("crm_config").upsert({
      id: 1, numero_envio: v,
      atualizado_por: g.email, atualizado_em: new Date().toISOString(),
    }, { onConflict: "id" }).select("ciclo_ativo,linhas_visiveis,numero_envio,atualizado_por,atualizado_em").single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({
      ok: true, config: data,
      aviso: v === null
        ? "Voltou ao automático: cada conversa responde pelo canal em que o cliente falou por último."
        : v === "rd"
          ? "Tudo passa a sair pelo Murano Pro (RD Conversas). Contatos que só existem no nosso banco continuam saindo pela Cloud — o RD não os conhece."
          : "Tudo passa a sair pelo Murano Professional, inclusive para quem tem histórico no número antigo.",
    });
  }

  if (!CHAVES.includes(chave)) {
    return Response.json({ error: "mecanismo desconhecido" }, { status: 400 });
  }
  // Só booleano de verdade. `"false"` (string) é `true` em JS, e um cliente
  // desatualizado mandando string ligaria o mecanismo achando que desligou.
  if (typeof valor !== "boolean") {
    return Response.json({ error: "informe o valor como true ou false" }, { status: 400 });
  }

  if ((antes as any)[chave] === valor) {
    return Response.json({ ok: true, aviso: "já estava assim — nada mudou.", config: antes });
  }

  const { data, error } = await sb.from("crm_config").upsert({
    id: 1,
    [chave]: valor,
    atualizado_por: g.email,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "id" }).select("ciclo_ativo,linhas_visiveis,numero_envio,historico_rd,carteira_rd_ativa,atualizado_por,atualizado_em").single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const avisos: Record<string, { on: string; off: string }> = {
    ciclo_ativo: {
      on: "O ciclo volta a aparecer no board, no chat, no disparo em massa e no relatório.",
      off: "O ciclo saiu do board, do chat, do disparo em massa e do relatório.",
    },
    historico_rd: {
      on: "O botão “ver histórico anterior” volta a aparecer nas conversas que têm passado no outro número.",
      off: "O histórico do outro número deixou de ser alcançável pela tela. As mensagens continuam no banco.",
    },
    carteira_rd_ativa: {
      on: "A tag de carteira do RD volta a valer como dono para quem não tem RCA — os clientes voltam às carteiras de antes.",
      off: "O dono passou a ser só o RCA do WinThor. Quem não tem RCA ativo foi para a fila de não atribuídos, de onde qualquer um pega.",
    },
  };
  // Sem o fallback, um mecanismo novo em MECANISMOS sem linha aqui grava no
  // banco e SÓ DEPOIS estoura em `a.on` — a chave vira, a tela mostra erro, e
  // ninguém confia mais no botão. Já aconteceu com `historico_rd`.
  const a = avisos[chave] ?? {
    on: `"${chave}" ligado.`,
    off: `"${chave}" desligado.`,
  };

  return Response.json({
    ok: true,
    config: data,
    aviso: `${valor ? a.on : a.off} Quem estiver com a tela aberta vê a mudança na próxima atualização.`,
  });
}
