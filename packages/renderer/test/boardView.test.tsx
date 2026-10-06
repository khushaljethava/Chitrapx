import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ArtboardElement, ChitrapxDoc } from "@chitrapx/document";
import { BoardView, boardFor, fontFamiliesOf, googleFontsHref, placeholderLayout, placeholderScreen } from "../src/index.ts";

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

  it("resolves stock template photos to app files without asking the caller, and rejects bad names", () => {
    const doc = makeDoc();
    doc.groups[0]!.boards[0]!.elements.push({ id: "p", type: "image", name: "p", position: { x: 0, y: 0 }, size: { width: 9, height: 9 }, rotation: 0, scale: 1, imageSrc: "stock:calora-monstera.png" } as unknown as ArtboardElement,
      { id: "q", type: "image", name: "q", position: { x: 0, y: 0 }, size: { width: 9, height: 9 }, rotation: 0, scale: 1, imageSrc: "stock:../x.png" } as unknown as ArtboardElement);
    const asked: string[] = [];
    const { board, missing } = boardFor(doc, "g", 0, "en-US", (s) => { asked.push(s); return resolve(s); });
    const img = (id: string) => (board.elements.find((e) => e.id === id) as unknown as { imageSrc?: string }).imageSrc;
    expect(img("p")).toBe("/stock/calora-monstera.png");
    expect(img("q")).toBeUndefined();
    expect(missing).toContain("stock:../x.png");
    expect(asked.some((s) => s.startsWith("stock:"))).toBe(false);
  });

  it("fills empty screens with a placeholder only when asked, leaving real screenshots and exports alone", () => {
    const src = (b: ReturnType<typeof boardFor>["board"], id: string) => (b.elements.find((e) => e.id === id) as unknown as { screenshotSrc?: string }).screenshotSrc;
    const preview = boardFor(makeDoc(), "g", 1, "en-US", resolve, { placeholders: true }).board;
    expect(src(preview, "d2")).toMatch(/^data:image\/svg\+xml/);
    expect(src(boardFor(makeDoc(), "g", 1, "en-US", resolve, { placeholders: true }).board, "d2")).toBe(src(preview, "d2")); // stable
    expect(src(boardFor(makeDoc(), "g", 0, "en-US", resolve, { placeholders: true }).board, "d1")).toBe("https://cdn.test/a1.png");
    expect(src(boardFor(makeDoc(), "g", 1, "en-US", resolve).board, "d2")).toBeUndefined(); // export path
    const { container } = render(<BoardView doc={makeDoc()} groupId="g" boardIndex={1} locale="en-US" scale={0.25} resolveSrc={resolve} placeholders />);
    expect(container.querySelector("[data-empty-screen]")).toBeNull();
  });
});

describe("placeholder screens", () => {
  it("picks a layout by screen shape and draws valid SVG", () => {
    expect(placeholderLayout("x", 1600, 1000)).toBe("desktop");
    expect(placeholderLayout("x", 390, 460)).toBe("watch");
    const seen = new Set(Array.from({ length: 40 }, (_, i) => placeholderLayout(`el-${i}`, 390, 844)));
    expect(seen).toEqual(new Set(["list", "feed", "grid", "chat", "dashboard"]));
    for (const [w, h] of [[390, 844], [1600, 1000], [390, 460], [834, 1194]]) {
      const svg = decodeURIComponent(placeholderScreen("s", w!, h!).split(",")[1]!);
      expect(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror")).toBeNull();
      expect(svg).not.toMatch(/NaN|undefined/);
    }
  });
});

describe("fonts", () => {
  it("builds one Google Fonts link for the families in use, skipping system fonts", () => {
    const families = fontFamiliesOf([boardFor(makeDoc(), "g", 0, "en-US", resolve).board]);
    expect(families).toEqual(["Bricolage Grotesque"]);
    const href = googleFontsHref([{ family: "Bricolage Grotesque", faces: [] }, { family: "Arial", faces: [] }, { family: "DM Serif Display", faces: [] }])!;
    expect(href).toContain("family=Bricolage+Grotesque");
    expect(href).toContain("family=DM+Serif+Display");
    expect(href).not.toContain("Arial");
    expect(googleFontsHref([{ family: "Arial", faces: [] }])).toBeNull();
  });
});
