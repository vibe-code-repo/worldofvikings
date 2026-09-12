/**
 * Hält die aufbereitete Store-Vegetation gegen den Store fest — die
 * Plattenseite der Store-Flora.
 *
 * Die TABELLE prüft `tools/test/store-flora.ts` — Namen, Biome,
 * Landschaft. Hier geht es um die Dateien, die aus dem Store werden, und
 * um zwei Fehlerarten, die sonst LAUTLOS blieben:
 *
 *  (a) IDEMPOTENZ. `tools/store-vegetation-aufbereiten.mjs` läuft zweimal
 *      in denselben Ordner und muss beim zweiten Mal Byte für Byte
 *      dasselbe schreiben. Ein Werkzeug, das bei jedem Lauf ein anderes
 *      Ergebnis liefert, macht jede spätere Messung unvergleichbar — und
 *      man merkt es erst, wenn zwei Messungen nicht zusammenpassen.
 *
 *  (b) DIE AUFBEREITUNG SELBST. Kein Modell führt nach dem Lauf noch ein
 *      `DefaultMaterial`, jedes Material hat eine auflösbare Textur, und
 *      jedes LAUBMATERIAL trägt einen Tönungsfaktor. Das ist der Punkt
 *      des ganzen Werkzeugs: Ein ungetöntes Laubmaterial rendert GRAU,
 *      weil die Atlanten Helligkeitsmasken sind (gemessen 0,452/0,452/
 *      0,452) — und grau sieht nicht nach Fehler aus, sondern nach
 *      Herbst.
 *
 * WEICHE: Fehlt `assets/store` GANZ, überspringt `scripts/run-tests.mjs`
 * diesen Test (`brauchtModelle('assets/store')`). Fehlt eine EINZELNE
 * Datei, wird er rot — die Sonde entscheidet nie selbst, ob sie laufen
 * darf (siehe scripts/testweichen.mjs).
 *
 *   npx tsx tools/test/store-vegetation.ts
 */
import { readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const STORE = join(WURZEL, 'assets/store');
const VEGETATION = join(STORE, 'vegetation');
const PREFABS = join(STORE, 'prefabs.json');
const WERKZEUG = join(WURZEL, 'tools/store-vegetation-aufbereiten.mjs');
const PROBE_ZIEL = join(WURZEL, 'tools/test/tmp-store-vegetation');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── Voraussetzungen ──────────────────────────────────────────────────
check('assets/store/prefabs.json existiert', existsSync(PREFABS));
check('assets/store/vegetation/ existiert', existsSync(VEGETATION));
if (fehler > 0) {
  console.error('\nOhne den Store lässt sich nichts prüfen — Weiche in run-tests.mjs.');
  process.exit(1);
}

/*
  Die Sollzahl kommt aus prefabs.json, nicht aus einer Konstante hier:
  Kommt ein Modell in den Store, soll der Test mitwachsen — und nicht
  erst dann rot werden, wenn jemand die 94 von Hand hochzählt.
*/
type StorePrefab = { id: string; asset: string };
const prefabs: StorePrefab[] = JSON.parse(readFileSync(PREFABS, 'utf8')).prefabs;

// ── (a) Idempotenz ───────────────────────────────────────────────────
/*
  Zweimal in DENSELBEN Ordner, nicht in zwei verschiedene: Das Werkzeug
  räumt sein Ziel vor jedem Lauf leer, und genau dieses Aufräumen soll
  mitgeprüft werden. Eine Leiche aus dem ersten Lauf fiele bei einem
  Vergleich zweier frischer Ordner nicht auf.
*/
function ordnerFingerabdruck(pfad: string): string[] {
  const zeilen: string[] = [];
  const gehe = (ort: string): void => {
    for (const name of readdirSync(ort).sort()) {
      const voll = join(ort, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else zeilen.push(`${relative(pfad, voll)} ${createHash('sha256').update(readFileSync(voll)).digest('hex')}`);
    }
  };
  gehe(pfad);
  return zeilen;
}

function lauf(): void {
  /*
    Mit `tsx` und nicht mit `node`: Das Werkzeug liest die Farben des
    Vorbilds seit dem 12.09.2026 aus `shared/src/laubSpitzen.ts`, damit
    Aufbereitung und Client nicht zwei Tabellen mit denselben Zahlen
    pflegen. Reines `node` kann die Datei nicht laden — dieselbe Zeile
    steht in `package.json` unter `store:aufbereiten`.
  */
  const ergebnis = spawnSync(join(WURZEL, 'node_modules/.bin/tsx'), [WERKZEUG, '--ziel', relative(WURZEL, PROBE_ZIEL)], {
    cwd: WURZEL,
    encoding: 'utf8',
  });
  if (ergebnis.status !== 0) {
    throw new Error(`Werkzeug brach ab (${ergebnis.status}): ${ergebnis.stderr ?? ''}`);
  }
}

rmSync(PROBE_ZIEL, { recursive: true, force: true });
let ersterLauf: string[] = [];
let zweiterLauf: string[] = [];
try {
  lauf();
  ersterLauf = ordnerFingerabdruck(PROBE_ZIEL);
  lauf();
  zweiterLauf = ordnerFingerabdruck(PROBE_ZIEL);
} catch (err) {
  check('tools/store-vegetation-aufbereiten.mjs läuft durch', false, String(err));
}

const sollGlb = prefabs.filter((p) => p.asset.startsWith('vegetation/')).length;
const istGlb = ersterLauf.filter((z) => z.split(' ')[0].endsWith('.glb')).length;
check(
  `Aufbereitung erzeugt alle ${sollGlb} GLB des Stores`,
  istGlb === sollGlb,
  `gezählt: ${istGlb}`
);
check(
  'Aufbereitung schreibt BERICHT.json',
  ersterLauf.some((z) => z.startsWith('BERICHT.json '))
);
const abweichung = ersterLauf.filter((z, i) => z !== zweiterLauf[i]);
check(
  'zweiter Lauf ist byteidentisch (Idempotenz)',
  ersterLauf.length > 0 && ersterLauf.length === zweiterLauf.length && abweichung.length === 0,
  abweichung.slice(0, 5).join(' | ')
);

// ── (b) Die Aufbereitung selbst ──────────────────────────────────────
/*
  Gelesen wird das Ergebnis, nicht der Quelltext des Werkzeugs: Ein Test,
  der die Regeln des Werkzeugs nachbaut, prüft nur, ob zwei Kopien
  derselben Regel übereinstimmen.
*/
type GlbJson = {
  materials: {
    name: string;
    alphaMode?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number };
    };
  }[];
  textures: { source: number }[];
  images: { uri?: string }[];
};

function glbJson(pfad: string): GlbJson {
  const buf = readFileSync(pfad);
  return JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
}

