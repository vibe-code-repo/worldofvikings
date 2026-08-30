/**
 * Der LAEUFER: eine Spielerkapsel geht einen erzeugten Dungeon 2.0 ab — mit
 * echtem Havok, echtem `DungeonBauer`, echtem `PhysicsCharacterController`.
 * THE RUNNER: a player capsule walks a generated dungeon 2.0 — with real Havok,
 * the real `DungeonBauer` and the real `PhysicsCharacterController`.
 *
 *   npx tsx client/test/dungeon2-laeufer.ts
 *   DUNGEON2_LAEUFER_SEEDS=8 npx tsx client/test/dungeon2-laeufer.ts
 *
 * WOZU, wenn `client/test/dungeon2-bauer.ts` die Begehbarkeit schon misst? Der
 * dortige Test schiebt einen KREIS ueber die Kollisionsquader — er beantwortet
 * „passt die Figur geometrisch durch". Er beantwortet NICHT, ob Havok sie
 * traegt: ob `PhysicsShapeContainer` je Block wirklich greift, ob die Rampe die
 * Steigungsgrenze der Figur einhaelt, ob die Kapsel an einer Blockgrenze
 * haengenbleibt. Das sind drei Fragen, die eine Geometrieprobe bauartbedingt
 * nicht stellen kann; sie brauchen die Physik-Engine.
 * WHY, when `dungeon2-bauer.ts` already measures walkability? That test slides a
 * CIRCLE across the collision boxes — it answers "does the figure fit
 * geometrically". It does NOT answer whether Havok carries her.
 *
 * Havok laeuft unter Node, sobald man ihm das WASM als Puffer reicht
 * (`wasmBinary`) statt es holen zu lassen: Die UMD-Fassung ruft sonst `fetch`
 * mit einem nackten Dateinamen, und das ist unter Node ein `ERR_INVALID_URL`.
 * Der Kopfkommentar von `dungeon2-bauer.ts` sagt „startet unter Node nicht
 * verlaesslich" — das galt fuer den Standardweg, nicht fuer diesen.
 * Havok runs under Node as soon as one hands it the WASM as a buffer
 * (`wasmBinary`) instead of letting it fetch: the UMD build otherwise calls
 * `fetch` with a bare file name, which is `ERR_INVALID_URL` under Node.
 *
 * GEMESSEN WIRD DIE STRECKE, NICHT DIE ZEIT (Vault-Notiz „Framezeit: Strecke
 * statt Zeit messen"): Jeder Lauf endet an einem Wegpunkt, nicht nach einer
 * Sekundenzahl, und die Kennzahl ist „Meter abgelaufen", nicht „Sekunden
 * gelaufen".
 * DISTANCE IS MEASURED, NOT TIME.
 *
 * Vier Fragen, je Seed mit Zahlen:
 *   (1) DURCHFALLEN   — sinkt die Kapsel unter den tiefsten Boden ihrer Saeule?
 *   (2) HAENGENBLEIBEN— kommt sie trotz Eingabe an einem Wegpunkt nicht an?
 *   (3) TREPPE        — erreicht sie ueber JEDE Treppe die Ebene darueber?
 *   (4) TUER          — kommt sie durch jede Tuerkante hindurch?
 * Four questions, per seed with numbers.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import HavokPhysics from '@babylonjs/havok';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import '@babylonjs/core/Physics/physicsEngineComponent';
import {
  PhysicsCharacterController,
  CharacterSupportedState,
} from '@babylonjs/core/Physics/v2/characterController';
import '@babylonjs/core/Shaders/pbr.fragment';
import '@babylonjs/core/Shaders/pbr.vertex';
import { DungeonBauer } from '../src/engine/DungeonBuilder';
import {
  BODY_HEIGHT,
  BODY_RADIUS,
  FIGUR_BESCHLEUNIGUNG,
  STEIGUNGS_GRENZE_GRAD,
} from '../src/player/PlayerController';
import { dungeon2 } from '@wov/shared';

const {
  erzeugeLayout,
  STEINGRAB,
  baueGeometrie,
  zellenAufbauen,
  zellenSortiert,
  zelleImGitter,
  bodenStufen,
  offen,
  HOEHEN_SCHRITT_M,
  ZELLE_M,
  ZELLEN_ART,
  KANTE,
  KANTEN,
  EBENE_M,
  gegenKante,
  nachbarZelle,
} = dungeon2;
type NavZelle = dungeon2.NavZelle;
type Kante = dungeon2.Kante;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Kennzahlen des Laeufers / the runner's constants
// ─────────────────────────────────────────────────────────────────────────────

/** Erdbeschleunigung wie im Spiel (`Physics.ts`, `PlayerController.ts`). */
/** Gravity as in the game. */
const GRAVITY = new Vector3(0, -20, 0);
const UNTEN = new Vector3(0, -1, 0);
/** Schrittweite der Physik. Fest, damit der Lauf reproduzierbar ist. */
/** Fixed physics step, so the run is reproducible. */
const DT = 1 / 60;
/** Gehtempo (m/s). Nicht Renntempo: der Test misst Tragen, nicht Rekorde. */
/** Walking speed (m/s). Not sprint: the test measures carrying, not records. */
const TEMPO = 4;
/**
 * Bilder je Wegpunkt, bevor er als HAENGER gilt. Bei 4 m/s und einer
 * 4-m-Zelle reichen 60 Bilder fuer die Strecke; 480 sind das Achtfache und
 * lassen Umwege um eine Ecke zu, ohne dass ein echter Haenger durchrutscht.
 * Frames per waypoint before it counts as STUCK. At 4 m/s and a 4 m cell 60
 * frames cover the distance; 480 is eightfold and allows detours around a
 * corner without letting a real snag slip through.
 */
