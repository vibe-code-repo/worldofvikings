/**
 * Small builders of the editor sidebar (wide button, hint line, labelled control) and
 * the `SeitenHost` a registered tool gets for its sidebar block.
 *
 * Load order: `editorMain.ts` imports this module, so it is evaluated BEFORE the two
 * registry awaits at the top of `editorMain.ts`. Nothing here may read a registry
 * while the module loads; values are imported from `../design` only.
 */
import type { SeitenHost } from '../werkzeuge/typ';
import { F, M, beschriftungStil, el, knopf, stil } from '../design';

/**
 * Vollbreiter Knopf der Seitenleiste.
 *
 * Früher trug er seine Farben selbst ('#1d2431' auf '#3a3325'), jetzt
 * ist er der `knopf()` aus design.ts — nur auf Blockbreite gezogen. Die
 * Leiste ist 332 px schmal, und die Bewuchs-Bündel tragen lange
 * Beschriftungen („Mischwald (dichte und lichte Zonen)"); nebeneinander
 * wären sie nicht lesbar.
 */
function breiterKnopf(text: string, cb: () => void, pfad?: string): HTMLButtonElement {
  const b = knopf(text, cb, { hoehe: M.knopfHoeheKlein, pfad });
  b.style.width = '100%';
  b.style.fontSize = '12px';
  // Kein eigener `margin`: Die Behälter setzen ihren Abstand per `gap`
  // (die Shell-Sektion tut es auch). Beides zusammen addierte sich sonst
  // sichtbar auf.
  return b;
}

/** Hinweiszeile unter einem Werkzeug — was der nächste Klick bewirkt. */
const hinweisZeile = (text: string): HTMLDivElement =>
  el('div', stil({ 'font-size': '11px', 'line-height': '1.5', color: F.gedimmt }), text);

/** Die Bausteine, die ein registriertes Werkzeug für seinen Seitenleisten-Block bekommt. */
const seitenHost: SeitenHost = {
  hinweis: hinweisZeile,
  beschriftet: (text, inhalt) => beschriftet(text, inhalt),
  breiterKnopf: (text, cb, pfad) => breiterKnopf(text, cb, pfad),
};

/** Beschriftung im Entwurfsstil über einem Bedienelement. */
function beschriftet(text: string, inhalt: HTMLElement): HTMLDivElement {
  const s = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '5px' }));
  s.append(el('span', beschriftungStil(), text), inhalt);
  return s;
}

export { breiterKnopf, hinweisZeile, seitenHost };
