import { cpfValido, soDigitos, chaveNome } from "./cpf";

// Ligar um contato ao cliente do ERP pelo CPF — e registrar o que o CRM não
// pode consertar sozinho.
//
// Dois chamadores, uma implementação: o webhook (quando a cliente MANDA o CPF
// na conversa) e o botão "é a mesma pessoa" do painel. Se cada um tivesse a sua
// regra, o caminho automático e o manual produziriam vínculos diferentes para o
// mesmo caso — e ninguém saberia qual dos dois está certo.

export type ResultadoVinculo =
  | { estado: "cpf_invalido" }
  | { estado: "ja_vinculado"; codcli: number }
  | { estado: "nao_encontrado"; cpf: string }
  | { estado: "nome_diverge"; cpf: string; codcli: number; nome_erp: string; nome_contato: string }
  | { estado: "ligado"; codcli: number; nome_erp: string; rca_num: number | null;
      telefone_mudou: boolean; telefone_erp: string | null; telefone_novo: string | null };

/**
 * @param exigirNomeIgual  true no caminho AUTOMÁTICO (webhook). A cliente pode
 *   digitar o CPF do marido, da sócia, ou errar um dígito de um jeito que ainda
 *   passe no verificador. Com o nome batendo, são DOIS sinais independentes
 *   concordando — aí é confirmar uma hipótese que o sistema já tinha, não
 *   confiar no que um estranho digitou. Quando divergem, quem decide é o
 *   consultor, e é por isso que o botão chama com `false`.
 */
export async function ligarPorCpf(
  sb: any,
  opts: { cliente_id: string; cpf: string; por: string | null;
          origem: "cpf_confirmado" | "consultor"; exigirNomeIgual: boolean },
): Promise<ResultadoVinculo> {
  const cpf = soDigitos(opts.cpf);
  if (!cpfValido(cpf)) return { estado: "cpf_invalido" };

  const { data: jaTem } = await sb.from("wth_vinculo")
    .select("codcli").eq("cliente_id", opts.cliente_id).maybeSingle();
  if (jaTem?.codcli) return { estado: "ja_vinculado", codcli: jaTem.codcli };

  const [{ data: erp }, { data: contato }] = await Promise.all([
    sb.from("wth_carteira")
      .select("codcli,nome,telefone,rca_num,tel8").eq("cpf", cpf).eq("ativo", true)
      .order("codcli").limit(1),
    sb.from("clientes").select("nome_completo,telefone").eq("id", opts.cliente_id).maybeSingle(),
  ]);
  const alvo = erp?.[0];
  if (!alvo) return { estado: "nao_encontrado", cpf };

  const nomeContato = String(contato?.nome_completo ?? "");
  const concorda = chaveNome(alvo.nome) === chaveNome(nomeContato);
  if (opts.exigirNomeIgual && !concorda) {
    return { estado: "nome_diverge", cpf, codcli: alvo.codcli,
             nome_erp: String(alvo.nome ?? ""), nome_contato: nomeContato };
  }

  // O CPF em `clientes` é o que o job de reconciliação lê. Escrevo o CPF, não o
  // vínculo: `wth_reconciliar_vinculos()` é dono dessa tabela e desfaria uma
  // escrita paralela no ciclo seguinte (§10.11).
  const { error: e1 } = await sb.from("clientes").update({ cpf }).eq("id", opts.cliente_id);
  if (e1) throw new Error(`gravar cpf: ${e1.message}`);

  // ...e chamo o job na hora, em vez de esperar os 10 minutos do pg_cron: quem
  // acabou de confirmar quer ver o histórico aparecer, não daqui a dez minutos.
  // Falha aqui não é fatal — o cron roda de novo e pega.
  try { await sb.rpc("wth_reconciliar_vinculos"); } catch { /* o cron pega */ }

  const tel8Erp = String(alvo.tel8 ?? "");
  const telNovo = String(contato?.telefone ?? "");
  const telefone_mudou = Boolean(telNovo) && soDigitos(telNovo).slice(-8) !== tel8Erp;

  if (telefone_mudou) {
    // O pedido para quem edita o WinThor. `ignoreDuplicates` por causa do índice
    // parcial de pendente: a cliente pode mandar o CPF três vezes na mesma
    // conversa, e quem cuida do cadastro não precisa da mesma correção em
    // triplicata.
    await sb.from("cadastro_atualizacao").insert({
      cliente_id: opts.cliente_id, codcli: alvo.codcli, campo: "telefone",
      valor_atual: alvo.telefone ?? null, valor_novo: telNovo,
      origem: opts.origem, por: opts.por,
    }).select().maybeSingle().then(() => {}, () => { /* já havia pendente */ });
  }

  return { estado: "ligado", codcli: alvo.codcli, nome_erp: String(alvo.nome ?? ""),
           rca_num: alvo.rca_num ?? null, telefone_mudou,
           telefone_erp: alvo.telefone ?? null, telefone_novo: telNovo || null };
}

