/**
 * BLEIBT — Grundlage des Connector-Modul-Kits (DG_StoneVault),
 * Entscheidung 03.09.2026, s. `LEGACY.md`. / STAYS — the basis of the
 * connector module kit (DG_StoneVault), decision 2026-09-03, see
 * `LEGACY.md`. Raumbibliothek +
 * Connector-Grundriss; steht neben `client/src/editor/dungeon2/`
 * (design/ARCHITECTURE.md §1.1/§1.2, Dungeon2Katalog). Siehe `LEGACY.md`.
 * Room library + connector floorplan; stands beside
 * `client/src/editor/dungeon2/` (design/ARCHITECTURE.md §1.1/§1.2,
 * Dungeon2Katalog). See `LEGACY.md`.
 *
 * Seitenleiste der Betriebsart „Dungeons" — Auswahl, Raumbibliothek,
 * Anfügen und Entfernen.
 *
 * Eigene Datei, damit `editorMain.ts` (3381 Zeilen) nicht weiter wächst.
 * Vorbild ist die Aufteilung von `RoutenEditor.ts`: Der Editor-Einstieg
 * verdrahtet, die Arbeit steht daneben.
 *
 * ── Zwei Richtungen, zwei Wege ───────────────────────────────────────
 * GELESEN wird über den Betriebsdienst, GESCHRIEBEN über den Spielserver.
 * Das ist kein Versehen: Der Betriebsdienst darf Dungeon-Dateien nicht
 * schreiben, weil der laufende Spielserver sie nicht bemerken würde
 * (Begründung in `DungeonDokument.ts`); der Spielserver wiederum muss zum
 * Lesen nicht laufen. Jede Richtung nimmt den Weg, der ohne Überraschung
 * funktioniert.
 *
 * „Prüfen" bleibt daneben stehen, obwohl es Speichern gibt: Es beantwortet
 * dieselbe Frage OHNE Server und ohne Nebenwirkung — überlebt das
 * Dokument den Sanitizer? Das will man wissen, bevor man einen offenen
 * Spielclient dafür abmeldet.
 */
import {
  DUNGEONS_BY_NAME,
  MAX_DUNGEON_AMBIENT,
  STEIN_TEXTUREN,
  STEIN_VERWITTERUNG_MAX,
  ambientLichtVon,
  ausrichtungsOptionen,
  kantenSchlussMeldung,
  sanitizeDungeonDocument,
  type DungeonDocument,
  type SteinKitConfig,
} from '@wov/shared';
import type { DungeonGrundriss } from './DungeonGrundriss';
import { DungeonLadeFehler, holeDungeon, holeDungeonListe, type DungeonKopf } from './DungeonDokument';
import { neuesDungeonDokument, waehlbareBasen } from './DungeonNeuesDokument';
import { speichereDungeon } from './DungeonSpeichern';

export interface DungeonSeiteRueckrufe {
  meldung(text: string, fehler?: boolean): void;
}

/** Ein Knopf im Stil der Editor-Seitenleiste. */
function knopf(text: string, bei: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = [
    'padding:6px 10px',
    'background:rgba(190,160,110,.10)',
    'border:1px solid #5a4626',
    'border-radius:4px',
    'color:#e8d9b8',
    'font:inherit',
    'font-size:12px',
    'cursor:pointer',
  ].join(';');
  b.onclick = bei;
  return b;
}

function auswahl(): HTMLSelectElement {
  const s = document.createElement('select');
  s.style.cssText = [
    'padding:5px 8px',
    'background:#241c14',
    'border:1px solid #5a4626',
    'border-radius:4px',
    'color:#e8d9b8',
    'font:inherit',
    'font-size:12px',
    'width:100%',
  ].join(';');
  return s;
}

/** Ein Textfeld im selben Stil wie die Auswahl daneben. */
function feld(platzhalter: string, breite: string): HTMLInputElement {
  const i = document.createElement('input');
  i.placeholder = platzhalter;
  i.style.cssText = [
    'padding:5px 8px',
    'background:#241c14',
    'border:1px solid #5a4626',
    'border-radius:4px',
    'color:#e8d9b8',
    'font:inherit',
    'font-size:12px',
    `width:${breite}`,
  ].join(';');
  return i;
}

/** Zwischenüberschrift im Stil von „Neu anlegen". */
function abschnitt(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText =
    'font-size:12px;letter-spacing:.06em;color:#a8916a;margin-top:4px;text-transform:uppercase';
  return d;
}

/**
 * Ein Häkchen mit Beschriftung.
 *
 * Der Zustand wird NICHT aus dem Häkchen gelesen, sondern beim Umschalten
 * nach draussen gemeldet: `baue()` wirft die ganze Leiste weg und legt sie
 * neu an — ein Wert, der nur im Element steht, wäre nach dem nächsten
 * Anfügen wieder auf der Vorgabe. Dieselbe Begründung wie bei den Feldern
 * von „Neu anlegen".
 */
function schalter(text: string, an: boolean, bei: (an: boolean) => void): HTMLLabelElement {
  const l = document.createElement('label');
  l.style.cssText =
    'display:flex;gap:5px;align-items:center;font-size:12px;color:#a8916a;cursor:pointer';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = an;
  box.onchange = () => bei(box.checked);
  const s = document.createElement('span');
  s.textContent = text;
  l.appendChild(box);
  l.appendChild(s);
  return l;
}

