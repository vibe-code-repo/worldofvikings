/**
 * Lake tool: one click sets the centre and creates the lake at once (radius
 * and depth from the sidebar); Shift keeps the tool active for a series.
 * Moved out of `editorMain.ts` unchanged in behaviour.
 *
 * A lake is centre + radius (`LakeDef`), not a course like a river: there is
 * no half-finished stroke, so `abbrechen` has nothing to discard. The
 * defaults are the ones `sanitizeWorldLayout` gives a lake without values
 * (radius 200, depth 8), so a lake set with the fields untouched equals what
 * the sanitising would assume anyway.
 */
import { PFAD, el, feld, stil } from '../design';
import type { KartenWerkzeug } from './typ';

const TIPP = 'Klick setzt den Mittelpunkt und legt den See sofort an. Shift für Serien.';

/** A fresh lake tool with its own state (radius, depth). */
export function erzeugeSee(): KartenWerkzeug<'see'> {
  let radius = 200;
  let tiefe = 8;

  return {
    id: 'see',
    titel: 'See setzen',
    bild: PFAD.see,
    kachelName: 'See',
    kachelTipp: TIPP,
    tasten: [
      ['Klick', 'setzen'],
      ['Shift', 'Serie'],
    ],
    kachelZusatz: () => `${radius} m`,
    hudZusatz: () => `Radius ${radius} m`,

    beiZeigerRunter(ctx, e) {
      const layout = ctx.layout();
      let n = 1;
      while ((layout.lakes ?? []).some((l) => l.id === `see-${n}`)) n++;
      ctx.aendere({
        ...layout,
        lakes: [
          ...(layout.lakes ?? []),
          { id: `see-${n}`, x: Math.round(e.weltX), z: Math.round(e.weltZ), radius, depth: tiefe },
        ],
      });
      if (!e.shiftKey) ctx.zurAuswahl();
      ctx.uebernommen();
      ctx.meldung(
        e.shiftKey
          ? `see-${n} angelegt (Radius ${radius} m) — Werkzeug bleibt aktiv (Shift)`
          : `see-${n} angelegt (Radius ${radius} m)`
      );
      return true;
    },

    abbrechen() {
      // Nothing half-finished: a lake is created by one click.
    },

    seitenleiste(ctx, host) {
      const block = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '8px' }));
      const zeile = el('div', stil({ display: 'flex', gap: '8px' }));
      zeile.append(
        feld(
          String(radius),
          (v) => {
            radius = Math.min(5000, Math.max(8, Number(v) || radius));
            ctx.seiteNeuBauen();
          },
          { mono: true, einheit: 'm', titel: 'Radius in Metern' }
        ),
        feld(
          String(tiefe),
          (v) => {
            tiefe = Math.min(60, Math.max(1, Number(v) || tiefe));
            ctx.seiteNeuBauen();
          },
          { mono: true, einheit: 'm', titel: 'Tiefe unter der Wasserlinie (m)' }
        )
      );
      block.appendChild(host.beschriftet('Radius / Tiefe', zeile));
      block.appendChild(host.hinweis(TIPP));
      return block;
    },
  };
}
