/**
 * Schatten: der Tiefen-Wrapper baut nie aus einer Vorlage ohne `defines` (WebGPU-Stillstand).
 * Shadow depth wrapper never builds from a base effect that lost its `defines`.
 *
 * Unter WebGPU brach in etwa 10 % der Ladevorgaenge der Schattenpass ab
 * (`Can't find buffer "Material" in the draw context`, danach `createBindGroup`
 * in jedem Bild, onAfterRender feuerte nie wieder): Wird der Draw-Cache eines
 * Sub-Meshes zurueckgesetzt, nachdem der Farbpass seinen Effekt angelegt hat
 * (etwa weil ein Material-Plugin nachtraeglich angehaengt wird), kopiert
 * Babylons `ShadowDepthWrapper` `defines = null`; `bindForSubMesh` kehrt dann
 * ohne zu binden zurueck. Drei Zusicherungen:
 *
 *  1. Babylon-Zeuge: der unbewachte Wrapper legt in diesem Zustand einen Eintrag
 *     mit `defines == null` an (faellt der Test, hat Babylon das Verhalten
 *     geaendert und der Schutz gehoert neu bewertet).
 *  2. `SicherTiefenWrapper` meldet in diesem Zustand „nicht bereit" und legt
 *     keinen Eintrag an.
 *  3. Legt der Farbpass die Vorlage neu an, wird der Sub-Mesh wieder bereit.
 *  4. Ist der Tiefen-Eintrag schon gebaut, gilt er weiter, auch wenn die Vorlage
 *     danach zurueckgesetzt wird (Babylon kopiert nur beim Anlegen). Sonst verlieren
 *     Klone ohne Farbpass (G20) ihren Schatten dauerhaft.
 *  5. `defines` als String zaehlt als vorhanden.
 *  6. Ein uebergebener Klon, dessen Effekt nach `resetDrawCache` fehlt, wartet wieder
 *     und wirft nach dem erneuten Anmelden wieder (Shadows.pruefeUebergebeneKlone).
 *  7. Solange er wartet, wirft die Quelle mit — genau einmal je Wiedereinreih-Tick
 *     angemeldet, nicht doppelt (Pruefung UND Warteschleife). Gibt der Klon nach
 *     TIEFE_MAX_VERSUCHEN auf, wirft die Quelle dauerhaft weiter.
 *  8. Waechter in pruefeUebergebeneKlone: ein Stand ohne aktive Instanzen, einer, der
 *     zum Packen ansteht, und ein schon bereiter Klon werden nicht angefasst; die
 *     Pruefung selbst laeuft mit useInstances=true.
 *
 * Lauf: npx tsx client/test/schatten-wrapper-sicher.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShadowDepthWrapper } from '@babylonjs/core/Materials/shadowDepthWrapper';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Shadows } from '../src/engine/Shadows';
import { SicherTiefenWrapper, erzeugeTiefenWrapper, vorlageHatDefines } from '../src/engine/ShadowDepthWrapperSicher';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Schatten: Tiefen-Wrapper ohne veraltete Vorlage');

type Tabellen = {
  _subMeshToEffect: Map<unknown, [unknown, number]>;
  _subMeshToDepthWrapper: { mm: Map<unknown, Map<unknown, { mainDrawWrapper: { defines: unknown } }>> };
};

/** Mesh + Material, Farbpass-Vorlage angelegt, Draw-Cache danach zurueckgesetzt. */
function zustandNachReset(mitSicherung: boolean) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mesh = new Mesh('laub', scene);
  const vd = new VertexData();
  vd.positions = [0, 0, 0, 1, 0, 0, 0, 2, 0];
  vd.indices = [0, 1, 2];
  vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  vd.uvs = [0, 0, 1, 0, 0, 1];
  vd.applyToMesh(mesh);
  const material = new PBRMaterial('laub_mat', scene);
  // `doNotInjectCode`: kein #include im Fake-Quelltext, NullEngine kann keine Shader laden.
  const optionen = { doNotInjectCode: true };
  const wrapper = mitSicherung ? new SicherTiefenWrapper(material, scene, optionen) : new ShadowDepthWrapper(material, scene, optionen);
  material.shadowDepthWrapper = wrapper;
  mesh.material = material;
  const teil = mesh.subMeshes[0]!;
  const vorher = { vorlage: (wrapper as unknown as Tabellen)._subMeshToEffect.has(teil) };
  material.isReadyForSubMesh(mesh, teil, false);
  // NullEngine uebersetzt nichts: die Vorlage bekommt Quelltext und gilt als fertig, damit der
  // Wrapper bis `createEffect` kommt wie auf der GPU. / Fake source + ready so the wrapper gets as far as on a GPU.
  const vorlage = (wrapper as unknown as Tabellen)._subMeshToEffect.get(teil)?.[0] as
    | object
    | undefined;
  if (vorlage) {
    Object.defineProperty(vorlage, 'isReady', { value: () => true });
    Object.defineProperty(vorlage, 'vertexSourceCodeBeforeMigration', { value: 'void main(){}' });
    Object.defineProperty(vorlage, 'fragmentSourceCodeBeforeMigration', { value: 'void main(){}' });
  }
  return { engine, scene, mesh, material, wrapper, teil, vorher };
}
// Nur die Seiten des Generators, die der Wrapper anfasst, wenn er wirklich baut.
const generatorAttrappe = {} as unknown as ShadowGenerator;

