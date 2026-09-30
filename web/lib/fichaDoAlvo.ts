import "server-only";

// ---------------------------------------------------------------------------
// A FICHA DE QUEM VAI RECEBER (demanda #56, 29/09/2026)
//
// A prévia do disparo mostrava só o nome. O dono pediu a mesma tabela que a
// campanha tem depois do envio: código, CPF, telefone, RCA e o consultor.
//
// ⚠️ NÃO ENTROU EM `montarPublico`. Aquele motor percorre milhares de clientes
// para escolher algumas centenas, e é chamado pelas duas telas; carregar
// cadastro de todo mundo ali seria pagar por dado que a esmagadora maioria das
// chamadas descarta. Aqui a busca é só dos SELECIONADOS — o que a tela vai
// mesmo desenhar.
//
// ⚠️ E é opcional na rota (`detalhe: true`). A tela antiga não pede, então não
// paga: o pedido é de uma tela só, e o custo também deve ser.
// ---------------------------------------------------------------------------

export type FichaAlvo = {
  cliente_id: string;
  codcli: number | null;
  cpf: string | null;
  telefone: string | null;
  rca: number | null;
};

const LOTE = 200;

/** CPF/CNPJ com pontuação — a tela mostra para a pessoa conferir, não para casar
 *  com nada. Sem máscara, "07678907281" é ilegível numa coluna estreita. */
export function documentoBonito(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d || null;
}

export async function fichasDosAlvos(sb: any, ids: string[]): Promise<Map<string, FichaAlvo>> {
  const fichas = new Map<string, FichaAlvo>();
  if (!ids.length) return fichas;

  const vinc = new Map<string, number>();
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const [{ data: cs }, { data: vs }] = await Promise.all([
      sb.from("clientes").select("id,telefone,cpf").in("id", lote),
      sb.from("wth_vinculo").select("cliente_id,codcli").in("cliente_id", lote),
    ]);
    for (const c of cs ?? []) {
      fichas.set((c as any).id, {
        cliente_id: (c as any).id,
        codcli: null, rca: null,
        cpf: documentoBonito((c as any).cpf),
        telefone: (c as any).telefone ?? null,
      });
    }
    for (const v of vs ?? []) vinc.set((v as any).cliente_id, Number((v as any).codcli));
  }

  // o RCA vem do ERP, pelo código — é o dono comercial de verdade (§10.3), e
  // não a carteira do espelho
  const codclis = [...new Set(vinc.values())];
  const rcaDe = new Map<number, number | null>();
  for (let i = 0; i < codclis.length; i += 300) {
    const { data } = await sb.from("wth_carteira")
      .select("codcli,rca_num").in("codcli", codclis.slice(i, i + 300));
    for (const w of data ?? []) rcaDe.set(Number((w as any).codcli), (w as any).rca_num ?? null);
  }

  for (const [id, cod] of vinc) {
    const f = fichas.get(id) ?? { cliente_id: id, codcli: null, cpf: null, telefone: null, rca: null };
    f.codcli = cod;
    f.rca = rcaDe.get(cod) ?? null;
    fichas.set(id, f);
  }
  return fichas;
}