// ---------------------------------------------------------------------------
// "ESTE NÚMERO É DE OUTRO CLIENTE" — a correção que faltava (demanda #50).
//
// O caso real, de 29/09/2026: o WinThor tem DOIS cadastros com o mesmo telefone
// e CPFs diferentes. O contato do chat ficou colado no cadastro errado, e o
// estrago não é cosmético — a conversa saiu com um template dizendo "Oi,
// <nome do outro>!" para a cliente. Quem descobre isso é o consultor, falando
// com ela; o sistema não tem como saber.
//
// ⚠️ POR QUE ISTO NÃO É UM `ligarPorCpf` COM OUTRO CPF: aquele recusa quando já
// existe vínculo (`ja_vinculado`), de propósito — o caminho automático não deve
// desfazer o que já foi decidido. Aqui é o oposto: é o humano desfazendo.
//
// ⚠️ E POR QUE `origem = 'manual'`: o `wth_reconciliar_vinculos()` roda a cada
// 10 minutos e refaz o vínculo pelo CPF e pelo telefone — mas os dois ramos que
// CORRIGEM trazem `where ... origem <> 'manual'`. Ou seja, `'manual'` já era a
// saída de emergência prevista no desenho do job; ela só não tinha nenhuma tela
// que a usasse. Sem ela, a correção do consultor duraria dez minutos.
//
// O CPF vai junto para `clientes` porque é o que o resto do sistema lê; e o
// NOME também, porque a thread lê `clientes.nome_completo` direto (a view usa o
// nome do ERP desde a 0108, mas a thread não). Com um só dos dois, a mesma
// pessoa apareceria com dois nomes em duas telas.
// ---------------------------------------------------------------------------
export type Reapontamento =
  | { estado: "sem_cadastro"; codcli: number }
  | { estado: "sem_cpf"; codcli: number; nome: string }
  | { estado: "trocado"; de: { codcli: number; nome: string } | null;
      para: { codcli: number; nome: string; rca_num: number | null }; carteira_muda: boolean };

export async function apontarParaCliente(
  sb: any,
  opts: { cliente_id: string; codcli: number; por: string | null },
): Promise<Reapontamento> {
  const { data: alvo } = await sb.from("wth_carteira")
    .select("codcli,nome,cpf,rca_num").eq("codcli", opts.codcli).eq("ativo", true).maybeSingle();
  if (!alvo) return { estado: "sem_cadastro", codcli: opts.codcli };
  const cpf = soDigitos(String(alvo.cpf ?? ""));
  // sem CPF não há vínculo possível: a tabela exige a coluna, e o job casa por
  // ela. Recusar aqui é melhor que gravar um vínculo que o próximo ciclo desfaz.
  if (!cpf) return { estado: "sem_cpf", codcli: opts.codcli, nome: String(alvo.nome ?? "") };

  const { data: antes } = await sb.from("wth_vinculo")
    .select("codcli").eq("cliente_id", opts.cliente_id).maybeSingle();
  let de: { codcli: number; nome: string } | null = null;
  let rcaAntes: number | null = null;
  if (antes?.codcli) {
    const { data: velho } = await sb.from("wth_carteira")
      .select("nome,rca_num").eq("codcli", antes.codcli).maybeSingle();
    de = { codcli: Number(antes.codcli), nome: String(velho?.nome ?? "") };
    rcaAntes = velho?.rca_num ?? null;
  }

  const { error: e1 } = await sb.from("clientes")
    .update({ cpf, nome_completo: String(alvo.nome ?? "") }).eq("id", opts.cliente_id);
  if (e1) throw new Error(`gravar cadastro: ${e1.message}`);

  const { error: e2 } = await sb.from("wth_vinculo").upsert({
    cliente_id: opts.cliente_id, codcli: alvo.codcli, cpf,
    origem: "manual", conferido_em: new Date().toISOString(),
  }, { onConflict: "cliente_id" });
  if (e2) throw new Error(`gravar vínculo: ${e2.message}`);

  return {
    estado: "trocado", de,
    para: { codcli: Number(alvo.codcli), nome: String(alvo.nome ?? ""), rca_num: alvo.rca_num ?? null },
    // a carteira da conversa sai do RCA do cadastro (§45.2): trocar de cadastro
    // pode tirar a conversa da mão de quem está atendendo, e isso precisa ser
    // dito ANTES do clique, não descoberto depois
    carteira_muda: de != null && rcaAntes !== (alvo.rca_num ?? null),
  };
}

/** O recado que vira nota interna na conversa. Nota, e não mensagem: o que entra
 *  em `mensagens` move card de etapa e abre espera no indicador (§21.2). */
export function recadoDoVinculo(r: ResultadoVinculo): string | null {
  switch (r.estado) {
    case "ligado":
      return `CPF confirmado pela cliente. Contato vinculado ao cliente ${r.codcli}` +
        (r.rca_num != null ? ` (RCA ${r.rca_num})` : "") + "." +
        (r.telefone_mudou
          ? ` O telefone do cadastro (${r.telefone_erp ?? "—"}) é diferente do número desta conversa` +
            ` (${r.telefone_novo}) — pedido de atualização registrado para o WinThor.`
          : "");
    case "nome_diverge":
      return `A cliente mandou um CPF que existe no WinThor (cliente ${r.codcli}, ` +
        `"${r.nome_erp}"), mas o nome do contato aqui é "${r.nome_contato}". ` +
        `Não vinculei sozinho — confira e use "É a mesma pessoa" se estiver certo.`;
    case "nao_encontrado":
      return `A cliente mandou um CPF válido que NÃO está no WinThor. ` +
        `Provavelmente é cadastro novo — use a ficha.`;
    default:
      return null;
  }
}
