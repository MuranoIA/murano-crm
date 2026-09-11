import { sbAdmin, guardaAdmin, corpo } from "../../../../lib/adminApi";
import { lerCrmConfig, CRM_CONFIG_PADRAO, linhasVisiveis, tudoVisivel, linhaPadraoCloud } from "../../../../lib/crmConfig";
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
]  as const;

// O seletor de linhas NÃO é um booleano, então não entra na lista acima: é uma
// escolha de conjunto. O texto mora aqui pelo mesmo motivo dos outros — a tela
// não deve inventar a explicação do que o admin está prestes a mudar.
const LINHAS_INFO = {
  rotulo: "Conversas visíveis, por número",
  resumo:
    "Quais números alimentam a classificação dos cards nas colunas do board e a lista do " +
    "chat. Desmarcar um número não apaga nada: as conversas dele continuam no banco.",
  desliga: [
    "Conversas do número desmarcado na lista do chat, na busca e na thread",
    "Última mensagem, prévia e tempo parado nos cards vindos dele",
    "Os gatilhos que levam esses cards para Negociação e Tentativa de contato",
  ],
  mantem: [
    "A régua das colunas, intacta — só deixa de receber sinal daquele número",
    "A coluna Pedido emitido, que vem da nota fiscal e não da conversa",
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

  // A linha Cloud que "cloud" resolve de fato hoje (0123): a escolha do admin
  // em Linhas, senão a env. Só para dar nome à opção abaixo — não é fonte de
  // verdade (essa é `linhaPadrao()` em lib/whatsapp.ts).
  const envAtual = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").replace(/[^\x21-\x7E]/g, "") || null;
  const linhaResolvidaId = linhaPadraoCloud(cfg) ?? envAtual;
  const linhaResolvidaRotulo = cfg.linhas.find((l) => l.phone_number_id === linhaResolvidaId)?.rotulo ?? null;

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
      sla: {
        rotulo: "Alerta de espera (SLA)",
        resumo:
          "Minutos de espera que acendem o aviso. Os indicadores já MEDEM o tempo de " +
          "resposta depois do fato; isto é o contrário — a fila do momento, para alguém " +
          "agir antes de a espera virar estatística. 0 desliga.",
        minutos: Number(cfg.sla_minutos ?? 0),
        nota:
          "Nasce em 0 de propósito: um limite chutado no deploy vira alarme que todo mundo " +
          "aprende a ignorar, e isso é pior que não ter alarme — dá a sensação de que " +
          "alguém está vigiando. A resposta automática de fora do horário NÃO apaga o " +
          "aviso: a cliente recebeu um recado e continua esperando gente.",
      },
      cadastro: {
        rotulo: "Ficha de cadastro do cliente novo",
        resumo:
          "Os campos que o consultor preenche no chat com o que a cliente ditar, para " +
          "alguem depois digitar no WinThor. A mensagem que PEDE os dados e montada desta " +
          "mesma lista, entao corrigir aqui corrige os dois lugares.",
        campos: campos,
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

  // ---- limite de SLA: número em minutos, 0 desliga -------------------------
  if (chave === "sla_minutos") {
    const n = Math.floor(Number(valor));
    if (!Number.isFinite(n) || n < 0 || n > 1440) {
      return Response.json({ error: "informe de 0 a 1440 minutos (0 desliga)" }, { status: 400 });
    }
    const { error } = await sb.from("crm_config").upsert({
      id: 1, sla_minutos: n,
      atualizado_por: g.email, atualizado_em: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({
      ok: true,
      aviso: n === 0
        ? "Alerta de espera desligado — os indicadores continuam medindo, ninguém é avisado."
        : `Alerta a partir de ${n} min de espera. Aparece no chat e nos indicadores.`,
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
    }, { onConflict: "id" }).select("ciclo_ativo,linhas_visiveis,atualizado_por,atualizado_em").single();
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
  }, { onConflict: "id" }).select("ciclo_ativo,linhas_visiveis,atualizado_por,atualizado_em").single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const avisos: Record<string, { on: string; off: string }> = {
    ciclo_ativo: {
      on: "O ciclo volta a aparecer no board, no chat, no disparo em massa e no relatório.",
      off: "O ciclo saiu do board, do chat, do disparo em massa e do relatório.",
    },
  };
  // Sem o fallback, um mecanismo novo em MECANISMOS sem linha aqui grava no
  // banco e SÓ DEPOIS estoura em `a.on` — a chave vira, a tela mostra erro, e
  // ninguém confia mais no botão. Já aconteceu uma vez.
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
