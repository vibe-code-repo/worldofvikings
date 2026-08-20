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
 * Aus demselben Grund trägt die Kopfzeile hier KEIN Schließkreuz,
 * obwohl der Entwurf für Dialoge eines vorsieht (Export-Dialog): Ein
 * Kreuz verspricht einen Ausgang ohne Entscheidung, und den gibt es
 * bei dieser Frage nicht. Alles andere am Dialog folgt dem Entwurf.
 *
 * ── Warum hier und nicht in Shell.ts ─────────────────────────────────
 * Die Shell ist das LAYOUT-Gerüst mit benannten Andockplätzen; alles
 * darin ist Teil des Editorfensters. Ein Vorhang ist das Gegenteil: Er
 * legt sich über das Fenster und gehört keinem Andockplatz an. Ihn in
 * die Shell zu ziehen hiesse, ihr eine zweite Aufgabe zu geben.
 *
 * ── Gestaltung ───────────────────────────────────────────────────────
 * Farben, Maße und Bedienelemente kommen ausschließlich aus
 * `design.ts`; literale Farbwerte sind hier ein Fehler. Einzige
 * Ausnahme ist der Schlagschatten der Tafel — `F` führt bewusst keine
 * Schattentöne.
 */
import {
  F,
  M,
  SCHRIFT,
  beiUeberfahren,
  beschriftungStil,
  el,
  grundregelnEinhaengen,
  knopf,
  stil,
  zierTitel,
} from './design';
import type { Unterschied } from './weltdokument';

/** Eine Antwortmöglichkeit. `id` ist das, was `frage()` auflöst. */
export interface Wahl {
  id: string;
  text: string;
  /** Zweite Zeile im Knopf — die FOLGE der Wahl, nicht ihre Wiederholung. */
  hinweis?: string;
  /** Hervorgehoben (Bronze — die Handlungsfarbe). Höchstens einer. */
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

/** Vorhang mit Weichzeichner — wie jede Überlagerung des Entwurfs. */
function huelle(): HTMLDivElement {
  return el(
    'div',
    stil({
      position: 'fixed',
      inset: '0',
      'z-index': String(Z),
      display: 'grid',
      'place-items': 'center',
      background: F.vorhang,
      'backdrop-filter': 'blur(3px)',
      'font-family': SCHRIFT.text,
      color: F.text,
      'font-size': '13px',
    })
  );
}

function tafel(breite = 720): HTMLDivElement {
  return el(
    'div',
    stil({
      'max-width': `${breite}px`,
      width: 'calc(100% - 48px)',
      'max-height': 'calc(100vh - 48px)',
      // Die Tafel selbst rollt NICHT — sonst wanderten Kopf- und
      // Fußzeile mit. Gerollt wird der Inhalt dazwischen (s. frage).
      display: 'flex',
      'flex-direction': 'column',
      background: F.flaeche,
      border: `1px solid ${F.randKnopf}`,
      'border-radius': '12px',
      'box-shadow': '0 30px 80px rgba(0,0,0,.6)',
      overflow: 'hidden',
    })
  );
}

/**
 * Ladevorhang. Blockiert die Bedienung, solange der Serverstand noch
 * unterwegs ist — sonst zeichnet jemand eine Insel in ein Dokument,
 * das eine halbe Sekunde später ersetzt wird.
 */
export function vorhang(text: string): { text: (t: string) => void; schliessen: () => void } {
  grundregelnEinhaengen();
  const h = huelle();
  const t = tafel(420);
  const zeile = el(
    'div',
    stil({ display: 'flex', 'align-items': 'center', gap: '11px', padding: '18px 20px' })
  );
  // Der pulsierende Punkt ist die einzige Bewegung im Bild — er sagt
  // „es läuft noch", ohne einen Fortschritt zu behaupten, den niemand
  // kennt (die Antwortgröße steht vorher nicht fest).
  const punkt = el(
    'span',
    stil({ width: '8px', height: '8px', 'border-radius': '50%', background: F.akzentLicht, flex: 'none' })
  );
  punkt.className = 'wov-puls';
  const schrift = el('span', stil({ 'font-size': '13.5px', color: F.textHell, 'letter-spacing': '.02em' }), text);
  zeile.append(punkt, schrift);
  t.appendChild(zeile);
  h.appendChild(t);
  document.body.appendChild(h);
  return {
    text: (neu: string) => {
      schrift.textContent = neu;
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
    // Bildlaufleisten und Textmarkierung des Entwurfs — mehrfaches
    // Einhängen ist unschädlich (die Funktion prüft auf ihre eigene ID).
    grundregelnEinhaengen();
    const h = huelle();
    const t = tafel();

    // Kopfzeile im Zierschnitt — ohne Schließkreuz, s. Kopf der Datei.
    const kopf = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        padding: '16px 18px',
        'border-bottom': `1px solid ${F.randLeise}`,
        flex: 'none',
      })
    );
    kopf.appendChild(zierTitel(titel, 15));
    t.appendChild(kopf);

    const inhalt = el(
      'div',
      stil({
        padding: '18px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '14px',
        flex: '1 1 auto',
        'min-height': '0',
        'overflow-y': 'auto',
      })
    );
    t.appendChild(inhalt);

    if (typeof koerper === 'string') {
      inhalt.appendChild(
        el(
          'div',
          stil({ 'font-size': '13px', 'line-height': '1.6', 'white-space': 'pre-wrap', color: F.textRuhig }),
          koerper
        )
      );
    } else {
      inhalt.appendChild(koerper);
    }

