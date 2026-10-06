import type { MemberRole, Plan } from "@chitrapx/db";

/** Pure rules for the team page; the server enforces the same ones (server/members.ts). */
export const ROLE_LABEL: Record<MemberRole, string> = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" };
export const ROLE_HINT: Record<MemberRole, string> = {
  owner: "Everything, including billing",
  admin: "Manage members, apps and projects",
  editor: "Create and edit, run jobs that use credits",
  viewer: "View and comment",
};
const PLAN_LABEL: Record<Plan, string> = { free: "Free", pro: "Pro", studio: "Studio" };

/** Roles `actor` may give the member: none for the owner row or without member rights; `owner` (a transfer) only from the owner. */
export function assignableRoles(actor: MemberRole, target: { role: MemberRole; you: boolean }): MemberRole[] {
  if (target.role === "owner" || (actor !== "owner" && actor !== "admin")) return [];
  return actor === "owner" ? ["owner", "admin", "editor", "viewer"] : ["admin", "editor", "viewer"];
}

type Seats = { used: number; members: number; pending: number; max: number; over: boolean };

export function seatBanner(seats: Seats, plan: Plan): string | null {
  const s = (n: number) => `${n} seat${n === 1 ? "" : "s"}`;
  if (seats.over) {
    return `This workspace has ${seats.members} members, but the ${PLAN_LABEL[plan]} plan includes ${s(seats.max)}. Existing members keep access, but no one new can join until you upgrade in Billing or remove members.`;
  }
  if (seats.used >= seats.max) return `All ${s(seats.max)} on the ${PLAN_LABEL[plan]} plan are in use (members and pending invites). Upgrade in Billing to invite more people.`;
  return null;
}
