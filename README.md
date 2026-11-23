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

## Licence

MIT, see [LICENSE](LICENSE). The licence covers this code only, not the match data.

League of Legends is a trademark of Riot Games, Inc. This project is not endorsed by Riot Games.
