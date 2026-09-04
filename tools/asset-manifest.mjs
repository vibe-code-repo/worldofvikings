#!/usr/bin/env node
/**
 * asset-manifest — misst jede GLB unter assets/models/ selbst nach statt
 * ihre Werte irgendwo zu behaupten, und schreibt das Ergebnis nach
 * assets/manifest.json.
 *
 * Der Anlass (Roadmap F2): renderScale in shared/src/prefabs.ts ist von
 * Hand gepflegt und driftet lautlos von der echten Hüllbox weg (siehe
 * `--abgleich` unten — Fichte1 steht dort z.B. mit 6,4 m Breite, die GLB
 * misst 5,84 m). Ohne ein Manifest merkt das niemand, bis ein Platzhalter
 * sichtbar falsch dasteht.
 *
 * Die Knotenmatrix-Mathematik (Quaternion → Mat4, Kette der Elternknoten)
 * ist wortgleich aus tools/glb-bbox.js übernommen und nicht neu erfunden:
 * genau dieser Code lieferte die 5,84 × 12,18 m, gegen die der Abgleich
 * unten prüft. Eine zweite, nur ähnliche Matrixrechnung wäre die Art
 * Fehlerquelle, die ein Manifest eigentlich ausschließen soll.
 *
 * Je Modell mindestens: Hüllbox (min/max je Achse, daraus Breite/Höhe/
 * Tiefe), Dreieckszahl, Dateigröße, Materialien, eingebettete Bilder,
 * Animationen (Name + Dauer), ob es mesh-los ist (Rig ohne einen
 * einzigen Dreiecksindex — unrenderbar, aber ohne Fehlermeldung) und ob
 * der Name in EIGENE_FLORA (Streutabelle) vorkommt.
 *
 *   node_modules/.bin/tsx tools/asset-manifest.mjs             Manifest ERGÄNZEN
 *   node_modules/.bin/tsx tools/asset-manifest.mjs --neu       Manifest NEU schreiben
 *   node_modules/.bin/tsx tools/asset-manifest.mjs --abgleich  zusätzlich gegen
 *                                                               prefabs.ts vergleichen (nur Bericht)
 *
 * Warum ERGÄNZEN die Vorgabe ist (F5): `assets/` liegt ausserhalb des
 * Repos und reist als eigenes tar (tools/wov-update.sh) — jede Arbeits-
 * kopie hält deshalb einen anderen AUSSCHNITT der Modelle. Die drei
 * Dungeon-Arbeitsbäume teilen sich per Symlink 36 GLB, Mikes Maschine
 * hat über 200. Ein Lauf, der stur überschreibt, löscht in einem solchen
 * Baum in einem Zug 168 Einträge aus einer GETRACKTEN Datei — und zwar
 * lautlos und mit grünem Testlauf, weil dann ja wieder alles zusammen-
 * passt. Genau die Sorte Schaden, gegen die das Manifest angetreten ist,
 * nur andersherum.
 *
 * Also: gemessen wird, was da ist; jeder Eintrag zu einer Datei, die
 * hier fehlt, wird UNVERÄNDERT übernommen und oben unter `uebernommen`
 * namentlich aufgeführt. Nur dort ist Vollständigkeit behauptet, wo
 * `uebernommen` leer ist — `--neu` schreibt das Manifest daher bewusst
 * ohne Rücksicht auf den Vorgänger und ist der Lauf auf der Maschine mit
 * dem VOLLEN Bestand (nur so verschwindet auch eine Leiche wieder).
 *
 * Braucht tsx statt `node`, weil der Foliage-Abgleich `@wov/shared`
 * (TypeScript-Quelle) importiert — MITLESEN statt die 102 EIGENE_FLORA-
 * Namen ein zweites Mal aufzuschreiben (die Begründung dafür steht in
 * tools/modell-abgleich.ts).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EIGENE_FLORA, PREFAB_DEFS } from '@wov/shared';
import { moduleStems, readModelAlias } from './manifest-zuordnung.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..');
const MODELLE_DIR = join(WURZEL, 'assets/models');
const ZIEL = join(WURZEL, 'assets/manifest.json');

// ── GLB lesen ──────────────────────────────────────────────────────────
// Alle eigenen GLBs (baeume-bauen.sh, blumen-bauen.sh, ... sowie die
// Rig-Skripte) schreiben genau eine JSON- und eine BIN-Chunk in dieser
// Reihenfolge — derselbe Aufbau, den auch glb-bbox.js und
// glb-size-check.mjs voraussetzen.
function leseGlb(pfad) {
  const buf = readFileSync(pfad);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${pfad}: kein GLB-Magic`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart);
  return { json, bin, groesse: buf.length };
}

// ── Mat4-Mathematik (Spalten-Major, wie glTF) — wortgleich aus glb-bbox.js
function matMul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trsToMat(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function xform(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// ── Typisierte Accessor-Werte (für Dreiecksindizes und Animations-
// Zeitachsen — die Hüllbox kommt dagegen aus accessor.min/max, das
// spart bei großen Meshes das Einlesen aller Vertices).
const KOMPONENTEN_TYP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const ANZAHL_KOMPONENTEN = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessorWerte(json, bin, index) {
  const a = json.accessors[index];
  const bv = json.bufferViews[a.bufferView];
  const T = KOMPONENTEN_TYP[a.componentType];
  const n = ANZAHL_KOMPONENTEN[a.type];
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  // Kopieren statt Sicht: der Binärteil ist nicht garantiert 4-Byte-ausgerichtet
  // (subarray auf einem Uint8Array-Buffer kann auf ungeradem Offset stehen).
  const roh = bin.subarray(start, start + a.count * n * T.BYTES_PER_ELEMENT);
  return new T(new Uint8Array(roh).buffer, 0, a.count * n);
}

/** Dreieckszahl einer Primitive: indiziert → indices.count/3, sonst POSITION.count/3.
 *  Nur TRIANGLES (mode 4, glTF-Vorgabe) wird gezählt — Strips/Fans kommen in
 *  keinem der eigenen Exporte vor, ein falscher Dreieckswert wäre schlimmer
 *  als eine Lücke. */
