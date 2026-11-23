# Pick likelihood: rank what a player is likely to pick next

## Why

The board ranks a player's champions by games played. Checked against the data, that is a weak ranking: on
games 2 and later played in 2026, the actual pick was in the board's top 5 only 50% of the time. A plain
list of "what is picked in this role lately" does better (62%), and 24% of picks are champions the player
has never played in the data, which the board cannot show at all.

This task adds a small statistical model that scores every available champion for a player, and makes the
board use it. No language model, no new runtime dependency: the model is four weights and runs in the
browser as arithmetic.

Hard rule as before: no match data in the repository. The model's weights and its evaluation go to the
generated output folder with the other pipeline files.

## 1. The model (`packages/shared`)

A conditional logit: for one player before one game, each candidate champion gets a score, and the scores
become probabilities with a softmax over the candidates.

**Candidates:** every champion picked at least once in the data before the series, minus the champions
burned in the series so far. Bans of the game itself are not known before the draft and are not used.

**Features** for player `p` (role `r`), champion `c`, series starting on day `t`. Only games of series that
started before `t` count:

| Feature | Definition |
|---|---|
| `recentGames` | `ln(1 + sum over p's earlier games on c of exp(-daysAgo / 90))` |
| `played` | 1 if p has any earlier game on c, else 0 |
| `roleMeta` | `ln((n45 + 0.5) / (N45 + 40))`, where `n45` is the picks of c by players of role r in the 45 days before t and `N45` is all picks by that role in the same window |
| `roleAllTime` | the same as `roleMeta` over all earlier games |

Standardise each feature with the mean and standard deviation of the training candidates; store those with
the weights.

**Training:** maximise the log-likelihood of the actual pick among its candidates, full batch, fixed number
of iterations, no randomness, so that two runs give identical weights. Skip picks made before 80 different
champions have appeared in the data, and picks by players without a role.

**API:** pure functions with tests.

- `pickFeatures(...)` builds the features for one player and one game.
- `trainPickModel(examples)` returns `{ weights, mean, sd }`.
- `pickLikelihoods(model, features)` returns candidates with a probability, sorted, summing to 1.

Tests on small hand-made fixtures: probabilities sum to 1; burned champions never appear; training on a
fixture where one feature decides the pick gives that feature the largest weight; a game from a later
series does not change the features of an earlier one.

## 2. Pipeline

- Train on series that started before 2026-01-01, evaluate on the later ones. Then train once more on all
  series and write that model as `model.json` for the app.
- Evaluation, written into `backtest.json` under `model` next to the existing numbers and printed: share of
  actual picks in the top 1, 3, 5 and 10, for the model and for the current ranking by games played, on the
  same picks: all test games; games 2 and later; games 2 and later for players with 20 or more earlier games.
- Write per role the counts the app needs for `roleMeta` and `roleAllTime` as of each series, inside that
  series' file, so the app does not recompute them from all picks.

Expected on games 2 and later of the test period (about 2,460 picks): top 5 near 62% for the model against
near 50% for games played; top 10 near 84% against near 73%. Report the numbers as they are. If the model
is not clearly better than games played, stop and report; do not tune features to reach these values.

## 2b. Corrections after review of sections 1 and 2

The model itself is right: its numbers match an independent prototype (top 5 63%, top 10 85%). The
comparison around it is not.

- **The "games played" comparison is not the board's ranking.** `evaluateGamesPlayed` sorts by
  `recentGames`, the recency-weighted feature. The board ranks by number of earlier games, then by most
  recently played, over the champions the player has played and that are not burned; a champion the player
  has not played has no rank and counts as a miss. Use exactly that (reuse `playerPool` and `crediblePool`).
  Expected for all test games: top 5 near 50%, top 10 near 73%, not 56% and 76%.
- **The "20+ games" group is a guess.** The code uses "has played 3 or more different champions" and labels
  it as 20 or more games. Count the player's earlier games and use `>= 20`.
- **Two of the three groups are missing.** Report: all test games; games 2 and later; games 2 and later for
  players with 20 or more earlier games.
- **Shape in `backtest.json`:** replace the flat fields with
  `model: { split: "2026-01-01", groups: [{ name, picks, model: { top1, top3, top5, top10 }, gamesPlayed: { top1, top3, top5, top10 } }] }`,
  percentages with one decimal.
