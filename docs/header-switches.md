# Header switches: icons instead of words

Brief for Junie, 2026-11-24. Run after `docs/favicon.md` has been reviewed. One section; stop and report when done.

## Why

The header has two segmented pairs with text: **Icons | Names only** and **Light | Dark** (`packages/app/src/App.tsx`, the two `.seg` groups after `<div className="grow" />`). They are settings people rarely change, but they take much of the header's width, which is tight on phones. An icon inside each button saves the room while keeping what works today: both options visible, the active one highlighted, `aria-pressed` on each button.

Decisions already made (do not reopen them):

- **Keep the pairs.** Do not turn either into a single toggle button: a lone sun or moon is read both as "it is dark now" and "switch to dark".
- **Icon plus a short word on wide screens, icon only on phones** (the app's phone breakpoint is `max-width: 760px` in `components/board.css`).
- **Every button keeps an accessible name** whatever is visible, so a screen reader never announces only "button, pressed".

## What to do

1. **Four small inline SVG icons**, drawn in the code (no icon library, no new dependency, no image files):
   - **Light:** a sun (a circle with short rays).
   - **Dark:** a crescent moon.
   - **Icons:** a generic portrait: a head-and-shoulders outline in a rounded square. It must not resemble any champion or use any Riot art.
   - **Names only:** the letters "Aa" drawn as text in the SVG, or a few horizontal lines suggesting a list of names. Choose one and say why.
   - 18 to 20 px, `stroke="currentColor"` or `fill="currentColor"` so they follow the button's text colour in both states and both themes; `aria-hidden="true"` and `focusable="false"` on each SVG.
   - Put them in one small component file in `packages/app/src/components/`, for example `SwitchIcons.tsx`.
2. **Buttons:** each button holds its icon and a short word in a `<span className="switch-word">`: "Light", "Dark", "Icons", "Names". Each button gets an `aria-label` with the full name, "Light theme", "Dark theme", "Champion icons", "Names only", and a `title` with the same text for the hover tooltip. Keep `type`, `aria-pressed` and the `onClick` handlers exactly as they are. Keep the group `role="group"` and its `aria-label`.
3. **CSS** (in `components/board.css`, next to the existing `.seg` rules): icon and word side by side with a small gap; at `max-width: 760px` hide `.switch-word` visually. Hiding it is fine because `aria-label` carries the name. Buttons stay at least 44 by 44 px, also when icon-only. Do not change `.seg` rules other groups use (the series picker, the rail, the draft strip).
4. **Do not change anything else**: not the stored settings, not the theme or icon logic, not other components.

## Tests

Add to `packages/app/src/components/interaction.test.tsx`, or a new `App` render test if `App` can be rendered without loading data. Read how `App.tsx` loads data first, and if it cannot be rendered in a test without a network or the licensed data, test the four buttons through a small exported `HeaderSwitches` component instead, moving the two groups into it unchanged.

- The four buttons have the four `aria-label`s and `title`s above, each contains an `svg` with `aria-hidden="true"`, and exactly one button per group has `aria-pressed="true"`.
- Clicking "Dark theme" sets `aria-pressed="true"` on it and `"false"` on "Light theme" (and the same for the icon pair), and calls the handler with the right value.
- Show that each test fails when the thing it checks is removed (an `aria-label`, `aria-hidden`, the pressed state), and restore it after each check.

## Checks

- `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm check:data` and `pnpm build:site` pass.
- WebStorm inspections show no new warnings in the changed files.
- In the report, say whether you viewed the header in a browser at a wide width and at 390 px wide, in both themes. If you could not, say so; do not claim you checked it.

## Report

The files changed, the four icon sources, screenshots or a description of what you saw (only if you actually saw it), how you checked that each test can fail, and the output of the checks. Do not deploy.
