#!/usr/bin/env node
/**
 * Zone-to-kit converter (editor block C3): turns a zone document (`village1.json`) or one region of a world
 * document (`dev.json`) into a kit file (`Bausatz`, see `shared/src/bausatz/types.ts`).
 * Wandelt eine Zonen-Datei oder eine Region einer Weltdatei in eine Bausatz-Datei um.
 *
 *   tsx tools/zone-als-bausatz.mjs village  --ein <village1.json> --aus <bausatz.json> --id village1 [--name <Name>] [--bericht <bericht.json>]
 *   tsx tools/zone-als-bausatz.mjs startdorf --welt <dev.json> --region startinsel-dorf --id startdorf
 *                                            --aus <bausatz.json> --welt-aus <welt.json> [--name <Name>] [--bericht <bericht.json>]
 *
 * It calls no server and writes only the named output files. The kit file goes through `bausatzText` (the one
 * canonical serialisation), the world document through `layoutText`; neither carries a time stamp, so two runs give
 * the same bytes.
 *
 * Mode `village`: every entity of every zone becomes a part, minus the scenery that is not a kit part
 * (grass clumps, backdrop prefabs the catalogue marks `platzierbar: false`, the `rock-cliff` cliffs, chest bottoms parked at
 * [0,0,0]). Parts follow the ground (no `dy`). Euler → yaw/pitch/roll: `rotation = [pitch, yaw, roll]`, applied in
 * the order yaw · pitch · roll (Babylon's `RotationYawPitchRoll`).
 *
 * Mode `startdorf`: the placements of one region, minus the figures (NPCs stay single objects), become the parts.
 * The world document loses them and gets exactly one instance whose `kennungen` maps every part id to the placement id
 * it replaces, so the objects keep their address and their saved state.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bausatzText, rundePosition, sanitizeBausatzInstanzen, bausatzInstanzenFehler, sanitizeBausatzMitBericht } from '../shared/src/bausatz/sanitize.ts';
import { STORE_KATALOG_NACH_PREFAB } from '../shared/src/storeKatalogDaten.ts';
import { istNpcPrefab } from '../shared/src/npc.ts';
import { loeseBausaetzeAuf } from '../shared/src/bausatz/aufloesen.ts';
import { layoutText } from '../shared/src/worldlayout/layoutDatei.ts';
import { ID_RE } from '../shared/src/worldlayout/platzierungsId.ts';

/** Tolerance of the counting rule (tilted / non-uniform). */
export const ZAEHL_TOLERANZ = 1e-6;
/** Margin added around the hull of the parts for `grundflaeche` (m). */
export const RAND = 2;
/** Height error: |y − median(y)| above this (m) counts. */
export const HOEHE_SCHWELLE = 0.5;
const GRAS = 'vegetation-grass-short-clump-1';
const FELS_MUSTER = /^environment-sm-env-rock-cliff-/;
const TRUHE_UNTEN = 'environment-chestbottom';
const TRUHE_OBEN = 'environment-chesttop';

const nachId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const zaehle = (o, k) => {
  o[k] = (o[k] ?? 0) + 1;
};

/** A stable id for an entity id that does not fit `ID_RE` (or repeats): lower-case slug, `-2`, `-3`… on a clash. */
function leiteIdAb(roh, vergeben) {
  const slug = String(roh)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 60);
  const basis = slug.length > 0 ? slug : 'teil';
  let id = basis;
  for (let n = 2; vergeben.has(id); n += 1) id = `${basis}-${n}`;
  return id;
}

// ── Euler → yaw/pitch/roll and the quaternion check ─────────────────────────

/** Old Euler triple `[x, y, z]` (rad) → kit angles. The one mapping of the converter. */
export function eulerZuWinkeln(rotation) {
  return { yaw: normiereWinkel(rotation[1]), pitch: normiereWinkel(rotation[0]), roll: normiereWinkel(rotation[2]) };
}

/** Angle (rad) wrapped into (−π, π]; a value already inside is returned untouched (bytes stay as they were). */
export function normiereWinkel(a) {
  if (a > -Math.PI && a <= Math.PI) return a;
  const r = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return r <= -Math.PI ? Math.PI : r;
}

