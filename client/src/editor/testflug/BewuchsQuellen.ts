/**
 * BewuchsQuellen.ts — what the test-flight scatter preview needs to size its
 * clear areas like the server: the manifest hulls of own models and the
 * upload registry.
 * Quellen der Bewuchs-Vorschau im Testflug: Manifest und Upload-Registry.
 *
 * The server reads `assets/manifest.json` from disk and registers uploads
 * before it starts; the client fetches both. If a source is missing the
 * preview clears other radii than the server — that must be VISIBLE to the
 * user (`abweichungsText`), not only a `console.warn`.
 */
import { freiflaechenHuellen, istEigenesModell } from '@wov/shared';
import { registeredModules } from '@wov/shared/src/moduleRegistry.js';
import { NAME_PRAEFIX } from '@wov/shared/src/uploadedModelRegistry.js';
import { leseManifest, type ManifestModell } from '@wov/shared/src/weltbau/manifest.js';

/** Where the client finds the manifest (the whole `assets/` folder is served). */
export const MANIFEST_URL = '/assets/manifest.json';

/** The manifest text from the served `assets/` folder (throws on network or HTTP failure). */
export async function holeManifestText(): Promise<string> {
  const antwort = await fetch(MANIFEST_URL, { cache: 'no-cache' });
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  return antwort.text();
}

/**
 * Own models that legitimately have NO manifest entry, so a missing entry
 * must not raise the alarm. Checked against the manifest and `EIGENE_MODELLE`:
 *  - `Player`, `NPC_1`: characters, no model box in the manifest (measured:
 *    the only own models with the `extern` hull and no entry besides the
 *    four below).
 *  - `GrabhuegelGras`, `SteingrabGangDurch`, `StoneVaultEntry`,
 *    `RockVaultEntry`: aliases (`MODELL_ALIAS`) of a model that has its entry
 *    under another file name (`Grabhuegel`, `SteingrabGang`, ...); the
 *    prefab name itself never appears in the manifest.
 * Measured against `assets/manifest.json` (313 entries): of the 184 own
 * models with `extern` hull exactly these six have no entry.
 */
export const OHNE_MANIFEST_ERLAUBT: ReadonlySet<string> = new Set([
  'Player',
  'NPC_1',
  'GrabhuegelGras',
  'SteingrabGangDurch',
  'StoneVaultEntry',
  'RockVaultEntry',
]);

/**
 * Does this prefab need a manifest entry to get the server's clear radius?
 * An own model whose hull can only come from the manifest (`extern`), minus
 * the halls the dungeon module registry builds at runtime (`registerModule`
 * puts them into `EIGENE_MODELLE_SET`): they have no manifest entry on the
 * server either, both sides size them with `renderScale`, nothing differs.
 * Read live, so a hall registered after this file loaded counts too.
 */
export function brauchtManifestEintrag(prefab: string): boolean {
  return (
    istEigenesModell(prefab) &&
    freiflaechenHuellen()(prefab)?.quelle === 'extern' &&
    !registeredModules().some((m) => m.name === prefab)
  );
}

/**
 * Names among `namen` that need a manifest hull (`braucht`) and have no entry.
 * One missing entry is enough to warn (`some`, not `every`): an entry for
 * another model does not size this one's radius.
 */
export function ohneManifestEintrag(
  namen: Iterable<string>,
  manifest: ReadonlyMap<string, unknown>,
  braucht: ((prefab: string) => boolean) | undefined
): string[] {
  if (!braucht) return [];
  const aus = new Set<string>();
  for (const n of namen) {
    if (typeof n === 'string' && !OHNE_MANIFEST_ERLAUBT.has(n) && braucht(n) && !manifest.has(n)) aus.add(n);
  }
  return [...aus];
}

export interface QuellenEingang {
  /** Manifest text (rejects on network or HTTP failure). */
  holeManifest: () => Promise<string>;
  /** Reload the upload registry; failures come back as `meldungen`, it never throws. */
  ladeRegistry: () => Promise<{ geladen: number; meldungen: string[] }>;
  /** Does the client know this prefab (`findPrefabByName`)? */
  bekannt: (prefab: string) => boolean;
  /**
   * Is this prefab an own model whose clear radius can only come from the
   * manifest (`istEigenesModell` and no store or upload hull)? Vanilla
   * prefabs never have an entry and must NOT count. Without it the manifest
   * is not checked for entries of the placed prefabs.
   */
  brauchtManifest?: (prefab: string) => boolean;
}

export interface QuellenBericht {
  manifest: Map<string, ManifestModell> | null;
  manifestFehler: string | null;
  /** Upload prefabs of the draft that were unknown at start. */
  unbekannteUploads: string[];
  /** Of those, the ones still unknown after the reload. */
  weiterUnbekannt: string[];
  registryFehler: string[];
  registryNachgeladen: boolean;
  /**
   * Placed own models that need a manifest hull but have none (at least one
   * is enough, see `ohneManifestEintrag`).
   */
  ohneManifestEintrag: string[];
}

