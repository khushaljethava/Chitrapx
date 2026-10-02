import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { FatalJobError } from "../runJob.ts";

/** Fast vision and translation; stronger judgment and copywriting. */
export const MODELS = { fast: "claude-haiku-4-5", writer: "claude-sonnet-5-5" } as const;
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
  /** Sonnet only; Haiku 4.5 does not take effort. */
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
