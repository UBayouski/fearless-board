# Test pass: cover what changed after the redesign

Brief for Junie, 2026-11-23. Work through the sections in order and stop after each one for review.

## Why

The redesign and the hosting work added behaviour that no test covers yet: the featured series in the series list, the icon fallback, the compact draft bar on phones, focus moving to Undo, and the site build's cleanup and checks. Each was checked by hand in a browser. This pass turns those checks into tests, so a later change cannot break them silently.

## Rules for the whole pass

- **Add tests; do not change behaviour.** The only production changes allowed are the ones named in this brief (section 3: a folder argument for two scripts). If a test shows a fault, stop and report it instead of fixing it.
- **Never weaken an existing test.** Do not delete, skip or loosen any assertion in the current 101 unit tests or 17 render tests.
- **No licensed data in tests.** Tests must not read `packages/app/public/data`, `public/data-demo`, `dist-*` or the hackathon data folder. Build small fixtures in the test file, as `SeriesBoard.test.tsx` and `featured.test.ts` do.
- **No snapshot tests.** Assert the specific text, attribute or count that matters.
- **Every new test must fail without the code it covers.** For each test, say in the report how you checked that (for example: commented out the line, saw the test fail, restored it).
- At the end of every section: `pnpm typecheck`, `pnpm test`, `pnpm lint` and `pnpm check:data` all pass.

## 1. Render tests (no new dependencies)

Add to `packages/app/src/components/` using the server rendering already used in `SeriesBoard.test.tsx` (`renderToString`, the `board()` helper, `UiContext.Provider`).

**`SeriesPicker.test.tsx`**, with an index of five series (one of them a single game) and two of them in `featuredIds`:
1. With some series not featured: the switch shows "Featured 2" pressed and "All 4" (the single game is not counted), and the list shows only the two featured series.
2. With every series featured (the demo case): no switch is rendered.
3. With `selectedId` set to a series that is not featured: the list starts on "All", and the featured ones carry the "Featured" mark.
4. The list is newest first (compare the order of two team names in the output).
5. The search field and both filters have accessible names: `aria-label="Search teams or events"`, `"Team"`, `"Event"`.

**`ChampIcon.test.tsx`**, rendering `ChampIcon` inside `UiContext.Provider` with a small `championMap`:
1. Icons on, version set, champion with an icon: an `<img>` with the Data Dragon address and, when `named`, the champion's name as `alt`.
2. Icons on, champion without an icon, `named`: the name in `<span class="icon-fallback">`, no `<img>`.
3. Icons on, no Data Dragon version, `named`: the name in the fallback span.
4. Same as 2 and 3 but not `named`: renders nothing.
5. Icons off: renders nothing in every case.

**`SeriesBoard.test.tsx`**, two cases added to the "practice draft" describe:
1. The draft strip has an Undo button with `id="draft-undo"` and a "Draft order, 0 of 20" toggle with `aria-expanded="false"` and `aria-controls="draft-order"`.
2. The slot rows are inside the element with `id="draft-order"`.

Stop here for review.

## 2. Interaction tests (one dev dependency)

Some behaviour only happens in a live page: an image that fails to load, a click that moves focus, a toggle. Add `jsdom` as a dev dependency of `packages/app` and run these files in it, either with `// @vitest-environment jsdom` at the top of each file or an `environmentMatchGlobs` entry in `vitest.config.ts`. Render with `createRoot` from `react-dom/client` and `act` from `react`; do not add a testing library. Focus moves in a `requestAnimationFrame` callback: Vitest's jsdom environment provides it, so wait with `await act(() => new Promise(r => requestAnimationFrame(() => r())))`. If it is missing, stop and report instead of changing the app.

