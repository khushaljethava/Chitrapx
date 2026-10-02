import { describe, expect, it } from "vitest";
import { exportBatches, exportPlan } from "../src/index.ts";
import { board, device, doc, group } from "./fixtures.ts";

const threeD = (id: string) => ({ ...device(id, 0), styleType: "3d-right" }) as unknown as ReturnType<typeof device>;

describe("exportPlan", () => {
  it("enumerates locale x board with store-shaped, zero-padded file names", () => {
    const d = { ...doc([group([board("b1", []), { ...board("b2", []), name: "Plan your Date!" }])]), localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }] } };
    const plan = exportPlan(d);
    expect(plan.map((p) => p.file)).toEqual([
      "ios/iphone-6.9/en-US/01-b1.png", "ios/iphone-6.9/en-US/02-plan-your-date.png",
      "ios/iphone-6.9/de-DE/01-b1.png", "ios/iphone-6.9/de-DE/02-plan-your-date.png",
    ]);
    expect(plan[0]).toMatchObject({ groupId: "g1", boardIndex: 0, locale: "en-US", width: 1290, height: 2796 });
  });

  it("limits to the requested locales and ignores unknown ones", () => {
    const d = { ...doc([group([board("b1", [])])]), localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }, { code: "fr-FR" }] } };
    expect(exportPlan(d, ["fr-FR", "xx-XX"]).map((p) => p.locale)).toEqual(["fr-FR"]);
  });

  it("batches so no batch holds more than 8 3D devices, counting span elements on every board they cross", () => {
    const boards = Array.from({ length: 6 }, (_, i) => board(`b${i}`, [threeD(`d${i}a`), threeD(`d${i}b`)]));
    const batches = exportBatches(exportPlan(doc([group(boards)])), 8);
    expect(batches.map((b) => b.length)).toEqual([4, 2]);
    expect(exportBatches(exportPlan(doc([group([board("x", [])])])), 8)).toEqual([[0]]);
  });
});

describe("variants", () => {
  it("export into their own folder and only take single letters B to Z", async () => {
    const { migrate } = await import("../src/index.ts");
    const d = doc([group([board("b1", [])]), { ...group([board("b1", [])]), id: "g2", variant: "B" } as never]);
    expect(exportPlan(d).map((p) => p.file)).toEqual(["ios/iphone-6.9/en-US/01-b1.png", "ios/iphone-6.9-B/en-US/01-b1.png"]);
    expect(() => migrate(d)).not.toThrow();
    expect(migrate(d).groups[1]!.variant).toBe("B");
    expect(() => migrate(doc([{ ...group([board("b1", [])]), variant: "../x" } as never]))).toThrow();
    expect(() => migrate(doc([{ ...group([board("b1", [])]), variant: "A" } as never]))).toThrow();
  });
});
