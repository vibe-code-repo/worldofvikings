/**
 * Gestaltungssystem des Editors — die eine Stelle, an der Farben, Maße
 * und Bedienelement-Formen des Map-Generators stehen.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * Vorher trug jede Datei ihre Farben selbst: `Shell.ts` hatte ein
 * THEME-Objekt, `editorMain.ts` schrieb `#1d2431` und `#3a3325` als
 * Zeichenketten in jeden `style.cssText`, der Katalog noch einmal
 * eigene. Eine Gestaltungsänderung war damit eine Suche-und-Ersetze-
 * Aktion über sechs Dateien, und jede vergessene Zeile blieb als Fleck
 * im Bild stehen. Ab hier gilt: Farben kommen aus `F`, Abstände aus `M`,
 * Bedienelemente aus den Fabriken unten — literale Farbwerte in anderen
 * Editor-Dateien sind ein Fehler, kein Stil.
 *
 * ── Woher die Werte stammen ──────────────────────────────────────────
 * Aus dem Entwurf „World of Vikings Map-Generator" (August 2026). Die
 * Namen sind bewusst deutsch und beschreiben die ROLLE, nicht den
 * Farbton: `F.flaeche` bleibt richtig, wenn der Ton sich ändert,
 * `F.dunkelblau` wäre schon beim nächsten Entwurf gelogen.
 *
 * ── Schriften ────────────────────────────────────────────────────────
 * Drei Familien, alle selbst ausgeliefert aus `client/public/schriften`
 * (Einbindung in `editor.html`): IBM Plex Sans für Fließtext, IBM Plex
 * Mono für alles Gemessene (Koordinaten, Seeds, Log), Cinzel für
 * Überschriften. Selbst ausgeliefert und nicht von Google geholt — das
 * Projekt hat sich in Block A ausdrücklich von Fremdauslieferung
 * getrennt, und ein Editor, der ohne Internet anders aussieht, ist ein
 * Editor, dem man beim Bildschirmfoto nicht trauen kann.
 */

// ── Farben ───────────────────────────────────────────────────────────
export const F = {
  /** Fensterhintergrund, dunkelster Ton. */
  grund: '#0b1216',
  /** Werkzeugleiste oben (Verlauf von/bis). */
  kopfOben: '#131e23',
  kopfUnten: '#0e171b',
  /** Symbolspalte und Fußleiste. */
  spalte: '#0d171b',
  /** Seitenleiste und Dialogflächen. */
  flaeche: '#0f1a1f',
  /** Erhöhte Fläche: Knopf in Ruhe, Karteireiter. */
  erhoben: '#16242a',
  /** Erhöhte Fläche, aktiv/überfahren. */
  erhobenAktiv: '#1b2c33',
  /** Eingabefeld, vertiefte Fläche. */
  feld: '#0b1418',
  /** Karteninhalt der Eigenschaftskarte. */
  karte: '#182a31',
  /** Ozean im Kartenfenster. */
  ozean: '#071c2a',
  /** Fliessendes und stehendes Wasser im Karten-Overlay (Fluss, See). */
  wasser: '#5fc7e8',
  wasserLinie: 'rgba(95,199,232,.75)',
  wasserFlaeche: 'rgba(95,199,232,.45)',

  /** Ränder, von leise nach laut. */
  randLeise: '#1a282f',
  rand: '#22333b',
  randFeld: '#24343c',
  randKnopf: '#2b3f48',
  randHell: '#33474f',
  randAktiv: '#3d5a66',

  /** Schrift: Haupttext, Überschrift, gedimmt, sehr gedimmt. */
  text: '#e7eef1',
  textHell: '#f0e6d6',
  textRuhig: '#c3d3da',
  gedimmt: '#7b929c',
  gedimmt2: '#6d8590',
  gedimmt3: '#5f7681',
  /** Schrift auf Bronze-Flächen. */
  aufAkzent: '#1a1005',

  /** Bronze — die Handlungsfarbe. Ein Knopf in Bronze schreibt etwas. */
  akzent: '#c8853a',
  akzentHell: '#dda45c',
  akzentLicht: '#f0b662',

  /** Signale. */
  ok: '#5fbf7a',
  okText: '#9fd7b3',
  okFlaeche: '#132a20',
  okRand: '#24503a',
  warnText: '#f0b662',
  warnFlaeche: '#4a2a1e',
  warnRand: '#7a4326',
  fehler: '#d97a63',

  /** Auswahl-Zustand in Listen (Region gewählt, Werkzeug aktiv). */
  wahlFlaeche: '#1d2f24',
  wahlRand: '#3c5c3a',

  /** Schwebende Flächen über der Karte (mit Weichzeichner dahinter). */
  schwebend: 'rgba(8,18,23,.85)',
  schwebendFest: 'rgba(8,18,23,.88)',
  vorhang: 'rgba(4,10,13,.68)',
} as const;