Add `packages/app/src/components/interaction.test.tsx`:
1. **Icon fails to load:** render a `named` `ChampIcon`, fire an `error` event on the `<img>`, and expect the name in `.icon-fallback` and no `<img>`.
2. **Focus after a ban:** render `SeriesBoard` in practice draft (pass a session the way the existing practice-draft tests do), click the first `.rail button.opt`, wait one animation frame, and expect `document.activeElement.id` to be `draft-undo`.
3. **Focus after a pick:** reach a pick turn by clicking six ban rows, click the first `button.tile`, wait one frame, and expect focus on `draft-undo` and seven filled slots.
4. **Undo keeps focus:** after test 3, click Undo; expect six filled slots and focus still on Undo.
5. **Draft order toggle:** click the toggle; expect `aria-expanded="true"`, the strip to have class `open`, and the label to change to "Less".
6. **Featured switch:** in `SeriesPicker`, click "All"; expect the single-game series still absent and the non-featured series present.

Stop here for review.

## 3. Site build scripts

`scripts/clean-site.mjs` and `scripts/check-site.mjs` guard what goes onto the public site. Today they work only on `packages/app/dist-site`.

1. Let both take an optional folder as the first argument, defaulting to `packages/app/dist-site`, and let `clean-site.mjs` take the note prompt version from `packages/shared/src/note.ts` as now. `pnpm build:site` must behave exactly as before.
2. Add `scripts/site.test.mjs` (Node test runner; add it to the `test` script in the root `package.json`). Each test builds a small site in a temporary folder (`fs.mkdtempSync`) with an `index.html`, one asset, a manifest with `notes.count`, a series index of two series, two series files, and notes files. Then:
   - **clean** removes a `data-demo` folder, a `*.before` file, a series file that is not in the index, and a note file with an older `promptVersion`; it keeps the rest and sets `manifest.notes.count` to the number of notes left (one per team per game).
   - **check** passes on the cleaned folder.
   - **check** fails, with exit code 1 and a message naming the file, for each of: an extra file (`data/extra.csv`), a `.env` file, a series file missing for an index entry, a script containing `AIza` followed by 30 characters, and a manifest note count that does not match.
3. Run each script as a child process (`node scripts/check-site.mjs <folder>`) so the exit code is tested.

Stop here for review.

## 4. Two findings from the review of section 2

The review of section 2 found one fault in the app and one test that does not check what its title says. This section fixes both. It is the only section that may change the app, and only in the one place named below.

1. **Focus is lost after a ban chosen in the search box.** In `packages/app/src/components/SeriesBoard.tsx` the ban search in the draft strip (`DraftStrip`'s `onBan`) dispatches the ban but does not call `focusUndo()`, unlike the ban rows in the side column and the picks in the lanes. After the 6th or 10th ban the next turn is a pick, the search box disappears, and keyboard focus falls back to the page. Make the strip's ban move focus to Undo the same way. No other app change.
   - Add a test to `packages/app/src/components/interaction.test.tsx`: from a session after five bans, type into the strip's search box (`.strip input`), choose the first result, wait one animation frame, and expect six filled slots and focus on `draft-undo`. Find how `ChampionSearch` shows and selects results by reading it; do not guess class names.
2. **A test that passes for the wrong reason.** `SeriesBoard.test.tsx`, "ban turn: the ban rows are buttons, and a filled slot keeps its label", checks for `<button type="button" class="opt"`. With the shared fixture no ban stands out ("No ban stands out."), and the only such button is a "Picks that also deny" row, which shows a cost and does not ban. Make the test check a button inside the "Bans to consider" section. Use a plan in which a ban stands out: `interaction.test.tsx` builds one (`leveragePlanFor`, team Alpha's players also on Champion Eight); move it into `boardFixture.ts` and use it from both files, so it exists once.

Rules as above, plus: show that the new focus test fails without the fix and passes with it, and that the tightened ban-row test fails when the "Bans to consider" rows are rendered as plain `div`s (in `Rail.tsx`, temporarily) while the deny rows stay buttons. Restore everything after each check.

Stop here for review.

## Report

For each section: the files added or changed, the number of new tests, the totals from `pnpm test`, how you checked that each new test can fail, and anything that looked wrong but was left alone under the rules above.