function dreiecke(json, bin, prim) {
  if (prim.mode !== undefined && prim.mode !== 4) return 0;
  if (prim.indices !== undefined) return Math.floor(json.accessors[prim.indices].count / 3);
  return Math.floor(json.accessors[prim.attributes.POSITION].count / 3);
}

/** Misst eine GLB: Hüllbox über den Knotenbaum (Elternskalierung eingerechnet,
 *  s. Kopfkommentar), Dreiecke, Materialien, Bilder, Animationen, mesh-los. */
function vermiss(pfad) {
  const { json, bin, groesse } = leseGlb(pfad);
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  let dreieckeGesamt = 0;

  function walk(ni, elternMatrix) {
    const n = json.nodes[ni];
    const welt = matMul(elternMatrix, trsToMat(n));
    if (n.mesh !== undefined) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        dreieckeGesamt += dreiecke(json, bin, prim);
        if (acc.min && acc.max) {
          for (let c = 0; c < 8; c++) {
            const ecke = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
            const w = xform(welt, ecke);
            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(lo[k], w[k]);
              hi[k] = Math.max(hi[k], w[k]);
            }
          }
        }
      }
    }
    for (const c of n.children || []) walk(c, welt);
  }
  const szene = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  for (const ni of szene) walk(ni, I);

  const meshlos = dreieckeGesamt === 0;
  // Ohne Dreiecke ist die Hüllbox unbestimmt (lo/hi blieben ±Infinity) —
  // 0 statt Infinity ins Manifest, sonst ist es kein gültiges JSON-Konzept
  // mehr (JSON kennt keine Infinity) und muss beim Lesen extra behandelt werden.
  const huelle = meshlos
    ? { min: [0, 0, 0], max: [0, 0, 0] }
    : { min: lo.map((v) => +v.toFixed(3)), max: hi.map((v) => +v.toFixed(3)) };

  const animationen = (json.animations ?? []).map((a, i) => {
    let minT = Infinity, maxT = -Infinity;
    for (const s of a.samplers) {
      const acc = json.accessors[s.input];
      if (acc.min && acc.max) {
        minT = Math.min(minT, acc.min[0]);
        maxT = Math.max(maxT, acc.max[0]);
      } else {
        // Fallback ohne min/max (bei den eigenen Exporten bisher nie nötig,
        // aber ein stiller falscher Wert wäre schlimmer als der Umweg).
        const werte = accessorWerte(json, bin, s.input);
        for (const t of werte) {
          minT = Math.min(minT, t);
          maxT = Math.max(maxT, t);
        }
      }
    }
    return { name: a.name ?? `Animation${i}`, dauer: +(maxT - minT).toFixed(3) };
  });

  return {
    bytes: groesse,
    huelle,
    breite: meshlos ? 0 : +(hi[0] - lo[0]).toFixed(3),
    hoehe: meshlos ? 0 : +(hi[1] - lo[1]).toFixed(3),
    tiefe: meshlos ? 0 : +(hi[2] - lo[2]).toFixed(3),
    dreiecke: dreieckeGesamt,
    materialien: (json.materials ?? []).length,
    bilder: (json.images ?? []).length,
    animationen,
    meshlos,
    // Skins deformieren Vertices über Knochenmatrizen, nicht über die
    // Knotenkette — die Hüllbox oben rechnet NUR die Kette, ist bei einem
    // Rig also nur die Bindepose der Roh-POSITION-Daten und kann von der
    // tatsächlichen Spielgröße abweichen (Beispiel npc_1_walk.glb: rohe
    // Bindepose 0,02 m, weil die Skinning-Matrizen die Skalierung tragen —
    // dasselbe Verhalten wie glb-bbox.js, kein neuer Fehler). Das Feld
    // macht diese Einschränkung sichtbar, statt sie zu verschweigen.
    skins: (json.skins ?? []).length,
  };
}

