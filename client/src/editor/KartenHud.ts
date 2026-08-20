/**
 * KartenHud — die schwebenden Bedienflächen ÜBER der Kartenfläche.
 *
 * ── Wozu diese Datei da ist ──────────────────────────────────────────
 * Der Karteneditor hat zwei sehr verschiedene Arten von Bedienung. Die
 * eine steht in der Seitenleiste und ist eine LISTE: alle Werkzeuge,
 * alle Regionen, alle Parameter, vollständig und in fester Ordnung. Die
 * andere liegt auf der Karte selbst und ist ein BLICKFELD: Was gerade
 * unter dem Zeiger passiert, was gewählt ist, wo man sich befindet.
 *
 * Diese Datei ist die zweite Art. Sie hängt sich in `shell.viewport`
 * über die beiden Zeichenflächen (Vorschau- und Overlay-Canvas) und
 * legt fünf Flächen darüber:
 *
 *   1. Werkzeuganzeige oben links  — welches Werkzeug, welche Tasten
 *   2. Zoom- und Ebenenspalte oben rechts
 *   3. Übersichtskarte unten rechts
 *   4. Eigenschaftskarte der gewählten Region (schwebt neben ihr)
 *   5. Beschriftungsebene mit den Regionsnamen
 *
 * Dazu, getrennt schaltbar, die Testflug-Überlagerung.
 *
 * ── Warum getrennt von `editorMain.ts` ───────────────────────────────
 * `editorMain.ts` ist der Zustand des Editors: `layout`, `gewaehlt`,
 * `werkzeug`, `massstab`, die Maus, die Undo-Kette, der Serverabgleich.
 * Diese Datei hat NICHTS davon und soll nichts davon haben. Sie bekommt
 * bei jedem Aufbau eine Momentaufnahme (`HudUmgebung`) gereicht, zeichnet
 * daraus ihre Flächen und meldet Absichten über Rückrufe (`HudRueckrufe`)
 * zurück. Sie ändert das Layout nie selbst.
 *
 * Der Grund ist nicht Ordnungsliebe, sondern Prüfbarkeit: Solange die
 * Anzeige den Zustand nur liest, kann ein Anzeigefehler den Entwurf nicht
 * beschädigen. Und `editorMain.ts` ist mit über 2000 Zeilen ohnehin an
 * der Grenze — eine Fläche, die man beim Gestalten zwanzigmal am Tag
 * anfasst, gehört nicht in dieselbe Datei wie der Speicherweg.
 *
 * ── Zustandslos aufrufbar ────────────────────────────────────────────
 * `aktualisiere()` baut die Flächen jedes Mal vollständig neu. Das ist
 * Absicht: Der Editor ruft nach JEDER Änderung `alles()` auf, und eine
 * Anzeige, die dabei teilweise nachzieht, ist die häufigste Quelle für
 * „steht noch der alte Wert drin". Die einzige Ausnahme ist der
 * SVG-Rumpf der Übersichtskarte, der am Layout-Objekt zwischengespeichert
 * wird (s. `uebersichtsRumpf`).
 *
 * Was die Klasse SELBST behält, ist nur Anzeigezustand, den das
 * Weltdokument nicht kennt: die gewählte Ebene, ob Beschriftungen an
 * sind, welcher Karteireiter offen ist und der noch nicht übernommene
 * Änderungsentwurf der Eigenschaftskarte.
 *
 * ── Keine Attrappen ──────────────────────────────────────────────────
 * Jede Zahl und jede Beschriftung stammt aus `layout` oder aus der
 * übergebenen Momentaufnahme. Wo das Datenmodell ein Feld nicht kennt,
 * fehlt das Bedienelement — und zwar ersatzlos. Ein Feld, das aussieht
 * wie eine Eingabe und keine ist, kostet mehr Vertrauen, als es Fläche
 * füllt.
 */

import {
  BIOME_BY_NAME,
  DEFAULT_BASE_LEVEL,
  layoutBounds,
  type BiomeName,
  type PlacementDef,
  type RegionDef,
  type RegionShape,
  type WorldLayout,
} from '@wov/shared';
import {
  auswahl,
  beiUeberfahren,
  BIOM_TON,
  beschriftungStil,
  el,
  F,
  feld,
  knopf,
  luecke,
  M,
  marke,
  PFAD,
  regler,
  SCHRIFT,
  schalter,
  schwebendStil,
  sinnbild,
  stil,
} from './design';

// ── Öffentliche Typen ────────────────────────────────────────────────

/** Kartenebene, die der Editor unter dem Hud zeichnen soll. */
export type Ebene = 'biome' | 'hoehe' | 'routen';

/**
 * Werkzeugnamen des Editors. Wortgleich mit der Variablen `werkzeug` in
 * `editorMain.ts` — bewusst als Vereinigungstyp und nicht als `string`,
 * damit ein umbenanntes Werkzeug hier einen Übersetzungsfehler auslöst
 * statt still die falsche Tastenhilfe zu zeigen.
 */
export type Werkzeugname = 'auswahl' | 'form' | 'polygon' | 'platzieren' | 'fluss' | 'see';

/** Momentaufnahme des Editorzustands, aus der das Hud sich aufbaut. */
export interface HudUmgebung {
  layout: WorldLayout;
  gewaehlt: string | null;
  /** Aktives Werkzeug — steuert Sinnbild und Tastenhilfe. */
  werkzeug: Werkzeugname;
  /** Klartextname des Werkzeugs, z. B. „Insel-Form setzen". */
  werkzeugText: string;
  /** Zusatzangabe in der Mono-Plakette, z. B. „Kreis 1500 m". Leer = keine. */
  zusatzText: string;
  /** Weltmeter je Bildschirmpixel. */
  massstab: number;
  mitteX: number;
  mitteZ: number;
  /** Weltkoordinate → Pixel der Zeichenfläche (dieselbe Funktion wie im Editor). */
  zuBild: (wx: number, wz: number) => [number, number];
}

/**
 * Eine Kachel der Testflug-Überlagerung. Es gibt bewusst keine feste
 * Liste von Kacheln: Das Hud kennt keine Telemetrie des laufenden
 * Spiels, und was es nicht kennt, erfindet es nicht. Wer den Testflug
 * fütter, liefert genau die Werte, die er wirklich gemessen hat.
 */
export interface TestflugKachel {
  name: string;
  wert: string;
}

/** Zustand des laufenden Testflugs. Alles optional — nur Bekanntes wird gezeigt. */
export interface TestflugStand {
  /** Region unter dem Flug, wenn bekannt. */
  regionId?: string;
  biome?: BiomeName;
  /** Gemessene Kacheln unten links (Höhe, Position …). */
  kacheln?: readonly TestflugKachel[];
  /** Tastenhilfe unten rechts als [Taste, Wirkung]. Leer = keine Leiste. */
  tasten?: ReadonlyArray<readonly [string, string]>;
}

