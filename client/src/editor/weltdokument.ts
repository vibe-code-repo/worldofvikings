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
 * der Testflug-Code des Spielclients (`?offline=1&layout=editor`) liest und
 * schreibt ihn an mehreren Stellen mit dem nackten String. Ihn hier
 * instanzabhängig zu machen (`wov-editor-layout-dev` …) wäre die technisch
 * sauberere Trennung — sie würde aber genau den Testflug-Code anfassen
 * müssen, der ausserhalb dieses Umbaus liegt, und stillschweigend zwei Entwürfe
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
  /**
   * Stempel des schreibenden Editor-Tabs (entwurfsSpeicher.ts): Zeitpunkt in
   * ms und Tab-Kennung. Fehlt bei Zetteln aus älteren Editorfassungen; der
   * Testflug schreibt keinen.
   */
  geaendertUm?: number;
  tabId?: string;
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
      /**
       * Stand des Dokuments auf dem Server (ETag bzw. Rumpffeld `hash`) — die
       * Basis, die beim Speichern zurückgeschickt wird. `null`, solange die
       * Gegenstelle keinen liefert; dann wird wie früher ohne Basis gespeichert.
       */
      hash: string | null;
    }
  | { erreichbar: false; grund: string };

/**
 * Steckt alles, was `klein` enthält, schon in `gross`? Grundlage der Frage
 * „geht beim Verdrängen von `klein` etwas verloren, wenn `gross` bleibt?":
 * Ein Schreiber, der seinen Stand aus dem AKTUELLEN Speicher aufbaut (der
 * Testflug, main.ts: lesen, Feld ergänzen, zurückschreiben), liefert
 * Nachfolgestände, die ihre Vorgänger enthalten — die brauchen keine eigene
 * Sicherung.
 *
 * Verglichen wird so genau, wie es die Welt unterscheidet:
 *  - `regions` als geordnete Folge: Ihre Reihenfolge ist die Z-Ordnung
 *    (spätere überdecken frühere), zwei Dokumente mit denselben Regionen in
 *    anderer Reihenfolge sind verschiedene Welten. `klein.regions` muss also
 *    in derselben Reihenfolge in `gross.regions` vorkommen (dazwischen darf
 *    anderes stehen).
 *  - `continents` ebenso als geordnete Folge: Der Server nimmt ohne
 *    Welt-Startpunkt den ERSTEN Kontinent mit eigenem Spawn; dieselben
 *    Kontinente in anderer Reihenfolge können einen anderen Startpunkt geben.
 *  - Platzierungen, Flüsse, Seen und Routen als Multimenge: Doppelte
 *    zählen, `[P]` enthält `[P, P]` nicht. Bei Platzierungen bleibt das Feld
 *    `id` außen vor: Es ist eine Kennung, kein Inhalt, und frisch gebaute
 *    Stände (`layoutMitPlatzierung`) tragen keine, Ring-Einträge schon.
 *  - Name, Detail-Seed und Startpunkt müssen übereinstimmen.
 * Elemente werden als JSON verglichen. Im Zweifel `false`: ein Stand zu viel
 * zu sichern kostet nur Platz.
 */
