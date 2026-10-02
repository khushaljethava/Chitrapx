import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ArtboardElement, ChitrapxDoc } from "@chitrapx/document";
import { BoardView, boardFor, fontFamiliesOf, googleFontsHref } from "../src/index.ts";

const text = (id: string, content: string, x = 100): ArtboardElement => ({
  id, type: "text", name: id, position: { x, y: 100 }, size: { width: 800, height: 200 }, rotation: 0, scale: 1,
  content, fontSize: 80, fontFamily: "Bricolage Grotesque", fontWeight: "700", color: "#111111", textAlign: "center",
} as unknown as ArtboardElement);
const device = (id: string, x: number, screenshotSrc = ""): ArtboardElement => ({
  id, type: "device", name: id, position: { x, y: 600 }, size: { width: 500, height: 1000 }, rotation: 0, scale: 1,
  deviceType: "iphone-15", styleType: "normal", screenshotSrc, screenshotRect: { left: 0, top: 0, width: 100, height: 100 },
} as unknown as ArtboardElement);

function makeDoc(): ChitrapxDoc {
  return {
    schemaVersion: 1, kind: "screenshots",
    localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }, { code: "fr-FR" }] },
    groups: [{
      id: "g", target: "iphone-6.9",
      spanElements: [device("span", 1290 - 250, "asset:span-shot")],
      boards: [
        { id: "b1", name: "One", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
          elements: [text("t1", "Track every brew"), device("d1", 400, "asset:a1")],
          localized: { "de-DE": { t1: { content: "Jeden Brühvorgang verfolgen" } } } },
        { id: "b2", name: "Two", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
          elements: [device("d2", 400)] },
      ],
    }],
  };
}
const resolve = (src: string) => (src === "asset:a1" ? "https://cdn.test/a1.png" : src === "asset:span-shot" ? "https://cdn.test/span.png" : null);

describe("BoardView", () => {
  it("renders base text, the locale override, and falls back to base text when a locale has none", () => {
    const doc = makeDoc();
    expect(render(<BoardView doc={doc} groupId="g" boardIndex={0} locale="en-US" scale={0.25} resolveSrc={resolve} />).container.textContent).toContain("Track every brew");
    expect(render(<BoardView doc={doc} groupId="g" boardIndex={0} locale="de-DE" scale={0.25} resolveSrc={resolve} />).container.textContent).toContain("Jeden Brühvorgang verfolgen");
    expect(render(<BoardView doc={doc} groupId="g" boardIndex={0} locale="fr-FR" scale={0.25} resolveSrc={resolve} />).container.textContent).toContain("Track every brew");
  });

  it("resolves asset sources and shows a placeholder for an empty screen", () => {
    const { container } = render(<BoardView doc={makeDoc()} groupId="g" boardIndex={0} locale="en-US" scale={0.25} resolveSrc={resolve} />);
    expect([...container.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toContain("https://cdn.test/a1.png");
    const second = render(<BoardView doc={makeDoc()} groupId="g" boardIndex={1} locale="en-US" scale={0.25} resolveSrc={resolve} />);
    expect(second.container.querySelector("[data-empty-screen]")).not.toBeNull();
  });

  it("draws span elements on every board they cross, in that board's coordinates", () => {
    const doc = makeDoc();
    const b1 = boardFor(doc, "g", 0, "en-US", resolve);
    const b2 = boardFor(doc, "g", 1, "en-US", resolve);
    expect(b1.board.elements.find((e) => e.id === "span")!.position.x).toBe(1040);
    expect(b2.board.elements.find((e) => e.id === "span")!.position.x).toBe(1040 - 1290);
  });

  it("reports unresolvable assets instead of rendering a broken image", () => {
    const { missing, board } = boardFor(makeDoc(), "g", 0, "en-US", () => null);
    expect(missing).toEqual(expect.arrayContaining(["asset:a1", "asset:span-shot"]));
    expect((board.elements.find((e) => e.id === "d1") as unknown as { screenshotSrc?: string }).screenshotSrc).toBeUndefined();
  });
});

describe("fonts", () => {
  it("builds one Google Fonts link for the families in use, skipping system fonts", () => {
    const families = fontFamiliesOf([boardFor(makeDoc(), "g", 0, "en-US", resolve).board]);
    expect(families).toEqual(["Bricolage Grotesque"]);
    const href = googleFontsHref(["Bricolage Grotesque", "Arial", "DM Serif Display"])!;
    expect(href).toContain("family=Bricolage+Grotesque");
    expect(href).toContain("family=DM+Serif+Display");
    expect(href).not.toContain("Arial");
    expect(googleFontsHref(["Arial"])).toBeNull();
  });
});
