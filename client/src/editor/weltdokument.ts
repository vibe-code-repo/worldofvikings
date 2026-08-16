/**
 * Weltdokument — der LESEWEG des Editors und der Vergleich mit dem
 * Browser-Entwurf.
 *
 * ── Warum es diese Datei gibt (Block A/16, Phase 2) ──────────────────
 * Bis hierher kannte der Editor sein Layout AUSSCHLIESSLICH aus dem
 * localStorage: `ladeEntwurf()` las `wov-editor-layout`, und der
 * Speicherknopf schrieb genau das auf den Server. Es gab einen
 * Schreibweg und keinen Leseweg.
 *
 * Solange es eine einzige Weltdatei gab, war das unschön. Seit
 * `WOV_INSTANZ` zwischen `welten/dev.json` und `welten/live.json`
 * wählt, ist es gefährlich: Der localStorage hängt am BROWSER, nicht an
 * der Instanz. Derselbe Tab, der eben noch dev bearbeitet hat, kann
 * seinen Entwurf nach live.json schreiben, ohne live.json je gesehen zu
 * haben. Am 16.08.2026 ist genau das passiert (17 Regionen durch ein
 * 4-Regionen-Testlayout ersetzt); dass die echte Welt daneben in Git
 * lag, war Glück und kein Verfahren.
 *
 * ── Warum der localStorage trotzdem bleibt ───────────────────────────
 * Er ist der ungespeicherte Entwurf, und der ist ein echtes Bedürfnis:
 * Wer den Tab schliesst, will seine halbfertige Insel wiederfinden.
 * Beide Stände wegzuwerfen wäre falsch, und beide Auflösungen, die man
 * zuerst hinschreibt, sind es auch:
 *
 *   „localStorage gewinnt"  ist der heutige Fehler, nur schriftlich.
 *   „Server gewinnt"        wirft ungespeicherte Arbeit still weg.
 *
 * Deshalb entscheidet der NUTZER, und zwar informiert: `vergleiche()`
 * sagt ihm, worin sich die beiden Stände unterscheiden, bevor er wählt
 * (AbgleichDialog.ts zeigt es an).
 *
 * ── Bewusst DOM-frei ─────────────────────────────────────────────────
 * Hier steht kein `document`, kein `window` ausser `localStorage` und
 * `fetch` (beides auch in Workern vorhanden). Die Entscheidung „weichen
 * die Stände voneinander ab" ist die teuerste Zusicherung dieses
 * Schritts — sie soll ohne Editor-Fenster nachvollziehbar und prüfbar
 * bleiben, nicht in einer Klick-Behandlung stecken.
 */
import { sanitizeWorldLayout, type WorldLayout } from '@wov/shared';

/**
 * Der Entwurfsschlüssel. Er hiess schon immer so und heisst weiter so:
 * client/src/main.ts liest und schreibt ihn im Testflug an einem guten
 * Dutzend Stellen mit dem nackten String. Ihn hier instanzabhängig zu
 * machen (`wov-editor-layout-dev` …) wäre die technisch sauberere
 * Trennung — sie würde aber genau die Datei anfassen müssen, die
 * ausserhalb dieses Umbaus liegt, und stillschweigend zwei Entwürfe
 * anlegen, zwischen denen niemand umschalten kann. Stattdessen merkt
 * sich `EntwurfsStand.instanz`, für WELCHE Welt der Entwurf gedacht war
 * — abweichende Instanz ist dann eine Warnung im Dialog statt einer
 * unsichtbaren zweiten Schublade.
 */
export const ENTWURF_KEY = 'wov-editor-layout';

/**
 * Begleitzettel zum Entwurf — bewusst ein EIGENER Schlüssel.
 *
 * Der Entwurf selbst muss ein reines WorldLayout bleiben: main.ts
 * (Testflug), RoutenEditor und RoutenVorschau lesen ihn Feld für Feld
 * und reichen ihn an `sanitizeWorldLayout` weiter. Ein Zusatzfeld
 * `zuletztGeaendert` darin würde von der Sanitisierung stillschweigend
 * verworfen — beim nächsten Speichern wäre es weg, und man hätte lange
 * gesucht, warum.
 */
export const STAND_KEY = 'wov-editor-entwurf-stand';

