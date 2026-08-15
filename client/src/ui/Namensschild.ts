/**
 * Namensschilder über Spielfiguren — Name, Stufe, Lebensbalken, Quest-Zeichen.
 *
 * Vorbild ist die Nameplate aus World of Warcraft, und zwar bewusst bis in
 * die Farben hinein: rot = greift an, gelb = lässt in Ruhe, grün = auf
 * meiner Seite. Diese Zuordnung bringt jeder Spieler mit; eine eigene
 * Konvention kostet nur Verwirrung (dieselbe Begründung wie bei
 * `questZeichen()` in shared/src/npc.ts). Woher die Haltung kommt, wird
 * hier nicht entschieden — `haltungZwischen()` beantwortet das aus den
 * Fraktionen, und `questZeichen()` entscheidet über `?` und `!`.
 *
 * ── Warum DOM und nicht 3D ───────────────────────────────────────────
 * Die Hauptforderung an ein Namensschild ist, dass es auf 5 m und auf 35 m
 * GLEICH GROSS ist — schrumpft es mit dem Modell, ist es in der Entfernung
 * unlesbar, und genau dort braucht man es. Ein Billboard-Mesh müsste dafür
 * jeden Frame mit dem Kehrwert der Entfernung gegenskaliert werden, bräuchte
 * eine Schriftatlas-Textur und müsste sich mit der Vegetation sortieren.
 * Absolut positionierte `<div>`s sind von Natur aus bildschirmfest: Die
 * Weltposition wird projiziert, die Schriftgrösse bleibt in Pixeln stehen.
 * ObjectLabels.ts geht aus denselben Gründen so vor.
 *
 * Die Elemente liegen in einem POOL (`slots`) und werden nie pro Frame neu
 * erzeugt — nur ihre Position, Farbe und ihr Text ändern sich, und auch das
 * nur, wenn sich der Wert tatsächlich geändert hat.
 */

import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import {
  findPrefabByName,
  haltungZwischen,
  loeseNpcAuf,
  questZeichen,
  type Fraktion,
  type Haltung,
  type NpcEinordnung,
} from '@wov/shared';
import type { DynamischeInstanz, EntityManager } from '../entities/EntityManager';
import { UI } from './theme';

/**
 * Ab dieser Entfernung (m) erscheint gar kein Schild mehr.
 *
 * 40 m aus drei Gründen: Es ist der Wert, den ObjectLabels für dieselbe Art
 * Beschriftung schon benutzt (ein zweiter Umkreis für dieselbe Sache wäre
 * willkürlich), es entspricht der WoW-Voreinstellung von 41 Yards, und es
 * liegt innerhalb des Kollisionsfensters von 48 m (EntityManager,
 * COLLIDER_RANGE) — was hier ein Schild bekommt, ist auch physisch
 * vorhanden. Weiter draussen stünde der Wald voller Namen, ohne dass man
 * mit einem davon etwas anfangen könnte.
 */
const AUSBLENDEN = 40;
/** Über die letzten Meter davor wird das Schild blass, statt zu blinken. */
const AUSBLEND_RAMPE = 8;
/**
 * Obergrenze gleichzeitig sichtbarer Schilder, nächste zuerst.
 *
 * Schützt gegen den Fall "Herde läuft ins Bild": Ab etwa zwei Dutzend
 * Namen ist ohnehin keiner mehr lesbar, aber jedes weitere DOM-Element
 * kostet Layout.
 */
const MAX_SCHILDER = 24;
/** Zugabe um das Bild herum, in der ein Schild noch gezeichnet wird (px). */
const RAND = 80;
/**
 * Bauhöhe eines Schilds (px, Zeichen + Name + Balken) — die Grenze, bis zu
 * der es am oberen Bildrand geklemmt wird, damit es vollständig sichtbar
 * bleibt. Grosszügig gerundet; genauer ginge nur mit einer Messung im DOM,
 * und die kostet in jedem Frame ein Layout.
 */
