/**
 * Wächter für die Hüllen-Schranke des Unterwasser-Passes (Lehre E23).
 *
 * ── Woran das hängt ──────────────────────────────────────────────────
 * `WaterRefraction.gehoertHinein()` entscheidet, was ein zweites Mal
 * gerendert wird. Die feine Auswahl macht `istGestreuteLandschaft` —
 * gesetzt vom EntityManager für alles, was in `FOLIAGE_HASHES` steht.
 * Dahinter liegt {@link huelleZuGross} als Riegel für den Fall, den keine
 * Namensliste kennt: ein Thin-Instance-Master, dessen Hülle ALLE seine
 * Vorkommen umspannt und deshalb die Wasserlinie schneidet, obwohl keine
 * einzige Instanz nass wird. Auf der Referenzinsel zog genau das
 * 36,2 Mio. Laub-Dreiecke in den Pass.
 *
 * Der Fehler ist unsichtbar: Das Bild bleibt richtig, nur die Bildrate
 * fällt. Deshalb ein Test und keine Notiz.
 *
 * Festgehalten wird:
 *  1. Die Schranke selbst — Grenzfälle, entartete Eingaben.
 *  2. Der Bestand: KEIN streubares Store-Prefab kommt der Schranke auch
 *     nur nahe, jede Kulisse liegt darüber. Das ist die Zusage, die die
 *     Zahl 100 überhaupt begründet — läge ein Baum bei 95 m, wäre sie
 *     falsch gewählt.
 */
import { REFRAKTION_MAX_HUELLE, huelleZuGross } from '../src/engine/RefraktionsAuswahl.js';
import { STORE_KATALOG } from '@wov/shared/src/storeKatalogDaten.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

// ── 1. Die Schranke ──────────────────────────────────────────────────
pruefe(!huelleZuGross(REFRAKTION_MAX_HUELLE), 'genau 100 m muss noch hineindürfen');
pruefe(huelleZuGross(REFRAKTION_MAX_HUELLE + 0.001), 'knapp über 100 m muss draussen bleiben');
pruefe(!huelleZuGross(0), 'eine leere Hülle ist nicht zu gross');
pruefe(!huelleZuGross(Number.NaN), 'NaN darf nicht als "zu gross" gelten (Vergleich ist false)');
pruefe(huelleZuGross(Number.POSITIVE_INFINITY), 'eine unendliche Hülle muss draussen bleiben');
pruefe(huelleZuGross(594), 'die Bergkulisse (594 m) muss draussen bleiben');

// ── 2. Der Bestand ───────────────────────────────────────────────────
//
// Kantenlänge aus den `bounds` des Katalogs. Sie stehen im DATEIRAUM, aber
// eine LÄNGE ist von der x-Spiegelung des glTF-Laders unberührt (sie
// klappt das Intervall um, sie staucht es nicht) — für diese Frage ist die
// Umrechnung nach Weltraum also entbehrlich.
const kante = (e: (typeof STORE_KATALOG)[number]): number => {
  const b = e.bounds;
  if (!b) return 0;
  return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
};

const streubar = STORE_KATALOG.filter((e) => e.art === 'modell' && e.platzierbar !== false);
const gesperrt = STORE_KATALOG.filter((e) => e.platzierbar === false);

const zuGross = streubar.filter((e) => huelleZuGross(kante(e)));
pruefe(
  zuGross.length === 0,
  `${zuGross.length} streubare Store-Modelle über ${REFRAKTION_MAX_HUELLE} m: ` +
    zuGross.map((e) => `${e.id} (${kante(e).toFixed(0)} m)`).join(', ')
);

// Der ABSTAND zur Schranke ist die eigentliche Zusage: Sie soll Bestände
// und Kulissen fassen, nie einen Einzelgegenstand. Gemessen ist das
// grösste streubare Modell `environment/sm-env-water-plane-01` mit 50,0 m
// (eine Wasserfläche, kein Gegenstand); das grösste Vegetationsmodell
// liegt bei 25 m. Faktor 1,5 lässt Luft für neue Assets und schlägt an,
// bevor die Schranke etwas Falsches fängt.
const groesstes = streubar.reduce((a, e) => (kante(e) > kante(a) ? e : a), streubar[0]!);
pruefe(
  kante(groesstes) * 1.5 <= REFRAKTION_MAX_HUELLE,
  `das grösste streubare Modell (${groesstes.id}, ${kante(groesstes).toFixed(1)} m) liegt zu nah ` +
    `an der Schranke ${REFRAKTION_MAX_HUELLE} m — die Zahl ist dann nicht mehr begründet`
);

const durchgerutscht = gesperrt.filter((e) => e.bounds && !huelleZuGross(kante(e)) && kante(e) > 0);
pruefe(
  durchgerutscht.every((e) => e.art !== 'modell'),
  'ein gesperrtes MODELL bliebe unter der Schranke: ' +
    durchgerutscht.filter((e) => e.art === 'modell').map((e) => e.id).join(', ')
);

console.log(`  ${streubar.length} streubare Modelle, grösstes ${groesstes.id} ${kante(groesstes).toFixed(1)} m`);
console.log(`  ${gesperrt.length} gesperrte Einträge (Kulissen/Höhenfelder), Schranke ${REFRAKTION_MAX_HUELLE} m`);
console.log(
  fehler === 0
    ? '\nOK — Schranke greift an den Rändern, kein streubares Modell kommt ihr nahe'
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
