/** Dependency-free client for the hosted CleanExtract REST endpoint. */

export interface ExecuteOptions {
  urlOrHtml: string;
  paymentSignature?: string;
}

export interface ExecuteResult<T = unknown> {
  status: number;
  body: T;
  paymentRequired: string | null;
  paymentResponse: string | null;
}

export class CleanExtractClient {
  private readonly baseUrl: string;

  constructor(baseUrl = "https://extract.getstringer.app") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async execute<T = unknown>(options: ExecuteOptions): Promise<ExecuteResult<T>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.paymentSignature) {
      headers["PAYMENT-SIGNATURE"] = options.paymentSignature;
    }

    const response = await fetch(`${this.baseUrl}/v1/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url_or_html: options.urlOrHtml }),
    });

    return {
      status: response.status,
      body: (await response.json()) as T,
      paymentRequired: response.headers.get("PAYMENT-REQUIRED"),
      paymentResponse: response.headers.get("PAYMENT-RESPONSE"),
    };
  }
}