const SCHILD_HOEHE = 48;
/** Luft zwischen Scheitel und Unterkante des Schilds (m). */
const KOPF_LUFT = 0.35;
/**
 * Höhe der Spielerfigur (m) — Kapselhöhe aus PlayerController (BODY_HEIGHT).
 * Bewusst als Konstante gespiegelt statt exportiert: Das Schild braucht nur
 * einen Anhaltspunkt für den Scheitel, keine Kopplung an die Physik.
 */
const SPIELER_HOEHE = 1.8;

/**
 * Fraktion des eigenen Spielers.
 *
 * Solange es keine Charakterdaten gibt, ist der Spieler ein Wikinger — die
 * ganze Welt ist darauf gebaut. Steht als eigene Konstante da, damit die
 * Stelle, an der später der echte Wert eingesetzt wird, EINE ist.
 */
const SPIELER_FRAKTION_VORGABE: Fraktion = 'wikinger';

/** Farben je Haltung — die WoW-Konvention, auf die Palette hier abgestimmt. */
const HALTUNG_FARBE: Record<Haltung, string> = {
  // Kein reines Rot: vor dunklem Wald ist #f00 schlecht lesbar, ein leicht
  // aufgehelltes Rot bleibt eindeutig und steht besser im Bild.
  feindlich: '#ff6b5e',
  neutral: UI.gold,
  freundlich: '#7bd66f',
};

/**
 * Wie oft die Sichtlinie eines Schildes neu geprüft wird (s).
 *
 * Jeden Frame für jedes Schild zu prüfen wäre die naheliegende und teuerste
 * Lösung. 0,2 s reichen: Wer hinter eine Kuppe läuft, verschwindet dann
 * spätestens nach 5 Frames, und niemand erkennt in dieser Zeit einen Namen,
 * den er nicht sehen dürfte. Die Prüfungen sind zusätzlich über die
 * Schilder GESTREUT (siehe `naechstePruefung`), damit nicht alle im selben
 * Frame fällig werden.
 */
const SICHT_INTERVALL = 0.2;
/** Höchstens so viele Sichtprüfungen pro Frame — harte Deckelung der Kosten. */
const SICHT_PRO_FRAME = 4;
/** Abstand der Geländeproben auf der Sichtlinie (m). */
const SICHT_SCHRITT = 3;
/** Höchstzahl Proben je Sichtlinie (bei 40 m greift die Schrittweite vorher). */
const SICHT_PROBEN_MAX = 16;
/**
 * Wieviel das Gelände über der Sichtlinie liegen muss, damit es als
 * Verdeckung zählt (m). Die Heightmap ist gröber als das gezeichnete
 * Gelände; ohne diese Toleranz flackern Schilder auf jedem Grat.
 */
const SICHT_TOLERANZ = 0.25;
/** Aufräumtakt für den Sichtbarkeits-Zwischenspeicher (s). */
const CACHE_KEHREN = 2;

/**
 * ── NAHT zur Datenseite ──────────────────────────────────────────────
 *
 * Woher eine Instanz ihre Einordnung bekommt, ist NICHT Sache der
 * Darstellung. Alles unterhalb dieser einen Funktion kennt nur noch
 * fertige `NpcEinordnung`en, und genau hier — und nur hier — hängt die
 * Anzeige an der Datenseite.
 *
 * Die Vorgabe (`standardQuelle`) fragt in dieser Reihenfolge:
 *  1. `EntityManager.npcEinordnung(schluessel)` — die INSTANZ-Angabe aus
 *     dem Weltdokument (`PlacementDef.npc`, aufgelöst mit `loeseNpcAuf`).
 *     Nur sie kennt den Quest-Zustand DIESER Völva.
 *  2. `loeseNpcAuf(prefab)` — die reine Prefab-Vorgabe (NPC_VORGABEN).
 *     Fängt alles ab, was ohne Layout-Eintrag in der Welt steht: den
 *     Vorschau-Geist des Editors, per Konsole gespawnte Figuren, und im
 *     Testflug jede Platzierung, deren Kennung sich verschoben hat.
 *
 * Wer die Zuordnung ersetzen will (Quest-Fortschritt je Spieler, Namen
 * fremder Spieler), reicht `optionen.einordnung` herein und ändert an
 * dieser Datei sonst nichts.
 *
 * @param schluessel ZDO-Schlüssel der Instanz (`userId:id`, im Testflug
 *                   `edplace-<i>`).
 * @param prefab     Prefabname der Instanz.
 */
