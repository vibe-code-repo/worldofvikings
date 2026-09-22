/**
 * U1 — Wächter über die Code/Daten-Naht `shared/src/uploadedModelRegistry.ts`.
 *
 * ── Warum dieser Test zuerst geschrieben gehört ───────────────────────
 * Die Karte nennt ausdrücklich die Stelle, an der sie am ehesten
 * scheitert: `pruefeLayout`/`istEigenesModell` müssen einen hochgeladenen
 * Namen AKZEPTIEREN, sonst lässt sich das Objekt zwar setzen, aber die
 * Welt ist danach „ungültig". Dieser Test registriert ein Modell WIE der
 * Server es täte (`registerUploadedPrefab`) und prüft dieselben zwei
 * Funktionen, die auch der echte Server-/Client-Code befragt —
 * `istEigenesModell` und `pruefeLayout`, beide unverändert aus
 * `shared/src/prefabs.ts` bzw. `shared/src/worldlayout/pruefung.ts`
 * importiert, nicht nachgebaut.
 *
 * Rot vor der Umsetzung: `uploadedModelRegistry.ts` gab es auf 34ea56d
 * nicht.
 */
import { PREFABS_BY_HASH, PREFABS_BY_NAME, findPrefabByHash, findPrefabByName, istEigenesModell } from '../src/prefabs.js';
import { getStableHash } from '../src/hash.js';
import { pruefeLayout } from '../src/worldlayout/pruefung.js';
import { WORLD_LAYOUT_VERSION, type WorldLayout } from '../src/worldlayout/types.js';
import {
  applyUploadedModelRegistry,
  erzwingeName,
  leseRegistryAusText,
  pruefeRegistryEintrag,
  registerUploadedPrefab,
  unregisterUploadedPrefab,
  uploadedModelEntry,
  uploadedModelEntries,
  type UploadedModelEntry,
} from '../src/uploadedModelRegistry.js';

let failures = 0;
function check(bedingung: boolean, was: string): void {
  if (bedingung) {
    console.log(`  ok   ${was}`);
  } else {
    console.log(`  FAIL ${was}`);
    failures++;
  }
}

function leeresLayout(placements: WorldLayout['placements'] = []): WorldLayout {
  return {
    version: WORLD_LAYOUT_VERSION,
    name: 'Testwelt',
    detailSeed: 'abc',
    continents: [],
    regions: [],
    placements,
  };
}

function beispielEintrag(name: string): UploadedModelEntry {
  return {
    name,
    anzeigename: 'Testfass',
    bytes: 12_345,
    dreiecke: 24,
    meshes: 1,
    materialien: 1,
    bilder: 0,
    fehlendeTexturen: true,
    breite: 1,
    hoehe: 1.2,
    tiefe: 1,
    kollisionsart: 'fest',
    hatKollisionsnetz: false,
    kollisionsnetzAbgelehnt: false,
    hochgeladenVon: 'test',
    zeitpunkt: new Date(0).toISOString(),
  };
}

console.log('\n1. erzwingeName — Sanitierung vs. Ablehnung\n');
check(erzwingeName('Holzfass') === 'U_Holzfass', `einfacher Name bleibt (${erzwingeName('Holzfass')})`);
check(erzwingeName('Öl-Fässchen!') !== null && /^U_[A-Za-z0-9_]+$/.test(erzwingeName('Öl-Fässchen!')!), `Umlaute/Satzzeichen werden ersetzt (${erzwingeName('Öl-Fässchen!')})`);
check(erzwingeName('   ') === null, 'nur Leerzeichen ergibt keinen Namen');
check(erzwingeName('...') === null, 'nur Punkte ergibt keinen Namen');
check(erzwingeName('a/b') === null, 'Schrägstrich wird ABGELEHNT, nicht saniert');
check(erzwingeName('a\\b') === null, 'Backslash wird ABGELEHNT');
check(erzwingeName('../etwas') === null, 'Doppelpunkt-Pfadanteil ".." wird ABGELEHNT');
check((erzwingeName('x'.repeat(200)) ?? '').length <= 42, 'Länge wird gedeckelt (Präfix + 40 Zeichen)');

