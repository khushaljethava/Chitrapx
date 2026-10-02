# Sub-project 5: ASO Tools

**Date:** 2026-10-02
**Status:** Derived from the approved architecture (main spec, section A8); built on the user's instruction "go".
**Parent spec:** `2026-10-02-chitrapx-design.md`

## Goal

Help a customer ship screenshots that convert: catch weak headlines before export, show what shoppers see first, preview the set inside realistic store pages, and produce A/B variant sets for store experiments.

## Decisions

1. **Headline checks** (`packages/document/src/aso.ts`, pure). For each board, in the active language (base text plus that language's overrides):
   - the headline is the text with the largest rendered size (fontSize / 0.3, OSG's rule);
   - more than 5 words on a headline line: warning; more than 2 headline lines (explicit line breaks plus estimated wrapping): warning;
   - any text smaller than 9 px when the board is shown 400 px tall (store thumbnail): warning;
   - text against what is behind it (the topmost overlapping shape, otherwise the board background, both gradient ends checked) below contrast 3:1: error;
   - a translation more than 40 percent longer than the base text: warning (may overflow).
2. **Fold markers:** iOS, iPad, Mac and Watch boards 1 to 3, Android and Play boards 1 to 2, are labelled "Seen first" on the canvas and in previews.
3. **Store listing preview** (`/dashboard/projects/[id]/preview`): App Store search result and product page, and Google Play listing, in light or dark, for any project language, built from the project's own boards. Mockups are drawn with HTML and CSS (no store artwork or trademarked icons).
4. **A/B variant sets:** a group can be duplicated as a variant (`variant: "B"`, then "C") with the same store size. Variants export into their own folder (`ios/iphone-6.9-B/...`). Names are single capital letters.
5. **Competitor reference board:** deferred to a later sub-project (it is an additional paid AI feature).

## Acceptance criteria

- A 7-word headline line, a 3-line headline, 20 px body text on a 2796 px board, white text on a white background, and a German override 60 percent longer than English each produce their issue; a clean board produces none.
- The editor lists the active language's issues; clicking one selects the element.
- Boards 1 to 3 (iOS) and 1 to 2 (Play) carry the "Seen first" marker.
- The preview page renders all three store mockups for the chosen language and theme.
- Duplicating a group as variant B and exporting produces files under `<platform>/<target>-B/`.
