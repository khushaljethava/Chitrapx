import { describe, expect, it } from "vitest";
import { assignableRoles, seatBanner } from "@/components/teamModel.ts";

describe("assignableRoles", () => {
  it("the owner can give any role, including a transfer of ownership, to anyone but themselves", () => {
    expect(assignableRoles("owner", { role: "editor", you: false })).toEqual(["owner", "admin", "editor", "viewer"]);
    expect(assignableRoles("owner", { role: "owner", you: true })).toEqual([]);
  });
  it("admins manage everyone but the owner and cannot grant ownership", () => {
    expect(assignableRoles("admin", { role: "viewer", you: false })).toEqual(["admin", "editor", "viewer"]);
    expect(assignableRoles("admin", { role: "owner", you: false })).toEqual([]);
  });
  it("editors and viewers manage no one", () => {
    expect(assignableRoles("editor", { role: "viewer", you: false })).toEqual([]);
    expect(assignableRoles("viewer", { role: "viewer", you: true })).toEqual([]);
  });
});

describe("seatBanner", () => {
  it("is empty while there is room", () => {
    expect(seatBanner({ used: 2, members: 2, pending: 0, max: 3, over: false }, "pro")).toBeNull();
  });
  it("says when every seat is taken and points at Billing", () => {
    expect(seatBanner({ used: 1, members: 1, pending: 0, max: 1, over: false }, "free")).toMatch(/All 1 seat.*Free.*Billing/);
  });
  it("explains an over-limit workspace after a downgrade", () => {
    expect(seatBanner({ used: 4, members: 4, pending: 0, max: 1, over: true }, "free")).toMatch(/4 members.*Free plan includes 1 seat.*keep access.*no one new/i);
  });
});
