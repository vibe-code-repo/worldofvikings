/**
 * AP15.2 — Seitenleiste des Dungeon-Generators 2.0 im Karteneditor:
 * Laden/Speichern/Pruefen/Betreten, dazu das Anlegen neuer Dokumente.
 * AP15.2 — sidebar of dungeon generator 2.0 in the map editor:
 * load/save/check/enter, plus creating new documents.
 *
 * Analog zur LEGACY-`DungeonSeite` (`client/src/editor/DungeonKatalog.ts`),
 * aber gegen die 2.0-Bausteine: gelesen wird ueber `Dungeon2Dokument.ts`
 * (`/api/dungeons2*`, AP15.0), geschrieben ueber `Dungeon2Speichern.ts`
 * (`DungeonEditSave`/`DungeonEditData`, AP15.1). Dieselbe Zwei-Wege-
 * Begruendung wie im LEGACY-Kopfkommentar gilt unveraendert.
 * Same as the LEGACY `DungeonSeite`, but wired to the 2.0 building blocks:
 * reading goes through `Dungeon2Dokument.ts`, writing through
 * `Dungeon2Speichern.ts`. Same two-path reasoning as the LEGACY header.
 *
 * ── Was diese Datei NICHT tut ───────────────────────────────────────────
 * Sie zeichnet kein Zellgitter und bearbeitet keine Zelle direkt — das ist
 * `CellCanvas.ts` (AP15.3, existiert bereits) und `CellTools.ts`/
 * `RoomStampPalette.ts` (AP15.4/15.5, im Bau). Diese Datei kennt nur die
 * SCHMALEN Schnittstellen `Dungeon2Zeichenflaeche` und
 * `Dungeon2Werkzeugandockung` weiter unten; die tatsaechliche Verdrahtung
 * (welches Werkzeug aktiv ist, wie ein Klick in eine Mutation wird) ist
 * AP15.7. Ein `CellCanvas`-Objekt erfuellt `Dungeon2Zeichenflaeche` schon
 * heute strukturell (`setzeLayout`, `zeige`) — geprueft am 2026-09-01 gegen
 * `client/src/editor/dungeon2/CellCanvas.ts` —, es wird hier trotzdem NICHT
 * importiert: Die Abhaengigkeit soll von aussen hineingereicht werden, nicht
 * von hier aus entstehen.
 * This file does NOT draw a cell grid or edit a cell directly — that is
 * `CellCanvas.ts` (already built) and `CellTools.ts`/`RoomStampPalette.ts`
 * (still being built). This file only knows the NARROW interfaces below; the
 * actual wiring is AP15.7. A `CellCanvas` instance already satisfies
 * `Dungeon2Zeichenflaeche` structurally today, but it is deliberately not
 * imported here — the dependency is meant to be handed in, not created here.
 */
