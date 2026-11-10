import type { Page, Request, Response } from "@playwright/test";

/**
 * The checkout shows the same "temporarily unavailable" message for a non-2xx
 * answer, a transport failure and a 200 marked `degraded` (TWO-27184). This
 * records which one each company search the page sees while a helper waits, so
 * a dropdown that never appears names its cause. Status, flag, count and
 * country only: never the query string, the typed name or the token.
 */
const SEARCH_URL = /[?&]wc-ajax=two_company_search\b/;

export interface CompanySearchLog {
  lines: string[];
  stop(): void;
  /** The recorded lines, ready to append to an error message. */
  summary(): string;
}

function countryOf(request: Request): string {
  const fromUrl = new URL(request.url()).searchParams.get("country");
  const fromBody = new URLSearchParams(request.postData() || "").get("country");
  return (fromUrl || fromBody || "?").toUpperCase();
}

export function watchCompanySearch(page: Page): CompanySearchLog {
  const lines: string[] = [];
  const record = (line: string) => {
    const entry = `company search: ${line}`;
    lines.push(entry);
    console.log(entry);
  };

  const onResponse = async (response: Response) => {
    if (!SEARCH_URL.test(response.url())) return;
    const country = countryOf(response.request());
    let detail: string;
    try {
      const body = await response.json();
      const count = Array.isArray(body?.items) ? body.items.length : "no items list";
      detail = `degraded=${body?.degraded === true}, results=${count}`;
    } catch {
      detail = "body not JSON";
    }
    record(`HTTP ${response.status()}, ${detail}, country=${country}`);
  };
  const onFailed = (request: Request) => {
    if (!SEARCH_URL.test(request.url())) return;
    record(
      `transport failure "${request.failure()?.errorText ?? "unknown"}", country=${countryOf(request)}`
    );
  };

  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  return {
    lines,
    stop() {
      page.off("response", onResponse);
      page.off("requestfailed", onFailed);
    },
    summary() {
      return lines.length ? lines.join("; ") : "company search: no response seen";
    }
  };
}

/** Rethrows with the recorded searches leading the message, so the first error line names the cause. */
export function explainSearchFailure(log: CompanySearchLog, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const explained = new Error(`no company dropdown row [${log.summary()}]\n${message}`);
  if (error instanceof Error && error.stack)
    explained.stack = `${explained.message}\n${error.stack}`;
  return explained;
}
