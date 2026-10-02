import { expect, it } from "vitest";
import { safeNext } from "@/server/safeNext.ts";

it("allows same-origin paths and rejects everything else", () => {
  expect(safeNext("/dashboard/apps/1")).toBe("/dashboard/apps/1");
  for (const bad of [null, "", "https://evil.com", "//evil.com", "/\\evil.com", "dashboard"]) expect(safeNext(bad)).toBe("/dashboard");
});
