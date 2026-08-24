/* Service worker do Murano Chat.
 *
 * ---------------------------------------------------------------------------
 * O QUE ELE NÃO FAZ, DE PROPÓSITO: cache.
 *
 * O reflexo ao escrever um service worker é cachear as telas para abrir
 * offline. Aqui isso seria um bug com cara de recurso: toda página do CRM é
 * `force-dynamic` e depende do cookie `crm_sessao`. Uma resposta guardada em
 * cache mostraria a lista de conversas de quem logou antes, ou uma tela de
 * sessão expirada que não expira nunca — e o vendedor não teria como saber que
 * está lendo algo velho. Num app de atendimento, dado velho é pior que a tela
 * de "sem conexão" que o navegador já sabe mostrar.
 *
 * Então este arquivo existe por UM motivo: receber push com o app fechado.
 * É a única coisa que a página não consegue fazer sozinha.
 * ---------------------------------------------------------------------------
 */

// Assume o controle sem esperar a aba antiga fechar. Sem isto, uma correção no
// handler de push só valeria depois que a pessoa fechasse todas as abas — e
// ninguém fecha.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  // O corpo é enviado pelo nosso endpoint. Se vier vazio ou malformado, ainda
  // assim avisamos: uma notificação genérica é melhor que silêncio — o push
  // chegou porque alguma cliente falou.
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }

  const titulo = d.titulo || "Nova mensagem";
  const opcoes = {
    body: d.corpo || "Você recebeu uma mensagem no chat.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-maskable-192.png",
    lang: "pt-BR",
    // agrupa por conversa: cinco mensagens seguidas da mesma cliente viram uma
    // notificação que se atualiza, não cinco empilhadas
    tag: d.cliente_id ? `chat:${d.cliente_id}` : "chat",
    renotify: true,
    timestamp: Date.now(),
    data: { url: d.url || "/chat" },
  };
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const alvo = event.notification.data?.url || "/chat";

  // Reaproveita uma janela já aberta em vez de abrir outra. Sem isto, quem
  // deixa o chat aberto no celular acumula uma instância por notificação.
  event.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const aba of abas) {
      if (aba.url.includes("/chat")) {
        await aba.focus();
        // leva para a conversa certa mesmo com o app já aberto em outra
        if ("navigate" in aba) { try { await aba.navigate(alvo); } catch { /* mesma origem, ignora */ } }
        return;
      }
    }
    await self.clients.openWindow(alvo);
  })());
});