/** Biomfarben der Karte — Füllung und Kontur, wie im Entwurf. */
export const BIOM_TON: Record<string, readonly [string, string]> = {
  grassland: ['#4e7233', '#84ad57'],
  blackforest: ['#22402e', '#4c7a51'],
  swamp: ['#3f4128', '#6d6b3a'],
  deepnorth: ['#c2d3da', '#eef6f9'],
  mistlands: ['#3d3750', '#6b5f86'],
  plains: ['#7d7135', '#b8a256'],
  mountain: ['#8fa3ad', '#cfd6dd'],
  ashlands: ['#5a2f24', '#8a4a3a'],
};

// ── Maße ─────────────────────────────────────────────────────────────
export const M = {
  kopfHoehe: 60,
  fussHoehe: 36,
  spalteBreite: 74,
  seiteBreite: 332,
  /** Regelhöhe eines Knopfs in der Werkzeugleiste. */
  knopfHoehe: 34,
  /** Regelhöhe eines Knopfs in der Seitenleiste. */
  knopfHoeheKlein: 32,
  radius: 8,
  radiusKlein: 7,
  radiusFeld: 6,
} as const;

export const SCHRIFT = {
  text: "'IBM Plex Sans',system-ui,sans-serif",
  mono: "'IBM Plex Mono',ui-monospace,monospace",
  zier: 'Cinzel,serif',
} as const;

// ── Werkzeuge ────────────────────────────────────────────────────────
/** Stilzeichenkette aus einem Objekt — spart das Semikolon-Gestocher. */
export const stil = (o: Record<string, string | number | null | undefined>): string =>
  Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .join(';') + ';';

/** Element mit Stil (und optional Text) in einem Aufruf. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.style.cssText = css;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Dehnbarer Zwischenraum in einer Flex-Zeile. */
export const luecke = (): HTMLSpanElement => el('span', 'flex:1;');

/**
 * Senkrechter Trennstrich, wie im Entwurf zwischen Knopfgruppen.
 *
 * 5 px statt der 7 px des Entwurfs: Der Editor führt in der Kopfzeile
 * einen Knopf mehr als das Bild („Karte live testen" — der Testflug und
 * der Serverneustart sind zwei verschiedene Dinge), und die Reihe lief
 * damit auf 1920 um 27 px über. Die fehlende Breite aus den
 * Zwischenräumen zu holen ist der einzige Weg, der keine Beschriftung
 * verstümmelt.
 */
export const trenner = (hoehe = 22): HTMLSpanElement =>
  el('span', stil({ width: '1px', height: `${hoehe}px`, background: F.rand, margin: '0 5px', flex: 'none' }));

/**
 * Überfahr-Verhalten ohne Stilblatt. Der Editor baut sein DOM
 * imperativ und hat keine CSS-Datei; `:hover` gäbe es also nur über ein
 * eingehängtes <style>. Zwei Zeiger-Ereignisse sind billiger als eine
 * Regelverwaltung — und sie folgen dem Element, wenn es neu gebaut wird.
 */
export function beiUeberfahren(n: HTMLElement, an: Record<string, string>): void {
  const aus: Record<string, string> = {};
  for (const k of Object.keys(an)) aus[k] = n.style.getPropertyValue(k);
  n.addEventListener('pointerenter', () => {
    for (const [k, v] of Object.entries(an)) n.style.setProperty(k, v);
  });
  n.addEventListener('pointerleave', () => {
    for (const [k, v] of Object.entries(aus)) n.style.setProperty(k, v);
  });
}

