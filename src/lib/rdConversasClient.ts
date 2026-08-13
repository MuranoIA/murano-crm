export interface RdConversasClientOptions {
  token: string;
  baseUrl: string;
}

/** Valor array vira parâmetro REPETIDO (`type=a&type=b`). É a única forma que o RD
 *  aceita para os arrays documentados (`type`, `sent_by`, `channel`): a lista separada
 *  por vírgula devolve ZERO mensagens, sem erro — falha silenciosa (medido 12/08/2026). */
export type QueryParams = Record<string, string | number | Array<string | number> | undefined>;

export class RdConversasApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`RD Conversas API respondeu ${status} em ${path}: ${body}`);
  }
}

export class RdConversasClient {
  private readonly token: string;
  constructor(private readonly options: RdConversasClientOptions) {
    // remove caracteres inválidos para header (ex: "•" colado por engano no .env/secret)
    this.token = String(options.token ?? "").replace(/[^\x21-\x7E]/g, "");
  }

  async get<T = unknown>(path: string, params: QueryParams = {}): Promise<T> {
    const url = new URL(path, this.options.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, String(v));
      else url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new RdConversasApiError(response.status, url.toString(), text);
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const url = new URL(path, this.options.baseUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new RdConversasApiError(response.status, url.toString(), text);
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }
}
