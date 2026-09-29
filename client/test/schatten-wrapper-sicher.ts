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
 *     und wirft nach dem erneuten Anmelden wieder (Shadows.pruefeWrapperWerferBereitschaft).
 *     Das laeuft JEDES Bild, nicht mehr im alten 15er-Takt (TIEFE_PRUEF_TAKT, entfernt) —
 *     der Takt liess bis zu 15 Bilder ohne jeden Werfer zu (Angriffsbericht F1).
 *  7. Solange er wartet, wirft die Quelle mit — genau einmal je Wiedereinreih-Tick
 *     angemeldet, nicht doppelt (Pruefung UND Warteschleife). Gibt der Klon nach
 *     TIEFE_MAX_VERSUCHEN auf, wirft die Quelle dauerhaft weiter, UND der Klon
 *     verlaesst die renderList (F2) — sonst droht ein dauerhafter Doppelwurf, wenn
 *     er spaeter doch noch bereit wird.
 *  8. Waechter in pruefeWrapperWerferBereitschaft: ein nicht mehr bereiter Stand,
 *     einer ohne aktive Instanzen, einer, der zum Packen ansteht, und ein schon
 *     bereiter Klon werden nicht angefasst.
 *  9. Ein Klon, der seine Tiefe zum ZWEITEN Mal verliert, startet wieder bei
 *     null Versuchen (F3/X3) — sonst gibt er beim zweiten Verlust zu frueh auf.
 * 10. B1 (Nachangriff #105 N1): ein aufgegebener Klon bleibt nach einem
 *     Neubestimmen der Werferliste OHNE Neupacken (z.B. setDistantShadows)
 *     aus der renderList ausgeschlossen und kommt erst nach einer echten,
 *     erfolgreichen Uebergabe zurueck.
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
  // Wiedereinreihung schon im naechsten Bild (F1, kein Takt mehr) + TIEFE_MAX_VERSUCHE
  // (1200) bis zum Aufgeben; 20 Bilder Luft.
  for (let i = 0; i < 1220; i++) shadows.tick();
  pruefe(shadows.vegetationsSchattenStats().tiefeWartend === 0, 'Klon gibt nach TIEFE_MAX_VERSUCHEN nicht auf');
  pruefe(liste.includes(laub), 'Quelle wirft nach dem Aufgeben nicht mehr — sie muesste jetzt dauerhaft werfen');
  // F2: der aufgegebene Klon MUSS aus der renderList verschwinden. Sonst bleibt er
  // dort als abgeschriebener, aber weiter eingetragener Werfer stehen — wird er
  // spaeter (ausserhalb dieser Buchfuehrung, z.B. durch einen echten Farbpass)
  // doch noch bereit, wirft er zusammen mit der laengst zurueckgeholten Quelle
  // dauerhaft doppelt.
  pruefe(!liste.includes(klon), 'ein aufgegebener Klon bleibt Werfer in der renderList (F2: droht dauerhaften Doppelwurf)');
  for (let i = 0; i < 5; i++) shadows.tick();
  pruefe(shadows.vegetationsSchattenStats().tiefeWartend === 0, 'ein aufgegebener Klon wird wieder in die Warteliste aufgenommen');
  pruefe(!liste.includes(klon), 'ein aufgegebener Klon kommt ohne Neupacken wieder in die renderList');
  scene.dispose();
  engine.dispose();
}

