// Utilidades compartilhadas pelos casos. O que for regra de negócio replicada
// aqui vem com a referência ao arquivo do app que a implementa — se as duas
// divergirem, o teste tem de falhar, não acompanhar.

/** O número autorizado a receber QUALQUER mensagem nesta suíte. §0. */
export const NUMERO_AUTORIZADO = "91984719702";
/** O mesmo, no formato E.164 que a Meta usa. */
export const NUMERO_AUTORIZADO_E164 = "5591984719702";
/** Últimos 8 dígitos — a chave de casamento do webhook e do ETL (§16.3). */
export const TEL8_AUTORIZADO = "84719702";

/** Espelha `modoMigracao()` de web/lib/crmConfig.ts, sobre a linha crua. */
export function modoMigracaoDe(c) {
  if (!c) return false;
  const linhas = Array.isArray(c.linhas_visiveis) ? c.linhas_visiveis : null;
  const semRd = linhas ? !linhas.includes("rd") : false;
  return c.carteira_rd_ativa === false && c.historico_rd === false && c.numero_envio === "cloud" && semRd;
}

/** Só dígitos. */
export const so = (s) => String(s ?? "").replace(/\D+/g, "");

/** Os últimos 8 dígitos, a chave usada em todo o projeto para casar telefone. */
export const tel8 = (s) => so(s).slice(-8);

/**
 * Um destino é o número autorizado?
 *
 * ⚠️ Compara por tel8 porque o RD guarda 12 dígitos (sem o nono) e a Meta manda
 * 13 (§16.3) — comparar a string inteira deixaria passar o mesmo número escrito
 * de outro jeito, e o ponto desta função é justamente não errar isso.
 */
export const ehAutorizado = (numero) => tel8(numero) === TEL8_AUTORIZADO;

/** Trava dura: usar antes de QUALQUER caminho que possa enviar. */
export function exigirDestinoAutorizado(numero, oque = "envio") {
  if (!ehAutorizado(numero)) {
    throw new Error(
      `BLOQUEADO pela suíte: ${oque} para ${numero}. O único destino autorizado é ${NUMERO_AUTORIZADO}. ` +
      `Todo o resto da base são clientes reais.`,
    );
  }
  return true;
}

export const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Data ISO de N dias atrás. */
export const diasAtras = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Formata número com separador de milhar, para o relatório ficar legível. */
export const num = (n) => new Intl.NumberFormat("pt-BR").format(n);