/** Quaternion `[x, y, z, w]` of an Euler triple as Babylon builds it: `RotationYawPitchRoll(y, x, z)`. */
export function quaternionAusEuler(rotation) {
  const [rx, ry, rz] = rotation;
  const sr = Math.sin(rz * 0.5);
  const cr = Math.cos(rz * 0.5);
  const sp = Math.sin(rx * 0.5);
  const cp = Math.cos(rx * 0.5);
  const sy = Math.sin(ry * 0.5);
  const cy = Math.cos(ry * 0.5);
  return [
    cy * sp * cr + sy * cp * sr,
    sy * cp * cr - cy * sp * sr,
    cy * cp * sr - sy * sp * cr,
    cy * cp * cr + sy * sp * sr,
  ];
}

const mal = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const achse = (x, y, z, w) => {
  const s = Math.sin(w * 0.5);
  return [x * s, y * s, z * s, Math.cos(w * 0.5)];
};

/** Quaternion of a kit part from `yaw`/`pitch`/`roll` alone, composed as R_y(yaw) · R_x(pitch) · R_z(roll). */
export function quaternionAusWinkeln({ yaw = 0, pitch = 0, roll = 0 }) {
  return mal(mal(achse(0, 1, 0, yaw), achse(1, 0, 0, pitch)), achse(0, 0, 1, roll));
}

/** `1 − |q·q'|`: 0 for the same rotation (q and −q are the same rotation). */
export function quaternionAbstand(a, b) {
  return 1 - Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
}

// ── Common: build the kit object from parts ─────────────────────────────────

/** One number only when all three components are exactly equal; any other triple stays a triple. Nothing is rounded: the kit sanitizer keeps scale as it is, like a placement. */
export const skalaAusTripel = (s) => (s[0] === s[1] && s[1] === s[2] ? s[0] : [s[0], s[1], s[2]]);

/** Rounded centroid of x/z (m, mm). */
function schwerpunkt(punkte) {
  let sx = 0;
  let sz = 0;
  for (const p of punkte) {
    sx += p.x;
    sz += p.z;
  }
  return { x: rundePosition(sx / punkte.length), z: rundePosition(sz / punkte.length) };
}

