import { describe, expect, it } from "vitest";
import { docAssetRefs, docBundleRefs, fromBundleDoc, toBundleDoc } from "../src/index.ts";
import { board, device, doc, group } from "./fixtures.ts";

const A = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);

describe("bundle doc rewrite", () => {
  const d = doc([group([board("b1", [device("d1", 0, `asset:${A}`), { ...device("d2", 0), posterSrc: `asset:${A}#poster` } as never])])]);

  it("finds every asset reference, including #poster", () => {
    expect(docAssetRefs(d)).toEqual([A]);
  });

  it("round-trips asset: -> bundle: -> asset:", () => {
    const b = toBundleDoc(d, (id) => (id === A ? SHA : undefined));
    expect(JSON.stringify(b)).not.toContain("asset:");
    expect(docBundleRefs(b)).toEqual([SHA]);
    expect(fromBundleDoc(b, (s) => (s === SHA ? A : undefined))).toEqual(d);
  });

  it("refuses a reference with no file", () => {
    expect(() => toBundleDoc(d, () => undefined)).toThrow(`asset_missing:${A}`);
    expect(() => fromBundleDoc(toBundleDoc(d, () => SHA), () => undefined)).toThrow("bundle_invalid");
  });
});