/**
 * Die Absichten, die das Hud melden kann. Das Hud ÄNDERT nichts selbst —
 * jede dieser Funktionen liegt in `editorMain.ts` und nimmt dort den
 * regulären Weg über `merkeSchritt()` / `alles()` / `vorschauAnstossen()`.
 */
export interface HudRueckrufe {
  /** +1 = näher heran, −1 = weiter weg. */
  aufZoom: (richtung: 1 | -1) => void;
  /** Ansicht auf das gesamte Layout einpassen. */
  aufEinpassen: () => void;
  aufEbene: (ebene: Ebene) => void;
  /** Änderungsbündel der Eigenschaftskarte übernehmen. */
  aufRegionAendern: (id: string, aenderung: Partial<RegionDef>) => void;
  aufRegionWaehlen: (id: string | null) => void;
  /** Öffnet den Gegenstands-Katalog. */
  aufObjektPlatzieren: () => void;
  /** Klick in die Übersichtskarte — Ansicht dorthin schwenken. */
  aufMitteSetzen: (wx: number, wz: number) => void;
  /** Knopf „Beenden" der Testflug-Überlagerung. */
  aufTestflugBeenden?: () => void;
}

// ── Kleine Rechenhilfen ──────────────────────────────────────────────

/**
 * Mittelpunkt und Hüllradius einer Form. Der Kreis liefert beides
 * unmittelbar, das Polygon den Schwerpunkt seiner Punkte und den
 * größten Abstand dorthin — genau die Werte, an denen Beschriftung und
 * Eigenschaftskarte hängen, damit beide neben der Form landen und nicht
 * darauf.
 */
function formMitte(shape: RegionShape): { x: number; z: number; r: number } {
  if (shape.kind === 'circle') return { x: shape.x, z: shape.z, r: shape.radius };
  const n = shape.points.length || 1;
  const x = shape.points.reduce((s, p) => s + p[0], 0) / n;
  const z = shape.points.reduce((s, p) => s + p[1], 0) / n;
  let r = 0;
  for (const [px, pz] of shape.points) r = Math.max(r, Math.hypot(px - x, pz - z));
  return { x, z, r };
}

/**
 * Liegt ein Punkt in der Form? Für den Kreis Abstandsvergleich, für das
 * Polygon der Strahlensatz-Test (ungerade Zahl von Kantenschnitten nach
 * rechts = innen). Wird nur zum ZÄHLEN der Platzierungen einer Region
 * gebraucht — es gibt in `@wov/shared` keinen exportierten Test dafür,
 * und der Kompiler löst dieselbe Frage über ein Distanzfeld, das hier
 * viel zu teuer wäre.
 */
function inForm(shape: RegionShape, x: number, z: number): boolean {
  if (shape.kind === 'circle') return Math.hypot(x - shape.x, z - shape.z) <= shape.radius;
  const p = shape.points;
  let drin = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!;
    const b = p[j]!;
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) {
      drin = !drin;
    }
  }
  return drin;
}

/** SVG-Element mit Attributen — spart das dreifache `setAttribute`. */
function svgEl(tag: string, attr: Record<string, string>): SVGElement {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attr)) n.setAttribute(k, v);
  return n;
}

/** Senkrechter Haarstrich zwischen zwei Angaben in einer Leiste. */
const strich = (hoehe: number): HTMLSpanElement =>
  el('span', stil({ width: '1px', height: `${hoehe}px`, background: F.randKnopf, flex: 'none' }));

/** Mono-Plakette: eine gemessene Angabe in einer Textzeile. */
const plakette = (text: string): HTMLSpanElement =>
  el(
    'span',
    stil({
      'font-family': SCHRIFT.mono,
      'font-size': '10px',
      color: F.gedimmt2,
      padding: '2px 5px',
      background: F.erhoben,
      'border-radius': '4px',
    }),
    text
  );

/**
 * Tastenkürzel in Mono, wie in der Tastenhilfe des Entwurfs. Der Entwurf
 * setzt hier `#a9bfc8`, wofür es kein Token gibt — `F.textRuhig` ist der
 * nächstliegende Wert und hält denselben Helligkeitsschritt gegenüber
 * dem umgebenden `F.gedimmt`.
 */
const taste = (text: string): HTMLSpanElement =>
  el('span', stil({ 'font-family': SCHRIFT.mono, color: F.textRuhig }), text);

/**
 * Sinnbild je Werkzeug. Ohne Zuordnung stünde in der Werkzeuganzeige ein
 * beliebiges Symbol — und ein Symbol, das nicht mitwechselt, liest man
 * nach zwei Tagen gar nicht mehr.
 */
const WERKZEUG_BILD: Record<Werkzeugname, string> = {
  auswahl: PFAD.raster,
  form: PFAD.inselForm,
  polygon: PFAD.polygon,
  platzieren: PFAD.platzieren,
  fluss: PFAD.fluss,
  see: PFAD.see,
};

/**
 * Tastenhilfe je Werkzeug — abgelesen an der Mausbehandlung in
 * `editorMain.ts`, nicht ausgedacht:
 *   Form und See halten sich mit Shift für Serien offen,
 *   Polygon und Fluss sammeln Punkte und schließen per Doppelklick,
 *   Esc bricht genau diese beiden ab,
 *   Platzieren bleibt nach dem Setzen von sich aus aktiv.
 */
const WERKZEUG_TASTEN: Record<Werkzeugname, ReadonlyArray<readonly [string, string]>> = {
  auswahl: [
    ['Klick', 'wählen'],
    ['Ziehen', 'verschieben'],
    ['Rad', 'zoomen'],
  ],
  form: [
    ['Klick', 'setzen'],
    ['Shift', 'Serie'],
  ],
  polygon: [
    ['Klick', 'Punkt'],
    ['Doppelklick', 'schließen'],
    ['Esc', 'abbrechen'],
  ],
  fluss: [
    ['Klick', 'Punkt'],
    ['Doppelklick', 'schließen'],
    ['Esc', 'abbrechen'],
  ],
  see: [
    ['Klick', 'setzen'],
    ['Shift', 'Serie'],
  ],
  platzieren: [['Klick', 'setzen']],
};

const EBENEN: ReadonlyArray<readonly [Ebene, string]> = [
  ['biome', 'Biome'],
  ['hoehe', 'Höhe'],
  ['routen', 'Routen'],
];

/** Breite der Übersichtskarte und ihrer Zeichenfläche (Entwurfsmaß). */
const UEBERSICHT_BREITE = 210;
const UEBERSICHT_HOEHE = 132;
/** Breite der schwebenden Eigenschaftskarte (Entwurfsmaß). */
const KARTE_BREITE = 296;

// ── Die Klasse ───────────────────────────────────────────────────────

export class KartenHud {
  /**
   * Eine einzige Ebene über den Zeichenflächen. Sie selbst schluckt
   * KEINE Zeigerereignisse (`pointer-events:none`) — sonst käme kein
   * Klick mehr am Overlay-Canvas an und das Zeichnen wäre tot. Jedes
   * bedienbare Kind schaltet die Ereignisse für sich wieder ein.
   */
  private readonly ebeneEl: HTMLDivElement;
  private readonly rueckrufe: HudRueckrufe;

