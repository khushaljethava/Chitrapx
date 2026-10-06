import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../src/app/api", import.meta.url));

/** Mutating routes that do not take a workspace write permission, and why. */
const ALLOWED: Record<string, string> = {
  "billing/webhook/route.ts": "Razorpay webhook, signature-checked, no session",
  "events/route.ts": "anonymous, consent-gated analytics counts",
  "workspaces/switch/route.ts": "switching only to a workspace the user belongs to (checked inside)",
  "invites/accept/route.ts": "the invitee is not a member yet; the invite itself authorizes",
  "members/[userId]/route.ts": "removeMember/changeRole authorize: leaving yourself needs no role, everything else needs members",
  "community/[postId]/route.ts": "DELETE removes the caller's own community post (author-only)",
  "notifications/route.ts": "marks the caller's own notifications read",
};

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routes(p) : name === "route.ts" ? [p] : [];
  });
}

/** Each exported handler's source, up to the next export. */
function handlers(src: string): Array<[string, string]> {
  const parts = src.split(/(?=export (?:const|async function) (?:GET|POST|PUT|PATCH|DELETE)\b)/);
  return parts.flatMap((part) => {
    const m = /^export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/.exec(part);
    return m ? [[m[1]!, part] as [string, string]] : [];
  });
}

const GUARD = /requireContext\("(comment|edit|spend|share|members|billing)"\)|authorize\(ctx, /;

describe("every mutating API route asks for a permission", () => {
  const files = routes(API);
  it("finds the routes", () => expect(files.length).toBeGreaterThan(30));

  for (const file of files) {
    const rel = relative(API, file).split("\\").join("/");
    for (const [method, body] of handlers(readFileSync(file, "utf8"))) {
      if (method === "GET") continue;
      it(`${method} /api/${rel.replace(/\/route\.ts$/, "")}`, () => {
        if (ALLOWED[rel]) return;
        expect(body, `${rel} ${method} must call requireContext("<action>") or authorize(ctx, …)`).toMatch(GUARD);
      });
    }
  }
});