export function enthaelt(gross: WorldLayout, klein: WorldLayout): boolean {
  if (gross === klein) return true;
  /** Textform einer Platzierung ohne das Feld `id` (die übrigen Felder in ihrer Reihenfolge). */
  const ohneId = (p: unknown): string => {
    if (p && typeof p === 'object' && !Array.isArray(p) && 'id' in p) {
      const { id: _id, ...rest } = p as Record<string, unknown>;
      return JSON.stringify(rest);
    }
    return JSON.stringify(p);
  };
  const folge = (g: readonly unknown[] | undefined, k: readonly unknown[] | undefined): boolean => {
    if (!k || k.length === 0) return true;
    const gj = (g ?? []).map((x) => JSON.stringify(x));
    let i = 0;
    for (const x of k) {
      const j = JSON.stringify(x);
      while (i < gj.length && gj[i] !== j) i++;
      if (i >= gj.length) return false;
      i++;
    }
    return true;
  };
  const multimenge = (
    g: readonly unknown[] | undefined,
    k: readonly unknown[] | undefined,
    schluessel: (x: unknown) => string = (x) => JSON.stringify(x)
  ): boolean => {
    if (!k || k.length === 0) return true;
    const zaehler = new Map<string, number>();
    for (const x of g ?? []) {
      const j = schluessel(x);
      zaehler.set(j, (zaehler.get(j) ?? 0) + 1);
    }
    for (const x of k) {
      const j = schluessel(x);
      const n = zaehler.get(j) ?? 0;
      if (n === 0) return false;
      zaehler.set(j, n - 1);
    }
    return true;
  };
  return (
    gross.name === klein.name &&
    gross.detailSeed === klein.detailSeed &&
    (klein.defaultSpawn === undefined || JSON.stringify(gross.defaultSpawn) === JSON.stringify(klein.defaultSpawn)) &&
    folge(gross.regions, klein.regions) &&
    folge(gross.continents, klein.continents) &&
    multimenge(gross.placements, klein.placements, ohneId) &&
    multimenge(gross.rivers, klein.rivers) &&
    multimenge(gross.lakes, klein.lakes) &&
    multimenge(gross.routes, klein.routes)
  );
}

/**
 * Braucht das Ersetzen des angezeigten Entwurfs durch `ersatz` einen
 * Rückgängig-Schritt? Immer, wenn dabei etwas verloren ginge: also bei jedem
 * abweichenden Entwurf — auch einem, der nur Flüsse, Seen, Kontinente oder
 * Routen enthält. Keinen Schritt bekommen nur der gleiche Entwurf (nichts
 * geht verloren) und der wirklich leere Startzustand (sonst löschte das erste
 * Strg+Z die frisch geladene Welt).
 */