export type EinordnungQuelle = (schluessel: string, prefab: string) => NpcEinordnung | null;

export interface NamensschildOptionen {
  /** Geländehöhe an einer Weltstelle — Grundlage der Sichtprüfung. */
  bodenHoehe: (x: number, z: number) => number;
  /** Abweichende Quelle der Einordnung (siehe `EinordnungQuelle`). */
  einordnung?: EinordnungQuelle;
  /** Fraktion des Spielers; bestimmt die Farbe JEDES Schilds. */
  spielerFraktion?: Fraktion;
}

/** Ein Schild im Pool, mit seinen zuletzt geschriebenen Werten. */
interface Slot {
  wurzel: HTMLDivElement;
  zeichen: HTMLDivElement;
  name: HTMLDivElement;
  balken: HTMLDivElement;
  fuellung: HTMLDivElement;
  /** Zuletzt geschrieben — spart DOM-Schreibzugriffe in jedem Frame. */
  letzterText: string;
  letzteFarbe: string;
  letztesZeichen: string;
  letztesLeben: number;
  sichtbar: boolean;
}

/** Ein Schild, das in diesem Frame gezeichnet werden soll (Pool, s. `kandidaten`). */
interface Kandidat {
  schluessel: string;
  text: string;
  farbe: string;
  zeichen: string;
  /** Leben in Prozent, oder -1 wenn unbekannt (dann kein Balken). */
  leben: number;
  /** Weltpunkt des Schild-Ankers (Scheitel + Luft). */
  kx: number;
  ky: number;
  kz: number;
  /** Abstand zum Spieler (m) — Sortierung und Ausblenden. */
  d: number;
}

export class Namensschilder {
  private readonly wurzel: HTMLDivElement;
  private readonly slots: Slot[] = [];
  private enabled = true;
  private eigenesAn = false;

  /** Wiederverwendete Listen — ein Frame darf keinen Müll erzeugen. */
  private readonly ziele: DynamischeInstanz[] = [];
  private readonly kandidaten: Kandidat[] = [];
  private kandidatenAnzahl = 0;
  /** Nach Abstand sortierte Referenzen auf `kandidaten` (wiederverwendet). */
  private readonly sortiert: Kandidat[] = [];

  /** Einordnung je PREFAB (nicht je Instanz) — findPrefabByName ist nicht gratis. */
  private readonly einordnungCache = new Map<string, NpcEinordnung | null>();
  /** Sichtlinien-Ergebnis je Instanz, mit Fälligkeit (s. SICHT_INTERVALL). */
  private readonly sicht = new Map<string, { verdeckt: boolean; naechste: number; gesehen: number }>();
  private uhr = 0;
  private kehrenBei = CACHE_KEHREN;

