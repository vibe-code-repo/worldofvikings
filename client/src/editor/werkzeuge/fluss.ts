/**
 * River tool: click the course, close it with the check button or a double
 * click, Escape discards it. Moved out of `editorMain.ts` unchanged in
 * behaviour: same clicks, same undo step, same overlay, same messages.
 */
import { F, PFAD, el, feld, stil } from '../design';
import type { KartenWerkzeug, WerkzeugKontext } from './typ';

const TIPP = 'Verlauf klicken; abschließen: ✓-Knopf oder Doppelklick. Esc bricht ab.';

/** A fresh river tool with its own state (course, width, depth). */
export function erzeugeFluss(): KartenWerkzeug<'fluss'> {
  /** Open course; empty when nothing is in progress. */
  let punkte: [number, number][] = [];
  let breite = 40;
  let tiefe = 8;

  const schliessen = (ctx: WerkzeugKontext): void => {
    if (ctx.werkzeugId() !== 'fluss') return;
    const ohneDoppelte = punkte.filter(
      (p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1]![0], p[1] - a[i - 1]![1]) > 1
    );
    if (ohneDoppelte.length < 2) {
      ctx.meldung(`Ein Fluss braucht mindestens 2 Punkte (aktuell ${ohneDoppelte.length}).`, true);
      return;
    }
    const layout = ctx.layout();
    let n = 1;
    while ((layout.rivers ?? []).some((r) => r.id === `fluss-${n}`)) n++;
    ctx.aendere({
      ...layout,
      rivers: [...(layout.rivers ?? []), { id: `fluss-${n}`, points: ohneDoppelte, width: breite, depth: tiefe }],
    });
    punkte = [];
    ctx.zurAuswahl();
    ctx.uebernommen();
    ctx.meldung(`fluss-${n} angelegt (${ohneDoppelte.length} Punkte, ${breite} m breit)`);
  };

  return {
    id: 'fluss',
    titel: 'Fluss zeichnen',
    bild: PFAD.fluss,
    kachelName: 'Fluss',
    kachelTipp: TIPP,
    tasten: [
      ['Klick', 'Punkt'],
      ['Doppelklick', 'schließen'],
      ['Esc', 'abbrechen'],
    ],
    kachelZusatz: () => (punkte.length ? `${punkte.length} P.` : ''),
    hudZusatz: () => `${punkte.length} Punkte · ${breite} m`,

    beiZeigerRunter(ctx, e) {
      punkte.push([Math.round(e.weltX), Math.round(e.weltZ)]);
      ctx.seiteNeuBauen();
      ctx.neuZeichnen();
      return true;
    },
    beiDoppelklick: schliessen,
    beiTaste: (_ctx, e) => e.code === 'Escape',

    zeichneOverlay(ctx, zeichner) {
      if (punkte.length === 0) return;
      zeichner.strokeStyle = F.wasser;
      zeichner.lineWidth = Math.max(2, breite / ctx.massstab());
      zeichner.setLineDash([6, 4]);
      zeichner.beginPath();
      punkte.forEach(([x, z], i) => {
        const [px, py] = ctx.zuBild(x, z);
        if (i === 0) zeichner.moveTo(px, py);
        else zeichner.lineTo(px, py);
      });
      zeichner.stroke();
      zeichner.setLineDash([]);
      zeichner.lineWidth = 1.5;
    },

    abbrechen() {
      punkte = [];
    },

    seitenleiste(ctx, host) {
      const block = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '8px' }));
      const zeile = el('div', stil({ display: 'flex', gap: '8px' }));
      zeile.append(
        feld(
          String(breite),
          (v) => {
            breite = Math.min(400, Math.max(4, Number(v) || breite));
            ctx.seiteNeuBauen();
            ctx.neuZeichnen();
          },
          { mono: true, einheit: 'm', titel: 'Breite in Metern' }
        ),
        feld(
          String(tiefe),
          (v) => {
            tiefe = Math.min(60, Math.max(1, Number(v) || tiefe));
            ctx.seiteNeuBauen();
            ctx.neuZeichnen();
          },
          { mono: true, einheit: 'm', titel: 'Tiefe unter der Wasserlinie (m)' }
        )
      );
      block.appendChild(host.beschriftet('Breite / Tiefe', zeile));
      if (punkte.length >= 2) {
        block.appendChild(
          host.breiterKnopf(`Fluss abschließen (${punkte.length} Punkte)`, () => schliessen(ctx), PFAD.haken)
        );
      }
      block.appendChild(host.hinweis(TIPP));
      return block;
    },
  };
}