/** Kleingedruckter Hinweis unter einem Abschnitt. */
function hinweis(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = 'font-size:11px;color:#8a7350;line-height:1.5';
  return d;
}

function zeile(...teile: (HTMLElement | string)[]): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';
  for (const t of teile) {
    if (typeof t === 'string') {
      const s = document.createElement('span');
      s.textContent = t;
      s.style.cssText = 'font-size:12px;color:#a8916a';
      d.appendChild(s);
    } else d.appendChild(t);
  }
  return d;
}

/**
 * Auf welchem Host läuft das SPIEL, wenn der Editor auf diesem hier läuft?
 *
 * ── Der Fehler, den diese Funktion behebt ────────────────────────────
 * Die erste Fassung STRICH ein führendes `editor.`. Das ergab aus
 * `editor.dev.world-of-vikings.com` den Host `dev.world-of-vikings.com`
 * — und der antwortet gar nicht. Nachgemessen am 28.08.2026:
 *
 *   dev.world-of-vikings.com              keine Antwort
 *   play.dev.world-of-vikings.com         200   ← das Spiel
 *   editor.dev.world-of-vikings.com       302   ← der Editor
 *
 * Der Editor heisst also nicht `editor.<Spielhost>`, sondern beide
 * tragen ein eigenes Präfix vor demselben Rest. Ersetzt wird deshalb,
 * nicht gestrichen.
 *
 * ── Und warum das hier eine Funktion ist ─────────────────────────────
 * Weil sie sich prüfen lässt. Als Ausdruck mitten im Klick-Handler war
 * sie es nicht, und der Fehler fiel erst auf, als jemand darauf klickte.
 * `mess/spielhost.ts` fährt sie gegen alle drei echten Namen.
 */
export function spielHost(host: string): string {
  return host.startsWith('editor.') ? `play.${host.slice('editor.'.length)}` : host;
}

export class DungeonSeite {
  private koepfe: DungeonKopf[] = [];
  private instanz = '?';
  private ladend = false;
  /**
   * Steht etwas Ungespeichertes an?
   *
   * Nicht aus dem Dokument ableitbar: Der Editor hat keinen Vergleichsstand
   * vom Server im Speicher, und ein Tiefenvergleich wuerde beim naechsten
   * Feld im Schema still falsch. Gesetzt wird die Marke dort, wo wirklich
   * etwas geaendert wurde — Anfuegen und Entfernen.
   */
  private schmutzig = false;
  private speichertGerade = false;
  /**
   * Beim Speichern zuerst die offenen Kanten zumauern?
   *
   * VORGABE AN, und das ist die eigentliche Entscheidung: Im Modul-Kit ist
   * eine Wand ein eigener Raum (`StoneVaultWall`), und was der Editor ohne
   * sie speichert, hat im Spiel Löcher — lautlos, denn im Grundriss sieht
   * eine offene Kante genauso aus wie eine, an der man weiterbauen will.
   * Wer das nicht will (etwa um einen Zwischenstand abzulegen, an dem
   * morgen weitergebaut wird), nimmt das Häkchen heraus.
   *
   * Der Zustand steht an der KLASSE und nicht im Element: `baue()` legt die
   * ganze Leiste nach jeder Aktion neu an, ein Häkchen im DOM wäre danach
   * wieder auf der Vorgabe.
   */
  private beimSpeichernSchliessen = true;
  /**
   * Eingaben des Formulars „Neu anlegen".
   *
   * Sie stehen an der Klasse und nicht in den Feldern, weil `baue()` die
   * ganze Seitenleiste neu aufbaut — nach jedem Anfügen, jedem Klick auf
   * einen Raum, jedem Speichern. Ein Formular, das dabei jedes Mal leer
   * wird, ist eines, das man nicht ausfüllen kann.
   */
  private neuId = '';
  private neuBasis = '';
  private neuSeed = '';
  private legtAn = false;

  constructor(
    private readonly behaelter: HTMLElement,
    private readonly grundriss: DungeonGrundriss,
    private readonly cb: DungeonSeiteRueckrufe
  ) {}

  /** Liste vom Betriebsdienst holen. Einmal beim ersten Öffnen. */
  async laden(): Promise<void> {
    if (this.ladend) return;
    this.ladend = true;
    try {
      const { instanz, dungeons } = await holeDungeonListe();
      this.instanz = instanz;
      this.koepfe = dungeons;
      this.cb.meldung(`${dungeons.length} Dungeon(s) in Instanz ${instanz}`);
    } catch (err) {
      this.koepfe = [];
      this.cb.meldung(
        err instanceof DungeonLadeFehler ? err.message : `Laden fehlgeschlagen: ${String(err)}`,
        true
      );
    } finally {
      this.ladend = false;
      this.baue();
    }
  }

