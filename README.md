# Fearless Board

Series-long League of Legends draft planning for Fearless Draft. Enter a series game by game, see which champions are burned, how each player's remaining pool shrinks, and what credible options the opponent still has in game three and beyond.

Built for the Cloud9 x JetBrains: Sky's The Limit Hackathon 2026, Category 2 (LoL).

Status: scaffold only. The draft extraction and the board are not built yet.

## Layout

```
packages/
  shared/     types and Fearless Draft rules used by both sides
  pipeline/   Node script: reads the match data, writes aggregate JSON
  app/        React + Vite site that loads the aggregates
scripts/
  check-no-data.mjs   guard against committing licensed data
```

## Requirements

- Node 24 or newer
- pnpm 10

## Setup

```bash
pnpm install
pnpm test        # rule tests
pnpm typecheck
pnpm dev         # start the app
```

## Match data

The app uses official esports data from GRID, provided for the hackathon under a proprietary licence. **The data is not in this repository and must never be committed to it.**

Clone the data repository next to this project:

```
some-folder/
├── stl-hackathon-2026-grid-starter/   <- data repo
└── fearless-board/                    <- this repo
```

```bash
git clone --filter=blob:none --sparse https://github.com/cloud9esports/stl-hackathon-2026-grid-starter.git
cd stl-hackathon-2026-grid-starter
git sparse-checkout set lol meta
```

Then build the aggregates:

```bash
pnpm data
```

To use a different location, set `STL_DATA_DIR` to the data repository's path.

`pnpm data` writes to `packages/app/public/data/`, which is ignored by git. Run `pnpm check:data` before every commit and push; it fails if any data file is tracked or staged.

## Method

The board uses a conditional logit model to score every available champion for each player. Four features are computed per (player, champion) pair: recency-weighted games played by that player, whether the player has ever played the champion, the champion's popularity in the player's role over the last 45 days, and the champion's all-time popularity in the role. The four weights and standardisation parameters are trained on pre-2026 games using Newton's method and run in the browser as plain arithmetic — no language model or external dependency.

**Model weights:** recentGames 0.0953, played 0.0740, roleMeta 1.1834, roleAllTime 0.3983. Training log-likelihood: −2.5912; test log-likelihood: −2.7818.

**Evaluation** on 2026+ games:

| Group | Picks | Model Top 5 | Games Played Top 5 | Model Top 10 | Games Played Top 10 |
|---|---|---|---|---|---|
| All | 4,520 | 62.9% | 50.3% | 85.2% | 72.5% |
| Games 2+ | 2,460 | 62.6% | 50.1% | 84.3% | 72.5% |
| Games 2+, 20+ prior | 2,190 | 62.6% | 51.8% | 84.2% | 76.6% |

**Calibration** (predicted vs actual pick rate):

| Bin | Mean predicted | Actual pick rate |
|---|---|---|
| 0–2% | 0.2% | 0.1% |
| 2–5% | 3.2% | 4.4% |
| 5–10% | 7.3% | 8.7% |
| 10–20% | 14.0% | 13.6% |
| 20%+ | 25.5% | 20.1% |

**Limits:** Professional games in this dataset only; roles are derived from end-of-game state, not official data; bans of the current game are not used because they are unknown before the draft.

**Ban leverage** ranks available champions by how much the opposing team wants them minus how much the own team wants them. The threat of a champion from a team is `1 − ∏(1 − P(player picks c))` across the five players. The top 8 champions by this difference are shown as ban suggestions, with the opponent players who want each champion (likelihood ≥ 5%) and the cost to the own team if it also wants the champion. **Denial picks** are champions an own-team player has played before and has among their ten most likely picks, sorted by the opponent's threat — picking such a champion both uses it and removes it from the opponent for the rest of the series.

**Ban leverage backtest** on 2026+ games (model trained on pre-2026):

| Group | Bans | Leverage Top 5 | Leverage Top 8 | Threat Top 5 | Threat Top 8 | Meta Top 5 | Meta Top 8 |
|---|---|---|---|---|---|---|---|
| All games | 4,499 | 17.8% | 26.6% | 15.7% | 23.6% | 13.9% | 21.1% |
| Games 2+ | 2,459 | 18.5% | 27.4% | 16.5% | 25.4% | 15.0% | 23.5% |

Leverage finds 26.6% of real bans in its top 8 against 21.1% for the plain 45-day meta list — a modest gain. About three of four real bans fall outside the list entirely, so the panel is a list of bans to consider, not a prediction.

**Live draft** lets you enter bans and picks as they happen during a real draft. After each action, banned and picked champions are removed from every player's list and the remaining probabilities are rescaled. The ban leverage panel is recomputed with the updated lists. A replay mode steps through the real draft actions one at a time, showing the rank of each actual pick in the conditioned list. The draft order follows the pattern discovered from the data: 6 bans, 6 picks, 4 bans, 4 picks — expressed as "first team" and "second team" rather than blue and red, since in 2026 about half of games have the red side act first.

**Live draft backtest** on 2026+ games (model trained on pre-2026):

| Group | Picks | Conditioned Top 5 | Unconditioned Top 5 |
|---|---|---|---|
| All picks | 4,500 | 74.4% | 62.9% |
| Pick 1 | 900 | 82.8% | 78.3% |
| Pick 5 | 900 | 59.2% | 43.9% |

**Second-phase bans** on 2026+ games:

| Group | Bans | Conditioned Leverage Top 8 | Unconditioned Top 8 |
|---|---|---|---|
| All games | 1,799 | 27.3% | 20.7% |
| Games 2+ | 983 | 26.3% | 20.3% |

**Limits:** The backtest ranks champions for the player who actually picked; during a real draft the board does not know which role a team fills next, so all open players' lists are shown.

**Series outlook** shows how much of each player's likely picks is already burned across the series, and what the coming game is expected to burn. A "what does a pick cost" search shows, per team, which players lose probability mass from a chosen champion and the combined figure. The panel also projects how much more each player's pool will shrink from the coming game.

**Series outlook backtest** on 2026+ games (players with 20+ earlier games):

| Game | Picks | Mean burned share | Pick outside top 10 |
|---|---|---|---|
| 2 | 1,224 | 19.8% | 20.4% |
| 3 | 731 | 36.8% | 29.7% |
| 4 | 165 | 48.4% | 32.1% |
| 5 | 66 | 63.8% | 51.5% |

**Projection** of the coming game's burn (3,848 player-games): mean predicted 21.6%, mean actual 21.8%; mean absolute error 8.1 points against 8.8 for a constant. The burned share describes how much of a player's usual picks is gone; in this data it does not predict who wins.

## Licence

MIT, see [LICENSE](LICENSE). The licence covers this code only, not the match data.

League of Legends is a trademark of Riot Games, Inc. This project is not endorsed by Riot Games.
