import type { MemberRole } from "@chitrapx/db";
import { HttpError } from "./http.ts";

/**
 * SP15: the one permission table. Every route that writes passes one of these actions to
 * `requireContext(action)`; `test/routeGuards.test.ts` fails if a mutating route forgets.
 */
export const ACTIONS = ["view", "comment", "edit", "spend", "share", "members", "billing"] as const;
export type Action = (typeof ACTIONS)[number];

const RANK: Record<MemberRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/** The least role that may perform each action. */
export const MIN_ROLE: Record<Action, MemberRole> = {
  view: "viewer",
  comment: "viewer",
  edit: "editor",
  spend: "editor",
  share: "editor",
  members: "admin",
  billing: "owner",
};

const WHAT: Record<Action, string> = {
  view: "view this workspace",
  comment: "comment",
  edit: "make changes",
  spend: "start jobs that use credits",
  share: "share projects",
  members: "manage members",
  billing: "manage billing",
};

export const roleAtLeast = (role: MemberRole, min: MemberRole): boolean => RANK[role] >= RANK[min];

export const can = (ctx: { role: MemberRole }, action: Action): boolean => roleAtLeast(ctx.role, MIN_ROLE[action]);

/** Throws 403 `forbidden` unless the role may perform the action. */
export function authorize(ctx: { role: MemberRole }, action: Action): void {
  if (can(ctx, action)) return;
  const min = MIN_ROLE[action];
  const who = min === "owner" ? "the workspace owner" : `an ${min}${min === "admin" ? " or the owner" : " or above"}`;
  throw new HttpError(403, "forbidden", `You are a ${ctx.role} in this workspace. Only ${who} can ${WHAT[action]}.`, { role: ctx.role, required: min });
}