const median = (werte) => {
  const s = [...werte].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** `grundflaeche`: half extents of the hull around the anchor, plus `RAND`. */
function grundflaeche(teile) {
  let hx = 0;
  let hz = 0;
  for (const t of teile) {
    hx = Math.max(hx, Math.abs(t.dx));
    hz = Math.max(hz, Math.abs(t.dz));
  }
  return { halbX: rundePosition(hx + RAND), halbZ: rundePosition(hz + RAND) };
}

/** Runs the kit through the canonical text and back: same bytes, no findings. */
function rundlauf(bausatz) {
  const text = bausatzText(bausatz);
  const bericht = sanitizeBausatzMitBericht(JSON.parse(text));
  const text2 = bericht.bausatz === null ? null : bausatzText(bericht.bausatz);
  return {
    text,
    bytes: Buffer.byteLength(text),
    sha256: sha256(text),
    rundlaufGleich: text2 === text,
    sanitizerMeldungen: bericht.fehler.length,
  };
}

/** A triple of finite numbers. */
const istTripel = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Named error for an entity that cannot be converted (never a raw TypeError, never a silent 0). */
function pruefeEntity(e, zone, index) {
  if (e === null || typeof e !== 'object') throw new Error(`Zone "${zone.id}", Eintrag ${index}: keine Entität`);
  const name = `Entität "${typeof e.id === 'string' ? e.id : `#${index} in Zone ${zone.id}`}"`;
  if (typeof e.prefab !== 'string') throw new Error(`${name}: prefab fehlt`);
  for (const feld of ['position', 'rotation', 'scale']) {
    if (!istTripel(e[feld])) throw new Error(`${name}: ${feld} fehlt oder ist kein Tripel aus endlichen Zahlen`);
  }
}

// ── Mode village ────────────────────────────────────────────────────────────

/**
 * @param {any} roh parsed zone document
 * @param {{ id: string, name?: string }} optionen
 */
export function konvertiereVillage(roh, optionen) {
  if (!ID_RE.test(optionen.id)) throw new Error(`--id "${optionen.id}" ist keine gültige Kennung`);
  if (!roh || !Array.isArray(roh.zones)) throw new Error('Eingabe hat keine zones[]');
  const bericht = {
    modus: 'village',
    eingang: 0,
    ausgang: 0,
    ausgeduennt: { gras: 0, kulisse: 0, felsen: 0, truhenUnterteilUrsprung: 0 },
    kulisseNachPrefab: {},
    zonen: {},
    idAbgeleitet: [],
    truhen: { unterteileUrsprung: 0, oberteileBehalten: [], unterteileAndersWo: [] },
    zaehlregel: { gekippt: 0, ungleichmaessig: 0, gespiegelt: 0 },
  };
  const vergeben = new Set();
  const teile = [];
  const quellen = []; // raw entity per kept part, same index
  const gruppenIds = [];
  for (const [zoneIndex, zone] of roh.zones.entries()) {
    if (zone === null || typeof zone !== 'object' || Array.isArray(zone)) throw new Error(`zones[${zoneIndex}]: keine Zone`);
    if (zone.entities !== undefined && !Array.isArray(zone.entities)) throw new Error(`Zone "${zone.id}": entities ist kein Array`);
    for (const [index, e] of (zone.entities ?? []).entries()) {
      pruefeEntity(e, zone, index);
      bericht.eingang += 1;
      const p = e.position;
      const prefab = e.prefab;
      if (prefab === GRAS) {
        bericht.ausgeduennt.gras += 1;
        continue;
      }
      const eintrag = STORE_KATALOG_NACH_PREFAB.get(prefab);
      if (eintrag && eintrag.platzierbar === false) {
        bericht.ausgeduennt.kulisse += 1;
        zaehle(bericht.kulisseNachPrefab, prefab);
        continue;
      }
      if (FELS_MUSTER.test(prefab)) {
        bericht.ausgeduennt.felsen += 1;
        continue;
      }
      if (prefab === TRUHE_UNTEN) {
        if (p[0] === 0 && p[1] === 0 && p[2] === 0) {
          bericht.ausgeduennt.truhenUnterteilUrsprung += 1;
          bericht.truhen.unterteileUrsprung += 1;
          continue;
        }
        bericht.truhen.unterteileAndersWo.push({ id: e.id, position: p });
      }
      if (prefab === TRUHE_OBEN) {
        bericht.truhen.oberteileBehalten.push({
          id: e.id,
          position: p,
          nahUrsprung: Math.hypot(p[0], p[2]) < 1,
        });
      }
      let id = e.id;
      if (typeof id !== 'string' || !ID_RE.test(id) || vergeben.has(id)) {
        const neu = leiteIdAb(id, vergeben);
        bericht.idAbgeleitet.push({ von: id, zu: neu });
        id = neu;
      }
      vergeben.add(id);
      if (!gruppenIds.some((g) => g.id === zone.id)) gruppenIds.push({ id: zone.id, name: zone.name ?? zone.id });
      zaehle(bericht.zonen, zone.id);
      const w = eulerZuWinkeln(e.rotation);
      const skala = e.scale;
      if (Math.abs(w.pitch) > ZAEHL_TOLERANZ || Math.abs(w.roll) > ZAEHL_TOLERANZ) bericht.zaehlregel.gekippt += 1;
      if (Math.max(...skala) - Math.min(...skala) > ZAEHL_TOLERANZ) bericht.zaehlregel.ungleichmaessig += 1;
      if (skala.some((v) => v < 0)) bericht.zaehlregel.gespiegelt += 1;
      teile.push({ id, prefab, x: p[0], y: p[1], z: p[2], w, skala, gruppe: zone.id });
      quellen.push(e);
    }
  }
  if (teile.length === 0) throw new Error('kein Teil übrig');
  const anker = schwerpunkt(teile);
  const ys = teile.map((t) => t.y);
  const med = median(ys);
  const hoehenfehler = teile.filter((t) => Math.abs(t.y - med) > HOEHE_SCHWELLE).length;
  const xs = teile.map((t) => t.x);
  const zs = teile.map((t) => t.z);
  const min = (a) => a.reduce((m, v) => Math.min(m, v), Infinity);
  const max = (a) => a.reduce((m, v) => Math.max(m, v), -Infinity);
  const bausatzTeile = teile.map((t) => ({
    id: t.id,
    prefab: t.prefab,
    dx: rundePosition(t.x - anker.x),
    dz: rundePosition(t.z - anker.z),
    yaw: t.w.yaw + 0,
    ...(t.w.pitch !== 0 ? { pitch: t.w.pitch } : {}),
    ...(t.w.roll !== 0 ? { roll: t.w.roll } : {}),
    scale: skalaAusTripel(t.skala),
    gruppe: t.gruppe,
  }));
  const bausatz = {
    bausatzVersion: 1,
    id: optionen.id,
    name: optionen.name ?? (typeof roh.name === 'string' && roh.name.length > 0 ? roh.name : optionen.id),
    grundflaeche: grundflaeche(bausatzTeile),
    gruppen: gruppenIds.sort(nachId),
    teile: bausatzTeile,
  };
  bericht.ausgang = teile.length;
  bericht.anker = anker;
  bericht.hoehe = {
    medianY: rundePosition(med),
    schwelle: HOEHE_SCHWELLE,
    fehlerTeile: hoehenfehler,
    fehlerAnteil: Math.round((hoehenfehler / teile.length) * 1e6) / 1e6,
    minY: rundePosition(min(ys)),
    maxY: rundePosition(max(ys)),
  };
  bericht.ausdehnung = {
    xVon: rundePosition(min(xs)),
    xBis: rundePosition(max(xs)),
    zVon: rundePosition(min(zs)),
    zBis: rundePosition(max(zs)),
  };
  bericht.grundflaeche = bausatz.grundflaeche;
  bericht.euler = {
    zuordnung: 'rotation = [pitch, yaw, roll]; Reihenfolge yaw · pitch · roll (Babylon RotationYawPitchRoll(y, x, z))',
    belege: eulerBelege(quellen),
  };
  const rl = rundlauf(bausatz);
  bericht.ausgabe = { bytes: rl.bytes, sha256: rl.sha256, rundlaufGleich: rl.rundlaufGleich, sanitizerMeldungen: rl.sanitizerMeldungen };
  return { bausatzText: rl.text, bericht };
}

/** Three parts (one with yaw only, one tilted, one mirrored): quaternion of the old Euler vs. of yaw/pitch/roll. */
function eulerBelege(entities) {
  const gleich = (v, w) => Math.abs(v - w) <= ZAEHL_TOLERANZ;
  const nurYaw = entities.find((e) => gleich(e.rotation[0], 0) && gleich(e.rotation[2], 0) && !gleich(e.rotation[1], 0));
  const gekippt = entities.find((e) => Math.abs(e.rotation[0]) > ZAEHL_TOLERANZ || Math.abs(e.rotation[2]) > ZAEHL_TOLERANZ);
  const gespiegelt = entities.find((e) => e.scale.some((v) => v < 0));
  return [
    ['nurYaw', nurYaw],
    ['gekippt', gekippt],
    ['gespiegelt', gespiegelt],
  ]
    .filter(([, e]) => e)
    .map(([art, e]) => {
      const w = eulerZuWinkeln(e.rotation);
      const neu = { yaw: w.yaw, pitch: w.pitch, roll: w.roll };
      return { art, id: e.id, rotation: e.rotation, abstand: quaternionAbstand(quaternionAusEuler(e.rotation), quaternionAusWinkeln(neu)) };
    });
}

// ── Mode startdorf ──────────────────────────────────────────────────────────

/** Point in a region shape: circle `{x,z,radius}` or polygon `{points:[[x,z],…]}`. */
export function punktInForm(form, x, z) {
  if (form.kind === 'circle') return Math.hypot(x - form.x, z - form.z) <= form.radius;
  if (form.kind === 'polygon') {
    let innen = false;
    const pts = form.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const [xi, zi] = pts[i];
      const [xj, zj] = pts[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) innen = !innen;
    }
    return innen;
  }
  throw new Error(`unbekannte Regionsform "${form.kind}"`);
}

