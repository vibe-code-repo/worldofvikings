/**
 * Die Bedienelemente der Dungeon-Seitenleiste — Knopf, Auswahl, Feld,
 * Abschnitt, Häkchen, Zeile, Hinweis.
 *
 * ── Warum sie eine eigene Datei bekommen haben (E8) ──────────────────
 * Sie standen bis dahin als dateiprivate Funktionen in
 * `DungeonKatalog.ts`. Das Formular „Neuer Saal" steht daneben (eigene
 * Datei, damit der Katalog nicht weiter wächst — dieselbe Begründung,
 * mit der `DungeonKatalog.ts` selbst aus `editorMain.ts` herausgelöst
 * wurde), und es braucht dieselben Elemente.
 *
 * Es blieben zwei Wege: sie aus `DungeonKatalog.ts` exportieren — dann
 * importierte der Katalog das Formular und das Formular den Katalog, ein
 * Ringschluss — oder ein zweiter, gleich aussehender Satz Funktionen im
 * neuen Modul. Der zweite Satz wäre der schlimmere: Zwei Stilvorlagen
 * driften auseinander, und man sieht es nur auf einem Bildschirmfoto,
 * das niemand nebeneinanderlegt.
 *
 * Gemeinsam ausgelagert ist deshalb der dritte Weg. VERSCHOBEN, nicht
 * umgeschrieben: Die Funktionen behalten ihre Namen und ihren Rumpf
 * Zeichen für Zeichen, damit der Umzug am Diff ablesbar bleibt.
 *
 * The sidebar's widgets, moved out of `DungeonKatalog.ts` so the new
 * hall form can share them without an import cycle. Moved verbatim.
 */

/** Ein Knopf im Stil der Editor-Seitenleiste. */
export function knopf(text: string, bei: () => void): HTMLButtonElement {
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

export function auswahl(): HTMLSelectElement {
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
export function feld(platzhalter: string, breite: string): HTMLInputElement {
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
export function abschnitt(text: string): HTMLDivElement {
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
export function schalter(text: string, an: boolean, bei: (an: boolean) => void): HTMLLabelElement {
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
export function hinweis(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = 'font-size:11px;color:#8a7350;line-height:1.5';
  return d;
}

export function zeile(...teile: (HTMLElement | string)[]): HTMLDivElement {
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
