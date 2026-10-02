import { adminClient } from "@/lib/supabase/admin.ts";

/** The slice of object storage uploads need; Supabase in production, in-memory in tests. */
export interface ObjectStorage {
  signUpload(path: string): Promise<{ path: string; token: string }>;
  download(path: string): Promise<Buffer>;
  remove(path: string): Promise<void>;
  /** Fails if `to` already exists. */
  move(from: string, to: string): Promise<void>;
  signedUrls(paths: string[]): Promise<string[]>;
  /** A 5-minute link that downloads an export ZIP under `filename`. */
  signedDownload(path: string, filename: string): Promise<string>;
}

export const UPLOADS_BUCKET = "uploads";
export const EXPORTS_BUCKET = "exports";

export function supabaseStorage(): ObjectStorage {
  const bucket = () => adminClient().storage.from(UPLOADS_BUCKET);
  return {
    async signUpload(path) {
      // No upsert: a token can create its staging object once and never overwrite anything.
      const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: false });
      if (error) throw error;
      return { path: data.path, token: data.token };
    },
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error) throw error;
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw error;
    },
    async move(from, to) {
      const { error } = await bucket().move(from, to);
      if (error) throw error;
    },
    async signedDownload(path, filename) {
      const { data, error } = await adminClient().storage.from(EXPORTS_BUCKET).createSignedUrl(path, 300, { download: filename });
      if (error) throw error;
      return data.signedUrl;
    },
    async signedUrls(paths) {
      if (!paths.length) return [];
      const { data, error } = await bucket().createSignedUrls(paths, 3600);
      if (error) throw error;
      return data.map((d) => d.signedUrl ?? "");
    },
  };
}
