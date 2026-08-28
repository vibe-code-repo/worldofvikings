/**
 * Seitenleiste der Betriebsart „Dungeons" — Auswahl, Raumbibliothek,
 * Anfügen und Entfernen.
 *
 * Eigene Datei, damit `editorMain.ts` (3381 Zeilen) nicht weiter wächst.
 * Vorbild ist die Aufteilung von `RoutenEditor.ts`: Der Editor-Einstieg
 * verdrahtet, die Arbeit steht daneben.
 *
 * ── Was hier NICHT passiert ──────────────────────────────────────────
 * Gespeichert wird nicht. Der Betriebsdienst darf Dungeon-Dateien nicht
 * schreiben (Begründung in `DungeonDokument.ts`), und der Weg über den
 * Spielserver ist die nächste Etappe. Der Knopf „Prüfen" sagt deshalb nur,
 * ob das Ergebnis den Sanitizer überstünde — das ist genau die Frage, die
 * man vor dem Speichern beantwortet haben will.
 */
import {
  DUNGEONS_BY_NAME,
  sanitizeDungeonDocument,
  type DungeonDocument,
} from '@wov/shared';
import type { DungeonGrundriss } from './DungeonGrundriss';
import { DungeonLadeFehler, holeDungeon, holeDungeonListe, type DungeonKopf } from './DungeonDokument';

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

export class DungeonSeite {
  private koepfe: DungeonKopf[] = [];
  private instanz = '?';
  private ladend = false;

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

    b.appendChild(
      zeile(
        knopf('Einpassen', () => {
          this.grundriss.passeEin();
          this.grundriss.zeichne();
        }),
        knopf('Prüfen', () => this.pruefe(doc))
      )
    );

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
            if (this.grundriss.entferne(i)) this.cb.meldung(`Raum #${i} entfernt (ungespeichert)`);
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
          this.grundriss.fuegeAn(Number(cw.value), rw.value);
        })
      )
    );

    const fuss = document.createElement('div');
    fuss.style.cssText = 'font-size:11px;color:#8a7350;line-height:1.5';
    fuss.textContent =
      'Angefügt wird mit denselben Funktionen wie im Spiel (attachRoom, removeRoom). ' +
      'Speichern kommt in der nächsten Etappe — bis dahin bleiben Änderungen im Browser.';
    b.appendChild(fuss);
  }

  private async oeffne(id: string): Promise<void> {
    if (!id) return;
    try {
      const doc = await holeDungeon(id);
      this.grundriss.setzeDokument(doc);
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
