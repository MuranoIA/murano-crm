import { normalizarTelefone, tel8De } from "./telefone";

// ---------------------------------------------------------------------------
// Achar ou criar o contato de um cliente do ERP — UMA implementação, dois
// chamadores: o botão "+" do chat (número digitado, sem cliente do ERP por
// trás) e a aba Minha carteira (cliente do ERP que ainda não tem contato).
//
// Se cada um tivesse a sua regra de identidade, o mesmo número nasceria duas
// vezes com ids diferentes — e as duas conversas dividiriam o histórico da
// mesma pessoa. É a mesma razão de `publicoDisparo.ts` (§63.2) e de
// `vinculoCpf.ts`: caminho automático e caminho manual têm de casar.
// ---------------------------------------------------------------------------

export type ContatoResolvido = {
  cliente_id: string;
  nome: string;
  carteira: string | null;
  // o número que ficou valendo. Vai na resposta porque o chamador nem sempre o
  // digitou — vindo da agenda ele sai do cadastro do ERP —, e sem ele o
  // cabeçalho da conversa diria "sem telefone" logo depois de abrir por telefone
  telefone: string;
  // dono COMERCIAL (a carteira do RCA no WinThor), quando se sabe. Vai separado
  // de `carteira` porque a tela usa os dois para coisas diferentes: o segundo
  // diz de quem é a conversa, este diz se ela PODE ser devolvida para a fila —
  // e cliente com dono comercial não pode (§56). Sem ele, a conversa recém-
  // aberta oferecia um "Devolver" que o servidor recusaria.
  carteira_dona: string | null;
  ja_existia: boolean;
  codcli: number | null;
};

/** O que a carteira do ERP oferece para abrir uma conversa com este cliente. */
export type SituacaoTelefone =
  | { pode: true; telefone: string }
  | { pode: false; motivo: "sem_telefone" | "telefone_invalido"; bruto: string | null };

/**
 * Lê o telefone do cadastro do WinThor e diz se dá para falar com essa pessoa.
 *
 * Medido em 09/09/2026 sobre as 7 carteiras ativas: dos 118 clientes que a aba
 * mostrava como inertes, **24 tinham telefone perfeitamente utilizável** (DDD +
 * 9 dígitos) e só não abriam porque ninguém tinha criado o contato. Os outros
 * 94 se dividem entre cadastro sem telefone nenhum (63) e telefone quebrado no
 * ERP (31: sem DDD, ou com um dígito a mais).
 *
 * A distinção importa porque as três situações pedem AÇÕES DIFERENTES, e a
 * mensagem única de antes ("telefone não confere com nenhum") mandava o
 * consultor caçar um contato que não existe quando o problema estava no
 * cadastro. Erro que não diz o que fazer vira diagnóstico errado (§37, §53).
 */
export function situacaoDoTelefone(bruto: string | null | undefined): SituacaoTelefone {
  const cru = String(bruto ?? "").trim();
  if (!cru || !/\d/.test(cru)) return { pode: false, motivo: "sem_telefone", bruto: null };
  const tel = normalizarTelefone(cru);
  if (!tel) return { pode: false, motivo: "telefone_invalido", bruto: cru };
  return { pode: true, telefone: tel };
}

/** O texto que o consultor lê na linha, quando não dá para abrir direto. */
export function impedimentoDe(s: SituacaoTelefone): string | null {
  if (s.pode) return null;
  return s.motivo === "sem_telefone"
    ? "sem telefone no cadastro do WinThor — toque para informar"
    : `telefone incompleto no cadastro do WinThor (${s.bruto}) — toque para corrigir`;
}

/**
 * Garante que existe uma linha em `clientes` para aquele número e devolve o
 * contato. NÃO envia nada: cadastrar e mandar mensagem são gestos separados,
 * senão um clique em "abrir" dispararia mensagem para número digitado errado.
 *
 * @param erp quando o número vem de um cliente do WinThor: nome, dono e **CPF**
 *   saem de lá, não do que foi digitado. O CPF é o que faz o vínculo nascer —
 *   sem ele o contato abriria sem histórico de compra, que é justamente a
 *   vantagem que o CRM tem sobre o WhatsApp comum.
 */
