import { ZodError } from "zod";
import { InsufficientCreditsError } from "@chitrapx/db";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: Record<string, unknown>) { super(message ?? code); }
}

/** Optimistic-concurrency failure: carries the revision the client must rebase on. */
export class ConflictError extends HttpError {
  constructor(public current: number) { super(409, "conflict", "This project changed in another tab or by someone else", { current }); }
}
export const notFound = () => new HttpError(404, "not_found");
export const badRequest = (code: string) => new HttpError(400, code);

/** Wraps a route handler: returns JSON, maps known errors to status codes, hides the rest. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A): Promise<Response> => {
    try {
      const result = await fn(...args);
      return result instanceof Response ? result : Response.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.code, message: err.message, ...err.details }, { status: err.status });
      if (err instanceof ZodError) return Response.json({ error: "invalid_input", issues: err.issues }, { status: 400 });
      if (err instanceof InsufficientCreditsError) return Response.json({ error: "insufficient_credits" }, { status: 402 });
      console.error(err);
      return Response.json({ error: "internal" }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { throw badRequest("invalid_json"); }
}

/** Reads at most `maxBytes` of the body (whatever Content-Length claims), then parses it as JSON. */
export async function readJsonLimited(req: Request, maxBytes: number): Promise<unknown> {
  const text = await readTextLimited(req, maxBytes, "This project is too large to save");
  try { return JSON.parse(text); } catch { throw badRequest("invalid_json"); }
}

/** Reads at most `maxBytes` of the body as UTF-8 text, whatever Content-Length claims. */
export async function readTextLimited(req: Request, maxBytes: number, tooLarge = "Request too large"): Promise<string> {
  if (!req.body) throw badRequest("invalid_json");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, "too_large", tooLarge); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
