/**
 * A tiny reader for the Keep a Changelog subset CHANGELOG.md uses: `## [version] - date` releases,
 * `### Section` headings, `- ` bullets (indented lines continue a bullet), `code` and **bold**.
 * It returns plain data, never HTML, so whatever the file contains is rendered as text.
 */
export type Inline = { text: string; code?: true; bold?: true };
export type ChangelogSection = { title: string; items: Inline[][] };
export type Release = { version: string; date: string | null; sections: ChangelogSection[] };

const RELEASE = /^##\s+\[?([^\]\s]+)\]?(?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const SECTION = /^###\s+(.+?)\s*$/;
const BULLET = /^[-*]\s+(.*)$/;

/** Splits `code` and **bold** spans out of one bullet's text. Unmatched markers stay literal. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { text: m[1], code: true } : { text: m[2]!, bold: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let bullet: string[] | null = null;
  const flush = () => {
    const r = releases.at(-1);
    if (bullet && r) {
      if (!r.sections.length) r.sections.push({ title: "", items: [] });
      r.sections.at(-1)!.items.push(parseInline(bullet.join(" ")));
    }
    bullet = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const release = RELEASE.exec(line);
    if (release) { flush(); releases.push({ version: release[1]!, date: release[2] ?? null, sections: [] }); continue; }
    if (!releases.length) continue;
    const section = SECTION.exec(line);
    if (section) { flush(); releases.at(-1)!.sections.push({ title: section[1]!, items: [] }); continue; }
    const item = BULLET.exec(line);
    if (item) { flush(); bullet = [item[1]!.trim()]; continue; }
    if (bullet && /^\s+\S/.test(line)) { bullet.push(line.trim()); continue; }
    flush();
  }
  flush();
  return releases;
}