export async function acharOuCriarContato(
  sb: any,
  opts: {
    telefone: string;                       // já normalizado
    nome?: string | null;
    carteiraDeQuemCriou?: string | null;
    erp?: { codcli: number; nome: string | null; cpf: string | null; carteira: string | null } | null;
  },
): Promise<ContatoResolvido> {
  const tel8 = tel8De(opts.telefone);

  // Match pelos 8 ÚLTIMOS dígitos, a mesma chave do webhook e do ETL: o RD
  // guarda 12 dígitos (sem o nono) e a Meta manda 13, então comparar o número
  // inteiro erraria justamente nos contatos que já existem (§16.3).
  const { data: existentes, error: e1 } = await sb
    .from("clientes").select("id,nome_completo,carteira,telefone,cpf")
    .like("telefone", `%${tel8}`).limit(5);
  if (e1) throw new Error(e1.message);

  if (existentes?.length) {
    // mesma preferência do webhook: se houver mais de um, fica com quem tem dono
    const escolhido = existentes.find((c: any) => c.carteira) ?? existentes[0];
    // o contato já existia sem CPF e agora sabemos de quem é: gravar destrava o
    // vínculo, o histórico de compra e o painel do ERP
    if (opts.erp?.cpf && !escolhido.cpf) {
      await sb.from("clientes").update({ cpf: opts.erp.cpf }).eq("id", escolhido.id);
      try { await sb.rpc("wth_reconciliar_vinculos"); } catch { /* o cron de 10 min pega */ }
    }
    return {
      cliente_id: escolhido.id,
      nome: escolhido.nome_completo,
      carteira: escolhido.carteira ?? null,
      telefone: String(escolhido.telefone ?? opts.telefone),
      carteira_dona: opts.erp?.carteira ?? null,
      ja_existia: true,
      codcli: opts.erp?.codcli ?? null,
    };
  }

  // Não está em `clientes`, mas pode ser cliente do ERP que nunca conversou —
  // nesse caso o nome e o dono certos vêm de lá, não do que foi digitado.
  let erp = opts.erp ?? null;
  if (!erp) {
    const { data: noErp } = await sb
      .from("wth_carteira").select("codcli,nome,cpf,rca_num").eq("tel8", tel8).limit(1);
    if (noErp?.[0]) {
      let slug: string | null = null;
      if (noErp[0].rca_num != null) {
        const { data: cc } = await sb.from("carteira_config")
          .select("slug").eq("rca_num", noErp[0].rca_num).eq("ativo", true).maybeSingle();
        slug = cc?.slug ?? null;
      }
      erp = { codcli: noErp[0].codcli, nome: noErp[0].nome, cpf: noErp[0].cpf, carteira: slug };
    }
  }

  const novo = {
    // mesmo id sintético do webhook: se esta pessoa escrever depois, o
    // `acharOuCriarCliente` cai no match por tel8 e reusa ESTA linha, sem criar
    // uma segunda conversa para o mesmo número
    id: `wa:${opts.telefone}`,
    nome_completo: String(opts.nome ?? "").trim() || erp?.nome || opts.telefone,
    telefone: opts.telefone,
    cpf: erp?.cpf ?? null,
    // dono: o do ERP se houver; senão quem cadastrou, quando é vendedor. Admin
    // e home não têm carteira, então o contato nasce na fila de não atribuídos
    // (§21) — que é onde qualquer um pode pegá-lo.
    carteira: erp?.carteira ?? opts.carteiraDeQuemCriou ?? null,
    canal: "whatsapp",
  };
  const { error: e2 } = await sb.from("clientes").upsert(novo, { onConflict: "id" });
  if (e2) throw new Error(e2.message);

  // com CPF, o vínculo com o WinThor nasce agora e não daqui a dez minutos —
  // quem acabou de abrir a conversa quer ver o histórico junto
  if (novo.cpf) { try { await sb.rpc("wth_reconciliar_vinculos"); } catch { /* o cron pega */ } }

  return {
    cliente_id: novo.id,
    nome: novo.nome_completo,
    carteira: novo.carteira,
    telefone: novo.telefone,
    carteira_dona: erp?.carteira ?? null,
    ja_existia: false,
    codcli: erp?.codcli ?? null,
  };
}
