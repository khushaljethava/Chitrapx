import { z } from "zod";

// ponytail: minimal shape until packages/document owns ChitrapxDoc in sub-project 2.
export const projectKinds = ["screenshots", "video", "social"] as const;
export type ProjectKind = (typeof projectKinds)[number];

export const docSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(projectKinds),
  groups: z.array(z.unknown()),
  localization: z.object({ locales: z.array(z.unknown()) }).passthrough(),
}).passthrough();
export type ChitrapxDocV1 = z.infer<typeof docSchema>;

export function emptyDoc(kind: ProjectKind): ChitrapxDocV1 {
  return { schemaVersion: 1, kind, groups: [], localization: { locales: [] } };
}