  /** Seitenleiste aus dem aktuellen Stand neu aufbauen. */
  baue(): void {
    const b = this.behaelter;
    b.innerHTML = '';
    const doc = this.grundriss.dokument;

    // ── Auswahl ───────────────────────────────────────────────────────
    const wahl = auswahl();
    if (this.koepfe.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '— keine Dungeons —';
      wahl.appendChild(opt);
      wahl.disabled = true;
    }
    for (const k of this.koepfe) {
      const opt = document.createElement('option');
      opt.value = k.id;
      opt.textContent = `${k.id} — ${k.raeume} Räume, ${k.tueren} Türen${k.deko ? `, ${k.deko} Deko` : ''}`;
      if (doc && doc.id === k.id) opt.selected = true;
      wahl.appendChild(opt);
    }
    b.appendChild(zeile(`Instanz ${this.instanz}`));
    b.appendChild(wahl);
    b.appendChild(
      zeile(
        knopf('Öffnen', () => void this.oeffne(wahl.value)),
        knopf('Liste neu', () => void this.laden())
      )
    );

    this.baueNeuAnlegen(b);

    if (!doc) {
      const hinweis = document.createElement('div');
      hinweis.style.cssText = 'font-size:12px;color:#8a7350;line-height:1.5';
      hinweis.textContent =
        'Gelesen wird über den Betriebsdienst — dafür muss kein Spielserver laufen. ' +
        'Geschrieben wird über den Spielserver, der dafür laufen muss.';
      b.appendChild(hinweis);
      return;
    }

    // ── Kopf des Dokuments ────────────────────────────────────────────
    const kopf = document.createElement('div');
    kopf.style.cssText = 'font-size:12px;color:#a8916a;line-height:1.6';
    kopf.textContent =
      `${doc.id} · Basis ${doc.base} · ${doc.mode} · Seed ${doc.seed}\n` +
      `${doc.layout.rooms.length} Räume, ${doc.layout.doors.length} Türen, ` +
      `${doc.layout.props.length} Deko, ${this.grundriss.offeneVerbindungen.length} offen`;
    kopf.style.whiteSpace = 'pre-line';
    b.appendChild(kopf);

    // ── Ebenen ────────────────────────────────────────────────────────
    // Heute hat jedes Kit genau eine Ebene. Der Filter steht trotzdem
    // schon da — er kostet vier Zeilen und wird in dem Moment gebraucht,
    // in dem die Treppe kommt und sich zwei Stockwerke im Bild überlagern.
    const ebenen = this.grundriss.ebenen;
    if (ebenen.length > 1) {
      const ew = auswahl();
      const alle = document.createElement('option');
      alle.value = '';
      alle.textContent = 'alle Ebenen';
      ew.appendChild(alle);
      for (const y of ebenen) {
        const o = document.createElement('option');
        o.value = String(y);
        o.textContent = `Ebene y = ${y}`;
        ew.appendChild(o);
      }
      ew.onchange = () => this.grundriss.setzeEbene(ew.value === '' ? null : Number(ew.value));
      b.appendChild(ew);
    }

    const speichernKnopf = knopf(
      this.speichertGerade ? 'Speichert …' : this.schmutzig ? 'Speichern *' : 'Speichern',
      () => void this.speichere(doc)
    );
    if (this.speichertGerade) {
      speichernKnopf.disabled = true;
      speichernKnopf.style.opacity = '.5';
    }
    b.appendChild(
      zeile(
        knopf('Einpassen', () => {
          this.grundriss.passeEin();
          this.grundriss.zeichne();
        }),
        knopf('Prüfen', () => this.pruefe(doc)),
        // Der Knopf ist der Weg für „jetzt sehen, was das tut" — der
        // Schalter darunter der für „nicht mehr daran denken müssen".
        // Beide rufen dieselbe Rechnung; ohne den Knopf gäbe es keine
        // Möglichkeit, das Ergebnis im Grundriss anzusehen, BEVOR es auf
        // dem Server steht.
        knopf('Kanten schließen', () => this.schliesseKanten()),
        speichernKnopf,
        knopf('Betreten', () => this.betrete(doc))
      )
    );
    b.appendChild(
      zeile(
        schalter('beim Speichern schließen', this.beimSpeichernSchliessen, (an) => {
          this.beimSpeichernSchliessen = an;
        })
      )
    );
    b.appendChild(
      hinweis(
        'Wände sind eigene Räume (endCap) und stehen im Grundriss als dünne Rechtecke. ' +
          'Zum Weiterbauen an einer zugemauerten Kante die Wand anklicken und „Raum ' +
          'entfernen" — damit ist die Kante wieder offen.'
      )
    );
    if (this.schmutzig) {
      const warnung = document.createElement('div');
      warnung.style.cssText = 'font-size:11px;color:#c8a24a;line-height:1.5';
      // Der Satz stand hier zuerst andersherum: „ein offener Spielclient
      // wird abgemeldet". Das war gemessen richtig — der Server nimmt den
      // Namen aus dem Konto, beide Verbindungen tragen ihn, und die
      // aeltere wurde abgeloest. Statt das dem Benutzer zu erklaeren,
      // wurde es abgestellt (`Peer.nurEditor`), und der Satz sagt jetzt
      // die neue Wahrheit. Bewacht von server/test/g9-editor-verbindung.ts.
      warnung.textContent =
        'Ungespeichert. Speichern verbindet sich kurz mit dem Spielserver; ein offener ' +
        'Spielclient bleibt dabei verbunden.';
      b.appendChild(warnung);
    }

    // ── Gewählter Raum ────────────────────────────────────────────────
    const i = this.grundriss.gewaehlterRaum;
    const gewaehlt = i >= 0 ? doc.layout.rooms[i] : undefined;
    const auswahlZeile = document.createElement('div');
    auswahlZeile.style.cssText = 'font-size:12px;color:#e8d9b8';
    auswahlZeile.textContent = gewaehlt
      ? `Gewählt: #${i} ${gewaehlt.room}`
      : 'Kein Raum gewählt — im Grundriss anklicken.';
    b.appendChild(auswahlZeile);
    if (gewaehlt) {
      b.appendChild(
        zeile(
          knopf('Raum entfernen', () => {
            if (!this.grundriss.entferne(i)) return;
            this.schmutzig = true;
            this.cb.meldung(`Raum #${i} entfernt (ungespeichert)`);
          })
        )
      );
    }

    // ── Anfügen ───────────────────────────────────────────────────────
    const offene = this.grundriss.offeneVerbindungen;
    const cw = auswahl();
    offene.forEach((c, idx) => {
      const o = document.createElement('option');
      o.value = String(idx);
      const raum = doc.layout.rooms[c.roomIndex]?.room ?? '?';
      o.textContent = `${raum}#${c.roomIndex}/${c.connIndex}${c.type ? ` [${c.type}]` : ''}`;
      cw.appendChild(o);
    });
    if (offene.length === 0) {
      const o = document.createElement('option');
      o.textContent = '— keine offenen Anschlüsse —';
      cw.appendChild(o);
      cw.disabled = true;
    }

    // Raumbibliothek des Kits. Endkappen ans Ende: Sie schliessen ab, und
    // wer baut, sucht zuerst das, womit es weitergeht.
    const rw = auswahl();
    const def = DUNGEONS_BY_NAME.get(doc.base);
    const raeume = [...(def?.rooms ?? [])].sort((a, b2) => Number(a.endCap) - Number(b2.endCap));
    for (const r of raeume) {
      const o = document.createElement('option');
      o.value = r.name;
      o.textContent =
        `${r.name} (${r.size.x}×${r.size.z})` +
        `${r.endCap ? ' · Abschluss' : ''}${r.entrance ? ' · Eingang' : ''}`;
      rw.appendChild(o);
    }

    // ── Ausrichtung ───────────────────────────────────────────────────
    // WELCHE Kante des neuen Raums an der offenen Kante hängt. Ohne dieses
    // Feld nimmt `attachRoom` den ersten kollisionsfreien eigenen
    // Connector — bei einer StoneVault-Zelle mit vier gleichwertigen
    // Kanten entscheidet dann die Reihenfolge in `eigeneDungeons.ts`, in
    // welche Richtung ein Gang weiterläuft, und der Mensch hat keine
    // Handhabe. Dasselbe Feld steht im F4-Editor
    // (`client/src/ui/DungeonEditor.ts`); die Beschriftungen kommen aus
    // `ausrichtungsOptionen` in `@wov/shared`, damit beide Seiten
    // dieselben Namen sagen.
    //
    // Die Liste hängt an BEIDEN anderen Feldern (der Typ des offenen
    // Connectors filtert, der Raum liefert die Kanten) und wird deshalb
    // bei jeder Änderung neu gefüllt.
    const aw = auswahl();
    aw.title = 'Ausrichtung: welche Kante des neuen Raums andockt';
    const ausrichtungenFuellen = (): void => {
      const vorher = aw.value;
      aw.textContent = '';
      const auto = document.createElement('option');
      auto.value = '';
      auto.textContent = 'automatisch';
      aw.appendChild(auto);
      const conn = offene[Number(cw.value)];
      const raum = def?.rooms.find((r) => r.name === rw.value);
      for (const o of ausrichtungsOptionen(raum, conn?.type)) {
        const opt = document.createElement('option');
        opt.value = String(o.index);
        opt.textContent = o.beschriftung;
        aw.appendChild(opt);
      }
      // Die alte Wahl nur zurücksetzen, wenn sie noch angeboten wird; sonst
      // bleibt „automatisch" stehen, statt still auf eine fremde Kante zu
      // zeigen.
      if (vorher) aw.value = vorher;
    };
    cw.onchange = ausrichtungenFuellen;
    rw.onchange = ausrichtungenFuellen;
    ausrichtungenFuellen();

    b.appendChild(zeile('Anfügen an'));
    b.appendChild(cw);
    b.appendChild(rw);
    b.appendChild(zeile('Ausrichtung'));
    b.appendChild(aw);
    b.appendChild(
      zeile(
        knopf('Anfügen', () => {
          if (offene.length === 0) return;
          // Leerer Wert = „automatisch": kein Index, also genau das
          // Verhalten von vorher. Der Unterschied muss `undefined` sein und
          // nicht etwa −1 — `attachRoom` unterscheidet „nicht gesetzt" von
          // „gesetzt, aber unpassend" und meldet Letzteres als Fehler.
          const kante = aw.value === '' ? undefined : Number(aw.value);
          if (this.grundriss.fuegeAn(Number(cw.value), rw.value, kante)) this.schmutzig = true;
        })
      )
    );

    this.baueLicht(b, doc);
    this.baueSteinKit(b, doc);

    const fuss = document.createElement('div');
    fuss.style.cssText = 'font-size:11px;color:#8a7350;line-height:1.5';
    fuss.textContent =
      'Angefügt wird mit denselben Funktionen wie im Spiel (attachRoom, removeRoom). ' +
      'Gelesen wird über den Betriebsdienst, geschrieben über den Spielserver — der muss ' +
      'zum Speichern laufen, zum Ansehen nicht.';
    b.appendChild(fuss);
  }