// ── 1. Babylon-Zeuge: der unbewachte Wrapper kopiert `defines == null` ──
{
  const z = zustandNachReset(false);
  const w = z.wrapper as unknown as Tabellen;
  pruefe(!z.vorher.vorlage, 'der Wrapper kannte den Sub-Mesh schon vor dem Farbpass — der Test misst nichts');
  pruefe(w._subMeshToEffect.has(z.teil), 'der Farbpass hat keine Vorlage im Wrapper angelegt — Babylon-Weg geaendert');
  pruefe(vorlageHatDefines(z.wrapper, z.teil), 'nach dem Farbpass fehlen die defines der Vorlage schon ohne Reset');
  z.teil.resetDrawCache();
  pruefe(!vorlageHatDefines(z.wrapper, z.teil), 'nach resetDrawCache hat die Vorlage noch defines — der Reset trifft die Vorlage nicht');
  z.wrapper.isReadyForSubMesh(z.teil, [], generatorAttrappe, false, 0);
  const eintrag = w._subMeshToDepthWrapper.mm.get(z.teil)?.values().next().value;
  pruefe(
    eintrag !== undefined && eintrag.mainDrawWrapper.defines == null,
    'Babylon kopiert nach dem Reset keine null-defines mehr — die Sicherung ist zu ueberpruefen'
  );
  z.scene.dispose();
  z.engine.dispose();
}

// ── 2. Der bewachte Wrapper meldet „nicht bereit" und legt nichts an ──
{
  const z = zustandNachReset(true);
  const w = z.wrapper as unknown as Tabellen;
  pruefe(z.wrapper instanceof SicherTiefenWrapper, 'der Test prueft nicht den bewachten Wrapper');
  pruefe(
    erzeugeTiefenWrapper(z.material, z.scene) instanceof SicherTiefenWrapper,
    'erzeugeTiefenWrapper (der Weg, den AssetManager nimmt) liefert nicht den bewachten Wrapper'
  );
  z.teil.resetDrawCache();
  pruefe(!vorlageHatDefines(z.wrapper, z.teil), 'Ausgangslage falsch: die Vorlage hat nach dem Reset noch defines');
  const bereit = z.wrapper.isReadyForSubMesh(z.teil, [], generatorAttrappe, false, 0);
  pruefe(bereit === false, 'ohne defines meldet der Wrapper „bereit" — der Schattenpass wuerde ohne Bindung zeichnen');
  pruefe(
    !w._subMeshToDepthWrapper.mm.has(z.teil),
    'der Wrapper hat trotz fehlender defines einen Tiefen-Eintrag angelegt (kopierte null)'
  );

  // ── 3. Der Farbpass legt die Vorlage neu an: bereit ──
  z.material.isReadyForSubMesh(z.mesh, z.teil, false);
  pruefe(vorlageHatDefines(z.wrapper, z.teil), 'nach neuem Farbpass fehlen die defines der Vorlage noch');
  z.wrapper.isReadyForSubMesh(z.teil, [], generatorAttrappe, false, 0);
  const eintrag = w._subMeshToDepthWrapper.mm.get(z.teil)?.values().next().value;
  pruefe(
    eintrag !== undefined && eintrag.mainDrawWrapper.defines != null,
    'nach neuem Farbpass baut der Wrapper weiter mit null-defines'
  );
  z.scene.dispose();
  z.engine.dispose();
}

