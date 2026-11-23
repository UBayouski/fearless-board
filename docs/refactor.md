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
