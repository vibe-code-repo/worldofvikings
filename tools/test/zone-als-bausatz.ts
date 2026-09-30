/**
 * Selftest of `tools/zone-als-bausatz.mjs` (editor block C3): small fixtures only, never `village1.json`, so CI runs it.
 * Covers every thinning rule, the chest report, the counting rule, byte-equal repetition (in-process and through the
 * command line), Euler → yaw/pitch/roll one case per axis, and the start village on a mini world (parts, figures stay,
 * `kennungen`, resolve check).
 * Selbsttest des Zonen-Konverters: nur kleine Fixtures, jede Ausdünnregel, Truhen-Meldung, Zählregel, byte-gleiche
 * Wiederholung, Euler je Achse, Startdorf mit einer Mini-Welt.
 *
 * `C3_KONVERTER` points the test at another converter file (mutant runs, see the report).
 *
 * Run: npx tsx tools/test/zone-als-bausatz.ts   (from the repo root)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizeBausatzMitBericht } from '../../shared/src/bausatz/sanitize.ts';

const WURZEL = resolve(__dirname, '../..');
const KONVERTER = process.env.C3_KONVERTER ? resolve(process.env.C3_KONVERTER) : join(WURZEL, 'tools/zone-als-bausatz.mjs');
const FIX = join(WURZEL, 'tools/test/fixtures/zone-als-bausatz');
const TSX = join(WURZEL, 'node_modules/.bin/tsx');

let geprueft = 0;
const pruefe = (name: string, fn: () => void): void => {
  try {
    fn();
    geprueft += 1;
    console.log(`ok   ${name}`);
  } catch (fehler) {
    console.error(`FAIL ${name}\n${fehler instanceof Error ? fehler.stack : String(fehler)}`);
    process.exitCode = 1;
  }
};

async function main(): Promise<void> {
  const k = (await import(pathToFileURL(KONVERTER).href)) as typeof import('../zone-als-bausatz.mjs');
  const village = JSON.parse(readFileSync(join(FIX, 'village-mini.json'), 'utf-8'));
  const welt = JSON.parse(readFileSync(join(FIX, 'welt-mini.json'), 'utf-8'));

  const v = k.konvertiereVillage(village, { id: 'mini' });
  const vb = v.bericht;
  const bausatz = JSON.parse(v.bausatzText);
  const teil = (id: string) => bausatz.teile.find((t: { id: string }) => t.id === id);

  // ── Thinning ────────────────────────────────────────────────────────────────

  pruefe('thinning counts: in 15, out 10, per rule 2 / 1 / 1 / 1', () => {
    assert.equal(vb.eingang, 15);
    assert.equal(vb.ausgang, 10);
    assert.deepEqual(vb.ausgeduennt, { gras: 2, kulisse: 1, felsen: 1, truhenUnterteilUrsprung: 1 });
    assert.equal(bausatz.teile.length, 10);
  });
  pruefe('thinning: grass, backdrop, rock-cliff and the parked chest bottom are gone, the rest stays', () => {
    const ids = bausatz.teile.map((t: { id: string }) => t.id);
    for (const weg of ['vegetation-grass-short-clump-1_0001', 'vegetation-grass-short-clump-1_0002', 'environment-sm-prop-cloud-01_0001', 'rock-cliff_0001', 'environment-chestbottom_0001']) {
      assert.ok(!ids.includes(weg), weg);
    }
    for (const da of ['environment-floor_0001', 'environment-chesttop_0001', 'environment-chestbottom_0002', 'yaw_1', 'in_1', 'surr_1']) {
      assert.ok(ids.includes(da), da);
    }
    assert.deepEqual(vb.kulisseNachPrefab, { 'environment-sm-prop-cloud-01': 1 });
  });
  pruefe('chest report: top kept and named with its position, bottom elsewhere named, parked bottom counted', () => {
    assert.equal(vb.truhen.unterteileUrsprung, 1);
    assert.deepEqual(vb.truhen.oberteileBehalten, [{ id: 'environment-chesttop_0001', position: [0, 0.479, -0.348], nahUrsprung: true }]);
    assert.deepEqual(vb.truhen.unterteileAndersWo, [{ id: 'environment-chestbottom_0002', position: [12, 5.1, 22] }]);
  });
  pruefe('groups: zone ids, every part carries its zone', () => {
    assert.deepEqual(bausatz.gruppen.map((g: { id: string }) => g.id), ['interiors', 'surroundings', 'village']);
    assert.equal(teil('in_1').gruppe, 'interiors');
    assert.equal(teil('yaw_1').gruppe, 'village');
    assert.deepEqual(vb.zonen, { village: 8, interiors: 1, surroundings: 1 });
  });
  pruefe('id: an id outside ID_RE gets a derived one and the report says so', () => {
    assert.deepEqual(vb.idAbgeleitet, [{ von: 'Bad Id!', zu: 'bad-id-' }]);
    assert.ok(teil('bad-id-'));
  });

  // ── Counting rule, height, anchor ───────────────────────────────────────────

  pruefe('counting rule: tilted 2 / non-uniform 4 / mirrored 1', () => {
    assert.deepEqual(vb.zaehlregel, { gekippt: 2, ungleichmaessig: 4, gespiegelt: 1 });
  });
  pruefe('anchor is the millimetre-rounded centroid, dx/dz are relative to it', () => {
    assert.deepEqual(vb.anker, { x: 21.2, z: 26.965 });
    assert.equal(teil('yaw_1').dx, -7.2);
    assert.equal(teil('yaw_1').dz, -6.965);
    assert.equal(teil('yaw_1').dy, undefined);
  });
  pruefe('height: 3 of 10 parts are more than 0.5 m from the median, extent and hull', () => {
    assert.equal(vb.hoehe.medianY, 5);
    assert.equal(vb.hoehe.fehlerTeile, 3);
    assert.equal(vb.hoehe.fehlerAnteil, 0.3);
    assert.deepEqual(vb.ausdehnung, { xVon: 0, xBis: 60, zVon: -0.348, zBis: 60 });
    assert.deepEqual(bausatz.grundflaeche, { halbX: 40.8, halbZ: 35.035 });
    assert.equal(bausatz.ebnung, undefined);
  });
  pruefe('scale: a number when all three are equal, else a triple (negative kept)', () => {
    assert.equal(teil('yaw_1').scale, 1);
    assert.deepEqual(teil('wide_1').scale, [1.379, 1, 1.2524]);
    assert.deepEqual(teil('mirror_1').scale, [-1, 1, 1]);
  });

  // ── Euler: one case per axis ────────────────────────────────────────────────

  pruefe('euler: yaw comes from rotation[1], pitch from [0], roll from [2]', () => {
    assert.equal(teil('yaw_1').yaw, -1.5708);
    assert.equal(teil('yaw_1').pitch, undefined);
    assert.equal(teil('tilt_1').pitch, 0.3);
    assert.equal(teil('tilt_1').yaw, 0.5);
    assert.equal(teil('mirror_1').roll, 0.4);
    assert.equal(teil('mirror_1').yaw, 0);
  });
  pruefe('euler: quaternion of the old triple equals the one of yaw/pitch/roll (1 − |q·q\'| < 1e-9), also mirrored', () => {
    for (const id of ['yaw_1', 'tilt_1', 'mirror_1']) {
      const t = teil(id);
      const roh = village.zones.flatMap((z: { entities: { id: string; rotation: number[] }[] }) => z.entities).find((e: { id: string }) => e.id === id);
      const d = k.quaternionAbstand(k.quaternionAusEuler(roh.rotation), k.quaternionAusWinkeln({ yaw: t.yaw, pitch: t.pitch, roll: t.roll }));
      assert.ok(d < 1e-9, `${id}: ${d}`);
    }
    assert.deepEqual(vb.euler.belege.map((b: { art: string }) => b.art), ['nurYaw', 'gekippt', 'gespiegelt']);
    for (const b of vb.euler.belege) assert.ok(b.abstand < 1e-9, b.art);
  });
  pruefe('euler: a swapped axis order is NOT the same rotation (the check can fail)', () => {
    const q1 = k.quaternionAusEuler([0.3, 0.5, 0.4]);
    const q2 = k.quaternionAusWinkeln({ yaw: 0.3, pitch: 0.5, roll: 0.4 });
    assert.ok(k.quaternionAbstand(q1, q2) > 1e-3);
  });

  // ── Canonical output ────────────────────────────────────────────────────────

  pruefe('round trip: the kit passes the sanitizer unchanged with no findings', () => {
    const bericht = sanitizeBausatzMitBericht(bausatz);
    assert.deepEqual(bericht.fehler, []);
    assert.equal(JSON.stringify(bericht.bausatz, null, 2) + '\n', v.bausatzText);
    assert.equal(vb.ausgabe.rundlaufGleich, true);
    assert.equal(vb.ausgabe.sanitizerMeldungen, 0);
    assert.ok(v.bausatzText.endsWith('}\n'));
  });
  pruefe('repeat: two in-process runs give the same bytes and the same report', () => {
    const v2 = k.konvertiereVillage(village, { id: 'mini' });
    assert.equal(v2.bausatzText, v.bausatzText);
    assert.deepEqual(v2.bericht, vb);
  });

  const temp = mkdtempSync(join(tmpdir(), 'c3-konverter-test-'));
  {
    const lauf = (name: string, args: string[]) => {
      const r = spawnSync(TSX, [KONVERTER, ...args], { encoding: 'utf-8', cwd: WURZEL });
      return { ...r, name };
    };
    pruefe('repeat: two command-line runs write identical files (bytes)', () => {
      const a = lauf('a', ['village', '--ein', join(FIX, 'village-mini.json'), '--aus', join(temp, 'a.json'), '--id', 'mini', '--bericht', join(temp, 'a-bericht.json')]);
      const b = lauf('b', ['village', '--ein', join(FIX, 'village-mini.json'), '--aus', join(temp, 'b.json'), '--id', 'mini', '--bericht', join(temp, 'b-bericht.json')]);
      assert.equal(a.status, 0, a.stderr);
      assert.equal(b.status, 0, b.stderr);
      assert.ok(readFileSync(join(temp, 'a.json')).equals(readFileSync(join(temp, 'b.json'))));
      assert.ok(readFileSync(join(temp, 'a-bericht.json')).equals(readFileSync(join(temp, 'b-bericht.json'))));
      assert.equal(readFileSync(join(temp, 'a.json'), 'utf-8'), v.bausatzText);
    });
    pruefe('command line: bad switches exit 1', () => {
      for (const args of [[], ['village'], ['village', '--ein', 'x', '--aus', join(temp, 'n.json'), '--id', 'mini', '--zufall', '1'], ['village', '--ein', 'x', '--ein', 'y', '--aus', 'z', '--id', 'mini']]) {
        const r = lauf('bad', args);
        assert.equal(r.status, 1, JSON.stringify(args));
      }
    });
  }

  // ── Start village ───────────────────────────────────────────────────────────

  const s = k.konvertiereStartdorf(welt, { region: 'dorf', id: 'startdorf' });
  const sb = s.bericht;
  const sBausatz = JSON.parse(s.bausatzText);
  const sWelt = JSON.parse(s.weltText);

  pruefe('start village: parts + figures = placements in the region, the rest stays outside', () => {
    assert.equal(sb.platzierungenVorher, 6);
    assert.equal(sb.inRegion, 5);
    assert.equal(sb.teile, 3);
    assert.equal(sb.figuren, 2);
    assert.equal(sb.draussen, 1);
    assert.equal(sb.summeStimmt, true);
    assert.deepEqual(sb.figurenPrefabs, ['NPC_1', 'Voelva']);
  });
  pruefe('start village: the world keeps figures and the outside placement, loses the parts, gets exactly one instance', () => {
    assert.deepEqual(sWelt.placements.map((p: { id: string }) => p.id).sort(), ['baum_100', 'npc-1_1_1', 'voelva_2']);
    assert.equal(sWelt.bausaetze.length, 1);
    assert.equal(sWelt.regions.length, 2);
  });
  pruefe('start village: kennungen map every part id to the old placement id', () => {
    assert.deepEqual(sWelt.bausaetze[0].kennungen, { 'u-fass_3_2': 'u-fass_3_2', 'u-haus_0_0': 'u-haus_0_0', 'u-zaun_4_5': 'u-zaun_4_5' });
    assert.deepEqual(sBausatz.teile.map((t: { id: string }) => t.id), ['u-fass_3_2', 'u-haus_0_0', 'u-zaun_4_5']);
    assert.equal(sWelt.bausaetze[0].yaw, undefined);
  });
  pruefe('start village: anchor, yaw 0, ground-following, einebnen and scale carried over', () => {
    assert.deepEqual({ x: sWelt.bausaetze[0].x, z: sWelt.bausaetze[0].z }, { x: -0.208, z: 2.417 });
    const haus = sBausatz.teile.find((t: { id: string }) => t.id === 'u-haus_0_0');
    assert.equal(haus.einebnen, 5);
    assert.equal(haus.dy, undefined);
    assert.equal(sBausatz.teile.find((t: { id: string }) => t.id === 'u-fass_3_2').scale, 2);
    assert.equal(sBausatz.teile.find((t: { id: string }) => t.id === 'u-zaun_4_5').yaw, 3.420845);
  });
  pruefe('start village: resolved entries equal the placements before (3 of 3), figures need no entry', () => {
    assert.deepEqual({ gleich: sb.aufloesen.gleich, abweichend: sb.aufloesen.abweichend }, { gleich: 3, abweichend: 0 });
    assert.equal(sb.ausgabe.rundlaufGleich, true);
    assert.equal(sb.ausgabe.sanitizerMeldungen, 0);
  });
  pruefe('start village: two runs give the same bytes; an unknown region fails', () => {
    const s2 = k.konvertiereStartdorf(welt, { region: 'dorf', id: 'startdorf' });
    assert.equal(s2.bausatzText, s.bausatzText);
    assert.equal(s2.weltText, s.weltText);
    assert.throws(() => k.konvertiereStartdorf(welt, { region: 'gibtsnicht', id: 'startdorf' }), /nicht gefunden/);
  });
  pruefe('start village: the input is not changed', () => {
    assert.equal(welt.placements.length, 6);
    assert.equal(welt.bausaetze, undefined);
  });

  // ── N1: input checks, angle wrap, edge cases, instance clash ────────────────

  const klon = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
  const mitEntitaeten = (extra: unknown[]) => {
    const d = klon(village);
    d.zones[0].entities.push(...extra);
    return d;
  };
  const gut = { prefab: 'environment-floor', position: [1, 5, 2], rotation: [0, 0, 0], scale: [1, 1, 1] };

  pruefe('input: a broken entity stops with a named message (its id), never a raw TypeError', () => {
    const faelle: [string, Record<string, unknown> | null, RegExp][] = [
      ['position missing', { id: 'e_pos', ...gut, position: undefined }, /Entität "e_pos": position/],
      ['rotation null', { id: 'e_rot', ...gut, rotation: null }, /Entität "e_rot": rotation/],
      ['scale a number', { id: 'e_scl', ...gut, scale: 2 }, /Entität "e_scl": scale/],
      ['NaN coordinate', { id: 'e_nan', ...gut, position: [Number.NaN, 5, 2] }, /Entität "e_nan": position/],
      ['null coordinate', { id: 'e_nul', ...gut, rotation: [null, 0, 0] }, /Entität "e_nul": rotation/],
      ['string coordinate', { id: 'e_str', ...gut, position: ['5', 5, 2] }, /Entität "e_str": position/],
      ['null entry', null, /keine Entität/],
    ];
    for (const [name, e, muster] of faelle) {
      assert.throws(() => k.konvertiereVillage(mitEntitaeten([e]), { id: 'mini' }), (f: Error) => !(f instanceof TypeError) && muster.test(f.message), name);
    }
    // NaN survives JSON as null: the same message when the file comes from disk
    assert.throws(() => k.konvertiereVillage(JSON.parse(JSON.stringify(mitEntitaeten([{ id: 'e_nan', ...gut, position: [Number.NaN, 5, 2] }]))), { id: 'mini' }), /Entität "e_nan": position/);
  });
  pruefe('input: the command line exits 1 on such an entity and writes nothing', () => {
    const ein = join(temp, 'kaputt.json');
    writeFileSync(ein, JSON.stringify(mitEntitaeten([{ id: 'e_pos', ...gut, position: undefined }])));
    const r = spawnSync(TSX, [KONVERTER, 'village', '--ein', ein, '--aus', join(temp, 'kaputt-aus.json'), '--id', 'mini'], { encoding: 'utf-8', cwd: WURZEL });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Entität "e_pos"/);
    assert.ok(!existsSync(join(temp, 'kaputt-aus.json')));
  });

  pruefe('angles: yaw 7 is wrapped to 7 − 2π and gives the same quaternion; −7 and π edge cases', () => {
    const d = mitEntitaeten([
      { id: 'w_7', ...gut, rotation: [0, 7, 0] },
      { id: 'w_m7', ...gut, rotation: [0, -7, 0] },
      { id: 'w_pi', ...gut, rotation: [0, Math.PI, 0] },
      { id: 'w_mpi', ...gut, rotation: [0, -Math.PI, 0] },
      { id: 'w_p2pi', ...gut, rotation: [2 * Math.PI, 0, 0] },
    ]);
    const r = k.konvertiereVillage(d, { id: 'mini' });
    const t = (id: string) => JSON.parse(r.bausatzText).teile.find((x: { id: string }) => x.id === id);
    assert.equal(t('w_7').yaw, Math.round((7 - 2 * Math.PI) * 1e6) / 1e6);
    assert.equal(t('w_m7').yaw, Math.round((-7 + 2 * Math.PI) * 1e6) / 1e6);
    assert.ok(k.quaternionAbstand(k.quaternionAusEuler([0, 7, 0]), k.quaternionAusWinkeln({ yaw: t('w_7').yaw })) < 1e-9);
    assert.equal(t('w_pi').yaw, 3.141593);
    assert.equal(t('w_mpi').yaw, 3.141593);
    assert.equal(t('w_p2pi').pitch, undefined);
    assert.equal(r.bericht.zaehlregel.gekippt, vb.zaehlregel.gekippt, 'pitch 2π is not tilted');
    assert.equal(k.normiereWinkel(0.5), 0.5);
    assert.equal(k.normiereWinkel(-0.5), -0.5);
  });

  pruefe('counting rule: exactly 1e-6 does not count, just above does (tilt); scale spread below / above the tolerance', () => {
    const ohne = k.konvertiereVillage(mitEntitaeten([
      { id: 'g_p', ...gut, rotation: [1e-6, 0, 0] },
      { id: 'g_r', ...gut, rotation: [0, 0, -1e-6] },
      { id: 'g_s', ...gut, scale: [1, 1 + 2 ** -20, 1] },
    ]), { id: 'mini' });
    assert.deepEqual(ohne.bericht.zaehlregel, vb.zaehlregel);
    const mit = k.konvertiereVillage(mitEntitaeten([
      { id: 'g_p', ...gut, rotation: [1e-6 + 1e-9, 0, 0] },
      { id: 'g_r', ...gut, rotation: [0, 0, -(1e-6 + 1e-9)] },
      { id: 'g_s', ...gut, scale: [1, 1 + 2 ** -19, 1] },
    ]), { id: 'mini' });
    assert.deepEqual(mit.bericht.zaehlregel, { gekippt: vb.zaehlregel.gekippt + 2, ungleichmaessig: vb.zaehlregel.ungleichmaessig + 1, gespiegelt: vb.zaehlregel.gespiegelt });
  });

  pruefe('ids: a repeated entity id gets a derived one (…-2) and the report says so', () => {
    const r = k.konvertiereVillage(mitEntitaeten([{ id: 'dup', ...gut }, { id: 'dup', ...gut, position: [2, 5, 3] }]), { id: 'mini' });
    assert.deepEqual(r.bericht.idAbgeleitet, [...vb.idAbgeleitet, { von: 'dup', zu: 'dup-2' }]);
    const ids = JSON.parse(r.bausatzText).teile.map((x: { id: string }) => x.id);
    assert.ok(ids.includes('dup') && ids.includes('dup-2'));
  });

  pruefe('thinning: a rock-like prefab that is not a cliff stays', () => {
    const r = k.konvertiereVillage(mitEntitaeten([{ id: 'stein', ...gut, prefab: 'environment-sm-env-rock-small-01' }, { id: 'kliff2', ...gut, prefab: 'rock-cliff-decor' }]), { id: 'mini' });
    assert.equal(r.bericht.ausgeduennt.felsen, vb.ausgeduennt.felsen);
    assert.equal(r.bericht.ausgang, vb.ausgang + 2);
  });

  // start village: figures by npc / route field, circle region, instance clash
  const zusatz = (p: unknown[]) => {
    const w = klon(welt);
    w.placements.push(...p);
    return w;
  };
  pruefe('start village: a non-NPC prefab carrying `npc` stays a figure; so does one carrying only `route`', () => {
    const w = zusatz([
      { id: 'haus-mit-npc_2_2', prefab: 'U_Haus', x: 2, z: 2, yaw: 0, npc: { name: 'Hausgeist' } },
      { id: 'haus-mit-route_3_3', prefab: 'U_Haus', x: 3, z: 3, yaw: 0, route: 'nordweg' },
    ]);
    const r = k.konvertiereStartdorf(w, { region: 'dorf', id: 'startdorf' });
    assert.equal(r.bericht.figuren, sb.figuren + 2);
    assert.equal(r.bericht.teile, sb.teile);
    const nachher = JSON.parse(r.weltText).placements.map((p: { id: string }) => p.id);
    assert.ok(nachher.includes('haus-mit-npc_2_2') && nachher.includes('haus-mit-route_3_3'));
    assert.ok(!JSON.parse(r.bausatzText).teile.some((t: { id: string }) => t.id.startsWith('haus-mit')));
  });
  pruefe('start village: circle region takes the placements inside (border included), not the ones just outside', () => {
    const w = zusatz([
      { id: 'baum-rand_105_100', prefab: 'BirkeHoch1', x: 105, z: 100, yaw: 0 },
      { id: 'baum-aus_105_100', prefab: 'BirkeHoch1', x: 105.001, z: 100, yaw: 0 },
    ]);
    const r = k.konvertiereStartdorf(w, { region: 'kreis', id: 'kreisdorf' });
    assert.deepEqual(JSON.parse(r.bausatzText).teile.map((t: { id: string }) => t.id), ['baum-rand_105_100', 'baum_100']);
    assert.equal(r.bericht.draussen, w.placements.length - 2);
  });
  pruefe('start village: an existing instance with the same id stops the run (second run on its own output)', () => {
    const erst = k.konvertiereStartdorf(welt, { region: 'dorf', id: 'startdorf' });
    const zweiteWelt = JSON.parse(erst.weltText);
    assert.throws(() => k.konvertiereStartdorf(zweiteWelt, { region: 'kreis', id: 'startdorf' }), /schon eine Instanz "startdorf"/);
    // another id works, and the two instances co-exist
    const r = k.konvertiereStartdorf(zweiteWelt, { region: 'kreis', id: 'kreisdorf' });
    assert.equal(JSON.parse(r.weltText).bausaetze.length, 2);
  });
  pruefe('start village: `kennungen` that clash with an existing instance stop the run', () => {
    const w = klon(welt);
    w.bausaetze = [{ id: 'alt', bausatz: 'alt', x: 0, z: 0, kennungen: { irgendwas: 'baum_100' } }];
    assert.throws(() => k.konvertiereStartdorf(w, { region: 'kreis', id: 'neu' }), /Instanz ungültig.*doppelt/);
  });
  pruefe('command line: the second run with the same --id exits 1 and neither creates nor changes an output file', () => {
    const lauf = (args: string[]) => spawnSync(TSX, [KONVERTER, ...args], { encoding: 'utf-8', cwd: WURZEL });
    const eingang = join(temp, 'welt-ein.json');
    writeFileSync(eingang, JSON.stringify(welt));
    const kit = join(temp, 'sd-kit.json');
    const weltAus = join(temp, 'sd-welt.json');
    const erst = lauf(['startdorf', '--welt', eingang, '--region', 'dorf', '--id', 'startdorf', '--aus', kit, '--welt-aus', weltAus]);
    assert.equal(erst.status, 0, erst.stderr);
    const kitVorher = readFileSync(kit);
    const weltVorher = readFileSync(weltAus);
    // outputs at existing paths
    const a = lauf(['startdorf', '--welt', weltAus, '--region', 'kreis', '--id', 'startdorf', '--aus', kit, '--welt-aus', weltAus, '--bericht', join(temp, 'sd-b.json')]);
    assert.equal(a.status, 1);
    assert.match(a.stderr, /schon eine Instanz "startdorf"/);
    assert.ok(readFileSync(kit).equals(kitVorher) && readFileSync(weltAus).equals(weltVorher));
    // outputs at new paths
    const b = lauf(['startdorf', '--welt', weltAus, '--region', 'kreis', '--id', 'startdorf', '--aus', join(temp, 'neu-kit.json'), '--welt-aus', join(temp, 'neu-welt.json'), '--bericht', join(temp, 'neu-b.json')]);
    assert.equal(b.status, 1);
    for (const n of ['neu-kit.json', 'neu-welt.json', 'neu-b.json', 'sd-b.json']) assert.ok(!existsSync(join(temp, n)), n);
  });

  rmSync(temp, { recursive: true, force: true });
  console.log(`${geprueft} checks passed${process.exitCode ? ' — WITH FAILURES' : ''}`);

}

main().catch((fehler) => {
  console.error(fehler);
  process.exit(1);
});