const mitDefault: string[] = [];
const ohneTextur: string[] = [];
const ungetoentesLaub: string[] = [];
const fehlendesBild: string[] = [];
const masterZaehler = new Map<number, number>();
if (ersterLauf.length > 0) {
  for (const datei of readdirSync(PROBE_ZIEL).filter((d) => d.endsWith('.glb')).sort()) {
    const json = glbJson(join(PROBE_ZIEL, datei));
    masterZaehler.set(json.materials.length, (masterZaehler.get(json.materials.length) ?? 0) + 1);
    for (const mat of json.materials) {
      if (/^DefaultMaterial$/i.test(mat.name)) mitDefault.push(`${datei}:${mat.name}`);
      const ti = mat.pbrMetallicRoughness?.baseColorTexture?.index;
      if (ti === undefined || json.textures[ti] === undefined) {
        ohneTextur.push(`${datei}:${mat.name}`);
        continue;
      }
      const uri = json.images[json.textures[ti].source]?.uri;
      if (!uri) fehlendesBild.push(`${datei}:${mat.name}`);
      else if (!existsSync(join(PROBE_ZIEL, uri))) fehlendesBild.push(`${datei}:${uri}`);
      /*
        Die Tönungspflicht gilt für LAUB, nicht für jede Karte: Die
        bunten und die Schnee-Grasbüschel tragen ihre Farbe im Atlas
        (gemessen 0,350/0,447/0,186 beziehungsweise 0,707 hell), und ein
        Faktor könnte darauf nur dämpfen. Sie heissen deshalb `grasBunt`
        und `grasSchnee` und stehen hier ausdrücklich nicht.

        Das `-2` am Ende MUSS mitgeprüft werden: Seit der Store-Faktor
        Vorrang vor der Vorgabe hat, kann eine Rolle in einer Datei
        zweimal vorkommen (zwei Grüntöne auf derselben Karte,
        `small-thin-tree-1a5`), und die zweite heisst `laub-2`. Ohne den
        Suffix im Muster rutschte ausgerechnet das Material durch die
        Prüfung, das die Neuerung überhaupt erst erzeugt hat.
      */
      if (/^(laub|laubDunkel|laubSchnee|nadeln|ahorn|gras|grasGelb)(-\d+)?$/.test(mat.name)) {
        const f = mat.pbrMetallicRoughness?.baseColorFactor;
        if (!f || f.length < 3) ungetoentesLaub.push(`${datei}:${mat.name}`);
      }
    }
  }
}

check('kein Modell führt nach der Aufbereitung ein DefaultMaterial', mitDefault.length === 0, mitDefault.slice(0, 5).join(', '));
check('jedes Material hat eine auflösbare Textur', ohneTextur.length === 0, ohneTextur.slice(0, 5).join(', '));
check('jedes Bild liegt neben der GLB', fehlendesBild.length === 0, fehlendesBild.slice(0, 5).join(', '));
check(
  'jedes Laub-, Nadel- und Grasmaterial trägt einen Tönungsfaktor',
  ungetoentesLaub.length === 0,
  ungetoentesLaub.slice(0, 5).join(', ')
);

/*
  ── (b2) Die abgetragenen LOD-Schalen ────────────────────────────────

  34 Store-Modelle tragen ihre eigene Fernstufe MIT IN DERSELBEN DATEI,
  als Kindknoten der Nahstufe (`Tree_1E1` mit `Tree_1E1_1` und
  `Tree_1E1_2` darunter). Unity hätte je nach Entfernung eine davon
  eingeschaltet; Babylon zeichnet alle. Die Aufbereitung trägt sie ab.

  Drei Fehlerarten, alle drei lautlos:

   (i)   ZU WENIG. Die Regel greift nicht mehr (Knotennamen ändern sich
         beim nächsten Store-Import), und der Wald ist ohne jede Meldung
         wieder ein Viertel teurer.
   (ii)  ZU VIEL. Die Regel greift zu breit und trägt eine Krone ab. Ein
         Baum ohne Laub sieht aus wie ein toter Baum — und tote Bäume
         gibt es im Bestand wirklich, das fiele niemandem auf.
   (iii) UNVOLLSTÄNDIG BERICHTET. Der Bericht nennt eine Zahl, aber
         nicht, WELCHE Knoten fielen und wogegen sie gemessen wurden;
         dann ist das Ergebnis nicht mehr nachprüfbar, nur noch zu
         glauben.
*/
type LodEintrag = {
  knoten: string;
  stufe: number;
  lage: string;
  unter: string;
  dreiecke: number;
  gegenDreiecke: number;
};
type BerichtModell = {
  huellbox: { min: number[]; max: number[] };
  huellboxVorher: { min: number[]; max: number[] };
  huellboxGleich: boolean;
  lod: {
    dreieckeVorher: number;
    dreieckeNachher: number;
    gefallen: LodEintrag[];
    geprueft: { knoten: string; stufe: number; behalten: string }[];
    binGespartBytes: number;
  };
};