// ── B1: aufgegebener Klon bleibt nach Rescan ohne Neupacken draussen (Nachangriff #105 N1) ──
// Ohne vegetationsAufgegebeneKlone nahm ein Neubestimmen der Werferliste OHNE
// Neupacken (z.B. setDistantShadows) einen aufgegebenen Klon ueber darfWerfen()
// wieder in die renderList auf — Doppelwurf mit der weiter werfenden Quelle.
{
  const { engine, scene, shadows, fake, liste, laub, klon } = bauSchattenSzene();
  const material = klon.material as PBRMaterial;
  material.resetDrawCache();
  fake.bereit = false;
  // Wie in 7b: bis TIEFE_MAX_VERSUCHE (1200) aufgeben, 20 Bilder Luft.
  for (let i = 0; i < 1220; i++) shadows.tick();
  pruefe(!liste.includes(klon), 'Vorbedingung: der aufgegebene Klon steht noch in der renderList');
  pruefe(liste.includes(laub), 'Vorbedingung: die Quelle wirft nach dem Aufgeben nicht weiter');

  // Neubestimmen OHNE Neupacken: setDistantShadows durchsucht scene.meshes
  // erneut ueber darfWerfen(), ruehrt vegetationsPackPending aber nicht an.
  shadows.setDistantShadows(false);
  shadows.tick();
  shadows.tick();
  pruefe(
    !liste.includes(klon),
    'B1: ein aufgegebener Klon ist nach setDistantShadows (Rescan ohne Neupacken) wieder in der renderList — droht Doppelwurf mit der Quelle'
  );
  pruefe(liste.includes(laub), 'B1: die Quelle wirft nach dem Rescan nicht mehr, obwohl der Klon weiter aufgegeben ist');

  // Ein zweiter Rescan ohne Neupacken aendert daran nichts (keine einmalige Ausnahme).
  shadows.setDistantShadows(true);
  shadows.tick();
  shadows.tick();
  pruefe(!liste.includes(klon), 'B1: ein zweiter Rescan ohne Neupacken nimmt den aufgegebenen Klon doch noch auf');

  // Eine ECHTE Uebergabe (Neupacken, danach bereit) hebt die Sperre wieder auf.
  // 17 m liegt > NACHFUEHR_ABSTAND (16 m, loest ein Neupacken aus), die
  // Instanzen (x=0,2,4) bleiben aber im Auswahlradius — anders als bei
  // 200 m, wo der radiale Packer keine Instanz mehr packt (aktiv=0) und
  // die Pruefung ueber den Leerpack-Zweig liefe, ohne dass eine echte
  // Uebergabe stattfindet (Nachangriff #119 N2, Auflage N2-1).
  fake.bereit = true;
  shadows.setPlayerPosition(17, 0);
  for (let i = 0; i < 5; i++) shadows.tick();
  const internStand = shadows as unknown as {
    vegetationsSchatten: Map<Mesh, { aktiv: number; tiefeBereit: boolean }>;
  };
  const stand = internStand.vegetationsSchatten.get(laub)!;
  pruefe(
    stand.aktiv > 0,
    'B1: nach der Uebergabe packt der Stand keine Instanz (aktiv=0) — die Pruefung liefe ueber den Leerpack-Zweig statt ueber eine echte Uebergabe'
  );
  pruefe(stand.tiefeBereit === true, 'B1: nach der Uebergabe ist der Tiefen-Eintrag nicht bereit');
  pruefe(liste.includes(klon) && !liste.includes(laub), 'nach einer echten Uebergabe nach dem Neupacken wirft nicht der Klon allein');

  // Ein weiterer Rescan OHNE Neupacken (z.B. setDistantShadows) darf die
  // echte Uebergabe nicht wieder aufheben.
  shadows.setDistantShadows(false);
  shadows.tick();
  shadows.tick();
  pruefe(
    liste.includes(klon) && !liste.includes(laub),
    'B1: ein weiterer Rescan ohne Neupacken wirft die echte Uebergabe wieder um'
  );

  scene.dispose();
  engine.dispose();
}