  private readonly werkzeugEl: HTMLDivElement;
  private readonly eckeEl: HTMLDivElement;
  private readonly uebersichtEl: HTMLDivElement;
  private readonly karteEl: HTMLDivElement;
  private readonly namenEl: HTMLDivElement;
  private readonly flugEl: HTMLDivElement;

  /** Letzte Momentaufnahme — die Teilaufbauten lesen daraus. */
  private umgebung: HudUmgebung | null = null;

  /** Anzeigezustand, den das Weltdokument nicht kennt. */
  private aktiveEbene: Ebene = 'biome';
  private zeigeNamen = true;
  private reiter: 'allgemein' | 'biome' | 'objekte' = 'allgemein';

  /**
   * Noch nicht übernommene Änderungen der Eigenschaftskarte, und für
   * welche Region sie gelten.
   *
   * Warum überhaupt gesammelt und nicht sofort geschrieben: Jede
   * Änderung am Layout löst in `editorMain.ts` `alles()` samt
   * Terrainvorschau aus. Ein Schieberegler, der beim Ziehen dreißigmal
   * je Sekunde meldet, würde dreißig Vorschauläufe anstoßen. Die Karte
   * zeigt den Entwurfswert also sofort an, schreibt ihn aber erst,
   * wenn „Übernehmen" gedrückt ist — und genau das ist die Aufgabe des
   * bronzenen Knopfs im Entwurf.
   */
  private entwurf: Partial<RegionDef> = {};
  private entwurfFuer: string | null = null;

  /**
   * Zuletzt gesehene Kuratierungsliste je Region. Der Schalter „Spawns"
   * kann sonst nur in eine Richtung: Ausschalten schreibt `[]` und
   * vergisst die kuratierte Liste unwiederbringlich. Mit dieser Karte
   * bringt Wiedereinschalten sie zurück.
   */
  private readonly letzteSpawns = new Map<string, readonly string[]>();

  /**
   * SVG-Rumpf der Übersichtskarte, am Layout-OBJEKT zwischengespeichert.
   *
   * Der einzige Zwischenspeicher des Hud, und er braucht eine
   * Begründung: Der Rumpf ist der einzige Aufbau, dessen Kosten mit der
   * Zahl der Regionen UND ihrer Polygonpunkte wachsen — bei einem
   * ausgebauten Layout sind das einige tausend Koordinaten, und
   * `aktualisiere()` läuft bei jedem Klick. Der Schlüssel ist das
   * `WorldLayout`-Objekt selbst: `editorMain.ts` ersetzt es bei jeder
   * Änderung unveränderlich (`layout = { ...layout, … }`), ein
   * geändertes Layout ist also zwangsläufig ein anderes Objekt und kann
   * den alten Eintrag nicht treffen. Als `WeakMap` räumt sich der
   * Speicher zudem von selbst auf, sobald die Undo-Kette ein Layout
   * fallen lässt.
   */
  private readonly uebersichtsRumpf = new WeakMap<WorldLayout, string>();

  constructor(wurzel: HTMLElement, rueckrufe: HudRueckrufe) {
    this.rueckrufe = rueckrufe;

    this.ebeneEl = el('div', stil({ position: 'absolute', inset: '0', 'pointer-events': 'none' }));

    // Beschriftungen ganz unten im Stapel: Sie sind Text auf der Karte,
    // keine Bedienung, und dürfen von jeder Fläche verdeckt werden.
    this.namenEl = el('div', stil({ position: 'absolute', inset: '0', 'pointer-events': 'none', overflow: 'hidden' }));
    this.werkzeugEl = el(
      'div',
      stil({ position: 'absolute', top: '16px', left: '18px', display: 'flex', gap: '8px', 'align-items': 'center' })
    );
    this.eckeEl = el(
      'div',
      stil({
        position: 'absolute',
        top: '16px',
        right: '18px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '8px',
        'align-items': 'flex-end',
      })
    );
    this.uebersichtEl = el('div', stil({ position: 'absolute', bottom: '18px', right: '18px' }));
    this.karteEl = el('div', stil({ position: 'absolute', display: 'none' }));
    this.flugEl = el('div', stil({ position: 'absolute', inset: '0', display: 'none' }));

    this.ebeneEl.append(this.namenEl, this.werkzeugEl, this.eckeEl, this.uebersichtEl, this.karteEl, this.flugEl);
    wurzel.appendChild(this.ebeneEl);
  }

  /** Die gerade gewählte Kartenebene — der Editor zeichnet danach. */
  get ebene(): Ebene {
    return this.aktiveEbene;
  }

  /**
   * Baut sämtliche Flächen aus der Momentaufnahme neu auf. Darf bei jeder
   * Änderung gerufen werden; teuer ist daran nur die Übersichtskarte, und
   * die hat ihren Zwischenspeicher.
   */
  aktualisiere(u: HudUmgebung): void {
    // Regionswechsel verwirft den offenen Entwurf: Ein Wert, der für die
    // vorige Insel gedacht war, darf nicht stillschweigend auf der
    // nächsten landen.
    if (u.gewaehlt !== this.entwurfFuer) {
      this.entwurf = {};
      this.entwurfFuer = u.gewaehlt;
      this.reiter = 'allgemein';
    }
    this.umgebung = u;
    this.baueWerkzeug();
    this.baueEcke();
    this.baueUebersicht();
    this.baueNamen();
    this.baueKarte();
  }

  // ── 1. Werkzeuganzeige oben links ──────────────────────────────────
  private baueWerkzeug(): void {
    const u = this.umgebung;
    if (!u) return;
    this.werkzeugEl.innerHTML = '';

    const leiste = el(
      'div',
      schwebendStil({
        display: 'flex',
        'align-items': 'center',
        gap: '9px',
        height: '32px',
        padding: '0 12px',
      })
    );
    const bild = sinnbild(WERKZEUG_BILD[u.werkzeug], 13, 2);
    bild.style.color = F.akzent;
    leiste.append(
      bild,
      el('span', stil({ 'font-size': '11.5px', color: F.textRuhig }), 'Werkzeug:'),
      el('span', stil({ 'font-size': '11.5px', 'font-weight': '600', color: F.textHell }), u.werkzeugText)
    );
    // Die Plakette nur, wenn es wirklich etwas zu messen gibt — eine
    // leere Plakette ist ein Kasten ohne Inhalt.
    if (u.zusatzText) leiste.appendChild(plakette(u.zusatzText));
    this.werkzeugEl.appendChild(leiste);

    const hilfe = el(
      'div',
      schwebendStil({
        display: 'flex',
        'align-items': 'center',
        gap: '7px',
        height: '32px',
        padding: '0 11px',
        color: F.gedimmt,
        'font-size': '11.5px',
      })
    );
    WERKZEUG_TASTEN[u.werkzeug].forEach(([k, w], i) => {
      if (i > 0) hilfe.appendChild(strich(14));
      hilfe.append(taste(k), document.createTextNode(` ${w}`));
    });
    this.werkzeugEl.appendChild(hilfe);
  }

