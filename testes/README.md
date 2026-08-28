# `testes/` — suíte de QA do CRM Murano

> ## ⚠️ ISTO RODA CONTRA PRODUÇÃO
>
> Não existe ambiente de teste neste projeto. `.env` e `web/.env.local` apontam
> para o **Supabase de produção** e para a **WhatsApp Cloud API de produção**.
> Um `next start` na sua máquina fala com o banco de que 15 pessoas dependem e
> com o número por onde clientes reais conversam.
>
> **O ÚNICO destino autorizado para qualquer mensagem é `91984719702`** (o
> celular do próprio usuário). Use `exigirDestinoAutorizado()` de `ajuda.mjs`
> antes de qualquer caminho que possa enviar.
>
> **Disparo em massa: só prévia.** `POST /api/admin/disparo-massa` com
> `acao: "previa"` não envia nada. Nunca clique/chame o envio.
>
> **Interruptor global que você ligar, você desliga** — use `db.mexerConfig()`,
> que já agenda a restauração.

## Como rodar

```bash
# 1. suba o servidor (uma vez)
cd web && npm run build && npm start        # porta 3100

# 2. rode a suíte
node testes/run.mjs                 # tudo
node testes/run.mjs ciclo1          # só o que casa com o texto
node testes/run.mjs --sem-navegador # pula os casos que abrem Chrome
```

Saída: `testes/saidas/resultado.json` + screenshots `testes/saidas/*.png`.
`testes/saidas/` está no `.gitignore`.

### Subir o servidor com segurança

Suba **sem** `WHATSAPP_TOKEN`. Sem ele nenhuma mensagem consegue sair, aconteça
o que acontecer no teste — é a rede de proteção mais barata que existe:

```bash
# detector de canal funciona, envio é fisicamente impossível
cd web && WHATSAPP_PHONE_NUMBER_ID=1264458800091787 npm start
```

`linhaDeEnvio()` só lê `WHATSAPP_PHONE_NUMBER_ID`; quem envia precisa também do
token. Com o id e sem o token, o alarme de saúde do canal é testável e o envio
falha em "Config ausente".

## Os arquivos

| Arquivo | Papel |
|---|---|
| `db.mjs` | Supabase com service_role, `contar()`, `existe()`, e o **rastro** (tudo que a suíte escreve é removido no fim) |
| `api.mjs` | fetch com cookie de sessão + asserts. O login é cookie de texto puro |
| `driver.mjs` | CDP por WebSocket nativo do Node 24 — **sem puppeteer**. Captura console e exceções |
| `ajuda.mjs` | número autorizado, `tel8`, `modoMigracaoDe`, travas de segurança |
| `run.mjs` | runner: PASSOU / FALHOU / **PULADO com motivo**, e limpa o rastro no fim |
| `casos/` | um arquivo por ciclo |
| `RELATORIO.md` | o laudo da última rodada |

## Sessões

O login é só um cookie (`web/lib/papel.ts`):

| `crm_sessao` | Papel |
|---|---|
| `admin` | vê tudo + as 4 features restritas |
| `home` | vê todas as carteiras, sem as 4 features |
| `romulo` (slug de `carteira_config`) | consultor — vê só a própria carteira |

Use `api.SESSOES.romulo` para o consultor e repita o caminho crítico como
`admin`: a diferença é escopo no servidor, e é ali que este projeto já teve
conversa sumindo de uma rota e aparecendo em outra.

## Escrever um caso

```js
export const ciclo = "Ciclo N — nome";

export default async function (t) {
  await t.passo("1. o que se testa", "✅", async () => {
    //  lançar        = FALHOU
    //  "PULAR:motivo" = PULADO (aparece no placar, não some)
    //  devolver texto = detalhe impresso no relatório
    return "o que foi medido";
  });

  t.pular("2. passo perigoso", "✅", "recusado por segurança: <motivo>");
}
```

O segundo parâmetro é **o que o `casos_de_uso_teste_ciclos.md` promete**
(✅/⚠️/⛔), não o que você espera. É isso que faz o runner distinguir
**regressão** (✅ que falhou) de **documentação velha** (⛔ que passou).

## Armadilhas já pagas — não redescobrir

- **`count` com `head: true` NÃO dá erro para tabela inexistente.** Devolve
  `error: null` e `count: null`; um `?? 0` ali vira zero silencioso. Foi assim
  que a primeira versão de `contar()` jurou que as views da 0114 existiam.
  `contar()` agora lança quando o count é nulo.
- **Em headless sem layout, `innerText` volta VAZIO** mesmo com a página
  renderizada. Meça por `textContent`, `innerHTML.length`, `querySelectorAll`
  ou screenshot.
- **Screenshot decide layout.** Sonda numérica mede o que você lembrou de
  perguntar; a imagem mostra o que está lá.
- **Quando a medição contradiz o código, pergunte ao servidor** (um `curl` na
  rota) antes de acusar o navegador.
- **`.next` não aguenta dois processos.** Nunca rode `next build` com um
  `next start` no ar: dá `ENOENT` em manifesto, erro que não tem nada a ver com
  o código. Mate o servidor, apague `.next`, rode um só.
- **Não confie na sua premissa sobre a régua de negócio.** "Sem dono" não é
  `vw_funil_visivel.vendedor is null` — é `transferência vigente ?? carteira`.
  Essa confusão fez a suíte acusar um defeito que era do teste.
- **A resposta de `/api/admin/disparo-massa` vem aninhada** em `"disparo-massa"`,
  e o público chama-se `selecionados`. Ler a chave errada devolve `undefined` e
  o teste "passa" sem testar nada.