// ── Sinnbilder ───────────────────────────────────────────────────────
/**
 * Strichzeichnungen als SVG-Pfad. Alle im Feld 24×24, alle unausgefüllt
 * mit `currentColor` — dadurch nimmt ein Sinnbild die Farbe seines
 * Elternteils an und muss beim Zustandswechsel nicht angefasst werden.
 */
export const PFAD = {
  helm: 'M4 15h16M6 15l-2-6 4 2 4-6 4 6 4-2-2 6',
  raster: 'M3 4h7v7H3zM14 4h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  neuBauen: 'M4 12a8 8 0 0 1 13-6M20 12a8 8 0 0 1-13 6M17 3v3.5h-3.5M7 21v-3.5h3.5',
  flug: 'M3 12l18-8-7 18-2.5-7.5z',
  speichern: 'M5 4h11l3 3v13H5zM9 4v5h6',
  zurueckholen: 'M4 9h13a3 3 0 0 1 0 6H9M12 12l-3 3 3 3',
  export: 'M12 4v11M8 11l4 4 4-4M4 20h16',
  import: 'M12 20V9M8 13l4-4 4 4M4 4h16',
  pfeilAb: 'M6 9l6 6 6-6',
  pfeilRechts: 'M9 6l6 6-6 6',
  pfeilLinks: 'M15 6l-6 6 6 6',
  kreuz: 'M6 6l12 12M18 6L6 18',
  haken: 'M5 13l4 4 10-11',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  einpassen: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4',
  lupe: 'M16 16l4 4',
  regler: 'M4 6h16M7 12h10M10 18h4',
  auge: 'M4 12a8 8 0 0 1 16 0M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5',
  muelleimer: 'M6 7h12M10 7V5h4v2M9 11v7M15 11v7M7 7l1 13h8l1-13',
  wuerfeln: 'M4 10a8 8 0 0 1 13-4l3 3M20 6v4h-4',
  konsole: 'M6 8l4 4-4 4M13 16h5',
  einstellungen: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2 2M16.5 16.5l2 2M18.5 5.5l-2 2M7.5 16.5l-2 2',
  rueckgaengig: 'M4 10a8 8 0 0 1 13-4l3 3M20 6v4h-4M20 14a8 8 0 0 1-13 4l-3-3M4 18v-4h4',
  // Betriebsarten der Symbolspalte
  terrain: 'M3 17l5-6 4 4 3-4 6 6z',
  gewaesser: 'M3 8c3-3 5 3 8 0s5 3 8 0M3 16c3-3 5 3 8 0s5 3 8 0',
  objekte: 'M12 3l8 5v8l-8 5-8-5V8zM4 8l8 5 8-5M12 13v10',
  biome: 'M4 20h16M12 4v16M12 8l5-3M12 13l-5-3',
  routen: 'M5 19a3 3 0 1 0 0-6c5 0 8-2 8-5a3 3 0 1 1 6 0',
  // Zeichenwerkzeuge der Seitenleiste
  inselForm: 'M4 16l4-5 3 3 3-4 6 6z',
  polygon: 'M6 4l14 5-4 11-9-2z',
  fluss: 'M5 4c0 5 8 5 8 10s6 5 6 6',
  see: 'M4 14c4-4 12-4 16 0-4 4-12 4-16 0z',
  platzieren: 'M12 3v18M3 12h18',
} as const;

/**
 * Sinnbild als SVG. `pfad` darf mehrere Teilpfade tragen (Leerzeichen
 * getrennte M-Befehle) — deshalb genau ein <path> und keine Zerlegung.
 * `extra` hängt rohes SVG an (Kreise, Rechtecke), wo ein Pfad allein
 * nicht reicht.
 */
export function sinnbild(pfad: string, groesse = 14, strich = 2, extra = ''): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(groesse));
  svg.setAttribute('height', String(groesse));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strich));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.flex = 'none';
  svg.innerHTML = `<path d="${pfad}"></path>${extra}`;
  return svg;
}

/** Lupe — braucht einen Kreis zusätzlich zum Griff. */
export const lupenBild = (groesse = 13): SVGElement =>
  sinnbild(PFAD.lupe, groesse, 2.2, '<circle cx="11" cy="11" r="6"></circle>');

