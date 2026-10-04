import { describe, expect, it } from "vitest";
import { migrate } from "../src/index.ts";
import { board, device, doc, group, text } from "./fixtures.ts";

describe("SP9 element fields", () => {
  it("documents saved before SP9 pass migrate unchanged", () => {
    const d = doc([group([board("b1", [text("t", 0, 0), device("d", 100)])])]);
    expect(migrate(JSON.parse(JSON.stringify(d)))).toEqual(migrate(d));
  });

  it("keeps locked, hidden and status bar fields", () => {
    const el = { ...device("d", 0), locked: true, hidden: true, showStatusBar: true, statusBarPlatform: "ios", statusBarTheme: "dark", statusBarBg: "solid", statusBarColor: "#112233", statusBarTime: "9:41" };
    const out = migrate(doc([group([board("b1", [el as never])])]));
    expect(out.groups[0]!.boards[0]!.elements[0]).toMatchObject({ locked: true, hidden: true, statusBarTime: "9:41", statusBarColor: "#112233" });
  });

  it("rejects a status bar time that is not like 9:41", () => {
    for (const bad of ["9.41", "941", "9:4", "url(x)"]) {
      expect(() => migrate(doc([group([board("b1", [{ ...device("d", 0), statusBarTime: bad } as never])])]))).toThrow();
    }
    expect(() => migrate(doc([group([board("b1", [{ ...device("d", 0), statusBarTime: "12:05" } as never])])]))).not.toThrow();
  });

  it("validates statusBarColor as a colour", () => {
    expect(() => migrate(doc([group([board("b1", [{ ...device("d", 0), statusBarColor: "red), url(http://x/)" } as never])])]))).toThrow();
  });
});
