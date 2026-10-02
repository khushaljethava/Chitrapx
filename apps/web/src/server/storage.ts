import { adminClient } from "@/lib/supabase/admin.ts";

/** The slice of object storage uploads need; Supabase in production, in-memory in tests. */
export interface ObjectStorage {
  signUpload(path: string): Promise<{ path: string; token: string }>;
  download(path: string): Promise<Buffer>;
  remove(path: string): Promise<void>;
  signedUrls(paths: string[]): Promise<string[]>;
}

export const UPLOADS_BUCKET = "uploads";

export function supabaseStorage(): ObjectStorage {
  const bucket = () => adminClient().storage.from(UPLOADS_BUCKET);
  return {
    async signUpload(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true });
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
    async signedUrls(paths) {
      if (!paths.length) return [];
      const { data, error } = await bucket().createSignedUrls(paths, 3600);
      if (error) throw error;
      return data.map((d) => d.signedUrl ?? "");
    },
  };
}