const istFigur = (p) => p.npc !== undefined || p.route !== undefined || istNpcPrefab(p.prefab);

/**
 * Comparison key of a placement or a resolved part, the shape of `eintrag()` in `server/src/world/layoutLiveAbgleich.ts`
 * (a copy: that module is not importable from `tools/`): raw values, defaults count like a missing field, no rounding here.
 */
const eintragVon = (id, prefab, x, z, yaw, scale, einebnen) =>
  JSON.stringify([id ?? null, prefab, x, z, yaw ?? 0, scale ?? 1, null, einebnen ?? 0, null]);

/**
 * @param {any} welt parsed world document
 * @param {{ region: string, id: string, name?: string }} optionen
 */
export function konvertiereStartdorf(welt, optionen) {
  if (!ID_RE.test(optionen.id)) throw new Error(`--id "${optionen.id}" ist keine gültige Kennung`);
  if (welt === null || typeof welt !== 'object' || Array.isArray(welt)) throw new Error('Eingabewelt ist kein Objekt');
  for (const feld of ['regions', 'placements', 'bausaetze']) {
    if (welt[feld] !== undefined && !Array.isArray(welt[feld])) throw new Error(`Eingabewelt: ${feld} ist kein Array`);
  }
  const region = (welt.regions ?? []).find((r) => r.id === optionen.region);
  if (!region) throw new Error(`Region "${optionen.region}" nicht gefunden`);
  const platzierungen = welt.placements ?? [];
  const inRegion = [];
  const draussen = [];
  for (const p of platzierungen) (punktInForm(region.shape, p.x, p.z) ? inRegion : draussen).push(p);
  const figuren = inRegion.filter(istFigur);
  const uebernommen = inRegion.filter((p) => !istFigur(p));
  if (uebernommen.length === 0) throw new Error('keine Platzierung übernommen');
  for (const p of uebernommen) {
    if (typeof p.id !== 'string' || !ID_RE.test(p.id)) throw new Error(`Platzierung ohne gültige id (${p.prefab} bei ${p.x}, ${p.z})`);
  }
  const anker = schwerpunkt(uebernommen);
  const teile = uebernommen.map((p) => ({
    id: p.id,
    prefab: p.prefab,
    dx: rundePosition(p.x - anker.x),
    dz: rundePosition(p.z - anker.z),
    yaw: p.yaw ?? 0,
    scale: p.scale ?? 1,
    ...(p.einebnen !== undefined ? { einebnen: p.einebnen } : {}),
  }));
  const bausatz = {
    bausatzVersion: 1,
    id: optionen.id,
    name: optionen.name ?? 'Startdorf',
    grundflaeche: grundflaeche(teile),
    teile,
  };
  const kennungen = {};
  for (const p of uebernommen) kennungen[p.id] = p.id;
  const instanz = { id: optionen.id, bausatz: optionen.id, x: anker.x, z: anker.z, kennungen };
  const uebrig = new Set(platzierungen.filter((p) => !uebernommen.includes(p)).map((p) => p.id));
  const alt = welt.bausaetze ?? [];
  if (alt.some((i) => i && i.id === instanz.id)) throw new Error(`Die Eingabewelt hat schon eine Instanz "${instanz.id}"`);
  const fehler = bausatzInstanzenFehler([...alt, instanz], uebrig);
  if (fehler.length > 0) throw new Error(`Instanz ungültig: ${JSON.stringify(fehler)}`);
  const [instanzKanonisch] = sanitizeBausatzInstanzen([instanz]);
  const neueWelt = {
    ...welt,
    placements: platzierungen.filter((p) => !uebernommen.includes(p)),
    bausaetze: [...alt, instanzKanonisch],
  };
  const rl = rundlauf(bausatz);
  // Proof: resolved entries equal the entries of the placements before.
  const kanonisch = sanitizeBausatzMitBericht(JSON.parse(rl.text)).bausatz;
  const aufloesung = loeseBausaetzeAuf(neueWelt, [kanonisch]);
  const aufgeloest = new Map(aufloesung.teile.map((t) => [t.id, eintragVon(t.id, t.prefab, t.x, t.z, t.yaw, t.scale, t.einebnen)]));
  let gleich = 0;
  let abweichend = 0;
  for (const p of uebernommen) {
    const vorher = eintragVon(p.id, p.prefab, p.x, p.z, p.yaw, p.scale, p.einebnen);
    if (aufloesung.fehler.length === 0 && aufgeloest.get(p.id) === vorher) gleich += 1;
    else abweichend += 1;
  }
  const bericht = {
    modus: 'startdorf',
    region: optionen.region,
    platzierungenVorher: platzierungen.length,
    inRegion: inRegion.length,
    teile: uebernommen.length,
    figuren: figuren.length,
    figurenPrefabs: figuren.map((p) => p.prefab).sort(),
    draussen: draussen.length,
    platzierungenNachher: neueWelt.placements.length,
    summeStimmt: uebernommen.length + figuren.length === inRegion.length && inRegion.length + draussen.length === platzierungen.length,
    einebnenTeile: uebernommen.filter((p) => p.einebnen !== undefined).length,
    anker,
    grundflaeche: bausatz.grundflaeche,
    instanzen: neueWelt.bausaetze.length,
    aufloesen: { verfahren: 'loeseBausaetzeAuf (C2)', fehler: aufloesung.fehler.length, unbekannt: aufloesung.unbekannt.length, gleich, abweichend, eintraege: aufgeloest.size },
    ausgabe: { bytes: rl.bytes, sha256: rl.sha256, rundlaufGleich: rl.rundlaufGleich, sanitizerMeldungen: rl.sanitizerMeldungen },
  };
  return { bausatzText: rl.text, weltText: layoutText(neueWelt), bericht };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const SCHALTER = {
  village: ['ein', 'aus', 'id', 'name', 'bericht'],
  startdorf: ['welt', 'region', 'id', 'aus', 'welt-aus', 'name', 'bericht'],
};
const PFLICHT = {
  village: ['ein', 'aus', 'id'],
  startdorf: ['welt', 'region', 'id', 'aus', 'welt-aus'],
};

/** Strict argument parsing: unknown or repeated switch, missing value or missing required switch throws. */
export function liesArgumente(argv) {
  const [modus, ...rest] = argv;
  if (!SCHALTER[modus]) throw new Error('Modus fehlt oder unbekannt (village | startdorf)');
  const werte = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    if (!k.startsWith('--') || !SCHALTER[modus].includes(k.slice(2))) throw new Error(`unbekannter Schalter "${k}"`);
    if (k.slice(2) in werte) throw new Error(`Schalter "${k}" doppelt`);
    if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) throw new Error(`Schalter "${k}" ohne Wert`);
    werte[k.slice(2)] = rest[i + 1];
  }
  for (const k of PFLICHT[modus]) if (!(k in werte)) throw new Error(`Schalter "--${k}" fehlt`);
  return { modus, werte };
}

