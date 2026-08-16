/**
 * Modale Rückfrage und Ladevorhang des Editors.
 *
 * ── Warum überhaupt modal ────────────────────────────────────────────
 * Der Editor meldet sonst alles in der Statusleiste (Shell.meldung),
 * und das ist für Meldungen auch richtig: Sie verschwinden nach sechs
 * Sekunden, weil sie nichts kosten, wenn man sie übersieht. Die Frage
 * „Serverstand oder dein Entwurf?" darf man aber nicht übersehen —
 * jede der beiden Antworten wirft etwas weg. Ein Hinweis, den man
 * wegklicken kann, indem man ihn ignoriert, wäre genau der stille
 * Automatismus, den dieser Umbau abschaffen soll.
 *
 * Deshalb: Vollflächiger Vorhang, der die Werkzeugleiste MIT abdeckt
 * (er hängt an `document.body`, nicht im Shell-Viewport), und ein
 * Versprechen, das erst mit einem Klick auflöst. Kein Esc-Ausweg und
 * kein Standardknopf beim Wegklicken — es gibt keine Wahl, die
 * „nichts tun" bedeutet.
 *
 * ── Warum hier und nicht in Shell.ts ─────────────────────────────────
 * Die Shell ist das LAYOUT-Gerüst mit benannten Andockplätzen; alles
 * darin ist Teil des Editorfensters. Ein Vorhang ist das Gegenteil: Er
 * legt sich über das Fenster und gehört keinem Andockplatz an. Ihn in
 * die Shell zu ziehen hiesse, ihr eine zweite Aufgabe zu geben.
 */
import { THEME } from './Shell';
import type { Unterschied } from './weltdokument';

/** Eine Antwortmöglichkeit. `id` ist das, was `frage()` auflöst. */
export interface Wahl {
  id: string;
  text: string;
  /** Zweite Zeile im Knopf — die FOLGE der Wahl, nicht ihre Wiederholung. */
  hinweis?: string;
  /** Hervorgehoben (Rahmen in Akzentfarbe). Höchstens einer. */
  betont?: boolean;
  /** Warnfarbe — für die Wahl, die etwas überschreibt. */
  warnung?: boolean;
}

/** Ein Knopf, der NICHT auflöst (z. B. „vorher sichern"). */
export interface Nebenaktion {
  text: string;
  tun: () => void;
}

const Z = 9000;

function huelle(): HTMLDivElement {
  const h = document.createElement('div');
  h.style.cssText =
    `position:fixed;inset:0;z-index:${Z};display:flex;align-items:center;justify-content:center;` +
    'background:rgba(4,6,10,0.78);backdrop-filter:blur(2px);font-family:Georgia,serif;';
  return h;
}

function tafel(breite = 720): HTMLDivElement {
  const t = document.createElement('div');
  t.style.cssText =
    `max-width:${breite}px;width:calc(100% - 48px);max-height:calc(100vh - 48px);overflow-y:auto;` +
    `background:${THEME.flaeche};border:1px solid ${THEME.rand};border-radius:4px;` +
    `color:${THEME.text};padding:18px 20px;box-shadow:0 12px 48px rgba(0,0,0,0.6);`;
  return t;
}

/**
 * Ladevorhang. Blockiert die Bedienung, solange der Serverstand noch
 * unterwegs ist — sonst zeichnet jemand eine Insel in ein Dokument,
 * das eine halbe Sekunde später ersetzt wird.
 */
export function vorhang(text: string): { text: (t: string) => void; schliessen: () => void } {
  const h = huelle();
  const zeile = document.createElement('div');
  zeile.textContent = text;
  zeile.style.cssText = `color:${THEME.akzent};font-size:15px;letter-spacing:0.02em;`;
  h.appendChild(zeile);
  document.body.appendChild(h);
  return {
    text: (t: string) => {
      zeile.textContent = t;
    },
    schliessen: () => h.remove(),
  };
}

/**
 * Modale Frage. Löst mit der `id` der gewählten Antwort auf.
 *
 * `koerper` darf ein fertiges Element sein (die Gegenüberstellung baut
 * `unterschiedsTafel`) oder schlichter Text.
 */