// ── Hauptlauf ─────────────────────────────────────────────────────────
/**
 * Alle GLB unter assets/models/ — AUCH in Unterordnern.
 *
 * Hier stand ein flaches readdirSync. Das ging gut, solange jede Figur
 * eine Datei war. Seit die Wikingerin in Einzelteile zerlegt ist
 * (assets/models/wikingerin/ — Koerper, 21 Frisuren, Ruestung), fehlten
 * genau diese im Manifest, und der F17-Test meldete fuer die einzige
 * verbliebene Figur "steht im Manifest: FAIL" und "keine Clips".
 *
 * Zurueckgegeben werden Pfade RELATIV zu assets/models/, also
 * "wikingerin/WikingerinKoerper.glb" — dasselbe, was in figuren.ts als
 * `modell` steht, nur mit Endung.
 */
function alleGlb(dir, praefix = '') {
  const aus = [];
  for (const eintrag of readdirSync(join(MODELLE_DIR, praefix), { withFileTypes: true })) {
    const rel = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    if (eintrag.isDirectory()) aus.push(...alleGlb(dir, rel));
    else if (eintrag.name.endsWith('.glb')) aus.push(rel);
  }
  return aus;
}

const dateien = alleGlb(MODELLE_DIR)
  .filter((f) => f.endsWith('.glb'))
  .sort();

const floraNamen = new Set(EIGENE_FLORA.map((f) => f.prefabName));

const modelle = {};
for (const datei of dateien) {
  const stamm = datei.slice(0, -4);
  const m = vermiss(join(MODELLE_DIR, datei));
  modelle[stamm] = { datei, foliage: floraNamen.has(stamm), ...m };
}

/*
  Ergänzen statt ersetzen — die Begründung steht im Kopf dieser Datei.

  `--neu` ist die Ausnahme und nicht die Vorgabe, weil die beiden Fehler
  ungleich schwer wiegen: Ein zu lange stehengebliebener Eintrag fällt
  beim nächsten vollen Lauf und dem Vollständigkeitstest auf; ein
  gelöschter Eintrag ist einfach weg, samt Hüllbox und Dreieckszahl der
  Datei, die auf DIESER Maschine gar nicht lag.
*/
const NEUBAU = process.argv.includes('--neu');
const bisher =
  !NEUBAU && existsSync(ZIEL) ? (JSON.parse(readFileSync(ZIEL, 'utf8')).modelle ?? {}) : {};
