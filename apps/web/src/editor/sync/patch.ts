import { produce } from "immer";

/**
 * Id-aware structural diff and conditional patch over document JSON (SP15 live co-editing).
 *
 * Paths use object keys, and `{ id }` for items of arrays whose items all carry a string id (groups,
 * boards, elements, span elements), so an op still finds its target after someone else inserted,
 * removed or reordered siblings. Any other array is one value. A value of `undefined` means "absent".
 *
 * Ops apply conditionally: only while the current value still equals `old`. That is what makes undo
 * per user: reverting a property that someone else has since changed leaves their value alone. A
 * missing parent or item skips the op, so a patch never resurrects something that was deleted.
 */
export type Seg = string | { id: string };
export type PatchOp =
  /** Set (or remove, when `new` is absent) one value. `at`: for array items, the id of the previous sibling (null: first). */
  | { k: "set"; path: Seg[]; old?: unknown; new?: unknown; at?: string | null }
  /** Reorder the items of an id array: `old` and `new` are the orders of the ids both sides share. */
  | { k: "order"; path: Seg[]; old: string[]; new: string[] };

type Obj = Record<string, unknown>;
type SetOp = Extract<PatchOp, { k: "set" }>;
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
function isIdArray(v: unknown): v is Array<Obj & { id: string }> {
  if (!Array.isArray(v)) return false;
  const seen = new Set<string>();
  for (const x of v) {
    if (!isObj(x) || typeof x.id !== "string" || seen.has(x.id)) return false;
    seen.add(x.id);
  }
  return true;
}

/** Deep equality over JSON values; a key holding `undefined` counts as absent. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => jsonEqual(a[k], b[k]));
  }
  return false;
}

function walk(a: unknown, b: unknown, path: Seg[], out: PatchOp[]): void {
  if (a === b) return;
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const av = a[k], bv = b[k];
      if (av === undefined && bv === undefined) continue;
      if (av === undefined) out.push({ k: "set", path: [...path, k], new: bv });
      else if (bv === undefined) out.push({ k: "set", path: [...path, k], old: av });
      else walk(av, bv, [...path, k], out);
    }
    return;
  }
  if (isIdArray(a) && isIdArray(b)) {
    const aIds = a.map((x) => x.id), bIds = b.map((x) => x.id);
    const inA = new Set(aIds), inB = new Set(bIds);
    a.forEach((x, i) => { if (!inB.has(x.id)) out.push({ k: "set", path: [...path, { id: x.id }], old: x, at: aIds[i - 1] ?? null }); });
    b.forEach((x, i) => { if (!inA.has(x.id)) out.push({ k: "set", path: [...path, { id: x.id }], new: x, at: bIds[i - 1] ?? null }); });
    const ca = aIds.filter((id) => inB.has(id)), cb = bIds.filter((id) => inA.has(id));
    if (ca.some((id, i) => id !== cb[i])) out.push({ k: "order", path, old: ca, new: cb });
    const byId = new Map(a.map((x) => [x.id, x]));
    for (const x of b) if (inA.has(x.id)) walk(byId.get(x.id), x, [...path, { id: x.id }], out);
    return;
  }
  if (jsonEqual(a, b)) return;
  out.push({ k: "set", path, old: a, new: b });
}

/** The ops that turn `a` into `b`. Subtrees shared by reference (Immer structural sharing) are skipped. */
export function diffDocs(a: unknown, b: unknown): PatchOp[] {
  const out: PatchOp[] = [];
  walk(a, b, [], out);
  return out;
}

const arrayPath = (op: PatchOp) => {
  const last = op.path.at(-1);
  return op.k === "set" && typeof last === "object" ? JSON.stringify(op.path.slice(0, -1)) : null;
};

/**
 * The ops that undo `ops`: reversed, with old and new swapped. Runs of item ops on one array keep their
 * original order, so items removed together are re-inserted in order (each one's `at` sibling first).
 */
export function invertOps(ops: PatchOp[]): PatchOp[] {
  const flipped = ops.map((op): PatchOp => op.k === "order"
    ? { k: "order", path: op.path, old: op.new, new: op.old }
    : { k: "set", path: op.path, old: op.new, new: op.old, ...(op.at !== undefined ? { at: op.at } : {}) });
  const out: PatchOp[] = [];
  for (let i = flipped.length - 1; i >= 0;) {
    const key = arrayPath(flipped[i]!);
    let j = i;
    while (key !== null && j > 0 && arrayPath(flipped[j - 1]!) === key) j--;
    out.push(...flipped.slice(j, i + 1));
    i = j - 1;
  }
  return out;
}

