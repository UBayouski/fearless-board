# Refactor before live draft mode

Source: an outside review of the project, checked against the code. No new features and no change to any
number in `backtest.json`. This runs before `docs/live-draft.md`, which builds on it.

## 1. One lineup rule

Today the pool matrix picks each role's player by scanning every game of the series, and the ban panel takes
its ten players from the picks of game N itself. The two can show different players, and neither follows
the planning rule (nothing from game N or later). A lineup changes between games in 11 of 568 multi-game
series.

- Add `lineupBefore(series, gameNumber)` to `packages/shared`: for each team, the five players of game N-1.
  For game 1, use the lineup of game 1 (it is announced before the draft; nothing else is known earlier in
  the series).
- Both the matrix and the ban panel use it. No component reads players from game N in planning mode.
- If a team's lineup differed between any two earlier games of the series, show under the team name in the
  matrix header: "lineup changed during this series; showing the players of game N-1".
- After "Reveal game N": if the real lineup of game N differs from the one shown, mark the player who came
  in with a "substitute" label.
- Tests: a fixture series with a substitution in game 3 gives the game 2 lineup for game 3 and the game 3
  lineup for game 4.

## 2. One game-level result

The matrix cells and the ban panel each rebuild the same likelihoods for the same ten players.

- Add `gamePlan(...)` to `packages/shared`: for one series and game number it returns the lineup, the burned
  champions, each player's pool and likelihood list, and both teams' ban leverage and denial picks.
- Compute it once in `SeriesBoard` (memoised on series, game number and model) and pass it down. The cells
  and the panel only render.
- The pipeline's backtests use the same function where they compute the same things.

## 3. Split the shared package

`packages/shared/src/index.ts` is 1,378 lines. Split it without changing behaviour:

- `types.ts`: data shapes.
- `rules.ts`: burned champions, pools, lineup.
- `model.ts`: features, training, likelihoods, threat, leverage, denial picks, `gamePlan`.
- `evaluation.ts`: the backtests and calibration.
- `index.ts` re-exports everything, so imports elsewhere do not change. Split the test file the same way.

In the pipeline, move the model training and the backtests out of `src/index.ts` into `src/model.ts` and
`src/backtests.ts`.

## 4. Fixes

- `LeveragePanel.tsx` returns early before calling `useMemo` (`if (!model) return null`, then hooks). That
  breaks the rules of hooks. With section 2 the panel has no hooks of its own; make sure no component calls
  a hook after a conditional return, and add `eslint-plugin-react-hooks` to the lint run if it is not there.
