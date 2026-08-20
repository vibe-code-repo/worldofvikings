/**
 * EditorShell — der Rahmen des World-of-Vikings-Editors.
 *
 * Ein Gerüst mit benannten Andockplätzen: Werkzeuge registrieren nur noch
 * Inhalte, das Layout baut niemand mehr selbst. Alle Farben und Maße
 * kommen aus `design.ts` — literale Farbwerte gibt es hier nicht (die
 * einzige, begründete Ausnahme sind die Instanzfarben, siehe unten).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Instanz-Band (4 px auf dev, sonst 8 px)                      │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Kopfzeile 60 px                                              │
 *   │ Kennzeichen · Marke · weltFeld · toolbarGruppe()… · kopfRechts│
 *   ├──────┬─────────┬─────────────────────────────────────────────┤
 *   │ Sym- │ Seiten- │                                             │
 *   │ bol- │ leiste  │  viewport — Kartenfläche (Canvas-Ebenen)    │
 *   │ spal-│ 332 px  │                                             │
 *   │ te   │ Kopf    │       ┌─────────────────────────────────────┤
 *   │ 74px │ Sektion │       │ Server-Konsole — schwebt über der   │
 *   │      │ …       │       │ Karte (absolut, Höhe ziehbar)       │
 *   │      │ Fuß     │       │                                     │
 *   ├──────┴─────────┴───────┴─────────────────────────────────────┤
 *   │ Fußleiste 36 px: Punkt · meldung() … Konsole · koordinaten() │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Zwei Entscheidungen, die man beim Umbau leicht kaputt macht:
 *
 * • Meldung und Koordinaten sind GETRENNTE Elemente. Sonst überschreibt
 *   jede Mausbewegung den Fehlertext, den man gerade lesen wollte.
 * • Die Konsole schwebt und ist kein Flex-Kind mehr. Die Kartenfläche
 *   schrumpft beim Öffnen also NICHT mehr — das ist gewollt: Wer ins Log
 *   schaut, will danach dieselbe Karte wiederfinden, nicht eine neu
 *   umgerechnete Ansicht.
 */

import {
  F,
  M,
  SCHRIFT,
  PFAD,
  stil,
  el,
  luecke,
  trenner,
  sinnbild,
  marke,
  zierTitel,
  beiUeberfahren,
  grundregelnEinhaengen,
} from './design';

/**
 * Alter Farbname-Satz als Alias auf `F`.
 *
 * `GegenstandsKatalog.ts` und `AbgleichDialog.ts` greifen noch auf THEME
 * zu. Der Alias hält sie am Kompilieren, bis auch sie auf `F` umgestellt
 * sind — neue Aufrufer nehmen `F`, nicht THEME.
 */
export const THEME = {
  hintergrund: F.grund,
  flaeche: F.flaeche,
  feld: F.feld,
  rand: F.rand,
  text: F.text,
  akzent: F.akzent,
  gedimmt: F.gedimmt,
  fehler: F.fehler,
  ok: F.ok,
} as const;

/**
 * Farbe der bearbeiteten Instanz (Block A/16, Phase 2).
 *
 * ── Warum Farbe und nicht Text ───────────────────────────────────────
 * Eine Codebasis bedient zwei Container: `WOV_INSTANZ` wählt
 * `welten/dev.json` oder `welten/live.json`. Der Editor sieht in beiden
 * Fällen identisch aus — und genau daran hängt der teuerste Fehler, den
 * man hier machen kann. Ein Wort in der Fussleiste liest niemand, der
 * gerade eine Insel zieht. Ein durchgehendes Farbband über dem Fenster
 * sieht man, ohne hinzuschauen, und man sieht es AUCH auf dem
 * Bildschirmfoto, das jemand später als Beleg schickt.
 *
 * ── Warum diese Farben ───────────────────────────────────────────────
 * Kein neues Gestaltungssystem: gedecktes Grün und Rost sind die beiden
 * Signalfarben, die der Editor schon führt — die Konsole färbt
 * Fehlerzeilen damit. Hier stehen sie abgedunkelt als Bandfarbe, damit
 * heller Text darauf lesbar bleibt. Es sind die einzigen festen
 * Farbwerte in dieser Datei: Sie dürfen sich NICHT mit dem Entwurf
 * mitverschieben, denn ihre Aufgabe ist, aus jedem Gestaltungsstand
 * herauszustechen.
 *
 * ── Warum ALLES ausser 'dev' rot ist ─────────────────────────────────
 * Eine Liste, die nur `dev` und `live` kennt, müsste einen dritten
 * Container (`staging`, ein Klon zum Ausprobieren) irgendwo einsortieren
 * — und träfe dabei zwangsläufig die falsche Annahme, er sei harmlos.
 * Umgekehrt ist die Aussage sicher: `dev` ist die Welt, die man
 * wegwerfen darf, alles andere behandelt man vorsichtig. Ein
 * unbekannter Name ist damit automatisch auf der sicheren Seite.
 */
