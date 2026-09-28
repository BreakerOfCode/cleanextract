/** Dependency-free client for the hosted CleanExtract REST endpoint. */

export interface ExecuteOptions {
  urlOrHtml: string;
  paymentSignature?: string;
  sections?: string[];
}

export interface OutlineResponse {
  status: "ok";
  title: string;
  total_bytes: number;
  fingerprint: string;
  sections: Array<{ id: string; level: number; heading: string; bytes: number }>;
  fallback_used?: "json_ld" | "next_data" | "nuxt_data";
}

export type FailureStatus = "upstream_timeout" | "upstream_http_error" | "bot_challenge" | "js_shell" | "empty_extraction" | "sections_not_found";

export class CleanExtractFailure extends Error {
  readonly charged = false;
  constructor(readonly status: FailureStatus, readonly reason: string, readonly httpStatus: number, readonly details: Record<string, unknown>) {
    super(`${status}: ${reason}`);
    this.name = "CleanExtractFailure";
  }
}

const failureStatuses = new Set<FailureStatus>(["upstream_timeout", "upstream_http_error", "bot_challenge", "js_shell", "empty_extraction", "sections_not_found"]);

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

  private async post<T>(path: string, payload: string, paymentSignature?: string): Promise<ExecuteResult<T>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (paymentSignature) headers["PAYMENT-SIGNATURE"] = paymentSignature;
    const response = await fetch(`${this.baseUrl}${path}`, { method: "POST", headers, body: payload });
    const payload = await response.json() as Record<string, unknown>;
    const status = payload.status;
    if (!response.ok && typeof status === "string" && failureStatuses.has(status as FailureStatus)) {
      throw new CleanExtractFailure(status as FailureStatus, String(payload.reason ?? ""), response.status, payload);
    }
    return { status: response.status, body: payload as T,
      paymentRequired: response.headers.get("PAYMENT-REQUIRED"), paymentResponse: response.headers.get("PAYMENT-RESPONSE") };
  }

  async outline(urlOrHtml: string): Promise<OutlineResponse> {
    const result = await this.post<OutlineResponse>("/v1/outline", JSON.stringify({ url_or_html: urlOrHtml }));
    if (result.status !== 200) throw new Error(`CleanExtract outline HTTP ${result.status}`);
    return result.body;
  }

  async execute<T = unknown>(options: ExecuteOptions): Promise<ExecuteResult<T>> {
    const payload = options.sections
      ? JSON.stringify({ url_or_html: options.urlOrHtml, sections: options.sections })
      : JSON.stringify({ url_or_html: options.urlOrHtml });
    return this.post<T>("/v1/execute", payload, options.paymentSignature);
  }
}
