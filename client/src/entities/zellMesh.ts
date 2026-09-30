/**
 * Building and filling masters: the merged vertex cloud for the collision
 * shapes, the one way to write a thin-instance buffer, the measured model height
 * of a master and the cell mesh built from a prototype master. The two WeakMaps
 * (model height, raw geometry) exist exactly once.
 * Moved verbatim out of EntityManager.ts.
 */

import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Scene } from '@babylonjs/core/scene';
import {
  istGestreuteLandschaft,
  markiereAlsGestreuteLandschaft,
} from '../engine/RefraktionsAuswahl';
import { huellkoerperAufweiten } from './lod';

/**
 * Mehrere Master zu EINER Punktwolke in Prefab-Koordinaten zusammenlegen
 * — die Eingabe der gemeinsamen Formableitung.
 *
 * Die Master sind ein Netz je GLB-Submesh mit eigenem lokalen Versatz;
 * `formen.ts` will EINE Liste in Instanzkoordinaten und kennt keine
 * Matrizen. Umgerechnet wird deshalb hier, und zwar von Hand aus den
 * Matrixelementen: Ein Baum-GLB trägt Zehntausende Vertices, und ein
 * `Vector3` je Vertex (mal jedes Prefab) reicht, um einen Frame zu
 * verschlucken.
 *
 * `null`, wenn nichts zusammenkommt. Meshes ohne Indizes steuern ihre
 * Positionen bei (die Kiste/Kapsel misst sie mit), aber keine Dreiecke —
 * ein Netz-Collider kann sie nicht gebrauchen.
 *
 * Merges the masters' vertices into one prefab-local cloud for the shared
 * shape derivation.
 */
