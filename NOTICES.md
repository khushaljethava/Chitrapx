# Third-party notices

Chitrapx reuses material from the MIT-licensed projects below. Each entry lists what was reused and its copyright line. Every file under `packages/assets/third-party/` must appear here.

| Project | Copyright | Reused material |
|---|---|---|
| [open-screenshot-generator](https://github.com/dotnetdreamer/open-screenshot-generator) (MIT) | Copyright (c) 2026 Idrees Khan | Artboard document types (`packages/document/src/artboard.ts`); static renderer, element renderers, device chrome and procedural 3D devices, backgrounds, text fitting, font list and locale projection (`packages/renderer/src/osg/**`, each file headed with its original path); template layouts converted into `packages/assets/templates/` with all artwork references removed. OSG's image files are **not** used: they are not MIT licensed (see OSG `THIRD-PARTY-ASSETS.md`). Also: group header rows in the Layers panel (`apps/web/src/editor/ui/LayersPanel.tsx`); file intake (`apps/web/src/editor/intake.ts`). |
| [PixelDeck](https://github.com/Pr0xS/PixelDeck) (MIT) | Copyright (c) 2025-2026 PixelDeck contributors | Layers panel structure and sortable row (`apps/web/src/editor/ui/LayersPanel.tsx`); status bar drawing and per-device status bar heights (`packages/renderer/src/osg/elements/StatusBar.tsx`, `packages/document/src/deviceStatusBar.ts`). |
| Test fixture fonts (SIL Open Font License 1.1) | Inter © The Inter Project Authors; Pacifico © Vernon Adams; Source Sans 3 © Adobe | Small subsets used only by tests (`packages/db/test/fixtures/fonts/`), never shipped to users. |