// ── 5. Eintrag schon gebaut, Vorlage danach zurueckgesetzt: bereit ──
{
  const z = zustandNachReset(true);
  const w = z.wrapper as unknown as Tabellen;
  z.material.isReadyForSubMesh(z.mesh, z.teil, false);
  pruefe(z.wrapper.isReadyForSubMesh(z.teil, [], generatorAttrappe, false, 0), 'Ausgangslage: mit defines nicht bereit');
  pruefe(w._subMeshToDepthWrapper.mm.has(z.teil), 'Ausgangslage: kein Tiefen-Eintrag gebaut');
  z.material.resetDrawCache();
  pruefe(!vorlageHatDefines(z.wrapper, z.teil), 'Ausgangslage: die Vorlage hat nach dem Reset noch defines');
  let bereitAnzahl = 0;
  for (let i = 0; i < 20; i++) if (z.wrapper.isReadyForSubMesh(z.teil, [], generatorAttrappe, false, 0)) bereitAnzahl++;
  pruefe(bereitAnzahl === 20, `gebauter Tiefen-Eintrag gesperrt: ${bereitAnzahl}/20 bereit (ein Klon ohne Farbpass verliert den Schatten dauerhaft)`);
  z.scene.dispose();
  z.engine.dispose();
}

// ── 6. String-defines gelten als vorhanden ──
{
  const z = zustandNachReset(true);
  const eintrag = (z.wrapper as unknown as Tabellen)._subMeshToEffect.get(z.teil);
  const dw = z.teil._getDrawWrapper(eintrag![1]) as unknown as { defines: unknown };
  dw.defines = 'A;B';
  pruefe(vorlageHatDefines(z.wrapper, z.teil), 'String-defines gelten nicht als vorhanden');
  z.scene.dispose();
  z.engine.dispose();
}

/** Quelle + gepackter Klon (3 Instanzen), Klon schon uebergeben; Generator-Attrappe mit Zeuge. */
function bauSchattenSzene() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const shadows = new Shadows(scene, new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene));
  const liste: Mesh[] = [];
  const fake = {
    bereit: true,
    letzteArgs: [] as unknown[],
    freezeShadowCastersBoundingInfo: false,
    numCascades: 2,
    shadowMaxZ: 50,
    addShadowCaster: (m: Mesh) => {
      if (!liste.includes(m)) liste.push(m);
    },
    getShadowMap: () => ({
      get renderList() {
        return liste;
      },
      set renderList(neu: Mesh[]) {
        liste.length = 0;
        liste.push(...neu);
      },
    }),
    isReady: (...args: unknown[]) => {
      fake.letzteArgs = args;
      return fake.bereit;
    },
    dispose: () => undefined,
  };
  const intern = shadows as unknown as { generator: unknown; stufe: number };
  intern.generator = fake;
  intern.stufe = 2;
  const laub = new Mesh('laub_q', scene);
  const vd = new VertexData();
  vd.positions = [0, 0, 0, 1, 0, 0, 0, 2, 0];
  vd.indices = [0, 1, 2];
  vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  vd.uvs = [0, 0, 1, 0, 0, 1];
  vd.applyToMesh(laub);
  const material = new PBRMaterial('laub_q_mat', scene);
  material.shadowDepthWrapper = new SicherTiefenWrapper(material, scene, { doNotInjectCode: true });
  laub.material = material;
  const matrizen = new Float32Array(16 * 3);
  for (let i = 0; i < 3; i++) {
    matrizen.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], i * 16);
    matrizen[i * 16 + 12] = i * 2;
  }
  shadows.setVegetationsInstanzen(laub, matrizen);
  shadows.setPlayerPosition(0, 0);
  const klon = scene.meshes.find((m) => m.name.startsWith('schattenVegetation_')) as Mesh;
  shadows.tick();
  shadows.tick();
  return { engine, scene, shadows, fake, liste, laub, klon };
}

