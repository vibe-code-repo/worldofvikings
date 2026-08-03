#!/usr/bin/env node
/**
 * mixamo-to-avatar — baut Mixamo-Animationen in das Spielermodell ein.
 *
 * WARUM ES DIESES WERKZEUG GIBT:
 * Valheims Spieleranimationen liegen im Client als Unity-HUMANOID-Clips vor
 * (`extracted_assets/AnimationClip/`, 299 Stück): keine Knochenkurven,
 * sondern 130 Muskel-DoFs im Mecanim-Muscle-Space (alle Bindings auf
 * `path: 0`). Zum Zurückrechnen bräuchte man das Avatar-Asset mit den
 * Achsen- und Muskelgrenzen — das ist im Export nicht enthalten. Auch die
 * gerippten GLBs helfen nicht: `player@Walking.glb`,
 * `PlayerCharacter_01 (2)@Jog Forward.glb` und `Characters/Player/model/
 * body.glb` haben allesamt 0 Animationen, 0 Skins, 0 Meshes.
 *
 * Der Ausweg steht im Rig selbst: Valheims Spielerskelett ist ein
 * MIXAMO-Rig (`mixamorig:Hips`, `mixamorig:LeftUpLeg`, …) und die
 * Clipnamen sind wörtliche Mixamo-Katalogtitel — `Jog Forward`,
 * `Standard Run New`, `Walking With Torch_Left`, `Sneak walk`,
 * `Treading Water`. Dieselben Bewegungen lassen sich also bei Mixamo als
 * FBX mit echten Knochenkurven holen; dieses Werkzeug überträgt sie auf
 * den Tripo-Rig unseres Charakters.
 *
 * ── Warum Retargeting und kein direktes Einsetzen ────────────────────
 * Mixamo liefert Kurven für `mixamorig:*`; unser Modell hat 41 Knochen
 * mit anderen Namen (`Hip`, `Spine01`, `L_Upperarm`, …) und einer eigenen
 * Bindepose. Rohe Rotationen zu übernehmen verdrehte die Figur. Deshalb
 * wird pro Frame die WELTdrehung der Quelle relativ zu ihrer Ruhepose
 * bestimmt und dieses Delta auf die Ruhepose des Zielknochens gelegt —
 * das ist unabhängig davon, wie die beiden Rigs ihre lokalen Achsen
 * legen. Beide Rigs sind in T-Pose gebunden, deshalb genügt das.
 *
 * ── Was NICHT übertragen wird ────────────────────────────────────────
 * Twist-Knochen (`*Twist01/02`) bleiben in Ruhelage: Mixamo hat dafür
 * keine Entsprechung, sie sind reine Verformungshilfen. Skalierungen
 * werden ignoriert. Verschiebungen kommen nur von der Hüfte, umgerechnet
 * aufs Größenverhältnis der beiden Skelette — alle anderen Knochen
 * behalten ihre Ruheposition, sonst reißt es die Gliedmaßen auseinander.
 *
 * ── Aufruf ───────────────────────────────────────────────────────────
 *   node tools/mixamo-to-avatar.mjs \
 *     --basis assets/models/PlayerAvatar.glb \
 *     --out   assets/models/PlayerAvatar.glb \
 *     idle=~/Downloads/Breathing\ Idle.fbx \
 *     gehen=~/Downloads/Walking.fbx \
 *     rennen=~/Downloads/Standard\ Run.fbx
 *
 * Der Teil vor dem `=` wird zum Clipnamen im glTF. Ohne `=` dient der
 * Dateiname als Name. `--behalte` hängt die neuen Clips an die
 * vorhandenen an, statt sie zu ersetzen.
 *
 * Beim Herunterladen bei Mixamo: FBX Binary, "Without Skin", 30 fps,
 * KEINE Keyframe-Reduktion und NICHT "In Place" — die eingebackene
 * Wegstrecke braucht AvatarRig, um `speedRatio` gegen das Fußrutschen zu
 * normieren (siehe messeUndEntferneWurzelbewegung()).
 */
import fs from 'node:fs';
import path from 'node:path';
import { AnimationMixer, Matrix4, Quaternion, Vector3 } from 'three';

// FBXLoader zieht für eingebettete Texturen Image-Objekte hoch — in Node
// gibt es kein DOM. Die Stubs reichen: uns interessieren nur die Kurven.
// `window` braucht er nur für Dateien mit EINGEBETTETER Textur; liegt sie
// wie bei manchen Exporten daneben im .fbm-Ordner, fällt der Zweig aus.
globalThis.window ??= globalThis;
globalThis.self ??= globalThis;
globalThis.document ??= {
  createElementNS: () => ({ style: {}, setAttribute() {}, addEventListener() {} }),
  createElement: () => ({ style: {}, getContext: () => null, setAttribute() {}, addEventListener() {} }),
};
globalThis.URL.createObjectURL ??= () => 'blob:stub';
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

/**
 * Knochenzuordnung Mixamo → Tripo.
 *
 * Mixamos Wirbelsäule hat drei Glieder (Spine/Spine1/Spine2), unsere vier
 * (Waist/Spine01/Spine02 plus die unbewegte Pelvis) — `Spine` landet
 * deshalb auf `Waist`. Der Hals ist bei uns zweigeteilt (NeckTwist01/02);
 * die Drehung bekommt das erste Glied, das zweite bleibt in Ruhe, sonst
 * addiert sich die Halsdrehung doppelt.
 */
const KNOCHEN = {
  'mixamorig:Hips': 'Hip',
  'mixamorig:Spine': 'Waist',
  'mixamorig:Spine1': 'Spine01',
  'mixamorig:Spine2': 'Spine02',
  'mixamorig:Neck': 'NeckTwist01',
  'mixamorig:Head': 'Head',
  'mixamorig:LeftShoulder': 'L_Clavicle',
  'mixamorig:LeftArm': 'L_Upperarm',
  'mixamorig:LeftForeArm': 'L_Forearm',
  'mixamorig:LeftHand': 'L_Hand',
  'mixamorig:RightShoulder': 'R_Clavicle',
  'mixamorig:RightArm': 'R_Upperarm',
  'mixamorig:RightForeArm': 'R_Forearm',
  'mixamorig:RightHand': 'R_Hand',
  'mixamorig:LeftUpLeg': 'L_Thigh',
  'mixamorig:LeftLeg': 'L_Calf',
  'mixamorig:LeftFoot': 'L_Foot',
  'mixamorig:LeftToeBase': 'L_ToeBase',
  'mixamorig:RightUpLeg': 'R_Thigh',
  'mixamorig:RightLeg': 'R_Calf',
  'mixamorig:RightFoot': 'R_Foot',
  'mixamorig:RightToeBase': 'R_ToeBase',
};
/** Der einzige Knochen, dessen Verschiebung übernommen wird. */
const WURZEL_ZIEL = 'Hip';

