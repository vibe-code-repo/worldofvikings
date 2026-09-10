/**
 * Die Kollisionsform im SERVER — dieselbe Form, ohne Babylon.
 *
 * `KollisionsFormen` liest die GLBs mit dem eigenen Leser
 * (`shared/src/kollision/glb.ts`) und schickt sie durch dieselbe
 * Ableitung, die der Client mit seinen Babylon-Vertexdaten aufruft.
 * Geprüft wird deshalb nicht „ist die Form plausibel", sondern „ist es
 * DIESELBE" — gegen die Zahlen, die `client/test/kollision-formen.ts`
 * auf der anderen Seite misst und die in
 * `shared/test/golden/kollision-formen.json` stehen.
 *
 *  (a) GLEICHHEIT. Für die acht Prüflinge: Kiste und Kapsel bis 1e-4,
 *      Netze über Dreieckszahl und Hüllbox. Läuft das auseinander, steht
 *      der Spieler im Bild vor einem Stein, durch den ihn die
 *      Serverkorrektur zieht — ein Fehler, der wie ein Netzproblem
 *      aussieht und keins ist.
 *
 *  (b) DIE MENGE. `vorladen()` leitet alle festen Prefabs beim
 *      Serverstart ab, nicht beim ersten Schritt eines Spielers. Geprüft
 *      wird, dass dabei überhaupt etwas herauskommt und wie lange es
 *      dauert — eine Vorladung, die im Rauschen verschwindet, ist keine.
 *
 *  (c) OHNE `assets/`. Der Speicher liegt ausserhalb des Repos. Fehlt er,
 *      muss die Quelle LEER sein und nicht abstürzen — und auch nichts
 *      erfinden: Eine ausgedachte Kiste sähe man ihr nicht an.
 *
 *   npx tsx server/test/kollision-formen.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kollisionsForm, storeKollision, type KollisionsForm } from '@wov/shared';
import { leseGlb } from '@wov/shared/src/kollision/glb.js';
import { KollisionsFormen } from '../src/world/KollisionsFormen';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const ASSETS = join(WURZEL, 'assets');
const GOLDEN = join(WURZEL, 'shared/test/golden/kollision-formen.json');

let fehler = 0;
function pruefe(bedingung: boolean, was: string, detail = ''): void {
  if (bedingung) console.log(`  OK   ${was}`);
  else {
    fehler++;
    console.error(`  ROT  ${was}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Golden {
  toleranz: { kisteKapsel: number; netzHuelle: number };
  prefabs: { name: string; modell: string; havok: Record<string, unknown> }[];
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;

function havok(f: KollisionsForm | null): Record<string, unknown> | null {
  if (f === null) return null;
  if (f.art === 'netz') {
    return {
      art: 'netz',
      dreiecke: f.indizes.length / 3,
      min: [f.min.x, f.min.y, f.min.z],
      max: [f.max.x, f.max.y, f.max.z],
    };
  }
  if (f.art === 'kapsel') {
    const h = f.yMax - f.yMin;
    return {
      art: 'kapsel',
      a: [f.x, f.yMin + Math.min(f.radius, h / 2), f.z],
      b: [f.x, f.yMin + Math.max(h - f.radius, f.radius), f.z],
      radius: f.radius,
    };
  }
  return {
    art: 'kiste',
    mitte: [(f.min.x + f.max.x) / 2, (f.min.y + f.max.y) / 2, (f.min.z + f.max.z) / 2],
    masse: [f.max.x - f.min.x, f.max.y - f.min.y, f.max.z - f.min.z],
  };
}

function gleich(a: Record<string, unknown> | null, b: Record<string, unknown> | null, tol: number): boolean {
  if (a === null || b === null) return a === b;
  if (a.art !== b.art) return false;
  for (const k of Object.keys(a)) {
    const x = a[k];
    const y = b[k];
    if (typeof x === 'number' && typeof y === 'number') {
      if (Math.abs(x - y) > tol) return false;
    } else if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (Math.abs((x[i] as number) - (y[i] as number)) > tol) return false;
      }
    } else if (x !== y) return false;
  }
  return true;
}

// ── (c) zuerst: ohne Speicher darf nichts krachen ────────────────────
const leer = new KollisionsFormen(join(WURZEL, 'gibt-es-nicht'));
const leerErgebnis = leer.vorladen();
pruefe(
  leerErgebnis.fest === 0 && leerErgebnis.fehlend > 0,
  `(c) ohne assets/: keine Form, ${leerErgebnis.fehlend} fehlende Datei(en), kein Absturz`,
  JSON.stringify(leerErgebnis)
);
pruefe(
  leer.formFuer('environment-barrel-destructible') === null,
  '(c) ohne assets/ liefert formFuer() null statt einer erfundenen Kiste'
);

if (!existsSync(join(ASSETS, 'store'))) {
  console.error('\nassets/store fehlt — (a) und (b) brauchen den Speicher.');
  process.exit(fehler > 0 ? 1 : 0);
}

// ── (a) Gleichheit mit dem Client ────────────────────────────────────
/*
  Die Ableitung wird hier DIREKT gerufen und nicht über `formFuer()`:
  Zwei der acht Prüflinge sind Vegetation und bekommen als solche gar
  keinen Körper (`istFesterStoreKoerper`). Ihre FORM ist trotzdem die
  Frage — sie steht im Golden, und sie muss auf beiden Seiten dieselbe
  sein, sobald jemand die Bäume fest macht.
*/
for (const p of golden.prefabs) {
  const inhalt = leseGlb(readFileSync(join(ASSETS, `${p.modell}.glb`)));
  const katalog = storeKollision(p.name);
  const netz = katalog?.netz;
  const eigen =
    inhalt.kollision ??
    (netz === undefined
      ? null
      : leseGlb(readFileSync(join(ASSETS, `store/${netz.replace(/\.[^./]+$/, '')}.glb`))).sicht);
  const optionen = { stammartig: false, dungeonRaum: false };
  const form =
    (eigen
      ? kollisionsForm(eigen.positionen, eigen.indizes, p.name, katalog, {
          ...optionen,
          eigenesNetz: true,
        })
      : null) ??
    (inhalt.sicht
      ? kollisionsForm(inhalt.sicht.positionen, inhalt.sicht.indizes, p.name, katalog, optionen)
      : null);
  const ist = havok(form);
  const tol = form?.art === 'netz' ? golden.toleranz.netzHuelle : golden.toleranz.kisteKapsel;
  pruefe(
    gleich(ist, p.havok, tol),
    `(a) ${p.name}: Node-Leser ergibt die Form des Clients (${String(ist?.art)})`,
    `ist ${JSON.stringify(ist)} / soll ${JSON.stringify(p.havok)}`
  );
}