const uebernommen = Object.keys(bisher)
  .filter((stamm) => !(stamm in modelle))
  .sort();
for (const stamm of uebernommen) modelle[stamm] = bisher[stamm];

/*
  Nach `datei` sortiert und nicht nach Einfügereihenfolge: Ein übernommener
  Eintrag landete sonst hinten, und der Diff einer getrackten Datei zeigte
  eine Umsortierung statt der einen echten Änderung. `datei` und nicht der
  Stamm, weil die bisherige Reihenfolge genau diese war (`dateien.sort()`).
*/
const sortiert = {};
for (const [stamm] of Object.entries(modelle).sort((a, b) => (a[1].datei < b[1].datei ? -1 : 1))) {
  sortiert[stamm] = modelle[stamm];
}

const manifest = {
  erzeugt: new Date().toISOString(),
  quelle: 'tools/asset-manifest.mjs',
  anzahl: Object.keys(sortiert).length,
  gemessen: dateien.length,
  // Einträge, deren Datei auf DIESER Maschine fehlt. Leer = der Lauf hat
  // den vollen Bestand gesehen, und erst dann ist eine Leiche im Manifest
  // eine Leiche (s. tools/test/manifest-vollstaendig.ts).
  uebernommen,
  modelle: sortiert,
};
writeFileSync(ZIEL, JSON.stringify(manifest, null, 1) + '\n');
console.log(
  `assets/manifest.json geschrieben: ${manifest.anzahl} Einträge ` +
    `(${dateien.length} hier gemessen, ${uebernommen.length} übernommen)`
);
if (uebernommen.length > 0) {
  console.log(
    `  übernommen, weil die Datei hier fehlt: ${uebernommen.slice(0, 6).join(', ')}` +
      `${uebernommen.length > 6 ? ` … (+${uebernommen.length - 6})` : ''}`
  );
  console.log('  Ein voller Neubau (auch zum Entfernen von Leichen) braucht --neu auf der Maschine mit allen Modellen.');
}

const meshlose = Object.entries(modelle).filter(([, m]) => m.meshlos);
if (meshlose.length > 0) {
  console.log(`  mesh-los (kein einziger Dreiecksindex): ${meshlose.map(([n]) => n).join(', ')}`);
} else {
  console.log('  mesh-los: keins');
}
const mitAnimation = Object.entries(modelle).filter(([, m]) => m.animationen.length > 0);
console.log(
  `  mit Animation: ${mitAnimation.length} (${mitAnimation.map(([n, m]) => `${n}:${m.animationen.map((a) => a.name).join('+')}`).join(', ')})`
);
console.log(`  als Foliage erkannt (EIGENE_FLORA): ${Object.values(modelle).filter((m) => m.foliage).length}`);