- Ban rows: when a player named in a row has fewer than 20 earlier games, add "limited history" in muted
  text after that player's name.

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm data`, `pnpm build`, `pnpm check:data` pass. `backtest.json` and
`model.json` must be identical to the files from before the refactor, except for `generatedAt`: keep copies
outside the repository before starting and compare. Report the comparison and the line counts of the new
files.

## 5. Corrections after review

The shared package is split and `backtest.json` is unchanged, which is right. The rest of the brief is not
done yet:

- **`lineupBefore` and `gamePlan` exist but nothing calls them.** The matrix still scans all games for its
  players and the ban panel still reads the picks of game N. Carry out the wiring of sections 1 and 2:
  `SeriesBoard` computes `gamePlan` once, the matrix and the panel render from it, and the lineup notes of
  section 1 are shown.
- **The hook fault is still there.** `LeveragePanel.tsx` returns at line 75 and calls `useMemo` after it.
  After the wiring the panel should have no hooks.
- **There is no lint script.** Add `pnpm lint` (ESLint with `typescript-eslint` and
  `eslint-plugin-react-hooks`), fix what it reports, and add it to the checks.
- **The pipeline is not split.** `src/index.ts` is 1,197 lines; move training and backtests to
  `src/model.ts` and `src/backtests.ts` as in section 3. Split `index.test.ts` (1,148 lines) by the same
  four areas.
- "limited history" on ban rows (section 4) is missing.
- **WebStorm inspections** (run on the changed files after the work above; most should be gone by then):
  - `shared/src/evaluation.ts`: the code that turns a series' role counts into the two maps is repeated
    three times (near lines 188, 440 and 675). Use one helper, or `gamePlan`.
  - `shared/src/model.ts`: the score calculation in the trainer is repeated (lines 146 and 177). One helper.
  - Redundant local variables: `result` in `calibrateModel`, `players` in `lineupBefore`.
  - `app/src/components/PoolMatrixCell.tsx` line 173: import the `CSSProperties` type from `react` instead
    of using the `React` global.
  - The 4 and 5 line repeats in the pipeline can stay unless the split removes them anyway.

## 6. Corrections after the second review

- **The app crashes on every series.** The page is blank; the console shows
  `Cannot read properties of undefined (reading 'roleMap')`. In `gamePlan` (`shared/src/model.ts`, near line
  666) the code destructures `[ownPlayersData, oppPlayersData]` from a list that was filtered down to the
  own team only, so `oppPlayersData` is always undefined. Look both teams up by id.
  - Typecheck, the 46 tests, lint and the build all passed with the app dead. Add what would have caught it:
    - a test that runs `gamePlan` on a fixture series with two teams and checks that both teams get ban
      leverage and that the opponent's players appear in it;
    - a render test in the app package: render `SeriesBoard` to a string with `react-dom/server` on a small
      fixture (two teams, three games, a model, role counts) and assert that both team names, ten player
      names and the panel title are in the output. Run it as part of `pnpm test`.
- **A player without a role overwrites the top laner.** `roleMap.set(role ?? 'top', ...)` puts every player
  with no role into the top slot. Keep such players in a separate list and show them in the matrix under
  the label "role unknown"; they take no part in ban leverage.
- **`lineupChanged` is one flag for both teams.** Make it per team, so the note appears under the right
  team name.
- **Lint.** `.oxlintrc.json` already enables `react/rules-of-hooks`, and oxlint does report a hook called
  after an early return (checked on a sample file). So remove `packages/app/scripts/check-hooks.mjs`,
  `packages/app/eslint.config.js` and the ESLint packages added to `packages/app/package.json`; the lint
  script is `oxlint`.
- **`index.test.ts` is still one file** of 1,177 lines; split it by rules, model and evaluation.

After the fix, open the built app once (`pnpm --filter @fearless-board/app preview`) and confirm the board
shows for the default series before reporting.

## 7. Corrections after the third review

The app renders again, the lineup note works (checked on series 2825046), and the cells now show exactly
what a direct calculation gives. Four things remain:

- **The "why" line on the tiles was lost.** It now reads "played 5 times", which repeats "5g" from the line
  above. Restore what `docs/pick-model.md` sections 3a and 3b define: the role share ("15% of recent top
  picks", or "of all top picks" when the 45-day window is empty), followed by "· not played" for champions
  the player has not played. Put the share calculation in `gamePlan` (it has the role counts), so the cell
  only renders it.
- **"limited history" on ban rows counts the wrong thing.** `LeveragePanel.tsx` line 49 adds the number of
  different champions in the pool, not the number of games, so Hans Sama, Alvaro and Labrov are flagged.
  `gamePlan` should return each player's number of earlier games (sum of `games` over the pool), and the
  panel uses that with `< 20`. Show the note in muted text, not in ember italics.
- **Players with almost no history.** Gakgos (one earlier game) shows "0 left", "0% of likely picks are
  champions played before" and "100% of games burned". Use the no-history form of `docs/design.md` section 7
  for any player with fewer than 5 earlier games, with the note "n earlier games in the data".
- **The render test is missing.** Section 6 asked for a test in the app package that renders `SeriesBoard`
  to a string with `react-dom/server` on a small fixture and checks for both team names, ten player names
  and the panel title, as part of `pnpm test`. The root test script only runs `packages/*/src/**/*.test.ts`;
  make it include the app's test (`.test.tsx`). Also remove the empty folder `packages/app/scripts`.

## 8. Corrections after the fourth review

Fixed and confirmed: "limited history" on ban rows, the form for players with fewer than 5 earlier games.
Two things remain; do both, nothing else.

### 8.1 The "why" line shows a logarithm as a percentage

Tiles read "-200% of all top picks". `PoolMatrixCell.tsx` line 79 multiplies the model features `roleMeta`
and `roleAllTime` by 100. Those are logarithms of a smoothed share (about -2.0), not shares, and because
they are negative the code always falls through to the "all" label.

- In `gamePlan`, add to each likelihood entry the plain counts from `draft.roleCounts[role]`:
  `roleShare: { recent: n45 / total45 or null when total45 is 0, allTime: nAll / totalAll }`.
- The tile shows `Math.round(100 * recent)` + "% of recent <role> picks" when `recent` is not null, else
  the all-time share + "% of all <role> picks"; then " · not played" for champions the player has not
  played. The cell does no arithmetic on model features.
- Test in `model.test.ts`: on the two-team fixture, a champion with 3 of 20 recent role picks has
  `roleShare.recent` equal to 0.15.
- Expected on the default series: BrokenBlade's Rumble reads "15% of recent top picks".
- Wording: "1 earlier game in the data" (singular) for exactly one game.

### 8.2 The render test (asked for in sections 6 and 7, still missing)

No test renders the board, so a crash or a nonsense label passes every check. This is required.

- File: `packages/app/src/components/SeriesBoard.test.tsx`.
- It builds a small fixture (two teams, five players each with roles, three games, a few earlier picks per
  player, role counts, champions seen, a model with four weights) and calls
  `renderToString(<SeriesBoard ... />)` from `react-dom/server`. `SeriesBoard` loads `model.json` with
  `fetch` inside an effect, which does not run in `renderToString`: add an optional `model` prop to
  `SeriesBoard` that the test passes in, and that the fetch fills when absent.
- Assertions: the output contains both team names, all ten player names, the text "Bans & Denial Picks"
  (HTML-escaped), at least one "% of recent", and no "NaN", no "undefined" and no "-" directly before a
  digit followed by "%".
- Make `pnpm test` run it: the root script only matches `*.test.ts`. Use
  `node --test "packages/*/src/**/*.test.ts" "packages/*/src/**/*.test.tsx"` with whatever loader the app
  needs for JSX and CSS imports, or run the app's test with `vitest` from the root script. Either is fine;
  `pnpm test` must fail if this test fails.
- Prove it works: temporarily break `gamePlan` (for example return an empty `players` list), show that
  `pnpm test` fails, then restore it. Report that output.