// ── Bedienelemente ───────────────────────────────────────────────────
export type KnopfArt = 'flaeche' | 'bronze' | 'leise';

/**
 * Knopf der Werkzeugleiste und der Dialoge.
 *
 * `bronze` ist ausdrücklich für Handlungen reserviert, die etwas
 * schreiben („In die Welt speichern", „Exportieren"). Zwei bronzene
 * Knöpfe nebeneinander sind ein Gestaltungsfehler: Der Blick braucht
 * genau ein Ziel je Fläche.
 */
export function knopf(
  text: string,
  bei: () => void,
  o: { art?: KnopfArt; pfad?: string; hoehe?: number; titel?: string; randHover?: string } = {}
): HTMLButtonElement {
  const art = o.art ?? 'flaeche';
  const hoehe = o.hoehe ?? M.knopfHoehe;
  const bronze = art === 'bronze';
  const b = el(
    'button',
    stil({
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      height: `${hoehe}px`,
      padding: `0 ${bronze ? 14 : 13}px`,
      background: bronze ? F.akzent : art === 'leise' ? 'transparent' : F.erhoben,
      border: `1px solid ${bronze ? F.akzentHell : F.randKnopf}`,
      'border-radius': `${M.radius}px`,
      color: bronze ? F.aufAkzent : art === 'leise' ? '#a9bfc8' : '#dce7ec',
      'font-family': 'inherit',
      'font-size': '12.5px',
      'font-weight': bronze ? '600' : '400',
      'white-space': 'nowrap',
      cursor: 'pointer',
    })
  );
  if (o.pfad) b.appendChild(sinnbild(o.pfad, 14, bronze ? 2.2 : 2));
  // Die Beschriftung sitzt in einem eigenen Element und nicht als nackter
  // Textknoten: Nur so lässt sie sich im Schmalzustand ausblenden (s.
  // `.wov-schmal` in den Grundregeln), ohne das Sinnbild mitzunehmen.
  // Ausgeblendet wird ausschliesslich bei Knöpfen MIT Sinnbild — sonst
  // bliebe ein leeres Kästchen stehen.
  const beschriftung = el('span', '', text);
  if (o.pfad) beschriftung.dataset.knopfText = '';
  b.appendChild(beschriftung);
  if (o.titel) b.title = o.titel;
  else if (o.pfad) b.title = text;
  if (bronze) beiUeberfahren(b, { background: F.akzentHell });
  else beiUeberfahren(b, { 'border-color': o.randHover ?? F.randAktiv, color: '#fff' });
  b.onclick = bei;
  return b;
}

/** Runde Marke — Filter, Zähler, Zustandsplaketten. */
export function marke(text: string, an: boolean, bei?: () => void): HTMLSpanElement {
  const s = el(
    'span',
    stil({
      padding: '4px 9px',
      'border-radius': '999px',
      'font-size': '11px',
      background: an ? F.randKnopf : F.flaeche,
      border: `1px solid ${an ? F.randAktiv : F.randFeld}`,
      color: an ? F.textHell : F.gedimmt,
      cursor: bei ? 'pointer' : 'default',
      'white-space': 'nowrap',
    }),
    text
  );
  if (bei) s.onclick = bei;
  return s;
}

/** Texteingabe im Entwurfsstil. */
export function feld(
  wert: string,
  bei: (v: string) => void,
  o: { breite?: string; mono?: boolean; titel?: string; einheit?: string } = {}
): HTMLDivElement {
  const huelle = el(
    'div',
    stil({
      display: 'flex',
      'align-items': 'center',
      gap: '6px',
      height: '34px',
      padding: '0 10px',
      width: o.breite ?? 'auto',
      flex: o.breite ? 'none' : '1',
      background: F.feld,
      border: `1px solid ${F.randFeld}`,
      'border-radius': `${M.radiusKlein}px`,
    })
  );
  const i = el(
    'input',
    stil({
      flex: '1',
      'min-width': '0',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: F.text,
      'font-family': o.mono ? SCHRIFT.mono : 'inherit',
      'font-size': '12px',
    })
  );
  i.value = wert;
  if (o.titel) {
    i.title = o.titel;
    huelle.title = o.titel;
  }
  i.onchange = () => bei(i.value);
  huelle.appendChild(i);
  if (o.einheit) huelle.appendChild(el('span', stil({ 'font-size': '10.5px', color: F.gedimmt2 }), o.einheit));
  return huelle;
}

