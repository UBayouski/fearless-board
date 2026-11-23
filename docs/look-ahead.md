# Looking ahead across the series

## Why

The board plans one game. Fearless Draft is a series problem: every pick is gone for the rest of the series,
so a coach also asks "how deep are we into each player's champions, and what does this pick cost later?"
This brief adds a series outlook: how much of each player's likely picks is already burned, what the coming
game is expected to burn, and what one chosen pick removes for both teams.

A check on the 2026 series (players with 20+ earlier games, 2,188 picks in games 2 and later) supports it:

| Game | Share of the player's series-start list already burned | Pick outside the series-start top 10 |
|---|---|---|
| 2 | 19.7% | 21.2% |
| 3 | 36.7% | 30.2% |
| 4 | 48.6% | 32.7% |
| 5 | 63.7% | 51.5% |

Within one game number the link holds too (game 3: 25% outside the top 10 when 20–30% is burned, 34% when
45% or more is burned). The link is moderate. The text on the board must describe, not predict a result:
earlier checks found no link between a squeezed pool and losing, and nothing here may suggest one.

The projection for the coming game is right on average and weak for a single player (3,416 player-games:
mean predicted 21.8%, actual 21.6%; mean absolute error 7.9 points against 8.5 for a constant). So it is
shown as an expectation with that caveat, not as a forecast per player.

This brief is three runs. Do one section, report every numbered item as "done" or "not done" with the file
changed, and stop.

## 1. Calculation (`packages/shared/src/outlook.ts`, pure functions with tests)

1. `gamePlan` adds to each player `startLikelihoods`: the same model list computed with nothing burned (all
   champions seen so far as candidates). The existing `likelihoods` stay as they are.
2. `burnedShare(player, burned)`: the sum of `startLikelihoods` probabilities over burned champions, 0 to 1.
3. `expectedBurn(plan)`: for each player, the expected share of the current list that the coming game's
   picks remove: `Σ P(c) · (1 − Π over all ten players (1 − P_player(c)))` over the player's `likelihoods`.
4. `pickCost(plan, championId)`: for each player on both teams, the probability of that champion in their
   current list (what the pick removes from them for the rest of the series), and per team the combined
   figure `1 − Π (1 − P)`. Works on a live plan too (after bans and picks in draft mode).
5. `seriesOutlook(plan)`: one result for the panel: per team and role `{ playerId, burnedShare,
   expectedBurn, limitedHistory }`, with `limitedHistory` true under 20 earlier games.
6. Tests: a hand-built case for each function (a burned champion with start probability 0.3 gives 0.3; two
   players at 0.5 on one champion give a combined 0.75; `pickCost` of a champion nobody has gives 0).

## 2. Backtest (pipeline, written to `backtest.json` as `lookAhead`)

Use the model trained before 2026 and the 2026 series, as in the other backtests.

1. The table above: by game number, picks counted, mean burned share, share of picks outside the top 10 of
   `startLikelihoods`, share of first-time picks. Players with 20+ earlier games only.
2. The same by burned-share band (under 10%, 10–20%, 20–30%, 30–45%, 45% and more).
3. The projection: mean of `expectedBurn` against the mean share actually removed by the game's picks, the
   mean absolute error against the error of a constant, and predicted against actual by fifths.
4. Print the three tables in the pipeline summary. The numbers must be close to the ones in "Why" (they
   were computed with the model trained on all data, so small differences are expected). Throw if a table
   has no rows.

Stop here and report the three tables.

## 3. Board and README

1. **"Series outlook" panel** between the game buttons and the matrix: one compact block, five role rows,
   one column per team in the matrix's team order. Each row: player name, a bar of the burned share
   ("37% of likely picks burned"), and after it the expectation for the coming game ("this game: about
   +21%"). Players with limited history show "limited history" instead of the expectation. Game 1 shows
   0% burned and only the expectation.
2. **Team line** under each column: the mean burned share of the five players, and the role with the
   highest share named ("deepest: bot, 56%").
3. **"What does a pick cost?"**: a champion search in the panel (reuse `ChampionSearch`). Choosing a
   champion shows, per team, the players it takes a share from ("Caps 14%, Jojopyun 7%") and the combined
   figure per team. A "clear" button removes it. Clicking a row in "Picks that also deny" selects that
   champion here.
4. In draft mode the panel uses the live plan, so it changes with each action.
5. Wording: describe pools only. No "advantage", "favoured", "will lose" or similar anywhere.
6. Render cases with `initialSession` or props: the panel shows ten player names and ten burned shares; game
   1 shows 0%; a selected champion shows both team figures; no "NaN" or "undefined".
7. README, "Method": a "Series outlook" paragraph with the game-number table, the projection figures and
   this limit in plain words (take every figure from `backtest.json`, not from this brief; the pipeline's
   projection figures are 3,848 player-games, 21.6% predicted, 21.8% actual, error 8.1 against 8.8): the burned share describes how much of a player's usual picks is gone; in
   this data it does not predict who wins.

8. Remove a duplication (WebStorm reports it): `gamePlan` in `model.ts` and `liveGamePlan` in `draft.ts`
   both build the ban leverage and denial picks for the two teams with the same 24 lines. Extract one
   function and call it from both. No number may change.

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm lint` (no warnings), `pnpm data`, `pnpm build`, `pnpm check:data` pass.
No existing number in `backtest.json` may change.