import { dungeon2 } from '@wov/shared';
import { F, auswahl, el, feld, knopf, stil } from '../design';
import { Dungeon2LadeFehler, holeDungeon2, holeDungeon2Liste, type Dungeon2Kopf } from './Dungeon2Dokument';
import { speichereDungeon2 } from './Dungeon2Speichern';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Andockstellen fuer Zeichenflaeche und Werkzeuge (AP15.7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Was diese Seite von der Zeichenflaeche braucht — nichts weiter. Schmal
 * gehalten, damit `CellCanvas` (oder ein Test-Doppel) es ohne Anpassung
 * erfuellt.
 * What this page needs from the drawing surface — nothing more. Kept narrow
 * so `CellCanvas` (or a test double) satisfies it without change.
 */
export interface Dungeon2Zeichenflaeche {
  setzeLayout(layout: dungeon2.DungeonLayout2 | null): void;
  zeige(an: boolean): void;
}

/**
 * Was Werkzeuge/Palette (`CellTools.ts`, `RoomStampPalette.ts`, beide noch im
 * Bau) von einem Dokumentwechsel erfahren muessen — z. B. um eine laufende
 * Vorschau zu verwerfen. Bewusst nur EIN optionaler Rueckruf: Die konkrete
 * Form der Werkzeug-API steht noch nicht fest, und diese Seite soll nicht
 * raten muessen. Die Mutation selbst laeuft umgekehrt: Werkzeuge rufen
 * `uebernehmeBearbeitung()` weiter unten auf, diese Seite ruft nie in ein
 * Werkzeug hinein.
 * What tools/palette need to know about a document change — e.g. to drop a
 * running preview. Deliberately just ONE optional callback; the concrete tool
 * API shape is not settled yet. The mutation itself runs the other way:
 * tools call `uebernehmeBearbeitung()` below, this page never calls into a
 * tool.
 */
export interface Dungeon2Werkzeugandockung {
  aufDokumentGewechselt?(doc: dungeon2.DungeonDokument2 | null): void;
}

/** Was diese Seite aus der Shell braucht — nur die drei Bausteine, die sie benutzt. */
/** What this page needs from the shell — only the three building blocks it uses. */
export interface Dungeon2ShellAnbindung {
  seitenkopf(titel: string, text: string): void;
  sektion(titel: string, offen?: boolean): HTMLDivElement;
  meldung(text: string, fehler?: boolean): void;
}

export interface Dungeon2SeiteAbhaengigkeiten {
  readonly zeichenflaeche?: Dungeon2Zeichenflaeche;
  readonly werkzeuge?: Dungeon2Werkzeugandockung;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reine Logik — ohne DOM, getestet in `client/test/dungeon2-katalog.ts`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zustand des Speichern-Knopfs. Drei Stufen, kein Bool-Paar (`schmutzig` +
 * `speichertGerade`): Ein Paar liesse "sauber UND speichert" zu, einen
 * Zustand, den es nie geben darf und der im LEGACY-Vorbild nur durch
 * Disziplin an den Aufrufstellen vermieden wurde.
 * State of the save button. Three stages, not a pair of bools: a pair would
 * allow "clean AND saving", a state that must never exist and was only
 * avoided by discipline at the call sites in the LEGACY template.
 */
export type Dungeon2SpeicherZustand = 'sauber' | 'schmutzig' | 'speichert';

/** Bearbeitet -> schmutzig. Waehrend des Speicherns bleibt es beim Speichern. */
/** Edited -> dirty. While saving, stays at saving. */
export function alsSchmutzig(z: Dungeon2SpeicherZustand): Dungeon2SpeicherZustand {
  return z === 'speichert' ? z : 'schmutzig';
}

/** Speichern-Knopf gedrueckt. */
export function beginntSpeichern(_z: Dungeon2SpeicherZustand): Dungeon2SpeicherZustand {
  return 'speichert';
}

/** Antwort des Servers eingetroffen: sauber bei Erfolg, sonst zurueck zu schmutzig. */
/** Server reply arrived: clean on success, otherwise back to dirty. */
export function nachSpeichern(_z: Dungeon2SpeicherZustand, ok: boolean): Dungeon2SpeicherZustand {
  return ok ? 'sauber' : 'schmutzig';
}

export function speichernKnopfText(z: Dungeon2SpeicherZustand): string {
  switch (z) {
    case 'speichert':
      return 'Speichert …';
    case 'schmutzig':
      return 'Speichern *';
    default:
      return 'Speichern';
  }
}

/** Nur waehrend des Roundtrips gesperrt — ein sauberer/schmutziger Knopf bleibt klickbar. */
/** Locked only during the roundtrip — a clean/dirty button stays clickable. */
export function speichernKnopfGesperrt(z: Dungeon2SpeicherZustand): boolean {
  return z === 'speichert';
}

/**
 * Dasselbe ID-Muster wie `ID_MUSTER` in `shared/src/dungeon2/document.ts` und
 * die Inline-Kopie in `admin/src/main.ts` (`/api/dungeons2/:id`). Bewusst ein
 * DRITTES Mal hingeschrieben statt importiert — `document.ts` exportiert die
 * Konstante nicht (Kopfkommentar dort), und dieselbe Abwaegung gilt hier: der
 * Editor soll eine ungueltige Kennung erkennen koennen, OHNE `document.ts`
 * um einen weiteren Export zu bitten, den ausser Tests niemand braucht.
 * Same id pattern as `ID_MUSTER` in `document.ts` and the inline copy in
 * `admin/src/main.ts`. Deliberately written down a THIRD time rather than
 * imported — `document.ts` does not export the constant, and the same
 * trade-off applies here.
 */
export const DUNGEON2_ID_MUSTER = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function istGueltigeDungeon2Id(id: string): boolean {
  return DUNGEON2_ID_MUSTER.test(id);
}

/**
 * Auf welchem Host laeuft das SPIEL, wenn der Editor auf diesem hier laeuft?
 * Eigene Kopie von `spielHost()` (LEGACY `DungeonKatalog.ts`), nicht
 * importiert: Jene Datei ist als LEGACY zum Loeschen vorgemerkt, und ein
 * Import wuerde diese Seite an ihrem Lebensende mitreissen. Verhalten und
 * Begruendung (gemessen 28.08.2026: `editor.` wird ERSETZT, nicht
 * gestrichen) sind identisch.
 * Own copy of `spielHost()` from the LEGACY file — not imported, since that
 * file is marked for deletion and importing from it would drag this page
 * down with it. Behaviour and reasoning are identical.
 */
export function spielHost2(host: string): string {
  return host.startsWith('editor.') ? `play.${host.slice('editor.'.length)}` : host;
}

/** Ergebnis des Pruef-Trockenlaufs (keine Server-Rundreise, kein Speichern). */
/** Result of the check dry run (no server round trip, no save). */
export interface Dungeon2PruefErgebnis {
  readonly ok: boolean;
  readonly text: string;
}

/**
 * Dasselbe pruefen, was der Spielserver beim Speichern pruefen wuerde — ohne
 * ihn zu fragen.
 *
 * Die Verzweigung folgt `document.ts`: Bei `modus: 'gebaut'` steht das
 * Layout im Dokument, `validateLayoutVoll()` (die volle Pruefung inkl.
 * Zellgitter-Invarianten, `shared/src/dungeon2/validation.ts`) laeuft direkt
 * darauf. Bei `modus: 'erzeugt'` gibt es kein Layout — "sinnvoll pruefen"
 * heisst hier: entsteht ueberhaupt eines aus Thema+Seeds
 * (`layoutAusDeskriptor`), stimmt die mitgefuehrte Pruefsumme (der Zeuge,
 * dass Editor und Server/Client dasselbe erzeugen wuerden), und haelt das
 * ERZEUGTE Layout dieselben Invarianten wie ein gebautes.
 *
 * Check the same thing the game server would check on save — without asking
 * it. For 'gebaut' the layout sits in the document already. For 'erzeugt'
 * there is none — checking it "sensibly" means: does one even come out of
 * theme+seeds, does the carried checksum match (the witness that editor and
 * server/client would generate the same thing), and does the GENERATED
 * layout hold the same invariants as a built one.
 */
export function pruefeDungeon2Dokument(doc: dungeon2.DungeonDokument2): Dungeon2PruefErgebnis {
  if (doc.modus === 'gebaut') {
    if (!doc.layout) {
      return { ok: false, text: 'Modus "gebaut" ohne Layout — ungueltiges Dokument' };
    }
    const fehler = dungeon2.nurFehler(dungeon2.validateLayoutVoll(doc.layout));
    if (fehler.length > 0) {
      return {
        ok: false,
        text: `${fehler.length} Befund(e) — zuerst: ${fehler[0]!.wo}: ${fehler[0]!.text}`,
      };
    }
    return {
      ok: true,
      text: `Sauber: ${doc.layout.stempel.length} Stempel, ${doc.layout.tueren.length} Tueren, ${doc.layout.anker.length} Anker`,
    };
  }

  // 'erzeugt': Layout entsteht aus Thema+Seeds — derselbe Weg, den
  // Server und Client beim Betreten gehen.
  const ergebnis = dungeon2.layoutAusDeskriptor(dungeon2.deskriptorVon(doc));
  if (ergebnis.layout === null) {
    return { ok: false, text: 'Thema unbekannt oder Kennung ungueltig — Layout entsteht nicht' };
  }
  if (ergebnis.abweichung) {
    return {
      ok: false,
      text: `Pruefsumme weicht ab (erwartet ${ergebnis.erwartet}, gerechnet ${ergebnis.gerechnet})`,
    };
  }
  const fehler = dungeon2.nurFehler(dungeon2.validateLayoutVoll(ergebnis.layout));
  if (fehler.length > 0) {
    return {
      ok: false,
      text: `${fehler.length} Befund(e) — zuerst: ${fehler[0]!.wo}: ${fehler[0]!.text}`,
    };
  }
  return {
    ok: true,
    text: `Sauber (erzeugt): ${ergebnis.layout.stempel.length} Stempel, Pruefsumme stimmt`,
  };
}

/**
 * Drei frische uint32-Seeds fuer ein neu anzulegendes Dokument. `zufall` ist
 * injizierbar (Vorgabe `Math.random`), damit der Wertebereich ohne DOM und
 * ohne echten Zufall geprueft werden kann.
 * Three fresh uint32 seeds for a newly created document. `zufall` is
 * injectable (default `Math.random`) so the value range can be checked
 * without DOM or real randomness.
 */
export function erzeugeZufallsSeeds(zufall: () => number = Math.random): dungeon2.LayoutSeeds {
  const ganz = (): number => Math.floor(zufall() * 0x1_0000_0000) >>> 0;
  return { architektur: ganz(), material: ganz(), deko: ganz() };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Kleine DOM-Bausteine, die `design.ts` nicht anbietet
// ─────────────────────────────────────────────────────────────────────────────

/** Zeile aus Text/Elementen, wie die Zwischenzeilen im LEGACY-Vorbild. */
/** Row of text/elements, like the connector lines in the LEGACY template. */
function zeile(...teile: (HTMLElement | string)[]): HTMLDivElement {
  const d = el('div', stil({ display: 'flex', gap: '6px', 'align-items': 'center', 'flex-wrap': 'wrap' }));
  for (const t of teile) {
    d.appendChild(typeof t === 'string' ? el('span', stil({ 'font-size': '11.5px', color: F.gedimmt }), t) : t);
  }
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Die Seite / the page
// ─────────────────────────────────────────────────────────────────────────────

export class Dungeon2Seite {
  private koepfe: Dungeon2Kopf[] = [];
  private instanz = '?';
  private ladend = false;

  /** Das im Speicher gehaltene Dokument — `null`, solange nichts geoeffnet ist. */
  /** The document held in memory — `null` until something is opened. */
  private aktuellesDokument: dungeon2.DungeonDokument2 | null = null;
  private zustand: Dungeon2SpeicherZustand = 'sauber';

  // ── Eingaben fuer "Neu anlegen" ──────────────────────────────────────
  private neuKennung = '';
  private neuName = '';
  private neuThema = dungeon2.THEMEN[0]?.id ?? '';

  private readonly listeContainer: HTMLDivElement;
  private readonly dokumentContainer: HTMLDivElement;
  private readonly neuContainer: HTMLDivElement;

  constructor(
    private readonly shell: Dungeon2ShellAnbindung,
    private readonly deps: Dungeon2SeiteAbhaengigkeiten = {}
  ) {
    this.shell.seitenkopf(
      'Dungeons 2.0',
      'Gelesen wird ueber den Betriebsdienst (kein Spielserver noetig), gespeichert ' +
        'ueber den Spielserver — der muss dafuer laufen.'
    );
    this.listeContainer = this.shell.sektion('');
    this.dokumentContainer = this.shell.sektion('Dokument');
    this.neuContainer = this.shell.sektion('Neuen Dungeon anlegen', false);
  }

  /** Aktuell im Speicher gehaltenes Dokument — fuer AP15.7 (Werkzeuge lesen mit). */
  /** Document currently held in memory — for AP15.7 (tools read along). */
  dokument(): dungeon2.DungeonDokument2 | null {
    return this.aktuellesDokument;
  }

  /**
   * Von aussen (Werkzeuge, AP15.7) aufgerufen, NACHDEM eine Mutation am
   * Dokument vorgenommen wurde (z. B. `cellEdits.ts`-Funktionen). Diese
   * Seite ruft nie selbst in ein Werkzeug hinein — der Datenfluss ist
   * einseitig: Werkzeug mutiert -> `uebernehmeBearbeitung()` -> Zeichenflaeche
   * und Knopfzustand ziehen nach.
   * Called from outside (tools, AP15.7) AFTER a mutation was applied to the
   * document. This page never calls into a tool itself — the data flow is
   * one-directional: tool mutates -> `uebernehmeBearbeitung()` -> drawing
   * surface and button state follow.
   */
  uebernehmeBearbeitung(doc: dungeon2.DungeonDokument2): void {
    this.aktuellesDokument = doc;
    this.zustand = alsSchmutzig(this.zustand);
    this.deps.zeichenflaeche?.setzeLayout(dungeon2.layoutVonDokument2(doc));
    this.baueDokument();
  }

  /** Liste vom Betriebsdienst holen. Einmal beim ersten Oeffnen, danach bei Bedarf. */
  async laden(): Promise<void> {
    if (this.ladend) return;
    this.ladend = true;
    try {
      const { instanz, dungeons } = await holeDungeon2Liste();
      this.instanz = instanz;
      this.koepfe = dungeons;
      this.shell.meldung(`${dungeons.length} 2.0-Dungeon(s) in Instanz ${instanz}`);
    } catch (err) {
      this.koepfe = [];
      this.shell.meldung(
        err instanceof Dungeon2LadeFehler ? err.message : `Laden fehlgeschlagen: ${String(err)}`,
        true
      );
    } finally {
      this.ladend = false;
      this.baueListe();
      this.baueDokument();
    }
  }

  // ── Liste ─────────────────────────────────────────────────────────────

  private baueListe(): void {
    const c = this.listeContainer;
    c.replaceChildren();
    c.appendChild(zeile(`Instanz ${this.instanz}`, knopf('Liste neu', () => void this.laden(), { art: 'leise' })));

    const werte = [
      { id: '', name: this.koepfe.length === 0 ? '— keine 2.0-Dungeons —' : '— waehlen —' },
      ...this.koepfe.map((k) => ({
        id: k.id,
        name: `${k.id} — ${k.thema}, ${k.modus}${k.raeume !== undefined ? `, ${k.raeume} Raeume` : ''}`,
      })),
    ];
    c.appendChild(
      auswahl(werte, this.aktuellesDokument?.id ?? '', (id) => {
        if (id) void this.oeffne(id);
      })
    );
  }

  // ── Dokument ──────────────────────────────────────────────────────────

  private baueDokument(): void {
    const c = this.dokumentContainer;
    c.replaceChildren();
    const doc = this.aktuellesDokument;

    if (!doc) {
      c.appendChild(
        el(
          'div',
          stil({ 'font-size': '11.5px', color: F.gedimmt, 'line-height': '1.5' }),
          'Kein Dungeon geoeffnet — links waehlen oder unten einen neuen anlegen.'
        )
      );
      return;
    }

    const kennzahlen =
      doc.modus === 'gebaut' && doc.layout
        ? `${doc.layout.stempel.length} Stempel, ${doc.layout.tueren.length} Tueren`
        : 'Layout entsteht aus Thema + Seeds';
    c.appendChild(
      el(
        'div',
        stil({ 'font-size': '11.5px', color: F.gedimmt, 'line-height': '1.6', 'white-space': 'pre-line' }),
        `${doc.id} · Thema ${doc.thema} · ${doc.modus} · Fassung ${doc.version}\n` +
          `Grundhelligkeit ${dungeon2.ambientLichtVon(doc).toFixed(2)} · Pruefsumme ${doc.pruefsumme.slice(0, 12)}…\n` +
          kennzahlen
      )
    );

    const speichernKnopf = knopf(speichernKnopfText(this.zustand), () => void this.speichere(), {
      art: this.zustand === 'schmutzig' ? 'bronze' : 'flaeche',
    });
    speichernKnopf.disabled = speichernKnopfGesperrt(this.zustand);
    if (speichernKnopf.disabled) speichernKnopf.style.opacity = '.5';

    c.appendChild(
      zeile(
        knopf('Pruefen', () => this.pruefe(), { art: 'leise' }),
        speichernKnopf,
        knopf('Betreten', () => this.betrete(), { art: 'leise' })
      )
    );

    if (this.zustand !== 'sauber') {
      c.appendChild(
        el(
          'div',
          stil({ 'font-size': '11px', color: F.warnText, 'line-height': '1.5' }),
          'Ungespeichert. Speichern verbindet sich kurz mit dem Spielserver; ein offener ' +
            'Spielclient bleibt dabei verbunden (Peer.nurEditor).'
        )
      );
    }
  }

  // ── Neu anlegen ───────────────────────────────────────────────────────
  //
  // ABDECKUNG (fuer AP15.7 und spaeter): Dieser Abschnitt legt ein FRISCHES
  // `modus: 'erzeugt'`-Dokument NUR IM SPEICHER an (`erzeugeDokument2()`,
  // `shared/src/dungeon2/document.ts`) — auf der Platte landet nichts, bis
  // "Speichern" es ueber denselben Weg schickt wie jede andere Aenderung
  // (`speichereDungeon2`, AP15.1). Das deckt den Editor-Anlagefall ab.
  // NICHT abgedeckt: der Admin-Befehlsweg zum Anlegen (falls es einen gibt
  // oder geben wird) — der ist ein zweiter, unabhaengiger Einstiegspunkt und
  // bleibt ausserhalb dieser Seite.
  //
  // COVERAGE (for AP15.7 and later): this section creates a FRESH
  // `modus: 'erzeugt'` document IN MEMORY ONLY — nothing hits disk until
  // "Save" sends it through the same path as any other edit. That covers the
  // editor's creation case. NOT covered: an admin-command creation path (if
  // one exists or will exist) — that is a second, independent entry point
  // and stays outside this page.
  private baueNeu(): void {
    const c = this.neuContainer;
    c.replaceChildren();
    c.appendChild(
      feld(this.neuKennung, (v) => (this.neuKennung = v), { titel: 'Kennung (a-z, 0-9, -, _)' })
    );
    c.appendChild(feld(this.neuName, (v) => (this.neuName = v), { titel: 'Anzeigename (optional)' }));
    c.appendChild(
      auswahl(
        dungeon2.THEMEN.map((t) => ({ id: t.id, name: t.id })),
        this.neuThema,
        (id) => (this.neuThema = id)
      )
    );
    c.appendChild(zeile(knopf('Anlegen', () => this.legeAn(), { art: 'bronze' })));
  }

  private legeAn(): void {
    const id = this.neuKennung.trim().toLowerCase();
    if (!istGueltigeDungeon2Id(id)) {
      this.shell.meldung('Ungueltige Kennung (a-z, 0-9, "-", "_", max. 64 Zeichen)', true);
      return;
    }
    if (dungeon2.themaFinden(this.neuThema) === undefined) {
      this.shell.meldung('Unbekanntes Thema', true);
      return;
    }
    const name = this.neuName.trim() || id;
    const doc = dungeon2.erzeugeDokument2(id, name, this.neuThema, erzeugeZufallsSeeds());
    if (!doc) {
      this.shell.meldung('Anlegen fehlgeschlagen (Thema oder Kennung ungueltig)', true);
      return;
    }
    this.aktuellesDokument = doc;
    this.zustand = 'schmutzig'; // existiert nur im Speicher, bis "Speichern" es schreibt
    this.deps.zeichenflaeche?.setzeLayout(dungeon2.layoutVonDokument2(doc));
    this.deps.zeichenflaeche?.zeige(true);
    this.deps.werkzeuge?.aufDokumentGewechselt?.(doc);
    this.shell.meldung(`${id} angelegt (ungespeichert) — "Speichern" schreibt es auf den Spielserver`);
    this.baueListe();
    this.baueDokument();
  }

  /** Einmal beim Betreten der Betriebsart aufrufen — baut alle drei Abschnitte. */
  /** Call once when entering this mode — builds all three sections. */
  baue(): void {
    this.baueListe();
    this.baueDokument();
    this.baueNeu();
  }

  // ── Netzwerk-Handlungen ───────────────────────────────────────────────

  private async oeffne(id: string): Promise<void> {
    try {
      const doc = await holeDungeon2(id);
      this.aktuellesDokument = doc;
      this.zustand = 'sauber';
      this.deps.zeichenflaeche?.setzeLayout(dungeon2.layoutVonDokument2(doc));
      this.deps.zeichenflaeche?.zeige(true);
      this.deps.werkzeuge?.aufDokumentGewechselt?.(doc);
      this.shell.meldung(`${doc.id} geladen: Thema ${doc.thema}, Modus ${doc.modus}`);
    } catch (err) {
      this.shell.meldung(
        err instanceof Dungeon2LadeFehler ? err.message : `Oeffnen fehlgeschlagen: ${String(err)}`,
        true
      );
    }
    this.baueListe();
    this.baueDokument();
  }

  /**
   * Zum Spielserver schicken und die servergeprueft Antwort uebernehmen —
   * dieselbe Begruendung wie in der LEGACY-`speichere()`: Der Sanitizer dort
   * ist die letzte Instanz.
   * Send to the game server and adopt the server-checked reply — same
   * reasoning as the LEGACY `speichere()`.
   */
  private async speichere(): Promise<void> {
    const doc = this.aktuellesDokument;
    if (!doc || speichernKnopfGesperrt(this.zustand)) return;
    this.zustand = beginntSpeichern(this.zustand);
    this.baueDokument();
    this.shell.meldung(`${doc.id} wird gespeichert …`);

    const host = spielHost2(location.host);
    const ergebnis = await speichereDungeon2(host, doc, { aufMeldung: (m) => this.shell.meldung(m) });
    this.zustand = nachSpeichern(this.zustand, ergebnis.ok);
    if (ergebnis.ok && ergebnis.dokument) {
      this.aktuellesDokument = ergebnis.dokument;
      this.deps.zeichenflaeche?.setzeLayout(dungeon2.layoutVonDokument2(this.aktuellesDokument));
      this.deps.werkzeuge?.aufDokumentGewechselt?.(this.aktuellesDokument);
      // Die Liste traegt Kennzahlen im Text; nach dem Speichern stimmen sie
      // sonst nicht mehr mit dem ueberein, was danebensteht.
      void this.laden();
    }
    this.shell.meldung(
      ergebnis.ok ? `${doc.id} gespeichert` : (ergebnis.fehler ?? 'Speichern fehlgeschlagen'),
      !ergebnis.ok
    );
    this.baueDokument();
  }

  private pruefe(): void {
    const doc = this.aktuellesDokument;
    if (!doc) return;
    const ergebnis = pruefeDungeon2Dokument(doc);
    this.shell.meldung(ergebnis.text, !ergebnis.ok);
  }

  /**
   * Den Dungeon im ONLINEN Spielclient oeffnen — Host-Uebersetzung und
   * Sitzungstoken-Fallback 1:1 aus der LEGACY-`betrete()` uebernommen (dort
   * ausfuehrlich begruendet: Testflug hat keinen Server, Anmeldung traegt
   * kein Ziel zurueck).
   * Open the dungeon in the ONLINE game client — host translation and
   * session-token fallback taken 1:1 from the LEGACY `betrete()`.
   */
  private betrete(): void {
    const doc = this.aktuellesDokument;
    if (!doc) return;
    if (this.zustand !== 'sauber') {
      this.shell.meldung('Erst speichern — betreten zeigt den gespeicherten Stand.', true);
      return;
    }
    const host = spielHost2(location.host);
    const ziel = `${location.protocol}//${host}/?dungeon=${encodeURIComponent(doc.id)}`;

    if (host === location.host) {
      let token = '';
      try {
        token = localStorage.getItem('wov-session-token') ?? '';
      } catch {
        token = '';
      }
      if (!token) {
        this.shell.meldung(
          `Nicht im Spiel angemeldet — ${doc.id} geht bei der Anmeldung verloren. ` +
            'Erst anmelden, dann noch einmal auf "Betreten".',
          true
        );
        window.open(`${location.protocol}//${host}/`, '_blank');
        return;
      }
    }

    this.shell.meldung(`${doc.id} wird im Spiel geoeffnet …`);
    window.open(ziel, '_blank');
  }
}
