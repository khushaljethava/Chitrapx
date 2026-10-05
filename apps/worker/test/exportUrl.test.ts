import { describe, expect, it } from "vitest";
import { exportUrlAllowed } from "../src/export.ts";

describe("export browser network allowlist", () => {
  const origins = ["http://localhost:3000", "http://127.0.0.1:9000", "https://fonts.googleapis.com", "https://fonts.gstatic.com"];
  it("allows our web app, storage, Google Fonts and inline data", () => {
    for (const u of ["http://localhost:3000/render/x?sig=1", "http://127.0.0.1:9000/chitrapx-uploads/w/abc?X-Amz-Signature=1", "https://fonts.gstatic.com/s/x.woff2", "data:image/png;base64,AA"]) {
      expect(exportUrlAllowed(u, origins), u).toBe(true);
    }
  });
  it("blocks internal hosts, cloud metadata, look-alike hosts and garbage", () => {
    for (const u of ["http://169.254.169.254/latest/meta-data/", "http://10.0.0.5:8080/internal", "http://localhost:5432/", "https://fonts.googleapis.com.evil.com/x", "http://localhost:3000.evil.com/", "not a url"]) {
      expect(exportUrlAllowed(u, origins), u).toBe(false);
    }
  });
  it("exportOrigins allows exactly the web app, the uploads bucket and Google Fonts", async () => {
    const { exportOrigins } = await import("../src/export.ts");
    const { storageOrigin } = await import("@chitrapx/storage");
    expect(exportOrigins()).toEqual([new URL(process.env.WEB_ORIGIN ?? "http://localhost:3000").origin, storageOrigin("uploads"), "https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
  });
});
