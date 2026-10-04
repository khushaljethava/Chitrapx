import { createClient } from "@/lib/supabase/browser.ts";
import { api } from "@/server/api.ts";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Signed upload of one file into the app's assets; the server re-checks type, size and checksum. Returns the asset id. */
export async function uploadAsset(appId: string, kind: "screenshot" | "recording", file: File): Promise<{ id: string }> {
  const sha256 = await sha256Hex(file);
  const signed = await api<{ existing?: { id: string }; uploadId?: string; path?: string; token?: string }>("/api/uploads/sign", "POST", {
    appId, kind, size: file.size, mime: file.type, sha256,
  });
  if (signed.existing) return { id: signed.existing.id };
  const { error } = await createClient().storage.from("uploads").uploadToSignedUrl(signed.path!, signed.token!, file, { contentType: file.type });
  if (error) throw new Error(`${file.name}: ${error.message}`);
  const asset = await api<{ id: string }>("/api/uploads/complete", "POST", { appId, kind, sha256, uploadId: signed.uploadId });
  return { id: asset.id };
}
