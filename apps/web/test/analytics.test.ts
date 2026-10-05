import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanEvent, normalizePath } from "@/lib/analyticsEvents.ts";
import { CONSENT_COOKIE, consentCookie, effectiveConsent, parseConsent, privacySignal } from "@/lib/consent.ts";
import { cspHeader } from "@/lib/csp.ts";
import { setTrackingEnabled, setTransport, track } from "@/lib/track.ts";

describe("consent cookie", () => {
  it("round-trips a choice for the current version", () => {
    const set = consentCookie("granted", 1);
    expect(set).toMatch(new RegExp(`^${CONSENT_COOKIE}=1\\.granted; Path=/; Max-Age=\\d+; SameSite=Lax`));
    const header = `other=x; ${set.split(";")[0]}; more=y`;
    expect(parseConsent(header, 1)).toBe("granted");
    expect(parseConsent(`${CONSENT_COOKIE}=1.denied`, 1)).toBe("denied");
  });
  it("a new consent version asks again; garbage is ignored", () => {
    expect(parseConsent(`${CONSENT_COOKIE}=1.granted`, 2)).toBeNull();
    expect(parseConsent(`${CONSENT_COOKIE}=1.maybe`, 1)).toBeNull();
    expect(parseConsent(`${CONSENT_COOKIE}=`, 1)).toBeNull();
    expect(parseConsent("", 1)).toBeNull();
  });
  it("Do Not Track and Global Privacy Control mean no, without asking", () => {
    expect(privacySignal({ doNotTrack: "1" })).toBe(true);
    expect(privacySignal({ globalPrivacyControl: true })).toBe(true);
    expect(privacySignal({ doNotTrack: "0", globalPrivacyControl: false })).toBe(false);
    expect(effectiveConsent("", { globalPrivacyControl: true }, 1)).toBe("denied");
    expect(effectiveConsent(`${CONSENT_COOKIE}=1.granted`, { doNotTrack: "1" }, 1)).toBe("denied");
    expect(effectiveConsent("", {}, 1)).toBe("ask");
    expect(effectiveConsent(`${CONSENT_COOKIE}=1.granted`, {}, 1)).toBe("granted");
  });
});

describe("analytics event allow-list", () => {
  it("normalises paths: no query, hash, ids, emails or numbers survive", () => {
    expect(normalizePath("/dashboard/projects/3f2b8c1e-1234-4abc-9def-0123456789ab?x=1#y")).toBe("/dashboard/projects/:id");
    expect(normalizePath("/u/someone@example.com/1234567")).toBe("/u/:x/:n");
    expect(normalizePath("https://evil.example/path")).toBe("/");
    expect(normalizePath("x".repeat(500)).length).toBeLessThanOrEqual(200);
  });
  it("keeps only known events and allow-listed prop values", () => {
    expect(cleanEvent({ name: "export_started", path: "/editor/3f2b8c1e-1234-4abc-9def-0123456789ab", props: { kind: "zip", projectName: "Secret", email: "a@b.c" } }))
      .toEqual({ name: "export_started", path: "/editor/:id", props: { kind: "zip" } });
    expect(cleanEvent({ name: "project_created", path: "/", props: { source: "My Project Name" } })).toEqual({ name: "project_created", path: "/", props: {} });
    expect(cleanEvent({ name: "page_view", path: "/", props: { userId: "u1" } })).toEqual({ name: "page_view", path: "/", props: {} });
    expect(cleanEvent({ name: "steal_cookies", path: "/" })).toBeNull();
    expect(cleanEvent("nope")).toBeNull();
    expect(cleanEvent({ name: "page_view", path: 42 })).toEqual({ name: "page_view", path: "/", props: {} });
  });
});

describe("track()", () => {
  afterEach(() => { setTrackingEnabled(false); setTransport(null); });

  it("sends nothing before consent and nothing after it is revoked", () => {
    const send = vi.fn();
    setTransport(send);
    expect(track("page_view")).toBe(false);
    setTrackingEnabled(true);
    expect(track("export_started", { kind: "zip" })).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0]![0] as string)).toMatchObject({ name: "export_started", props: { kind: "zip" } });
    setTrackingEnabled(false);
    expect(track("page_view")).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("drops values outside the allow-list before they leave the browser", () => {
    const send = vi.fn();
    setTransport(send);
    setTrackingEnabled(true);
    track("project_created", { source: "someone@example.com" });
    expect(JSON.parse(send.mock.calls[0]![0] as string).props).toEqual({});
  });
});

describe("content security policy (report-only)", () => {
  const csp = cspHeader({ supabaseUrl: "https://abc.supabase.co", storageEndpoint: "https://s3.example.com", dev: false });
  const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

  it("loads scripts only from us and Razorpay checkout: no analytics host at all", () => {
    expect(directive("script-src").split(" ").filter((s) => s.startsWith("http"))).toEqual(["https://checkout.razorpay.com"]);
    expect(csp).not.toMatch(/umami|plausible|google-analytics|googletagmanager/);
    expect(directive("script-src")).not.toContain("unsafe-eval");
  });
  it("allows Supabase and the storage origin where the app needs them", () => {
    expect(directive("connect-src")).toContain("https://abc.supabase.co");
    expect(directive("connect-src")).toContain("https://s3.example.com");
    expect(directive("img-src")).toContain("https://s3.example.com");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
  });
  it("dev adds eval for React's debugging only", () => {
    expect(cspHeader({ supabaseUrl: "", dev: true })).toContain("'unsafe-eval'");
  });
});
