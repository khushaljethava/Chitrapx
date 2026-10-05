import { describe, expect, it } from "vitest";
import { ApiError } from "@/server/api.ts";
import { facesOf } from "@/lib/fontFaces.ts";
import { fontUploadMessage } from "@/lib/uploadAsset.ts";

const rows = [
  { family: "Acme", faces: [{ assetId: "a", weight: 400, italic: false, format: "woff2" as const, url: "u1" }, { assetId: "b", weight: 700, italic: true, format: "woff2" as const, url: "u2" }] },
  { family: "Other", faces: [{ assetId: "c", weight: 400, italic: false, format: "ttf" as const, url: "u3" }] },
];

describe("font faces for the renderer", () => {
  it("flattens families, optionally to the ones a document uses", () => {
    expect(facesOf(rows).map((f) => `${f.family}:${f.weight}:${f.italic}`)).toEqual(["Acme:400:false", "Acme:700:true", "Other:400:false"]);
    expect(facesOf(rows, new Set(["Other"]))).toEqual([{ family: "Other", weight: 400, italic: false, format: "ttf", url: "u3" }]);
  });
  it("explains every upload error in plain words", () => {
    const e = (code: string, message = "server said") => new ApiError(400, code, message);
    expect(fontUploadMessage(e("unsupported_type"))).toBe("This file is not a TTF, OTF, WOFF or WOFF2 font.");
    expect(fontUploadMessage(e("too_large"))).toBe("Fonts can be up to 10 MB.");
    expect(fontUploadMessage(e("font_restricted"))).toBe("This font's licence does not allow embedding.");
    expect(fontUploadMessage(e("font_unreadable"))).toBe("This file could not be read as a font.");
    expect(fontUploadMessage(e("font_quota", "Your workspace has 20 of 20 fonts"))).toBe("Your workspace has 20 of 20 fonts");
    expect(fontUploadMessage(new Error("Upload failed — try again"))).toBe("Upload failed — try again");
  });
});