  /**
   * Das Formular „Neu anlegen".
   *
   * Es steht ÜBER dem geöffneten Dokument und nicht darunter, weil es zum
   * oberen Block gehört: Liste, Öffnen, Neu. Was darunter kommt, arbeitet
   * am geöffneten Dokument.
   *
   * Angelegt wird nur im Speicher — geschrieben wird über denselben
   * „Speichern"-Weg wie bei jedem anderen Dokument (`DungeonSpeichern.ts`,
   * `DungeonEditSave`). Der Server nimmt eine bisher unbekannte ID an:
   * `upsertDocument` schlägt sie nur in `documents` nach, um zu entscheiden,
   * ob die laufende Instanz stehen bleiben darf, und legt sie sonst neu an
   * — genau das tut der „Speichern als"-Knopf des F4-Editors seit jeher.
   */
  private baueNeuAnlegen(b: HTMLElement): void {
    const basen = waehlbareBasen();
    if (this.neuBasis === '') this.neuBasis = basen[0]?.name ?? '';

    const kopf = document.createElement('div');
    kopf.style.cssText =
      'font-size:12px;letter-spacing:.06em;color:#a8916a;margin-top:4px;text-transform:uppercase';
    kopf.textContent = 'Neu anlegen';
    b.appendChild(kopf);

    const bw = auswahl();
    for (const d of basen) {
      const o = document.createElement('option');
      o.value = d.name;
      o.textContent = `${d.name} (${d.rooms.length} Teile)`;
      if (d.name === this.neuBasis) o.selected = true;
      bw.appendChild(o);
    }
    bw.onchange = () => {
      this.neuBasis = bw.value;
    };
    b.appendChild(bw);

    const idFeld = feld('id, z. B. steinvault-a', '150px');
    idFeld.value = this.neuId;
    idFeld.oninput = () => {
      this.neuId = idFeld.value;
    };
    const seedFeld = feld('Seed (leer = zufällig)', '150px');
    seedFeld.value = this.neuSeed;
    seedFeld.oninput = () => {
      this.neuSeed = seedFeld.value;
    };
    b.appendChild(zeile(idFeld, seedFeld));

    const anlegen = knopf(this.legtAn ? 'Legt an …' : 'Anlegen & speichern', () => {
      void this.legeAn();
    });
    if (this.legtAn) {
      anlegen.disabled = true;
      anlegen.style.opacity = '.5';
    }
    b.appendChild(zeile(anlegen));

    const hinweis = document.createElement('div');
    hinweis.style.cssText = 'font-size:11px;color:#8a7350;line-height:1.5';
    hinweis.textContent =
      'Angelegt wird nur der Eingangsraum — seine Kanten sind sofort offen, ' +
      'es muss also kein Abschluss erst abgerissen werden. Gespeichert wird ' +
      'über den Spielserver; der muss dafür laufen.';
    b.appendChild(hinweis);
  }