// ── 7. Uebergebener Klon ohne Farbpass: nach resetDrawCache wieder im Schattenpass, ──
// ── Quelle wirft in der Luecke mit, genau einmal je Tick angemeldet ──────────────
{
  const { engine, scene, shadows, fake, liste, laub, klon } = bauSchattenSzene();
  pruefe(klon !== undefined && liste.includes(klon), 'Klon nach dem Packen nicht im Schattenpass — Ausgangslage falsch');
  pruefe(shadows.vegetationsSchattenStats().tiefeWartend === 0, 'Ausgangslage: Klon wartet noch');
  const material = klon.material as PBRMaterial;
  const teil = klon.subMeshes[0]!;

  // Der Reset trifft den Klon: Vorlage weg, Tiefen-Effekt nicht mehr bereit (wie ohne Farbpass).
  material.resetDrawCache();
  fake.bereit = false;
  const vorAnmeldungen = shadows.vegetationsSchattenStats().tiefeAnmeldungen;
  let luecke = false;
  for (let i = 0; i < 40 && !luecke; i++) {
    shadows.tick();
    if (shadows.vegetationsSchattenStats().tiefeWartend === 1) luecke = true;
  }
  pruefe(luecke, 'Klon ohne Tiefen-Effekt kommt nicht wieder auf die Warteliste');
  const nachAnmeldungen = shadows.vegetationsSchattenStats().tiefeAnmeldungen;
  pruefe(
    nachAnmeldungen - vorAnmeldungen === 1,
    `Anmeldung im Wiedereinreih-Tick nicht genau einmal (${nachAnmeldungen - vorAnmeldungen}x) — Pruefung und Warteschleife melden beide an`
  );
  pruefe(vorlageHatDefines(material.shadowDepthWrapper!, teil), 'Klon wurde nach dem Reset nicht neu angemeldet — die Vorlage bleibt ohne defines');
  pruefe(liste.includes(laub), 'Quelle wirft nicht, waehrend der Klon in der Luecke wartet — es gibt einen Frame ohne Werfer');
  const internStand = shadows as unknown as { vegetationsSchatten: Map<Mesh, { tiefeBereit: boolean }> };
  const stand = internStand.vegetationsSchatten.get(laub);
  pruefe(stand !== undefined && stand.tiefeBereit === false, 'tiefeBereit wird beim Wiedereinreihen nicht zurueckgesetzt');

  fake.bereit = true;
  shadows.tick();
  pruefe(shadows.vegetationsSchattenStats().tiefeWartend === 0, 'Klon bleibt wartend, obwohl bereit');
  pruefe(liste.includes(klon) && !liste.includes(laub), 'Klon nach dem Reset nicht wieder alleiniger Werfer');
  scene.dispose();
  engine.dispose();
}

// ── 7b. Gibt der Klon nach TIEFE_MAX_VERSUCHEN auf, wirft die Quelle dauerhaft weiter ──
{
  const { engine, scene, shadows, fake, liste, laub, klon } = bauSchattenSzene();
  const material = klon.material as PBRMaterial;
  material.resetDrawCache();
  fake.bereit = false;
  // TIEFE_PRUEF_TAKT (15) bis zur Wiedereinreihung + TIEFE_MAX_VERSUCHE (1200) bis zum Aufgeben.
  for (let i = 0; i < 1220; i++) shadows.tick();
  pruefe(shadows.vegetationsSchattenStats().tiefeWartend === 0, 'Klon gibt nach TIEFE_MAX_VERSUCHEN nicht auf');
  pruefe(liste.includes(laub), 'Quelle wirft nach dem Aufgeben nicht mehr — sie muesste jetzt dauerhaft werfen');
  for (let i = 0; i < 5; i++) shadows.tick();
  pruefe(shadows.vegetationsSchattenStats().tiefeWartend === 0, 'ein aufgegebener Klon wird wieder in die Warteliste aufgenommen');
  scene.dispose();
  engine.dispose();
}

