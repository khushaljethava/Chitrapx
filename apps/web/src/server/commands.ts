import { and, asc, eq, gt, lte, max } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTx, type Db } from "@chitrapx/db";
import { MAX_DOC_BYTES, migrate, type ChitrapxDoc } from "@chitrapx/document";
import type { Command } from "@/editor/commands.ts";
import {
  applyBatch, BATCH_MAX, CATCH_UP_MAX, crossedSnapshot, isContiguous, type CatchUp, type LogEntry, type SubmitResponse,
} from "@/editor/sync/log.ts";
import type { Ctx } from "./context.ts";
import { HttpError, notFound } from "./http.ts";
import { pruneVersions } from "./versions.ts";

/**
 * SP15 live co-editing: the server-ordered command log. Commands are applied in one transaction under the
 * project row lock (the same lock the worker's AI jobs, restore and named versions take), logged, and
 * broadcast after commit. `projects.doc` stays the single source of truth for render, export and jobs.
 */

/**
 * Whether this member may send document commands. Membership is already checked (the project must be in
 * the caller's workspace). The roles branch wires this to "editor or above"; viewers then get presence only.
 */
export function canSendCommands(_ctx: Ctx): boolean {
  return true;
}

const uuid = z.uuid();
const submitInput = z.object({
  clientId: uuid,
  after: z.number().int().min(0),
  commands: z.array(z.object({
    clientSeq: z.number().int().min(1),
    command: z.looseObject({ type: z.string().min(1).max(64) }),
  })).min(1).max(BATCH_MAX),
});
const sinceInput = z.object({ after: z.coerce.number().int().min(0), clientId: uuid });

/** Called after commit with the new entries (the route broadcasts them). */
export type OnCommitted = (projectId: string, head: number, entries: LogEntry[]) => void | Promise<void>;

const own = (ctx: Ctx, projectId: string) => and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId));
const c = schema.projectCommands;

/** migrate plus the size limit: what every stored document must pass. */
function validate(doc: ChitrapxDoc): ChitrapxDoc {
  const next = migrate(doc);
  if (Buffer.byteLength(JSON.stringify(next)) > MAX_DOC_BYTES) throw new Error("This project is too large to save");
  return next;
}

async function lastClientSeq(tx: Db, projectId: string, clientId: string): Promise<number | null> {
  const [row] = await tx.select({ last: max(c.clientSeq) }).from(c).where(and(eq(c.projectId, projectId), eq(c.clientId, clientId)));
  return row?.last ?? null;
}

/** The entries after `after` up to `head`, or null when the log does not have them all (a hole) or they are too many. */
async function entriesSince(tx: Db, projectId: string, after: number, head: number): Promise<LogEntry[] | null> {
  if (after > head) return null;
  if (after === head) return [];
  const rows = await tx.select({ seq: c.seq, clientId: c.clientId, clientSeq: c.clientSeq, userId: c.userId, command: c.command })
    .from(c).where(and(eq(c.projectId, projectId), gt(c.seq, after), lte(c.seq, head))).orderBy(asc(c.seq)).limit(CATCH_UP_MAX + 1);
  if (rows.length > CATCH_UP_MAX || !isContiguous(after, head, rows)) return null;
  return rows.map((r) => ({ ...r, command: r.command as Command }));
}

/**
 * Applies a client's batch on the current head: idempotent by (clientId, clientSeq), each command validated
 * (refused ones are reported, not logged). Answers with per-command results and a catch-up from `after`.
 */
export async function submitCommands(ctx: Ctx, projectId: string, raw: unknown, opts?: { onCommitted?: OnCommitted }): Promise<SubmitResponse> {
  if (!uuid.safeParse(projectId).success) throw notFound();
  const input = submitInput.parse(raw);
  const out = await withTx(async ({ db: tx }) => {
    const [p] = await tx.select({ doc: schema.projects.doc, revision: schema.projects.revision }).from(schema.projects).where(own(ctx, projectId)).for("update");
    if (!p) throw notFound();
    if (!canSendCommands(ctx)) throw new HttpError(403, "read_only", "You can view this project but not edit it");
    const res = applyBatch({
      doc: migrate(p.doc), head: p.revision, lastClientSeq: await lastClientSeq(tx, projectId, input.clientId),
      clientId: input.clientId, userId: ctx.userId, items: input.commands as unknown as Array<{ clientSeq: number; command: Command }>, validate,
    });
    if (res.entries.length) {
      await tx.update(schema.projects).set({ doc: res.doc, revision: res.head, updatedAt: new Date(), updatedBy: ctx.userId }).where(own(ctx, projectId));
      await tx.insert(c).values(res.entries.map((e) => ({
        projectId, seq: e.seq, workspaceId: ctx.workspaceId, clientId: e.clientId, clientSeq: e.clientSeq, userId: e.userId, command: e.command,
      })));
      if (crossedSnapshot(p.revision, res.head)) {
        await tx.insert(schema.projectVersions).values({ workspaceId: ctx.workspaceId, projectId, revision: res.head, doc: res.doc, createdBy: ctx.userId });
        await pruneVersions(tx, ctx.workspaceId, projectId);
      }
    }
    const entries = await entriesSince(tx, projectId, input.after, res.head);
    const since: CatchUp = entries
      ? { head: res.head, entries }
      : { head: res.head, snapshot: { doc: res.doc, lastClientSeq: await lastClientSeq(tx, projectId, input.clientId) } };
    return { res, since };
  });
  if (out.res.entries.length) await opts?.onCommitted?.(projectId, out.res.head, out.res.entries);
  return { ...out.since, results: out.res.results };
}

/** What a client missed since `after` (its confirmed seq): entries, or a snapshot when the log has a hole. */
export async function commandsSince(ctx: Ctx, projectId: string, after: unknown, clientId: unknown): Promise<CatchUp> {
  if (!uuid.safeParse(projectId).success) throw notFound();
  const input = sinceInput.parse({ after, clientId });
  const [p] = await db.select({ revision: schema.projects.revision }).from(schema.projects).where(own(ctx, projectId));
  if (!p) throw notFound();
  const entries = await entriesSince(db, projectId, input.after, p.revision);
  if (entries) return { head: p.revision, entries };
  // The snapshot and its head come from one read (the head may have moved on meanwhile).
  const [now] = await db.select({ doc: schema.projects.doc, revision: schema.projects.revision }).from(schema.projects).where(own(ctx, projectId));
  if (!now) throw notFound();
  return { head: now.revision, snapshot: { doc: migrate(now.doc), lastClientSeq: await lastClientSeq(db, projectId, input.clientId) } };
}
