/** Runs once when the server starts: a deploy without storage settings fails here, naming the variable. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { storageConfig } = await import("@chitrapx/storage");
  storageConfig();
}
