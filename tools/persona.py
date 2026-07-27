# -*- coding: utf-8 -*-
"""Raio-X de personalidade dos vendedores a partir das mensagens (murano-conversas).
Le mensagens via REST, analisa estilo/gatilhos/situacoes com trechos reais e grava em bic_persona."""
import json, re, urllib.request, urllib.parse
from collections import defaultdict, Counter
from pathlib import Path

ENV = Path(r"C:\romulo\rd-conversas-etl\.env")
env = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = env["SUPABASE_URL"].rstrip("/"); KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
HDRS = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def fetch_all(table, select, extra=""):
    rows, off = [], 0
    while True:
        q = f"{URL}/rest/v1/{table}?select={urllib.parse.quote(select)}{extra}&order=id&limit=1000&offset={off}"
        with urllib.request.urlopen(urllib.request.Request(q, headers=HDRS)) as r:
            b = json.loads(r.read().decode("utf-8"))
        rows.extend(b)
        if len(b) < 1000: break
        off += 1000
    return rows

print("baixando mensagens...", flush=True)
msgs = fetch_all("mensagens", "cliente_id,vendedor_carteira,enviada_por,tipo,conteudo,criada_em", "&tipo=neq.evento_sistema")
print(f"{len(msgs)} mensagens", flush=True)

# resposta mediana por carteira (do BI ja calculado)
q = f"{URL}/rest/v1/bic_vendedor?select=carteira,resposta_mediana_min,pct_template_resp_48h,pct_conversao_7d&janela=eq.tudo"
with urllib.request.urlopen(urllib.request.Request(q, headers=HDRS)) as r:
    bv = {x["carteira"]: x for x in json.loads(r.read().decode("utf-8"))}

PREFIX = re.compile(r"^\*(?:Atendente:?\s*-*\s*)?([^:*]+):\*\s*\n?", re.S)
CTRL = re.compile(r"[\u0000-\u001f\u007f-\u009f\ufffd\ue000-\uf8ff]")
AUTOREPLY = re.compile(r"agradece seu contato|n[aã]o estamos dispon|estou indispon|responderemos assim|mensagem autom", re.I)

def clean(t):
    t = CTRL.sub(" ", t or "")
    t = re.sub(r"\s+", " ", t).strip()
    return t

GATILHOS = {
    "urgencia":      (r"somente hoje|s[óo] hoje|[úu]ltim[oa]s?\b|acaba (hoje|amanh)|rel[âa]mpago|corre[rm]?\b|aproveita (hoje|agora)", "Urgência"),
    "escassez":      (r"poucas unidades|estoque (baixo|acabando|limitado)|restam \d|quase esgotad|[úu]ltimas? (pe[çc]as|unidades)", "Escassez"),
    "exclusividade": (r"exclusiv|primeira m[ãa]o|s[óo] (pra|para) (voc[êe]|vc)|especial (pra|para)|vip\b|selecionad", "Exclusividade"),
    "prova_social":  (r"mais vendido|queridinh|todo mundo|clientes? (est[ãa]o|t[ãa]o|amara)|sucesso de vendas|sa[íi]ndo muito", "Prova social"),
    "bonus":         (r"brinde|b[ôo]nus|gr[áa]tis|gratuito|de presente|ganha (um|uma)\b", "Bônus/Brinde"),
    "novidade":      (r"novidade|lan[çc]amento|acabou de chegar|chegou (agora|essa semana)|rec[ée]m", "Novidade"),
    "preco_oferta":  (r"promo[çc][ãa]o|oferta|desconto|baixou|pre[çc]o especial|condi[çc][ãa]o (especial|exclusiva)", "Promoção/Desconto"),
}
SITUACOES = {
    "preco":     r"quanto (custa|fica|sai|[ée]|ta|t[áa])|qual (o )?valor|pre[çc]o|me passa o valor",
    "objecao":   r"\bcaro\b|sem dinheiro|sem condi|depois eu|mais tarde|semana que vem|m[êe]s que vem|pr[óo]xima (semana|vez)|quando (tiver|puder|der)|por enquanto n[ãa]o|n[ãa]o vou (querer|pegar|comprar)|ainda n[ãa]o|to sem|t[ôo] sem",
    "intencao":  r"\bquero\b|vou querer|pode separar|separa (pra|para) mim|manda (pra|para) mim|fecha(r)? (o )?pedido",
}
CARINHO = re.compile(r"\bquerida?\b|\bamor\b|\bamiga?\b|\bflor\b|\blinda\b|\bdona\b", re.I)
FECHA = re.compile(r"fechar (o )?pedido|posso separar|vou (montar|separar|mandar)|finalizar (o )?pedido|vamos fechar", re.I)
INFORMAL = re.compile(r"\bvc\b|\bpra\b|\bta\b|\bt[ôo]\b|\bnum\b|\bmulher\b|kk+|rsrs", re.I)

