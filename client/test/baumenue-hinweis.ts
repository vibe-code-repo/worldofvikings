/**
 * Wächter für den Baumenü-Hinweis.
 *
 * Geprüft wird die Fallunterscheidung, nicht der Wortlaut: Ob der Satz
 * „Nimm den Hammer in die Hand" heisst oder anders, ist Geschmack — dass
 * er ÜBERHAUPT kommt und den richtigen Fall trifft, ist die Zusage.
 *
 * Der teure Fall ist der letzte Block: Sobald Bauteile da sind, muss die
 * Funktion `null` liefern. Eine Meldung, die auch dann erscheint, wenn
 * alles in Ordnung ist, wird binnen eines Tages weggeklickt und danach
 * ignoriert — und dann hilft sie auch in dem Fall nicht mehr, für den
 * sie gebaut wurde.
 */
import { baumenueHinweis } from '../src/player/BaumenueHinweis.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Baumenü-Hinweis');

// ── 1. Alles in Ordnung: kein Hinweis ────────────────────────────────
{
  const h = baumenueHinweis({ bauteile: 3, gehalten: 'Hammer', werkzeugImInventar: true });
  pruefe(h === null, `bei vorhandenen Bauteilen kam ein Hinweis: ${h}`);
  // Auch wenn sonst alles fehlt — Bauteile schlagen alles.
  pruefe(
    baumenueHinweis({ bauteile: 1, gehalten: null, werkzeugImInventar: false }) === null,
    'Bauteile vorhanden, trotzdem Hinweis'
  );
}

// ── 2. Hand leer, Werkzeug im Inventar ───────────────────────────────
{
  const h = baumenueHinweis({ bauteile: 0, gehalten: null, werkzeugImInventar: true });
  pruefe(h !== null, 'kein Hinweis bei leerer Hand');
  pruefe(/in die Hand/.test(h ?? ''), `Hinweis nennt nicht das In-die-Hand-Nehmen: ${h}`);
  pruefe(/1.{0,3}8/.test(h ?? ''), `Hinweis nennt die Hotbar-Ziffern nicht: ${h}`);
}

// ── 3. Falsches Werkzeug in der Hand ─────────────────────────────────
{
  const h = baumenueHinweis({ bauteile: 0, gehalten: 'AxeFlint', werkzeugImInventar: true });
  pruefe(h !== null, 'kein Hinweis bei falschem Werkzeug');
  pruefe(
    (h ?? '').includes('AxeFlint'),
    `Hinweis nennt das gehaltene Werkzeug nicht: ${h}`
  );
  pruefe(/in die Hand/.test(h ?? ''), `Hinweis sagt nicht, was zu tun ist: ${h}`);
}

// ── 4. Gar kein Bauwerkzeug vorhanden ────────────────────────────────
{
  const leer = baumenueHinweis({ bauteile: 0, gehalten: null, werkzeugImInventar: false });
  pruefe(leer !== null, 'kein Hinweis ohne Werkzeug');
  pruefe(
    !/in die Hand/.test(leer ?? ''),
    `fordert zum Greifen auf, obwohl nichts da ist: ${leer}`
  );

  const falsch = baumenueHinweis({ bauteile: 0, gehalten: 'Hoe', werkzeugImInventar: false });
  pruefe(falsch !== null, 'kein Hinweis bei falschem Werkzeug ohne Hammer');
  pruefe((falsch ?? '').includes('Hoe'), `nennt das gehaltene Werkzeug nicht: ${falsch}`);
}

// ── 5. Die vier Fälle liefern vier VERSCHIEDENE Sätze ────────────────
// Sonst hilft die Unterscheidung dem Spieler nicht.
{
  const saetze = [
    baumenueHinweis({ bauteile: 0, gehalten: null, werkzeugImInventar: true }),
    baumenueHinweis({ bauteile: 0, gehalten: 'X', werkzeugImInventar: true }),
    baumenueHinweis({ bauteile: 0, gehalten: null, werkzeugImInventar: false }),
    baumenueHinweis({ bauteile: 0, gehalten: 'X', werkzeugImInventar: false }),
  ];
  pruefe(new Set(saetze).size === 4, `erwartet 4 verschiedene Sätze, bekam ${new Set(saetze).size}`);
}

// ── 6. Eigener Werkzeugname wird übernommen ──────────────────────────
{
  const h = baumenueHinweis({
    bauteile: 0,
    gehalten: null,
    werkzeugImInventar: true,
    werkzeugName: 'Bauhammer',
  });
  pruefe((h ?? '').includes('Bauhammer'), `eigener Werkzeugname ignoriert: ${h}`);
}

console.log(fehler === 0 ? '\nOK — alle vier Fälle greifen, kein Hinweis wenn alles passt' : `\n${fehler} FEHLER`);
process.exit(fehler > 0 ? 1 : 0);
