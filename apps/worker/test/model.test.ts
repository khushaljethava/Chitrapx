import { describe, expect, it } from "vitest";
import { z } from "zod";
import { anthropicModel, geminiModel, MODELS } from "../src/ai/model.ts";
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

/** A stand-in fetch returning one canned Gemini response. */
const gemini = (body: unknown, status = 200) => {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { model: geminiModel("key", fetcher), sent };
};
const answer = (t: string, finishReason = "STOP") => ({
  candidates: [{ finishReason, content: { parts: [{ text: t }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2, cachedContentTokenCount: 4 },
  modelVersion: "gemini-3.5-flash-lite",
});
const imageReq = { ...req, content: [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: "AAA" } }, ...req.content] };

describe("geminiModel", () => {
  it("sends images and a JSON schema, returns validated data and usage", async () => {
    const { model, sent } = gemini(answer('{"ok":true}'));
    const out = await model.generate(imageReq);
    expect(out.data).toEqual({ ok: true });
    expect(out.usage).toEqual({ model: "gemini-3.5-flash-lite", input: 6, output: 5, cacheRead: 4, cacheWrite: 0 });
    expect(sent[0]!.url).toContain(`/${MODELS.fast}:generateContent`);
    const body = sent[0]!.body as { contents: Array<{ parts: unknown[] }>; generationConfig: { responseJsonSchema: { type: string } } };
    expect(body.contents[0]!.parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "AAA" } });
    expect(body.generationConfig.responseJsonSchema.type).toBe("object");
  });

  it("truncated, blocked and invalid answers fail at once; overload retries", async () => {
    await expect(gemini(answer('{"ok":', "MAX_TOKENS")).model.generate(req)).rejects.toThrow("ai_output_too_long");
    await expect(gemini(answer("", "SAFETY")).model.generate(req)).rejects.toThrow("ai_refused");
    await expect(gemini({ promptFeedback: { blockReason: "OTHER" } }).model.generate(req)).rejects.toThrow("ai_refused");
    await expect(gemini(answer('{"ok":"yes"}')).model.generate(req)).rejects.toBeInstanceOf(FatalJobError);
    await expect(gemini({}, 400).model.generate(req)).rejects.toBeInstanceOf(FatalJobError);
    const busy = gemini({}, 503).model.generate(req);
    await expect(busy).rejects.toThrow("gemini_503");
    await expect(busy).rejects.not.toBeInstanceOf(FatalJobError);
  });

  it("without a key, AI jobs fail as not configured", async () => {
    await expect(geminiModel("", fetch).generate(req)).rejects.toThrow("ai_not_configured");
  });
});