STOP = set("""a o e é de da do das dos em no na nos nas um uma uns umas que com por para pra pro os as ao aos à às
se sua seu suas seus meu minha meus minhas isso essa esse este esta isto aquele aquela nao não sim ja já so só
eu tu ele ela nos nós vos eles elas voce você vc te me lhe mais menos muito pouco bem mal como quando onde qual
quais quem cujo tambem também mas ou porem porém então entao ate até la lá aqui ali depois antes hoje amanha amanhã
ontem agora ta tá tô estou esta está estão estao ser ter vai vou foi era sao são tem tinha tudo nada algo cada
dia dias boa bom boas bons tarde noite obrigada obrigado obg valeu ok oi olá ola tudo pode ver fica sai vem
ficou seja sendo pois assim ainda vez vezes coisa coisas dela dele nesse nessa desse dessa deste desta""".split())
URLRE = re.compile(r"https?://\S+", re.I)

def norm_words(t):
    t = re.sub(r"[^a-zà-ú0-9\s]", " ", t.lower())
    return [w for w in t.split() if len(w) > 2 and not w.isdigit()]

# agrupar por cliente para capturar pares situacao->resposta
por_cliente = defaultdict(list)
for m in msgs:
    m["_txt"] = clean(PREFIX.sub("", m.get("conteudo") or ""))
    por_cliente[m["cliente_id"]].append(m)
for seq in por_cliente.values():
    seq.sort(key=lambda x: x["criada_em"])

def add_exemplo(lst, texto, maxn=3, lo=25, hi=230):
    t = texto.strip()
    if not (lo <= len(t) <= hi): return
    if any(t[:40] == e[:40] for e in lst): return
    if len(lst) < maxn: lst.append(t)

stats = defaultdict(lambda: {
    "op_msgs": 0, "carinho": 0, "perguntas": 0, "fecha": 0, "informal": 0, "exclama": 0,
    "len_soma": 0, "gat": Counter(), "gat_ex": defaultdict(list),
    "sit_n": Counter(), "sit_ex": defaultdict(list), "carinho_ex": [], "fecha_ex": [],
    "words": Counter(), "ngrams": Counter(), "fullmsg": Counter(), "fullmsg_orig": {},
})

for cid, seq in por_cliente.items():
    for i, m in enumerate(seq):
        cart = m.get("vendedor_carteira") or "sem_carteira"
        s = stats[cart]
        txt = m["_txt"]
        if m["enviada_por"] == "operator" and m["tipo"] == "mensagem":
            if not txt: continue
            s["op_msgs"] += 1; s["len_soma"] += len(txt)
            if "?" in txt: s["perguntas"] += 1
            if "!" in txt: s["exclama"] += 1
            if CARINHO.search(txt): s["carinho"] += 1; add_exemplo(s["carinho_ex"], txt)
            if FECHA.search(txt): s["fecha"] += 1; add_exemplo(s["fecha_ex"], txt)
            if INFORMAL.search(txt): s["informal"] += 1
            for g, (pat, _) in GATILHOS.items():
                if re.search(pat, txt, re.I):
                    s["gat"][g] += 1; add_exemplo(s["gat_ex"][g], txt)
            # vocabulario: palavras, expressoes (bi/trigramas) e frases prontas (msgs repetidas)
            ws = norm_words(txt)
            for w in ws:
                if w not in STOP: s["words"][w] += 1
            for n in (2, 3):
                for i2 in range(len(ws) - n + 1):
                    gr = ws[i2:i2+n]
                    if all(w in STOP for w in gr): continue
                    s["ngrams"][" ".join(gr)] += 1
            if 15 <= len(txt) <= 130 and not URLRE.search(txt):
                key = re.sub(r"\s+", " ", txt.lower()).strip()
                s["fullmsg"][key] += 1
                s["fullmsg_orig"].setdefault(key, txt)
        elif m["enviada_por"] == "customer" and m["tipo"] == "mensagem":
            if not txt or AUTOREPLY.search(txt): continue
            for sit, pat in SITUACOES.items():
                if re.search(pat, txt, re.I):
                    s["sit_n"][sit] += 1
                    # resposta do operador em ate 24h
                    for m2 in seq[i+1:i+8]:
                        if m2["enviada_por"] == "operator" and m2["tipo"] == "mensagem" and m2["_txt"]:
                            if (len(s["sit_ex"][sit]) < 3 and 10 <= len(txt) <= 170
                                and 20 <= len(m2["_txt"]) <= 260
                                and not any(txt[:35] == e["cliente"][:35] for e in s["sit_ex"][sit])):
                                s["sit_ex"][sit].append({"cliente": txt, "resposta": m2["_txt"]})
                            break
                    break

