/**
 * Where the game client lives, seen from the editor.
 *
 * The client is served under the base prefix of its build: `/play/` in
 * production (`base` in `client/vite.config.ts`; `/` belongs to the website
 * there, and on the editor host nginx sends `/` to the editor), `/` on a bare
 * dev server. An address that opens "the game" therefore starts with that
 * prefix, never with a bare `/` — the bare root opened the editor again.
 *
 * Kept free of the DOM and of `location`, so a test can pass both prefixes
 * without faking `import.meta`.
 */

/**
 * Normalise a base prefix to `/`, `/x/` or `/x/y/`: one leading and one
 * trailing slash, no doubled slashes, and `/` for anything empty.
 */
export function normaliseBase(base: string | undefined | null): string {
  const parts = (base ?? '').split('/').filter((part) => part !== '');
  return parts.length === 0 ? '/' : `/${parts.join('/')}/`;
}

/**
 * The base prefix of this build. `import.meta.env` is set by Vite and absent
 * where the code runs without it (the tests), which then means `/`.
 */
export function clientBase(): string {
  return normaliseBase(import.meta.env?.BASE_URL);
}

/**
 * Address of the game client on the same origin, with an optional query
 * (`offline=1&layout=editor`, without the leading `?`).
 */
export function gameUrl(query = '', base: string = clientBase()): string {
  const prefix = normaliseBase(base);
  return query === '' ? prefix : `${prefix}?${query}`;
}
