export const INTAKE_MAX = 20;
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_DEPTH = 3;

/** "shot2" before "shot10", case-insensitive. */
export const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Images we can upload, in natural order and capped per drop; everything else is reported (dotfiles silently skipped). */
export function acceptImages(files: File[]): { accepted: File[]; rejected: string[] } {
  const rejected: string[] = [];
  const ok: File[] = [];
  for (const file of files) {
    if (file.name.startsWith(".")) continue;
    if (!IMAGE_TYPES.has(file.type)) rejected.push(`${file.name}: not a PNG, JPEG or WebP image`);
    else if (file.size > IMAGE_MAX_BYTES) rejected.push(`${file.name}: larger than 25 MB`);
    else ok.push(file);
  }
  ok.sort((a, b) => naturalSort(a.name, b.name));
  if (ok.length > INTAKE_MAX) rejected.push(`${ok.length - INTAKE_MAX} more files skipped: at most ${INTAKE_MAX} per drop`);
  return { accepted: ok.slice(0, INTAKE_MAX), rejected };
}

/** True for drags from the operating system (files), false for element drags inside the page. */
export const isFileDrag = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes("Files");

/**
 * Every file in a drop, walking dropped folders up to three levels deep. Entries are read
 * synchronously here because the browser empties the DataTransfer once the drop handler returns.
 */
export function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items).filter((i) => i.kind === "file");
  const entries = items.map((i) => i.webkitGetAsEntry?.() ?? null);
  const loose = items.flatMap((it, i) => (entries[i] ? [] : [it.getAsFile()].filter((f): f is File => !!f)));
  return settled(entries.filter((e): e is FileSystemEntry => e !== null).map((e) => walk(e, 0))).then((all) => [...loose, ...all.flat()]);
}

async function walk(entry: FileSystemEntry, depth: number): Promise<File[]> {
  if (entry.isFile) return [await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))];
  if (!entry.isDirectory || depth >= MAX_DEPTH) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    children.push(...batch);
  }
  return (await settled(children.map((c) => walk(c, depth + 1)))).flat();
}

/** Keeps the results that succeeded: one unreadable entry must not stop the rest. */
async function settled<T>(promises: Promise<T>[]): Promise<T[]> {
  return (await Promise.allSettled(promises)).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}
