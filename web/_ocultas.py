import io

# ---------------------------------------------------------------------------
# 1) A ROTA conta as mensagens que estao no numero escondido
# ---------------------------------------------------------------------------
p = 'app/api/funil/route.ts'
s = io.open(p, encoding='utf-8', newline='').read()   # LF


def sub(a, b, n=1):
    global s
    assert s.count(a) == n, (a[:70], s.count(a))
    s = s.replace(a, b)


sub('''  for (const c of cardsOutros) {
    const v = valorMesDe(c);
    c.venda_valor = v && v > 0 ? v : null; // aqui não há comprador do mês; selo verde não aparece
    c.ciclo = cicloDe(c);
  }
''',
    '''  for (const c of cardsOutros) {
    const v = valorMesDe(c);
    c.venda_valor = v && v > 0 ? v : null; // aqui não há comprador do mês; selo verde não aparece
    c.ciclo = cicloDe(c);
  }

  // ---- "sem conversa" era MENTIRA nestes cards --------------------------
  // São os do ramo 1b (0100/§31.3): gente que FOI contatada, mas cuja conversa
  // inteira está no número que a seleção de linhas esconde — e que a prospecção
  // não alcança, por não ter vínculo nem telefone batendo no WinThor. O card
  // dizia "sem conversa" ao lado de alguém com 91 mensagens.
  //
  // A contagem é feita AQUI, e não na view, por dois motivos: a view teria de
  // ganhar coluna (migration, e o número muda a cada mensagem que chega), e
  // isto custa UMA consulta só quando existem cards assim — hoje, seis.
  const semVisivel = cardsOutros
    .filter((c: any) => !c.ultima_atividade && typeof c.cliente_id === "string" && !c.cliente_id.includes(":"))
    .map((c: any) => c.cliente_id);
  if (semVisivel.length) {
    const TETO = 4000;   // 6 clientes x ~90 mensagens hoje; o teto é rede, não regra
    const { data: ocultas } = await sb
      .from("mensagens").select("cliente_id")
      .in("cliente_id", semVisivel.slice(0, 300))
      .neq("tipo", "evento_sistema")
      .limit(TETO);
    const conta = new Map<string, number>();
    for (const m of ocultas ?? []) {
      const k = (m as any).cliente_id;
      conta.set(k, (conta.get(k) ?? 0) + 1);
    }
    for (const c of cardsOutros) {
      const n = conta.get(c.cliente_id);
      if (n) c.msgs_ocultas = n;
    }
  }
''')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('rota ok')

# ---------------------------------------------------------------------------
# 2) O CARD deixa de dizer "sem conversa" quando ha historico escondido
# ---------------------------------------------------------------------------
p2 = 'app/page.tsx'
t = io.open(p2, encoding='utf-8', newline='').read()   # CRLF
NL = '\r\n'


def cr(x):
    return x.replace('\r\n', '\n').replace('\n', NL)


def sub2(a, b, n=1):
    global t
    a, b = cr(a), cr(b)
    assert t.count(a) == n, (a[:70], t.count(a))
    t = t.replace(a, b)


sub2('''                                {/* Sem data isto virava "última msg · —", que promete uma
                                    informação e entrega um travessão. Quem não tem conversa
                                    tem telefone, e é o que serve para agir. */}
                                {c.ultima_atividade
                                  ? `última msg · ${dataHora(c.ultima_atividade)}`
                                  : `sem conversa · ${c.telefone ?? "sem telefone"}`}''',
     '''                                {/* Sem data isto virava "última msg · —", que promete uma
                                    informação e entrega um travessão. Quem não tem conversa
                                    tem telefone, e é o que serve para agir.

                                    E "sem conversa" era MENTIRA em parte destes cards: o
                                    ramo 1b (§31.3) é gente contatada cuja conversa inteira
                                    está no número escondido. Dizer "91 mensagens no outro
                                    número" troca a linha que engana por uma que informa —
                                    e explica por que o card está em Ociosos, e não em
                                    Prospecção. */}
                                {c.ultima_atividade
                                  ? `última msg · ${dataHora(c.ultima_atividade)}`
                                  : c.msgs_ocultas
                                    ? `${c.msgs_ocultas} mensagens no outro número · ${c.telefone ?? "sem telefone"}`
                                    : `sem conversa · ${c.telefone ?? "sem telefone"}`}''')

# o tipo do card
sub2('  ultimas_mensagens: Msg[] | null; // até 3, mais recente primeiro',
     '''  ultimas_mensagens: Msg[] | null; // até 3, mais recente primeiro
  /** mensagens que existem, mas na linha que a seleção esconde (ramo 1b, §31.3) */
  msgs_ocultas?: number;''')

io.open(p2, 'w', encoding='utf-8', newline='').write(t)
print('card ok')
