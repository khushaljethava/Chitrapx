import { api, ApiError } from "@/server/api.ts";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** PUTs the file to a presigned URL with exactly the headers the server signed. */
export async function putSigned(signed: { url: string; headers: Record<string, string> }, file: File): Promise<void> {
  const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: file }).catch(() => null);
  if (!res?.ok) throw new Error("Upload failed — try again");
}

type Signed = { existing?: { id: string }; uploadId?: string; url?: string; headers?: Record<string, string> };

/** Signed upload of one file into the app's assets; the server re-checks type, size and checksum. Returns the asset id. */
export async function uploadAsset(appId: string, kind: "screenshot" | "recording", file: File): Promise<{ id: string }> {
  const sha256 = await sha256Hex(file);
  const signed = await api<Signed>("/api/uploads/sign", "POST", { appId, kind, size: file.size, mime: file.type, sha256 });
  if (signed.existing) return { id: signed.existing.id };
  try { await putSigned({ url: signed.url!, headers: signed.headers! }, file); }
  catch (err) { throw new Error(`${file.name}: ${(err as Error).message}`); }
  const asset = await api<{ id: string }>("/api/uploads/complete", "POST", { appId, kind, sha256, uploadId: signed.uploadId });
  return { id: asset.id };
}

const FONT_MESSAGES: Record<string, string> = {
  unsupported_type: "This file is not a TTF, OTF, WOFF or WOFF2 font.",
  too_large: "Fonts can be up to 10 MB.",
  font_restricted: "This font's licence does not allow embedding.",
  font_unreadable: "This file could not be read as a font.",
  embed_rights_required: "Confirm you have the right to embed this font.",
};

/** The upload dialog's inline message for any failure. Quota and duplicate-face messages come from the server with their counts. */
export function fontUploadMessage(err: unknown): string {
  if (err instanceof ApiError) return FONT_MESSAGES[err.code] ?? err.message;
  return err instanceof Error ? err.message : "Upload failed — try again";
}

/** Uploads one font face into the workspace. The caller has already confirmed the embedding rights. */
export async function uploadFont(file: File): Promise<{ id: string; family: string }> {
  const sha256 = await sha256Hex(file);
  const signed = await api<{ existing?: { id: string; meta?: { family?: string } }; uploadId?: string; url?: string; headers?: Record<string, string> }>(
    "/api/uploads/sign", "POST", { kind: "font", size: file.size, sha256, embedRights: true });
  if (signed.existing) return { id: signed.existing.id, family: signed.existing.meta?.family ?? "" };
  await putSigned({ url: signed.url!, headers: signed.headers! }, file);
  const asset = await api<{ id: string; meta: { family: string } }>("/api/uploads/complete", "POST", { kind: "font", sha256, uploadId: signed.uploadId });
  return { id: asset.id, family: asset.meta.family };
}