  // ── 2. Zoom-Spalte und Ebenen-Umschalter oben rechts ───────────────
  private baueEcke(): void {
    this.eckeEl.innerHTML = '';

    const zoom = el(
      'div',
      schwebendStil({ display: 'flex', 'flex-direction': 'column', overflow: 'hidden', 'pointer-events': 'auto' })
    );
    const zelle = (pfad: string, strichbreite: number, titel: string, bei: () => void, letzte: boolean): void => {
      const z = el(
        'span',
        stil({
          width: '34px',
          height: '32px',
          display: 'grid',
          'place-items': 'center',
          color: F.textRuhig,
          cursor: 'pointer',
          'border-bottom': letzte ? null : `1px solid ${F.rand}`,
        })
      );
      z.appendChild(sinnbild(pfad, 14, strichbreite));
      z.title = titel;
      beiUeberfahren(z, { background: F.erhobenAktiv });
      z.onclick = bei;
      zoom.appendChild(z);
    };
    zelle(PFAD.plus, 2, 'Näher heran', () => this.rueckrufe.aufZoom(1), false);
    zelle(PFAD.minus, 2, 'Weiter weg', () => this.rueckrufe.aufZoom(-1), false);
    zelle(PFAD.einpassen, 1.9, 'Alles einpassen', () => this.rueckrufe.aufEinpassen(), true);
    this.eckeEl.appendChild(zoom);

    const umschalter = el(
      'div',
      schwebendStil({ display: 'flex', padding: '3px', gap: '2px', 'align-items': 'center', 'pointer-events': 'auto' })
    );
    for (const [id, name] of EBENEN) {
      const an = id === this.aktiveEbene;
      const s = el(
        'span',
        stil({
          padding: '5px 10px',
          'border-radius': '5px',
          'font-size': '11px',
          'font-weight': an ? '600' : '400',
          background: an ? F.randKnopf : null,
          color: an ? F.textHell : F.gedimmt,
          cursor: an ? 'default' : 'pointer',
        }),
        name
      );
      if (!an) {
        beiUeberfahren(s, { color: F.textRuhig });
        s.onclick = (): void => {
          this.aktiveEbene = id;
          this.rueckrufe.aufEbene(id);
          this.baueEcke();
        };
      }
      umschalter.appendChild(s);
    }
    // Der Beschriftungsschalter steht hier und nicht bei der
    // Werkzeuganzeige: Namen auf der Karte sind eine ANSICHTSSACHE wie
    // Biome/Höhe/Routen, kein Zubehör des Werkzeugs. Ein Haarstrich
    // trennt ihn von der Segmentwahl, damit er nicht als vierte Ebene
    // gelesen wird.
    umschalter.appendChild(strich(16));
    const auge = el(
      'span',
      stil({
        padding: '5px 8px',
        'border-radius': '5px',
        display: 'grid',
        'place-items': 'center',
        background: this.zeigeNamen ? F.randKnopf : null,
        color: this.zeigeNamen ? F.textHell : F.gedimmt,
        cursor: 'pointer',
      })
    );
    auge.appendChild(sinnbild(PFAD.auge, 13, 1.9));
    auge.title = this.zeigeNamen ? 'Inselnamen ausblenden' : 'Inselnamen einblenden';
    auge.onclick = (): void => {
      this.zeigeNamen = !this.zeigeNamen;
      this.baueEcke();
      this.baueNamen();
    };
    umschalter.appendChild(auge);
    this.eckeEl.appendChild(umschalter);
  }

  // ── 3. Übersichtskarte unten rechts ────────────────────────────────
  /**
   * Die Regionsformen als SVG-Rumpf in WELTkoordinaten. Weil er keine
   * Ansichtsgrößen enthält, hängt er allein am Layout und darf
   * zwischengespeichert werden (s. `uebersichtsRumpf`) — der Ausschnitt
   * kommt später als eigenes Element obendrauf.
   */
  private rumpfFuer(layout: WorldLayout): string {
    const fertig = this.uebersichtsRumpf.get(layout);
    if (fertig !== undefined) return fertig;
    const teile: string[] = [];
    for (const r of layout.regions) {
      const ton = BIOM_TON[r.biome]?.[0] ?? F.karte;
      if (r.shape.kind === 'circle') {
        teile.push(
          `<circle cx="${r.shape.x}" cy="${r.shape.z}" r="${r.shape.radius}" fill="${ton}" fill-opacity=".85"></circle>`
        );
      } else if (r.shape.points.length >= 3) {
        const d = r.shape.points.map(([x, z], i) => `${i === 0 ? 'M' : 'L'}${x} ${z}`).join('') + 'Z';
        teile.push(`<path d="${d}" fill="${ton}" fill-opacity=".85"></path>`);
      }
    }
    const rumpf = teile.join('');
    this.uebersichtsRumpf.set(layout, rumpf);
    return rumpf;
  }

  private baueUebersicht(): void {
    const u = this.umgebung;
    if (!u) return;
    this.uebersichtEl.innerHTML = '';

    const b = layoutBounds(u.layout);
    const roh = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);

    // Sichtfeld der Übersicht: Layouthülle mit 4 % Luft, danach auf das
    // Seitenverhältnis der Zeichenfläche aufgezogen. Das ist der Trick,
    // der den Klick billig macht — passt der viewBox exakt zum Kasten,
    // ist die Umrechnung Pixel → Welt eine Gerade und nicht die
    // Briefmarken-Rechnung von `preserveAspectRatio`.
    const luft = roh * 0.04;
    let vx = b.minX - luft;
    let vz = b.minZ - luft;
    let vb = b.maxX - b.minX + luft * 2;
    let vh = b.maxZ - b.minZ + luft * 2;
    const wunsch = UEBERSICHT_BREITE / UEBERSICHT_HOEHE;
    if (vb / vh < wunsch) {
      const neu = vh * wunsch;
      vx -= (neu - vb) / 2;
      vb = neu;
    } else {
      const neu = vb / wunsch;
      vz -= (neu - vh) / 2;
      vh = neu;
    }

    const huelle = el(
      'div',
      schwebendStil({
        width: `${UEBERSICHT_BREITE}px`,
        background: F.schwebendFest,
        'border-radius': '9px',
        overflow: 'hidden',
        'pointer-events': 'auto',
      })
    );

