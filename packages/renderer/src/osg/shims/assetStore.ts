export async function saveImageBlobAsset(_file: Blob, _opts?: unknown): Promise<{ ref: string; width: number; height: number }> {
  throw new Error("Uploads are handled by the app, not the renderer");
}
