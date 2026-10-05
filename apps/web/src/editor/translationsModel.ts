import { cellFor, localeProgress, translationRows, type ChitrapxDoc, type TranslationCell, type TranslationRow } from "@chitrapx/document";

/** Display name and direction of a locale code (the component passes the renderer's LOCALES). */
export type LocaleInfo = (code: string) => { name: string; rtl: boolean };
export type Column = { code: string; name: string; rtl: boolean; translated: number; total: number; stale: number };
export type TableRow = { row: TranslationRow; cells: Record<string, TranslationCell> };
export type TableModel = { base: { code: string; name: string; rtl: boolean }; columns: Column[]; sections: Array<{ boardId: string; board: string; rows: TableRow[] }> };

/** What the translations table draws: the base column, one column per language with its progress, rows grouped by board. */
export function tableModel(doc: ChitrapxDoc, info: LocaleInfo, filter: "all" | "missing" = "all"): TableModel {
  const codes = doc.localization.locales.map((l) => l.code);
  const columns = codes.map((code) => ({ code, ...info(code), ...localeProgress(doc, code) }));
  const sections: TableModel["sections"] = [];
  for (const row of translationRows(doc)) {
    const cells = Object.fromEntries(codes.map((c) => [c, cellFor(doc, row, c)]));
    if (filter === "missing" && !Object.values(cells).some((c) => c.state === "untranslated" || c.state.startsWith("stale"))) continue;
    const last = sections.at(-1);
    if (last?.boardId === row.boardId) last.rows.push({ row, cells });
    else sections.push({ boardId: row.boardId, board: row.board, rows: [{ row, cells }] });
  }
  return { base: { code: doc.localization.baseLocale, ...info(doc.localization.baseLocale) }, columns, sections };
}
