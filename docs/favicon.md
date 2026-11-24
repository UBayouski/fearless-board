# Favicon: the burn mark

Brief for Junie, 2026-11-24. Small, one section. Stop and report when done.

## Why

The tab icon is an inline data URI in `packages/app/index.html` (an ember square with a dark slash). `packages/app/public/favicon.svg` is Vite's default logo: nothing links to it, but Vite copies it to every build, so it is shipped to the live site. The video overlays and the one-page overview use a different mark, the burn grid from the app's "Series so far" track. The tab should use that mark too, and the unused file should go.

## The mark

A grid of two rows and five columns of small rounded rectangles: the first four columns filled (four games of picks burned), the fifth column drawn as an outline only (the next game, still open). Reference, on a 50 × 26 view box:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 26">
  <g fill="#2a211c">
    <rect x="0" y="0" width="8" height="11" rx="1"/><rect x="10" y="0" width="8" height="11" rx="1"/>
    <rect x="20" y="0" width="8" height="11" rx="1"/><rect x="30" y="0" width="8" height="11" rx="1"/>
    <rect x="0" y="14" width="8" height="12" rx="1"/><rect x="10" y="14" width="8" height="12" rx="1"/>
    <rect x="20" y="14" width="8" height="12" rx="1"/><rect x="30" y="14" width="8" height="12" rx="1"/>
  </g>
  <g fill="none" stroke="#c2470a" stroke-width="1.6">
    <rect x="40.8" y="0.8" width="8.4" height="9.4" rx="1"/><rect x="40.8" y="14.8" width="8.4" height="10.4" rx="1"/>
  </g>
</svg>
```

## What to do

1. **Replace `packages/app/public/favicon.svg`** with the burn mark, adapted for a 16 to 32 px tab icon:
   - A square view box (for example `0 0 32 32`), the grid centred, with no more than about 2 px of empty margin, so it does not shrink to a smudge.
   - It must read on both light and dark browser tabs. Use a `<style>` with `@media (prefers-color-scheme: dark)` inside the SVG: on dark tabs the filled squares use a light colour from the app's dark theme (read `packages/app/src/` CSS for the tokens; do not invent colours), and the outline keeps the ember colour of that theme.
   - No text, no external references, no scripts. Keep it under 1 KB.
2. **Link it from `packages/app/index.html`** with `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`, replacing the inline data URI. Check that the path works in all three builds (`pnpm build`, `pnpm build:demo`, `pnpm build:site`): Vite's `base` setting decides whether it must be `/favicon.svg` or relative; read `packages/app/vite.config.ts`.
3. **Do not change anything else.** `scripts/check-site.mjs` already allows `favicon.svg`; leave it as it is.

## Checks

- `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm check:data` and `pnpm build:site` pass.
- `dist-site/favicon.svg` is the new mark, and `dist-site/index.html` links to it.
- Open the built SVG on its own in a browser at a small size and describe what you see in the report, in light and dark colour schemes. If you cannot view it, say so; do not claim you checked it.

## Report

The files changed, the final SVG source, how it looks at tab size in both schemes, and the output of the checks. Do not deploy.