  /**
   * Abschnitt „Grundbeleuchtung" — der Regler auf `doc.ambientLicht`.
   *
   * Der Wert steht IM DOKUMENT und nicht an der Klasse, anders als die
   * Felder von „Neu anlegen": Das Dokument überlebt `baue()`, ein zweiter
   * Stand daneben würde beim nächsten Öffnen still auseinanderlaufen.
   * Gelesen wird deshalb bei jedem Aufbau frisch aus `doc`.
   *
   * ── Warum „Vorgabe" nicht dasselbe ist wie „auf 1 ziehen" ───────────
   * `ambientLicht` FEHLEN zu lassen heisst „Umgebung unverändert"; eine
   * eingetragene 1 sagt dasselbe, aber als Entscheidung. Solange beide
   * gleich wirken, ist der Unterschied Geschmack — sobald der Ersatzwert
   * je Kit verschieden würde, ist er es nicht mehr. Der Knopf löscht
   * deshalb wirklich, statt 1 zu schreiben.
   *
   * ── oninput schreibt, onchange baut ────────────────────────────────
   * Ein `baue()` bei jedem Zwischenwert risse den Regler unter dem
   * Mauszeiger weg. Geschrieben wird deshalb sofort (damit „Speichern"
   * nichts verpasst), neu gebaut erst am Ende des Ziehens.
   */
  private baueLicht(b: HTMLElement, doc: DungeonDocument): void {
    b.appendChild(abschnitt('Grundbeleuchtung'));

    const regler = document.createElement('input');
    regler.type = 'range';
    regler.min = '0';
    regler.max = String(MAX_DUNGEON_AMBIENT);
    regler.step = '0.05';
    regler.value = String(ambientLichtVon(doc));
    regler.title = 'Faktor auf die Weltbeleuchtung — 1 = wie die Umgebung';
    regler.style.cssText = 'flex:1 1 130px';

    const anzeige = document.createElement('span');
    anzeige.style.cssText = 'font-size:12px;color:#e8d9b8;min-width:76px;text-align:right';
    const beschrifte = (): void => {
      anzeige.textContent =
        ambientLichtVon(doc).toFixed(2) + (doc.ambientLicht === undefined ? ' (Vorgabe)' : '');
    };
    beschrifte();

    regler.oninput = () => {
      doc.ambientLicht = Number(regler.value);
      this.schmutzig = true;
      beschrifte();
    };
    regler.onchange = () => {
      doc.ambientLicht = Number(regler.value);
      this.schmutzig = true;
      this.baue();
    };

    b.appendChild(
      zeile(
        regler,
        anzeige,
        knopf('Vorgabe', () => {
          delete doc.ambientLicht;
          this.schmutzig = true;
          this.baue();
        })
      )
    );
  }