/** Woher der Entwurf in seiner jetzigen Fassung stammt. */
export type EntwurfsQuelle =
  /** 1:1 vom Server geladen bzw. eben dorthin gespeichert — deckungsgleich. */
  | 'server'
  /** Im Editor verändert und (noch) nicht gespeichert. */
  | 'bearbeitet'
  /** Aus einer JSON-Datei eingespielt. */
  | 'import';

export interface EntwurfsStand {
  /** ISO-Zeitstempel der letzten Änderung am Entwurf. */
  zeit: string;
  /** Instanz, die beim Schreiben offen war — `null`, wenn unbekannt. */
  instanz: string | null;
  quelle: EntwurfsQuelle;
}

/**
 * Antwort des Betriebsdienstes auf `GET /api/worldlayout`.
 *
 * `instanz` und `datei` kommen aus DERSELBEN Antwort wie das Dokument.
 * Das ist Absicht: Der Editor muss wissen, welche Welt er da vor sich
 * hat, und die einzige Quelle, der man das glauben darf, ist der
 * Dienst, der die Datei auch schreibt. Hostname und URL können lügen
 * (ein Reverse-Proxy, ein SSH-Tunnel, eine Kopie der Domain), der
 * Betriebsdienst kann es nicht — er löst `WOV_INSTANZ` über
 * `weltDatei(WURZEL, INSTANZ)` genauso auf wie der Spielserver.
 */
export type ServerStand =
  | {
      erreichbar: true;
      layout: WorldLayout;
      /** `null` nur, wenn eine ältere Gegenstelle das Feld nicht liefert. */
      instanz: string | null;
      datei: string | null;
      message: string;
    }
  | { erreichbar: false; grund: string };

/** Leeres Dokument — der Startzustand ohne Entwurf und ohne Server. */
export function leeresLayout(): WorldLayout {
  return {
    version: 1,
    name: 'World of Vikings',
    detailSeed: 'wov-alpha',
    continents: [],
    regions: [],
  };
}

/**
 * Das Dokument vom Betriebsdienst holen.
 *
 * Der Pfad ist `/api/worldlayout` und bleibt es — auf dev reicht ihn der
 * Vite-Proxy an wov-admin durch, auf live der `location /api/`-Block des
 * nginx. Der Token wird in BEIDEN Fällen vom Vorschalter gesetzt und
 * taucht im Browser nie auf; ein 401 hier heisst deshalb nicht „falsches
 * Passwort", sondern „der Vorschalter setzt den Token nicht".
 *
 * VERWORFEN: `/status` (Feld `instanz`), obwohl es die naheliegende
 * Quelle für den Instanznamen wäre. `/status` liegt NICHT unter `/api/`
 * — weder der Vite-Proxy noch nginx leiten es weiter, der Browser bekäme
 * die index.html des Editors zurück (nachgemessen: 200 text/html). Beide
 * Vorschalter zu erweitern hiesse vite.config.ts und nginx-live.conf
 * anzufassen. Das Feld steht ohnehin in der Antwort, die der Editor
 * sowieso braucht, und stammt im Betriebsdienst aus derselben Konstante
 * `INSTANZ` — dieselbe Wahrheit, ein Rundlauf weniger.
 */
