export interface RdConversasClientOptions {
  token: string;
  baseUrl: string;
}

export type QueryParams = Record<string, string | number | undefined>;

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
  constructor(private readonly options: RdConversasClientOptions) {}

  async get<T = unknown>(path: string, params: QueryParams = {}): Promise<T> {
    const url = new URL(path, this.options.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        Accept: "application/json",
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new RdConversasApiError(response.status, url.toString(), text);
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }
}
