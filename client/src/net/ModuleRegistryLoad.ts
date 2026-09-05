/**
 * ModuleRegistryLoad.ts — die Modulregistry im BROWSER (E6).
 *
 * ── Wozu ─────────────────────────────────────────────────────────────
 * Seit E5 kann der Spielserver zur Laufzeit einen Saal bauen: Er schreibt
 * `assets/generiert/<name>.glb`, trägt ihn in `assets/generiert/
 * modul-registry.json` ein und registriert ihn in seinen eigenen
 * Nachschlagewerken. Der BROWSER weiss davon nichts — sein Bündel kennt
 * nur, was zur Bauzeit in `eigeneDungeons.ts` stand. Ohne diese Datei
 * hier bliebe ein gebauter Saal für den Editor unsichtbar und für das
 * Spiel unladbar, und ein Dokument, das ihn nennt, verlöre ihn beim
 * Speichern STILL (`sanitizeDungeonDocument` verwirft unbekannte Räume
 * wortlos).
 *
 * ── Warum ein `fetch` und kein Paket über den Spielsocket ────────────
 * Weil der Karteneditor keinen Spielsocket hat, solange niemand
 * speichert — und weil die Registry neben den GLBs liegt, die derselbe
 * Webserver ohnehin ausliefert (Vite-Plugin im Dev-Server, nginx live).
 * Ein eigenes Paket bräuchte eine Verbindung, ein Tor und eine Drossel
 * für eine Datei, die jeder Besucher sowieso lesen darf.
 *
 * ── Warum eine FEHLENDE Datei kein Fehler ist ────────────────────────
 * Sie ist der Normalfall. `assets/generiert/` entsteht erst, wenn jemand
 * zum ersten Mal einen Saal baut; auf jeder anderen Maschine liefert der
 * Webserver 404. Ein Client, der daran stürbe, käme wegen einer Datei
 * nicht ins Spiel, die es normalerweise gar nicht gibt. 404, Zeitablauf,
 * kaputtes JSON — alle drei bedeuten dasselbe: keine generierten Module.
 * Und weil die Prüfsumme dieser Seite dann die der leeren Registry ist,
 * meldet der Server beim Speichern von selbst „Registry veraltet", wenn
 * er welche kennt. Der stille Fall bleibt still, der laute wird laut.
 *
 * ── Warum das Ergebnis nicht gecacht werden darf ─────────────────────
 * Live liegt `/assets/` sieben Tage im Browsercache
 * (`deploy/nginx-live.conf`). Für die GLBs ist das richtig — ihre Namen
 * sind unveränderlich, ein geänderter Saal ist ein NEUER Name. Für die
 * Registry wäre es fatal: Sie ist die EINZIGE Datei unter `/assets/`, die
 * sich unter gleichem Namen ändert. Eine Woche alte Registry hiesse eine
 * Woche lang „Registry veraltet — Seite neu laden", und das Neuladen
 * hülfe nicht. Deshalb `cache: 'no-store'`.
 *
 * Fetches the runtime module registry and registers every entry, before
 * the first catalog is built. A missing file means "no generated modules"
 * — the normal case — and never blocks startup.
 */
import { moduleRegistry } from '@wov/shared';
import { GENERATED_BASE_URL } from '../engine/assetUrls';

/** Wo die Registry liegt — beide Hälften aus derselben Quelle wie die GLBs. */
export const REGISTRY_URL = `${GENERATED_BASE_URL}${moduleRegistry.REGISTRY_DATEI}`;

export interface RegistryLadeBericht {
  /** Module, die diese Seite jetzt kennt. */
  readonly geladen: number;
  /** Prüfsumme DIESER Seite — dieselbe Zahl, die mit jedem Speichern reist. */
  readonly pruefsumme: string;
  /** Verworfene Einträge und Ladefehler, im Klartext. */
  readonly meldungen: string[];
}

/**
 * Die Registry holen und jeden Eintrag registrieren.
 *
 * MUSS vor dem ersten Katalogaufbau laufen, und das ist keine Stilfrage:
 * Zwei Stellen KOPIEREN die Prefab-Registry, statt sie zu befragen —
 * `GegenstandsKatalog` leitet sein `MIT_MODELL` beim IMPORT ab, und die
 * Dungeon-Seite baut ihre Modulliste im Konstruktor. Eine Registrierung
 * danach trägt in alle sechs Karten ein und bleibt trotzdem unsichtbar,
 * ohne Meldung, weil nichts fehlschlägt.
 *
 * Wirft nie. Ein Einstieg, der auf diese Funktion wartet, wartet höchstens
 * auf einen Zeitablauf — nicht auf einen Ausgang, den er behandeln muss.
 */
export async function ladeModulRegistrierung(
  basis: string = REGISTRY_URL
): Promise<RegistryLadeBericht> {
  const meldungen: string[] = [];
  let text: string | null = null;
  try {
    const antwort = await fetch(basis, { cache: 'no-store' });
    // 404 ist der Normalfall, nicht der Ausnahmefall: Der Ordner entsteht
    // erst mit dem ersten gebauten Saal. Deshalb keine Meldung dafür.
    if (antwort.ok) text = await antwort.text();
    else if (antwort.status !== 404) meldungen.push(`${basis}: HTTP ${antwort.status}`);
  } catch (e) {
    meldungen.push(`${basis}: ${(e as Error).message}`);
  }

  if (text !== null) {
    const stand = moduleRegistry.leseRegistryAusText(text);
    const erg = moduleRegistry.applyModuleRegistry(stand);
    meldungen.push(...erg.meldungen);
    if (erg.geladen > 0) {
      console.log(`[Module] ${erg.geladen} gebaute(r) Saal/Säle aus ${basis} registriert`);
    }
  }
  for (const m of meldungen) console.warn(`[Module] ${m}`);

  return { geladen: moduleRegistry.registeredModules().length, pruefsumme: moduleRegistry.registryChecksum(), meldungen };
}
