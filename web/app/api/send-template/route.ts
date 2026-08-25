import { createClient } from "@supabase/supabase-js";
import { canalDeResposta, sendTemplate, linhaDeEnvio } from "../../../lib/whatsapp";
import { traduzErroRd } from "../../../lib/erroRd";
import { variaveisDe, limparVariavel, aplicarVariaveis, conferirVariaveis } from "../../../lib/templateVars";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // dá folga p/ a chamada à API da RD (evita timeout de 10s da Vercel)

// carteira (dono do card) -> employee_id vem da tabela carteira_config (fonte única)

export async function POST(req: Request) {
  try {
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const rdUrl = process.env.RD_CONVERSAS_BASE_URL;
    const rdToken = process.env.RD_CONVERSAS_TOKEN;

    // valida env vars (falta de qualquer uma = erro claro, não crash vazio). O template
    // padrão NÃO é mais uma env var (TEMPLATE_RECONTATO_ID) — vem de crm_templates.padrao,
    // editável pela UI sem redeploy (ver /api/templates). Env var só como fallback legado.
    const faltando = Object.entries({
      SUPABASE_URL: supaUrl, SUPABASE_SERVICE_ROLE_KEY: supaKey,
      RD_CONVERSAS_BASE_URL: rdUrl, RD_CONVERSAS_TOKEN: rdToken,
    }).filter(([, v]) => !v).map(([k]) => k);
    if (faltando.length) {
      return Response.json({ error: `Config ausente na Vercel: ${faltando.join(", ")}` }, { status: 500 });
    }

    // `variaveis` são os valores que o CONSULTOR digitou para os {{n}} do
    // template, um por campo, na ordem. Só o chat manda — o board e o disparo
    // em massa não têm como pedir um texto por cliente e continuam chamando
    // esta rota como sempre chamaram, sem o campo. Por isso ele é opcional e a
    // ausência dele reproduz o comportamento antigo, inteiro.
    let cliente_id: string, template_id: string | undefined, variaveis: unknown;
    try {
      ({ cliente_id, template_id, variaveis } = await req.json());
    } catch {
      return Response.json({ error: "body inválido" }, { status: 400 });
    }
    if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

    const sb = createClient(supaUrl!, supaKey!, { auth: { persistSession: false } });

    let tplId = template_id;
    if (!tplId) {
      const { data: padrao } = await sb
        .from("crm_templates").select("rd_template_id").eq("padrao", true).eq("ativo", true).maybeSingle();
      tplId = padrao?.rd_template_id || process.env.TEMPLATE_RECONTATO_ID || undefined;
    }
    // Sem template do RD NÃO é erro aqui: a conversa pode correr na Cloud API,
    // que tem cadastro próprio (crm_templates.canal='cloud', migration 0090).
    // O erro é cobrado adiante, dentro do ramo do RD, que é quem precisa dele.

    // busca o contato (telefone/nome/carteira) server-side (não expõe telefone ao browser)
    const { data: cli, error: cliErr } = await sb
      .from("clientes")
      .select("id,nome_completo,telefone,carteira")
      .eq("id", cliente_id)
      .single();
    if (cliErr || !cli) return Response.json({ error: "cliente não encontrado" }, { status: 404 });
    if (!cli.telefone) return Response.json({ error: "cliente sem telefone" }, { status: 400 });

    const { data: cfg } = await sb.from("carteira_config").select("employee_id").eq("slug", cli.carteira as string).maybeSingle();
    const operator_id = cfg?.employee_id ?? null;
    const primeiroNome = String(cli.nome_completo ?? "").trim().split(/\s+/)[0] || "";

    // Valores digitados, já higienizados (a Meta recusa quebra de linha, tabulação
    // e espaços em série num parâmetro). `null` = ninguém mandou, que é o caso do
    // board e do disparo em massa — daí em diante cada ramo cai no seu default
    // de sempre: o primeiro nome da cliente.
    const digitados: string[] | null =
      Array.isArray(variaveis) && variaveis.length ? variaveis.map(limparVariavel) : null;
    if (digitados?.some((v) => !v)) {
      return Response.json({ error: "nenhum campo do template pode ficar vazio" }, { status: 400 });
    }

    // ---- canal direto (WhatsApp Cloud API) — clientes wa:* ou interruptor ligado ----
    // Template na Cloud API é outro cadastro (nome aprovado no Gerenciador da Meta,
    // não o id do RD). Enquanto WHATSAPP_TEMPLATE_RECONTATO não existir na Vercel,
    // este desvio responde 501 com instrução clara. O fluxo RD abaixo segue intocado.
    if ((await canalDeResposta(sb, cliente_id)) === "whatsapp") {
      // Qual template da Cloud usar. Desde a 0090 o cadastro é NOSSO, então a
      // fonte é a tabela — a env WHATSAPP_TEMPLATE_RECONTATO fica só como
      // fallback de quem já a configurou, e some quando ninguém depender dela.
      const { data: cloudTpls } = await sb
        .from("crm_templates")
        .select("id,nome,meta_nome,idioma,corpo,cabecalho_tipo,imagem_path,usa_nome,status,padrao")
        .eq("canal", "cloud").eq("ativo", true).order("id");

      const aprovados = (cloudTpls ?? []).filter((t: any) => String(t.status ?? "").toUpperCase() === "APPROVED");
      const escolhido =
        (template_id && aprovados.find((t: any) => t.meta_nome === template_id)) ||
        aprovados.find((t: any) => t.padrao) ||
        (aprovados.length === 1 ? aprovados[0] : null);

      const nomeTemplate = escolhido?.meta_nome ?? process.env.WHATSAPP_TEMPLATE_RECONTATO;
      if (!nomeTemplate) {
        // Mensagem diferente conforme a causa: "não existe" e "existe mas ainda
        // não foi aprovado" pedem ações opostas de quem está na tela.
        const emAnalise = (cloudTpls ?? []).some((t: any) => String(t.status ?? "").toUpperCase() === "PENDING");
        return Response.json({
          error: emAnalise
            ? "O template desta linha ainda está em análise na Meta. Assim que for aprovado, o envio funciona sozinho."
            : aprovados.length > 1
              ? "Há mais de um template aprovado e nenhum marcado como padrão — escolha o padrão em Administração → Templates."
              : "Nenhum template criado para esta linha. Crie um em Administração → Templates.",
        }, { status: 501 });
      }

      // Quantos campos este template pede: a conta sai do próprio corpo, que é
      // cadastro nosso desde a 0090. Sem corpo é o fallback da env antiga, que
      // sempre mandou um parâmetro só — mantido como estava.
      const campos = escolhido
        ? (escolhido.corpo ? variaveisDe(escolhido.corpo) : escolhido.usa_nome ? [1] : [])
        : [1];

      let valores: string[];
      if (digitados) {
        const erro = conferirVariaveis(escolhido?.corpo ?? null, digitados)
          ?? (digitados.length === campos.length ? null : `este template tem ${campos.length} campo(s) para preencher`);
        if (erro) return Response.json({ error: erro }, { status: 400 });
        valores = digitados;
      } else if (campos.length > 1) {
        // Chamador que não digita — o board e o disparo em massa — não tem o que
        // pôr do segundo campo em diante, e inventar texto em nome do vendedor é
        // pior do que recusar com o caminho certo escrito.
        return Response.json({
          error: `"${escolhido?.nome ?? nomeTemplate}" tem ${campos.length} campos para preencher — envie pelo chat, onde dá para digitar cada um.`,
        }, { status: 400 });
      } else {
        // o comportamento de sempre: {{1}} = primeiro nome da cliente
        valores = campos.length ? [primeiroNome || "cliente"] : [];
      }

      try {
        const to = String(cli.telefone).replace(/\D/g, "");

        // Componentes montados a partir do cadastro, não fixos.
        const componentes: unknown[] = [];
        if (escolhido?.cabecalho_tipo === "imagem" && escolhido?.imagem_path) {
          // A Meta baixa a imagem AGORA. URL assinada de 1h, do bucket privado —
          // link público fixo exporia o arquivo a quem descobrisse o endereço.
          const { data: assinada } = await sb.storage.from("wa-midia")
            .createSignedUrl(escolhido.imagem_path as string, 3600);
          if (!assinada?.signedUrl) {
            return Response.json({ error: "não consegui preparar a imagem do template" }, { status: 500 });
          }
          componentes.push({ type: "header", parameters: [{ type: "image", image: { link: assinada.signedUrl } }] });
        }
        // Um parâmetro por campo, na ordem. Mandar parâmetro de corpo para
        // template SEM variável (ou o contrário) é erro 132000 na Meta — por
        // isso a contagem vem do cadastro, e não de palpite na hora do envio.
        if (valores.length) {
          componentes.push({ type: "body", parameters: valores.map((v) => ({ type: "text", text: v })) });
        }

        const { wamid } = await sendTemplate(to, nomeTemplate, escolhido?.idioma ?? "pt_BR", componentes);
        await sb.from("disparos_template").insert({
          id: wamid, cliente_id: cli.id, telefone: cli.telefone, vendedor: cli.carteira,
          operator_id: operator_id ?? null, template_id: nomeTemplate, status: "sent",
        });
        // espelha em mensagens como template (o funil usa isso p/ a etapa tentativa_contato)
        //
        // O CONTEÚDO é o texto que a cliente vai ler, com {{1}} já trocado pelo
        // nome — não mais "[template] promocao". O vendedor precisa ver na
        // thread o que foi dito em nome dele; um rótulo com o identificador
        // técnico não responde a isso, e era o que havia até aqui.
        const textoEnviado = escolhido?.corpo
          ? aplicarVariaveis(escolhido.corpo, valores)
          : `[template] ${nomeTemplate}`;

        await sb.from("mensagens").upsert({
          id: wamid, cliente_id: cli.id, vendedor_carteira: cli.carteira ?? null,
          enviada_por: "operator", tipo: "template", conteudo: textoEnviado,
          status: "wait", criada_em: new Date().toISOString(),
          linha_id: linhaDeEnvio(),
          // template com imagem reaproveita a bolha de mídia que já existe: o
          // arquivo é o mesmo do cadastro, servido do bucket por URL assinada
          ...(escolhido?.cabecalho_tipo === "imagem" && escolhido?.imagem_path
            ? {
                midia_tipo: "image",
                midia_path: escolhido.imagem_path,
                midia_mime: String(escolhido.imagem_path).endsWith(".png") ? "image/png" : "image/jpeg",
              }
            : {}),
        }, { onConflict: "id" });
        return Response.json({ ok: true, id: wamid, cliente: cli.nome_completo, canal: "whatsapp" });
      } catch (e: any) {
        return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
      }
    }

    // ---- fluxo RD Conversas (intocado) ---------------------------------------
    // A cobrança do template padrão mora AQUI, e não lá em cima, porque só este
    // ramo precisa de um id do RD — a conversa da Cloud já foi atendida acima.
    if (!tplId) {
      return Response.json({ error: "Nenhum template padrão configurado — marque um em Automáticos → editar." }, { status: 500 });
    }

    const recipient = cli.telefone.startsWith("+") ? cli.telefone : `+${cli.telefone}`;

    const payload: Record<string, unknown> = {
      recipient_number: recipient,
      template_message_id: tplId,
      country_code: "55",
      sent_by: operator_id ? "operator" : "bot",
      // O texto do template do RD mora no painel deles, então não dá para saber
      // daqui quantas variáveis ele tem — o envio sempre mandou uma, o primeiro
      // nome, e isso segue sendo o default. Quando o chat manda valores, são
      // eles que vão: quem está na conversa sabe o que escrever ali melhor que
      // uma regra fixa.
      variables: digitados ?? [primeiroNome],
    };
    if (operator_id) payload.operator_id = operator_id;

    // remove qualquer caractere inválido para header (ex: "•" colado por engano);
    // JWT só tem ASCII imprimível [0x21-0x7E], então isto é seguro.
    const tokenLimpo = rdToken!.replace(/[^\x21-\x7E]/g, "");

    // dispara na RD — com retry em 429/5xx (o rate limit do RD é apertado e o sync de
    // fundo pode estar consumindo a cota; a ação do usuário não pode falhar por isso).
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let rd: Response, body: any = {};
    for (let tent = 0; ; tent++) {
      rd = await fetch(new URL("/v3/messages/template/send", rdUrl!), {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenLimpo}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      body = await rd.json().catch(() => ({}));
      if (rd.ok || ![429, 500, 502, 503].includes(rd.status) || tent >= 4) break;
      await sleep(2000 * (tent + 1)); // 2s, 4s, 6s, 8s (cabe no maxDuration=30)
    }
    if (!rd.ok) {
      // mesma razão do send-message: o código sozinho fez o usuário concluir
      // que o envio era proibido, quando era cota (ver lib/erroRd.ts)
      return Response.json({ ...traduzErroRd(rd.status, body), detail: body }, { status: 502 });
    }

    // loga o disparo (contagem por clique)
    const msgId = body?.data?.id || `${cliente_id}-${Date.now()}`;
    await sb.from("disparos_template").insert({
      id: msgId,
      cliente_id: cli.id,
      telefone: cli.telefone,
      vendedor: cli.carteira,
      operator_id: operator_id ?? null,
      template_id: tplId,
      status: body?.data?.status ?? "sent",
    });

    return Response.json({ ok: true, id: msgId, cliente: cli.nome_completo });
  } catch (e: any) {
    return Response.json({ error: `Falha interna: ${e?.message ?? String(e)}` }, { status: 500 });
  }
}
