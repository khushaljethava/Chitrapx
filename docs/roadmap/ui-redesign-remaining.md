# UI redesign: remaining work

As of 2026-10-07. The Stitch redesign shipped in two commits on `main`: `1b558ba` (design system, landing, login, dashboard, app and project pages, editor layout) and `6dc1c22` (every other page, editor dialogs, dashboard extras, Share in the editor). All 18 user-facing pages are redesigned. What follows is what is left.

## Screens still on the old look

None. The view-only editor, Access removed, 404 (`app/not-found.tsx`) and error (`app/error.tsx`) screens were redesigned on 2026-10-07 and share `components/Notice.tsx`. Stitch returned a design file only for Access removed; the 404, error and view-only requests reported success but never appeared in the project, so those follow Stitch's description of them. The 404, error and Access removed pages were checked in light and dark at desktop and 390px. The view-only editor was not checked in a browser (it needs a viewer account).

## Left alone on purpose

- `apps/web/src/app/render/[jobId]/page.tsx` is the internal page that draws boards for PNG and video export. Restyling it would change exported images.

## Built without a Stitch design

- Stitch failed to return the app page and project page designs after five requests across both models, so those pages follow the written prompts.
- Only landing, login, dashboard and editor have Stitch screens (Stitch project `9646446051787370611`, design system "Chitrapx"). Team, billing, community, templates, launch assets, store preview, the public pages and the editor dialogs were designed in code from the design system.

## Redesigned but not checked in a browser

- Shared project page (`/s/[slug]`) and invite page.
- Editor dialogs: Translations, History, Conflict, Comments.
- Community post and review pages, Store preview, Launch assets. These were only measured for no sideways scroll at 390px.
- Dashboard covers with real images: the test account has no uploaded screenshots, so only the empty placeholders were seen.
- Presence avatars: they only show when a second person is in the project.

## Known issues

- After deleting a project, the "Confirm" button can stay on screen until a reload, although the project is deleted. Not caused by the redesign; not investigated.
- `listApps` and `appCovers` read every export job and every screenshot row in the workspace and trim per app in code. Fine at current sizes; switch to `DISTINCT ON` or a window query if workspaces grow large.
- Most web tests need the database and did not run during the redesign. The 7 database-free files pass (78 tests).

## Next steps

1. Browser pass over the view-only editor and over the unchecked screens above, in light and dark mode and at phone width.
2. Ask Stitch again for the app and project page designs and compare.
3. Run the full test suite against a reachable database.
