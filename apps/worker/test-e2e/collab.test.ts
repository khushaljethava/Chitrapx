import { beforeAll, describe, expect, it } from "vitest";

/**
 * SP15 live co-editing checks against the running web app (WEB_ORIGIN), signed out. The two-browser checks
 * (presence, cursors, convergence, offline replay) are a manual list in docs/superpowers/plans/2026-10-06-sp15-live-coediting.md.
 */
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const PROJECT = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  const res = await fetch(`${ORIGIN}/api/health`).catch(() => null);
  if (!res?.ok) throw new Error(`web app not reachable at ${ORIGIN}; start it with pnpm dev`);
});

describe("SP15 command log (signed out)", () => {
  it("catch-up needs a signed-in member", async () => {
    const res = await fetch(`${ORIGIN}/api/projects/${PROJECT}/commands?after=0&clientId=${PROJECT}`, { redirect: "manual" });
    expect(res.status).toBe(401);
  });

  it("submitting commands needs a signed-in member", async () => {
    const res = await fetch(`${ORIGIN}/api/projects/${PROJECT}/commands`, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: PROJECT, after: 0, commands: [{ clientSeq: 1, command: { type: "setMirrorRtl", on: true } }] }),
    });
    expect(res.status).toBe(401);
  });
});
