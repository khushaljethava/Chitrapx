import { isStaffEmail } from "./community.ts";
import { currentUser } from "./context.ts";

/** True when the signed-in user's email is in STAFF_EMAILS (community moderation). */
export async function isStaff(): Promise<boolean> {
  return isStaffEmail((await currentUser())?.email);
}