const jsonText = (o) => JSON.stringify(o, null, 2) + '\n';

/** Real path of an existing file, else the real path of its directory plus the file name. Throws when the directory is missing. */
function loesePfad(pfad, schalter) {
  const voll = resolve(pfad);
  if (existsSync(voll)) return realpathSync(voll);
  const ordner = dirname(voll);
  if (!existsSync(ordner) || !statSync(ordner).isDirectory()) throw new Error(`${schalter}: Zielverzeichnis "${ordner}" fehlt`);
  return join(realpathSync(ordner), basename(voll));
}

/** Before the first write: no output equals an input, no two outputs are equal, every target directory exists. */
export function pruefePfade(modus, werte) {
  const eingaben = (modus === 'village' ? ['ein'] : ['welt']).map((k) => [k, loesePfad(werte[k], `--${k}`)]);
  const ausgaben = (modus === 'village' ? ['aus', 'bericht'] : ['aus', 'welt-aus', 'bericht']).filter((k) => werte[k] !== undefined).map((k) => [k, loesePfad(werte[k], `--${k}`)]);
  for (const [a, pa] of ausgaben) {
    for (const [e, pe] of eingaben) if (pa === pe) throw new Error(`--${a} ist dieselbe Datei wie --${e} (${pa})`);
  }
  for (let i = 0; i < ausgaben.length; i += 1) {
    for (let j = i + 1; j < ausgaben.length; j += 1) {
      if (ausgaben[i][1] === ausgaben[j][1]) throw new Error(`--${ausgaben[i][0]} und --${ausgaben[j][0]} sind dieselbe Datei (${ausgaben[i][1]})`);
    }
  }
}

