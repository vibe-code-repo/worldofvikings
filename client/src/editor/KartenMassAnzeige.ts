/**
 * Kartenauswertung im Editor (Roadmap B6/B7) — zwei Anzeigen, die beide
 * nur etwas aus dem Layout AUSRECHNEN und DARSTELLEN, deshalb in einer
 * Datei:
 *
 *  - Kopfzeile (B7): Landfläche gesamt, je Biom im Tooltip, Regionen
 *    ohne jede Platzierung.
 *  - Seitenleiste, eigene Sektion (B6): Überlappungswarnung — Zellen, in
 *    denen mehr Regionen konkurrieren, als das Kompilat (RegionField)
 *    sich pro Zelle merken kann.
 *
 * Die Rechnung selbst steht DOM-frei in `@wov/shared`
 * (worldlayout/kartenAuswertung.ts, mit eigenem Test) — diese Datei ist
 * nur die Darstellung und enthält keine Geometrie.
 *
 * ── Warum keine Markierung auf der Karte (B6, "wenn du eine saubere
 * Naht findest") ──────────────────────────────────────────────────────
 * `zeichneOverlay()` in editorMain.ts hat vierzehn über die Datei
 * verstreute Aufrufstellen (Drag, Zoom, Werkzeugwechsel, Import, …).
 * Ein zusätzlicher Zeichen-Pass für Zellmarkierungen bräuchte entweder
 * einen Haken an jeder dieser Stellen (kein sauberer, einzelner Anker)
 * oder eine Änderung MITTEN in `zeichneOverlay()` selbst — genau die
 * Funktion, über die laut Auftrag Mikes eigene Änderungen an
 * editorMain.ts/KartenHud.ts am ehesten laufen. Beides ist keine saubere
 * Naht. Die Liste unten nennt deshalb Mittelpunkt und Spanne jeder
 * betroffenen Gruppe in Weltkoordinaten; ein Klick zentriert die Karte
 * dorthin, genau wie ein Befund im Prüfbericht auf seine Region springt
 * (`springeZuRegion` in editorMain.ts) — nur eben ohne Auswahl, weil
 * eine Rasterzelle keine Region ist.
 */
import { F, SCHRIFT, BIOM_TON, el, stil, beschriftungStil, beiUeberfahren } from './design';
import type { EditorShell } from './Shell';
import {
  flaechenBericht,
  ueberlappungsGruppen,
  type BiomeName,
  type UeberlappungsGruppe,
  type WorldLayout,
} from '@wov/shared';

/** Biomton mit Fallback — dieselbe Regel wie `biomTon` in editorMain.ts, hier als eigene Zeile: Eine Farbzuordnung mit Fallback ist keine Geometrie, die man teilen müsste, und `biomTon` selbst ist dort nicht exportiert. */
function biomTon(b: BiomeName): readonly [string, string] {
  return BIOM_TON[b] ?? [F.gedimmt3, F.gedimmt];
}

function formatQm(qm: number): string {
  const km2 = qm / 1_000_000;
  return `${km2.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km²`;
}

function formatMeter(x: number): string {
  return Math.round(x).toLocaleString('de-DE');
}

export interface KartenMassAnzeige {
  /** Kompaktes Element in der Kopfzeile (bereits per `shell.toolbarGruppe()` eingehängt). */
  readonly kopf: HTMLDivElement;
  /** Inhalt der eigenen Seitenleisten-Sektion (bereits per `shell.sektion()` eingehängt). */
  readonly sektion: HTMLDivElement;
}

/** Baut Kopfzeilen-Platz und Seitenleisten-Sektion. Inhalt kommt erst mit dem ersten `aktualisiereKartenMassAnzeige`. */
export function baueKartenMassAnzeige(shell: EditorShell): KartenMassAnzeige {
  const gruppe = shell.toolbarGruppe();
  const kopf = el(
    'div',
    stil({
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      'font-size': '11.5px',
      color: F.gedimmt,
      'white-space': 'nowrap',
    })
  );
  gruppe.appendChild(kopf);

  const sektion = shell.sektion('Landfläche & Überlappungen');
  return { kopf, sektion };
}

/**
 * Beide Anzeigen aus dem aktuellen Entwurf neu aufbauen — vom selben
 * Aufrufpunkt wie `pruefberichtBauen()` (zentrale Redraw-Funktion
 * `alles()` in editorMain.ts), damit „was der Designer gerade gebaut
 * hat" nie hinter der letzten Änderung zurückbleibt.
 *
 * @param aufGruppeKlicken Zentriert die Karte auf einen Weltpunkt (siehe
 *   Dateikopf) — von editorMain.ts übergeben, damit diese Datei
 *   `mitteX`/`mitteZ`/`zeichneOverlay` nicht selbst kennen muss.
 */
export function aktualisiereKartenMassAnzeige(
  anzeige: KartenMassAnzeige,
  layout: WorldLayout,
  aufGruppeKlicken: (x: number, z: number) => void
): void {
  const flaeche = flaechenBericht(layout);
  const gruppen = ueberlappungsGruppen(layout);
  zeichneKopf(anzeige.kopf, flaeche, gruppen);
  zeichneSektion(anzeige.sektion, flaeche, gruppen, aufGruppeKlicken);
}

