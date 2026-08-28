/**
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
  sanitizeDungeonDocument,
  type DungeonDocument,
} from '@wov/shared';
import type { DungeonGrundriss } from './DungeonGrundriss';
import { DungeonLadeFehler, holeDungeon, holeDungeonListe, type DungeonKopf } from './DungeonDokument';
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

    if (!doc) {
      const hinweis = document.createElement('div');
      hinweis.style.cssText = 'font-size:12px;color:#8a7350;line-height:1.5';
      hinweis.textContent =
        'Gelesen wird über den Betriebsdienst — dafür muss kein Spielserver laufen. ' +
        'Gespeichert wird in dieser Etappe noch nicht.';
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
        speichernKnopf,
        knopf('Betreten', () => this.betrete(doc))
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

    b.appendChild(zeile('Anfügen an'));
    b.appendChild(cw);
    b.appendChild(rw);
    b.appendChild(
      zeile(
        knopf('Anfügen', () => {
          if (offene.length === 0) return;
          if (this.grundriss.fuegeAn(Number(cw.value), rw.value)) this.schmutzig = true;
        })
      )
    );

    const fuss = document.createElement('div');
    fuss.style.cssText = 'font-size:11px;color:#8a7350;line-height:1.5';
    fuss.textContent =
      'Angefügt wird mit denselben Funktionen wie im Spiel (attachRoom, removeRoom). ' +
      'Gelesen wird über den Betriebsdienst, geschrieben über den Spielserver — der muss ' +
      'zum Speichern laufen, zum Ansehen nicht.';
    b.appendChild(fuss);
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
  private async speichere(doc: DungeonDocument): Promise<void> {
    if (this.speichertGerade) return;
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
