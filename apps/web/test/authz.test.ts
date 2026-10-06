import { describe, expect, it } from "vitest";
import { ACTIONS, authorize, can, roleAtLeast, type Action } from "@/server/authz.ts";
import { HttpError } from "@/server/http.ts";
import type { MemberRole } from "@chitrapx/db";

const ctx = (role: MemberRole) => ({ role });

describe("can(ctx, action)", () => {
  const expected: Record<MemberRole, Action[]> = {
    viewer: ["view", "comment"],
    editor: ["view", "comment", "edit", "spend", "share"],
    admin: ["view", "comment", "edit", "spend", "share", "members"],
    owner: ["view", "comment", "edit", "spend", "share", "members", "billing"],
  };
  for (const [role, allowed] of Object.entries(expected) as Array<[MemberRole, Action[]]>) {
    it(`${role} may ${allowed.join(", ")} and nothing else`, () => {
      for (const action of ACTIONS) expect(can(ctx(role), action), `${role} ${action}`).toBe(allowed.includes(action));
    });
  }

  it("ranks roles", () => {
    expect(roleAtLeast("admin", "editor")).toBe(true);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast("owner", "owner")).toBe(true);
  });
});

describe("authorize", () => {
  it("passes silently when allowed", () => {
    expect(() => authorize(ctx("editor"), "edit")).not.toThrow();
  });

  it("throws 403 forbidden naming the role needed", () => {
    try {
      authorize(ctx("viewer"), "edit");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(403);
      expect((e as HttpError).code).toBe("forbidden");
      expect((e as HttpError).message).toMatch(/editor/i);
    }
    expect(() => authorize(ctx("admin"), "billing")).toThrow(/owner/i);
  });
});