  /**
   * Abschnitt „Steinmaterial (Dokument)".
   *
   * Angeboten wird NUR, was in `STEIN_TEXTUREN` steht — derselben
   * Erlaubnisliste, gegen die der Server sanitisiert. Ein freies Textfeld
   * wäre hier bequemer und ergäbe eine schwarze Wand ohne Fehlermeldung,
   * sobald sich jemand vertippt.
   *
   * Angezeigt wird der blosse Dateiname: Der Pfad ist in jeder Zeile
   * derselbe und macht die Auswahl nur unlesbar.
   *
   * Leer bzw. „Kit-Vorgabe" heisst — wie beim Licht — FEHLENDES Feld und
   * nicht „irgendein Ersatzwert": Nur dann greift die Kit-Vorgabe aus
   * `eigeneDungeons.ts` wieder durch.
   */
  private baueSteinKit(b: HTMLElement, doc: DungeonDocument): void {
    b.appendChild(abschnitt('Steinmaterial (Dokument)'));

    const kurz = (pfad: string): string => pfad.split('/').pop()!.replace(/\.png$/, '');
    const flaechen = [
      ['Wand', 'wandTextur'],
      ['Decke', 'deckeTextur'],
      ['Boden', 'bodenTextur'],
    ] as const;

    for (const [beschriftung, schluessel] of flaechen) {
      const w = auswahl();
      w.style.cssText += ';width:auto;flex:1 1 140px';
      const vorgabe = document.createElement('option');
      vorgabe.value = '';
      vorgabe.textContent = 'Kit-Vorgabe';
      w.appendChild(vorgabe);
      for (const t of STEIN_TEXTUREN) {
        const o = document.createElement('option');
        o.value = t;
        o.textContent = kurz(t);
        if (doc.steinKit?.[schluessel] === t) o.selected = true;
        w.appendChild(o);
      }
      w.value = doc.steinKit?.[schluessel] ?? '';
      w.onchange = () => {
        const gewaehlt = w.value;
        this.schreibeSteinKit(doc, (kit) => {
          if (gewaehlt === '') delete kit[schluessel];
          else kit[schluessel] = gewaehlt;
        });
      };
      b.appendChild(zeile(beschriftung, w));
    }

    // Verwitterung: leer heisst „nicht gesetzt", nicht „null". Deshalb ein
    // Textfeld mit Zahlentyp und kein Regler — ein Regler hat keinen
    // leeren Zustand, und man könnte die Kit-Vorgabe nie zurückgeben.
    const verwitterungen = [
      ['moos', 'moos'],
      ['frost', 'frost'],
      ['nass', 'nass'],
    ] as const;
    const felder: HTMLElement[] = [];
    for (const [schluessel, platzhalter] of verwitterungen) {
      const f = feld(platzhalter, '58px');
      f.type = 'number';
      f.min = '0';
      f.max = String(STEIN_VERWITTERUNG_MAX);
      f.step = '0.1';
      const wert = doc.steinKit?.verwitterung?.[schluessel];
      f.value = wert === undefined ? '' : String(wert);
      f.onchange = () => {
        const roh = f.value.trim();
        const zahl = roh === '' ? undefined : Number(roh);
        this.schreibeSteinKit(doc, (kit) => {
          const v: Record<string, number> = { ...(kit.verwitterung as Record<string, number>) };
          if (zahl === undefined || !Number.isFinite(zahl)) delete v[schluessel];
          else v[schluessel] = Math.max(0, Math.min(STEIN_VERWITTERUNG_MAX, zahl));
          if (Object.keys(v).length === 0) delete kit.verwitterung;
          else kit.verwitterung = v;
        });
      };
      felder.push(f);
    }
    b.appendChild(zeile('Verwitterung', ...felder));

    b.appendChild(
      hinweis('Wirkt nach Speichern beim nächsten Betreten (die Instanz wird neu aufgebaut).')
    );
  }

