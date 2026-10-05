import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChangelog } from "@/lib/changelog.ts";

const FIXTURE = `# Changelog

Intro text that is not a release.

## [Unreleased]

### Added
- Something coming

## [1.2.0] - 2026-10-06

### Added
- A **bold** move with \`code\` inside
- Two-line item
  that continues here

### Fixed
- <script>alert(1)</script>
- <img src=x onerror="alert(2)">

## [1.1.0] - 2026-10-01
- An item without a section
`;

describe("changelog", () => {
  it("parses releases with dates, sections and bullets, newest first as written", () => {
    const releases = parseChangelog(FIXTURE);
    expect(releases.map((r) => [r.version, r.date])).toEqual([["Unreleased", null], ["1.2.0", "2026-10-06"], ["1.1.0", "2026-10-01"]]);
    const r = releases[1]!;
    expect(r.sections.map((s) => s.title)).toEqual(["Added", "Fixed"]);
    expect(r.sections[0]!.items[0]).toEqual([{ text: "A " }, { text: "bold", bold: true }, { text: " move with " }, { text: "code", code: true }, { text: " inside" }]);
    expect(r.sections[0]!.items[1]).toEqual([{ text: "Two-line item that continues here" }]);
    expect(releases[2]!.sections).toEqual([{ title: "", items: [[{ text: "An item without a section" }]] }]);
  });

  it("raw HTML stays literal text: nothing is ever turned into markup", () => {
    const fixed = parseChangelog(FIXTURE)[1]!.sections[1]!;
    expect(fixed.items).toEqual([[{ text: "<script>alert(1)</script>" }], [{ text: '<img src=x onerror="alert(2)">' }]]);
    // Only plain strings and flags come out; there is no html field anywhere for a renderer to inject.
    expect(JSON.stringify(parseChangelog(FIXTURE))).not.toMatch(/"(html|__html)"/);
  });

  it("the repo CHANGELOG.md parses into at least one dated release", () => {
    const releases = parseChangelog(readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8"));
    expect(releases.some((r) => r.date && r.sections.some((s) => s.items.length > 0))).toBe(true);
  });
});