    const kopf = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        padding: '7px 10px',
        'border-bottom': `1px solid ${F.rand}`,
      })
    );
    kopf.append(
      el('span', beschriftungStil(), 'Übersicht'),
      el(
        'span',
        stil({ 'font-family': SCHRIFT.mono, 'font-size': '10px', color: F.gedimmt2 }),
        `${(roh / 1000).toFixed(1)} km`
      )
    );
    huelle.appendChild(kopf);

    const flaeche = el(
      'div',
      stil({ position: 'relative', height: `${UEBERSICHT_HOEHE}px`, background: F.ozean, cursor: 'crosshair' })
    );
    const svg = svgEl('svg', {
      viewBox: `${vx} ${vz} ${vb} ${vh}`,
      preserveAspectRatio: 'none',
    });
    svg.setAttribute('style', stil({ position: 'absolute', inset: '0', width: '100%', height: '100%' }));
    svg.innerHTML = this.rumpfFuer(u.layout);

    // Sichtbarer Ausschnitt. Die Strichstärke ist in WELTmetern
    // anzugeben (der viewBox misst in Metern) — 1.5 Bildschirmpixel
    // umgerechnet, sonst wäre der Rahmen bei großen Welten unsichtbar
    // und bei kleinen ein Balken.
    const sichtB = this.ebeneEl.clientWidth * u.massstab;
    const sichtH = this.ebeneEl.clientHeight * u.massstab;
    if (sichtB > 0 && sichtH > 0) {
      svg.appendChild(
        svgEl('rect', {
          x: String(u.mitteX - sichtB / 2),
          y: String(u.mitteZ - sichtH / 2),
          width: String(sichtB),
          height: String(sichtH),
          fill: 'none',
          stroke: F.akzentLicht,
          'stroke-opacity': '.7',
          'stroke-width': String((vb / UEBERSICHT_BREITE) * 1.5),
        })
      );
    }
    flaeche.appendChild(svg);

    flaeche.title = 'Klick schwenkt die Ansicht dorthin';
    flaeche.onclick = (e: MouseEvent): void => {
      const kasten = flaeche.getBoundingClientRect();
      if (kasten.width === 0 || kasten.height === 0) return;
      this.rueckrufe.aufMitteSetzen(
        vx + ((e.clientX - kasten.left) / kasten.width) * vb,
        vz + ((e.clientY - kasten.top) / kasten.height) * vh
      );
    };
    huelle.appendChild(flaeche);
    this.uebersichtEl.appendChild(huelle);
  }

  // ── 4. Eigenschaftskarte der gewählten Region ──────────────────────

  /** Entwurfswert über den echten Stand gelegt — was die Karte anzeigt. */
  private mitEntwurf(echt: RegionDef): RegionDef {
    return { ...echt, ...this.entwurf };
  }

  /** Einen Wert in den Entwurf legen und NUR die Karte neu zeichnen. */
  private setzeEntwurf(p: Partial<RegionDef>): void {
    this.entwurf = { ...this.entwurf, ...p };
    this.baueKarte();
  }

  private baueKarte(): void {
    const u = this.umgebung;
    if (!u) return;
    const echt = u.gewaehlt === null ? undefined : u.layout.regions.find((r) => r.id === u.gewaehlt);
    if (!echt) {
      this.karteEl.style.display = 'none';
      this.karteEl.innerHTML = '';
      return;
    }
    const r = this.mitEntwurf(echt);
    const ton = BIOM_TON[r.biome] ?? BIOM_TON['grassland']!;

    this.karteEl.innerHTML = '';
    this.karteEl.style.cssText = stil({
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${KARTE_BREITE}px`,
      'max-height': 'calc(100% - 28px)',
      display: 'flex',
      'flex-direction': 'column',
      background: F.flaeche,
      border: `1px solid ${F.randHell}`,
      'border-radius': '11px',
      // Kein Schattenton im Gestaltungssystem — `F.vorhang` ist der
      // nächstliegende Wert (dunkles, halbdurchsichtiges Grundschwarz).
      'box-shadow': `0 18px 44px ${F.vorhang}`,
      overflow: 'hidden',
      'pointer-events': 'auto',
    });

    // ── Kopfzeile ────────────────────────────────────────────────────
    const kopf = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '9px',
        padding: '11px 12px 10px 13px',
        'border-bottom': `1px solid ${F.rand}`,
        flex: 'none',
      })
    );
    kopf.append(
      el('span', stil({ width: '10px', height: '10px', 'border-radius': '3px', background: ton[0], flex: 'none' })),
      el(
        'span',
        stil({
          'font-size': '13.5px',
          'font-weight': '600',
          color: F.textHell,
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }),
        r.id
      ),
      marke(r.biome, false),
      luecke()
    );
    const kreuz = sinnbild(PFAD.kreuz, 14, 2);
    kreuz.style.color = F.gedimmt2;
    kreuz.style.cursor = 'pointer';
    kreuz.addEventListener('click', () => this.rueckrufe.aufRegionWaehlen(null));
    kopf.appendChild(kreuz);
    this.karteEl.appendChild(kopf);

    // ── Karteireiter ─────────────────────────────────────────────────
    // „Objekte" nur, wenn das Dokument überhaupt Platzierungen führt —
    // ein Reiter, hinter dem es nichts geben KANN, ist eine Attrappe.
    const platzierungen = u.layout.placements ?? [];
    const eigene = platzierungen.filter((p) => inForm(echt.shape, p.x, p.z));
    const hatObjekte = platzierungen.length > 0;
    if (this.reiter === 'objekte' && !hatObjekte) this.reiter = 'allgemein';

    const reiterZeile = el('div', stil({ display: 'flex', gap: '2px', padding: '8px 10px 0', flex: 'none' }));
    const reiterKnopf = (id: 'allgemein' | 'biome' | 'objekte', text: string, zahl?: number): void => {
      const an = id === this.reiter;
      const s = el(
        'span',
        stil({
          padding: '6px 10px',
          'border-radius': an ? '6px 6px 0 0' : null,
          background: an ? F.karte : null,
          'font-size': '11.5px',
          'font-weight': an ? '600' : '400',
          color: an ? F.textHell : F.gedimmt,
          cursor: an ? 'default' : 'pointer',
        }),
        text
      );
      if (zahl !== undefined) {
        s.appendChild(el('span', stil({ color: F.gedimmt3, 'margin-left': '5px' }), String(zahl)));
      }
      if (!an) {
        beiUeberfahren(s, { color: F.textRuhig });
        s.onclick = (): void => {
          this.reiter = id;
          this.baueKarte();
        };
      }
      reiterZeile.appendChild(s);
    };
    reiterKnopf('allgemein', 'Allgemein');
    reiterKnopf('biome', 'Biome');
    if (hatObjekte) reiterKnopf('objekte', 'Objekte', eigene.length);
    this.karteEl.appendChild(reiterZeile);

    // ── Rumpf ────────────────────────────────────────────────────────
    const rumpf = el(
      'div',
      stil({
        padding: '12px 13px 13px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '11px',
        background: F.karte,
        'overflow-y': 'auto',
        'min-height': '0',
      })
    );
    if (this.reiter === 'allgemein') this.reiterAllgemein(rumpf, echt, r);
    else if (this.reiter === 'biome') this.reiterBiome(rumpf, r);
    else this.reiterObjekte(rumpf, eigene);
    rumpf.appendChild(this.knopfzeile(echt.id));
    this.karteEl.appendChild(rumpf);

    // ── Anklemmen an den Fensterrand (Entwurf, Skriptteil) ───────────
    // Die Karte legt sich rechts NEBEN die Form (Mittelpunkt + Radius +
    // 26 px Luft) und wird an beiden Achsen in die Zeichenfläche
    // gezogen. Gemessen wird die Höhe erst JETZT: Sie hängt am
    // gewählten Reiter, und ein fester Wert wie im Entwurf würde die
    // Karte je nach Inhalt zu früh oder zu spät anklemmen.
    this.karteEl.style.display = 'flex';
    const breiteEl = this.ebeneEl.clientWidth;
    const hoeheEl = this.ebeneEl.clientHeight;
    const m = formMitte(echt.shape);
    const [px, py] = u.zuBild(m.x, m.z);
    const rPx = m.r / u.massstab;
    const hoehe = this.karteEl.offsetHeight;
    this.karteEl.style.left = `${Math.max(12, Math.min(px + rPx + 26, breiteEl - KARTE_BREITE - 12))}px`;
    this.karteEl.style.top = `${Math.max(14, Math.min(py - 150, hoeheEl - hoehe - 14))}px`;
  }

  /** Beschriftete Gruppe: kleine Großbuchstaben-Zeile über dem Element. */
  private static gruppe(titel: string, inhalt: HTMLElement): HTMLDivElement {
    const g = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '5px', 'min-width': '0' }));
    g.append(el('span', beschriftungStil(), titel), inhalt);
    return g;
  }

  /** Nur-Lese-Kasten im Maß der Eingabefelder — für Werte ohne Eingabe. */
  private static anzeige(wert: string, einheit?: string): HTMLDivElement {
    const d = el(
      'div',
      stil({
        height: '31px',
        padding: '0 10px',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        background: F.feld,
        border: `1px solid ${F.randKnopf}`,
        'border-radius': `${M.radiusFeld}px`,
      })
    );
    d.appendChild(el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '12px', color: F.text }), wert));
    if (einheit) d.appendChild(el('span', stil({ 'font-size': '10.5px', color: F.gedimmt2 }), einheit));
    return d;
  }

  /**
   * Zahl aus einem Eingabefeld; Unlesbares fällt auf den alten Wert
   * zurück. Das leere Feld wird ausdrücklich mitgeprüft: `Number('')`
   * ist 0, und ein versehentlich geleertes Radiusfeld würde die Insel
   * sonst stillschweigend auf null Meter setzen.
   */
  private static zahl(v: string, ersatz: number): number {
    const t = v.trim().replace(',', '.');
    if (t === '') return ersatz;
    const n = Number(t);
    return Number.isFinite(n) ? n : ersatz;
  }

  // ── Reiter „Allgemein" ─────────────────────────────────────────────
  private reiterAllgemein(rumpf: HTMLElement, echt: RegionDef, r: RegionDef): void {
    // `RegionDef` kennt keinen Anzeigenamen — die `id` IST der Name, den
    // Regionsliste, Prüfbericht und Meldungen zeigen. Deshalb heißt das
    // Feld „Kennung" und nicht „Name": Es benennt nicht nur, es
    // identifiziert.
    const kennung = feld(r.id, (v) => this.setzeEntwurf({ id: v.trim() || echt.id }), { breite: '100%' });
    kennung.title = 'Kennung der Region — erscheint in Liste, Prüfbericht und Meldungen.';
    rumpf.appendChild(KartenHud.gruppe('Kennung', kennung));

    const raster = el('div', stil({ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '9px' }));
    if (r.shape.kind === 'circle') {
      const form = r.shape;
      const rad = feld(
        String(Math.round(form.radius)),
        (v) => this.setzeEntwurf({ shape: { ...form, radius: KartenHud.zahl(v, form.radius) } }),
        { breite: '100%', mono: true, einheit: 'm' }
      );
      raster.appendChild(KartenHud.gruppe('Radius', rad));
    } else {
      // Ein Polygon hat keinen Radius, den man eintippen könnte — es hat
      // Punkte, und die zieht man auf der Karte. Statt eines toten
      // Eingabefelds die Zahl, die es wirklich gibt.
      raster.appendChild(KartenHud.gruppe('Punkte', KartenHud.anzeige(String(r.shape.points.length))));
    }
    const saum = feld(
      String(Math.round(r.edgeFalloff)),
      (v) => this.setzeEntwurf({ edgeFalloff: KartenHud.zahl(v, r.edgeFalloff) }),
      { breite: '100%', mono: true, einheit: 'm' }
    );
    saum.title = 'Küstensaum: Strecke, über die das Land vom Ozeanboden auf das Regionsniveau steigt.';
    raster.appendChild(KartenHud.gruppe('Küstensaum', saum));
    rumpf.appendChild(raster);

    const grund = r.baseLevel ?? DEFAULT_BASE_LEVEL.get(r.biome) ?? 0.22;
    const grundRegler = regler('Grundhöhe', grund, 0, 1, (v) => this.setzeEntwurf({ baseLevel: v }), {
      schritt: 0.005,
      anzeige: (v) => `${Math.round(v * 200)} m`,
    });
    grundRegler.title = 'Basis-Plateau (normiert). 0.15 ist die Wasserlinie, ×200 ergibt Meter.';
    rumpf.appendChild(grundRegler);

    const wucht = r.heightScale ?? 1;
    const wuchtRegler = regler(
      'Höhenwucht',
      wucht,
      0,
      3,
      // 1 ist die Vorgabe; sie wird als FEHLENDES Feld geschrieben, damit
      // das Dokument nicht mit Werten zuwächst, die ohnehin gelten.
      (v) => this.setzeEntwurf({ heightScale: v === 1 ? undefined : v }),
      { schritt: 0.05, anzeige: (v) => `×${v.toFixed(2)}` }
    );
    wuchtRegler.title = 'Amplitudenfaktor des Perlin-Details. 1 = unverändert.';
    rumpf.appendChild(wuchtRegler);

    rumpf.appendChild(this.spawnZeile(echt.id, r));
  }

  /**
   * Schalterzeile für die Spawn-Kuratierung. Drei Zustände im Dokument,
   * zwei am Schalter:
   *   Feld fehlt    → Biom-Standardtabelle   (an)
   *   Liste gefüllt → genau diese Einträge   (an)
   *   leere Liste   → gar keine Spawns       (aus)
   * Ausschalten merkt sich die kuratierte Liste, damit Wiedereinschalten
   * sie zurückbringt statt sie auf den Biom-Standard zurückzuwerfen.
   */
  private spawnZeile(id: string, r: RegionDef): HTMLDivElement {
    const liste = r.spawns;
    const an = liste === undefined || liste.length > 0;
    if (liste && liste.length > 0) this.letzteSpawns.set(id, liste);
    const zeile = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        gap: '9px',
        padding: '9px 10px',
        background: F.feld,
        border: `1px solid ${F.randFeld}`,
        'border-radius': '7px',
      })
    );
    const text = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '2px', 'min-width': '0' }));
    text.append(
      el('span', stil({ 'font-size': '12px', color: F.text }), 'Spawns erlaubt'),
      el(
        'span',
        stil({
          'font-size': '10.5px',
          color: F.gedimmt2,
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }),
        liste === undefined ? 'Biom-Standard' : liste.length > 0 ? liste.join(', ') : 'keine'
      )
    );
    zeile.append(
      text,
      schalter(an, (neu) =>
        this.setzeEntwurf({ spawns: neu ? this.letzteSpawns.get(id) : [] })
      )
    );
    return zeile;
  }

  // ── Reiter „Biome" ─────────────────────────────────────────────────
  private reiterBiome(rumpf: HTMLElement, r: RegionDef): void {
    const ton = BIOM_TON[r.biome] ?? BIOM_TON['grassland']!;
    const wahl = auswahl(
      [...BIOME_BY_NAME.keys()].map((b) => ({ id: b, name: b })),
      r.biome,
      (v) => this.setzeEntwurf({ biome: v as BiomeName }),
      { punkt: ton[1] }
    );
    wahl.style.flex = 'none';
    rumpf.appendChild(KartenHud.gruppe('Biom', wahl));

    // Stufe als Marken und nicht als Regler: `tier` darf FEHLEN (dann
    // gilt keine Beschränkung), und dieses „gar nicht gesetzt" lässt sich
    // auf einer Bahn von 0 bis 5 nicht ausdrücken.
    const stufen = el('div', stil({ display: 'flex', gap: '5px', 'flex-wrap': 'wrap' }));
    stufen.appendChild(marke('frei', r.tier === undefined, () => this.setzeEntwurf({ tier: undefined })));
    for (let s = 0; s <= 5; s++) {
      stufen.appendChild(marke(String(s), r.tier === s, () => this.setzeEntwurf({ tier: s })));
    }
    const stufenGruppe = KartenHud.gruppe('Progressionsstufe', stufen);
    stufenGruppe.title = 'Locations mit höherer Stufe entstehen hier nicht. „frei" = keine Beschränkung.';
    rumpf.appendChild(stufenGruppe);

    rumpf.appendChild(
      this.kuratierung('Vegetation', r.vegetation, (v) => this.setzeEntwurf({ vegetation: v }))
    );
    rumpf.appendChild(this.kuratierung('Locations', r.locations, (v) => this.setzeEntwurf({ locations: v })));
    rumpf.appendChild(this.kuratierung('Spawns', r.spawns, (v) => this.setzeEntwurf({ spawns: v })));
  }

  /**
   * Eine Kuratierungsliste mit ihren drei Zuständen. Die beiden Marken
   * setzen „Standard" (Feld weg) und „keine" (leeres Feld) — Zustände,
   * die man über das Textfeld allein nicht auseinanderhalten könnte:
   * Ein leeres Eingabefeld sieht in beiden Fällen gleich aus, bedeutet
   * aber einmal „alle Standardeinträge" und einmal „gar nichts".
   */
  private kuratierung(
    titel: string,
    wert: readonly string[] | undefined,
    setz: (v: readonly string[] | undefined) => void
  ): HTMLDivElement {
    const g = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '5px' }));
    const kopf = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '5px' }));
    kopf.append(
      el('span', beschriftungStil(), titel),
      luecke(),
      marke('Standard', wert === undefined, () => setz(undefined)),
      marke('keine', wert !== undefined && wert.length === 0, () => setz([]))
    );
    const eingabe = feld(
      wert?.join(', ') ?? '',
      (v) => {
        const teile = v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        setz(teile.length > 0 ? teile : undefined);
      },
      { breite: '100%' }
    );
    g.append(kopf, eingabe);
    return g;
  }

  // ── Reiter „Objekte" ───────────────────────────────────────────────
  private reiterObjekte(rumpf: HTMLElement, eigene: readonly PlacementDef[]): void {
    if (eigene.length === 0) {
      rumpf.appendChild(
        el('div', stil({ 'font-size': '11.5px', color: F.gedimmt2 }), 'Keine Platzierung liegt in dieser Region.')
      );
      return;
    }
    const nachPrefab = new Map<string, number>();
    for (const p of eigene) nachPrefab.set(p.prefab, (nachPrefab.get(p.prefab) ?? 0) + 1);
    const liste = el(
      'div',
      stil({ display: 'flex', 'flex-direction': 'column', gap: '3px', 'max-height': '190px', 'overflow-y': 'auto' })
    );
    for (const [prefab, anzahl] of [...nachPrefab].sort((a, b) => b[1] - a[1])) {
      const zeile = el(
        'div',
        stil({
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          gap: '8px',
          padding: '4px 8px',
          background: F.feld,
          border: `1px solid ${F.randFeld}`,
          'border-radius': `${M.radiusFeld}px`,
        })
      );
      zeile.append(
        el(
          'span',
          stil({
            'font-size': '11.5px',
            color: F.textRuhig,
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }),
          prefab
        ),
        el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '11px', color: F.gedimmt2 }), `×${anzahl}`)
      );
      liste.appendChild(zeile);
    }
    rumpf.appendChild(liste);

    // Zwei Angaben, die wirklich im Dokument stehen — Figuren tragen ein
    // `npc`-Feld, laufende Objekte ein `route`-Feld. Nur zeigen, wenn es
    // sie gibt.
    const figuren = eigene.filter((p) => p.npc !== undefined).length;
    const laufend = eigene.filter((p) => p.route !== undefined).length;
    const hinweise: string[] = [];
    if (figuren > 0) hinweise.push(`${figuren} mit Einordnung als Figur`);
    if (laufend > 0) hinweise.push(`${laufend} auf einer Route`);
    if (hinweise.length > 0) {
      rumpf.appendChild(el('div', stil({ 'font-size': '10.5px', color: F.gedimmt2 }), hinweise.join(' · ')));
    }
  }

  /** Knopfzeile am Fuß der Eigenschaftskarte. */
  private knopfzeile(id: string): HTMLDivElement {
    const offen = Object.keys(this.entwurf).length;
    const zeile = el('div', stil({ display: 'flex', gap: '8px' }));
    // Bronze heißt im Haus „schreibt etwas". Solange nichts offen ist,
    // schreibt der Knopf nichts — dann ist er auch nicht bronzen.
    const uebernehmen = knopf(
      offen > 0 ? `Übernehmen (${offen})` : 'Übernehmen',
      () => {
        if (offen === 0) return;
        const p = this.entwurf;
        this.entwurf = {};
        this.rueckrufe.aufRegionAendern(id, p);
      },
      { art: offen > 0 ? 'bronze' : 'flaeche', hoehe: 32 }
    );
    uebernehmen.style.flex = '1';
    uebernehmen.style.justifyContent = 'center';
    if (offen === 0) {
      uebernehmen.disabled = true;
      uebernehmen.style.cursor = 'default';
      uebernehmen.style.opacity = '.55';
      uebernehmen.title = 'Keine offenen Änderungen';
    }
    zeile.append(
      uebernehmen,
      knopf('Objekt platzieren', () => this.rueckrufe.aufObjektPlatzieren(), {
        hoehe: 32,
        randHover: F.akzent,
      })
    );
    return zeile;
  }

  // ── 5. Inselbeschriftungen ─────────────────────────────────────────
  /**
   * Die Kennungen der Regionen als Textmarken über ihrem Mittelpunkt.
   *
   * Die ganze Ebene ist `pointer-events:none` — eine Beschriftung, die
   * einen Klick auf die Karte abfängt, wäre beim Zeichnen ein Ärgernis
   * ohne jeden Gegenwert, denn zu klicken gibt es an ihr nichts.
   *
   * `RegionDef` führt keinen Anzeigenamen; die `id` ist der Name, den
   * auch Regionsliste und Prüfbericht zeigen.
   */
  private baueNamen(): void {
    const u = this.umgebung;
    this.namenEl.innerHTML = '';
    if (!u || !this.zeigeNamen) return;
    const breite = this.ebeneEl.clientWidth;
    const hoehe = this.ebeneEl.clientHeight;
    for (const r of u.layout.regions) {
      const m = formMitte(r.shape);
      const [px, py] = u.zuBild(m.x, m.z);
      const oben = py - (m.r / u.massstab) * 0.86 - 20;
      // Was weit außerhalb liegt, gar nicht erst anlegen: Bei einem
      // ausgebauten Layout sind das schnell hundert Knoten, die niemand
      // sieht — und `aktualisiere()` läuft bei jedem Klick.
      if (px < -120 || px > breite + 120 || oben < -40 || oben > hoehe + 40) continue;
      this.namenEl.appendChild(
        el(
          'div',
          stil({
            position: 'absolute',
            left: `${px}px`,
            top: `${oben}px`,
            transform: 'translateX(-50%)',
            'font-size': '12.5px',
            'font-weight': '500',
            color: F.textRuhig,
            'white-space': 'nowrap',
            'pointer-events': 'none',
            // Doppelter Schatten wie im Entwurf: Ein einzelner reicht
            // über hellem Gelände (Hochnord, Gebirge) nicht aus.
            'text-shadow': `0 0 4px ${F.grund},0 0 4px ${F.grund}`,
          }),
          r.id
        )
      );
    }
  }

  // ── Testflug-Überlagerung ──────────────────────────────────────────
  /**
   * Zeigt die Testflug-Fläche oder blendet sie mit `null` wieder aus.
   *
   * Bewusst NICHT Teil von `aktualisiere()`: Der Testflug ist ein
   * eigener Betriebszustand, der kommt und geht, während das Layout
   * unverändert bleibt. Ihn an den Aufbau der Karte zu hängen hieße,
   * ihn bei jedem Klick mit aufzubauen.
   *
   * Alle Angaben in `TestflugStand` sind freiwillig, und es wird
   * ausschließlich gezeigt, was drinsteht. Der Editor selbst hat keine
   * Telemetrie des laufenden Spiels — der Testflug öffnet einen zweiten
   * Browser-Tab (`window.open('/?offline=1&layout=editor')`), und von
   * dort kommt nichts zurück. Solange das so ist, bleiben Kacheln wie
   * „FPS" oder „Höhe" leer, statt erfunden zu werden.
   */
  zeigeTestflug(stand: TestflugStand | null): void {
    this.flugEl.innerHTML = '';
    if (!stand) {
      this.flugEl.style.display = 'none';
      return;
    }
    this.flugEl.style.cssText = stil({
      position: 'absolute',
      inset: '0',
      background: `radial-gradient(circle at 50% 60%,transparent 30%,${F.vorhang} 100%)`,
      display: 'flex',
      'flex-direction': 'column',
      'justify-content': 'space-between',
      padding: '22px',
      'pointer-events': 'none',
    });

    // ── Kopfplakette ─────────────────────────────────────────────────
    const oben = el('div', stil({ display: 'flex', 'justify-content': 'center' }));
    const pille = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '14px',
        padding: '9px 16px',
        background: F.schwebendFest,
        'backdrop-filter': 'blur(10px)',
        border: `1px solid ${F.akzent}`,
        'border-radius': '999px',
        'pointer-events': 'auto',
      })
    );
    const zustand = el(
      'span',
      stil({ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '12px', 'font-weight': '600', color: F.textHell })
    );
    const punkt = el(
      'span',
      stil({ width: '7px', height: '7px', 'border-radius': '50%', background: F.akzentLicht, flex: 'none' })
    );
    // Die Puls-Bildfolge hängt als Klasse in den Grundregeln von
    // design.ts (von der Shell einmalig eingehängt).
    punkt.className = 'wov-puls';
    zustand.append(punkt, document.createTextNode('Testflug aktiv'));
    pille.appendChild(zustand);

    const angaben = [stand.regionId, stand.biome].filter((s): s is string => !!s);
    if (angaben.length > 0) {
      pille.append(
        strich(16),
        el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '11.5px', color: F.textRuhig }), angaben.join(' · '))
      );
    }
    if (this.rueckrufe.aufTestflugBeenden) {
      const beenden = this.rueckrufe.aufTestflugBeenden;
      pille.append(strich(16), knopf('Beenden', () => beenden(), { hoehe: 26 }));
      (pille.lastElementChild as HTMLElement).style.borderRadius = '999px';
    }
    oben.appendChild(pille);
    this.flugEl.appendChild(oben);

    // ── Fußzeile: Kacheln links, Tastenhilfe rechts ──────────────────
    const kacheln = stand.kacheln ?? [];
    const tasten = stand.tasten ?? [];
    if (kacheln.length === 0 && tasten.length === 0) return;
    const unten = el(
      'div',
      stil({ display: 'flex', 'align-items': 'flex-end', 'justify-content': 'space-between', gap: '8px' })
    );
    const kachelZeile = el('div', stil({ display: 'flex', gap: '8px' }));
    for (const k of kacheln) {
      const kachel = el('div', schwebendStil({ 'min-width': '96px', padding: '9px 12px' }));
      const name = el('div', beschriftungStil(), k.name);
      name.style.marginBottom = '4px';
      kachel.append(
        name,
        el('div', stil({ 'font-family': SCHRIFT.mono, 'font-size': '14px', color: F.textHell }), k.wert)
      );
      kachelZeile.appendChild(kachel);
    }
    unten.appendChild(kachelZeile);

    if (tasten.length > 0) {
      const hilfe = el(
        'div',
        schwebendStil({
          display: 'flex',
          gap: '7px',
          'align-items': 'center',
          padding: '8px 12px',
          'font-size': '11.5px',
          color: F.gedimmt,
        })
      );
      tasten.forEach(([k, w], i) => {
        if (i > 0) hilfe.appendChild(strich(14));
        hilfe.append(taste(k), document.createTextNode(` ${w}`));
      });
      unten.appendChild(hilfe);
    }
    this.flugEl.appendChild(unten);
  }
}