function netzAusMastern(
  meshes: readonly import('@babylonjs/core/Meshes/mesh').Mesh[],
  locals: readonly Matrix[]
): { positionen: Float32Array; indizes: Uint32Array | null } | null {
  const teile: {
    pos: Float32Array | number[];
    idx: ArrayLike<number> | null;
    m: Float32Array;
  }[] = [];
  let ecken = 0;
  let dreiecke = 0;
  for (let i = 0; i < meshes.length; i++) {
    const pos = meshes[i]!.getVerticesData(VertexBuffer.PositionKind);
    if (!pos) continue;
    const idx = meshes[i]!.getIndices();
    const local = locals[i];
    teile.push({
      pos,
      idx: idx && idx.length > 0 ? idx : null,
      m: (local ? local.m : Matrix.Identity().m) as unknown as Float32Array,
    });
    ecken += pos.length;
    dreiecke += idx ? idx.length : 0;
  }
  if (ecken === 0) return null;

  const positionen = new Float32Array(ecken);
  const indizes = dreiecke > 0 ? new Uint32Array(dreiecke) : null;
  let p = 0;
  let q = 0;
  for (const t of teile) {
    const e = t.m;
    const basis = p / 3;
    for (let v = 0; v < t.pos.length; v += 3) {
      const x = t.pos[v]!;
      const y = t.pos[v + 1]!;
      const z = t.pos[v + 2]!;
      positionen[p++] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      positionen[p++] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      positionen[p++] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    if (indizes && t.idx) for (let k = 0; k < t.idx.length; k++) indizes[q++] = basis + t.idx[k]!;
  }
  return { positionen, indizes: indizes === null ? null : indizes.subarray(0, q) };
}

/**
 * Der EINE Weg, einen Thin-Instance-Puffer zu setzen — Puffer, Hülle,
 * Sichtbarkeit, in dieser Reihenfolge.
 *
 * Stand vorher wörtlich in rebuildBucketInstances(). Seit dem Zellschnitt
 * (E19 c) gibt es diese Stelle nicht mehr einmal, sondern in jedem
 * Zellauf- und -abbaupfad; jede vergessene Wiederholung liefert eine
 * eingefrorene Hülle und damit einen Werfer, den der Schattenpass als
 * GANZES keult (Babylon-Forum 33711/51901) — also fehlende Schatten ohne
 * jede Fehlermeldung. Deshalb steht die Dreierfolge nur noch hier.
 *
 * Ein LEERER Master bekommt `null`, nicht einen Puffer der Länge 0.
 * Beides schaltet ihn ab, aber nur bei `null` stellt Babylon den
 * Hüllkörper der Rohgeometrie wieder her; mit einem leeren Puffer läuft
 * seine Min/Max-Schleife über null Instanzen und hinterlässt ±Infinity
 * (thinInstanceMesh.js:103 gegen :109). Solange der Master abgeschaltet
 * ist, sieht man davon nichts — aber ein Hüllkörper aus Unendlichkeiten
 * ist eine Falle für jeden, der ihn später ausliest, und seit D10 lesen
 * ihn zwei Stellen aus (Frustumprüfung und Shadows.darfWerfen).
 * Aufgefallen in client/test/master-huelle.ts.
 */
function schreibeInstanzen(mesh: Mesh, daten: Float32Array | null): void {
  mesh.thinInstanceSetBuffer('matrix', daten, 16, false);
  // setBuffer hat den Hüllkörper soeben über alle Instanzen neu gespannt
  // (thinInstanceMesh.js:103) — jetzt ist der Moment, ihm die Windreserve
  // zu geben. Vorher wäre sie wieder überschrieben.
  huellkoerperAufweiten(mesh);
  merkeModellHoehe(mesh, daten);
  mesh.setEnabled(daten !== null);
}

/**
 * Gemessene Höhe EINES Exemplars je Master, in Metern.
 *
 * ── Wofür ───────────────────────────────────────────────────────────
 * Shadows.darfWerfen() entschied bisher allein über Namensregeln, welches
 * Mesh Schatten wirft. Ein Regex über Namen ist aber eine LISTE: Sie wird
 * bei jedem neuen Modell stillschweigend falsch, und zwar in beide
 * Richtungen — ein neuer Kleinkram-Name steht nicht drin und wirft
 * grundlos durch alle Kaskaden, ein umbenanntes Prefab fällt plötzlich
 * heraus. Eine gemessene Höhe kann das nicht: Sie kommt aus der
 * Geometrie, die tatsächlich gezeichnet wird.
 *
 * ── Warum HIER gemessen wird und nicht in Shadows ────────────────────
 * Ein Master steht im Ursprung, seine Hülle umfasst nach
 * `thinInstanceSetBuffer` ALLE Instanzen — ihre Y-Ausdehnung ist die
 * Höhenstreuung des Geländes, nicht die Höhe der Pflanze. Die Höhe eines
 * Exemplars ergibt sich erst aus der ROHEN Hülle (`getRawBoundingInfo`,
 * vor den Instanzen) mal der Skalierung, die in der Instanzmatrix steckt.
 * Beides liegt genau hier zusammen: die Rohhülle am Mesh, die Matrizen im
 * Puffer, den diese Funktion gerade schreibt.
 *
 * Genommen wird die GRÖSSTE Skalierung im Puffer und die größte der drei
 * Spaltennormen — bewusst konservativ nach oben. Eine überschätzte Höhe
 * lässt einen Werfer in der Liste; eine unterschätzte löscht einen
 * sichtbaren Schatten, und das ist der Fehler, den man im Bild sucht und
 * nicht findet.
 *
 * Measured once per master when its instance buffer is written: raw model
 * height times the largest instance scale, rounded up on purpose.
 */
const MODELL_HOEHE = new WeakMap<Mesh, number>();

function merkeModellHoehe(mesh: Mesh, daten: Float32Array | null): void {
  // Leerer Puffer: Die Messung des vorigen Aufbaus behalten. Ein
  // abgeschalteter Zell-Master kommt aus dem Pool mit derselben Geometrie
  // zurück, und Shadows.darfWerfen() lässt abgeschaltete Meshes ohnehin
  // ungeprüft stehen.
  if (daten === null || daten.length < 16) return;
  const roh = mesh.getRawBoundingInfo().boundingBox;
  MODELL_HOEHE.set(mesh, (roh.maximum.y - roh.minimum.y) * groessteInstanzSkala(daten));
}

/**
 * Die grösste Skalierung in einem Instanzpuffer — reine Rechnung, ohne
 * Szene testbar (client/test/modell-hoehe.ts).
 *
 * Genommen wird je Instanz die GRÖSSTE der drei Spaltennormen und davon
 * das Maximum über alle Instanzen. Das überschätzt eine ungleichmässig
 * skalierte oder gekippte Instanz bewusst — und zwar in die richtige
 * Richtung: Ein zu grosser Wert lässt einen Werfer in der Liste, ein zu
 * kleiner löscht einen sichtbaren Schatten.
 */
export function groessteInstanzSkala(daten: ArrayLike<number>): number {
  let skala = 0;
  for (let o = 0; o + 16 <= daten.length; o += 16) {
    const sx = Math.hypot(daten[o]!, daten[o + 1]!, daten[o + 2]!);
    const sy = Math.hypot(daten[o + 4]!, daten[o + 5]!, daten[o + 6]!);
    const sz = Math.hypot(daten[o + 8]!, daten[o + 9]!, daten[o + 10]!);
    const groesste = sx > sy ? (sx > sz ? sx : sz) : sy > sz ? sy : sz;
    if (groesste > skala) skala = groesste;
  }
  return skala;
}

/**
 * Die gemessene Höhe eines Exemplars dieses Masters, oder `undefined`.
 *
 * `undefined` heisst „nicht gemessen", NICHT „klein": Gelände, Spieler,
 * Dungeon-Architektur und Himmel laufen nie durch `schreibeInstanzen()`.
 * Der Aufrufer muss diesen Fall als „darf werfen" behandeln — ein
 * fehlender Messwert darf niemals einen Schatten löschen.
 */
export function gemesseneModellHoehe(mesh: AbstractMesh): number | undefined {
  return MODELL_HOEHE.get(mesh as Mesh);
}

/**
 * Einen Knoten als ORTSFEST kennzeichnen: Weltmatrix einfrieren.
 *
 * ── Was das spart ───────────────────────────────────────────────────
 * Babylon ruft in `_evaluateActiveMeshes()` für jedes eingeschaltete Mesh
 * `computeWorldMatrix()` (scene.js:3837). Ohne Einfrieren vergleicht das
 * jedes Bild den gesamten Transformations-Cache gegen den Ist-Zustand
 * (`isSynchronized()`); eingefroren steigt es in der ersten Zeile aus
 * (transformNode.js:895). Für Master, die per Definition im Ursprung
 * stehen, ist dieser Vergleich reine Arbeit ohne Ergebnis.
 *
 * ── Wo aufgetaut werden MUSS ────────────────────────────────────────
 * Ein eingefrorener Knoten, den jemand später versetzt, bleibt stehen —
 * ohne Fehlermeldung, ohne Symptom ausser „das Objekt ist am falschen
 * Ort". Deshalb wird hier NICHT pauschal eingefroren, sondern nur an den
 * drei Stellen, die wissen, dass ihr Mesh ortsfest ist:
 *
 *   · `zellMeshHolen()` — Zell-Master tragen Weltmatrizen in ihren Thin
 *     Instances und stehen selbst im Ursprung (s. AssetManager.zuMaster).
 *     Das Streaming versetzt sie NIE; es schreibt nur ihren Instanzpuffer
 *     neu, und `thinInstanceSetBuffer` spannt die Hülle über
 *     `_updateBoundingInfo()` aus der (eingefrorenen) Weltmatrix neu auf —
 *     das funktioniert mit eingefrorener Matrix unverändert.
 *   · `rebuildBucketColliders()` — der `col_`-Träger, aus demselben Grund.
 *   · `AssetManager.zuMaster()` — der Prefab-Master selbst.
 *
 * AUSDRÜCKLICH NICHT eingefroren wird in `zellMeshAusPrototyp()`, obwohl
 * das der bequemste Ort wäre: `BaumImpostor` baut seine Backmeshes über
 * genau diese Funktion und hängt sie danach an einen Halter, den es für
 * die acht Ansichten dreht (BaumImpostor.ts:740 ff.). Eingefroren blieben
 * Rinde und Laub im Ursprung übereinanderliegen und alle acht Ansichten
 * zeigten dasselbe Bild — ein Fehler ohne Absturz und ohne Warnung.
 *
 * Wer einen so gekennzeichneten Knoten doch bewegen will, ruft
 * `unfreezeWorldMatrix()` davor. Kein stiller Weg daran vorbei.
 *
 * Freeze only where the caller knows the node is fixed in place; the
 * impostor baker moves meshes built by the same factory function.
 */
export function alsOrtsfestEinfrieren(mesh: AbstractMesh): void {
  mesh.freezeWorldMatrix();
}

/**
 * Rohgeometrie je Prototyp-Master, EINMAL aus dem Mesh gezogen.
 *
 * Modulweit und über eine WeakMap, damit sie mit dem Prototyp stirbt und
 * damit `zellMeshAusPrototyp()` ohne Manager-Instanz benutzbar bleibt —
 * client/test/master-huelle.ts prüft damit den echten Bauweg statt einer
 * Nachbildung.
 */
const ZELL_GEOMETRIE = new WeakMap<Mesh, VertexData>();

/**
 * Ein Zell-Master aus einem Prototyp-Master (E19 c).
 *
 * ── Warum VertexData und nicht mesh.clone() ──────────────────────────
 * Der Kardinalfehler dieses Umbaus wäre geteilte Geometrie. Babylon hängt
 * die Instanzmatrizen NICHT ans Mesh, sondern an die Geometry:
 * `thinInstanceSetBuffer('matrix', …)` legt die Vertexpuffer world0..3
 * über `mesh.setVerticesBuffer()` an (thinInstanceMesh.js:88 →
 * mesh.js:1396), und `mesh.clone()` reicht die Geometry der Quelle
 * einfach weiter (mesh.js:350). Zwei Zell-Master auf einer Geometry
 * überschrieben sich also gegenseitig ihre Instanzen, und
 * `geometry._updateBoundingInfo()` zöge obendrein die Hülle des anderen
 * mit (geometry.js:283). Symptom wäre kein Fehler, sondern das aus
 * Anlauf 2 bekannte „ganze Bäume verschwinden" (Leitplanke 2).
 *
 * `VertexData.applyToMesh()` auf einem frischen Mesh legt dagegen eine
 * EIGENE Geometry samt eigener BoundingInfo an — derselbe Weg, den
 * GrassClutter.buildCell() seit jeher für seine Zellen geht. Die
 * CPU-seitigen Typed Arrays werden dabei zwischen den Zellen geteilt
 * (das ist gewollt und billig), die GPU-Puffer nicht.
 *
 * `_ExtractFrom` zieht ausschliesslich bekannte Attribute (Positionen,
 * Normalen, Tangenten, UVs, Farben, Skinning-Gewichte, Indizes,
 * mesh.vertexData.js:952) — die Instanzpuffer world0..3 sind NICHT
 * dabei. Der Prototyp darf zum Zeitpunkt des Ziehens also ruhig noch
 * einen Matrixpuffer aus dem ungeschnittenen Betrieb tragen.
 *
 * Materialien werden GETEILT, nicht kopiert: WindPlugin,
 * ShadowDepthWrapper und GlutPuls hängen je Material genau einmal
 * (AssetManager.setzeWind), ein Material je Zelle hiesse Shaderkompilate
 * je Zelle. `sideOrientation` muss dagegen mitkommen — zuMaster() bäckt
 * dort die Determinantenkorrektur der GLB-Hierarchie ein, ohne sie sind
 * die hohlen Felsen und halbierten Stämme zurück.
 */
export function zellMeshAusPrototyp(proto: Mesh, name: string, scene: Scene): Mesh {
  let vd = ZELL_GEOMETRIE.get(proto);
  if (!vd) {
    vd = VertexData.ExtractFromMesh(proto, true, true);
    /*
      Die Instanz-Tönung kommt hier NICHT mit, und zwar von selbst:
      `ExtractFromMesh` liest `color`, unsere Tönung liegt aber unter
      `instanceColor` (Babylon schaltet den `kind` in
      `thinInstanceSetBuffer` um — s. darfGetoentWerden). Hier stand
      einmal ein Längenabgleich, der genau das verhindern sollte; er
      wurde entfernt, weil er einen Fall abfing, den es nicht gibt, und
      damit eine falsche Erklärung im Quelltext festhielt.
    */
    ZELL_GEOMETRIE.set(proto, vd);
  }
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = proto.material;
  mesh.sideOrientation = proto.sideOrientation;
  mesh.isPickable = false;
  mesh.receiveShadows = proto.receiveShadows;
  mesh.renderingGroupId = proto.renderingGroupId;
  mesh.alphaIndex = proto.alphaIndex;
  // Die Refraktionsauswahl hängt an der Objektidentität. Ein Zell-Master
  // bekommt eine neue Identität und muss die semantische Markierung seines
  // Prototyps deshalb ausdrücklich übernehmen.
  if (istGestreuteLandschaft(proto)) markiereAlsGestreuteLandschaft(mesh);
  // ── Frustum-Culling BLEIBT AN — und wird hier erst richtig wirksam ──
  // Fortschreibung der D10-Begründung aus AssetManager.zuMaster(): Dort
  // ist festgehalten, dass `alwaysSelectAsActiveMesh = true` gefallen ist,
  // weil Babylon den Hüllkörper über alle Thin Instances nachführt — und
  // zugleich, dass das FÜR GESTREUTE VEGETATION NICHTS BRINGT, weil ihre
  // Instanzen den Spieler umschliessen und die Hülle damit jede
  // Frustumprüfung besteht.
  //
  // Genau diese Einschränkung kippt mit dem Zellschnitt. Die Hülle eines
  // Zell-Masters umfasst nur noch eine 128-m-Kachel (rund 90 m Radius
  // plus Kronenhöhe plus 1,5 m Windreserve) statt der 425 m des alten
  // Vollmasters. Damit fallen Zellen hinter der Kamera im Bildpass weg
  // und ferne Zellen über Shadows.darfWerfen() aus der Werferliste —
  // das ist der ganze Zweck des Umbaus (E19 c, Befund E20: 85 % der
  // Einreichungen je Kaskade waren umsonst).
  //
  // Das Flag hier „sicherheitshalber" zurückzuholen, machte den Umbau
  // wirkungslos: Es würde jede Zelle wieder bedingungslos einreichen.
  // Die Gegenzusicherung liefert client/test/master-huelle.ts — der
  // Hüllkörper enthält jede Instanz vollständig, und die ferne Zelle
  // fällt aus dem Frustum, während die Zelle um den Spieler bleibt.
  mesh.alwaysSelectAsActiveMesh = false;
  mesh.computeWorldMatrix(true);
  mesh.setEnabled(false);
  return mesh;
}

export { netzAusMastern, schreibeInstanzen };