CARTEIRAS = ["anne","kamilly","luana","milene","romulo","thamires","thiago"]
NOMES = {"anne":"Anne","kamilly":"Kamilly","luana":"Luana","milene":"Milene","romulo":"Romulo","thamires":"Thamires","thiago":"Thiago"}

def pct(s, k): return round(100*s[k]/max(s["op_msgs"],1), 1)
def pctg(s, g): return round(100*s["gat"][g]/max(s["op_msgs"],1), 1)

# eixos
eixos_raw = {}
for c in CARTEIRAS:
    s = stats[c]
    oferta = sum(s["gat"][g] for g in GATILHOS)
    eixos_raw[c] = {
        "calor": pct(s, "carinho"),
        "consultivo": pct(s, "perguntas"),
        "oferta": round(100*oferta/max(s["op_msgs"],1),1),
        "fechamento": pct(s, "fecha"),
        "agilidade": -(float(bv.get(c,{}).get("resposta_mediana_min") or 99)),
    }
media_eixo = {e: round(sum(eixos_raw[c][e] for c in CARTEIRAS)/len(CARTEIRAS),1) for e in ["calor","consultivo","oferta","fechamento"]}

ARQ = {
    "calor":      ("Perfil Relacional Próximo", "constrói venda pela relação: trata o cliente como amigo, cria confiança antes da oferta"),
    "consultivo": ("Perfil Consultivo Investigativo", "vende perguntando: entende a necessidade antes de ofertar"),
    "oferta":     ("Perfil Promotor de Ofertas", "movimenta a carteira com promoções, novidades e condições"),
    "fechamento": ("Perfil Fechador Direto", "conduz a conversa para o pedido: chama para fechar sem rodeios"),
    "agilidade":  ("Perfil Ágil de Resposta", "ganha o cliente pela velocidade: responde quase instantaneamente"),
}
SUGESTAO = {
    "calor": "aumentar a proximidade no tratamento (nome do cliente, 'amiga', tom pessoal) — é o traço nº1 de quem mais converte",
    "consultivo": "fazer mais perguntas de necessidade antes da oferta (cabelo, serviço, público do salão)",
    "oferta": "usar mais gatilhos de oferta (novidade, condição, kit) para gerar motivo de compra",
    "fechamento": "usar convite explícito de fechamento ('posso separar?', 'vamos fechar o pedido?') — hoje quase não aparece",
    "agilidade": "reduzir o tempo de resposta nas janelas de pico (9-11h e 14-17h)",
}