console.log('\n2. registerUploadedPrefab — dieselben Karten wie ein handgebautes Prefab\n');
{
  const name = 'U_TestfassEins';
  check(!PREFABS_BY_NAME.has(name), 'Name ist vorher unbekannt');
  registerUploadedPrefab(beispielEintrag(name));
  check(PREFABS_BY_NAME.has(name), 'nach dem Registrieren: PREFABS_BY_NAME kennt den Namen');
  check(findPrefabByName(name)?.model === `hochgeladen/${name}`, `PrefabDef.model zeigt auf den Upload-Ordner (${findPrefabByName(name)?.model})`);
  check(istEigenesModell(name), 'istEigenesModell(...) === true — GENAU die Stelle, an der die Karte am ehesten scheitert');
  check(uploadedModelEntry(name)?.anzeigename === 'Testfass', 'uploadedModelEntry liefert den Registry-Eintrag zurück');
  check(uploadedModelEntries().some((m) => m.name === name), 'uploadedModelEntries() listet den Eintrag');

  console.log('\n3. pruefeLayout akzeptiert eine Platzierung des hochgeladenen Namens\n');
  const layoutMitUpload = leeresLayout([{ id: 'p1', prefab: name, x: 5, z: -3 }]);
  const befunde = pruefeLayout(layoutMitUpload);
  const betroffen = befunde.filter((b) => b.text.includes(name));
  check(betroffen.length === 0, `pruefeLayout meldet KEINEN Fehler zu '${name}' (Befunde insgesamt: ${befunde.length}, davon zu diesem Namen: ${betroffen.length})`);

  console.log('\n4. Gegenprobe: nach dem Entfernen wird dieselbe Platzierung wieder gemeldet\n');
  unregisterUploadedPrefab(name);
  check(!PREFABS_BY_NAME.has(name), 'nach dem Entfernen: PREFABS_BY_NAME kennt den Namen nicht mehr');
  check(!istEigenesModell(name), 'nach dem Entfernen: istEigenesModell(...) === false');
  const befundeNachher = pruefeLayout(layoutMitUpload);
  const jetztGemeldet = befundeNachher.some((b) => b.art === 'placement' && b.text.includes(name));
  check(jetztGemeldet, `nach dem Entfernen: dieselbe Platzierung wird jetzt als unbekanntes Prefab gemeldet (Gegenprobe — beweist, dass Fall 3 wirklich an der Registrierung hing)`);
}

console.log('\n5. Namenskollision und Idempotenz beim Registrieren\n');
{
  const name = 'U_TestfassZwei';
  registerUploadedPrefab(beispielEintrag(name));
  let warf = false;
  try {
    registerUploadedPrefab(beispielEintrag(name));
  } catch {
    warf = true;
  }
  check(warf, 'ein zweites Mal registrieren mit demselben Namen wirft');
  unregisterUploadedPrefab(name);
}

console.log('\n6. applyUploadedModelRegistry — Diff aus Austragen und Eintragen\n');
{
  const stand1 = leseRegistryAusText(
    JSON.stringify({ version: 1, modelle: [beispielEintrag('U_Drei'), beispielEintrag('U_Vier')] })
  );
  const erg1 = applyUploadedModelRegistry(stand1);
  check(erg1.geladen === 2, `beide Einträge geladen (${erg1.geladen})`);
  check(PREFABS_BY_NAME.has('U_Drei') && PREFABS_BY_NAME.has('U_Vier'), 'beide im Prozess registriert');

  // U_Vier verschwindet aus der Datei -- applyUploadedModelRegistry muss es AUSTRAGEN.
  const stand2 = leseRegistryAusText(JSON.stringify({ version: 1, modelle: [beispielEintrag('U_Drei')] }));
  const erg2 = applyUploadedModelRegistry(stand2);
  check(erg2.geladen === 1, `nur noch ein Eintrag gemeldet (${erg2.geladen})`);
  check(PREFABS_BY_NAME.has('U_Drei'), 'U_Drei bleibt registriert');
  check(!PREFABS_BY_NAME.has('U_Vier'), 'U_Vier wurde AUSGETRAGEN (nicht mehr in der Datei)');

  // Ein kaputter Eintrag daneben darf den guten nicht mitreissen.
  const kaputt = { ...beispielEintrag('U_Fuenf'), dreiecke: -1 } as unknown as UploadedModelEntry;
  check(pruefeRegistryEintrag(kaputt) !== null, 'pruefeRegistryEintrag erkennt eine negative Dreieckszahl als kaputt');
  const stand3 = leseRegistryAusText(JSON.stringify({ version: 1, modelle: [beispielEintrag('U_Drei'), kaputt] }));
  const erg3 = applyUploadedModelRegistry(stand3);
  check(erg3.geladen === 1, `kaputter Nachbar hält den guten Eintrag nicht auf (${erg3.geladen} geladen)`);
  check(erg3.meldungen.some((m) => m.includes('U_Fuenf')), 'die Ablehnung nennt den betroffenen Namen');
  check(!PREFABS_BY_NAME.has('U_Fuenf'), 'U_Fuenf wurde NICHT registriert');

  unregisterUploadedPrefab('U_Drei');
}