if (ersterLauf.length > 0 && existsSync(join(PROBE_ZIEL, 'BERICHT.json'))) {
  const bericht = JSON.parse(readFileSync(join(PROBE_ZIEL, 'BERICHT.json'), 'utf8')) as {
    lodSchalenEntfernt: boolean;
    modelle: Record<string, BerichtModell>;
  };
  const modelle = Object.entries(bericht.modelle);
  check('der Bericht sagt, dass die LOD-Schalen entfernt wurden', bericht.lodSchalenEntfernt === true);

  const vor = modelle.reduce((s, [, m]) => s + m.lod.dreieckeVorher, 0);
  const nach = modelle.reduce((s, [, m]) => s + m.lod.dreieckeNachher, 0);
  const anteil = (vor - nach) / vor;
  /*
    Die Schranken sind weit gesetzt und trotzdem scharf: Gemessen am
    Bestand vom 09.09.2026 fallen 25,6 % der Dreiecke (149.362 von
    584.136). Unter 15 % hat die Regel etwas verloren, über 40 % hat sie
    etwas erwischt, das keine Fernstufe ist. Beides ist ein Grund
    hinzusehen — keine Zahl zum stillen Nachziehen.
  */
  check(
    `die LOD-Schalen sind wirklich weg (${((anteil * 100)).toFixed(1)} % der Dreiecke, ${vor - nach} von ${vor})`,
    anteil >= 0.15 && anteil <= 0.4,
    'erwartet 15…40 %'
  );

  const ohneGeometrie = modelle.filter(([, m]) => m.lod.dreieckeNachher === 0);
  check(
    'kein Modell hat dabei seine ganze Geometrie verloren',
    ohneGeometrie.length === 0,
    ohneGeometrie.slice(0, 5).map(([n]) => n).join(', ')
  );

  // Jeder gefallene Knoten VOLLSTÄNDIG beschrieben — sonst ist die Zahl
  // oben eine Behauptung.
  const unvollstaendig: string[] = [];
  let gefalleneKnoten = 0;
  for (const [name, m] of modelle) {
    for (const g of m.lod.gefallen) {
      gefalleneKnoten++;
      const vollstaendig =
        typeof g.knoten === 'string' &&
        g.knoten.length > 0 &&
        Number.isInteger(g.stufe) &&
        g.stufe >= 1 &&
        (g.lage === 'verschachtelt' || g.lage === 'Geschwister') &&
        typeof g.unter === 'string' &&
        g.unter.length > 0 &&
        g.dreiecke > 0 &&
        // Die behaltene Schale hat MEHR Dreiecke — das ist die Bedingung,
        // unter der der Knoten überhaupt fallen durfte. Steht im Bericht
        // etwas anderes, hat das Werkzeug anders gehandelt als es sagt.
        g.gegenDreiecke > g.dreiecke;
      if (!vollstaendig) unvollstaendig.push(`${name}:${g.knoten ?? '?'}`);
    }
  }
  check(
    `jeder gefallene Knoten ist vollständig berichtet (${gefalleneKnoten} Knoten)`,
    gefalleneKnoten > 0 && unvollstaendig.length === 0,
    unvollstaendig.slice(0, 5).join(', ')
  );

  // Die Dateien, welche die Fernstufe als EIGENE Datei führen, müssen sie
  // vollständig behalten — dort IST die Fernstufe der ganze Inhalt.
  for (const eigen of ['massive-tree-1a1-lod-1', 'split-tree-1a1-lod-1', 'pine-1b1-1']) {
    const m = bericht.modelle[eigen];
    if (!m) continue;
    check(`${eigen} behält seine Geometrie (eigene Fernstufen-Datei)`, m.lod.gefallen.length === 0);
  }

  /*
    Die HÜLLBOX ist die Zusage an `tools/store-prefabs.mjs`, das sie für
    `renderScale` übernimmt. Sie DARF sich ändern — eine Fernstufe reicht
    manchmal ein paar Millimeter weiter —, aber nicht um Meter: Dann wäre
    kein LOD abgetragen worden, sondern ein Objekt.
  */
  const boxSprung = modelle.filter(([, m]) => {
    if (m.huellboxGleich) return false;
    return [0, 1, 2].some(
      (i) =>
        Math.abs(m.huellbox.min[i]! - m.huellboxVorher.min[i]!) > 0.1 ||
        Math.abs(m.huellbox.max[i]! - m.huellboxVorher.max[i]!) > 0.1
    );
  });
  check(
    'keine Hüllbox springt um mehr als 10 cm',
    boxSprung.length === 0,
    boxSprung.slice(0, 5).map(([n]) => n).join(', ')
  );

  /*
    Und die Gegenprobe zur Nachmessung selbst: `tree-1e1` ist in
    `design/store-konventionen.md` UNABHÄNGIG nachgemessen worden
    (−6,701 / −0,428 / −8,345 → 7,228 / 16,845 / 5,462). Trifft der
    Bericht diese Zahlen, rechnet `huellbox()` die Knotenversätze richtig
    mit — und nur dann taugt sie als Quelle für `renderScale`. Die alte
    Fassung las blosse Accessor-Grenzen und lag an jeder Krone daneben
    (die Laubkarten hängen bis zu 9,4 m über dem Stammfuss).
  */
  const e1 = bericht.modelle['tree-1e1'];
  if (e1) {
    const soll = { min: [-6.701, -0.428, -8.345], max: [7.228, 16.845, 5.462] };
    const passt =
      [0, 1, 2].every((i) => Math.abs(e1.huellbox.min[i]! - soll.min[i]!) < 0.001) &&
      [0, 1, 2].every((i) => Math.abs(e1.huellbox.max[i]! - soll.max[i]!) < 0.001);
    check(
      'tree-1e1 trifft die unabhängige Nachmessung aus design/store-konventionen.md',
      passt,
      `gemessen ${JSON.stringify(e1.huellbox)}`
    );
  }
}