/**
 * Vereinheitlicht Mixamo-Knochennamen auf die Schreibweise mit Doppelpunkt.
 *
 * Mixamo benennt seine Knochen `mixamorig:Hips`. Der Doppelpunkt ist in
 * FBX-Namen aber heikel, und three ersetzt ihn beim Laden — an den Knochen
 * steht dann `mixamorigHips`. Je nach Herkunft der Datei kommt mal die eine,
 * mal die andere Form an; die Zuordnungstabelle kennt nur eine.
 */
function kanonisch(name) {
  return name.replace(/^mixamorig[:_]?(?=[A-Z])/, 'mixamorig:');
}

/**
 * Liefert die Zuordnung Quellknochen → Zielknochen für eine geladene FBX.
 *
 * Neben Mixamo-Dateien kommen auch Exporte vor, die BEREITS unser Rig
 * benutzen — etwa die FBX-Fassung des Charakters selbst, die zwei
 * Laufzyklen (`preset:biped:walk`, `preset:biped:run`) mitbringt. Dort
 * heißen die Knochen schon richtig und werden 1:1 übernommen; das
 * Retargeting rechnet dann die Identität und lässt die Bewegung
 * unverändert durch.
 */
function baueZuordnung(quelle, ziel) {
  const mixamo = Object.entries(KNOCHEN).filter(([q, z]) => quelle.knochen.has(q) && ziel.nachName.has(z));
  if (mixamo.length) return { art: 'mixamo', paare: mixamo };
  const gleich = [...quelle.knochen.keys()]
    .filter((n) => ziel.nachName.has(n) && !/Twist\d+$/.test(n))
    .map((n) => [n, n]);
  return { art: 'gleichnamig', paare: gleich };
}
/** Abtastrate der Ausgabe. Mixamo liefert 30 fps; feiner bringt nichts. */
const FPS = 30;

// ── GLB lesen/schreiben ────────────────────────────────────────────────