function zeichneKopf(
  kopf: HTMLDivElement,
  flaeche: ReturnType<typeof flaechenBericht>,
  gruppen: readonly UeberlappungsGruppe[]
): void {
  kopf.replaceChildren();
  kopf.append(
    el('span', stil({ color: F.gedimmt2 }), 'Land'),
    el('span', stil({ 'font-family': SCHRIFT.mono, color: F.textRuhig }), formatQm(flaeche.gesamtQm))
  );
  if (flaeche.regionenOhnePlatzierung.length > 0) {
    const warn = el(
      'span',
      stil({ 'font-family': SCHRIFT.mono, color: F.warnText }),
      `${flaeche.regionenOhnePlatzierung.length} ohne Platzierung`
    );
    warn.title = `Regionen ohne jede Platzierung: ${flaeche.regionenOhnePlatzierung.join(', ')}`;
    kopf.appendChild(warn);
  }
  if (gruppen.length > 0) {
    const zellenGesamt = gruppen.reduce((s, g) => s + g.zellenAnzahl, 0);
    const warn = el(
      'span',
      stil({ 'font-family': SCHRIFT.mono, color: F.fehler }),
      `⚠ ${zellenGesamt} Zellen überlappt`
    );
    warn.title = 'Details in der Seitenleiste unter „Landfläche & Überlappungen".';
    kopf.appendChild(warn);
  }
  // Die Biom-Aufschlüsselung steht im Tooltip — die Kopfzeile selbst
  // bleibt kompakt, wie gefordert.
  const biomZeilen =
    [...flaeche.jeBiom.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([b, qm]) => `${b}: ${formatQm(qm)}`)
      .join('\n') || '(keine Landfläche)';
  kopf.title = `Landfläche je Biom:\n${biomZeilen}`;
}

function zeichneSektion(
  sek: HTMLDivElement,
  flaeche: ReturnType<typeof flaechenBericht>,
  gruppen: readonly UeberlappungsGruppe[],
  aufGruppeKlicken: (x: number, z: number) => void
): void {
  sek.innerHTML = '';

  // ── Fläche je Biom ───────────────────────────────────────────────
  sek.appendChild(el('div', beschriftungStil(), `Landfläche — ${formatQm(flaeche.gesamtQm)}`));
  const biome = [...flaeche.jeBiom.entries()].sort((a, b) => b[1] - a[1]);
  if (biome.length === 0) {
    sek.appendChild(
      el('div', stil({ 'font-size': '11px', color: F.gedimmt2 }), 'Kein Land — noch keine Region trägt Fläche.')
    );
  }
  for (const [biom, qm] of biome) {
    const zeile = el(
      'div',
      stil({ display: 'flex', 'align-items': 'center', gap: '7px', 'font-size': '11px', color: F.textRuhig })
    );
    zeile.append(
      el('span', stil({ width: '8px', height: '8px', 'border-radius': '2px', flex: 'none', background: biomTon(biom)[0] })),
      el('span', stil({ flex: '1' }), biom),
      el('span', stil({ 'font-family': SCHRIFT.mono, color: F.gedimmt2 }), formatQm(qm))
    );
    sek.appendChild(zeile);
  }

  // ── Regionen ohne Platzierung ────────────────────────────────────
  if (flaeche.regionenOhnePlatzierung.length > 0) {
    sek.appendChild(
      el(
        'div',
        stil({ 'font-size': '11px', color: F.warnText, 'line-height': '1.5' }),
        `${flaeche.regionenOhnePlatzierung.length} Region(en) ohne jede Platzierung: ${flaeche.regionenOhnePlatzierung.join(', ')}`
      )
    );
  }

  // ── Überlappungswarnung (B6) ─────────────────────────────────────
  sek.appendChild(el('div', beschriftungStil(), 'Überlappungen'));
  if (gruppen.length === 0) {
    sek.appendChild(
      el('div', stil({ 'font-size': '11px', color: F.gedimmt2 }), 'Keine Zelle hat mehr Regionen, als das Kompilat sich merkt.')
    );
    return;
  }
  const zellenGesamt = gruppen.reduce((s, g) => s + g.zellenAnzahl, 0);
  sek.appendChild(
    el(
      'div',
      stil({ 'font-size': '11px', color: F.fehler, 'line-height': '1.5' }),
      `${zellenGesamt} Zelle(n) in ${gruppen.length} Gruppe(n) verdrängen dort still eine Region — ` +
        'was der Designer sieht, entspricht an diesen Stellen nicht mehr seiner Eingabe.'
    )
  );
  for (const g of gruppen) {
    const zeile = el(
      'div',
      stil({
        display: 'flex',
        'flex-direction': 'column',
        gap: '2px',
        padding: '5px 6px',
        'border-radius': '4px',
        cursor: 'pointer',
      })
    );
    zeile.append(
      el(
        'div',
        stil({ display: 'flex', 'justify-content': 'space-between', gap: '8px', 'font-size': '11px', color: F.text }),
        `${g.regionen.length} Regionen · ${g.zellenAnzahl} Zelle(n)`
      ),
      el('div', stil({ 'font-family': SCHRIFT.mono, 'font-size': '10px', color: F.gedimmt2 }), g.regionen.join(', ')),
      el(
        'div',
        stil({ 'font-family': SCHRIFT.mono, 'font-size': '10px', color: F.gedimmt3 }),
        `~(${formatMeter(g.mitteX)}, ${formatMeter(g.mitteZ)}) · Spanne ${formatMeter(g.maxX - g.minX)}×${formatMeter(g.maxZ - g.minZ)} m`
      )
    );
    zeile.title = 'Zur Karte springen';
    beiUeberfahren(zeile, { background: F.erhoben });
    zeile.onclick = () => aufGruppeKlicken(g.mitteX, g.mitteZ);
    sek.appendChild(zeile);
  }
}