// ── F1: keine Bild-Luecke mehr, unabhaengig vom alten 15er-Takt ─────────
// Reproduziert genau die Karten-Zusage: ein Klon, der IRGENDWANN zwischen
// zwei frueheren Pruefzeitpunkten (TIEFE_PRUEF_TAKT=15, jetzt entfernt)
// seinen Tiefen-Eintrag verliert, wirft schon im naechsten Bild wieder ueber
// die Quelle — nicht erst nach bis zu 15 Bildern (Angriffsbericht F1: 17 von
// 39 Klonen 4-8 Bilder lang ohne jeden Werfer).
{
  const { engine, scene, shadows, fake, liste, laub, klon } = bauSchattenSzene();
  const material = klon.material as PBRMaterial;

  // Ein paar "normale" Bilder zwischendurch, wie im Spiel — bewusst NICHT auf
  // einem Vielfachen des alten Takts (7 statt z.B. 15 oder 30).
  for (let i = 0; i < 7; i++) shadows.tick();
  pruefe(liste.includes(klon) && !liste.includes(laub), 'Vorbedingung: der Klon wirft nach 7 ruhigen Bildern noch allein');

  material.resetDrawCache();
  fake.bereit = false;
  shadows.tick(); // GENAU EIN Bild nach dem Verlust
  pruefe(
    liste.includes(laub) || liste.includes(klon),
    'im ersten Bild nach dem Verlust wirft weder Klon noch Quelle — genau die Luecke, die F1 schliessen sollte'
  );
  pruefe(
    liste.includes(laub),
    'im ersten Bild nach dem Verlust wirft die Quelle noch nicht wieder mit (die Erkennung braeuchte noch bis zu 14 weitere Bilder)'
  );

  scene.dispose();
  engine.dispose();
}

// ── F3/X3: ein Klon, der seine Tiefe zum ZWEITEN Mal verliert, faengt wieder bei 0 an ──
// Ohne das Zuruecksetzen von tiefeVersuche beim Wiedereinreihen erbt der Klon die
// Versuche aus dem ERSTEN Verlust und gibt beim zweiten viel zu frueh auf.
{
  const { engine, scene, shadows, fake, liste, laub, klon } = bauSchattenSzene();
  const material = klon.material as PBRMaterial;

  // Erster Verlust: 1000 Versuche sammeln (unter TIEFE_MAX_VERSUCHE=1200), dann bereit.
  material.resetDrawCache();
  fake.bereit = false;
  shadows.tick(); // Verlust erkannt, tiefeVersuche auf 0, 1 Versuch in diesem Bild
  for (let i = 0; i < 999; i++) shadows.tick();
  pruefe(shadows.vegetationsSchattenStats().tiefeWartend === 1, 'Vorbedingung: der Klon wartet nach 1000 Versuchen noch (unter TIEFE_MAX_VERSUCHEN)');
  fake.bereit = true;
  shadows.tick(); // wird bereit, uebernimmt wieder — tiefeVersuche bleibt bei 1000 stehen, falls X3 nicht behoben ist
  pruefe(liste.includes(klon) && !liste.includes(laub), 'Vorbedingung: nach dem ersten Verlust wirft wieder allein der Klon');

  // Zweiter Verlust: mit dem Fix braucht es wieder bis zu TIEFE_MAX_VERSUCHEN (1200), nicht nur
  // die Differenz zu den 1000 aus dem ersten Verlust (sonst gaebe X3 nach 200 weiteren auf).
  material.resetDrawCache();
  fake.bereit = false;
  for (let i = 0; i < 200; i++) shadows.tick();
  pruefe(
    shadows.vegetationsSchattenStats().tiefeWartend === 1,
    'X3: der Klon hat nach dem zweiten Verlust schon nach 200 weiteren Versuchen aufgegeben — tiefeVersuche wurde beim Wiedereinreihen nicht zurueckgesetzt'
  );
  pruefe(liste.includes(laub), 'die Quelle wirft waehrend des zweiten Wartens nicht mit');

  scene.dispose();
  engine.dispose();
}

