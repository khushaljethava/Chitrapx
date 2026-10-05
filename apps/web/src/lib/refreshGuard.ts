/**
 * Something that must finish before the page reloads for a new version: the editor registers its
 * save here, so "Refresh" never throws away edits it could still send.
 */
type Guard = () => Promise<boolean>;
let guard: Guard | null = null;

/** Registers (or with null, clears) the guard. Returns an unregister that only clears its own guard. */
export function setRefreshGuard(fn: Guard | null): () => void {
  guard = fn;
  return () => { if (guard === fn) guard = null; };
}

/** True when it is safe to reload: no guard, or the guard reports everything saved. */
export async function runRefreshGuard(): Promise<boolean> {
  if (!guard) return true;
  try { return await guard(); } catch { return false; }
}
