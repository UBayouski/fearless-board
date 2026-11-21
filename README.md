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

## Licence

MIT, see [LICENSE](LICENSE). The licence covers this code only, not the match data.

League of Legends is a trademark of Riot Games, Inc. This project is not endorsed by Riot Games.