/*
  ── (c) Der EINGECHECKTE Bericht ist der aktuelle ────────────────────
  `assets/store-lab/` ist gitignored — wer ohne den Store arbeitet, sieht
  vom Ergebnis der Aufbereitung sonst nichts. `tools/berichte/store-
  vegetation-bericht.json` ist deshalb die versionierte Kopie: Materialien
  vorher/nachher, Rolle, Herkunft, Tönung und Hüllbox je Modell, lesbar
  im `git diff`.

  Eine Kopie ohne Wächter ist allerdings eine Kopie, die veraltet. Und
  zwar lautlos: Sie sieht in jedem Zustand vollständig aus. Der Vergleich
  ist möglich, weil der zweite Lauf byteidentisch ist — was Prüfung (a)
  gerade festgestellt hat.
*/
const BERICHT_EINGECHECKT = join(WURZEL, 'tools/berichte/store-vegetation-bericht.json');
const BERICHT_FRISCH = join(PROBE_ZIEL, 'BERICHT.json');
if (ersterLauf.length > 0) {
  const frisch = existsSync(BERICHT_FRISCH) ? readFileSync(BERICHT_FRISCH, 'utf8') : '';
  const eingecheckt = existsSync(BERICHT_EINGECHECKT) ? readFileSync(BERICHT_EINGECHECKT, 'utf8') : '';
  check(
    'tools/berichte/store-vegetation-bericht.json ist der aktuelle Stand',
    eingecheckt.length > 0 && eingecheckt === frisch,
    eingecheckt.length === 0
      ? 'Datei fehlt'
      : 'Inhalt weicht ab — npm run store:aufbereiten, dann assets/store-lab/vegetation/BERICHT.json hierher kopieren'
  );
}

console.log('\nMaster je Modell nach der Aufbereitung:');
for (const [n, anzahl] of [...masterZaehler].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${n} Material${n === 1 ? '' : 'ien'}: ${anzahl} Modelle`);
}

rmSync(PROBE_ZIEL, { recursive: true, force: true });

if (fehler > 0) {
  console.error(`\n${fehler} Fehlschläge`);
  process.exit(1);
}
console.log('\nalles grün');