// ── 8. Waechter in pruefeWrapperWerferBereitschaft: bereit, aktiv=0, PackPending, schon bereit ──
{
  const { engine, scene, shadows, fake, liste, laub: laubBereit, klon: klonBereit } = bauSchattenSzene();
  type StandTest = { quelle: Mesh; schatten: Mesh; bereit: boolean; tiefeBereit: boolean; tiefeVersuche: number; aktiv: number };
  type Intern = {
    vegetationsWrapperWerfer: Set<StandTest>;
    vegetationsPackPending: Set<StandTest>;
    vegetationsTiefePending: Set<StandTest>;
    vegetationsSchatten: Map<Mesh, StandTest>;
    pruefeWrapperWerferBereitschaft(g: unknown): void;
  };
  const intern = shadows as unknown as Intern;
  // Echte Vorlage bauen (wie bauSchattenSzene/meldeKlonAnBasisEffekt) und DANACH
  // per resetDrawCache verlieren: nur so wuerde die Pruefung ohne ihren jeweiligen
  // Waechter wirklich einen Verlust erkennen — sonst gilt "nie angemeldet" als
  // "noch nichts zu kopieren" (vorlageHatDefines) und der Waechter waere nie zu
  // unterscheiden von seinem Fehlen.
  const baueStand = (name: string, opts: { bereit: boolean; aktiv: number }): StandTest => {
    const quelle = new Mesh(`${name}_q`, scene);
    const klon = new Mesh(`${name}_k`, scene);
    const vd = new VertexData();
    vd.positions = [0, 0, 0, 1, 0, 0, 0, 2, 0];
    vd.indices = [0, 1, 2];
    vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    vd.uvs = [0, 0, 1, 0, 0, 1];
    vd.applyToMesh(klon);
    const material = new PBRMaterial(`${name}_mat`, scene);
    material.shadowDepthWrapper = new SicherTiefenWrapper(material, scene, { doNotInjectCode: true });
    klon.material = material;
    const teil = klon.subMeshes[0]!;
    material.isReadyForSubMesh(klon, teil, false);
    teil.resetDrawCache();
    return { quelle, schatten: klon, bereit: opts.bereit, tiefeBereit: true, tiefeVersuche: 0, aktiv: opts.aktiv };
  };

  // Ein Stand, der nicht mehr bereit ist (z.B. anderswo schon zurueckgeholt): lose
  // Raeumung, nicht als Verlust behandelt.
  const standNichtBereit = baueStand('w1', { bereit: false, aktiv: 3 });
  intern.vegetationsWrapperWerfer.add(standNichtBereit);
  // Ein Stand ohne aktive Instanzen (vollstaendig weggekuellt).
  const standAktivNull = baueStand('w2', { bereit: true, aktiv: 0 });
  intern.vegetationsWrapperWerfer.add(standAktivNull);
  // Ein Stand, der zum Packen ansteht — das Packen entscheidet, nicht diese Pruefung.
  const standPackend = baueStand('w3', { bereit: true, aktiv: 3 });
  intern.vegetationsPackPending.add(standPackend);
  intern.vegetationsWrapperWerfer.add(standPackend);

  // B3 (Nachangriff #105 N1, Befund B3/M7): Tiefen-Eintrag schon GEBAUT, bevor
  // die Vorlage per resetDrawCache ihre defines verliert — genau der Zweig, den
  // tiefeSchonGebaut() bewacht. Babylon kopiert nur beim ANLEGEN eines Eintrags;
  // ein schon gebauter bleibt gueltig. Ohne diesen Fall im Test bleibt die
  // Mutante "tiefeSchonGebaut aus dem Praedikat gestrichen" gruen, weil die
  // Attrappen-Generatoren der anderen Staende nie einen Eintrag anlegen.
  const standTiefeGebaut = (() => {
    const name = 'w4';
    const quelle = new Mesh(`${name}_q`, scene);
    const klon = new Mesh(`${name}_k`, scene);
    const vd = new VertexData();
    vd.positions = [0, 0, 0, 1, 0, 0, 0, 2, 0];
    vd.indices = [0, 1, 2];
    vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    vd.uvs = [0, 0, 1, 0, 0, 1];
    vd.applyToMesh(klon);
    const material = new PBRMaterial(`${name}_mat`, scene);
    const wrapper = new SicherTiefenWrapper(material, scene, { doNotInjectCode: true });
    material.shadowDepthWrapper = wrapper;
    klon.material = material;
    const teil = klon.subMeshes[0]!;
    material.isReadyForSubMesh(klon, teil, false);
    // Vorlage als fertig ausgeben, wie zustandNachReset() oben — sonst baut
    // wrapper.isReadyForSubMesh() auf der NullEngine keinen echten Eintrag.
    const vorlage = (wrapper as unknown as Tabellen)._subMeshToEffect.get(teil)?.[0] as object | undefined;
    if (vorlage) {
      Object.defineProperty(vorlage, 'isReady', { value: () => true });
      Object.defineProperty(vorlage, 'vertexSourceCodeBeforeMigration', { value: 'void main(){}' });
      Object.defineProperty(vorlage, 'fragmentSourceCodeBeforeMigration', { value: 'void main(){}' });
    }
    // Eintrag anlegen, keyed auf `fake` — denselben Generator, den
    // pruefeWrapperWerferBereitschaft(fake) unten befragt.
    wrapper.isReadyForSubMesh(teil, [], fake as unknown as ShadowGenerator, false, 0);
    teil.resetDrawCache();
    return { quelle, schatten: klon, bereit: true, tiefeBereit: true, tiefeVersuche: 0, aktiv: 3 };
  })();
  const wDrawWrapper = (standTiefeGebaut.schatten.material as PBRMaterial).shadowDepthWrapper!;
  pruefe(
    !vorlageHatDefines(wDrawWrapper, standTiefeGebaut.schatten.subMeshes[0]!),
    'Ausgangslage B3: die Vorlage hat nach dem Reset noch defines — der Test misst nichts'
  );
  intern.vegetationsWrapperWerfer.add(standTiefeGebaut);

  intern.pruefeWrapperWerferBereitschaft(fake);

  pruefe(!intern.vegetationsWrapperWerfer.has(standNichtBereit), 'ein nicht mehr bereiter Stand blieb in der Menge stehen');
  pruefe(!intern.vegetationsTiefePending.has(standNichtBereit), 'ein nicht mehr bereiter Stand wurde trotzdem als Verlust behandelt');
  pruefe(!intern.vegetationsWrapperWerfer.has(standAktivNull), 'ein Stand ohne aktive Instanzen blieb in der Menge stehen');
  pruefe(!intern.vegetationsTiefePending.has(standAktivNull), 'ein Stand ohne aktive Instanzen wurde trotzdem angefasst');
  pruefe(!liste.includes(standAktivNull.quelle), 'die Quelle eines Stands ohne aktive Instanzen wurde trotzdem als Werfer angemeldet');
  pruefe(!intern.vegetationsWrapperWerfer.has(standPackend), 'ein zum Packen anstehender Stand blieb in der Menge stehen');
  pruefe(!intern.vegetationsTiefePending.has(standPackend), 'ein zum Packen anstehender Klon wurde trotzdem angefasst');
  pruefe(!liste.includes(standPackend.quelle), 'die Quelle eines zum Packen anstehenden Stands wurde trotzdem als Werfer angemeldet');

  // B3: ein schon GEBAUTER Tiefen-Eintrag gilt weiter, auch ohne defines an der
  // Vorlage — die Mutante "tiefeSchonGebaut gestrichen" muss hier rot werden.
  pruefe(
    intern.vegetationsWrapperWerfer.has(standTiefeGebaut),
    'B3: ein Klon mit schon gebautem Tiefen-Eintrag wurde nach resetDrawCache faelschlich als Verlust behandelt'
  );
  pruefe(
    !intern.vegetationsTiefePending.has(standTiefeGebaut),
    'B3: ein Klon mit schon gebautem Tiefen-Eintrag landete trotzdem in der Warteliste'
  );
  pruefe(
    !liste.includes(standTiefeGebaut.quelle),
    'B3: die Quelle eines Klons mit schon gebautem Tiefen-Eintrag wurde grundlos wieder als Werfer angemeldet'
  );

  // Gegenprobe: ein wirklich bereiter Klon (echter Wrapper, echte defines aus
  // bauSchattenSzene) wird nicht angefasst.
  const standBereit = intern.vegetationsSchatten.get(laubBereit)!;
  pruefe(intern.vegetationsWrapperWerfer.has(standBereit), 'Vorbedingung: der echte, bereite Klon steht in der Menge');
  pruefe(!intern.vegetationsTiefePending.has(standBereit), 'ein wirklich bereiter Klon wurde in die Warteliste verschoben');
  pruefe(liste.includes(klonBereit), 'ein wirklich bereiter Klon verlor seinen Platz in der renderList');

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
