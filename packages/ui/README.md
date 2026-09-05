# @wov/ui

**Purpose.** Framework-free UI primitives shared by the game HUD (plain
HTML/CSS) and the editor shell (React), so both do not drift apart visually.
React components, if any, belong in `apps/editor` until a second consumer exists.

**Public API.** `tokens`, `cx(...parts)`.

**Dependencies.** None — deliberately framework-free so the game bundle does not
pull in React.

**Ownership.** Core maintainers.
