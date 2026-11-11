import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { FatalJobError } from "../runJob.ts";

/** Fast vision and translation; judgment and copywriting. Served by geminiModel; anthropicModel takes claude-* ids.
 * ponytail: writer on Flash-Lite to save cost; move it to gemini-3.8-flash if copy quality falls short. */
export const MODELS = { fast: "gemini-3.5-flash-lite", writer: "gemini-3.5-flash-lite" } as const;
export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export type Usage = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number };

export type StructuredRequest<T> = {
  model: ModelId;
  /** Task instructions. */
  system: string;
  /** Large, stable context (the template catalog) cached across requests. Goes after `system`. */
  cachedContext?: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Anthropic only (Sonnet); Gemini ignores it. */
  effort?: "low" | "medium" | "high";
};

export interface StructuredModel {
  generate<T>(req: StructuredRequest<T>): Promise<{ data: T; usage: Usage }>;
}

/** Production client. The SDK retries 429/5xx/connection errors twice; pg-boss retries the job after that. */
export function anthropicModel(client = new Anthropic()): StructuredModel {
  return {
    async generate<T>(req: StructuredRequest<T>) {
      const isWriter = req.model === MODELS.writer;
      const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: req.system }];
      if (req.cachedContext) system.push({ type: "text", text: req.cachedContext, cache_control: { type: "ephemeral" } });
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await client.beta.messages.create({
          model: req.model,
          max_tokens: req.maxTokens ?? 16000,
          system,
          messages: [{ role: "user", content: req.content }],
          output_config: { format: betaZodOutputFormat(req.schema), ...(isWriter && req.effort ? { effort: req.effort } : {}) },
          // Refusals on Sonnet 5.5 are re-run server-side on Anthropic's recommended fallback model.
          ...(isWriter ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        });
      } catch (err) {
        const deterministic = err instanceof Anthropic.BadRequestError || err instanceof Anthropic.AuthenticationError
          || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError
          || err instanceof Anthropic.UnprocessableEntityError || (err instanceof Anthropic.APIError && err.status === 413);
        if (deterministic) throw new FatalJobError(`ai_request_rejected: ${(err as Error).message}`);
        throw err; // rate limits, overload, 5xx, network: let the job retry
      }
      // Stop reasons first: a refusal or a truncated answer would only repeat (and be paid for) on retry.
      if (res.stop_reason === "refusal") throw new FatalJobError("ai_refused");
      if (res.stop_reason === "max_tokens") throw new FatalJobError("ai_output_too_long");
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
      let json: unknown;
      try { json = JSON.parse(text); } catch { throw new FatalJobError("ai_output_invalid"); }
      const parsed = req.schema.safeParse(json);
      if (!parsed.success) throw new FatalJobError("ai_output_invalid");
      const u = res.usage;
      return {
        data: parsed.data,
        usage: { model: res.model, input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
      };
    },
  };
}

/** Adds usage from several calls, per model. */
export function sumUsage(all: Usage[]): Record<string, Omit<Usage, "model">> {
  const out: Record<string, Omit<Usage, "model">> = {};
  for (const u of all) {
    const t = (out[u.model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    t.input += u.input; t.output += u.output; t.cacheRead += u.cacheRead; t.cacheWrite += u.cacheWrite;
  }
  return out;
}

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
/** Finish reasons that would only repeat (and be paid for) on retry. */
const GEMINI_BLOCKED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"]);

/** Gemini over plain REST: one generateContent call with a JSON schema. Retries are pg-boss's, as for Anthropic 5xx. */
export function geminiModel(apiKey = process.env.GEMINI_API_KEY, fetcher: typeof fetch = fetch): StructuredModel {
  return {
    async generate<T>(req: StructuredRequest<T>) {
      if (!apiKey) throw new FatalJobError("ai_not_configured");
      const parts = req.content.map((b) => {
        if (b.type === "text") return { text: b.text };
        if (b.type === "image" && b.source.type === "base64") return { inlineData: { mimeType: b.source.media_type, data: b.source.data } };
        throw new FatalJobError(`ai_unsupported_block:${b.type}`);
      });
      // Gemini caches repeated prefixes implicitly, so the cached context just follows the instructions.
      const system = req.cachedContext ? `${req.system}\n\n${req.cachedContext}` : req.system;
      const res = await fetcher(`${GEMINI_URL}/${req.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(req.schema), maxOutputTokens: req.maxTokens ?? 16000 },
        }),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        if (res.status === 429 || res.status >= 500) throw new Error(`gemini_${res.status}: ${detail}`); // let the job retry
        throw new FatalJobError(`ai_request_rejected: ${res.status} ${detail}`);
      }
      const body = await res.json() as {
        candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
        promptFeedback?: { blockReason?: string };
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
        modelVersion?: string;
      };
      const cand = body.candidates?.[0];
      if (!cand || body.promptFeedback?.blockReason || GEMINI_BLOCKED.has(cand.finishReason ?? "")) throw new FatalJobError("ai_refused");
      if (cand.finishReason === "MAX_TOKENS") throw new FatalJobError("ai_output_too_long");
      const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      let json: unknown;
      try { json = JSON.parse(text); } catch { throw new FatalJobError("ai_output_invalid"); }
      const parsed = req.schema.safeParse(json);
      if (!parsed.success) throw new FatalJobError("ai_output_invalid");
      const u = body.usageMetadata ?? {};
      const cached = u.cachedContentTokenCount ?? 0;
      return {
        data: parsed.data,
        usage: { model: body.modelVersion ?? req.model, input: (u.promptTokenCount ?? 0) - cached, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheRead: cached, cacheWrite: 0 },
      };
    },
  };
}