// ── (b) Vorladen ─────────────────────────────────────────────────────
const quelle = new KollisionsFormen(ASSETS);
const bericht = quelle.vorladen();
console.log(
  `  INFO vorladen(): ${bericht.geladen} Prefabs angesehen, ${bericht.fest} mit Körper, ` +
    `${bericht.fehlend} Datei(en) fehlen, ${bericht.ms} ms`
);
/*
  Die Untergrenze ist kein Selbstzweck: Eine Quelle, die aus einem
  leeren Ordner null Formen macht, macht JEDE folgende Prüfung grün.
  200 ist bewusst weit unter dem gemessenen Stand (235 am 10.09.2026) —
  hier soll „es kommt wirklich etwas heraus" stehen und nicht eine Zahl,
  die beim nächsten neuen Modell nachgezogen werden muss.

  Warum nicht mehr: Von den 454 festen Speicher-Prefabs fallen 61 aus,
  weil ihre Netze durchweg `DefaultMaterial` tragen (AssetRippers
  Platzhalter — der Client blendet sie aus, sie sind also auch im Bild
  nicht da), und weitere über den Namensfilter WEICHE_VEGETATION oder
  weil sie unter MIN_HINDERNISHOEHE bleiben. `fehlend` zählt vor allem
  den ALTBESTAND unter `assets/models/`, der auf dieser Maschine nicht
  liegt.
*/
pruefe(bericht.fest > 200, `(b) mindestens 200 Prefabs haben einen Körper (${bericht.fest})`);
pruefe(bericht.ms < 60000, `(b) die Vorladung bleibt unter einer Minute (${bericht.ms} ms)`);
pruefe(
  quelle.formFuer('environment-barrel-destructible')?.art === 'kiste',
  '(b) das Fass ist danach eine Kiste'
);
pruefe(
  quelle.formFuer('vegetation-tree-1c3') === null,
  '(b) Speicher-Vegetation bekommt keinen Körper — wie im Client'
);
pruefe(
  quelle.formFuer('environment-backdrop-mountains-clear') === null,
  '(b) durch die Bergkulisse läuft man hindurch'
);
pruefe(
  quelle.formFuer('environment-sm-env-rock-cliff-01')?.art === 'netz',
  '(b) der Fels bekommt die exakte Oberfläche, nicht die Katalog-Kiste'
);

console.log(fehler === 0 ? '\nOK — Server und Client sehen dieselben Hindernisse' : `\n${fehler} FEHLER`);
process.exit(fehler > 0 ? 1 : 0);