export async function holeWeltdokument(): Promise<ServerStand> {
  let antwort: Response;
  try {
    antwort = await fetch('/api/worldlayout', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (fehler) {
    // Netzwerkebene: auf dev heisst das fast immer „wov-admin läuft
    // nicht" (der Vite-Proxy antwortet dann mit ECONNREFUSED).
    return {
      erreichbar: false,
      grund: `Betriebsdienst nicht erreichbar (${String(fehler)}) — läuft wov-admin?`,
    };
  }

  // Erst den Text, dann JSON.parse: Wenn der Vorschalter `/api/` NICHT
  // weiterleitet, liefert er die index.html mit 200 zurück. `r.json()`
  // wirft dann einen Syntaxfehler, dessen Wortlaut niemandem hilft —
  // hier steht stattdessen, was tatsächlich zu tun ist.
  const roh = await antwort.text();
  let daten: {
    ok?: boolean;
    message?: string;
    instanz?: string;
    datei?: string;
    layout?: unknown;
  };
  try {
    daten = JSON.parse(roh) as typeof daten;
  } catch {
    return {
      erreichbar: false,
      grund:
        `/api/worldlayout antwortet kein JSON (HTTP ${antwort.status}) — ` +
        'leitet der Vorschalter (Vite-Proxy bzw. nginx) /api/ an wov-admin weiter?',
    };
  }

  if (!antwort.ok || daten.ok === false) {
    return { erreichbar: false, grund: daten.message ?? `HTTP ${antwort.status}` };
  }

  // Auch das Serverdokument läuft durch die Prüfung, obwohl der
  // Betriebsdienst es schon geprüft hat. Nicht aus Misstrauen gegen ihn,
  // sondern weil der Editor mit einem `WorldLayout` weiterarbeitet und
  // nicht mit `unknown`: Ohne diesen Schritt stünde hier ein `as`-Cast,
  // und eine kaputte Antwort schlüge erst beim Zeichnen zu.
  const layout = sanitizeWorldLayout(daten.layout);
  if (!layout) {
    return {
      erreichbar: false,
      grund: `${daten.datei ?? 'Weltdatei'} ist kein gültiges WorldLayout — von Hand prüfen.`,
    };
  }

  return {
    erreichbar: true,
    layout,
    instanz: daten.instanz ?? null,
    datei: daten.datei ?? null,
    message: daten.message ?? '',
  };
}

/**
 * Entwurf aus dem localStorage — `null`, wenn keiner da ist.
 *
 * Der Unterschied zwischen „kein Entwurf" und „leerer Entwurf" ist der
 * ganze Punkt: Ohne Entwurf gibt es nichts zu entscheiden, der
 * Serverstand wird kommentarlos übernommen. Ein LEERES Dokument dagegen
 * ist eine Aussage („ich habe alles gelöscht") und muss abgefragt
 * werden — deshalb liefert diese Funktion kein Ersatzdokument.
 */
export function entwurfLesen(): WorldLayout | null {
  let roh: string | null;
  try {
    roh = localStorage.getItem(ENTWURF_KEY);
  } catch {
    return null; // Privater Modus / abgeschalteter Speicher
  }
  if (roh === null || roh === '') return null;
  try {
    return sanitizeWorldLayout(JSON.parse(roh));
  } catch {
    return null;
  }
}

export function entwurfStandLesen(): EntwurfsStand | null {
  try {
    const roh = localStorage.getItem(STAND_KEY);
    if (!roh) return null;
    const d = JSON.parse(roh) as Partial<EntwurfsStand>;
    if (typeof d.zeit !== 'string') return null;
    return {
      zeit: d.zeit,
      instanz: typeof d.instanz === 'string' ? d.instanz : null,
      quelle: d.quelle === 'server' || d.quelle === 'import' ? d.quelle : 'bearbeitet',
    };
  } catch {
    return null;
  }
}

/**
 * Entwurf samt Begleitzettel schreiben. `false` heisst „Speicher voll"
 * — der Aufrufer muss das melden, sonst arbeitet jemand eine Stunde in
 * einem Entwurf, der beim Neuladen weg ist.
 */
export function entwurfSchreiben(
  layout: WorldLayout,
  quelle: EntwurfsQuelle,
  instanz: string | null
): boolean {
  try {
    localStorage.setItem(ENTWURF_KEY, JSON.stringify(layout));
    // Der Begleitzettel wird NACH dem Entwurf geschrieben: Reisst die
    // Quote, fehlt lieber der Zettel als der Entwurf.
    localStorage.setItem(
      STAND_KEY,
      JSON.stringify({ zeit: new Date().toISOString(), instanz, quelle } satisfies EntwurfsStand)
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Kanonische Textform eines Layouts — die Grundlage jedes Vergleichs.
 *
 * `sanitizeWorldLayout` baut seine Objekte in FESTER Feldreihenfolge auf
 * und lässt alles Unbekannte weg. Beide Seiten durch dieselbe Funktion
 * zu schicken macht `JSON.stringify` damit zu einem belastbaren
 * Gleichheitstest: Zwei Dokumente, die hier denselben Text ergeben,
 * erzeugen auch dieselbe Welt. Ein Feldervergleich von Hand hätte bei
 * jedem neuen Schema-Feld stillschweigend aufgehört zu stimmen.
 *
 * `null` heisst „nicht sanitisierbar" und ist NIE gleich irgendetwas,
 * auch nicht sich selbst (s. `gleich`).
 */
export function kanon(layout: unknown): string | null {
  const s = sanitizeWorldLayout(layout);
  return s ? JSON.stringify(s) : null;
}

export function gleich(a: unknown, b: unknown): boolean {
  const ka = kanon(a);
  const kb = kanon(b);
  return ka !== null && kb !== null && ka === kb;
}

/** Eine Zeile der Gegenüberstellung Server ↔ Entwurf. */
export type Unterschied =
  | { art: 'zeile'; feld: string; server: string; entwurf: string; schwer: boolean }
  | { art: 'hinweis'; text: string; schwer: boolean };

const MAX_IDS = 8;
function idListe(ids: readonly string[]): string {
  return ids.length <= MAX_IDS
    ? ids.join(', ')
    : `${ids.slice(0, MAX_IDS).join(', ')} … (+${ids.length - MAX_IDS})`;
}

/**
 * Gegenüberstellung für den Dialog.
 *
 * Regionen und Platzierungen stehen IMMER da, auch wenn sie gleich sind
 * — das sind die beiden Zahlen, an denen man den Unfall vom 16.08.2026
 * gesehen hätte (17 → 4 Regionen, 164 → 0 Platzierungen). Alles andere
 * erscheint nur, wenn es sich unterscheidet, damit die Zeilen, die
 * dastehen, auch etwas bedeuten.
 *
 * `schwer` markiert, was VERLUST bedeutet: weniger Elemente im Entwurf
 * als auf dem Server, oder Regionen, die es nur auf dem Server gibt.
 */
export function vergleiche(server: WorldLayout, entwurf: WorldLayout): Unterschied[] {
  const zeilen: Unterschied[] = [];
  const anzahl = (feld: string, s: readonly unknown[] | undefined, e: readonly unknown[] | undefined, immer = false): void => {
    const sn = s?.length ?? 0;
    const en = e?.length ?? 0;
    if (!immer && sn === en) return;
    zeilen.push({ art: 'zeile', feld, server: String(sn), entwurf: String(en), schwer: en < sn });
  };
  anzahl('Regionen', server.regions, entwurf.regions, true);
  anzahl('Platzierungen', server.placements, entwurf.placements, true);
  anzahl('Kontinente', server.continents, entwurf.continents);
  anzahl('Flüsse', server.rivers, entwurf.rivers);
  anzahl('Seen', server.lakes, entwurf.lakes);
  anzahl('Routen', server.routes, entwurf.routes);
  if (server.name !== entwurf.name) {
    zeilen.push({ art: 'zeile', feld: 'Weltname', server: server.name, entwurf: entwurf.name, schwer: false });
  }
  if (server.detailSeed !== entwurf.detailSeed) {
    // Ein anderer detailSeed heisst: dieselben Umrisse, aber jeder Hügel
    // und jeder Baum an einer anderen Stelle. Das ist keine Kleinigkeit.
    zeilen.push({
      art: 'zeile',
      feld: 'Detail-Seed',
      server: server.detailSeed,
      entwurf: entwurf.detailSeed,
      schwer: true,
    });
  }

  // Regionen namentlich: Zahlen allein verschleiern den Fall „eine
  // gelöscht, eine neu" — der Zähler bleibt gleich, die Welt nicht.
  const sRegionen = new Map(server.regions.map((r) => [r.id, JSON.stringify(r)]));
  const eRegionen = new Map(entwurf.regions.map((r) => [r.id, JSON.stringify(r)]));
  const nurServer = [...sRegionen.keys()].filter((id) => !eRegionen.has(id));
  const nurEntwurf = [...eRegionen.keys()].filter((id) => !sRegionen.has(id));
  const geaendert = [...sRegionen.keys()].filter(
    (id) => eRegionen.has(id) && eRegionen.get(id) !== sRegionen.get(id)
  );
  if (nurServer.length > 0) {
    zeilen.push({
      art: 'hinweis',
      text: `Nur auf dem Server, im Entwurf NICHT vorhanden: ${idListe(nurServer)}`,
      schwer: true,
    });
  }
  if (nurEntwurf.length > 0) {
    zeilen.push({ art: 'hinweis', text: `Nur im Entwurf, neu: ${idListe(nurEntwurf)}`, schwer: false });
  }
  if (geaendert.length > 0) {
    zeilen.push({ art: 'hinweis', text: `Beidseitig vorhanden, aber verändert: ${idListe(geaendert)}`, schwer: false });
  }
  return zeilen;
}

/** „vor 3 Minuten" statt eines ISO-Zeitstempels. */
export function alter(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  if (ms < 0) return 'in der Zukunft (Uhr des Rechners prüfen)';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Minute(n)`;
  const std = Math.round(min / 60);
  if (std < 48) return `vor ${std} Stunde(n)`;
  return `vor ${Math.round(std / 24)} Tag(en)`;
}