export interface InstanzStil {
  /** Farbband und Kennzeichen-Hintergrund. */
  band: string;
  /** Schrift auf dem Band. */
  schrift: string;
  /** Anzeigename im Kennzeichen. */
  name: string;
}
const STIL_DEV: InstanzStil = { band: '#3c5a44', schrift: '#d3e3c9', name: 'DEV' };
const STIL_SCHARF = (name: string): InstanzStil => ({ band: '#8f2f22', schrift: '#ffdcd2', name: name.toUpperCase() });
/**
 * Kein Serverstand: NICHT grau-neutral, sondern warnend. „Ich weiss
 * nicht, welche Welt das ist" ist der gefährlichste Zustand von allen
 * — gefährlicher als ein bekanntes `live`, denn dort weiss man
 * wenigstens, woran man ist.
 */
const STIL_UNBEKANNT: InstanzStil = { band: '#6a4a1e', schrift: '#f0dcae', name: '? INSTANZ UNBEKANNT' };

export function instanzStil(instanz: string | null): InstanzStil {
  if (instanz === null || instanz === '') return STIL_UNBEKANNT;
  return instanz === 'dev' ? STIL_DEV : STIL_SCHARF(instanz);
}

/** Schwere einer Konsolenzeile — steuert Farbe, Etikett und Zähler. */
type Schwere = 'fehler' | 'warn' | 'info';

const KONSOLE_MIN = 26;
const KONSOLE_STANDARD = 268;
const KONSOLE_PUFFER = 400;
/** Standzeit einer Meldung in der Fußleiste. */
const MELDUNG_MS = 6000;

export class EditorShell {
  readonly viewport: HTMLDivElement;
  /** Von der Shell gerufen, wenn sich die Viewport-Größe ändert. */
  aufResize: (() => void) | null = null;

  // Kopfzeile
  readonly weltFeld: HTMLDivElement;
  readonly kopfRechts: HTMLDivElement;
  private readonly kopf: HTMLDivElement;
  private readonly gruppen: HTMLDivElement;
  /** Riegel gegen die Rückkopplung des Breiten-Beobachters. */
  private kopfPruefungLaeuft = false;

  // Symbolspalte
  readonly spaltenFuss: HTMLDivElement;
  private readonly spalte: HTMLDivElement;
  private readonly spaltenLuecke: HTMLSpanElement;
  private readonly arten = new Map<string, () => void>();
  private aktiveArt: string | null = null;

  // Seitenleiste
  readonly seitenfuss: HTMLDivElement;
  private readonly seitenkopfFeld: HTMLDivElement;
  private readonly seitenmitte: HTMLDivElement;

  // Fußleiste
  private readonly zustandsPunkt: HTMLSpanElement;
  private readonly meldungEl: HTMLSpanElement;
  private readonly zahlenEl: HTMLSpanElement;
  private readonly koordinatenEl: HTMLSpanElement;
  private meldungTimer: number | null = null;

  // Konsole
  private readonly konsole: HTMLDivElement;
  private readonly konsoleLog: HTMLDivElement;
  private readonly konsoleProzess: HTMLSpanElement;
  private readonly konsoleFilterFeld: HTMLSpanElement;
  private readonly konsoleAutoEl: HTMLSpanElement;
  private readonly konsoleZaehlerEl: HTMLSpanElement;
  private konsoleHoehe = KONSOLE_STANDARD;
  private konsoleOffen = false;
  private konsoleAuto = true;
  private konsoleFilter: Schwere | 'alle' = 'alle';
  /** Warn- und Fehlerzeilen seit dem letzten Öffnen der Konsole. */
  private ungelesen = 0;

  // Instanz
  private readonly instanzBand: HTMLDivElement;
  private readonly instanzSchild: HTMLDivElement;
  private readonly grundTitel: string;
  /** Stil der zuletzt gesetzten Instanz — Aufrufer färben danach ihre
   *  eigenen Bedienelemente (z. B. den Speicherknopf). */
  private stil: InstanzStil = instanzStil(null);

  private readonly reihe: HTMLDivElement;