// ── 8. Waechter in pruefeUebergebeneKlone: aktiv=0, PackPending, schon bereit, useInstances ──
{
  const { engine, scene, shadows, fake, liste } = bauSchattenSzene();
  type StandTest = { quelle: Mesh; schatten: Mesh; bereit: boolean; tiefeBereit: boolean; tiefeVersuche: number; aktiv: number };
  type Intern = {
    vegetationsSchatten: Map<Mesh, StandTest>;
    vegetationsPackPending: Set<StandTest>;
    vegetationsTiefePending: Set<StandTest>;
    pruefeUebergebeneKlone(g: unknown): void;
  };
  const intern = shadows as unknown as Intern;
  const baueStand = (name: string, aktiv: number): StandTest => {
    const quelle = new Mesh(`${name}_q`, scene);
    const klon = new Mesh(`${name}_k`, scene);
    const vd = new VertexData();
    vd.positions = [0, 0, 0, 1, 0, 0, 0, 2, 0];
    vd.indices = [0, 1, 2];
    vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    vd.uvs = [0, 0, 1, 0, 0, 1];
    vd.applyToMesh(klon);
    const stand: StandTest = { quelle, schatten: klon, bereit: true, tiefeBereit: true, tiefeVersuche: 0, aktiv };
    intern.vegetationsSchatten.set(quelle, stand);
    return stand;
  };

  // M13: ein Klon, dessen Tiefen-Effekt schon bereit ist, darf nicht angefasst werden.
  const standBereit = baueStand('m13', 3);
  intern.pruefeUebergebeneKlone(fake);
  pruefe(standBereit.tiefeBereit === true, 'M13: die Bereit-Pruefung fehlt — ein bereiter Klon wurde requeued');
  pruefe(!intern.vegetationsTiefePending.has(standBereit), 'M13: ein bereiter Klon landete in der Warteliste');

  fake.bereit = false;
  // M7: ein Stand ohne aktive Instanzen (gerade vollstaendig weggekuellt, Packen steht noch aus).
  const standAktivNull = baueStand('m7', 0);
  // M8: ein Stand, der zum naechsten Packen ansteht — das Packen entscheidet, nicht die Pruefung.
  const standPackend = baueStand('m8', 3);
  intern.vegetationsPackPending.add(standPackend);
  // M12: ein nicht bereiter Klon ohne Sonderfall — Gegenprobe, dass die Pruefung selbst greift.
  const standM12 = baueStand('m12', 3);

  intern.pruefeUebergebeneKlone(fake);

  pruefe(standAktivNull.tiefeBereit === true, 'M7: ein Stand ohne aktive Instanzen wurde trotzdem angefasst');
  pruefe(!intern.vegetationsTiefePending.has(standAktivNull), 'M7: ein Stand ohne aktive Instanzen landete in der Warteliste');
  pruefe(!liste.includes(standAktivNull.quelle), 'M7: die Quelle eines geschuetzten Stands wurde trotzdem als Werfer angemeldet');
  pruefe(standPackend.tiefeBereit === true, 'M8: ein zum Packen anstehender Klon wurde trotzdem angefasst');
  pruefe(!intern.vegetationsTiefePending.has(standPackend), 'M8: ein zum Packen anstehender Klon landete in der Warteliste');
  pruefe(!liste.includes(standPackend.quelle), 'M8: die Quelle eines zum Packen anstehenden Stands wurde trotzdem als Werfer angemeldet');
  pruefe(intern.vegetationsTiefePending.has(standM12), 'ein nicht bereiter, ungeschuetzter Klon landet nicht in der Warteliste');
  pruefe(liste.includes(standM12.quelle), 'die Quelle eines nicht bereiten, ungeschuetzten Klons wird nicht als Werfer angemeldet');
  pruefe(fake.letzteArgs[1] === true, 'die Bereit-Pruefung laeuft mit useInstances=false — falscher Effekt-Zweig');

  scene.dispose();
  engine.dispose();
}

// ── 4. Ohne Vorlage: nichts zu bewachen (Babylon meldet selbst „nicht bereit") ──
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mesh = new Mesh('leer', scene);
  new VertexData().applyToMesh(mesh);
  const material = new PBRMaterial('leer_mat', scene);
  const wrapper = erzeugeTiefenWrapper(material, scene);
  pruefe(vorlageHatDefines(wrapper, { } as never), 'ohne Vorlage meldet der Wachposten „fehlende defines"');
  scene.dispose();
  engine.dispose();
}

if (fehler > 0) {
  console.error(`✗ ${fehler} Fehler`);
  process.exit(1);
}
console.log('✓ Tiefen-Wrapper: kein Bau ohne defines');