  /**
   * `doc.steinKit` ändern — über eine KOPIE, und ein leer gewordenes Objekt
   * verschwindet ganz.
   *
   * Die Kopie ist keine Vorsicht, sondern nötig: `Partial<SteinKitConfig>`
   * ist durchweg `readonly`, an Ort und Stelle liesse sich nichts
   * zuweisen. Und ein zurückbleibendes `steinKit: {}` wäre kein leeres
   * Feld, sondern ein gesetztes ohne Inhalt — der Sanitizer wirft es zwar
   * weg, aber der Grundriss zeigte bis zum Speichern etwas anderes an, als
   * der Server danach hat.
   */
  private schreibeSteinKit(
    doc: DungeonDocument,
    aendere: (kit: Record<string, unknown>) => void
  ): void {
    const kit: Record<string, unknown> = { ...(doc.steinKit ?? {}) };
    if (kit.verwitterung) kit.verwitterung = { ...(kit.verwitterung as Record<string, number>) };
    aendere(kit);
    if (Object.keys(kit).length === 0) delete doc.steinKit;
    else doc.steinKit = kit as Partial<SteinKitConfig>;
    this.schmutzig = true;
    this.baue();
  }

  /**
   * Neues Dokument bauen, im Grundriss öffnen und gleich speichern.
   *
   * Erst nach dem Speichern gilt es als angelegt: Ein Dokument, das nur im
   * Browser steht, verschwindet beim Neuladen, und in der Liste daneben
   * stünde es nie. Schlägt das Speichern fehl (kein Spielserver, keine
   * Rechte), bleibt es trotzdem OFFEN und als ungespeichert markiert —
   * dann fehlt nur der Server, nicht die Arbeit.
   */
  private async legeAn(): Promise<void> {
    if (this.legtAn) return;
    const seedText = this.neuSeed.trim();
    if (seedText !== '' && !Number.isFinite(Number(seedText))) {
      this.cb.meldung('Seed ist keine Zahl', true);
      return;
    }
    const ergebnis = neuesDungeonDokument({
      id: this.neuId,
      base: this.neuBasis,
      ...(seedText === '' ? {} : { seed: Number(seedText) }),
    });
    if (!ergebnis.ok) {
      this.cb.meldung(ergebnis.grund, true);
      return;
    }
    // Vorhandene ID: `upsertDocument` würde das alte Dokument ÜBERSCHREIBEN
    // und die laufende Instanz abreissen. Das ist kein Fehler des Servers,
    // sondern eine Frage, die vorher gestellt gehört — hier fällt sie noch
    // auf, im Grundriss danach nicht mehr.
    if (this.koepfe.some((k) => k.id === ergebnis.doc.id)) {
      this.cb.meldung(`${ergebnis.doc.id} gibt es schon — bitte eine andere ID.`, true);
      return;
    }
    this.legtAn = true;
    this.grundriss.setzeDokument(ergebnis.doc);
    this.schmutzig = true;
    this.baue();
    await this.speichere(ergebnis.doc);
    this.legtAn = false;
    // Nur die ID leeren: Basis und Seed sind meist für den nächsten
    // Dungeon dieselben, die ID nie.
    this.neuId = '';
    this.baue();
  }

  /**
   * Den Dungeon im ONLINE-Client oeffnen.
   *
   * Nicht im Testflug: Der laeuft mit `?offline=1` ohne Server, und eine
   * Instanz lebt auf dem Server. Ein Testflug in einen Dungeon zeigte
   * nichts und saehe aus wie ein kaputter Knopf.
   *
   * ── Welcher Host ─────────────────────────────────────────────────
   * Der Spielclient braucht die Sitzung aus dem localStorage, und der
   * haengt am Ursprung. Auf dev ist das einfach: play.dev liefert Spiel
   * UND Editor aus (`/` und `/editor.html`, siehe
   * deploy/npm-play-dev.conf), gleicher Ursprung, ein relativer Verweis
   * genuegt — und er behaelt nebenbei automatisch dev bzw. live.
   *
   * Sonst uebersetzt `spielHost()` den Editor-Namen in den Spielnamen.
   * Die erste Fassung riet dabei falsch und schickte auf einen Host, den
   * es nicht gibt — die Begruendung steht dort, samt gemessener Tabelle.
   */
  private betrete(doc: DungeonDocument): void {
    if (this.schmutzig) {
      // Betreten zeigt, was auf der PLATTE steht. Ungespeichertes waere
      // nicht dabei, und man suchte im Dungeon nach einem Raum, den man
      // gerade erst gezeichnet hat.
      this.cb.meldung('Erst speichern — betreten zeigt den gespeicherten Stand.', true);
      return;
    }
    const host = spielHost(location.host);
    const ziel = `${location.protocol}//${host}/?dungeon=${encodeURIComponent(doc.id)}`;

    // ── Ohne Anmeldung geht die Dungeon-Wahl unterwegs verloren ──────
    //
    // Der Spielclient leitet ohne Sitzung zur Anmeldung auf der Webseite
    // um, und diese Adresse trägt KEIN Ziel zurück (`websiteLoginUrl` in
    // client/src/main.ts kennt nur `shore` und `abgelaufen`). Nach dem
    // Anmelden landet man also in der Welt statt im Dungeon — wortlos,
    // was schlimmer ist als ein Fehler.
    //
    // Gefragt wird NUR, wenn das Ziel derselbe Ursprung ist. Auf live
    // trägt der Editor einen eigenen Namen, der localStorage dort ist ein
    // anderer, und die Antwort wäre schlicht falsch: „nicht angemeldet"
    // für jemanden, der es sehr wohl ist. Lieber nichts sagen als etwas
    // Unzutreffendes.
    if (host === location.host) {
      let token = '';
      try {
        token = localStorage.getItem('wov-session-token') ?? '';
      } catch {
        // Privater Modus: kein Speicher, also auch keine Auskunft.
        token = '';
      }
      if (!token) {
        this.cb.meldung(
          `Nicht im Spiel angemeldet — ${doc.id} geht bei der Anmeldung verloren. ` +
            'Erst anmelden, dann noch einmal auf „Betreten".',
          true
        );
        window.open(`${location.protocol}//${host}/`, '_blank');
        return;
      }
    }

    this.cb.meldung(`${doc.id} wird im Spiel geöffnet …`);
    window.open(ziel, '_blank');
  }

