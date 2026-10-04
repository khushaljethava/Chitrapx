/** Client-side fetch helper for our JSON API. Throws ApiError with the server's code and message. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: Record<string, unknown>) { super(message); }
}

export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issue = data.issues?.[0];
    throw new ApiError(res.status, data.error ?? "error", issue ? `${issue.path?.join(".")}: ${issue.message}` : data.message ?? "Something went wrong", data);
  }
  return data as T;
}
