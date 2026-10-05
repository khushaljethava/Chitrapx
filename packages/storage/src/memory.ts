import { ObjectMissingError, type Bucket, type ObjectStorage } from "./types.ts";

/** In-memory ObjectStorage for unit tests. Files are keyed "<bucket>/<path>". */
export class MemoryStorage implements ObjectStorage {
  files = new Map<string, Buffer>();
  types = new Map<string, string>();
  /** Every path a PUT was presigned for, in order. */
  signed: string[] = [];
  /** How far the last downloadStream reader got, in bytes. */
  readBytes = 0;
  private k = (path: string, bucket: Bucket = "uploads") => `${bucket}/${path}`;

  async presignPut(path: string, opts: { contentType: string; contentLength: number; bucket?: Bucket }) {
    this.signed.push(path);
    return { url: `memory://${opts.bucket ?? "uploads"}/${path}?put`, headers: { "Content-Type": opts.contentType, "If-None-Match": "*" } };
  }
  async download(path: string, bucket?: Bucket) {
    const f = this.files.get(this.k(path, bucket));
    if (!f) throw new ObjectMissingError(path);
    return f;
  }
  async downloadStream(path: string, bucket?: Bucket) {
    const f = await this.download(path, bucket);
    let at = 0;
    this.readBytes = 0;
    return new ReadableStream<Uint8Array>({
      pull: (c) => {
        if (at >= f.length) { c.close(); return; }
        const chunk = f.subarray(at, at + 65536); at += chunk.length; this.readBytes = at; c.enqueue(chunk);
      },
    });
  }
  async put(path: string, bytes: Uint8Array, contentType: string, bucket?: Bucket) {
    this.files.set(this.k(path, bucket), Buffer.from(bytes));
    this.types.set(this.k(path, bucket), contentType);
  }
  async remove(path: string, bucket?: Bucket) { this.files.delete(this.k(path, bucket)); this.types.delete(this.k(path, bucket)); }
  async exists(path: string, bucket?: Bucket) { return this.files.has(this.k(path, bucket)); }
  async move(from: string, to: string, opts: { contentType?: string; bucket?: Bucket } = {}) {
    const src = this.k(from, opts.bucket), dst = this.k(to, opts.bucket);
    const f = this.files.get(src);
    if (!f) throw new ObjectMissingError(from);
    if (this.files.has(dst)) throw new Error(`move target exists: ${to}`);
    this.files.set(dst, f); this.types.set(dst, opts.contentType ?? this.types.get(src) ?? "application/octet-stream");
    this.files.delete(src); this.types.delete(src);
  }
  async signedUrls(paths: string[], bucket: Bucket = "uploads") { return paths.map((p) => `memory://${bucket}/${p}`); }
  async signedDownload(path: string, filename: string, bucket: Bucket = "exports") { return `memory://${bucket}/${path}?download=${encodeURIComponent(filename)}`; }
}

export const memoryStorage = () => new MemoryStorage();