  private spielerName = 'Du';
  /** Leben des Spielers in Prozent (Server-PlayerState), -1 = noch unbekannt. */
  private spielerLeben = -1;
  private readonly spielerFraktion: Fraktion;
  private readonly quelle: EinordnungQuelle;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly entities: () => EntityManager | null,
    private readonly optionen: NamensschildOptionen
  ) {
    this.spielerFraktion = optionen.spielerFraktion ?? SPIELER_FRAKTION_VORGABE;
    this.quelle =
      optionen.einordnung ??
      ((schluessel, prefab) =>
        this.entities()?.npcEinordnung(schluessel) ?? this.einordnungVonPrefab(prefab));

    const wurzel = document.createElement('div');
    wurzel.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'width:100%', 'height:100%',
      'pointer-events:none',
      // Unter den Objektnamen (940) und unter allen Menüs, aber über dem
      // Fadenkreuz — ein Schild darf kein Bedienelement verdecken.
      'z-index:935',
      `font-family:${UI.font}`,
    ].join(';');
    document.body.appendChild(wurzel);
    this.wurzel = wurzel;
  }

  setEnabled(an: boolean): void {
    if (an === this.enabled) return;
    this.enabled = an;
    this.wurzel.style.display = an ? 'block' : 'none';
    if (!an) this.versteckeAb(0);
  }

  /** Eigenes Schild über dem Kopf der Spielfigur (Verfolgerperspektive). */
  setEigenes(an: boolean): void {
    this.eigenesAn = an;
  }

  setSpielerName(name: string): void {
    this.spielerName = name.trim() || 'Du';
  }

  /**
   * Leben des Spielers in Prozent — dieselbe Zahl, die der Server für den
   * HUD-Balken schickt (PacketType.PlayerState, `health/maxHealth*100`).
   * Es gibt bewusst keine zweite Quelle dafür.
   */
  setSpielerLeben(prozent: number): void {
    this.spielerLeben = Math.max(0, Math.min(100, prozent));
  }

  /**
   * Einmal pro Frame aufrufen.
   *
   * @param dt      Sekunden seit dem letzten Frame (Takt der Sichtprüfung).
   * @param spieler Fusspunkt der Spielfigur.
   */
  update(dt: number, spieler: { x: number; y: number; z: number }): void {
    if (!this.enabled) return;
    const mgr = this.entities();
    if (!mgr) return;
    this.uhr += dt;

    this.kandidatenAnzahl = 0;
    const anzahl = mgr.dynamischeInstanzen(this.ziele);
    for (let i = 0; i < anzahl; i++) {
      const z = this.ziele[i]!;
      // Der Vorschau-Geist des Editors ist kein Wesen, sondern ein Werkzeug:
      // Er hängt am Mauszeiger und wird bei jedem Klick neu gesetzt. Ein
      // Namensschild würde mitwandern und nur ablenken.
      if (z.key === 'edghost') continue;
      const dx = z.x - spieler.x;
      const dz = z.z - spieler.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > AUSBLENDEN * AUSBLENDEN) continue;
      const e = this.quelle(z.key, z.prefab);
      if (!e) continue;
      const haltung = haltungZwischen(e.fraktion, this.spielerFraktion);
      this.nimmKandidat(
        z.key,
        `${e.name}  ⟨${e.stufe}⟩`,
        HALTUNG_FARBE[haltung],
        questZeichen(e) ?? '',
        // Leben aus dem ZDO-Member `health`, umgerechnet am Maximalwert
        // aus shared/leben.ts (s. EntityManager.applyDynamic). Immer noch
        // kein erfundener Wert: Wer den Member nicht trägt — ein Wesen aus
        // einem Save von vor dieser Änderung —, liefert -1 und bekommt
        // keinen Balken statt einen leeren.
        z.leben,
        z.x,
        z.y + this.kopfHoehe(z),
        z.z,
        Math.sqrt(d2)
      );
    }

    if (this.eigenesAn) {
      // Der eigene Name gehört über den eigenen Kopf, weil die Kamera hinter
      // der Figur steht und man sie dort sieht — genau wie in WoW. Der
      // Lebenswert ist derselbe wie im HUD unten links; doppelt gezeigt ist
      // er hier nicht überflüssig, sondern dort, wo der Blick ohnehin ist.
      this.nimmKandidat(
        '#spieler',
        this.spielerName,
        HALTUNG_FARBE.freundlich,
        '',
        this.spielerLeben,
        spieler.x,
        spieler.y + SPIELER_HOEHE + KOPF_LUFT,
        spieler.z,
        0
      );
    }

    // Nächste zuerst: nur die ersten MAX_SCHILDER werden gezeichnet.
    // Sortiert wird eine WIEDERVERWENDETE Referenzliste — `slice()` legte
    // hier jeden Frame ein neues Array an.
    const liste = this.sortiert;
    liste.length = 0;
    for (let i = 0; i < this.kandidatenAnzahl; i++) liste.push(this.kandidaten[i]!);
    liste.sort((a, b) => a.d - b.d);

    const engine = this.scene.getEngine();
    const breite = engine.getRenderWidth();
    const hoehe = engine.getRenderHeight();
    const view = this.scene.getTransformMatrix();
    const vp = this.camera.viewport.toGlobal(breite, hoehe);
    const kamera = this.camera.globalPosition;
    let pruefungenUebrig = SICHT_PRO_FRAME;
    let gezeichnet = 0;

    for (const k of liste) {
      if (gezeichnet >= MAX_SCHILDER) break;
      PUNKT.set(k.kx, k.ky, k.kz);
      const p = Vector3.Project(PUNKT, Matrix.Identity(), view, vp);
      // z ausserhalb 0..1 heisst hinter der Kamera (dort spiegelt die
      // Projektion in die Bildmitte) oder jenseits der Far-Plane.
      if (p.z < 0 || p.z > 1) continue;
      // Seitlich oder unten aus dem Bild: kein Schild und vor allem KEIN
      // Platz aus dem Kontingent — wer hinter dem Bildrand steht, würde
      // sonst einem sichtbaren Nachbarn den Slot wegnehmen. Der Rand ist
      // grosszügig, damit am Bildrand nichts hart aufpoppt.
      if (p.x < -RAND || p.x > breite + RAND || p.y > hoehe + RAND) continue;
      if (k.schluessel !== '#spieler' && !this.sichtFrei(k, kamera, () => pruefungenUebrig-- > 0)) {
        continue;
      }
      const slot = this.slot(gezeichnet++);
      // Ganzzahlige Pixel: halbe Pixel machen die Schrift unscharf.
      const sx = Math.round(p.x);
      // Nach OBEN wird nicht abgeschnitten, sondern an den Bildrand
      // GEKLEMMT (wie in WoW). Grund ist Surtr: Steht man vor dem 9 m hohen
      // Riesen, liegt sein Scheitel über dem Bildrand — sein Schild wäre
      // ausgerechnet dann verschwunden, wenn er das halbe Bild füllt.
      // Seitlich wird bewusst NICHT geklemmt: Ein Schild, das am linken
      // Rand klebt, während die Figur ausserhalb steht, zeigt auf nichts.
      const sy = Math.max(SCHILD_HOEHE, Math.round(p.y));
      slot.wurzel.style.transform = `translate(-50%,-100%) translate3d(${sx}px,${sy}px,0)`;
      slot.wurzel.style.opacity = String(
        Math.max(0.25, Math.min(1, (AUSBLENDEN - k.d) / AUSBLEND_RAMPE))
      );
      if (k.text !== slot.letzterText) {
        slot.name.textContent = k.text;
        slot.letzterText = k.text;
      }
      if (k.farbe !== slot.letzteFarbe) {
        slot.name.style.color = k.farbe;
        slot.fuellung.style.background = k.farbe;
        slot.letzteFarbe = k.farbe;
      }
      if (k.zeichen !== slot.letztesZeichen) {
        slot.zeichen.textContent = k.zeichen;
        slot.zeichen.style.display = k.zeichen ? 'block' : 'none';
        slot.letztesZeichen = k.zeichen;
      }
      if (k.leben !== slot.letztesLeben) {
        slot.balken.style.display = k.leben < 0 ? 'none' : 'block';
        if (k.leben >= 0) slot.fuellung.style.width = `${k.leben}%`;
        slot.letztesLeben = k.leben;
      }
      if (!slot.sichtbar) {
        slot.wurzel.style.display = 'block';
        slot.sichtbar = true;
      }
    }
    this.versteckeAb(gezeichnet);

    // Zwischenspeicher der Sichtprüfung kehren: Instanzen verschwinden
    // ständig (Despawn, Editor-Löschung) — ohne das wüchse die Map ewig.
    if (this.uhr >= this.kehrenBei) {
      this.kehrenBei = this.uhr + CACHE_KEHREN;
      for (const [key, s] of this.sicht) {
        if (this.uhr - s.gesehen > CACHE_KEHREN) this.sicht.delete(key);
      }
    }
  }

  dispose(): void {
    this.wurzel.remove();
  }

  // ── Innerei ────────────────────────────────────────────────────────

  /**
   * Reine Prefab-Vorgabe, zwischengespeichert.
   *
   * `loeseNpcAuf` legt bei jedem Aufruf ein Objekt an; für ein Dutzend
   * Schilder in jedem Frame wäre das vermeidbarer Müll, und die Vorgabe je
   * Prefab ändert sich nie.
   */
  private einordnungVonPrefab(prefab: string): NpcEinordnung | null {
    let e = this.einordnungCache.get(prefab);
    if (e === undefined) {
      e = loeseNpcAuf(prefab);
      this.einordnungCache.set(prefab, e);
    }
    return e;
  }

  /**
   * Höhe des Scheitels über dem Ursprung der Instanz (m).
   *
   * Eine feste Höhe wäre hier falsch: Surtr ist 9 m hoch, die Völva keine
   * 2 m — dasselbe Schild sässe dem einen in den Knien und schwebte über
   * dem anderen. `renderScale.h` des Prefabs ist die gepflegte Modellhöhe
   * IN METERN und enthält die `localScale` bereits (Surtr 9,0 bei
   * localScale 9; Völva 1,8 bei 1,75). Abweichende Skalierungen einzelner
   * Platzierungen kommen über das Verhältnis der tatsächlichen
   * Weltskalierung zur `localScale` dazu.
   */
  private kopfHoehe(z: DynamischeInstanz): number {
    const def = findPrefabByName(z.prefab);
    if (!def) return SPIELER_HOEHE + KOPF_LUFT;
    const basis = def.localScale.y || 1;
    return def.renderScale.h * (z.skalierungY / basis) + KOPF_LUFT;
  }

  private nimmKandidat(
    schluessel: string,
    text: string,
    farbe: string,
    zeichen: string,
    leben: number,
    kx: number,
    ky: number,
    kz: number,
    d: number
  ): void {
    let k = this.kandidaten[this.kandidatenAnzahl];
    if (!k) {
      k = { schluessel, text, farbe, zeichen, leben, kx, ky, kz, d };
      this.kandidaten.push(k);
    } else {
      k.schluessel = schluessel;
      k.text = text;
      k.farbe = farbe;
      k.zeichen = zeichen;
      k.leben = leben;
      k.kx = kx;
      k.ky = ky;
      k.kz = kz;
      k.d = d;
    }
    this.kandidatenAnzahl++;
  }

  /**
   * Steht das Gelände zwischen Kamera und Schild?
   *
   * ── Warum Gelände-Proben und kein echter Strahl ──────────────────
   * Ein Strahl wäre der Lehrbuchweg und hier der falsche: Die gespawnten
   * Objekte stehen auf `isPickable = false` (dieselbe Lage wie bei
   * Anvisiert.ts), `scene.pickWithRay` liefe also ins Leere. Ein
   * Havok-Raycast wiederum startet in der Verfolgerperspektive an der
   * Kamera und müsste als erstes durch die KAPSEL DER EIGENEN FIGUR — die
   * steht mitten im Bild vor der Linse, und jedes Schild wäre dauerhaft
   * verdeckt. Ausserdem gibt es Kollisionskörper nur im 48-m-Fenster um
   * den Spieler und erst, wenn Havok geladen ist; im Testflug wären
   * Schilder damit unberechenbar.
   *
   * Geprüft wird deshalb genau das, was die Forderung nennt — der HÜGEL:
   * Auf der Verbindung Kamera→Schild liegen Proben, und liegt das Gelände
   * an einer davon über der Linie, ist das Schild verdeckt. Das ist eine
   * reine Funktion der Heightmap, überall verfügbar und billig.
   *
   * BEWUSST NICHT abgedeckt sind Bauwerke und Baumstämme: Sie stünden nur
   * mit einem Strahl gegen die Physikwelt zur Verfügung, und der scheidet
   * aus den obigen Gründen aus. Ein Name, der durch eine Hüttenwand
   * scheint, ist der deutlich kleinere Fehler als gar keine Prüfung.
   */
  private sichtFrei(
    k: Kandidat,
    kamera: Vector3,
    budget: () => boolean
  ): boolean {
    let s = this.sicht.get(k.schluessel);
    if (!s) {
      // Gestreut starten: sonst werden alle Schilder, die zusammen ins Bild
      // kommen, für immer im selben Frame fällig.
      s = { verdeckt: false, naechste: this.uhr + Math.random() * SICHT_INTERVALL, gesehen: this.uhr };
      this.sicht.set(k.schluessel, s);
      return true;
    }
    s.gesehen = this.uhr;
    if (this.uhr >= s.naechste && budget()) {
      s.naechste = this.uhr + SICHT_INTERVALL;
      s.verdeckt = this.gelaendeImWeg(kamera.x, kamera.y, kamera.z, k.kx, k.ky, k.kz);
    }
    return !s.verdeckt;
  }

  private gelaendeImWeg(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number
  ): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const weite = Math.hypot(dx, dz);
    const proben = Math.max(3, Math.min(SICHT_PROBEN_MAX, Math.round(weite / SICHT_SCHRITT)));
    for (let i = 1; i < proben; i++) {
      const t = i / proben;
      const boden = this.optionen.bodenHoehe(ax + dx * t, az + dz * t);
      if (boden > ay + dy * t + SICHT_TOLERANZ) return true;
    }
    return false;
  }

  private versteckeAb(index: number): void {
    for (let i = index; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (!s.sichtbar) continue;
      s.wurzel.style.display = 'none';
      s.sichtbar = false;
    }
  }

  /**
   * Schild Nummer `i` aus dem Pool — wird beim ersten Bedarf gebaut und
   * danach nur noch umgeschrieben. Ein `<div>` je Frame neu zu erzeugen
   * hiesse, den Layout-Baum je Frame umzubauen.
   */
  private slot(i: number): Slot {
    let s = this.slots[i];
    if (s) return s;

    const wurzel = document.createElement('div');
    wurzel.style.cssText = [
      'position:absolute', 'left:0', 'top:0', 'display:none',
      'text-align:center', 'white-space:nowrap', 'will-change:transform',
    ].join(';');

    const zeichen = document.createElement('div');
    // Quest-Zeichen: gross, golden und über allem — in WoW ist es das
    // Erste, was man im Dorf sieht, und genau dafür ist es da.
    zeichen.style.cssText = [
      'display:none', 'font-size:22px', 'font-weight:bold', 'line-height:1',
      'color:#ffd34d', 'text-shadow:0 0 6px rgba(255,180,0,.9),0 1px 3px #000',
      'margin-bottom:2px',
    ].join(';');

    const name = document.createElement('div');
    name.style.cssText = [
      'font-size:13px', 'line-height:1.15',
      'text-shadow:0 1px 2px #000,0 0 4px rgba(0,0,0,.9)',
    ].join(';');

    const balken = document.createElement('div');
    balken.style.cssText = [
      'display:none', 'width:64px', 'height:4px', 'margin:2px auto 0',
      'background:rgba(0,0,0,.65)', 'border:1px solid rgba(0,0,0,.8)',
      'border-radius:2px', 'overflow:hidden',
    ].join(';');
    const fuellung = document.createElement('div');
    fuellung.style.cssText = 'height:100%;width:100%';
    balken.appendChild(fuellung);

    wurzel.append(zeichen, name, balken);
    this.wurzel.appendChild(wurzel);
    s = {
      wurzel, zeichen, name, balken, fuellung,
      letzterText: '', letzteFarbe: '', letztesZeichen: '', letztesLeben: -2,
      sichtbar: false,
    };
    this.slots[i] = s;
    return s;
  }
}

/** Wiederverwendeter Projektionspunkt — kein Alloc pro Schild und Frame. */
const PUNKT = new Vector3();