  constructor(titel: string) {
    this.grundTitel = titel;
    grundregelnEinhaengen();

    document.body.style.cssText = stil({
      margin: '0',
      height: '100vh',
      overflow: 'hidden',
      background: F.grund,
      'font-family': SCHRIFT.text,
      'font-size': '13px',
      color: F.text,
    });
    const wurzel = el('div', stil({ display: 'flex', 'flex-direction': 'column', height: '100vh', position: 'relative' }));
    document.body.appendChild(wurzel);

    // ── Instanz-Band ────────────────────────────────────────────────
    // Ganz oben, über der Kopfzeile, volle Breite. Es steht ABSICHTLICH
    // nicht in der Fußleiste: Dort unten sammelt sich alles, was man
    // auch übersehen darf. Bis der Serverstand da ist, trägt es die
    // Warnfarbe „unbekannt" — nicht die von dev, denn vor der ersten
    // Antwort weiss der Editor gar nichts.
    this.instanzBand = el('div', stil({ height: '5px', flex: '0 0 auto' }));
    wurzel.appendChild(this.instanzBand);

    // ── Kopfzeile ───────────────────────────────────────────────────
    this.kopf = el(
      'div',
      stil({
        height: `${M.kopfHoehe}px`,
        flex: 'none',
        display: 'flex',
        'align-items': 'stretch',
        // 18 statt der 22 px des Entwurfs, gleiche Begründung wie beim
        // Trennstrich: ein Knopf mehr in der Reihe.
        gap: '18px',
        padding: '0 16px 0 20px',
        background: `linear-gradient(${F.kopfOben},${F.kopfUnten})`,
        'border-bottom': `1px solid ${F.rand}`,
        // Der Entwurf ist auf 1920 gezeichnet und passt dort auf den
        // Pixel. Der Editor läuft aber auch auf 1440 — ohne diese Zeile
        // schöbe die Knopfreihe die Zustandsmarke rechts aus dem
        // Fenster, statt sichtbar enger zu werden. `overflow:hidden`
        // hält die Kopfzeile auf ihrer Höhe; welche Gruppe nachgibt,
        // regeln die `min-width`-Angaben der Gruppen selbst.
        overflow: 'hidden',
      })
    );
    wurzel.appendChild(this.kopf);

    // Kennzeichen VOR der Marke: Es ist das Erste, was links steht, und
    // damit das Erste, was man beim Blick in die Kopfzeile liest.
    this.instanzSchild = el(
      'div',
      stil({
        'align-self': 'center',
        flex: 'none',
        padding: '3px 9px',
        'border-radius': `${M.radiusFeld - 1}px`,
        'font-family': SCHRIFT.mono,
        'font-size': '11px',
        'letter-spacing': '.08em',
        'white-space': 'nowrap',
      })
    );
    this.kopf.appendChild(this.instanzSchild);
    this.kopf.appendChild(this.markenBlock(titel));

    // Welt-Wähler: nur der Platz samt Beschriftung gehört dem Rahmen,
    // die Auswahl selbst kennt nur `editorMain` (Welten, Seeds, Stand).
    const weltBlock = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        'padding-right': '22px',
        'border-right': `1px solid ${F.randLeise}`,
      })
    );
    weltBlock.appendChild(
      el(
        'span',
        stil({ 'font-size': '10px', 'letter-spacing': '.12em', 'text-transform': 'uppercase', color: F.gedimmt2 }),
        'Welt'
      )
    );
    this.weltFeld = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '8px' }));
    weltBlock.appendChild(this.weltFeld);
    this.kopf.appendChild(weltBlock);

    // Die Knopfreihe ist das, was bei zu schmalem Fenster nachgibt: Sie
    // darf unter ihre Wunschbreite schrumpfen und blättert dann seitlich
    // — im Gegensatz zur Zustandsmarke rechts, die eine Warnung trägt
    // und deshalb niemals verschwinden darf.
    this.gruppen = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '6px',
        'min-width': '0',
        'overflow-x': 'auto',
        'scrollbar-width': 'none',
      })
    );
    this.kopf.append(this.gruppen, luecke());

    this.kopfRechts = el(
      'div',
      stil({ display: 'flex', 'align-items': 'center', gap: '12px', flex: 'none' })
    );
    this.kopf.appendChild(this.kopfRechts);

    this.instanzZeigen(null, null, 'Serverstand noch nicht geholt');

    // ── Mittelteil: Symbolspalte + Seitenleiste + Karte ─────────────
    this.reihe = el('div', stil({ flex: '1', display: 'flex', 'min-height': '0' }));
    wurzel.appendChild(this.reihe);

    this.spalte = el(
      'div',
      stil({
        width: `${M.spalteBreite}px`,
        flex: 'none',
        background: F.spalte,
        'border-right': `1px solid ${F.randLeise}`,
        display: 'flex',
        'flex-direction': 'column',
        padding: '10px 0',
        gap: '2px',
      })
    );
    this.spaltenLuecke = luecke();
    this.spaltenFuss = el(
      'div',
      stil({
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        gap: '8px',
        padding: '10px 0',
        'border-top': `1px solid ${F.randLeise}`,
        color: F.gedimmt3,
      })
    );
    this.spalte.append(this.spaltenLuecke, this.spaltenFuss);
    this.reihe.appendChild(this.spalte);

    const seite = el(
      'div',
      stil({
        width: `${M.seiteBreite}px`,
        flex: 'none',
        background: F.flaeche,
        'border-right': `1px solid ${F.randLeise}`,
        display: 'flex',
        'flex-direction': 'column',
        'min-height': '0',
      })
    );
    this.seitenkopfFeld = el('div', stil({ flex: 'none' }));
    this.seitenmitte = el('div', stil({ flex: '1', 'overflow-y': 'auto', 'min-height': '0' }));
    this.seitenfuss = el(
      'div',
      stil({
        flex: 'none',
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '11px 18px',
        'border-top': `1px solid ${F.randLeise}`,
      })
    );
    seite.append(this.seitenkopfFeld, this.seitenmitte, this.seitenfuss);
    this.reihe.appendChild(seite);

    this.viewport = el(
      'div',
      stil({ flex: '1', position: 'relative', 'min-width': '0', 'min-height': '0', overflow: 'hidden', background: F.ozean })
    );
    this.reihe.appendChild(this.viewport);

    // ── Fußleiste ───────────────────────────────────────────────────
    const fuss = el(
      'div',
      stil({
        height: `${M.fussHoehe}px`,
        flex: 'none',
        display: 'flex',
        'align-items': 'center',
        gap: '16px',
        padding: '0 16px',
        background: F.spalte,
        'border-top': `1px solid ${F.randLeise}`,
        'font-size': '11.5px',
        color: F.gedimmt,
      })
    );
    const zustand = el('span', stil({ display: 'flex', 'align-items': 'center', gap: '7px', 'min-width': '0' }));
    this.zustandsPunkt = el(
      'span',
      stil({ width: '6px', height: '6px', 'border-radius': '50%', background: F.ok, flex: 'none' })
    );
    this.meldungEl = el('span', stil({ 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }));
    zustand.append(this.zustandsPunkt, this.meldungEl);
    this.zahlenEl = el('span', stil({ 'white-space': 'nowrap' }));
    this.koordinatenEl = el('span', stil({ 'font-family': SCHRIFT.mono, color: F.textRuhig, 'white-space': 'nowrap' }));
    // Zähler-Plakette am Konsolenknopf: Sie ist der einzige Hinweis
    // darauf, dass im Hintergrund etwas schiefgeht, solange die Konsole
    // zu ist — und damit der Grund, sie überhaupt zu öffnen.
    this.konsoleZaehlerEl = el(
      'span',
      stil({
        padding: '1px 6px',
        'border-radius': '999px',
        background: F.warnFlaeche,
        border: `1px solid ${F.warnRand}`,
        color: F.warnText,
        'font-size': '10px',
        'font-weight': '600',
        display: 'none',
      })
    );
    const konsoleKnopf = el(
      'button',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        height: '24px',
        padding: '0 10px',
        background: F.erhoben,
        border: `1px solid ${F.randKnopf}`,
        'border-radius': `${M.radiusFeld}px`,
        color: F.textRuhig,
        'font-family': 'inherit',
        'font-size': '11.5px',
        cursor: 'pointer',
      })
    );
    konsoleKnopf.append(sinnbild(PFAD.konsole, 12, 2), document.createTextNode('Server-Konsole'), this.konsoleZaehlerEl);
    konsoleKnopf.title = 'Server-Konsole ein-/ausblenden';
    beiUeberfahren(konsoleKnopf, { 'border-color': F.randAktiv });
    konsoleKnopf.onclick = () => (this.konsoleOffen ? this.konsoleSchliessen() : this.konsoleOeffnen());

    fuss.append(zustand, trenner(14), this.zahlenEl, luecke(), konsoleKnopf, trenner(14), this.koordinatenEl);
    wurzel.appendChild(fuss);

    // ── Server-Konsole (schwebt über der Karte) ─────────────────────
    // Sie beginnt links, wo die Karte beginnt: Symbolspalte und
    // Seitenleiste bleiben frei, damit man während des Neustarts
    // weiterklicken kann, ohne die Konsole wegzuräumen.
    this.konsole = el(
      'div',
      stil({
        position: 'absolute',
        left: `${M.spalteBreite + M.seiteBreite}px`,
        right: '0',
        bottom: `${M.fussHoehe}px`,
        height: `${KONSOLE_STANDARD}px`,
        display: 'none',
        'flex-direction': 'column',
        background: F.schwebendFest,
        'backdrop-filter': 'blur(10px)',
        'border-top': `1px solid ${F.randKnopf}`,
      })
    );
    const griff = el('div', stil({ height: '5px', flex: 'none', cursor: 'ns-resize' }));
    const konsoleKopf = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '10px',
        padding: '9px 14px',
        'border-bottom': `1px solid ${F.randLeise}`,
        flex: 'none',
        'user-select': 'none',
      })
    );
    this.konsoleProzess = el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', color: F.gedimmt3 }), 'wov-server');
    this.konsoleFilterFeld = el('span', stil({ display: 'flex', 'align-items': 'center', gap: '6px' }));
    this.konsoleAutoEl = el('span', stil({ 'font-size': '11.5px', cursor: 'pointer' }), 'Auto-Scroll');
    this.konsoleAutoEl.title = 'Neue Zeilen automatisch ins Bild holen';
    this.konsoleAutoEl.onclick = () => {
      this.konsoleAuto = !this.konsoleAuto;
      this.zeichneAuto();
    };
    const schliessen = sinnbild(PFAD.kreuz, 14, 2);
    schliessen.style.cursor = 'pointer';
    schliessen.style.color = F.gedimmt2;
    schliessen.addEventListener('click', () => this.konsoleSchliessen());
    konsoleKopf.append(
      el(
        'span',
        stil({ 'font-size': '11px', 'letter-spacing': '.1em', 'text-transform': 'uppercase', color: F.textRuhig }),
        'Server-Konsole'
      ),
      this.konsoleProzess,
      trenner(14),
      this.konsoleFilterFeld,
      luecke(),
      this.konsoleAutoEl,
      schliessen
    );
    this.konsoleLog = el(
      'div',
      stil({
        flex: '1',
        'overflow-y': 'auto',
        'min-height': '0',
        padding: '8px 14px',
        'font-family': SCHRIFT.mono,
        'font-size': '11.5px',
        'line-height': '1.75',
      })
    );
    this.konsole.append(griff, konsoleKopf, this.konsoleLog);
    wurzel.appendChild(this.konsole);
    this.zeichneFilter();
    this.zeichneAuto();

    // Ziehen am Griff: Höhe stufenlos zwischen minimiert und voller
    // Höhe des Mittelteils.
    let ziehStart: { y: number; hoehe: number } | null = null;
    griff.addEventListener('pointerdown', (e) => {
      ziehStart = { y: e.clientY, hoehe: this.konsoleHoehe };
      griff.setPointerCapture(e.pointerId);
    });
    griff.addEventListener('pointermove', (e) => {
      if (ziehStart) this.setzeKonsoleHoehe(ziehStart.hoehe + (ziehStart.y - e.clientY));
    });
    griff.addEventListener('pointerup', () => {
      ziehStart = null;
    });

    window.addEventListener('resize', () => {
      this.aufResize?.();
      this.kopfBreitePruefen();
    });
    // Auch ohne Fensteränderung: Die Gruppen entstehen erst, nachdem der
    // Konstruktor durch ist (`toolbarGruppe()` ruft der Aufrufer später).
    // Ein Beobachter am Behälter merkt das, ein einmaliger Aufruf nicht.
    new ResizeObserver(() => this.kopfBreitePruefen()).observe(this.gruppen);
  }

  /**
   * Passt die Knopfreihe der Kopfzeile in ihr Fenster.
   *
   * Der Entwurf ist auf 1920 gezeichnet und geht dort genau auf. Auf
   * einem schmaleren Bildschirm läuft die Reihe über — und ein Knopf,
   * der lautlos hinter dem Rand verschwindet, ist der schlechteste
   * Ausgang: Man sucht ihn, ohne zu wissen, dass es ihn noch gibt.
   * Deshalb weichen zuerst die Beschriftungen und nicht die Knöpfe; das
   * Sinnbild bleibt, der Name steht im Tooltip.
   *
   * Die Prüfung misst im WEITEN Zustand: Erst Beschriftungen wieder
   * einblenden, dann schauen, ob es passt. Ohne diesen Schritt bliebe
   * die Leiste schmal, sobald sie es einmal war — sie misst sich sonst
   * in ihrem eigenen, bereits verkleinerten Zustand.
   */
  private kopfBreitePruefen(): void {
    if (this.kopfPruefungLaeuft) return;
    this.kopfPruefungLaeuft = true;
    this.gruppen.classList.remove('wov-schmal');
    const passtNicht = this.gruppen.scrollWidth > this.gruppen.clientWidth + 1;
    this.gruppen.classList.toggle('wov-schmal', passtNicht);
    // Der Beobachter feuert auf die eigene Änderung. Der Riegel wird erst
    // nach dem nächsten Ablauf gelöst, sonst dreht sich die Prüfung im
    // Kreis.
    setTimeout(() => (this.kopfPruefungLaeuft = false), 0);
  }

  /**
   * Markenblock links: bronzenes Helmzeichen, darüber der Name in
   * Cinzel, darunter die Gattung. Beide Zeilen stammen aus dem
   * Konstruktor-Titel („⚔ World of Vikings — Map-Generator"), damit der
   * Rahmen keine zweite Wahrheit über seinen eigenen Namen führt: vor
   * dem Gedankenstrich die Marke, dahinter die Unterzeile. Das Zierzeichen
   * am Anfang fällt weg — in Versalien mit weitem Sperrsatz ist es ein
   * Fleck, kein Schmuck.
   */
  private markenBlock(titel: string): HTMLDivElement {
    const teile = titel.split('—');
    const oben = (teile[0] ?? titel).trim().replace(/^[^\p{L}]+/u, '').toUpperCase();
    const unten = (teile[1] ?? '').trim();

    const block = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '12px',
        'padding-right': '22px',
        'border-right': `1px solid ${F.randLeise}`,
      })
    );
    const zeichen = el(
      'div',
      stil({
        width: '30px',
        height: '30px',
        flex: 'none',
        display: 'grid',
        'place-items': 'center',
        background: F.akzent,
        'border-radius': `${M.radiusKlein}px`,
        color: F.aufAkzent,
        'box-shadow': '0 1px 0 rgba(255,255,255,.18) inset',
      })
    );
    zeichen.appendChild(sinnbild(PFAD.helm, 17, 2));
    const text = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '2px' }));
    text.append(
      el(
        'div',
        stil({
          'font-family': SCHRIFT.zier,
          'font-weight': '700',
          'font-size': '13px',
          'letter-spacing': '.14em',
          color: F.textHell,
          'white-space': 'nowrap',
        }),
        oben
      ),
      el('div', stil({ 'font-size': '11px', 'letter-spacing': '.04em', color: F.gedimmt, 'white-space': 'nowrap' }), unten)
    );
    block.append(zeichen, text);
    return block;
  }

  // ── Kopfzeile ──────────────────────────────────────────────────────
  /** Knopfgruppe in der Kopfzeile — ab der zweiten mit Trenner davor. */
  toolbarGruppe(): HTMLDivElement {
    if (this.gruppen.childElementCount > 0) this.gruppen.appendChild(trenner());
    const gruppe = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '6px' }));
    this.gruppen.appendChild(gruppe);
    return gruppe;
  }

  // ── Symbolspalte ───────────────────────────────────────────────────
  /**
   * Betriebsart eintragen (Terrain, Gewässer, Objekte, …). Der Klick
   * meldet nur; das Umfärben macht `setzeBetriebsart`, damit ein
   * abgelehnter Wechsel (ungespeicherte Änderung, laufender Testflug)
   * die Leiste nicht schon umgestellt hat, bevor er scheitert.
   */
  betriebsart(id: string, label: string, pfad: string, bei: () => void): void {
    const feld = el(
      'div',
      stil({
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        gap: '5px',
        margin: '0 8px',
        padding: '9px 2px',
        'border-radius': `${M.radiusKlein}px`,
        cursor: 'pointer',
        'user-select': 'none',
      })
    );
    feld.append(
      sinnbild(pfad, 19, 1.8),
      el('span', stil({ 'font-size': '9.5px', 'letter-spacing': '.02em', 'text-align': 'center', 'line-height': '1.25' }), label)
    );
    feld.title = label;

    // Kein `beiUeberfahren`: Das merkt sich die Ausgangswerte beim Bauen
    // und würde nach einem Zustandswechsel den alten Zustand zurückmalen.
    let drueber = false;
    const zeichne = (): void => {
      const aktiv = this.aktiveArt === id;
      feld.style.background = aktiv ? F.erhobenAktiv : drueber ? F.erhoben : 'transparent';
      feld.style.color = aktiv ? F.akzentLicht : drueber ? F.textRuhig : F.gedimmt2;
      feld.style.boxShadow = aktiv ? `inset 0 0 0 1px ${F.randHell}` : 'none';
    };
    feld.addEventListener('pointerenter', () => {
      drueber = true;
      zeichne();
    });
    feld.addEventListener('pointerleave', () => {
      drueber = false;
      zeichne();
    });
    feld.onclick = bei;
    zeichne();

    this.arten.set(id, zeichne);
    this.spalte.insertBefore(feld, this.spaltenLuecke);
  }

  /** Betriebsart hervorheben (rein sichtbar, löst kein `bei` aus). */
  setzeBetriebsart(id: string): void {
    this.aktiveArt = id;
    for (const zeichne of this.arten.values()) zeichne();
  }

  // ── Seitenleiste ───────────────────────────────────────────────────
  /**
   * Fester Kopf der Seitenleiste: Zierüberschrift und ein Erklärsatz.
   * Wiederholte Aufrufe ersetzen den Kopf — beim Wechsel der Betriebsart
   * ändert sich beides.
   */
  seitenkopf(titel: string, text: string): void {
    this.seitenkopfFeld.replaceChildren();
    this.seitenkopfFeld.style.cssText = stil({
      flex: 'none',
      padding: '16px 18px 14px',
      'border-bottom': `1px solid ${F.randLeise}`,
    });
    const kopfzeile = zierTitel(titel, 14);
    kopfzeile.style.marginBottom = '4px';
    this.seitenkopfFeld.append(
      kopfzeile,
      el('div', stil({ 'font-size': '11.5px', 'line-height': '1.55', color: F.gedimmt }), text)
    );
  }

  /**
   * Einklappbarer Abschnitt im scrollenden Mittelteil.
   *
   * Von Hand gebaut statt `<details>`: Der Aufklapp-Pfeil von `<details>`
   * lässt sich ohne Stilblatt nicht in beiden Wiedergabemaschinen
   * abschalten, und der Editor führt bewusst keins.
   */
  sektion(titel: string, offen = true): HTMLDivElement {
    const block = el('div', stil({ 'border-bottom': `1px solid ${F.randLeise}` }));

    // Leerer Titel = Sektion OHNE Kopfzeile: Der erste Block unter dem
    // Seitenkopf braucht keine zweite Überschrift, die dasselbe noch
    // einmal sagt — dort ist im Entwurf nur eine Trennlinie. Eine
    // Kopfzeile mit leerem Text wäre stattdessen ein Aufklapp-Pfeil, der
    // ins Nichts zeigt.
    if (titel === '') {
      const nurInhalt = el(
        'div',
        stil({ padding: '12px 18px 14px', display: 'flex', 'flex-direction': 'column', gap: '12px' })
      );
      block.appendChild(nurInhalt);
      this.seitenmitte.appendChild(block);
      return nurInhalt;
    }

    const kopf = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '12px 18px',
        cursor: 'pointer',
        'user-select': 'none',
        'font-size': '10.5px',
        'letter-spacing': '.1em',
        'text-transform': 'uppercase',
        color: F.gedimmt2,
      })
    );
    const pfeil = sinnbild(PFAD.pfeilRechts, 11, 2.6);
    pfeil.style.transition = 'transform .12s';
    kopf.append(pfeil, el('span', '', titel));
    beiUeberfahren(kopf, { color: F.textRuhig });

    const inhalt = el(
      'div',
      stil({ padding: '2px 18px 14px', display: 'flex', 'flex-direction': 'column', gap: '12px' })
    );
    let aufgeklappt = offen;
    const zeichne = (): void => {
      inhalt.style.display = aufgeklappt ? 'flex' : 'none';
      pfeil.style.transform = aufgeklappt ? 'rotate(90deg)' : 'none';
    };
    kopf.onclick = () => {
      aufgeklappt = !aufgeklappt;
      zeichne();
    };
    zeichne();

    block.append(kopf, inhalt);
    this.seitenmitte.appendChild(block);
    return inhalt;
  }

  // ── Fußleiste ──────────────────────────────────────────────────────
  /** Meldung links (mit Standzeit, überlebt jede Mausbewegung). */
  meldung(text: string, fehler = false): void {
    this.meldungEl.textContent = text;
    this.meldungEl.style.color = fehler ? F.fehler : F.gedimmt;
    this.zustandsPunkt.style.background = fehler ? F.fehler : F.ok;
    if (this.meldungTimer !== null) window.clearTimeout(this.meldungTimer);
    this.meldungTimer = window.setTimeout(() => {
      this.meldungEl.textContent = '';
      this.zustandsPunkt.style.background = F.ok;
    }, MELDUNG_MS);
  }

  /** Koordinatenanzeige rechts — unabhängig von Meldungen. */
  koordinaten(text: string): void {
    this.koordinatenEl.textContent = text;
  }

  /** Kennzahlen der Welt, z. B. „19 Regionen · 159 Platzierungen". */
  fussZahlen(text: string): void {
    this.zahlenEl.textContent = text;
  }

  // ── Konsole ────────────────────────────────────────────────────────
  private setzeKonsoleHoehe(px: number): void {
    this.konsoleHoehe = Math.min(this.reihe.clientHeight, Math.max(KONSOLE_MIN, px));
    this.konsole.style.height = `${this.konsoleHoehe}px`;
    this.aufResize?.();
  }

  private konsoleOeffnen(): void {
    this.konsoleOffen = true;
    this.konsole.style.display = 'flex';
    if (this.konsoleHoehe <= KONSOLE_MIN + 2) this.setzeKonsoleHoehe(KONSOLE_STANDARD);
    // Gelesen ist, was man sehen konnte: Der Zähler startet beim Öffnen
    // neu, sonst zählt er ewig Zeilen mit, die längst abgehakt sind.
    this.ungelesen = 0;
    this.zeichneZaehler();
    if (this.konsoleAuto) this.konsoleLog.scrollTop = this.konsoleLog.scrollHeight;
    this.aufResize?.();
  }

  private konsoleSchliessen(): void {
    this.konsoleOffen = false;
    this.konsole.style.display = 'none';
    this.aufResize?.();
  }

  private zeichneZaehler(): void {
    this.konsoleZaehlerEl.textContent = String(this.ungelesen);
    this.konsoleZaehlerEl.style.display = this.ungelesen > 0 ? 'inline' : 'none';
  }

  private zeichneAuto(): void {
    this.konsoleAutoEl.style.color = this.konsoleAuto ? F.textHell : F.gedimmt;
  }

  private zeichneFilter(): void {
    const stufen: ReadonlyArray<{ id: Schwere | 'alle'; text: string }> = [
      { id: 'alle', text: 'Alle' },
      { id: 'warn', text: 'Warnungen' },
      { id: 'fehler', text: 'Fehler' },
    ];
    this.konsoleFilterFeld.replaceChildren(
      ...stufen.map((s) =>
        marke(s.text, this.konsoleFilter === s.id, () => {
          this.konsoleFilter = s.id;
          this.zeichneFilter();
          for (const z of Array.from(this.konsoleLog.children)) this.zeigeZeile(z as HTMLElement);
        })
      )
    );
  }

  /** Blendet eine Zeile nach dem aktuellen Filter ein oder aus. */
  private zeigeZeile(zeile: HTMLElement): void {
    const s = (zeile.dataset.schwere ?? 'info') as Schwere;
    const sichtbar =
      this.konsoleFilter === 'alle' ||
      (this.konsoleFilter === 'warn' && s !== 'info') ||
      (this.konsoleFilter === 'fehler' && s === 'fehler');
    zeile.style.display = sichtbar ? 'flex' : 'none';
  }

  /**
   * Konsole aufklappen. Fuer Vorgaenge, bei denen das Log die
   * eigentliche Rueckmeldung ist — ein Serverneustart dauert lange
   * genug, dass ein reiner Wartebalken wie ein Haenger wirkt. Eine
   * bereits geoeffnete Konsole wird NICHT umgestellt; wer sie auf volle
   * Hoehe gezogen hat, will sie so.
   */
  konsoleZeigen(): void {
    if (!this.konsoleOffen || this.konsoleHoehe <= KONSOLE_MIN + 2) this.konsoleOeffnen();
  }

  /** Zeile in die Server-Konsole (Puffer 400 Zeilen, Auto-Scroll). */
  konsoleZeile(text: string): void {
    const schwere: Schwere = /error|Error|FAIL/.test(text) ? 'fehler' : /warn|Warn|WARN/.test(text) ? 'warn' : 'info';
    // Die zweite Erkennung ist keine Schwere, sondern Herkunft: Zeilen
    // aus dem Weltaufbau sind die, auf die man beim Speichern wartet.
    const vomSpiel = /\[WoV\]|WorldLayout|Platzierungen/.test(text);
    const farbe = schwere === 'fehler' ? F.fehler : schwere === 'warn' ? F.warnText : vomSpiel ? F.akzent : F.textRuhig;
    const etikett = schwere === 'fehler' ? 'FEHLER' : schwere === 'warn' ? 'WARN' : vomSpiel ? 'WOV' : 'LOG';

    const zeile = el('div', stil({ display: 'flex', gap: '12px' }));
    zeile.dataset.schwere = schwere;
    const jetzt = new Date();
    const zwei = (n: number): string => String(n).padStart(2, '0');
    zeile.append(
      // Empfangszeit, nicht die des Servers: Sie steht für „wann kam das
      // hier an" und ist damit die Zeit, die zum Klick davor passt.
      el(
        'span',
        stil({ color: F.gedimmt3, flex: 'none' }),
        `${zwei(jetzt.getHours())}:${zwei(jetzt.getMinutes())}:${zwei(jetzt.getSeconds())}`
      ),
      el('span', stil({ color: farbe, flex: 'none', 'min-width': '52px', 'text-align': 'right' }), etikett),
      el('span', stil({ color: farbe, 'white-space': 'pre-wrap', 'word-break': 'break-word' }), text)
    );
    this.zeigeZeile(zeile);
    this.konsoleLog.appendChild(zeile);
    while (this.konsoleLog.childElementCount > KONSOLE_PUFFER) this.konsoleLog.firstElementChild?.remove();
    if (this.konsoleAuto) this.konsoleLog.scrollTop = this.konsoleLog.scrollHeight;

    if (schwere !== 'info' && !this.konsoleOffen) {
      this.ungelesen++;
      this.zeichneZaehler();
    }
  }

  /**
   * Zustandszeile der Konsole (Prozess, Verbindungsabbruch). Steht in
   * Mono neben dem Titel — der Titel selbst bleibt stehen, damit man die
   * Fläche auch dann noch benennen kann, wenn nichts mehr ankommt.
   */
  konsoleStatus(text: string): void {
    this.konsoleProzess.textContent = text;
  }

  // ── Instanz ────────────────────────────────────────────────────────
  /**
   * Welche Welt wird hier bearbeitet? Färbt Band, Kennzeichen und
   * Fenstertitel (der Reiter zählt mit — wer drei Editoren offen hat,
   * unterscheidet sie sonst nur am Zufall).
   *
   * `instanz === null` heisst „der Betriebsdienst hat nichts gesagt" und
   * ist ein Warnzustand, kein neutraler. `hinweis` landet im Tooltip und
   * nennt den Grund.
   */
  instanzZeigen(instanz: string | null, datei: string | null, hinweis?: string): void {
    this.stil = instanzStil(instanz);
    const harmlos = instanz === 'dev';
    this.instanzBand.style.background = this.stil.band;
    // Auf dev ein schmaler Streifen, sonst doppelt so hoch, und die
    // Kopfzeile bekommt denselben Rand: Dann liest man die Warnung
    // nicht als Zierleiste, sondern als Rahmen um das ganze Fenster.
    this.instanzBand.style.height = harmlos ? '4px' : '8px';
    this.kopf.style.borderBottomColor = harmlos ? F.rand : this.stil.band;
    this.instanzSchild.style.background = this.stil.band;
    this.instanzSchild.style.color = this.stil.schrift;
    this.instanzSchild.textContent = this.stil.name;
    const beschreibung = [
      instanz ? `Instanz ${instanz}` : 'Instanz unbekannt',
      datei ? `server/data/welten/${datei}` : null,
      hinweis ?? null,
    ]
      .filter(Boolean)
      .join(' · ');
    this.instanzSchild.title = beschreibung;
    this.instanzBand.title = beschreibung;
    document.title = `${this.stil.name} — ${this.grundTitel}`;
  }

  /** Farben der aktuellen Instanz — für Bedienelemente ausserhalb der Shell. */
  get instanzFarben(): InstanzStil {
    return this.stil;
  }
}
