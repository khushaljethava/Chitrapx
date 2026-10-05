import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, retarget } from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

const deepFreeze = <T>(o: T): T => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const withText = (extra: Record<string, unknown>, localized?: Record<string, unknown>) => {
  const b = board("b1", [{ ...text("t", 0, 0), content: "Track habits", ...extra } as never]);
  if (localized) b.localized = localized as never;
  return doc([group([b])]);
};
const firstText = (d: ReturnType<typeof migrate>) => d.groups[0]!.boards[0]!.elements[0] as unknown as Record<string, unknown>;

describe("SP10 document fields", () => {
  it("documents saved before SP10 pass migrate unchanged", () => {
    const d = doc([group([board("b1", [text("t", 0, 0)])])]);
    expect(migrate(d)).toEqual(d);
    const dir = join(import.meta.dirname, "../../assets/templates");
    for (const f of readdirSync(dir).filter((n) => !n.startsWith("_"))) {
      const once = migrate(JSON.parse(readFileSync(join(dir, f), "utf8")).doc);
      expect(migrate(once), f).toEqual(once);
    }
  });
  it("normalises marks and gradients instead of rejecting range problems, without touching the input", () => {
    const d = deepFreeze(withText({ marks: [{ start: 6, end: 99, fontWeight: 800 }, { start: 2, end: 2, italic: true }], gradient: { kind: "linear", stops: [{ color: "#fff", at: 1 }, { color: "#000", at: 0 }] } }));
    const out = firstText(migrate(d));
    expect(out.marks).toEqual([{ start: 6, end: 12, fontWeight: 800 }]);
    expect(out.gradient).toEqual({ kind: "linear", angle: 180, stops: [{ color: "#000", at: 0 }, { color: "#fff", at: 1 }] });
    expect(firstText(migrate(withText({ marks: [{ start: 3, end: 3, italic: true }] })))).not.toHaveProperty("marks");
  });
  it("normalises a locale override's own marks against its own content", () => {
    const d = withText({}, { "de-DE": { t: { content: "Kurz", marks: [{ start: 0, end: 50, italic: true }] } } });
    expect(migrate(d).groups[0]!.boards[0]!.localized!["de-DE"]!.t!.marks).toEqual([{ start: 0, end: 4, italic: true }]);
  });
  it("rejects unsafe colours in marks and gradient stops, naming the field", () => {
    const bad = withText({ marks: [{ start: 0, end: 5, color: "red), url(http://x/)" }] });
    expect(() => migrate(bad)).toThrow(/marks/);
    expect(() => migrate(withText({ gradient: { kind: "linear", stops: [{ color: "url(x)", at: 0 }, { color: "#000", at: 1 }] } }))).toThrow();
  });
  it("validates fontFamily", () => {
    for (const bad of ['Evil"', "a;b", "a{", "<x>", "back\\slash", "x".repeat(101), "tab\there"]) {
      expect(() => migrate(withText({ fontFamily: bad })), bad).toThrow();
    }
    expect(() => migrate(withText({ fontFamily: "Pacifico (custom)" }))).not.toThrow();
  });
  it("keeps a group's styleId and rejects junk", () => {
    const d = doc([{ ...group([board("b1", [])]), styleId: "swiss-grid-bold" } as never]);
    expect(migrate(d).groups[0]!.styleId).toBe("swiss-grid-bold");
    expect(() => migrate(doc([{ ...group([board("b1", [])]), styleId: "Not Valid!" } as never]))).toThrow();
  });
  it("retargeting leaves marks untouched", () => {
    const g = migrate(withText({ marks: [{ start: 6, end: 12, fontWeight: 800 }] })).groups[0]!;
    expect((retarget(g, "iphone-6.5").boards[0]!.elements[0] as unknown as { marks: unknown }).marks).toEqual([{ start: 6, end: 12, fontWeight: 800 }]);
  });
  it("accepts brand tokens wherever a colour goes, and nothing else after brand:", () => {
    expect(() => migrate(withText({ color: "brand:text", marks: [{ start: 0, end: 5, color: "brand:accent" }] }))).not.toThrow();
    expect(() => migrate(withText({ color: "brand:pink" }))).toThrow();
    expect(() => migrate(withText({ color: "brand:primary; background:url(x)" }))).toThrow();
  });
});
