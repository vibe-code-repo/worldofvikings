/**
 * Where the game client lives, seen from the editor.
 *
 * The client is served under the base prefix of its build: `/play/` in
 * production (`base` in `client/vite.config.ts`; `/` belongs to the website
 * there, and on the editor host nginx sends `/` to the editor), `/` on a bare
 * dev server. An address that opens "the game" therefore starts with that
 * prefix, never with a bare `/` — the bare root opened the editor again.
 *
 * Only paths, never a host: the game opens on the origin of the editor, so the
 * session and the draft in `localStorage` are the same in both.
 *
 * Kept free of the DOM and of `location`, so a test can pass both prefixes
 * without faking `import.meta`.
 */

/**
 * Normalise a base prefix to `/`, `/x/` or `/x/y/`: one leading and one
 * trailing slash, no doubled slashes, and `/` for anything empty.
 *
 * The result is always a path on the own origin, or `/`. What could leave the
 * origin (a backslash: a browser reads `\host\` as `//host/`), cut the query
 * short (`#`, `?`), or lead back to the root (`.` and `..` segments, also
 * written `%2e`) is thrown away as a whole, not repaired.
 */
export function normaliseBase(base: string | undefined | null): string {
  const raw = base ?? '';
  if (/[\\#?\u0000-\u001f\u007f]/.test(raw)) return '/';
  const parts = raw.split('/').filter((part) => part !== '');
  if (parts.some((part) => /^(\.|%2e){1,2}$/i.test(part))) return '/';
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

/** Address that opens one dungeon in the online game client, same origin as the editor. */
export function dungeonUrl(id: string, base: string = clientBase()): string {
  return gameUrl(`dungeon=${encodeURIComponent(id)}`, base);
}
