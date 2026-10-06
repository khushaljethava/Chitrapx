import type { ChitrapxDoc } from "@chitrapx/document";
import { applyCommand, type Command } from "../commands.ts";

/**
 * The server-ordered command log (SP15), as pure functions shared by the API (`server/commands.ts`) and the
 * in-memory server in tests. `seq` is the project revision the command produced.
 */
export type LogEntry = { seq: number; clientId: string; clientSeq: number; userId: string | null; command: Command };
export type SubmitItem = { clientSeq: number; command: Command };
/** `seq` when applied, `duplicate` when an earlier request already applied it, `error` when refused (not logged). */
export type ItemResult = { clientSeq: number; seq?: number; duplicate?: true; error?: string };
/** Entries after the caller's seq, or the whole document when the log has a hole (a whole-document write) or is too long. */
export type CatchUp =
  | { head: number; entries: LogEntry[] }
  | { head: number; snapshot: { doc: ChitrapxDoc; lastClientSeq: number | null } };
export type SubmitResponse = CatchUp & { results: ItemResult[] };

/** Commands per request. */
export const BATCH_MAX = 100;
/** Entries a catch-up returns before it sends a snapshot instead. */
export const CATCH_UP_MAX = 200;
/** Live editing writes a version every 100 commands (solo saves keep "every 20th revision"). */
export const COMMAND_SNAPSHOT_EVERY = 100;

export const crossedSnapshot = (before: number, after: number) =>
  Math.floor(after / COMMAND_SNAPSHOT_EVERY) > Math.floor(before / COMMAND_SNAPSHOT_EVERY);

/** True when `entries` are exactly seqs after+1 … head. */
export const isContiguous = (after: number, head: number, entries: Array<{ seq: number }>) =>
  entries.length === head - after && entries.every((e, i) => e.seq === after + 1 + i);

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
function safeKeys(v: unknown, depth: number): boolean {
  if (depth > 64) return false;
  if (Array.isArray(v)) return v.every((x) => safeKeys(x, depth + 1));
  if (typeof v === "object" && v !== null) {
    return Object.keys(v).every((k) => !UNSAFE.has(k) && safeKeys((v as Record<string, unknown>)[k], depth + 1));
  }
  return true;
}
/** No prototype-like key anywhere (commands are assigned into the document with Object.assign), nor in a patch path. */
export function isSafeCommandJson(v: unknown): boolean {
  if (!safeKeys(v, 0)) return false;
  const ops = (v as { type?: unknown; ops?: unknown })?.type === "patch" ? (v as { ops?: unknown }).ops : null;
  if (!Array.isArray(ops)) return true;
  return ops.every((op) => Array.isArray(op?.path) && op.path.every((s: unknown) => typeof s !== "string" || !UNSAFE.has(s)));
}

function reason(err: unknown): string {
  const issue = (err as { issues?: Array<{ path?: PropertyKey[]; message?: string }> })?.issues?.[0];
  if (issue) return `${(issue.path ?? []).map(String).join(".")}: ${issue.message ?? "invalid"}`;
  return err instanceof Error ? err.message : "invalid";
}

/**
 * Applies a client's batch on top of the server document. Commands at or below the client's last logged
 * `clientSeq` are duplicates. `validate` (migrate plus the size limit) runs once for the batch; if the result
 * is invalid it runs per command, so only the offending commands are refused.
 */
export function applyBatch(input: {
  doc: ChitrapxDoc; head: number; lastClientSeq: number | null; clientId: string; userId: string | null;
  items: SubmitItem[]; validate: (doc: ChitrapxDoc) => ChitrapxDoc;
}): { doc: ChitrapxDoc; head: number; entries: LogEntry[]; results: ItemResult[] } {
  const seen = new Set<number>();
  const items = [...input.items].sort((a, b) => a.clientSeq - b.clientSeq)
    .filter((it) => !seen.has(it.clientSeq) && !!seen.add(it.clientSeq));
  const fresh = new Set(items.filter((it) => input.lastClientSeq === null || it.clientSeq > input.lastClientSeq));
  const verdict = new Map<number, string | null>(); // clientSeq -> error, or null when applied

  const run = (perCommand: boolean) => {
    verdict.clear();
    let doc = input.doc;
    for (const it of fresh) {
      try {
        if (!isSafeCommandJson(it.command)) throw new Error("unsafe command");
        const next = applyCommand(doc, it.command);
        doc = perCommand ? input.validate(next) : next;
        verdict.set(it.clientSeq, null);
      } catch (err) { verdict.set(it.clientSeq, reason(err)); }
    }
    return doc;
  };

  let doc = run(false);
  try { doc = input.validate(doc); } catch { doc = run(true); }

  let head = input.head;
  const entries: LogEntry[] = [];
  const results: ItemResult[] = items.map((it) => {
    if (!fresh.has(it)) return { clientSeq: it.clientSeq, duplicate: true };
    const error = verdict.get(it.clientSeq);
    if (error) return { clientSeq: it.clientSeq, error };
    entries.push({ seq: ++head, clientId: input.clientId, clientSeq: it.clientSeq, userId: input.userId, command: it.command });
    return { clientSeq: it.clientSeq, seq: head };
  });
  return { doc: entries.length ? doc : input.doc, head, entries, results };
}
