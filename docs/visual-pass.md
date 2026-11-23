# Visual pass over the finished page

## Why

Four features were added on top of the layout from `docs/design.md`: the ban panel, draft mode, the series
outlook and the written note. Each works, but together they broke the page's order. At 1920 x 1080 the
pool matrix now starts about 870 px down in planning mode and is fully off the first screen in draft mode,
and the ban rows a user must click during a draft sit below a 2,000 px matrix. This pass changes layout and
styling only. No calculation, no number and no wording about the method changes.

The look from `docs/design.md` section 2 stays: the colour tokens, Barlow Condensed and Inter, ember for
burned, blue and red for map side only. Use the existing tokens; add no new colours.

Two runs. Do one section, report every numbered item as "done" or "not done" with the file changed, and
stop. All measurements are at a 1920 x 1080 window on the default series, game 3.

## 1. Page order and density

1. **Briefing row.** The written note and the series outlook sit side by side in one row under the game
   buttons: the note on the left (about 40% of the width), the outlook on the right. Without a note the
   outlook takes the whole row. Under 1,200 px they stack.
2. **Note:** text lines no longer than about 75 characters (`max-width: 75ch`), the three points as three
   short paragraphs with their titles inline in ember ("Their pools — …"), the team switch in the block's
   header. Attribution in one muted line. Show the model as a name ("Gemini 3.8 Flash"), built from the
   model id by a small function, not the raw id.
3. **Outlook:** two compact team tables next to each other. Each row: player name, a bar of fixed width
   (120 px), the burned share, and the expectation in muted text ("+21% this game"). No row stretches to
   fill the width. Fix the team line's missing space ("Mean 30% burned · deepest: bot, 51%").
4. **Pick cost** becomes one line under the outlook: the label, the search field, and the result beside
   it on the same line (wrapping below when long). The explanation sentence moves into the search field's
   placeholder ("What does a pick cost? Search a champion").
5. **Height limit.** The briefing row is at most 300 px high with a note and 220 px without. The matrix's
   team header starts at most 620 px from the top of the page in planning mode.
6. **Ban panel next to the matrix start.** "Bans & Denial Picks" moves above the matrix as a two-column
   block whose columns line up with the matrix's team columns, collapsed to its first three rows per
   section with "show all". It no longer sits below the matrix.
7. **Sticky headers.** The matrix's team header row stays at the top of the window while the matrix
   scrolls (`position: sticky`), so the user always sees which column is which team.
8. **Buttons.** "Reveal Game N" stays the one filled button. "Draft Game N" and "Replay Draft" are outline
   buttons. The replay's confirmation text is a line next to the button, not inside it.

## 2. Draft mode and details

1. **The draft bar is sticky** at the top of the window and at most 132 px high. It holds: the two slot
   rows, the turn line, Undo and Reset, and the ban search on a ban turn. The first-team choice moves into
   the bar's header as two small buttons (the two team names) instead of a select.
2. **Slots:** each at least 84 px wide and 24 px high, the full champion name in 12 px text, an ellipsis
   only for names that still do not fit. Bans struck through and muted, picks in normal text. Four small
   phase labels above the slots: "Bans", "Picks", "Bans", "Picks". The current slot has an ember outline.
3. **Turn line:** normal text, not orange italic: "Movistar KOI to ban" or "G2 Esports to pick: click a
   champion in their column". The acting team's column header in the matrix gets an ember underline.
4. **In draft mode the briefing row collapses** to one line ("Pre-game note and series outlook — show")
   once the first action is entered, so the matrix and the ban panel are in view. The user can open it.
5. **On a ban turn** the ban panel's column of the acting team is outlined and its rows are clearly
   buttons (hover background, pointer). On a pick turn the clickable tiles keep their outline; tiles in
   the other team's column are dimmed slightly.
6. **Contrast.** Muted text on tiles ("stale" tiles, the "% of recent picks" line) must reach a contrast
   ratio of 4.5:1 against the tile background. Dim by weight and size, not by opacity below that ratio.
7. **Numbers** use `font-variant-numeric: tabular-nums` everywhere (it is a value of that property; there
   is no `tabular-nums` property). Search the CSS for any other unknown property and remove it.
8. **Focus.** Every button and input shows a visible focus ring (2 px, `--blue-side`). The champion
   searches can be used with the keyboard: arrow keys move through the results, Enter selects, Escape
   closes.
9. **Narrow widths.** At 1,366 px nothing overlaps or scrolls sideways; the slot rows may wrap after the
   first phase. Under 900 px the team columns stack, as before.
10. **Reduced motion.** Any transition added here is off under `prefers-reduced-motion: reduce`.
11. Render cases stay green; adjust them only where the markup they look for has moved. Add one case: in
    draft mode with one action, the briefing row is collapsed and the ban panel comes before the matrix
    in the document.

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm lint` (no warnings), `pnpm build`, `pnpm check:data` pass. Do not run
`pnpm data` or `pnpm data:notes`; nothing in the data changes.