export function brauchtSchrittVorErsetzen(aktuell: WorldLayout, ersatz: WorldLayout): boolean {
  return !gleich(aktuell, ersatz) && !gleich(aktuell, leeresLayout());
}

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
export async function holeWeltdokument(fetchFn: typeof fetch = fetch): Promise<ServerStand> {
  let antwort: Response;
  try {
    antwort = await fetchFn('/api/worldlayout', {
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
    hash?: unknown;
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
    hash: hashNormalisieren(daten.hash) ?? hashNormalisieren(antwort.headers?.get('ETag')),
  };
}

/**
 * Hash aus Rumpffeld oder Kopfzeile in eine Form bringen: ohne
 * Anführungszeichen und ohne schwaches Präfix (`W/"…"`). `null` für alles,
 * was kein nichtleerer Text ist.
 */
export function hashNormalisieren(roh: unknown): string | null {
  if (typeof roh !== 'string') return null;
  const t = roh.trim().replace(/^W\/\s*/, '').replace(/^"(.*)"$/, '$1').trim();
  return t === '' ? null : t;
}

/**
 * Basis für einen Schreibvorgang, den der Nutzer gegen einen FRISCH gelesenen
 * Serverstand bestätigt hat („Ja, überschreiben" nach der Gegenüberstellung):
 * genau dieser Stand ist es, den er gesehen und zu ersetzen zugestimmt hat.
 * Mit der alten Basis liefe die bestätigte Ersetzung in einen 409 und einen
 * zweiten Dialog. Konnte der Stand nicht gelesen werden oder trägt keinen
 * Hash, bleibt es bei der bisherigen Basis.
 */
export function basisNachBestaetigung(bisher: string | null, frisch: ServerStand): string | null {
  return frisch.erreichbar && frisch.hash !== null ? frisch.hash : bisher;
}

/**
 * Nutzertext für „der Entwurf hat keine Basis“, vom Editor gezeigt, BEVOR er
 * sendet (nach einem JSON-Import, oder wenn der Betriebsdienst beim Start nicht
 * erreichbar war und es keinen früheren Serverstand gibt). Nennt den Weg heraus:
 * das Welt-Feld anklicken holt den Serverstand und öffnet die Gegenüberstellung.
 */
export const BASIS_FEHLT =
  'Nicht gespeichert: Der Entwurf beruht auf keinem bekannten Serverstand (z. B. nach einem JSON-Import). ' +
  'Weg heraus: links oben in der Kopfzeile das Feld „WELT" (zeigt den Instanznamen, z. B. „dev") anklicken — ' +
  'das holt den Serverstand und zeigt die Gegenüberstellung. Dort „Entwurf behalten" wählen ' +
  '(der Serverstand wird dann beim nächsten Speichern bewusst ersetzt) oder „Serverstand laden", danach speichern.';

/**
 * Nutzertext für die Antwort 428 des Betriebsdienstes. Bewusst neutral: Der
 * Dienst verlangt eine Basis; ob der Aufrufer eine mitgeschickt hat und der
 * Dienst sie nicht erkannte, sagt die Antwort nicht.
 */
export const BASIS_VERLANGT =
  'Nicht gespeichert: Der Betriebsdienst verlangt für das Speichern eine Basis (den Serverstand, auf dem der Entwurf beruht) ' +
  'und hat nichts geschrieben. Serverstand laden oder abgleichen (Feld „WELT" links oben in der Kopfzeile anklicken) ' +
  'und dann erneut speichern.';

/** Ausgang von `schreibeWeltdokument`. */
export type SchreibAntwort =
  | { art: 'ok'; message: string; hash: string | null }
  /** Der Server hat seit der Basis einen anderen Stand — NICHTS wurde geschrieben. */
  | { art: 'veraltet'; message: string; aktuell: string | null }
  /** Der Betriebsdienst verlangt eine Basis (428) und hat nichts geschrieben: den Serverstand laden/abgleichen. */
  | { art: 'basis-fehlt'; message: string }
  | { art: 'zu-viele-platzierungen'; message: string; anzahl: number; grenze: number }
  | { art: 'fehler'; message: string };

/**
 * Das Dokument auf den Server schreiben — mit der zuletzt gelesenen Basis.
 *
 * Die Basis geht im Kopf `If-Match: "<hash>"` mit und NICHT als Rumpffeld:
 * der Rumpf ist das Dokument selbst, und ein Zusatzfeld darin verwürfe die
 * Sanitisierung stillschweigend. Ohne bekannten Hash (`basis === null`, z. B.
 * eine Gegenstelle ohne K0.2) geht die Anfrage ohne Kopf hinaus, wie bisher.
 *
 * Kein Wiederholen und kein „dann eben ohne Basis": Bei 409 wird nichts
 * gesendet, der Aufrufer zeigt den aktuellen Stand und lässt entscheiden.
 *
 * Bewusst DOM-frei und mit hereingereichtem `fetch`, damit der Speicherweg
 * ohne Editorfenster prüfbar ist (client/test/editor-speichern-basis.ts).
 */
export async function schreibeWeltdokument(
  layout: WorldLayout,
  basis: string | null,
  fetchFn: typeof fetch = fetch
): Promise<SchreibAntwort> {
  const kopf: Record<string, string> = { 'Content-Type': 'application/json' };
  const b = hashNormalisieren(basis);
  if (b) kopf['If-Match'] = `"${b}"`;

  let antwort: Response;
  try {
    antwort = await fetchFn('/api/worldlayout', { method: 'POST', headers: kopf, body: JSON.stringify(layout) });
  } catch (fehler) {
    return { art: 'fehler', message: `Speichern fehlgeschlagen: ${String(fehler)}` };
  }

  let d: {
    ok?: boolean;
    message?: string;
    fehler?: string;
    aktuell?: unknown;
    hash?: unknown;
    anzahl?: unknown;
    grenze?: unknown;
    verworfen?: unknown;
    verworfenJeFeld?: unknown;
  } = {};
  try {
    d = JSON.parse(await antwort.text()) as typeof d;
  } catch {
    // Kein JSON: unten aus dem Statuscode entscheiden.
  }

  if (antwort.status === 409) {
    return {
      art: 'veraltet',
      message: 'Die Welt auf dem Server hat sich seit dem Laden geändert — nichts geschrieben.',
      aktuell: hashNormalisieren(d.aktuell) ?? hashNormalisieren(antwort.headers?.get('ETag')),
    };
  }
  // Der Dienst verlangt eine Basis (`If-Match`). Editor und Testflug senden ohne
  // Basis gar nicht erst (s. editorMain.inDieWeltSpeichern); eine 428 kommt also
  // von einer Gegenstelle oder einer anderen Dienstfassung — der Text sagt nur,
  // was sicher ist.
  if (antwort.status === 428) {
    return { art: 'basis-fehlt', message: BASIS_VERLANGT };
  }
  if (antwort.status === 422 && d.fehler === 'zu-viele-platzierungen') {
    const anzahl = Number(d.anzahl);
    const grenze = Number(d.grenze);
    if (Number.isFinite(anzahl) && Number.isFinite(grenze)) {
      return {
        art: 'zu-viele-platzierungen',
        anzahl,
        grenze,
        message: `Zu viele Platzierungen: ${anzahl} (Grenze ${grenze}) — nicht gespeichert.`,
      };
    }
  }
  // Gesperrt: ein anderer Vorgang schreibt gerade dieselbe Weltdatei. Nichts
  // ist verloren, ein zweiter Versuch gelingt fast immer nach Sekunden.
  if (antwort.status === 503) {
    const warte = Number(antwort.headers?.get('Retry-After'));
    return {
      art: 'fehler',
      message:
        'Die Welt wird gerade von einem anderen Vorgang gespeichert – in ein paar Sekunden erneut versuchen' +
        (Number.isFinite(warte) && warte > 0 ? ` (Retry-After: ${warte} s)` : '') +
        ' — nichts geschrieben.',
    };
  }
  if (antwort.ok && d.ok !== false) {
    // Hat der Betriebsdienst Einträge verworfen (nur erreichbar mit einem
    // Fremdschreiber oder einer älteren Editorfassung: Editor und Testflug
    // schicken schon gefilterte Listen), steht die Zahl in der Meldung.
    const verworfen = Number(d.verworfen);
    const jeFeld =
      d.verworfenJeFeld && typeof d.verworfenJeFeld === 'object'
        ? Object.entries(d.verworfenJeFeld as Record<string, unknown>)
            .filter(([, n]) => Number(n) > 0)
            .map(([feld, n]) => `${feld}: ${Number(n)}`)
        : [];
    const hinweis =
      Number.isFinite(verworfen) && verworfen > 0
        ? ` — ACHTUNG: ${verworfen} Eintrag/Einträge vom Betriebsdienst verworfen` +
          (jeFeld.length > 0 ? ` (${jeFeld.join(', ')})` : '')
        : '';
    return {
      art: 'ok',
      message: (d.message ?? 'Gespeichert') + hinweis,
      hash: hashNormalisieren(d.hash) ?? hashNormalisieren(antwort.headers?.get('ETag')),
    };
  }
  return { art: 'fehler', message: d.message ?? d.fehler ?? `HTTP ${antwort.status}` };
}

/**
 * Das Layout mit einer zusätzlichen Platzierung. Ersetzt das Layout, statt
 * es zu ändern: Der Rückgängig-Stapel des Editors hält Schnappschüsse, und
 * nur ein unverändertes altes Layout ist ein brauchbarer Schnappschuss.
 */
export function layoutMitPlatzierung(
  layout: WorldLayout,
  prefab: string,
  x: number,
  z: number,
  yaw: number
): WorldLayout {
  return {
    ...layout,
    placements: [...(layout.placements ?? []), { prefab, x: Math.round(x), z: Math.round(z), yaw }],
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
      ...(typeof d.geaendertUm === 'number' ? { geaendertUm: d.geaendertUm } : {}),
      ...(typeof d.tabId === 'string' ? { tabId: d.tabId } : {}),
    };
  } catch {
    return null;
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
