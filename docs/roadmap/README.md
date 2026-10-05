# Chitrapx roadmap: closing the gaps

Features Chitrapx is missing compared with the six reference tools in this workspace, grouped into sub-projects. Each file breaks a group into features with behaviour, acceptance criteria, the Chitrapx files to change, and paths to the reference code. Each group still goes through its own spec, plan and build before any code is written.

| # | Group | Status | File |
|---|---|---|---|
| SP8 | Sizes and export | Done (on `main`) | [sp08-sizes-export.md](sp08-sizes-export.md) |
| SP9 | Editor essentials | Done (on `main`) | [sp09-editor-essentials.md](sp09-editor-essentials.md) |
| SP10 | Typography and style | Done (on `main`) | [sp10-typography-style.md](sp10-typography-style.md) |
| SP11 | Localization and AI copy | Done (on `main`) | [sp11-localization-ai-copy.md](sp11-localization-ai-copy.md) |
| SP12 | Launch assets | Not started | [sp12-launch-assets.md](sp12-launch-assets.md) |
| SP13 | Developer automation | Dropped (2026-10-05): no public API, CLI or MCP server | — |
| SP14 | Store publishing and sync | Dropped (2026-10-05): not building store upload or Drive/GitHub sync | — |
| SP15 | Collaboration | Not started | [sp15-collaboration.md](sp15-collaboration.md) |
| SP16 | Polish | Not started | [sp16-polish.md](sp16-polish.md) |

Build order: SP10 → SP11 → SP12 → SP15. SP16 can go in any time.

## Reference repos

All paths in these files are relative to `/home/khushal/raw_codes/screenly/`.

| Repo | License | What may be reused |
|---|---|---|
| `open-screenshot-generator` | MIT | Code and templates, with attribution in `NOTICES.md`. Check `THIRD-PARTY-ASSETS.md` per asset. |
| `PixelDeck` | MIT | Code, with attribution. |
| `app-store-screenshots` | MIT | Code, with attribution. |
| `launch` | MIT | Code and device frames, with attribution. |
| `appshots` | MIT per README, no LICENSE file | Reference only. Copy nothing. |
| `storeshots` | AGPL-3.0 | Ideas only. Copy no code, text or assets. |

Out of scope by decision: desktop app, browser extension, bring-your-own AI key, text-to-speech and video title cards.

`_TEMPLATE.md` is the layout every group file follows.