const BILDER_JE_ZIEL = 480;
/**
 * Zahl der Laeufe eines Aufgangs (`generator.ts`, `TREPPE_ANSTIEGE`). Hier nur
 * als Zeitbudget: der Aufgang bekommt `TREPPE_LAEUFE` Wegpunkt-Budgets.
 * Number of runs of an ascent, used here only as a frame budget.
 */
const TREPPE_LAEUFE = 3;
/** Waagerechte Naehe, ab der ein Wegpunkt als erreicht gilt (m). */
/** Horizontal proximity counting as "waypoint reached" (m). */
const ZIEL_RADIUS = 0.8;
/**
 * Wie tief unter den tiefsten Boden ihrer Saeule die Kapsel sinken darf, bevor
 * es DURCHFALLEN heisst (m). Eine halbe Bodenplatte ist Spielraum fuer den
 * Kontaktabstand des Controllers, ein ganzer Meter waere schon der Raum
 * darunter.
 * How far below the lowest floor of its column the capsule may sink before it
 * counts as FALLING THROUGH (m).
 */
const DURCHFALL_TOLERANZ = 0.6;

const SEEDS = Number(process.env['DUNGEON2_LAEUFER_SEEDS'] ?? 5);

let rot = 0;
let gruen = 0;
const fehler: string[] = [];
function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gruen++;
    console.log(`  ok   ${name}`);
  } else {
    rot++;
    fehler.push(`${name}${zusatz === '' ? '' : ` — ${zusatz}`}`);
    console.log(`  ROT  ${name}${zusatz === '' ? '' : ` — ${zusatz}`}`);
  }
}
function melde(text: string): void {
  console.log(`  --   ${text}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Wegenetz aus `BauErgebnis.nav` / route network from `BauErgebnis.nav`
// ─────────────────────────────────────────────────────────────────────────────

const schluessel = (x: number, z: number, ebene: number): string => `${ebene}|${z}|${x}`;

interface Knoten {
  readonly nav: NavZelle;
  /** Nachbarn auf derselben Ebene. / Neighbours on the same storey. */
  readonly waagerecht: string[];
  /** Schachtverbindung nach oben bzw. unten. / Shaft link up resp. down. */
  hoch: string | null;
  runter: string | null;
}

/**
 * Ist diese Zelle ein Wegpunkt? Nein fuer die Schachtzellen ueber den UNTEREN
 * Treppenlaeufen: sie sind die Luft ueber der Treppe, keine Standflaeche. Wer
 * dort hinlaeuft, laeuft in Wahrheit die Rampe hinunter und wieder hinauf — der
 * Weg dorthin ist die Treppe selbst, und ein Wegpunkt darin misst zweimal
 * dasselbe. Die MUENDUNG bleibt Wegpunkt: sie ist der Ausgang nach oben.
 * Is this cell a waypoint? Not the shaft cells above the LOWER stair runs: they
 * are the air above the stairs, not a standing surface. The MOUTH stays a
 * waypoint: it is the way out at the top.
 */
function istWegpunkt(gitter: dungeon2.ZellenGitter, n: NavZelle): boolean {
  const zelle = zelleImGitter(gitter, n.x, n.z, n.ebene);
  if (zelle === undefined || zelle.art !== ZELLEN_ART.Schacht) return true;
  const unten = zelleImGitter(gitter, n.x, n.z, n.ebene - 1);
  if (unten === undefined || unten.art !== ZELLEN_ART.Treppe) return true;
  const w = nachbarZelle(unten.x, unten.z, (unten.neigung ?? KANTE.Nord) as Kante);
  const weiter = zelleImGitter(gitter, w.x, w.z, unten.ebene);
  return weiter === undefined || weiter.art !== ZELLEN_ART.Treppe;
}

function baueNetz(nav: readonly NavZelle[], gitter: dungeon2.ZellenGitter): Map<string, Knoten> {
  const netz = new Map<string, Knoten>();
  for (const n of nav) {
    if (!istWegpunkt(gitter, n)) continue;
    netz.set(schluessel(n.x, n.z, n.ebene), { nav: n, waagerecht: [], hoch: null, runter: null });
  }
  for (const k of netz.values()) {
    for (const kante of KANTEN) {
      if ((k.nav.offeneKanten & kante) === 0) continue;
      const p = nachbarZelle(k.nav.x, k.nav.z, kante as Kante);
      const s = schluessel(p.x, p.z, k.nav.ebene);
      if (netz.has(s)) k.waagerecht.push(s);
    }
    if (k.nav.nachOben) {
      const s = schluessel(k.nav.x, k.nav.z, k.nav.ebene + 1);
      if (netz.has(s)) k.hoch = s;
    }
    if (k.nav.nachUnten) {
      const s = schluessel(k.nav.x, k.nav.z, k.nav.ebene - 1);
      if (netz.has(s)) k.runter = s;
    }
    // Der Vergleich ist absichtlich sortiert: `KANTEN` ist eine feste Liste,
    // aber `waagerecht` soll sich auch dann nicht verschieben, wenn jemand die
    // Reihenfolge dort einmal aendert. Eine Route, die von einer Listenordnung
    // abhaengt, ist keine Messung, sondern ein Zufall.
    // The sort is deliberate: a route that depends on a list order is not a
    // measurement but a coincidence.
    k.waagerecht.sort();
  }
  return netz;
}

/**
 * Tiefensuche vom Eingangsknoten aus, die JEDE erreichbare Zelle einmal betritt
 * — mit Rueckweg, weil die Kapsel nicht springt. Ergebnis ist die Folge der
 * Zellen, die abgelaufen wird.
 * Depth first search from the entrance node visiting EVERY reachable cell once —
 * with the way back, because the capsule does not teleport.
 */
function route(netz: Map<string, Knoten>, start: string): string[] {
  const gesehen = new Set<string>([start]);
  const folge: string[] = [start];
  const gehe = (s: string): void => {
    const k = netz.get(s);
    if (k === undefined) return;
    const kinder = [...k.waagerecht];
    if (k.hoch !== null) kinder.push(k.hoch);
    if (k.runter !== null) kinder.push(k.runter);
    for (const kind of kinder) {
      if (gesehen.has(kind)) continue;
      gesehen.add(kind);
      folge.push(kind);
      gehe(kind);
      folge.push(s); // Rueckweg / the way back
    }
  };
  gehe(start);
  return folge;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Der Lauf / the run
// ─────────────────────────────────────────────────────────────────────────────

interface Laufbericht {
  strecke: number;
  bilder: number;
  haenger: string[];
  /** Haenger an einer Muendungskante — dokumentierter Rest, siehe unten. */
  /** Snags at a mouth edge — documented residue, see below. */
  muendungsAbsatz: string[];
  durchgefallen: string[];
  tiefstesY: number;
}

/**
 * Ein Schritt der Figur — dieselbe Aufteilung wie `PlayerController.stepPhysics`:
 * waagerecht die WUNSCHgeschwindigkeit, senkrecht die Schwerkraft, und bei
 * Bodenkontakt keine Altlast mitschleppen.
 * One step of the figure — the same split as `PlayerController.stepPhysics`.
 */
function schritt(c: PhysicsCharacterController, wx: number, wz: number): boolean {
  const stuetze = c.checkSupport(DT, UNTEN);
  const getragen = stuetze.supportedState !== CharacterSupportedState.UNSUPPORTED;
  const v = c.getVelocity();
  c.setVelocity(new Vector3(wx * TEMPO, getragen ? 0 : v.y + GRAVITY.y * DT, wz * TEMPO));
  c.integrate(DT, stuetze, GRAVITY);
  return getragen;
}

/**
 * Laeuft zu einem Ziel. Rueckgabe: abgelaufene Strecke, oder `null`, wenn das
 * Ziel innerhalb von `BILDER_JE_ZIEL` nicht erreicht wurde (HAENGER).
 * Walks to a target. Returns distance covered, or `null` when the target was not
 * reached within `BILDER_JE_ZIEL` (STUCK).
 */
function laufeZu(
  c: PhysicsCharacterController,
  ziel: { x: number; y: number; z: number },
  bericht: Laufbericht,
  bodenUnter: (x: number, z: number) => number | null
): number | null {
  let strecke = 0;
  let vorher = c.getPosition().clone();
  for (let i = 0; i < BILDER_JE_ZIEL; i++) {
    const p = c.getPosition();
    const dx = ziel.x - p.x;
    const dz = ziel.z - p.z;
    const laenge = Math.sqrt(dx * dx + dz * dz);
    // Senkrecht wird NICHT geprueft: ein Wegpunkt auf der Ebene darueber wird
    // ueber die Rampe erreicht, und wer dort auch die Hoehe fordert, misst die
    // Rampe statt der Ankunft. Die Hoehe prueft der Treppentest eigens.
    // Height is NOT checked here: a waypoint on the storey above is reached via
    // the ramp. The staircase test checks the height on its own.
    if (laenge < ZIEL_RADIUS) return strecke;
    schritt(c, dx / laenge, dz / laenge);
    bericht.bilder++;
    const jetzt = c.getPosition();
    strecke += Vector3.Distance(vorher, jetzt);
    vorher = jetzt.clone();

    const fuesse = jetzt.y - BODY_HEIGHT / 2;
    if (fuesse < bericht.tiefstesY) bericht.tiefstesY = fuesse;
    const boden = bodenUnter(jetzt.x, jetzt.z);
    if (boden !== null && fuesse < boden - DURCHFALL_TOLERANZ) {
      bericht.durchgefallen.push(
        `bei (${jetzt.x.toFixed(1)}, ${fuesse.toFixed(2)}, ${jetzt.z.toFixed(1)}) — tiefster Boden dieser Saeule ${boden.toFixed(2)}`
      );
      // Zurueck auf den Boden setzen, sonst faellt der Rest des Laufs ins
      // Leere und meldet dieselbe Stelle tausendfach.
      // Put her back on the floor, otherwise the rest of the run falls forever.
      c.setPosition(new Vector3(jetzt.x, boden + BODY_HEIGHT / 2, jetzt.z));
      c.setVelocity(Vector3.Zero());
      return strecke;
    }
  }
  bericht.strecke += strecke;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Hauptlauf / main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Das WASM als Puffer, nicht als URL — siehe Kopfkommentar.
  // The WASM as a buffer, not as a URL — see the header comment.
  // `new Uint8Array(...)`, nicht der `Buffer` selbst: Node 22 typisiert
  // `readFileSync` als `NonSharedBuffer`, und `wasmBinary` erwartet einen
  // gewoehnlichen `ArrayBufferView`. Zur Laufzeit dasselbe, in der Typpruefung
  // nicht.
  // Not the `Buffer` itself: Node 22 types `readFileSync` as `NonSharedBuffer`.
  const wasm = new Uint8Array(
    readFileSync(createRequire(import.meta.url).resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'))
  ).buffer;
  const havok = await HavokPhysics({ wasmBinary: wasm });

  console.log(
    `dungeon2-laeufer: Kapsel ${BODY_HEIGHT} m x r ${BODY_RADIUS} m, Steigungsgrenze ${STEIGUNGS_GRENZE_GRAD} Grad, ` +
      `Beschleunigung ${FIGUR_BESCHLEUNIGUNG}, Tempo ${TEMPO} m/s, ${SEEDS} Seeds`
  );

  let streckeGesamt = 0;
  let bilderGesamt = 0;
  let haengerGesamt = 0;
  let absatzGesamt = 0;
  let durchfallGesamt = 0;
  let treppenGesamt = 0;
  let treppenGeschafft = 0;
  let tuerenGesamt = 0;
  let tuerenGeschafft = 0;

  for (let seed = 1; seed <= SEEDS; seed++) {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.enablePhysics(GRAVITY, new HavokPlugin(true, havok));

    const layout = erzeugeLayout(STEINGRAB, { architektur: seed, material: 77, deko: 9 });
    const gitter = zellenAufbauen(layout);
    const ergebnis = baueGeometrie(layout, { gitter });

    // Der ECHTE Client-Bauer mit `physik: true` — nicht eine zweite, im Test
    // nachgebaute Kollisionswelt. Was hier traegt, traegt im Spiel.
    // The REAL client builder with `physik: true` — not a second collision world
    // rebuilt inside the test.
    const bauer = new DungeonBauer(scene, layout, { arrays: null, physik: true });
    bauer.baueAlles();
    const statistik = bauer.statistik();

    const netz = baueNetz(ergebnis.nav, gitter);
    // Tiefster Boden je (x,z)-Saeule — die Untergrenze fuer „Durchfallen".
    //
    // Aus dem GITTER, nicht aus `nav`: `NavZelle.mitte.y` ist bei einer Treppe
    // die Standhoehe in der ZELLMITTE, also eine halbe Steigung ueber dem
    // Zellboden. Wer damit rechnet, meldet jeden Spieler, der am FUSS eines
    // Laufs steht, als durchgefallen — gemessen 70 falsche Meldungen ueber
    // fuenf Seeds, alle an derselben Stelle.
    // From the GRID, not from `nav`: on a stair `NavZelle.mitte.y` is the
    // standing height at the CELL CENTRE, half a rise above the cell floor.
    // Using it reports every player standing at a run's FOOT as fallen through —
    // measured 70 false reports over five seeds.
    const saeule = new Map<string, number>();
    for (const zelle of zellenSortiert(gitter)) {
      if (!offen(zelle.art)) continue;
      const s = `${zelle.z}|${zelle.x}`;
      const boden = bodenStufen(zelle) * HOEHEN_SCHRITT_M;
      const alt = saeule.get(s);
      if (alt === undefined || boden < alt) saeule.set(s, boden);
    }
    const bodenUnter = (x: number, z: number): number | null =>
      saeule.get(`${Math.floor(z / ZELLE_M)}|${Math.floor(x / ZELLE_M)}`) ?? null;

    const startS = schluessel(
      Math.floor(ergebnis.spawnPunkt.x / ZELLE_M),
      Math.floor(ergebnis.spawnPunkt.z / ZELLE_M),
      layout.eingang.ebene
    );
    if (!netz.has(startS)) {
      pruefe(`Seed ${seed}: Spawnzelle liegt im Wegenetz`, false, startS);
      scene.dispose();
      engine.dispose();
      continue;
    }

    const c = new PhysicsCharacterController(
      new Vector3(
        ergebnis.spawnPunkt.x,
        ergebnis.spawnPunkt.y + BODY_HEIGHT / 2,
        ergebnis.spawnPunkt.z
      ),
      { capsuleHeight: BODY_HEIGHT, capsuleRadius: BODY_RADIUS },
      scene
    );
    c.acceleration = FIGUR_BESCHLEUNIGUNG;
    c.maxSlopeCosine = Math.cos((STEIGUNGS_GRENZE_GRAD * Math.PI) / 180);

    const bericht: Laufbericht = {
      strecke: 0,
      bilder: 0,
      haenger: [],
      muendungsAbsatz: [],
      durchgefallen: [],
      tiefstesY: Number.POSITIVE_INFINITY,
    };

    // ── (1)(2) der grosse Rundgang / the grand tour ────────────────────────
    const folge = route(netz, startS);
    let voriger = startS;
    for (const s of folge) {
      const k = netz.get(s);
      if (k === undefined) continue;
      const ziele: { x: number; y: number; z: number }[] = [];
      const vorK = netz.get(voriger);
      // Ein Ebenenwechsel geht ueber die RAMPE, nicht senkrecht. Der Wegpunkt
      // liegt deshalb ein Stueck in Neigungsrichtung hinter der Muendung: ein
      // Ziel genau ueber dem Kopf ergibt eine waagerechte Richtung von null,
      // und die Kapsel stuende bis zum Zeitablauf still.
      // A storey change goes up the RAMP, not vertically. The waypoint therefore
      // sits a bit past the mouth in the ascent direction: a target directly
      // overhead yields a horizontal direction of zero.
      if (vorK !== undefined && k.nav.ebene !== vorK.nav.ebene) {
        const zelle = zelleImGitter(
          gitter,
          vorK.nav.x,
          vorK.nav.z,
          k.nav.ebene > vorK.nav.ebene ? vorK.nav.ebene : k.nav.ebene
        );
        const neigung = zelle?.neigung ?? KANTE.Nord;
        const richtung = nachbarZelle(0, 0, neigung as Kante);
        const zeichen = k.nav.ebene > vorK.nav.ebene ? 1 : -1;
        ziele.push({
          x: k.nav.mitte.x + richtung.x * zeichen * ZELLE_M * 0.4,
          y: k.nav.mitte.y,
          z: k.nav.mitte.z + richtung.z * zeichen * ZELLE_M * 0.4,
        });
      }
      ziele.push(k.nav.mitte);
      for (const ziel of ziele) {
        const gelaufen = laufeZu(c, ziel, bericht, bodenUnter);
        if (gelaufen === null) {
          const text = `Zelle (${k.nav.x},${k.nav.z},E${k.nav.ebene}) von (${vorK?.nav.x ?? '?'},${vorK?.nav.z ?? '?'},E${vorK?.nav.ebene ?? '?'})`;
          // ZWEI Klassen, und die Trennung IST der Befund:
          //
          // MUENDUNGSKANTE (dokumentierter Rest): Ein Schritt von der
          //   Schachtmuendung seitlich in einen Raum derselben Ebene. Die
          //   Muendung hat keine Bodenplatte — unter ihr steht die Rampe, und in
          //   der Zellmitte steht man 1,25 m unter der Ebenensohle. Der Ausgang
          //   in ANSTIEGSRICHTUNG hat diesen Absatz nicht (dorthin laeuft die
          //   Rampe hinauf), und der Generator bevorzugt ihn deshalb; die
          //   uebrigen Kanten bleiben aber offen. Sie zuzumauern hat 35 von 200
          //   Seeds unerreichbar gemacht — die Loesung gehoert zur Muendungsform
          //   und ist ein eigener Arbeitsschritt.
          // SONST (null erlaubt): jeder andere Haenger. Das ist die Klasse, die
          //   ein Spieler als „ich komme hier nicht weiter" meldet.
          // TWO classes, and the split IS the finding. MOUTH EDGE (documented
          // residue): a sideways step out of the shaft mouth. The mouth has no
          // floor slab; at its centre one stands 1.25 m below the storey sole.
          // The exit ALONG THE ASCENT has no such step and the generator prefers
          // it, but the other edges stay open. Walling them made 35 of 200 seeds
          // unreachable. EVERYTHING ELSE: zero allowed.
          const vonMuendung =
            vorK !== undefined &&
            zelleImGitter(gitter, vorK.nav.x, vorK.nav.z, vorK.nav.ebene)?.art ===
              ZELLEN_ART.Schacht &&
            k.nav.ebene === vorK.nav.ebene;
          if (vonMuendung) bericht.muendungsAbsatz.push(text);
          else bericht.haenger.push(text);
          // Weiter geht es vom Ziel aus — sonst haengt der ganze Rest an
          // derselben Kante und die Zahl sagt nichts mehr.
          // Continue from the target — otherwise the whole rest hangs on the
          // same edge and the number stops meaning anything.
          c.setPosition(new Vector3(ziel.x, ziel.y + BODY_HEIGHT / 2, ziel.z));
          c.setVelocity(Vector3.Zero());
        } else {
          bericht.strecke += gelaufen;
        }
      }
      voriger = s;
    }

    // ── (3) Treppen ────────────────────────────────────────────────────────
    // Gemessen wird der GANZE Aufgang, nicht ein Lauf: die Kapsel wird an den
    // Fuss des untersten Laufs gesetzt und laeuft in Anstiegsrichtung, bis sie
    // die Sohle der Ebene darueber erreicht. Ein einzelner Lauf zu messen waere
    // die bequemere Frage — er endet schon nach 2,5 bis 3 m, und genau die
    // Uebergaenge zwischen den Laeufen sind die Stellen, an denen die Kapsel
    // haengengeblieben ist.
    // The WHOLE ascent is measured, not one run: the capsule is placed at the
    // foot of the lowest run and walks along the ascent until it reaches the sole
    // of the storey above. Measuring a single run would be the easier question —
    // it ends after 2.5 to 3 m, and the transitions between runs are exactly
    // where the capsule got stuck.
    let treppen = 0;
    let geschafft = 0;
    const treppenFehler: string[] = [];
    for (const k of [...netz.values()].sort(
      (a, b) => a.nav.ebene - b.nav.ebene || a.nav.z - b.nav.z || a.nav.x - b.nav.x
    )) {
      const zelle = zelleImGitter(gitter, k.nav.x, k.nav.z, k.nav.ebene);
      if (zelle === undefined || zelle.art !== ZELLEN_ART.Treppe) continue;
      const neigung = (zelle.neigung ?? KANTE.Nord) as Kante;
      const richtung = nachbarZelle(0, 0, neigung);
      // Nur der UNTERSTE Lauf eines Aufgangs: der, gegen dessen Anstieg keine
      // weitere Treppenzelle liegt.
      // Only the LOWEST run of an ascent.
      const zurueck = nachbarZelle(k.nav.x, k.nav.z, gegenKante(neigung));
      const davor = zelleImGitter(gitter, zurueck.x, zurueck.z, k.nav.ebene);
      if (davor !== undefined && davor.art === ZELLEN_ART.Treppe) continue;
      treppen++;
      const ziel = (k.nav.ebene + 1) * EBENE_M;
      c.setPosition(new Vector3(k.nav.mitte.x, k.nav.mitte.y + BODY_HEIGHT / 2, k.nav.mitte.z));
      c.setVelocity(Vector3.Zero());
      // Nach einem `setPosition` steht der Controller EINEN Schritt lang noch
      // mit den alten Kontakten da. Ohne diese Ruhebilder misst der erste
      // Schritt die Kontakte vom vorigen Standort — gemessen blieb die Kapsel
      // dann am Fuss des untersten Laufs stehen, obwohl derselbe Aufgang von
      // einem frisch angelegten Controller aus muehelos begangen wird.
      // After a `setPosition` the controller still carries the old contacts for
      // one step. Without these settling frames the first step measures the
      // contacts of the previous location.
      for (let i = 0; i < 10; i++) schritt(c, 0, 0);
      let hoechste = Number.NEGATIVE_INFINITY;
      let erreicht = false;
      for (let i = 0; i < BILDER_JE_ZIEL * TREPPE_LAEUFE; i++) {
        schritt(c, richtung.x, richtung.z);
        bericht.bilder++;
        const fuesse = c.getPosition().y - BODY_HEIGHT / 2;
        if (fuesse > hoechste) hoechste = fuesse;
        if (fuesse >= ziel - 0.25) {
          erreicht = true;
          break;
        }
      }
      if (erreicht) geschafft++;
      else if (treppenFehler.length < 3) {
        treppenFehler.push(
          `(${k.nav.x},${k.nav.z},E${k.nav.ebene}) kam bis y=${hoechste.toFixed(2)} statt ${ziel.toFixed(2)}`
        );
      }
    }

    // ── (4) Tueren ─────────────────────────────────────────────────────────
    // Jede Tuerkante wird von beiden Seiten durchschritten. Eine Tuer, durch
    // die man nur in EINE Richtung kommt, ist kein Durchgang, sondern ein
    // Trichter — und die Ableitungsregel §3.3 ist symmetrisch, also muss es
    // auch die Messung sein.
    // Every door edge is walked from both sides. A door one can only pass in ONE
    // direction is a funnel, not a passage.
    let tueren = 0;
    let tuerGeschafft = 0;
    const tuerFehler: string[] = [];
    for (const tuer of layout.tueren) {
      if (tuer.zustand === 'verschlossen') continue;
      const a = netz.get(schluessel(tuer.x, tuer.z, tuer.ebene));
      const p = nachbarZelle(tuer.x, tuer.z, tuer.kante);
      const b = netz.get(schluessel(p.x, p.z, tuer.ebene));
      if (a === undefined || b === undefined) continue;
      tueren++;
      let beide = true;
      for (const [von, nach] of [
        [a, b],
        [b, a],
      ] as const) {
        c.setPosition(new Vector3(von.nav.mitte.x, von.nav.mitte.y + BODY_HEIGHT / 2, von.nav.mitte.z));
        c.setVelocity(Vector3.Zero());
        const gelaufen = laufeZu(c, nach.nav.mitte, bericht, bodenUnter);
        if (gelaufen === null) beide = false;
        else bericht.strecke += gelaufen;
      }
      if (beide) tuerGeschafft++;
      else if (tuerFehler.length < 3) {
        tuerFehler.push(`(${tuer.x},${tuer.z},E${tuer.ebene}) Kante ${tuer.kante} (${tuer.art}, ${tuer.zustand})`);
      }
    }

    melde(
      `Seed ${seed}: ${ergebnis.nav.length} Navzellen · ${statistik.koerper} Havok-Koerper (${statistik.formen} Formen) · ` +
        `${bericht.strecke.toFixed(0)} m abgelaufen in ${bericht.bilder} Schritten · ` +
        `${bericht.haenger.length} Haenger (+${bericht.muendungsAbsatz.length} Muendungsabsatz) · ${bericht.durchgefallen.length} Durchfaelle · ` +
        `Treppen ${geschafft}/${treppen} · Tueren ${tuerGeschafft}/${tueren}`
    );

    pruefe(
      `Seed ${seed}: die Kapsel faellt nirgends durch den Boden`,
      bericht.durchgefallen.length === 0,
      bericht.durchgefallen[0] ?? ''
    );
    pruefe(
      `Seed ${seed}: die Kapsel bleibt an keinem Wegpunkt haengen`,
      bericht.haenger.length === 0,
      bericht.haenger.slice(0, 12).join(' | ')
    );
    pruefe(
      `Seed ${seed}: der Muendungsabsatz bleibt selten (${bericht.muendungsAbsatz.length} Kanten)`,
      bericht.muendungsAbsatz.length <= 2,
      bericht.muendungsAbsatz.join(' | ')
    );
    pruefe(
      `Seed ${seed}: jede Treppe traegt bis zur Ebene darueber (${geschafft}/${treppen})`,
      geschafft === treppen,
      treppenFehler.join(' | ')
    );
    pruefe(
      `Seed ${seed}: jede Tuerkante ist in BEIDE Richtungen begehbar (${tuerGeschafft}/${tueren})`,
      tuerGeschafft === tueren,
      tuerFehler.join(' | ')
    );

    streckeGesamt += bericht.strecke;
    bilderGesamt += bericht.bilder;
    haengerGesamt += bericht.haenger.length;
    absatzGesamt += bericht.muendungsAbsatz.length;
    durchfallGesamt += bericht.durchgefallen.length;
    treppenGesamt += treppen;
    treppenGeschafft += geschafft;
    tuerenGesamt += tueren;
    tuerenGeschafft += tuerGeschafft;

    bauer.dispose();
    scene.dispose();
    engine.dispose();
  }

  // Eine Messung ohne Umfang ist keine: waere die Route leer, waeren oben alle
  // Pruefungen gruen und der Test wertlos.
  // A measurement without extent is none: with an empty route every check above
  // would be green and the test worthless.
  pruefe(
    `Der Lauf hat Umfang: ${streckeGesamt.toFixed(0)} m ueber ${SEEDS} Seeds`,
    streckeGesamt > 500 * SEEDS,
    `${streckeGesamt.toFixed(0)} m`
  );
  pruefe(
    `Es gab Treppen und Tueren zu messen (${treppenGesamt} Treppen, ${tuerenGesamt} Tueren)`,
    treppenGesamt > 0 && tuerenGesamt > 0
  );

  console.log(
    `dungeon2-laeufer: ${gruen} Pruefungen gruen, ${rot} rot ` +
      `(${streckeGesamt.toFixed(0)} m in ${bilderGesamt} Physikschritten, ` +
      `${haengerGesamt} Haenger, ${absatzGesamt} Muendungsabsaetze, ${durchfallGesamt} Durchfaelle, ` +
      `Treppen ${treppenGeschafft}/${treppenGesamt}, Tueren ${tuerenGeschafft}/${tuerenGesamt})`
  );
  for (const f of fehler) console.log(`  ROT  ${f}`);
  process.exit(rot === 0 ? 0 : 1);
}

void main().catch((f: unknown) => {
  console.error(f);
  process.exit(1);
});