- **Role counts are not written.** Section 2 asked for them in each series file. Add
  `roleCounts: { <role>: { total45, totalAll, champions: { <championId>: [n45, nAll] } } }`, as of the start
  of that series, and `championsSeen`: the ids of all champions picked before the series. With these and the
  player's pool the app can build the features without scanning all picks.
- **Speed.** `pickFeatures` scans every pick in the data for every example, and the examples are built three
  times. Index picks by player once, and build the examples once (the training set is the examples before
  the split date). Report the run time of `pnpm data` before and after.
- Remove the unused `_role` parameter of `pickFeatures`.

Stop after these corrections and report the table for the three groups.

## 3. Board

- Each cell lists the player's ten most likely champions, most likely first, each with its likelihood as a
  percentage and a thin bar. Champions the player has played keep "12 g · 3 w ago". Champions the player has
  not played are shown with a dashed outline and the label "not played", in muted text.
- Below, a collapsed line "Also played: n more" that expands to the rest of the player's available pool.
- Burned champions stay as they are, on their own line.
- The count in the cell changes meaning: "14 left" stays the number of played champions still available.
  Add under it the sum of likelihood on champions the player has played, as "71% of likely picks are
  champions played before".
- Reveal: mark the actual pick in place with its likelihood rank ("#2"). If it is outside the ten shown and
  not in "Also played", add it as a tile marked "unlisted".
- The reliability line reads its numbers from `backtest.json`: "On 2026 games, the actual pick was among
  the five most likely n% of the time (n% for a ranking by games played)."

- The reliability numbers are in `backtest.json` under `model.groups`; use the group "games 2+".

### 3a. Why a champion is ranked where it is

- Each of the ten tiles has a visible second line in muted text built from the features, not a tooltip:
  "18% of recent mid picks · played 6 times" or "9% of recent mid picks · not played". "Recent" is the 45-day
  window; if the role has no picks in that window, use the all-time share and say "of all mid picks".
- Calibration, in the pipeline: over the test picks of the group "all", put every candidate's probability in
  one of the bins 0-2%, 2-5%, 5-10%, 10-20%, 20%+, and write per bin the number of candidates, the mean
  predicted probability and the share actually picked, to `backtest.json` under `model.calibration`. Print
  the table. Do not adjust the model to improve it; report it.

### 3b. Corrections after review of sections 3 and 3a

- **The training does not converge, so the weights are wrong.** `trainPickModel` uses gradient ascent with a
  fixed step of 0.5. On the real data it ends in an oscillation: the weights look stable but the mean
  log-likelihood per training pick is -2.94, while the optimum is about -2.59. The symptom is on the board
  and in the calibration table: "Rumble 69%", and candidates given 33% on average are picked 17% of the time.
  The rankings barely suffer, the percentages do.
  - Replace the optimiser with Newton's method: gradient and 4 x 4 Hessian of the log-likelihood, solve for
    the step, halve the step while the log-likelihood does not improve, stop when the largest gradient
    component (per example) is below 1e-8 or after 50 iterations. Still no randomness.
  - Return the final mean log-likelihood and the iteration count with the model, and print them.
  - Tests: on a fixture, the gradient at the returned weights is close to zero, and the log-likelihood is
    not lower than at weights of zero.
  - Write the mean log-likelihood per pick on the training and on the test picks to `backtest.json` under
    `model`.
  - Expected after the fix, trained on 2025: weights near 0.10 (recentGames), 0.07 (played), 1.10 (roleMeta),
    0.47 (roleAllTime); training log-likelihood near -2.59, test near -2.78; in the calibration bin "20%+"
    a mean prediction near 25% against about 20% picked; top 5 on games 2 and later near 62.6%. Report what
    you get; do not tune.
- **Tile wording.** The second line repeats the first: "18g" and "played 18 times". For played champions the
  second line is only the role share ("7% of recent top picks"); for the others it ends with "· not played".
- **Tests** for `calibrateModel` (a fixture with known bins) and `buildPickLikelihoods` (same result as
  `pickFeatures` followed by `pickLikelihoods`).
- **README.** Replace the "~" figures with the exact numbers from `backtest.json` after the rerun, and add
  the calibration table.

Stop after these corrections and report: weights, both log-likelihoods, the three groups, the calibration
table.

## 4. README

A short "Method" section: what the model is, the four features, the train and test split, the results
table, and its limits (professional games in this dataset only; roles are derived; bans of the game are not
used).

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm data`, `pnpm build`, `pnpm check:data` pass. Stop after section 2 and
report the evaluation table and the four weights; then continue with section 3.