// ── Abgleich gegen prefabs.ts (nur Bericht, prefabs.ts bleibt unangetastet) ──
//
// renderScale.w/h in HINT_DEFS ist die Breite/Höhe, die der Platzhalter
// zeigt, bevor die echte GLB geladen ist — von Hand eingetragen, seit
// jeher ohne Rückkopplung zur tatsächlichen Hüllbox. Der Vergleich hier
// ist genau diese Rückkopplung.
//
// Gesucht wird über PrefabDef.model (nicht .name!): fünf Kreaturen-Hints
// zeigen mit einem anderen Modellnamen auf ihre GLB (z.B. Player →
// npc_1_walk), also ist .model die richtige Seite des Vergleichs.
//
// WICHTIG: renderScale gilt laut Kopfkommentar von prefabs.ts für die
// GLB "in natürlicher Größe × pkg localScale" — bei jedem Modell mit
// localScale ≠ 1 (KiPine2/3, Surtr, Steinkreis, die Grabhügel-Teile, …)
// verglichen wir sonst Äpfel mit Birnen (0,6 m rohe GLB gegen 7 m
// Platzhalter sah wie eine riesige Abweichung aus, war aber nur der
// fehlende Skalierungsfaktor).
if (process.argv.includes('--abgleich')) {
  /*
    Zwei Zuordnungen, beide aus tools/manifest-zuordnung.ts und keine davon
    hier nachgebaut (der Test tools/test/manifest-zuordnung.ts bewacht sie):

    (1) MODELL_ALIAS — Prefab → Datei. Vier Prefabs zeigen mit einem
        Modellnamen auf eine GLB, die anders heisst (GrabhuegelGras,
        SteingrabGangDurch, StoneVaultEntry, RockVaultEntry). Ohne die
        Auflösung fanden sie hier NICHTS und fielen still aus dem Bericht:
        ihr renderScale wurde nie gegen eine Hüllbox gehalten.

    (2) Modul → Stammmodul. Das ist der eigentliche Anlass von F5. Bis
        hierher listete der Bericht jede Abweichung der zwölf Stammmodule
        ein zweites Mal unter ihrem Fels-Namen — mit identischer Zahl, weil
        rockVariant() `size` unverändert übernimmt und renderScale daraus
        entsteht. Zwölf Zeilen, die nichts Neues sagen, in einer nach
        Grösse sortierten Bestenliste: die Fels-Zeilen verdrängten genau
        das, wofür die Liste da ist (beim Lauf vor dieser Änderung standen
        unter den ersten zwanzig Zeilen elf solcher Paare).

    Die Ableitung wird deshalb nicht verschwiegen, sondern GETRENNT
    berichtet — und dort mit der Frage, die nur sie beantworten kann:
    Misst die Fels-GLB dieselbe Hüllbox wie ihr Stamm? Genau das ist die
    Abnahme von F3 („Hüllbox und Ursprung unverändert"), und ab hier steht
    sie in einem Bericht statt in einem einmaligen Blender-Lauf.
  */
  const alias = readModelAlias(WURZEL);
  const stems = moduleStems();

  // Schlüssel ist die DATEI, die das Prefab wirklich lädt — nicht sein
  // Modellname. Ohne den Alias fielen die vier Teiler-Prefabs heraus.
  const nachDatei = new Map();
  for (const def of PREFAB_DEFS) {
    if (!def.model) continue;
    const datei = alias[def.model] ?? def.model;
    if (!nachDatei.has(datei)) nachDatei.set(datei, []);
    nachDatei.get(datei).push(def);
  }

  const abweichungen = [];
  const abgeleitet = [];
  let ohnePrefab = 0;
  for (const [stamm, m] of Object.entries(modelle)) {
    if (m.meshlos) continue; // keine sinnvolle Breite/Höhe zum Vergleichen
    const defs = nachDatei.get(stamm);
    if (!defs || defs.length === 0) {
      ohnePrefab++;
      continue;
    }
    for (const def of defs) {
      const breiteSkaliert = m.breite * def.localScale.x;
      const hoeheSkaliert = m.hoehe * def.localScale.y;
      const dw = Math.abs(def.renderScale.w - breiteSkaliert);
      const dh = Math.abs(def.renderScale.h - hoeheSkaliert);
      const zeile = {
        modell: stamm,
        prefab: def.name,
        renderScale: [def.renderScale.w, def.renderScale.h],
        gemessen: [+breiteSkaliert.toFixed(2), +hoeheSkaliert.toFixed(2)],
        delta: +(dw + dh).toFixed(3),
        skin: m.skins > 0,
      };
      // Ein abgeleitetes Modul erbt sein `size` und damit sein renderScale;
      // seine Abweichung IST die des Stamms. Sie gehört in den zweiten
      // Abschnitt, nicht ein zweites Mal in die Bestenliste.
      (stems.has(def.model) ? abgeleitet : abweichungen).push(zeile);
    }
  }
  abweichungen.sort((a, b) => b.delta - a.delta);

  console.log(`\n=== Abgleich renderScale (prefabs.ts) gegen gemessene Hüllbox × localScale ===`);
  console.log(
    `${abweichungen.length} Prefab-Modell-Paare verglichen, ${ohnePrefab} eigene GLBs ohne Treffer in PREFAB_DEFS.model, ` +
      `${abgeleitet.length} auf ihr Stammmodul zurückgeführt (s. unten), ${Object.keys(alias).length} Alias-Zuordnung(en) aufgelöst`
  );
  console.log(`Größte Abweichungen (Breite+Höhe in m, absteigend; ⚠ = Rig mit Skin, Bindepose unzuverlässig):`);
  for (const a of abweichungen.slice(0, 20)) {
    console.log(
      `  ${a.skin ? '⚠ ' : '  '}${a.prefab.padEnd(22)} renderScale ${a.renderScale.map((v) => v.toFixed(2)).join('×').padEnd(11)} ` +
        `gemessen ${a.gemessen.map((v) => v.toFixed(2)).join('×').padEnd(11)} Δ=${a.delta}`
    );
  }

  /*
    Zweiter Abschnitt: die Ableitung gegen ihren Stamm.

    Verglichen werden nicht renderScale und Hüllbox (das tut der Abschnitt
    darüber am Stamm, und für die Ableitung wäre es dieselbe Zahl), sondern
    die beiden GLB-MESSUNGEN gegeneinander. Gleich müssen sein: Hüllbox und
    Ursprung — die Fels-Frontschicht tauscht Blöcke aus, sie verschiebt kein
    Modul. Verschieden DÜRFEN sein: Dreiecke und Dateigrösse, denn genau
    dafür ist die Ableitung da.
  */
  const paare = [];
  for (const s of stems.values()) {
    const a = modelle[s.derived];
    const b = modelle[s.stem];
    if (!a && !b) continue; // Modul ohne eigene GLB (Rolle per MODELL_ALIAS)
    paare.push({ ...s, mA: a, mB: b });
  }
  console.log(`\n=== Ableitung gegen Stammmodul (KIT_DERIVATIONS) ===`);
  const messbar = paare.filter((p) => p.mA && p.mB);
  console.log(
    `${stems.size} abgeleitete Module, ${paare.length} mit eigener GLB, ${messbar.length} zusammen mit ihrem Stamm gemessen`
  );
  const ungleich = [];
  for (const p of messbar) {
    const gleich =
      JSON.stringify(p.mA.huelle) === JSON.stringify(p.mB.huelle) &&
      p.mA.breite === p.mB.breite &&
      p.mA.hoehe === p.mB.hoehe &&
      p.mA.tiefe === p.mB.tiefe;
    if (!gleich) ungleich.push(p);
    const d = p.mA.dreiecke - p.mB.dreiecke;
    console.log(
      `  ${gleich ? '  ' : '≠ '}${p.derived.padEnd(20)} ← ${p.stem.padEnd(20)} ` +
        `Hüllbox ${gleich ? 'gleich' : `${p.mA.breite}×${p.mA.hoehe}×${p.mA.tiefe} statt ${p.mB.breite}×${p.mB.hoehe}×${p.mB.tiefe}`}` +
        `  Dreiecke ${p.mB.dreiecke} → ${p.mA.dreiecke} (${d >= 0 ? '+' : ''}${d})`
    );
  }
  const nurEines = paare.filter((p) => !p.mA || !p.mB);
  for (const p of nurEines) {
    console.log(`  ? ${p.derived.padEnd(20)} ← ${p.stem.padEnd(20)} nur ${p.mA ? 'die Ableitung' : 'der Stamm'} liegt hier`);
  }
  console.log(
    ungleich.length === 0
      ? `Hüllbox und Ursprung: ${messbar.length} von ${messbar.length} gleich dem Stamm (F3-Abnahme).`
      : `ACHTUNG: ${ungleich.length} Modul(e) messen anders als ihr Stamm — die Kits sitzen dann nicht mehr auf demselben Raster.`
  );
}