export function main(argv) {
  const { modus, werte } = liesArgumente(argv);
  pruefePfade(modus, werte);
  const lies = (pfad) => {
    const bytes = readFileSync(pfad);
    return { text: bytes.toString('utf-8'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  };
  let ergebnis;
  if (modus === 'village') {
    const ein = lies(werte.ein);
    ergebnis = konvertiereVillage(JSON.parse(ein.text), { id: werte.id, name: werte.name });
    ergebnis.bericht.eingabe = { bytes: ein.bytes, sha256: ein.sha256 };
  } else {
    const ein = lies(werte.welt);
    ergebnis = konvertiereStartdorf(JSON.parse(ein.text), { region: werte.region, id: werte.id, name: werte.name });
    ergebnis.bericht.eingabe = { bytes: ein.bytes, sha256: ein.sha256 };
    writeFileSync(werte['welt-aus'], ergebnis.weltText);
  }
  writeFileSync(werte.aus, ergebnis.bausatzText);
  if (werte.bericht) writeFileSync(werte.bericht, jsonText(ergebnis.bericht));
  return ergebnis.bericht;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bericht = main(process.argv.slice(2));
    process.stdout.write(jsonText(bericht));
  } catch (fehler) {
    process.stderr.write(`zone-als-bausatz: ${fehler instanceof Error ? fehler.message : String(fehler)}\n`);
    process.exit(1);
  }
}
