// RFC 4180 field quoting and the CSV parser are ported from open-screenshot-generator (MIT),
// src/lib/i18n/translationCsv.ts (csvField, parseCsv). Columns, id matching and the import plan are Chitrapx's own.
import type { ChitrapxDoc } from "./doc.ts";
import { cellFor, translationRows, type TranslationWrite } from "./translations.ts";

export type ImportChange = TranslationWrite & { kind: "added" | "changed"; label: string; from: string };
export type ImportPlan = { changes: ImportChange[]; unchanged: number; unknownIds: string[]; unknownLocales: string[] };
export class ImportError extends Error {
  constructor(public code: "no_id_column" | "not_json") { super(code); }
}

const PEOPLE_COLUMNS = ["id", "board", "label"];

/** Quote when the field holds a delimiter, doubling the quotes. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A real parser: translated headlines contain commas, and spreadsheets quote cells that hold line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Excel writes a BOM on UTF-8 CSVs; it would otherwise stick to the first header name.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => { row.push(field); field = ""; rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { quoted = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { endRow(); i += text[i + 1] === "\n" ? 2 : 1; continue; }
    if (ch === "\n") { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows.filter((cells) => cells.some((c) => c.trim() !== ""));
}

/** Texts store "\n"; a cell that came back with CRLF must compare equal. */
const normalizeCell = (v: string | undefined) => (v ?? "").replace(/\r\n?/g, "\n");

/** One row per text, then the base column and one column per language. BOM and CRLF, so Excel opens it as written. */
export function toCsv(doc: ChitrapxDoc): string {
  const locales = doc.localization.locales.map((l) => l.code);
  const lines = [[...PEOPLE_COLUMNS, doc.localization.baseLocale, ...locales].map(csvField).join(",")];
  for (const row of translationRows(doc)) {
    lines.push([row.id, row.board, row.label, row.base, ...locales.map((l) => cellFor(doc, row, l).text)].map(csvField).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** The base language and every translated cell; untranslated cells are left out. */
export function toJson(doc: ChitrapxDoc): string {
  const rows = translationRows(doc);
  const out: Record<string, Record<string, string>> = { [doc.localization.baseLocale]: Object.fromEntries(rows.map((r) => [r.id, r.base])) };
  for (const { code } of doc.localization.locales) {
    out[code] = Object.fromEntries(rows.flatMap((r) => { const c = cellFor(doc, r, code); return c.text ? [[r.id, c.text]] : []; }));
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Compares incoming cells with what is stored. An empty cell is skipped: a blank never deletes a translation. */
function plan(doc: ChitrapxDoc, entries: Array<{ id: string; values: Array<{ locale: string; text: string }> }>, unknownLocales: string[]): ImportPlan {
  const rows = new Map(translationRows(doc).map((r) => [r.id, r]));
  const changes: ImportChange[] = [];
  const unknownIds: string[] = [];
  let unchanged = 0;
  for (const { id, values } of entries) {
    const row = rows.get(id);
    if (!row) { if (!unknownIds.includes(id)) unknownIds.push(id); continue; }
    for (const { locale, text } of values) {
      if (!text.trim()) continue; // a blank (or spaces-only) cell never clears or blanks a translation
      const from = cellFor(doc, row, locale).text;
      if (from === text) { unchanged++; continue; }
      changes.push({ locale, id, text, from, label: row.label, kind: from ? "changed" : "added" });
    }
  }
  return { changes, unchanged, unknownIds, unknownLocales };
}

export function planCsvImport(doc: ChitrapxDoc, text: string): ImportPlan {
  const table = parseCsv(text);
  if (!table.length) return { changes: [], unchanged: 0, unknownIds: [], unknownLocales: [] };
  const header = table[0]!.map((h) => h.trim());
  const idCol = header.findIndex((h) => h.toLowerCase() === "id");
  if (idCol < 0) throw new ImportError("no_id_column");
  const base = doc.localization.baseLocale;
  const known = new Set(doc.localization.locales.map((l) => l.code));
  const columns = header.flatMap((h, col) => (known.has(h) ? [{ locale: h, col }] : []));
  const unknownLocales = header.filter((h) => h && !PEOPLE_COLUMNS.includes(h.toLowerCase()) && h !== base && !known.has(h));
  const entries = table.slice(1).flatMap((cells) => {
    const id = (cells[idCol] ?? "").trim();
    return id ? [{ id, values: columns.map(({ locale, col }) => ({ locale, text: normalizeCell(cells[col]) })) }] : [];
  });
  return plan(doc, entries, unknownLocales);
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function planJsonImport(doc: ChitrapxDoc, text: string): ImportPlan {
  let data: unknown;
  try { data = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new ImportError("not_json"); }
  if (!isRecord(data) || !Object.values(data).every((m) => isRecord(m) && Object.values(m).every((t) => typeof t === "string"))) {
    throw new ImportError("not_json");
  }
  const base = doc.localization.baseLocale;
  const known = new Set(doc.localization.locales.map((l) => l.code));
  const unknownLocales = Object.keys(data).filter((l) => l !== base && !known.has(l));
  const byId = new Map<string, Array<{ locale: string; text: string }>>();
  for (const [locale, map] of Object.entries(data as Record<string, Record<string, string>>)) {
    if (locale !== base && !known.has(locale)) continue;
    for (const [id, value] of Object.entries(map)) {
      const list = byId.get(id) ?? [];
      if (locale !== base) list.push({ locale, text: normalizeCell(value) });
      byId.set(id, list);
    }
  }
  return plan(doc, [...byId].map(([id, values]) => ({ id, values })), unknownLocales);
}
