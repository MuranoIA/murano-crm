# APK do Murano Chat

APK instalável, **fora da Play Store**, que abre o chat em tela cheia e recebe
notificação com o app fechado.

## Por que TWA e não Capacitor

O `murano-app` usa **Capacitor**, e o reflexo seria repetir. Para este app seria
o caminho errado, por dois motivos que só aparecem depois de construir:

| | Capacitor | TWA (Bubblewrap) |
|---|---|---|
| Motor | Android System **WebView** | **Chrome** do aparelho |
| Web Push | **não existe** — precisaria FCM nativo e um segundo caminho de envio | funciona: é o mesmo push do navegador |
| Login Google | recusado com `disallowed_useragent` — o Google bloqueia OAuth em WebView | funciona, é o Chrome de verdade |
| Câmera / microfone | precisa de permissão no manifesto **e** de handler no WebView | herda as permissões do Chrome |
| APK sem Play Store | sim | sim |

Como o CRM só tem "Entrar com Google" (o login por senha foi desativado em
31/07/2026) e o push é o principal motivo do app, o Capacitor exigiria refazer
as duas coisas. O README do próprio hub já aponta o Bubblewrap como alternativa.

O que o TWA **não** dá: APIs nativas (contatos, bluetooth, arquivos do sistema).
Nada disso está no horizonte deste app.

## Pré-requisitos

- **Node 18+** (já temos)
- **JDK 17** e **Android SDK build-tools** — o Bubblewrap baixa os dois na
  primeira execução se você deixar (~1,5 GB). Nesta máquina **não estão
  instalados**, verificado em 24/08/2026.

## Passo a passo

```bash
npm i -g @bubblewrap/cli

cd apk
bubblewrap init --manifest https://crm.muranoprofessional.com.br/manifest.webmanifest
# responda com os valores de twa-manifest.json (ele já está preenchido:
# packageId br.com.muranoprofessional.chat, startUrl /chat, cores da marca)

bubblewrap build      # gera app-release-signed.apk e o fingerprint
```

O `init` cria o **keystore** (`android.keystore`). Ele é a identidade do app:

> **Perder o keystore significa não conseguir mais atualizar o app instalado.**
> Quem tiver a versão antiga precisará desinstalar e instalar de novo, perdendo
> o estado. Guarde-o no gerenciador de senhas junto com a senha, no mesmo lugar
> das chaves VAPID. Este arquivo **não** entra no git (ver `.gitignore`).

## O passo que todo mundo esquece: `assetlinks.json`

Sem ele o app abre **com a barra de endereço do Chrome em cima** — parece um
navegador disfarçado, não um app. É o Digital Asset Links: o domínio declarando
que aquele APK pode falar por ele.

Pegue o fingerprint:

```bash
bubblewrap fingerprint list
```

E crie `web/public/.well-known/assetlinks.json`:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "br.com.muranoprofessional.chat",
    "sha256_cert_fingerprints": ["<o fingerprint SHA-256 daqui>"]
  }
}]
```

O fingerprint **é público** — pode ser commitado sem problema. O que não pode
sair daqui é o keystore e a senha dele.

Depois do deploy, confira que `https://crm.muranoprofessional.com.br/.well-known/assetlinks.json`
responde antes de instalar o APK. A verificação acontece na **instalação**: se o
arquivo não estiver no ar naquele momento, a barra aparece e só some
reinstalando.

## Distribuição

O `.apk` assinado vai por link, WhatsApp ou MDM. No aparelho é preciso permitir
"instalar de fontes desconhecidas" para o app que está abrindo o arquivo.

## Antes de gerar o APK, confira

1. `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` na Vercel — sem
   elas o botão de notificação nem aparece.
2. O botão **🔔 Ativar avisos** no topo da lista de conversas funcionando **no
   Chrome do celular**, instalado pela tela inicial. Se não funcionar como PWA,
   não vai funcionar no APK: é o mesmo motor.
3. `/.well-known/assetlinks.json` no ar.

A ordem importa. O APK é a última casca; se o PWA não estiver redondo, o APK só
empacota o problema.
