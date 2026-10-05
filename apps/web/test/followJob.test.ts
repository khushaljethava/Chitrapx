import { afterEach, describe, expect, it, vi } from "vitest";
import { followJob } from "@/lib/followJob.ts";

afterEach(() => vi.unstubAllGlobals());

describe("followJob", () => {
  it("polls the one job until it is done or failed", async () => {
    const answers = [{ status: "queued" }, { status: "running" }, { status: "done", output: { locales: ["de-DE"] } }];
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ id: "j", error: null, output: null, ...answers.shift() })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await followJob("j", 1)).toMatchObject({ status: "done", output: { locales: ["de-DE"] } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/jobs/j");
  });

  it("gives up after the last try", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "j", status: "queued", error: null, output: null }))));
    await expect(followJob("j", 1, 3)).rejects.toThrow("taking longer");
  });
});