export function frage(
  titel: string,
  koerper: HTMLElement | string,
  wahlen: readonly Wahl[],
  neben?: Nebenaktion
): Promise<string> {
  return new Promise((aufloesen) => {
    const h = huelle();
    const t = tafel();

    const kopf = document.createElement('div');
    kopf.textContent = titel;
    kopf.style.cssText = `font-size:18px;color:${THEME.akzent};margin-bottom:10px;`;
    t.appendChild(kopf);

    if (typeof koerper === 'string') {
      const p = document.createElement('div');
      p.textContent = koerper;
      p.style.cssText = 'font-size:13px;line-height:1.6;white-space:pre-wrap;';
      t.appendChild(p);
    } else {
      t.appendChild(koerper);
    }

    const leiste = document.createElement('div');
    leiste.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;';
    t.appendChild(leiste);

    const knopf = (w: Wahl): HTMLButtonElement => {
      const k = document.createElement('button');
      const rand = w.warnung ? THEME.fehler : w.betont ? THEME.akzent : THEME.rand;
      k.style.cssText =
        `flex:1 1 220px;text-align:left;padding:8px 12px;cursor:pointer;font-family:inherit;` +
        `background:${THEME.feld};color:${THEME.text};border:1px solid ${rand};border-radius:3px;` +
        `font-size:13px;line-height:1.4;`;
      const oben = document.createElement('div');
      oben.textContent = w.text;
      oben.style.cssText = `color:${w.warnung ? THEME.fehler : THEME.akzent};`;
      k.appendChild(oben);
      if (w.hinweis) {
        const unten = document.createElement('div');
        unten.textContent = w.hinweis;
        unten.style.cssText = `color:${THEME.gedimmt};font-size:11px;margin-top:2px;`;
        k.appendChild(unten);
      }
      k.onclick = () => {
        h.remove();
        aufloesen(w.id);
      };
      return k;
    };
    for (const w of wahlen) leiste.appendChild(knopf(w));

    if (neben) {
      const n = document.createElement('button');
      n.textContent = neben.text;
      n.style.cssText =
        `flex:0 0 auto;padding:8px 12px;cursor:pointer;font-family:inherit;font-size:12px;` +
        `background:transparent;color:${THEME.gedimmt};border:1px dashed ${THEME.rand};border-radius:3px;`;
      // Löst BEWUSST nicht auf: „Entwurf sichern" ist eine Vorsichts-
      // massnahme vor der Entscheidung, keine Entscheidung.
      n.onclick = () => neben.tun();
      leiste.appendChild(n);
    }

    h.appendChild(t);
    document.body.appendChild(h);
    // Fokus auf die hervorgehobene Wahl, damit die Tastatur sofort im
    // Dialog ist — sonst liefen Strg+Z & Co. weiter an den Editor.
    const zuerst = leiste.querySelector<HTMLButtonElement>('button');
    zuerst?.focus();
  });
}

/** Gegenüberstellung Server ↔ Entwurf als Tabelle. */
export function unterschiedsTafel(
  einleitung: string,
  serverKopf: string,
  entwurfKopf: string,
  zeilen: readonly Unterschied[]
): HTMLElement {
  const wurzel = document.createElement('div');

  const text = document.createElement('div');
  text.textContent = einleitung;
  text.style.cssText = 'font-size:13px;line-height:1.6;white-space:pre-wrap;margin-bottom:12px;';
  wurzel.appendChild(text);

  const tab = document.createElement('table');
  tab.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
  const kopf = document.createElement('tr');
  for (const [txt, breite, rechts] of [
    ['', '34%', false],
    [serverKopf, '33%', true],
    [entwurfKopf, '33%', true],
  ] as const) {
    const th = document.createElement('th');
    th.textContent = txt;
    th.style.cssText =
      `width:${breite};text-align:${rechts ? 'right' : 'left'};padding:4px 8px;` +
      `border-bottom:1px solid ${THEME.rand};color:${THEME.akzent};font-weight:normal;`;
    kopf.appendChild(th);
  }
  tab.appendChild(kopf);

  for (const z of zeilen) {
    const tr = document.createElement('tr');
    if (z.art === 'hinweis') {
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = z.text;
      td.style.cssText =
        `padding:4px 8px;border-bottom:1px solid ${THEME.rand};font-size:11px;` +
        `color:${z.schwer ? THEME.fehler : THEME.gedimmt};`;
      tr.appendChild(td);
    } else {
      const zellen: [string, boolean][] = [
        [z.feld, false],
        [z.server, true],
        [z.entwurf, true],
      ];
      for (const [txt, rechts] of zellen) {
        const td = document.createElement('td');
        td.textContent = txt;
        td.style.cssText =
          `padding:4px 8px;border-bottom:1px solid ${THEME.rand};` +
          `text-align:${rechts ? 'right' : 'left'};` +
          `font-family:${rechts ? 'ui-monospace,monospace' : 'inherit'};` +
          `color:${z.schwer ? THEME.fehler : THEME.text};`;
        tr.appendChild(td);
      }
    }
    tab.appendChild(tr);
  }
  wurzel.appendChild(tab);
  return wurzel;
}