function leseGlb(datei) {
  const buf = fs.readFileSync(datei);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${datei}: kein GLB`);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), typ = buf.readUInt32LE(off + 4);
    const daten = buf.subarray(off + 8, off + 8 + len);
    if (typ === 0x4e4f534a) json = JSON.parse(daten.toString('utf8'));
    else if (typ === 0x004e4942) bin = Buffer.from(daten);
    off += 8 + len;
  }
  if (!json) throw new Error(`${datei}: kein JSON-Chunk`);
  return { json, bin: bin ?? Buffer.alloc(0) };
}

function schreibeGlb(datei, json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  // Beide Chunks müssen auf 4 Byte ausgerichtet sein — JSON wird mit
  // Leerzeichen aufgefüllt, der Binärteil mit Nullen (glTF-Spec 4.4.2).
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const gesamt = 12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0);
  const out = Buffer.alloc(gesamt);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(gesamt, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  if (binChunk.length) {
    const p = 20 + jsonChunk.length;
    out.writeUInt32LE(binChunk.length, p);
    out.writeUInt32LE(0x004e4942, p + 4);
    binChunk.copy(out, p + 8);
  }
  fs.writeFileSync(datei, out);
  return gesamt;
}

// ── Zielskelett aus dem glTF ──────────────────────────────────────────

/**
 * Sammelt die Knochen der Basis-Datei: Elternbeziehung, lokale Ruhepose
 * und daraus die Weltdrehung in Ruhe. Die Weltdrehung ist der Bezug, in
 * dem später das Bewegungs-Delta der Quelle angewandt wird.
 */
function zielSkelett(json) {
  const eltern = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => eltern.set(c, i)));

  const nachName = new Map();
  json.nodes.forEach((n, i) => { if (n.name && !nachName.has(n.name)) nachName.set(n.name, i); });

  const ruheLokal = json.nodes.map((n) => ({
    q: new Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]),
    p: new Vector3().fromArray(n.translation ?? [0, 0, 0]),
  }));

  const ruheWelt = new Map();      // Weltdrehung in Ruhe
  const ruheWeltPos = new Map();   // Weltposition in Ruhe
  const weltZustand = (i) => {
    if (ruheWelt.has(i)) return { q: ruheWelt.get(i), p: ruheWeltPos.get(i) };
    const e = eltern.get(i);
    let q, p;
    if (e === undefined) {
      q = ruheLokal[i].q.clone();
      p = ruheLokal[i].p.clone();
    } else {
      const { q: qe, p: pe } = weltZustand(e);
      q = qe.clone().multiply(ruheLokal[i].q);
      p = ruheLokal[i].p.clone().applyQuaternion(qe).add(pe);
    }
    ruheWelt.set(i, q);
    ruheWeltPos.set(i, p);
    return { q, p };
  };
  json.nodes.forEach((_, i) => weltZustand(i));

  return { eltern, nachName, ruheLokal, ruheWelt, ruheWeltPos };
}

// ── Quellskelett aus der FBX ──────────────────────────────────────────

function ladeFbx(datei) {
  const buf = fs.readFileSync(datei);
  const wurzel = new FBXLoader().parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    path.dirname(datei) + '/'
  );
  const knochen = new Map();
  let skin = null;
  wurzel.traverse((o) => {
    if (o.isBone) {
      // Unter beiden Schreibweisen ablegen, damit die Zuordnung greift,
      // egal wie der Export den Doppelpunkt behandelt hat. Umbenennen wäre
      // falsch: Der AnimationMixer bindet seine Spuren über den ECHTEN
      // Namen, ein geänderter Knochen bliebe unbewegt.
      if (!knochen.has(o.name)) knochen.set(o.name, o);
      const k = kanonisch(o.name);
      if (k !== o.name && !knochen.has(k)) knochen.set(k, o);
    }
    if (o.isSkinnedMesh && !skin) skin = o;
  });
  if (!knochen.size) throw new Error(`${datei}: enthält kein Skelett`);
  return { wurzel, knochen, skin };
}

/**
 * Wählt die Transformation, die die Bindematrizen in den Raum der geladenen
 * Szene bringt.
 *
 * Je nach Exportweg stehen die inversen Bindematrizen im selben Raum wie
 * die Animation, um 90° dagegen verdreht (Z-up-Dateien) oder um die
 * Bindematrix des Skins versetzt. Statt zu raten, werden die Kandidaten
 * durchgerechnet und daran gemessen, wie weit die Knochen dabei von ihrer
 * geladenen Lage abweichen: Beide Posen zeigen dieselbe Figur in ähnlicher
 * Haltung, eine falsche Raumwahl schiebt sie dagegen um Körpergröße
 * auseinander.
 *
 * Bewusst OHNE Knochennamen — ein früherer Versuch suchte Hüfte und Kopf
 * anhand ihrer Namen und lief bei der Tripo-Datei ins Leere, deren Skin
 * ausgerechnet die Hauptgelenke nicht führt.
 */
function waehleRaum(quelle, skelett) {
  const bind = quelle.skin.bindMatrix ?? new Matrix4();
  const kandidaten = [
    ['ohne', new Matrix4()],
    ['bindMatrix', bind.clone()],
    ['bindMatrix⁻¹', bind.clone().invert()],
    ['Wurzelmatrix', quelle.wurzel.matrixWorld.clone()],
  ];

  // Verglichen werden DREHUNGEN, nicht Positionen: Die geladene Haltung
  // weicht je nach Datei stark von der Bindepose ab — bei einer Tripo-FBX
  // war das Knie um 98° gebeugt —, und ein Abstandsmaß kürte deshalb die
  // falsche Variante. Der Median der Winkel ist gegen solche Ausreißer
  // unempfindlich: Eine falsche Raumwahl schlägt auf ALLE Knochen mit
  // ihren 90° durch, eine ungewöhnliche Haltung nur auf wenige.
  const q = new Quaternion(), p = new Vector3(), s = new Vector3();
  const geladen = skelett.bones.map((b) => {
    const qq = new Quaternion();
    b.matrixWorld.decompose(new Vector3(), qq, new Vector3());
    return qq;
  });

  let beste = kandidaten[0], bestesMass = Infinity;
  for (const [name, raum] of kandidaten) {
    const winkel = [];
    for (let i = 0; i < skelett.bones.length; i++) {
      skelett.boneInverses[i].clone().invert().premultiply(raum).decompose(p, q, s);
      const d = q.clone().invert().multiply(geladen[i]);
      winkel.push(2 * Math.acos(Math.min(1, Math.abs(d.w))));
    }
    winkel.sort((a, b) => a - b);
    const median = winkel[Math.floor(winkel.length / 2)] ?? Infinity;
    if (median < bestesMass) { bestesMass = median; beste = [name, raum]; }
  }
  return beste[1];
}

/**
 * Ruhepose der Quelle als Weltdrehung je Knochen.
 *
 * ACHTUNG, hier lag der erste Fehlversuch: Der Zustand direkt nach dem
 * Laden ist NICHT die Bindepose. three übernimmt die Transformationen der
 * FBX-Knoten, und die stehen bei animierten Dateien in einer beliebigen
 * Haltung — beim Testmodell war das Knie um 98° gebeugt und der Oberarm um
 * 51° gesenkt. Gegen diese Referenz gerechnet, kippte die ganze Figur.
 *
 * Richtig ist die BINDEPOSE, und die steht in den inversen Bindematrizen
 * des Skins: `inverse(boneInverse)` ist die Weltmatrix des Knochens in
 * Bindestellung. Fehlt ein Skin — Mixamo liefert bei "Without Skin" nur
 * Skelett und Kurven —, bleibt nur die Ladepose; dann sollte über
 * `--ruhe` eine T-Pose-Datei mitgegeben werden.
 */
function ruheposeQuelle(quelle, quelleName) {
  const q = new Quaternion(), p = new Vector3(), s = new Vector3();
  const drehung = new Map(), position = new Map();
  const skelett = quelle.skin?.skeleton;
  if (skelett) {
    // Die inversen Bindematrizen stehen im Raum der DATEI, die Animation
    // dagegen im Raum der geladenen Szene. Ist die FBX Z-up, dreht three
    // beim Laden nach Y-up, ohne die Bindematrizen anzufassen — bei der
    // Mixamo-Datei führte die Bindepose den Kopf bei z = 89, die Animation
    // bei y = 34. Gegeneinander gerechnet kippte die Figur um und lag flach.
    //
    // Die fehlende Drehung steht in der `bindMatrix` des Skins (three
    // rechnet sie beim Skinning selbst wieder heraus). `Skeleton.pose()`
    // hilft hier NICHT: Es setzt die Knochen auf `inverse(boneInverse)` und
    // schreibt damit denselben ungedrehten Raum zurück.
    //
    // Ob die Bindematrix vorwärts oder rückwärts anzuwenden ist, hängt vom
    // Exportweg ab und wird deshalb nicht geraten, sondern GEPRÜFT: Die
    // Figur steht in der Bindepose aufrecht, also muss die Richtung
    // Hüfte→Kopf ungefähr dorthin zeigen wie im geladenen Zustand. Die
    // falsche Variante stellt die Figur auf den Kopf — im Test lag der
    // Kopf 0,3 Einheiten unter der Hüfte.
    quelle.wurzel.updateMatrixWorld(true);
    const raum = waehleRaum(quelle, skelett);
    skelett.bones.forEach((b, i) => {
      const m = skelett.boneInverses[i].clone().invert().premultiply(raum);
      m.decompose(p, q, s);
      for (const name of new Set([b.name, kanonisch(b.name)])) {
        drehung.set(name, q.clone());
        position.set(name, p.clone());
      }
    });
    return { drehung, position, quelle: 'Bindepose' };
  }
  quelle.wurzel.updateMatrixWorld(true);
  for (const [n, b] of quelle.knochen) {
    b.matrixWorld.decompose(p, q, s);
    drehung.set(n, q.clone());
    position.set(n, p.clone());
  }
  // `quelle.knochen` führt bereits beide Schreibweisen (siehe ladeFbx).
  console.warn(`[hinweis] ${quelleName}: kein Skin enthalten — als Ruhepose dient die Ladepose. ` +
               'Sitzt die Figur schief, eine T-Pose-FBX über --ruhe mitgeben.');
  return { drehung, position, quelle: 'Ladepose' };
}

/**
 * Größenverhältnis der beiden Skelette, gemessen als Abstand Fuß→Kopf in
 * der jeweiligen Ruhepose.
 *
 * Gemessen wird die STRECKE, nicht die Höhe entlang einer Achse: Quelle
 * und Ziel stehen in unterschiedlich orientierten Bezugssystemen (die GLB
 * kippt ihre Wurzel um 90°), da wäre "y" mal die Höhe und mal die Tiefe.
 * Ein früherer Versuch nahm die Bounding-Box des Meshes — die umfasst
 * auch Umhang und Waffe und lieferte 17 % zu viel, worauf die Figur bei
 * jedem Schritt zu weit wanderte.
 */
function groessenFaktor(quelle, ziel, ruhe, zuordnung) {
  const paarFür = (zielName) => zuordnung.paare.find(([, z]) => z === zielName)?.[0];
  const strecke = (obenZiel, untenZiel) => {
    const [qo, qu] = [paarFür(obenZiel), paarFür(untenZiel)];
    const [io, iu] = [ziel.nachName.get(obenZiel), ziel.nachName.get(untenZiel)];
    if (!qo || !qu || io === undefined || iu === undefined) return null;
    const q = ruhe.position.get(qo)?.distanceTo(ruhe.position.get(qu));
    const z = ziel.ruheWeltPos.get(io).distanceTo(ziel.ruheWeltPos.get(iu));
    return q > 1e-6 ? z / q : null;
  };
  return strecke('Head', 'L_Foot') ?? strecke('Head', 'Hip') ?? 1;
}

/**
 * Ergänzt Ruheposen, die im Skin der Quelle fehlen.
 *
 * Ein Skin führt nur die Knochen, an die das Mesh tatsächlich gewichtet
 * ist. Bei der Tripo-FBX mit vier NLA-Spuren waren das ausgerechnet NICHT
 * die Hauptgelenke: Hip, Ober- und Unterarme sowie Ober- und
 * Unterschenkel fehlten, gewichtet war gegen die Twist-Knochen. Ohne
 * Ergänzung bricht das Retargeting an der Hüfte ab.
 *
 * Die Lücke lässt sich aus dem ZIEL füllen: Beide Skelette stehen in
 * derselben Ruhehaltung, sie unterscheiden sich nur in der Ausrichtung
 * ihres Bezugssystems. Diese Ausrichtung `C` kommt aus einem Knochen, der
 * in beiden vorliegt; die fehlenden Ruhedrehungen sind dann
 * `C⁻¹ · Ruhedrehung des Ziels`.
 *
 * Für die Position gilt das nicht — sie hängt an der Größe des Skeletts.
 * Gebraucht wird ohnehin nur die Hüfte, und dort genügt ihr Wert im
 * ersten Bild: Der Weltversatz wird relativ dazu gemessen, eine
 * konstante Verschiebung fällt heraus.
 */
function ergaenzeRuhepose(ruhe, quelle, ziel, zuordnung) {
  const fehlend = zuordnung.paare.filter(([q]) => !ruhe.drehung.has(q));
  if (!fehlend.length) return ruhe;

  const anker = zuordnung.paare.find(([q, z]) => ruhe.drehung.has(q) && ziel.nachName.has(z));
  if (!anker) {
    console.warn('[warnung] Quelle hat keine brauchbare Bindepose — Ergebnis wird ungenau.');
    return ruhe;
  }
  const [ankerQ, ankerZ] = anker;
  const C = ziel.ruheWelt.get(ziel.nachName.get(ankerZ)).clone()
    .multiply(ruhe.drehung.get(ankerQ).clone().invert());
  const Cinv = C.clone().invert();

  quelle.wurzel.updateMatrixWorld(true);
  for (const [q, z] of fehlend) {
    const zi = ziel.nachName.get(z);
    if (zi === undefined) continue;
    ruhe.drehung.set(q, Cinv.clone().multiply(ziel.ruheWelt.get(zi)));
    const b = quelle.knochen.get(q);
    if (b) ruhe.position.set(q, welt(b).p.clone());
  }
  console.log(`  … ${fehlend.length} Ruheposen aus dem Zielskelett ergänzt ` +
              `(fehlten im Skin: ${fehlend.map(([q]) => q).slice(0, 6).join(', ')}` +
              `${fehlend.length > 6 ? ', …' : ''})`);
  return ruhe;
}

/**
 * Bestimmt die Drehung vom Welt-Bezugssystem der Quelle in das des Ziels.
 *
 * ── Warum nicht einfach aus einem Knochen ────────────────────────────
 * Naheliegend wäre `C = Ruhedrehung(Ziel) · Ruhedrehung(Quelle)⁻¹` an
 * einem Knochen. Bei zwei Exporten DESSELBEN Rigs stimmt das auch. Für
 * Mixamo gegen Tripo nicht: Nachgemessen ergab die Hüfte 135°, die
 * Wirbelsäule 179° und die Beine 83–90° — bei 60° Streuung. Der Grund ist
 * nicht etwa eine andere Haltung, sondern dass beide Rigs die LOKALEN
 * Achsen ihrer Knochen anders legen. Dieser Unterschied gehört nicht ins
 * Bewegungs-Delta; wird er mit hineingezogen, klappt die Figur zusammen —
 * im Test lag der Kopf unter den Füßen.
 *
 * ── Stattdessen: das Achsenkreuz des Körpers ─────────────────────────
 * Aus den Ruhepositionen beider Skelette wird je ein Dreibein gebaut —
 * "hoch" von der Hüfte zum Kopf, "seitlich" von der rechten zur linken
 * Hüfte, "vorne" als deren Kreuzprodukt. Beide Dreibeine beschreiben
 * dieselbe Körperhaltung, nur in verschieden orientierten Welten; die
 * Drehung zwischen ihnen ist genau die gesuchte Korrektur und hängt an
 * keiner Knochenachse.
 */
function raumKorrektur(quelleRuhe, ziel, zuordnung) {
  const quellName = (z) => zuordnung.paare.find(([, zz]) => zz === z)?.[0];
  const pQ = (z) => { const n = quellName(z); return n ? quelleRuhe.position.get(n) ?? null : null; };
  const pZ = (z) => { const i = ziel.nachName.get(z); return i === undefined ? null : ziel.ruheWeltPos.get(i); };

  const dreibein = (hoch1, hoch2, links, rechts, hole) => {
    const [a, b, l, r] = [hole(hoch1), hole(hoch2), hole(links), hole(rechts)];
    if (!a || !b || !l || !r) return null;
    const hoch = a.clone().sub(b).normalize();
    let seit = l.clone().sub(r);
    // Gram-Schmidt: den Anteil entlang "hoch" herausnehmen, sonst steht
    // das Dreibein schief, wenn die Hüftknochen nicht exakt waagerecht
    // nebeneinanderliegen.
    seit.sub(hoch.clone().multiplyScalar(seit.dot(hoch)));
    if (seit.lengthSq() < 1e-9) return null;
    seit.normalize();
    const vorn = new Vector3().crossVectors(seit, hoch);
    return new Matrix4().makeBasis(seit, hoch, vorn);
  };

  const mQ = dreibein('Head', 'Hip', 'L_Thigh', 'R_Thigh', pQ);
  const mZ = dreibein('Head', 'Hip', 'L_Thigh', 'R_Thigh', pZ);
  if (!mQ || !mZ) {
    console.warn('[warnung] Achsenkreuz nicht bestimmbar — Bewegung kann verdreht ankommen.');
    return { C: new Quaternion(), vornZiel: new Vector3(0, 0, 1) };
  }
  // Dritte Spalte des Ziel-Dreibeins: die Blickrichtung im Zielraum.
  const vornZiel = new Vector3().setFromMatrixColumn(mZ, 2).normalize();
  return {
    C: new Quaternion().setFromRotationMatrix(mZ.clone().multiply(mQ.invert())),
    vornZiel,
  };
}

/** Weltdrehung und Weltposition eines Objekts im aktuellen Zustand. */
function welt(obj) {
  const q = new Quaternion(), p = new Vector3(), s = new Vector3();
  obj.matrixWorld.decompose(p, q, s);
  return { q, p };
}

// ── Retargeting ───────────────────────────────────────────────────────

/**
 * Rechnet einen Clip auf das Zielskelett um.
 *
 * Vorgehen je Frame und Zielknochen:
 *   delta        = q_quelle_welt · q_quelleRuhe_welt⁻¹
 *   q_ziel_welt  = C · delta · C⁻¹ · q_zielRuhe_welt
 *   q_ziel_lokal = q_zielElternWelt⁻¹ · q_ziel_welt
 *
 * `C` dreht vom Welt-Bezugssystem der Quelle in das des Ziels — beim
 * Testmodell 90° um X, weil der glTF-Export die Wurzel kippt, die FBX
 * aber nicht. Ohne diese Konjugation wird das Bewegungs-Delta um die
 * falschen Achsen angelegt: Die Beine schwangen seitwärts statt nach
 * vorn. `C` kommt aus der Hüfte, weil die in beiden Rigs am stabilsten
 * liegt; stehen beide Skelette in T-Pose, ist sie für alle Knochen gleich.
 *
 * Knochen ohne Quelle (Twists, Pelvis, NeckTwist02) behalten ihre lokale
 * Ruhedrehung; ihre Weltdrehung ergibt sich damit aus dem Elternteil und
 * die Kette bleibt geschlossen.
 */
function retargete(clip, quelle, ziel, ruhe, hoehenFaktor, zuordnung) {
  const { eltern, nachName, ruheLokal, ruheWelt, ruheWeltPos } = ziel;
  const ruheQuelleWelt = ruhe.drehung;
  const mixer = new AnimationMixer(quelle.wurzel);
  const aktion = mixer.clipAction(clip);
  aktion.play();

  // Der letzte Abtastpunkt muss VOR der Clipdauer liegen: Bei `setTime(t)`
  // mit t == duration springt der Mixer per Schleife auf den Anfang
  // zurück. Der so entstandene Scheinsprung ließ die Erkennung des
  // Stillstands am Ende ins Leere laufen und verfälschte den Schlussframe.
  const frames = Math.max(2, Math.floor(clip.duration * FPS) + 1);
  const tMax = Math.max(0, clip.duration - 1e-4);
  const zeiten = new Float32Array(frames);
  // Zielknoten, für die Kurven entstehen, samt ihrem Quellknochen. Die
  // Zuordnung wird einmal aufgelöst und nicht in jedem Frame neu gesucht.
  const paare = []; // { idx, qb, ruheQ, spur }
  for (const [quellName, zielName] of zuordnung.paare) {
    const idx = nachName.get(zielName);
    const qb = quelle.knochen.get(quellName);
    // Die Wurzel trägt nur die Fortbewegung, keine Körperhaltung — ihre
    // Drehung mitzunehmen legte die ganze Figur schief. Ihre Bewegung
    // kommt weiter unten über die Hüfte herein.
    if (idx === undefined || !qb || zielName === 'Root') continue;
    paare.push({ idx, qb, ruheQ: ruheQuelleWelt.get(quellName), spur: new Float32Array(frames * 4) });
  }
  // Von der Wurzel abwärts, damit die Weltdrehung des Elternteils beim
  // Umrechnen ins Lokale bereits vorliegt.
  paare.sort((a, b) => tiefe(a.idx, eltern) - tiefe(b.idx, eltern));

  // Raumkorrektur aus dem Achsenkreuz beider Körper (siehe raumKorrektur).
  const hüfteQuellName = zuordnung.paare.find(([, z]) => z === WURZEL_ZIEL)?.[0];
  const hüfteIdx = nachName.get(WURZEL_ZIEL);
  const { C, vornZiel } = raumKorrektur(ruhe, ziel, zuordnung);
  const Cinv = C.clone().invert();
  const hüftePos = new Float32Array(frames * 3);
  // Fußstellung relativ zur Hüfte je Bild. Daraus wird die Schrittweite
  // bestimmt, falls der Clip auf der Stelle läuft (siehe backeSchrittWeg).
  const fuesse = [];
  for (const zn of ['L_Foot', 'R_Foot']) {
    const qn = zuordnung.paare.find(([, z]) => z === zn)?.[0];
    const b = qn ? quelle.knochen.get(qn) : null;
    if (b) fuesse.push({ b, spur: [] });
  }

  for (let f = 0; f < frames; f++) {
    const t = Math.min(tMax, f / FPS);
    zeiten[f] = t;
    mixer.setTime(t);
    quelle.wurzel.updateMatrixWorld(true);

    // Erst alle Weltdrehungen bestimmen …
    const zielWelt = new Map();
    for (const { idx, qb, ruheQ } of paare) {
      const delta = welt(qb).q.clone().multiply(ruheQ.clone().invert());
      // C · delta · C⁻¹ dreht das Delta in das Bezugssystem des Ziels.
      const gedreht = C.clone().multiply(delta).multiply(Cinv);
      zielWelt.set(idx, gedreht.multiply(ruheWelt.get(idx)));
    }
    // … dann in lokale Drehungen umrechnen. Knochen ohne eigene Kurve
    // (Twists, Pelvis) stehen in `zielWelt` nicht drin; für sie gilt die
    // Ruhedrehung, damit die Kette geschlossen bleibt.
    for (const { idx, spur } of paare) {
      const qw = zielWelt.get(idx);
      const p = eltern.get(idx);
      const qElternWelt = p === undefined ? new Quaternion()
        : (zielWelt.get(p) ?? ruheWelt.get(p));
      const ql = qElternWelt.clone().invert().multiply(qw);
      spur.set([ql.x, ql.y, ql.z, ql.w], f * 4);
    }

    // Hüftverschiebung. Sie muss im WELTRAUM genommen werden: Je nach Rig
    // trägt mal die Wurzel, mal die Hüfte selbst die Fortbewegung — beim
    // Testmodell steckte sie in der Wurzel, weshalb die lokale
    // Hüftposition konstant blieb und die Figur auf der Stelle ruderte.
    // Der Weltversatz erwischt beide Fälle.
    if (hüfteIdx !== undefined && hüfteQuellName) {
      const qb = quelle.knochen.get(hüfteQuellName);
      const ruheP = ruheWeltPos.get(hüfteIdx);
      const versatz = welt(qb).p.clone()
        .sub(ruhe.position.get(hüfteQuellName))
        .multiplyScalar(hoehenFaktor)
        .applyQuaternion(C);
      const weltZiel = ruheP.clone().add(versatz);
      // Zurück in den lokalen Raum des Elternteils (die Wurzel bleibt in
      // Ruhe, weil sie oben vom Retargeting ausgenommen ist).
      const e = eltern.get(hüfteIdx);
      const lokal = e === undefined
        ? weltZiel
        : weltZiel.clone().sub(ruheWeltPos.get(e)).applyQuaternion(ruheWelt.get(e).clone().invert());
      hüftePos.set([lokal.x, lokal.y, lokal.z], f * 3);
    }

    // Füße relativ zur Hüfte mitschreiben — Grundlage der Schrittweite.
    const hüfteWelt = hüfteQuellName ? welt(quelle.knochen.get(hüfteQuellName)).p : new Vector3();
    for (const fu of fuesse) fu.spur.push(welt(fu.b).p.clone().sub(hüfteWelt));
  }
  aktion.stop();
  const roh = kürzeStillstand({ zeiten, paare, hüfteIdx, hüftePos, frames });
  // Die Vorwärtsrichtung in den lokalen Raum des Hüft-Elternteils drehen:
  // `hüftePos` sind lokale Koordinaten, und die glTF-Wurzel steht um 90°
  // gekippt — eine Weltrichtung dort einzusetzen schickte die Figur beim
  // Laufen nach oben statt nach vorn.
  const eH = eltern.get(hüfteIdx);
  const vornLokal = eH === undefined
    ? vornZiel.clone()
    : vornZiel.clone().applyQuaternion(ruheWelt.get(eH).clone().invert());
  backeSchrittWeg(roh, fuesse, hoehenFaktor, vornLokal, opt.tempo);
  return roh;
}

/**
 * Legt einem Clip ohne Wegstrecke eine künstliche Wanderung unter.
 *
 * Mixamo bietet seine Laufzyklen wahlweise „In Place" an, und genau so kam
 * `Unarmed Run Forward` an: Die Hüfte legte über den ganzen Zyklus 2,7
 * Einheiten zurück statt 83 wie beim Gehen. Für die Darstellung ist das
 * sogar das bessere Format — AvatarRig entfernt die Wanderung ohnehin und
 * lässt den PlayerController die Figur bewegen. Gebraucht wird sie nur als
 * MASSSTAB: `messeUndEntferneWurzelbewegung()` liest daran ab, für welches
 * Tempo der Clip animiert wurde, und normiert `speedRatio` danach gegen das
 * Fußrutschen. Ohne Wegstrecke gilt der Clip dort als Standpose und würde
 * als Laufzyklus nie ausgewählt.
 *
 * Der Maßstab kommt deshalb aus der Schrittweite: Der Abstand zwischen
 * vorderster und hinterster Fußstellung ist die Länge eines Schrittes, und
 * ein Zyklus enthält deren zwei. Die so gewonnene Strecke wird linear in
 * die Hüftspur geschrieben — in welche Richtung, ist gleichgültig, weil
 * AvatarRig die Achse nur misst und dann festnagelt.
 */
function backeSchrittWeg(r, fuesse, hoehenFaktor, vornZiel, wunschTempo = 0) {
  if (r.hüfteIdx === undefined || !fuesse.length) return;

  // Vorhandene Wanderung? Dann nichts tun.
  let vorhanden = 0;
  for (let a = 0; a < 3; a++) {
    let min = Infinity, max = -Infinity;
    for (let f = 0; f < r.frames; f++) {
      const v = r.hüftePos[f * 3 + a];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    vorhanden = Math.max(vorhanden, max - min);
  }
  const dauerRoh = r.zeiten[r.frames - 1] - r.zeiten[0];

  // Schrittweite: größte Spanne einer Fußspur, gemessen in der Achse mit
  // der stärksten Auslenkung (das ist die Laufrichtung).
  let weite = 0;
  for (const fu of fuesse) {
    for (let a = 0; a < 3; a++) {
      const werte = fu.spur.map((v) => v.getComponent(a));
      weite = Math.max(weite, Math.max(...werte) - Math.min(...werte));
    }
  }
  weite *= hoehenFaktor;
  if (weite < 1e-3 || dauerRoh <= 0) return;
  const dauer = dauerRoh;
  if (vorhanden > 0.2) {
    // Wegstrecke ist vorhanden — nur zur Kontrolle melden, wie die
    // Schätzung ausfiele. So lässt sich die Formel an Clips prüfen, deren
    // Tempo bekannt ist.
    console.log(`  … Wegstrecke vorhanden (${vorhanden.toFixed(2)} je Zyklus); ` +
                `Schätzung aus der Schrittweite läge bei ${(2 * weite).toFixed(2)}`);
    return;
  }
  // `--tempo` schlägt die Schätzung. Nötig bei "In Place"-Läufen, deren
  // Füße relativ zur Hüfte kürzer ausschwingen, als es der dargestellten
  // Geschwindigkeit entspricht: Beim Mixamo-Rennzyklus kamen so 1,58 m/s
  // heraus, kaum mehr als beim Gehen — die Normierung lief in ihren
  // Anschlag und die Füße rutschten.
  const MODELL_SKALIERUNG = 1.8181818; // 1,8 m / 0,99 Modelleinheiten
  const strecke = wunschTempo > 0
    ? (wunschTempo / MODELL_SKALIERUNG) * dauer
    : 2 * weite;                       // sonst: zwei Schritte je Zyklus
  const tempo = (strecke / dauer) * MODELL_SKALIERUNG;

  // Richtung: streng entlang EINER Achse, und zwar der, in die die
  // Blickrichtung des Zielskeletts überwiegend zeigt.
  //
  // Die Achsentreue ist keine Schönheitsfrage, sondern Bedingung dafür,
  // dass die Strecke wieder verschwindet: AvatarRig entfernt die Wanderung,
  // indem es die Achse mit der grössten Spanne auf ihren Bindepose-Wert
  // festnagelt — und NUR diese eine (bewusst so, sonst stirbt mit der
  // Wanderung auch das Wippen und der seitliche Versatz des Gangs). Eine
  // schräge Richtung hinterlässt in den beiden anderen Achsen einen Rest,
  // der als linearer Drift über den ganzen Zyklus stehenbleibt.
  //
  // Genau das war zu sehen: Die Blickrichtung ist rund 6° nach oben
  // geneigt, was bei 11,4 m Zyklusstrecke 1,19 m Anstieg übrigliess — die
  // Figur stieg im Lauf sichtbar hoch und fiel am Zyklusende zurück. Ein
  // früherer Versuch mit der raumkorrigierten Z-Achse hatte denselben
  // Fehler, nur stärker (0,64 Einheiten).
  //
  // Welche Richtung es am Ende ist, spielt keine Rolle: Die Strecke dient
  // ausschliesslich als Maßstab für das Tempo und wird beim Laden wieder
  // herausgerechnet.
  const achsen = ['x', 'y', 'z'];
  const haupt = achsen.reduce((a, b) => (Math.abs(vornZiel[b]) > Math.abs(vornZiel[a]) ? b : a));
  const vorn = new Vector3(0, 0, 0);
  vorn[haupt] = Math.sign(vornZiel[haupt]) || 1;
  for (let f = 0; f < r.frames; f++) {
    const anteil = r.frames > 1 ? f / (r.frames - 1) : 0;
    r.hüftePos[f * 3] += vorn.x * strecke * anteil;
    r.hüftePos[f * 3 + 1] += vorn.y * strecke * anteil;
    r.hüftePos[f * 3 + 2] += vorn.z * strecke * anteil;
  }
  console.log(`  … ohne Wegstrecke geliefert ("In Place"); ` +
              (wunschTempo > 0
                ? `Tempo auf ${tempo.toFixed(2)} m/s gesetzt (--tempo)`
                : `aus der Schrittweite ${weite.toFixed(2)} geschätzt: ${tempo.toFixed(2)} m/s`));
}

/**
 * Schneidet einen eingefrorenen Schwanz am Clipende ab.
 *
 * Manche Exporte hängen an die eigentliche Bewegung eine lange Standphase:
 * Bei der Tripo-FBX mit vier NLA-Spuren bekam der Stack die Gesamtdauer
 * aller Spuren (17,58 s), gefüllt war aber nur die erste (1,9 s) — die
 * restlichen 15,7 s hielten die Endpose. Ungekürzt bekäme AvatarRig einen
 * Gehzyklus, der zu neun Zehnteln stillsteht, und die Figur bliebe nach
 * dem ersten Schritt wie angewurzelt stehen.
 *
 * Erkannt wird das an der Bild-zu-Bild-Änderung: ab wo sich bis zum Ende
 * nichts mehr regt, wird geschnitten (ein Frame bleibt als Auslauf).
 */
function kürzeStillstand(r) {
  const TOLERANZ = 1e-4;
  let letzte = 0;
  for (let f = 1; f < r.frames; f++) {
    let bewegt = false;
    for (const { spur } of r.paare) {
      for (let k = 0; k < 4; k++) {
        if (Math.abs(spur[f * 4 + k] - spur[(f - 1) * 4 + k]) > TOLERANZ) { bewegt = true; break; }
      }
      if (bewegt) break;
    }
    if (!bewegt && r.hüfteIdx !== undefined) {
      for (let k = 0; k < 3; k++) {
        if (Math.abs(r.hüftePos[f * 3 + k] - r.hüftePos[(f - 1) * 3 + k]) > TOLERANZ) { bewegt = true; break; }
      }
    }
    if (bewegt) letzte = f;
  }
  const neu = Math.min(r.frames, letzte + 2);
  if (neu >= r.frames || neu < 2) return r;
  console.log(`  … Stillstand ab ${r.zeiten[neu - 1].toFixed(2)} s abgeschnitten ` +
              `(war ${r.zeiten[r.frames - 1].toFixed(2)} s lang)`);
  return {
    zeiten: r.zeiten.slice(0, neu),
    paare: r.paare.map((p) => ({ ...p, spur: p.spur.slice(0, neu * 4) })),
    hüfteIdx: r.hüfteIdx,
    hüftePos: r.hüftePos.slice(0, neu * 3),
    frames: neu,
  };
}

function tiefe(idx, eltern) {
  let d = 0, i = idx;
  while (eltern.has(i)) { i = eltern.get(i); d++; }
  return d;
}

// ── glTF-Animation anhängen ───────────────────────────────────────────

/** Hängt einen Float-Block an den Binärteil und liefert den Accessor-Index. */
function neuerAccessor(json, teile, daten, typ, anzahl, extra = {}) {
  const versatz = teile.laenge;
  teile.stuecke.push(Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength));
  teile.laenge += daten.byteLength;
  const pad = (4 - (teile.laenge % 4)) % 4;
  if (pad) { teile.stuecke.push(Buffer.alloc(pad)); teile.laenge += pad; }

  json.bufferViews.push({ buffer: 0, byteOffset: versatz, byteLength: daten.byteLength });
  json.accessors.push({
    bufferView: json.bufferViews.length - 1,
    componentType: 5126, // FLOAT
    count: anzahl,
    type: typ,
    ...extra,
  });
  return json.accessors.length - 1;
}

// ── Hauptlauf ─────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opt = { basis: 'assets/models/PlayerAvatar.glb', out: null, behalte: false, ruhe: null, tempo: 0 };
const quellen = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--basis') opt.basis = argv[++i];
  else if (a === '--out') opt.out = argv[++i];
  else if (a === '--behalte') opt.behalte = true;
  else if (a === '--ruhe') opt.ruhe = argv[++i];
  else if (a === '--tempo') opt.tempo = Number(argv[++i]);
  else {
    const m = a.match(/^([^=]+)=(.+)$/);
    quellen.push(m ? { name: m[1], datei: m[2] } : { name: path.basename(a, '.fbx'), datei: a });
  }
}
opt.out ??= opt.basis;
if (!quellen.length) {
  console.error('Nutzung: node tools/mixamo-to-avatar.mjs [--basis x.glb] [--out y.glb] [--behalte] name=clip.fbx …');
  process.exit(1);
}

const { json, bin } = leseGlb(opt.basis);
json.bufferViews ??= [];
json.accessors ??= [];
json.animations = opt.behalte ? (json.animations ?? []) : [];
const ziel = zielSkelett(json);

const fehlend = Object.values(KNOCHEN).filter((n) => !ziel.nachName.has(n));
if (fehlend.length) console.warn('[warnung] Zielknochen fehlen:', fehlend.join(', '));

const teile = { stuecke: [bin], laenge: bin.length };
if (teile.laenge % 4) { const p = 4 - (teile.laenge % 4); teile.stuecke.push(Buffer.alloc(p)); teile.laenge += p; }

for (const { name, datei } of quellen) {
  const quelle = ladeFbx(datei);
  // Ruhepose der Quelle — Bindepose, wenn ein Skin dabei ist (siehe dort).
  const ruhe = opt.ruhe
    ? ruheposeQuelle(ladeFbx(opt.ruhe), opt.ruhe)
    : ruheposeQuelle(quelle, path.basename(datei));

  // Größenverhältnis für die Hüftverschiebung: Mixamo rechnet in
  // Zentimetern, unser Modell in Metern-Bruchteilen — ohne diesen Faktor
  // schösse die Figur beim ersten Schritt aus dem Bild.
  const zuordnung = baueZuordnung(quelle, ziel);
  ergaenzeRuhepose(ruhe, quelle, ziel, zuordnung);
  const faktor = groessenFaktor(quelle, ziel, ruhe, zuordnung);
  if (!zuordnung.paare.length) {
    console.error(`[fehler] ${datei}: kein Knochen passt auf das Zielskelett.`);
    console.error('         gefunden:', [...quelle.knochen.keys()].slice(0, 8).join(', '), '…');
    continue;
  }
  console.log(`${path.basename(datei)} — ${quelle.knochen.size} Knochen, Zuordnung ` +
              `${zuordnung.art} (${zuordnung.paare.length} Paare), ${quelle.wurzel.animations.length} Clips`);

  for (const clip of quelle.wurzel.animations) {
    // Mixamo legt je Datei genau einen Clip ab, andere Exporte auch mal
    // mehrere (die Tripo-FBX etwa Gehen und Rennen doppelt, einmal roh und
    // einmal unter `Armature|…`). Der Wunschname darf dann nicht mehrfach
    // vergeben werden — AvatarRig fände seine Clips sonst am falschen
    // wieder. Die Prüfung steht VOR dem Umrechnen, damit für einen
    // verworfenen Clip erst gar keine Daten in die Datei wandern.
    const mehrere = quelle.wurzel.animations.length > 1;
    const clipName = mehrere ? `${name}_${clip.name.replace(/^Armature\|/, '')}` : name;
    if (json.animations.some((a) => a.name === clipName)) {
      console.log(`  ${clipName}: übersprungen (Name bereits vergeben)`);
      continue;
    }

    const r = retargete(clip, quelle, ziel, ruhe, faktor, zuordnung);
    const zeitAcc = neuerAccessor(json, teile, r.zeiten, 'SCALAR', r.frames,
      { min: [r.zeiten[0]], max: [r.zeiten[r.frames - 1]] });

    const samplers = [], channels = [];
    for (const { idx, spur } of r.paare) {
      const acc = neuerAccessor(json, teile, spur, 'VEC4', r.frames);
      samplers.push({ input: zeitAcc, interpolation: 'LINEAR', output: acc });
      channels.push({ sampler: samplers.length - 1, target: { node: idx, path: 'rotation' } });
    }
    if (r.hüfteIdx !== undefined) {
      const acc = neuerAccessor(json, teile, r.hüftePos, 'VEC3', r.frames);
      samplers.push({ input: zeitAcc, interpolation: 'LINEAR', output: acc });
      channels.push({ sampler: samplers.length - 1, target: { node: r.hüfteIdx, path: 'translation' } });
    }
    json.animations.push({ name: clipName, samplers, channels });
    console.log(`  ${clipName}: ${r.zeiten[r.frames - 1].toFixed(2)} s, ${r.frames} Frames, ` +
                `${channels.length} Kanäle (aus "${clip.name}")`);
  }
}

const neuerBin = Buffer.concat(teile.stuecke, teile.laenge);
json.buffers = [{ byteLength: neuerBin.length }];
const groesse = schreibeGlb(opt.out, json, neuerBin);
console.log(`\n${opt.out}: ${json.animations.length} Clips, ${(groesse / 1024 / 1024).toFixed(2)} MB`);