/** Auswahlliste im Entwurfsstil (eigener Rahmen um ein nacktes <select>). */
export function auswahl(
  werte: ReadonlyArray<{ id: string; name: string }>,
  gewaehlt: string,
  bei: (id: string) => void,
  o: { punkt?: string } = {}
): HTMLDivElement {
  const huelle = el(
    'div',
    stil({
      flex: '1',
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      height: '34px',
      padding: '0 10px',
      background: F.feld,
      border: `1px solid ${F.randFeld}`,
      'border-radius': `${M.radiusKlein}px`,
      position: 'relative',
    })
  );
  if (o.punkt) {
    huelle.appendChild(
      el('span', stil({ width: '11px', height: '11px', 'border-radius': '50%', border: `2px solid ${o.punkt}`, flex: 'none' }))
    );
  }
  const s = el(
    'select',
    stil({
      flex: '1',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: F.text,
      'font-family': 'inherit',
      'font-size': '12px',
      appearance: 'none',
      cursor: 'pointer',
    })
  );
  for (const w of werte) {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.name;
    opt.selected = w.id === gewaehlt;
    opt.style.background = F.flaeche;
    s.appendChild(opt);
  }
  s.onchange = () => bei(s.value);
  huelle.append(s, sinnbild(PFAD.pfeilAb, 11, 2.4));
  (huelle.lastElementChild as SVGElement).style.color = '#7d939d';
  return huelle;
}

/** Schieberegler mit Beschriftung und Wert rechts, wie in der Eigenschaftskarte. */
export function regler(
  titel: string,
  wert: number,
  min: number,
  max: number,
  bei: (v: number) => void,
  o: { anzeige?: (v: number) => string; schritt?: number } = {}
): HTMLDivElement {
  const anteil = Math.max(0, Math.min(1, (wert - min) / (max - min || 1)));
  const wurzel = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '6px' }));
  const kopf = el('div', stil({ display: 'flex', 'justify-content': 'space-between' }));
  kopf.append(
    el('span', beschriftungStil(), titel),
    el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '11px', color: F.akzent }), (o.anzeige ?? String)(wert))
  );
  const bahn = el(
    'div',
    stil({
      height: '5px',
      'border-radius': '99px',
      background: F.feld,
      border: `1px solid ${F.randFeld}`,
      position: 'relative',
      cursor: 'pointer',
    })
  );
  bahn.append(
    el(
      'span',
      stil({
        position: 'absolute',
        left: '0',
        top: '0',
        bottom: '0',
        width: `${anteil * 100}%`,
        background: `linear-gradient(90deg,#7a5a2c,${F.akzent})`,
        'border-radius': '99px',
      })
    ),
    el(
      'span',
      stil({
        position: 'absolute',
        left: `${anteil * 100}%`,
        top: '-4px',
        width: '11px',
        height: '11px',
        'margin-left': '-5px',
        'border-radius': '50%',
        background: F.akzentLicht,
        border: `2px solid ${F.karte}`,
      })
    )
  );
  // Ziehen und Klicken auf der Bahn — kein <input type=range>, weil der
  // sich nicht ohne Stilblatt in diese Form bringen lässt.
  const ausX = (e: PointerEvent): void => {
    const r = bahn.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const v = min + t * (max - min);
    bei(o.schritt ? Math.round(v / o.schritt) * o.schritt : v);
  };
  let zieht = false;
  bahn.addEventListener('pointerdown', (e) => {
    zieht = true;
    bahn.setPointerCapture(e.pointerId);
    ausX(e);
  });
  bahn.addEventListener('pointermove', (e) => {
    if (zieht) ausX(e);
  });
  bahn.addEventListener('pointerup', () => (zieht = false));
  wurzel.append(kopf, bahn);
  return wurzel;
}

/** Kleine Großbuchstaben-Beschriftung über einem Feld. */
export const beschriftungStil = (): string =>
  stil({ 'font-size': '10.5px', 'letter-spacing': '.1em', 'text-transform': 'uppercase', color: F.gedimmt2 });

