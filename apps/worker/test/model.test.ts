import { describe, expect, it } from "vitest";
import { z } from "zod";
import { anthropicModel, MODELS } from "../src/ai/model.ts";
import { FatalJobError } from "../src/runJob.ts";

/** A stand-in Anthropic client returning a canned message. */
const client = (message: Record<string, unknown>) => ({ beta: { messages: { create: async () => ({ model: "claude-haiku-4-5", usage: { input_tokens: 1, output_tokens: 1 }, ...message }) } } }) as never;
const req = { model: MODELS.fast, system: "s", content: [{ type: "text" as const, text: "x" }], schema: z.object({ ok: z.boolean() }) };
const text = (t: string) => [{ type: "text", text: t }];

describe("anthropicModel", () => {
  it("returns validated data and usage", async () => {
    const out = await anthropicModel(client({ stop_reason: "end_turn", content: text('{"ok":true}') })).generate(req);
    expect(out.data).toEqual({ ok: true });
    expect(out.usage).toMatchObject({ model: "claude-haiku-4-5", input: 1, output: 1 });
  });

  it("truncated and refused answers fail at once instead of retrying paid work", async () => {
    await expect(anthropicModel(client({ stop_reason: "max_tokens", content: text('{"ok":') })).generate(req)).rejects.toBeInstanceOf(FatalJobError);
    await expect(anthropicModel(client({ stop_reason: "refusal", content: text("I can") })).generate(req)).rejects.toThrow("ai_refused");
  });

  it("output that does not match the schema is a deterministic failure", async () => {
    await expect(anthropicModel(client({ stop_reason: "end_turn", content: text('{"ok":"yes"}') })).generate(req)).rejects.toBeInstanceOf(FatalJobError);
    await expect(anthropicModel(client({ stop_reason: "end_turn", content: text("not json") })).generate(req)).rejects.toBeInstanceOf(FatalJobError);
  });
});