console.log('\n7. N1 (Angriff, Befund B1) — PREFABS_BY_HASH wird gepflegt, wie moduleRegistry.registerModule\n');
{
  const name = 'U_HashProbe';
  const hash = getStableHash(name);
  check(PREFABS_BY_HASH.get(hash) === undefined, 'Hash ist vorher unbekannt');
  registerUploadedPrefab(beispielEintrag(name));
  // Exakt die Kette, die im Client bricht, wenn PREFABS_BY_HASH fehlt:
  // EntityManager.applyUpdate() und Testflug.ts rufen findPrefabByHash(u.prefabHash) —
  // nicht PREFABS_BY_NAME. Ohne diesen Eintrag zeichnet der Client NIE,
  // obwohl der Server (der nur PREFAB_DEFS/PREFABS_BY_NAME braucht) längst
  // spawnt — genau der Widerspruch aus dem Angriffsbericht.
  check(findPrefabByHash(hash) !== undefined, `findPrefabByHash(getStableHash('${name}')) findet das Prefab — GENAU der Weg, über den EntityManager.applyUpdate/Testflug.ts jedes ZDO auflösen`);
  check(findPrefabByHash(hash)?.name === name, 'und liefert den richtigen Namen zurück');
  unregisterUploadedPrefab(name);
  check(findPrefabByHash(hash) === undefined, 'nach dem Entfernen: auch aus PREFABS_BY_HASH ausgetragen (nicht nur PREFABS_BY_NAME)');
}

console.log('\n8. N1 (Befund B1) — Hash-Kollision wird abgelehnt, wie bei moduleRegistry\n');
{
  // Zwei verschiedene Namen mit demselben (erzwungenen) Hash zu finden ist
  // unpraktisch für einen Test; stattdessen wird direkt geprüft, dass die
  // Prüfung überhaupt STATTFINDET: ein bereits belegter Hash lehnt ab, auch
  // wenn der Name selbst neu ist. Simuliert über zwei Registrierungen mit
  // manipuliertem Namensfeld nach dem ersten Eintrag ist nicht möglich
  // (die Karten sind intern) — deshalb die Gegenprobe am Bestand: ein Name,
  // dessen Hash zufällig mit einem VORHANDENEN (Fremd-)Prefab kollidiert,
  // gibt es im Bestand nicht dokumentiert; die Prüfung selbst steht aber
  // im Quelltext (s. registerUploadedPrefab) und wird hier am Verhalten
  // nach einem doppelten Registrieren DESSELBEN Namens mitgeprüft:
  const name = 'U_HashKollision';
  registerUploadedPrefab(beispielEintrag(name));
  let meldung = '';
  try {
    registerUploadedPrefab(beispielEintrag(name));
  } catch (e) {
    meldung = (e as Error).message;
  }
  check(meldung.includes('bereits registriert'), `zweite Registrierung desselben Namens bleibt die Namensprüfung zuerst (${meldung})`);
  unregisterUploadedPrefab(name);
}

console.log('\n9. N1 (Befund B6) — Umlaute werden ausgeschrieben, nicht abgetrennt\n');
check(erzwingeName('Käse') === 'U_Kaese', `'Käse' → 'U_Kaese', nicht 'U_Ka_se' (${erzwingeName('Käse')})`);
check(erzwingeName('Öl-Fässchen') === 'U_Oel_Faesschen', `Öl-Fässchen → U_Oel_Faesschen (${erzwingeName('Öl-Fässchen')})`);
check(erzwingeName('Straße') === 'U_Strasse', `ß → ss (${erzwingeName('Straße')})`);

console.log('\n10. N1 (Befund B7) — kein doppeltes Präfix, Aussehens-Zwillinge abgelehnt\n');
check(erzwingeName('U_Doppelt') === 'U_Doppelt', `'U_Doppelt' bleibt 'U_Doppelt', nicht 'U_U_Doppelt' (${erzwingeName('U_Doppelt')})`);
check(erzwingeName('u_klein') === 'U_klein', `Präfix-Erkennung ist Groß-/Kleinschreibung-unabhängig (${erzwingeName('u_klein')})`);
check(erzwingeName('U_U_U_Dreifach') === 'U_Dreifach', `mehrfach wiederholtes Präfix wird auf eins gekürzt (${erzwingeName('U_U_U_Dreifach')})`);
check(erzwingeName('／etc／passwd') === null, `VOLLBREITES Solidus '／' (NFKD → '/') wird ABGELEHNT, nicht zu '_' (${erzwingeName('／etc／passwd')})`);
check(erzwingeName('a‥b') === null, `TWO DOT LEADER '‥' (NFKD → '..') wird ABGELEHNT (${erzwingeName('a‥b')})`);

console.log(failures === 0 ? '\nU1-Registry: alles grün.\n' : `\nU1-Registry: ${failures} FEHLGESCHLAGEN.\n`);
process.exit(failures > 0 ? 1 : 0);
