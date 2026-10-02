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
      let res;
      try {
        res = await client.beta.messages.parse({
          model: req.model,
          max_tokens: req.maxTokens ?? 16000,
          system,
          messages: [{ role: "user", content: req.content }],
          output_config: { format: betaZodOutputFormat(req.schema), ...(isWriter && req.effort ? { effort: req.effort } : {}) },
          // Refusals on Sonnet 5.5 are re-run server-side on Anthropic's recommended fallback model.
          ...(isWriter ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        });
      } catch (err) {
        if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.AuthenticationError
          || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
          throw new FatalJobError(`ai_request_rejected: ${err.message}`);
        }
        throw err; // rate limits, overload, 5xx, network: let the job retry
      }
      if (res.stop_reason === "refusal") throw new FatalJobError("ai_refused");
      if (res.stop_reason === "max_tokens") throw new FatalJobError("ai_output_too_long");
      if (res.parsed_output == null) throw new Error("ai_output_unparseable"); // transient: retry
      const u = res.usage;
      return {
        data: res.parsed_output as T,
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
