# @wov/website

Public project website (production: `world-of-vikings.com`). Phase 0 ships a
static placeholder page with a Play link to the game.

- Dev: `pnpm --filter @wov/website dev` → http://localhost:5172
- Play link target: `VITE_GAME_URL`, default `http://localhost:5173`

Dependencies: `vite` and `@wov/ui` (design tokens). No framework on purpose —
the website is content, not an application.