/**
 * Loads the manifest and, if a placement points to an upload model the client
 * does not know, reloads the upload registry. Never throws.
 */
export async function ladeBewuchsQuellen(
  prefabs: Iterable<string>,
  io: QuellenEingang
): Promise<QuellenBericht> {
  const namen = [...prefabs];
  const unbekannt = [
    ...new Set(namen.filter((n) => typeof n === 'string' && n.startsWith(NAME_PRAEFIX) && !io.bekannt(n))),
  ];
  const bericht: QuellenBericht = {
    manifest: null,
    manifestFehler: null,
    unbekannteUploads: unbekannt,
    weiterUnbekannt: [],
    registryFehler: [],
    registryNachgeladen: false,
    ohneManifestEintrag: [],
  };
  try {
    const text = await io.holeManifest();
    const m = leseManifest(text);
    if (m.size === 0) bericht.manifestFehler = 'Manifest leer oder nicht lesbar';
    else {
      bericht.manifest = m;
      bericht.ohneManifestEintrag = ohneManifestEintrag(namen, m, io.brauchtManifest);
    }
  } catch (e) {
    bericht.manifestFehler = (e as Error).message;
  }
  if (unbekannt.length > 0) {
    try {
      const r = await io.ladeRegistry();
      bericht.registryNachgeladen = true;
      bericht.registryFehler = r.meldungen;
    } catch (e) {
      bericht.registryFehler = [(e as Error).message];
    }
    bericht.weiterUnbekannt = unbekannt.filter((n) => !io.bekannt(n));
  }
  return bericht;
}

/** Visible warning when preview and server may clear different areas; `null` when all sources are there. */
export function abweichungsText(b: QuellenBericht): string | null {
  const teile: string[] = [];
  if (b.manifestFehler !== null) teile.push(`Manifest fehlt (${b.manifestFehler})`);
  if (b.ohneManifestEintrag.length > 0) {
    teile.push(
      `Manifest ohne Eintrag für platzierte Prefabs: ${b.ohneManifestEintrag.slice(0, 3).join(', ')}${b.ohneManifestEintrag.length > 3 ? ' …' : ''}`
    );
  }
  if (b.weiterUnbekannt.length > 0) {
    teile.push(`Upload-Modell(e) unbekannt: ${b.weiterUnbekannt.slice(0, 3).join(', ')}${b.weiterUnbekannt.length > 3 ? ' …' : ''}`);
  } else if (b.registryFehler.length > 0) {
    teile.push(`Upload-Registry nicht sauber geladen (${b.registryFehler[0]})`);
  }
  return teile.length === 0
    ? null
    : `Bewuchs-Vorschau kann vom Spiel abweichen: ${teile.join('; ')}`;
}

/**
 * Keeps the standing warning in step with the sources: a new load result
 * (`neuerBericht`, e.g. a late manifest) and a changed draft (`pruefe`, called
 * every 250 ms with the change mark) both re-evaluate it. The warning is set
 * while the state holds and removed (`null`) when it is fixed.
 */
export class QuellenAnzeige {
  private letzteMarke: string | null | undefined = undefined;
  private letzterText: string | null | undefined = undefined;
  private fehlerGemeldet = false;

  constructor(
    private bericht: QuellenBericht,
    private readonly brauchtManifest: ((prefab: string) => boolean) | undefined,
    private readonly setze: (text: string | null) => void,
    private readonly warneFehler: (fehler: unknown) => void = (f) =>
      console.warn('[Bewuchs] Entwurf nicht lesbar, Quellenprüfung ausgesetzt:', f)
  ) {}

  /** A fresh load result replaces the old one. */
  neuerBericht(b: QuellenBericht): void {
    this.bericht = b;
    this.zeigen();
  }

  /**
   * The draft may have changed. Same mark as last time: nothing to do, and
   * `namen` (a function: it parses the whole draft) is not even called. No
   * mark given: always check. A draft that cannot be read does not throw
   * every tick: with a mark the same mark is not tried again, without one it
   * is reported once until a read works again.
   */
  pruefe(namen: () => Iterable<string>, marke: string | null): void {
    if (marke !== null && marke === this.letzteMarke) return;
    this.letzteMarke = marke;
    let gelesen: Iterable<string>;
    try {
      gelesen = namen();
    } catch (fehler) {
      if (!this.fehlerGemeldet || marke !== null) this.warneFehler(fehler);
      this.fehlerGemeldet = true;
      return;
    }
    this.fehlerGemeldet = false;
    if (this.bericht.manifest) {
      this.bericht = {
        ...this.bericht,
        ohneManifestEintrag: ohneManifestEintrag(gelesen, this.bericht.manifest, this.brauchtManifest),
      };
    }
    this.zeigen();
  }

  /** Passes on only a changed text: no console line and no DOM rebuild per drag tick. */
  private zeigen(): void {
    const text = abweichungsText(this.bericht);
    if (text === this.letzterText) return;
    this.letzterText = text;
    this.setze(text);
  }
}