/** Schalter (an/aus) im Entwurfsstil. */
export function schalter(an: boolean, bei: (an: boolean) => void): HTMLSpanElement {
  const s = el(
    'span',
    stil({
      width: '34px',
      height: '19px',
      'border-radius': '99px',
      background: an ? F.akzent : F.randKnopf,
      position: 'relative',
      flex: 'none',
      cursor: 'pointer',
    })
  );
  s.appendChild(
    el(
      'span',
      stil({
        position: 'absolute',
        top: '2px',
        [an ? 'right' : 'left']: '2px',
        width: '15px',
        height: '15px',
        'border-radius': '50%',
        background: an ? F.aufAkzent : '#8fb0bd',
      })
    )
  );
  s.onclick = () => bei(!an);
  return s;
}

/** Ankreuzfeld im Entwurfsstil. */
export function kreuzfeld(an: boolean, bei: (an: boolean) => void): HTMLSpanElement {
  const k = el(
    'span',
    stil({
      width: '15px',
      height: '15px',
      'border-radius': '4px',
      flex: 'none',
      display: 'grid',
      'place-items': 'center',
      background: an ? F.akzent : 'transparent',
      border: `1px solid ${an ? F.akzentHell : F.randAktiv}`,
      cursor: 'pointer',
    })
  );
  if (an) {
    const h = sinnbild(PFAD.haken, 9, 3.4);
    h.style.color = F.aufAkzent;
    k.appendChild(h);
  }
  k.onclick = () => bei(!an);
  return k;
}

/** Schwebende Fläche über der Karte (Werkzeuganzeige, Zoomknöpfe, Übersicht). */
export const schwebendStil = (extra: Record<string, string> = {}): string =>
  stil({
    background: F.schwebend,
    'backdrop-filter': 'blur(8px)',
    border: `1px solid ${F.randKnopf}`,
    'border-radius': `${M.radius}px`,
    ...extra,
  });

/** Überschrift im Zierschnitt (Cinzel), wie über der Seitenleiste. */
export const zierTitel = (text: string, groesse = 14): HTMLDivElement =>
  el(
    'div',
    stil({
      'font-family': SCHRIFT.zier,
      'font-size': `${groesse}px`,
      'font-weight': '700',
      'letter-spacing': '.06em',
      color: F.textHell,
    }),
    text
  );

/**
 * Einmalig eingehängte Regeln, die sich imperativ nicht ausdrücken
 * lassen: Bildlaufleisten, Textmarkierung, die zwei Trickfilme des
 * Entwurfs (pulsierender Punkt, wandernde Strichlinie).
 */
export function grundregelnEinhaengen(): void {
  if (document.getElementById('wov-editor-grundregeln')) return;
  const s = document.createElement('style');
  s.id = 'wov-editor-grundregeln';
  s.textContent = `
    @keyframes wovPuls { 0%,100% { opacity:1 } 50% { opacity:.35 } }
    @keyframes wovStrich { to { stroke-dashoffset:-24 } }
    .wov-puls { animation: wovPuls 2.4s ease-in-out infinite }
    ::-webkit-scrollbar { width:9px; height:9px }
    ::-webkit-scrollbar-track { background:transparent }
    ::-webkit-scrollbar-thumb { background:${F.randKnopf}; border-radius:99px }
    ::-webkit-scrollbar-thumb:hover { background:${F.randAktiv} }
    ::selection { background:${F.akzent}; color:${F.aufAkzent} }
    /* Schmale Kopfzeile: Sinnbilder bleiben, Beschriftungen weichen.
       Der Entwurf ist auf 1920 gezeichnet; darunter ist die Reihe zu
       lang, und ein Knopf, der lautlos hinter dem Rand verschwindet,
       ist schlimmer als einer ohne Wort — den Namen sagt der Tooltip. */
    .wov-schmal [data-knopf-text] { display:none }
    .wov-schmal button { padding-left:9px; padding-right:9px }
    input::placeholder { color:${F.gedimmt3} }
    select option { background:${F.flaeche}; color:${F.text} }
  `;
  document.head.appendChild(s);
}