out_rows = []
for c in CARTEIRAS:
    s = stats[c]
    ex = eixos_raw[c]
    ordem = sorted(["calor","consultivo","oferta","fechamento","agilidade"],
                   key=lambda e: -(ex[e] if e != "agilidade" else 0) if e != "agilidade" else 0)
    # rank agilidade: melhor resposta = mais alto; normaliza por ranking entre carteiras
    ranks = {}
    for e in ["calor","consultivo","oferta","fechamento","agilidade"]:
        vals = sorted(CARTEIRAS, key=lambda k: -eixos_raw[k][e])
        ranks[e] = vals.index(c) + 1
    top2 = sorted(ranks, key=lambda e: ranks[e])[:2]
    bot2 = sorted(ranks, key=lambda e: -ranks[e])[:2]
    arq_nome, arq_desc = ARQ[top2[0]]
    resp_min = bv.get(c,{}).get("resposta_mediana_min")
    conv = bv.get(c,{}).get("pct_conversao_7d")

    descricao = (
        f"{NOMES[c]} atende com {s['op_msgs']} mensagens analisadas. "
        f"{arq_desc.capitalize()}. "
        f"Usa tratamento próximo em {pct(s,'carinho')}% das mensagens (média da equipe: {media_eixo['calor']}%), "
        f"faz perguntas em {pct(s,'perguntas')}% (média {media_eixo['consultivo']}%), "
        f"aciona gatilhos de oferta em {ex['oferta']}% (média {media_eixo['oferta']}%) "
        f"e convida para fechar em {pct(s,'fecha')}% (média {media_eixo['fechamento']}%). "
        f"Responde o cliente em {resp_min} min (mediana) e converte {conv}% dos contatos em venda em 7 dias."
    )
    caracteristicas = [
        f"Tom {'informal e caloroso' if pct(s,'informal')>30 and pct(s,'carinho')>media_eixo['calor'] else 'informal' if pct(s,'informal')>30 else 'mais formal e objetivo'} ({pct(s,'informal')}% das msgs com linguagem coloquial)",
        f"Mensagens {'curtas e diretas' if s['len_soma']/max(s['op_msgs'],1)<40 else 'médias' if s['len_soma']/max(s['op_msgs'],1)<70 else 'longas e detalhadas'} (média {round(s['len_soma']/max(s['op_msgs'],1))} caracteres)",
        f"Usa exclamação em {pct(s,'exclama')}% das mensagens" ,
        f"Gatilho favorito: {GATILHOS[s['gat'].most_common(1)[0][0]][1] if s['gat'] else '—'} ({pctg(s, s['gat'].most_common(1)[0][0]) if s['gat'] else 0}% das msgs)",
        f"Lidou com {s['sit_n']['preco']} perguntas de preço, {s['sit_n']['objecao']} objeções/adiamentos e {s['sit_n']['intencao']} sinais de compra no período",
    ]
    gat_out = {}
    for g,(pat,label) in GATILHOS.items():
        gat_out[g] = {"label": label, "pct": pctg(s,g), "media": round(sum(pctg(stats[k],g) for k in CARTEIRAS)/len(CARTEIRAS),1), "exemplos": s["gat_ex"][g]}

    top_palavras = [{"w": w, "n": n} for w, n in s["words"].most_common(22)]
    expressoes = []
    for gr, n in s["ngrams"].most_common(80):
        if n < 4: break
        if any(gr in sel["t"] or sel["t"] in gr for sel in expressoes): continue
        expressoes.append({"t": gr, "n": n})
        if len(expressoes) >= 8: break
    frases_prontas = [{"t": s["fullmsg_orig"][k], "n": n}
                      for k, n in s["fullmsg"].most_common(30) if n >= 3][:6]
    persona = {
        "nome": NOMES[c],
        "operador": None,
        "arquetipo": arq_nome,
        "tagline": f"{ARQ[top2[0]][1].capitalize()} — com {ARQ[top2[1]][0].split('Perfil ')[1].lower()} como segunda marca.",
        "descricao": descricao,
        "caracteristicas": caracteristicas,
        "eixos": {"calor": ex["calor"], "consultivo": ex["consultivo"], "oferta": ex["oferta"], "fechamento": ex["fechamento"]},
        "eixos_media": media_eixo,
        "gatilhos": gat_out,
        "situacoes": {
            "preco":   {"n": s["sit_n"]["preco"],   "exemplos": s["sit_ex"]["preco"]},
            "objecao": {"n": s["sit_n"]["objecao"], "exemplos": s["sit_ex"]["objecao"]},
            "intencao":{"n": s["sit_n"]["intencao"],"exemplos": s["sit_ex"]["intencao"]},
        },
        "carinho_exemplos": s["carinho_ex"],
        "fechamento_exemplos": s["fecha_ex"],
        "top_palavras": top_palavras,
        "expressoes": expressoes,
        "frases_prontas": frases_prontas,
        "pontos_fortes": [f"{ARQ[e][0].replace('Perfil ','')}: {ARQ[e][1]}" for e in top2],
        "desenvolver": [SUGESTAO[e] for e in bot2],
        "metricas": {"msgs": s["op_msgs"], "resposta_min": resp_min, "conversao_7d": conv,
                     "len_media": round(s["len_soma"]/max(s["op_msgs"],1)),
                     "pct_informal": pct(s,"informal"), "pct_exclama": pct(s,"exclama")},
    }
    out_rows.append({"carteira": c, "persona": persona})

# upsert
body = json.dumps(out_rows, ensure_ascii=False).encode("utf-8")
req = urllib.request.Request(f"{URL}/rest/v1/bic_persona", data=body, method="POST",
    headers={**HDRS, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"})
with urllib.request.urlopen(req) as r:
    print("upsert status", r.status)

for row in out_rows:
    p = row["persona"]
    print(f"\n=== {p['nome']} — {p['arquetipo']} ===")
    print(" ", p["tagline"])
    print("  eixos:", p["eixos"], "| situacoes:", {k: v['n'] for k,v in p['situacoes'].items()})
    for k, v in p["gatilhos"].items():
        if v["exemplos"]: print(f"  [{v['label']} {v['pct']}%] ex: {v['exemplos'][0][:90]}")
    for sit in ["preco","objecao","intencao"]:
        exs = p["situacoes"][sit]["exemplos"]
        if exs: print(f"  ({sit}) C: {exs[0]['cliente'][:70]} | R: {exs[0]['resposta'][:80]}")