/**
 * Collapses repeated sets of one path into one op (first old value, last new value), dropping ops that end
 * where they started. Lists with reorders or with nested paths (one path inside another) are returned as is.
 */
export function squashOps(ops: PatchOp[]): PatchOp[] {
  if (ops.some((op) => op.k === "order")) return ops;
  const keys = [...new Set(ops.map((op) => JSON.stringify(op.path)))];
  const nested = keys.some((a) => keys.some((b) => a !== b && b.startsWith(a.slice(0, -1) + ",")));
  if (nested) return ops;
  const merged = new Map<string, SetOp>();
  for (const op of ops as SetOp[]) {
    const key = JSON.stringify(op.path);
    const first = merged.get(key);
    if (!first) { merged.set(key, { ...op }); continue; }
    const next: SetOp = { k: "set", path: op.path, old: first.old, new: op.new };
    const at = first.at !== undefined ? first.at : op.at;
    merged.set(key, at !== undefined ? { ...next, at } : next);
  }
  return [...merged.values()].filter((op) => !jsonEqual(op.old, op.new));
}

function check(seg: Seg): void {
  if (typeof seg === "string" ? UNSAFE.has(seg) : typeof seg?.id !== "string") throw new Error(`unsafe patch path: ${JSON.stringify(seg)}`);
}

function child(parent: unknown, seg: Seg): unknown {
  if (typeof seg === "string") return isObj(parent) ? parent[seg] : undefined;
  return Array.isArray(parent) ? parent.find((x) => isObj(x) && x.id === seg.id) : undefined;
}

const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function applyOrder(root: unknown, op: Extract<PatchOp, { k: "order" }>, force: boolean): void {
  let arr: unknown = root;
  for (const seg of op.path) arr = child(arr, seg);
  if (!Array.isArray(arr)) return;
  const list = arr as Obj[];
  const wanted = new Set(op.new);
  const slots: number[] = [];
  list.forEach((x, i) => { if (isObj(x) && wanted.has(x.id as string)) slots.push(i); });
  const present = slots.map((i) => list[i]!.id as string);
  if (!force) {
    const was = op.old.filter((id) => present.includes(id));
    if (was.some((id, i) => id !== present[i])) return; // someone else reordered since
  }
  const items = new Map(slots.map((i) => [list[i]!.id as string, list[i]!]));
  const order = op.new.filter((id) => items.has(id));
  slots.forEach((slot, n) => { list[slot] = items.get(order[n]!)!; });
}

function applySet(root: unknown, op: SetOp, force: boolean): void {
  let parent: unknown = root;
  for (const seg of op.path.slice(0, -1)) {
    parent = child(parent, seg);
    if (parent === undefined) return;
  }
  const last = op.path.at(-1);
  if (last === undefined) return;
  if (typeof last === "string") {
    if (!isObj(parent)) return;
    if (!force && !jsonEqual(parent[last], op.old)) return;
    if (op.new === undefined) delete parent[last];
    else parent[last] = copy(op.new);
    return;
  }
  if (!Array.isArray(parent)) return;
  const i = parent.findIndex((x) => isObj(x) && x.id === last.id);
  if (!force && !jsonEqual(i >= 0 ? parent[i] : undefined, op.old)) return;
  if (op.new === undefined) { if (i >= 0) parent.splice(i, 1); return; }
  if (i >= 0) { parent[i] = copy(op.new); return; }
  const anchor = op.at == null ? -1 : parent.findIndex((x) => isObj(x) && x.id === op.at);
  parent.splice(op.at == null ? 0 : anchor >= 0 ? anchor + 1 : parent.length, 0, copy(op.new));
}

/** Applies ops in order; conditional unless `force`. Returns the same object when nothing changed. */
export function applyPatch<T>(doc: T, ops: PatchOp[], opts?: { force?: boolean }): T {
  for (const op of ops) op.path.forEach(check);
  return produce(doc, (d) => {
    for (const op of ops) {
      if (op.k === "order") applyOrder(d, op, !!opts?.force);
      else applySet(d, op, !!opts?.force);
    }
  });
}
