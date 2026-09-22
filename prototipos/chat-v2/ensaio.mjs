// Um cliente de ENSAIO para exercitar o envio do chat-v2 sem tocar em ninguém
// de verdade.
//
//   node prototipos/chat-v2/ensaio.mjs criar     -> cria o contato + uma mensagem dela
//   node prototipos/chat-v2/ensaio.mjs limpar    -> apaga tudo o que o ensaio criou
//   node prototipos/chat-v2/ensaio.mjs ver       -> mostra a conversa como está
//
// ⚠️ A faixa 55 91 9 0000-00NN é reservada (web/lib/ensaio.ts): nenhuma tela a
// mostra sem ENSAIO_VISIVEL=1 / SIMULACAO_ENVIO=1, e nenhuma mensagem para ela
// sai para a Meta, aconteça o que acontecer. Foi criada depois de 10/09/2026,
// quando clientes falsos ficaram meia hora na sidebar dos consultores.
import { sb } from "../../testes/db.mjs";

const TEL = "5591900000" + "77";
const ID = `wa:${TEL}`;
const LINHA = process.env.WHATSAPP_PHONE_NUMBER_ID || "1267537293116190";
const cmd = process.argv[2] ?? "ver";

if (cmd === "criar") {
  await sb.from("clientes").upsert(
    {
      id: ID,
      nome_completo: "ENSAIO chat-v2 (não é cliente)",
      telefone: TEL,
      carteira: null,
    },
    { onConflict: "id" },
  );
  // uma mensagem DELA, agora: é o que abre a janela de 24h e põe a conversa
  // no topo da lista
  const { error } = await sb.from("mensagens").upsert(
    {
      id: `ensaio.${Date.now()}`,
      cliente_id: ID,
      enviada_por: "customer",
      tipo: "mensagem",
      conteudo: "Oi! Esta é uma conversa de ensaio do chat-v2.",
      status: "success",
      criada_em: new Date().toISOString(),
      linha_id: LINHA,
    },
    { onConflict: "id" },
  );
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`criado: ${ID}`);
} else if (cmd === "limpar") {
  const m = await sb.from("mensagens").delete().eq("cliente_id", ID);
  const c = await sb.from("clientes").delete().eq("id", ID);
  console.log("mensagens apagadas:", m.error?.message ?? "ok", "| cliente:", c.error?.message ?? "ok");
} else {
  const { data } = await sb
    .from("mensagens")
    .select("id,enviada_por,tipo,conteudo,status,erro,criada_em")
    .eq("cliente_id", ID)
    .order("criada_em");
  console.log(`conversa ${ID}: ${data?.length ?? 0} mensagens`);
  for (const m of data ?? []) {
    console.log(
      `  ${m.criada_em.slice(11, 19)} ${String(m.enviada_por).padEnd(8)} ${String(m.status).padEnd(8)} ${String(m.id).slice(0, 18).padEnd(19)} ${String(m.conteudo ?? "").slice(0, 50)}${m.erro ? " | erro: " + m.erro : ""}`,
    );
  }
}
process.exit(0);