    // Fußzeile: die Antworten. Sie bleiben zweizeilige Karten (Text plus
    // Folge) — der Entwurf zeigt einzeilige Knöpfe, aber die zweite Zeile
    // trägt hier die eigentliche Auskunft („was wird dabei weggeworfen").
    // Bronze bekommt genau die betonte Wahl; die überschreibende Wahl
    // trägt den Warnrand.
    const leiste = el(
      'div',
      stil({
        display: 'flex',
        'flex-wrap': 'wrap',
        'align-items': 'stretch',
        gap: '8px',
        padding: '14px 18px',
        'border-top': `1px solid ${F.randLeise}`,
        background: F.spalte,
        flex: 'none',
      })
    );
    t.appendChild(leiste);

    const wahlKnopf = (w: Wahl): HTMLButtonElement => {
      const bronze = !!w.betont;
      const k = el(
        'button',
        stil({
          flex: '1 1 220px',
          'text-align': 'left',
          padding: '10px 13px',
          cursor: 'pointer',
          'font-family': 'inherit',
          background: bronze ? F.akzent : w.warnung ? 'transparent' : F.erhoben,
          border: `1px solid ${bronze ? F.akzentHell : w.warnung ? F.warnRand : F.randKnopf}`,
          'border-radius': `${M.radius}px`,
          color: bronze ? F.aufAkzent : F.text,
        })
      );
      k.appendChild(
        el(
          'div',
          stil({
            'font-size': '13px',
            'font-weight': bronze ? '600' : '500',
            color: bronze ? F.aufAkzent : w.warnung ? F.warnText : F.textHell,
          }),
          w.text
        )
      );
      if (w.hinweis) {
        k.appendChild(
          el(
            'div',
            stil({
              'font-size': '11px',
              'line-height': '1.45',
              'margin-top': '3px',
              // Auf Bronze bleibt die dunkle Schrift lesbar; auf den
              // ruhigen Flächen ist die Folge bewusst leiser als die Wahl.
              color: bronze ? F.aufAkzent : F.gedimmt,
            }),
            w.hinweis
          )
        );
      }
      if (bronze) beiUeberfahren(k, { background: F.akzentHell });
      else beiUeberfahren(k, { 'border-color': w.warnung ? F.fehler : F.randAktiv });
      k.onclick = () => {
        h.remove();
        aufloesen(w.id);
      };
      return k;
    };
    for (const w of wahlen) leiste.appendChild(wahlKnopf(w));

    if (neben) {
      // Löst BEWUSST nicht auf: „Entwurf sichern" ist eine Vorsichts-
      // massnahme vor der Entscheidung, keine Entscheidung. Deshalb leise
      // — es ist keine Antwort auf die Frage.
      const n = knopf(neben.text, () => neben.tun(), { art: 'leise' });
      n.style.flex = '0 0 auto';
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

/**
 * Gegenüberstellung Server ↔ Entwurf als Tabelle.
 *
 * Die Werte stehen in Mono: Sie sind Gemessenes (Zeitpunkte, Anzahlen,
 * Namen), und im Editor trägt alles Gemessene die Mono-Schrift — so
 * stehen die beiden Spalten Ziffer unter Ziffer und der Unterschied
 * springt ins Auge.
 */
export function unterschiedsTafel(
  einleitung: string,
  serverKopf: string,
  entwurfKopf: string,
  zeilen: readonly Unterschied[]
): HTMLElement {
  const wurzel = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '12px' }));

  wurzel.appendChild(
    el(
      'div',
      stil({ 'font-size': '13px', 'line-height': '1.6', 'white-space': 'pre-wrap', color: F.textRuhig }),
      einleitung
    )
  );

  const tab = el('table', stil({ width: '100%', 'border-collapse': 'collapse', 'font-size': '12px' }));
  const kopf = document.createElement('tr');
  for (const [txt, breite, rechts] of [
    ['', '34%', false],
    [serverKopf, '33%', true],
    [entwurfKopf, '33%', true],
  ] as const) {
    const th = el(
      'th',
      beschriftungStil() +
        stil({
          width: breite,
          'text-align': rechts ? 'right' : 'left',
          padding: '6px 8px',
          'border-bottom': `1px solid ${F.rand}`,
          'font-weight': '400',
        }),
      txt
    );
    kopf.appendChild(th);
  }
  tab.appendChild(kopf);

  for (const z of zeilen) {
    const tr = document.createElement('tr');
    if (z.art === 'hinweis') {
      const td = el(
        'td',
        stil({
          padding: '6px 8px',
          'border-bottom': `1px solid ${F.randLeise}`,
          'font-size': '11px',
          color: z.schwer ? F.fehler : F.gedimmt,
        }),
        z.text
      );
      td.colSpan = 3;
      tr.appendChild(td);
    } else {
      const zellen: [string, boolean][] = [
        [z.feld, false],
        [z.server, true],
        [z.entwurf, true],
      ];
      for (const [txt, rechts] of zellen) {
        tr.appendChild(
          el(
            'td',
            stil({
              padding: '6px 8px',
              'border-bottom': `1px solid ${F.randLeise}`,
              'text-align': rechts ? 'right' : 'left',
              'font-family': rechts ? SCHRIFT.mono : 'inherit',
              color: z.schwer ? F.fehler : rechts ? F.textHell : F.textRuhig,
            }),
            txt
          )
        );
      }
    }
    tab.appendChild(tr);
  }
  wurzel.appendChild(tab);
  return wurzel;
}