  /**
   * Zum Spielserver schicken und die Antwort uebernehmen.
   *
   * Uebernommen wird das Dokument, das der SERVER zurueckgibt, nicht das
   * gesendete: Der Sanitizer dort ist die letzte Instanz, und was er
   * geaendert hat, soll man im Grundriss sehen und nicht erst beim
   * naechsten Oeffnen.
   */
  /**
   * Offene Kanten zumauern und das Ergebnis melden.
   *
   * Eigene Methode, weil sie ZWEI Aufrufer hat — den Knopf und den Weg
   * über „Speichern". Zwei Kopien gingen beim ersten Nachbessern
   * auseinander, und die stille Hälfte wäre die im Speicherweg, die
   * niemand anklickt.
   */
  private schliesseKanten(): number {
    const ergebnis = this.grundriss.schliesseKanten();
    if (ergebnis.gesetzt > 0) this.schmutzig = true;
    this.cb.meldung(kantenSchlussMeldung(ergebnis), ergebnis.offenGeblieben > 0);
    this.baue();
    return ergebnis.gesetzt;
  }

  private async speichere(doc: DungeonDocument): Promise<void> {
    if (this.speichertGerade) return;
    // VOR dem Serialisieren, nicht danach: `speichereDungeon` schickt das
    // Dokument, wie es hier steht. Eine Wand, die erst nach dem Absenden
    // gesetzt wird, stünde im Grundriss und nicht in der Datei — und der
    // Unterschied fiele erst im Spiel auf.
    if (this.beimSpeichernSchliessen) this.schliesseKanten();
    this.speichertGerade = true;
    this.baue();
    this.cb.meldung(`${doc.id} wird gespeichert …`);
    const ergebnis = await speichereDungeon(doc);
    this.speichertGerade = false;
    if (ergebnis.ok) {
      this.schmutzig = false;
      if (ergebnis.doc) this.grundriss.setzeDokument(ergebnis.doc);
      // Die Liste traegt Raum- und Dekozahlen im Text; nach dem Speichern
      // stimmen sie sonst nicht mehr mit dem ueberein, was danebensteht.
      void this.laden();
    }
    this.cb.meldung(ergebnis.meldung, !ergebnis.ok);
    this.baue();
  }

  private async oeffne(id: string): Promise<void> {
    if (!id) return;
    try {
      const doc = await holeDungeon(id);
      this.grundriss.setzeDokument(doc);
      // Frisch vom Server geholt heisst: nichts steht mehr an. Ohne diese
      // Zeile schleppt die Marke sich ueber einen Dokumentwechsel hinweg
      // und behauptet Aenderungen an einem Dungeon, den man gerade erst
      // geoeffnet hat.
      this.schmutzig = false;
      this.cb.meldung(
        `${doc.id} geladen: ${doc.layout.rooms.length} Räume, ${doc.layout.doors.length} Türen`
      );
    } catch (err) {
      this.cb.meldung(
        err instanceof DungeonLadeFehler ? err.message : `Öffnen fehlgeschlagen: ${String(err)}`,
        true
      );
    }
  }

  /**
   * Dasselbe prüfen, was der Server beim Speichern prüfen würde.
   *
   * Nicht „sieht gut aus", sondern: Überlebt jeder Raum den Sanitizer?
   * Der wirft unbekannte Räume STILL weg — ein Grundriss, der nach dem
   * Speichern drei Räume weniger hat, ist genau der Fehler, den man
   * vorher sehen will.
   */
  private pruefe(doc: DungeonDocument): void {
    const sauber = sanitizeDungeonDocument(JSON.parse(JSON.stringify(doc)));
    if (!sauber) {
      this.cb.meldung('Dokument würde ABGELEHNT (Basis, ID oder Räume ungültig)', true);
      return;
    }
    const verloren = doc.layout.rooms.length - sauber.layout.rooms.length;
    const tuerenWeg = doc.layout.doors.length - sauber.layout.doors.length;
    if (verloren > 0 || tuerenWeg > 0) {
      this.cb.meldung(
        `Sanitizer verwirft ${verloren} Raum/Räume und ${tuerenWeg} Tür(en) — Dokument NICHT sauber`,
        true
      );
      return;
    }
    this.cb.meldung(
      `Sauber: ${sauber.layout.rooms.length} Räume, ${sauber.layout.doors.length} Türen, ` +
        `${sauber.layout.props.length} Deko, ${this.grundriss.offeneVerbindungen.length} offene Anschlüsse`
    );
  }
}
