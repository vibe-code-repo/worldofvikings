/**
 * Where the game client lives, seen from the editor.
 *
 * The client is served under the base prefix of its build: `/play/` in
 * production (`base` in `client/vite.config.ts`; `/` belongs to the website
 * there, and on the editor host nginx sends `/` to the editor), `/` on a bare
 * dev server. An address that opens "the game" therefore starts with that
 * prefix, never with a bare `/` — the bare root opened the editor again.
 *
 * The path helpers (`gameUrl`, `dungeonUrl`) return paths only. The one place
 * that changes the host is `dungeonZiel`: the sign-in and the account live on
 * the game host (`spielHostVon`), not on the editor host, where nginx sends `/de/anmelden` back into the editor.
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

/**
 * Address that opens one dungeon in the online game client, same origin as the
 * page it is used on. Throws `Error` with a readable message for an id that is
 * not valid text (a lone surrogate makes `encodeURIComponent` throw a bare
 * `URIError`).
 */
export function dungeonUrl(id: string, base: string = clientBase()): string {
  let kodiert: string;
  try {
    kodiert = encodeURIComponent(id);
  } catch {
    throw new Error('Ungültige Dungeon-Kennung (kein gültiger Text)');
  }
  return gameUrl(`dungeon=${kodiert}`, base);
}

/**
 * Editor host → game host, as a fixed table. Measured, not derived by a rule:
 * the game host is `play.` in production but `live.` on dev and staging, so
 * no single `editor.*` → `live.*` rule fits.
 *
 * Sources: `Docs/05-Server-Architektur.md` ("Vier Domains": production game
 * host `play.world-of-vikings.com`, editor behind Basic-Auth on
 * `editor.world-of-vikings.com`), `wov-web/src/lib/account.ts:94` (`origin:
 * 'https://play.world-of-vikings.com'`), and a read-only `curl` with a Host
 * header against nginx on the dev machine (`/play/` 200 on `live.dev` and
 * `live.staging`, `/de/anmelden` served by the website there). `live.` does not
 * exist in production (no vhost, no certificate), `play.dev`/`play.staging` do
 * not exist on dev/staging.
 *
 * Karte D1 (Zweitdomains): `world-of-mmorpg.com`/`.de` bekommen dieselbe
 * `editor.` → `play.`-Zuordnung wie world-of-vikings.com — "innerhalb einer
 * Domain bleiben" (Mikes Entscheid): wer auf `.de` ist, spielt auf
 * `play.world-of-mmorpg.de`, nicht auf einer anderen Domain. Kein `dev.`/
 * `staging.` für die neuen Domains (die bleiben vorerst nur unter
 * world-of-vikings.com, Karte D1).
 */
const SPIEL_HOSTS: Readonly<Record<string, string>> = {
  'editor.world-of-vikings.com': 'play.world-of-vikings.com',
  'editor.dev.world-of-vikings.com': 'live.dev.world-of-vikings.com',
  'editor.staging.world-of-vikings.com': 'live.staging.world-of-vikings.com',
  'editor.world-of-mmorpg.com': 'play.world-of-mmorpg.com',
  'editor.world-of-mmorpg.de': 'play.world-of-mmorpg.de',
};

/**
 * The game host that belongs to an editor host, from the table above. Every
 * other host — the game host itself, `localhost`, a slot port, a host with a
 * port — maps to `null`: the game opens on the own origin there.
 */
export function spielHostVon(host: string): string | null {
  const treffer = Object.prototype.hasOwnProperty.call(SPIEL_HOSTS, host.toLowerCase());
  return treffer ? SPIEL_HOSTS[host.toLowerCase()] : null;
}

/**
 * Where "enter the dungeon" leads. `gleicherUrsprung` says whether the game
 * opens on the origin of the page: only then can the page look at the
 * `localStorage` the game will see (sign-in check). On a host change it cannot,
 * and the game asks for the sign-in itself.
 */
export interface DungeonZiel {
  readonly url: string;
  readonly gleicherUrsprung: boolean;
}

export function dungeonZiel(
  id: string,
  ort: { readonly host: string; readonly protocol: string },
  base: string = clientBase()
): DungeonZiel {
  const pfad = dungeonUrl(id, base);
  const spielHost = spielHostVon(ort.host);
  if (spielHost === null) return { url: pfad, gleicherUrsprung: true };
  const protokoll = ort.protocol === 'http:' ? 'http:' : 'https:';
  return { url: `${protokoll}//${spielHost}${pfad}`, gleicherUrsprung: false };
}

/**
 * The message the editor shows when it opens the game. On a host change the
 * page cannot see the sign-in. The game keeps the wish before its sign-in
 * redirect (`wov-dungeon-wunsch` in `main.ts`, valid 10 minutes) and opens the
 * dungeon after the sign-in, so the message says exactly that.
 */
export function dungeonMeldung(id: string, ziel: DungeonZiel): string {
  return ziel.gleicherUrsprung
    ? `${id} wird im Spiel geöffnet …`
    : `${id} wird im Spiel geöffnet … Führt das Spiel zuerst zur Anmeldung, öffnet sich der Dungeon danach von selbst, wenn du dich innerhalb von 10 Minuten anmeldest.`;
}

/**
 * The website's base domain, derived from the game client's OWN host —
 * Karte D1 (Zweitdomains): with two equal main domains
 * (`world-of-mmorpg.com`/`.de`, plus the transitional
 * `world-of-vikings.com`), a visitor with no session must be sent back to
 * sign in on the SAME domain they were playing on ("innerhalb einer Domain
 * bleiben" — the login lives in `localStorage`, which is per origin).
 *
 * Only a `play.` host is a separate domain from the website; every other
 * host (a same-origin dev/lab container, `localhost`, a slot port) IS the
 * website's own host already, verbatim.
 */
export function basisDomainVonSpielHost(hostname: string): string {
  const h = hostname.toLowerCase();
  return h.startsWith('play.') ? hostname.slice('play.'.length) : hostname;
}
