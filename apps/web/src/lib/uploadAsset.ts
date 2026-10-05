import { api } from "@/server/api.ts";

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
