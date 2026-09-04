#!/usr/bin/env node
/**
 * Begehung eines StoneVault-Dungeons auf play.dev — mit eigenem Testcharakter,
 * echten Tastendrücken und Beweisbildern.
 * Walk-through of a StoneVault dungeon on play.dev with an own test character.
 *
 * Drei Betriebsarten:
 *
 *   node tools/pw-stonevault-walk.mjs <dungeonId> [yawGrad=0] [sekunden=8] [ziel-y]
 *     Der Treppenlauf aus M3: in eine feste Richtung losgehen und die
 *     erreichte Höhe (`player.position.y`) lesen.
 *
 *   node tools/pw-stonevault-walk.mjs --tour <plan.json> [--bericht <datei>]
 *     G10 — die VOLLE Begehung: jede Zelle des Grundrisses ablaufen, jeden
 *     Durchgang queren, über jede Treppe hoch und wieder herunter. Der Plan
 *     kommt aus `tools/raster-begehungsplan.ts`.
 *
 *   node tools/pw-stonevault-walk.mjs --erzeuge "<basis> <saat> <zellen> <zone>"
 *     Legt ein Grab über den Konsolenbefehl `dungeon create` an und beendet
 *     sich. Eine EIGENE Sitzung, weil `dungeon enter` nach dem Anlegen in
 *     derselben Sitzung Client- und Serverposition auseinanderlaufen lässt.
 *
 * ── Warum die Begehung positionsgesteuert läuft ──────────────────────
 * Der Server integriert die Spielerbewegung OHNE Dungeon-Kollision
 * (`WovServer.handlePlayerInput`); wer ~2 s gegen eine Wand läuft, wird
 * vom Abgleich zehn Meter durch sie hindurchgezogen. Ein Lauf nach
 * Sekunden misst deshalb nicht Begehbarkeit, sondern Drift. Hier wird
 * jeder Schritt gegen die ZIELPOSITION geprüft, mit kurzem Zeitlimit —
 * und jeder Sprung über {@link DRIFT_M} je Bild wird gemeldet, damit
 * ein „erreicht", das in Wahrheit ein Durchgezogenwerden war, nicht als
 * Erfolg durchgeht.
 *
 * ── Warum der Blick in JEDEM BILD nachgeführt wird ───────────────────
 * Ein einmal gesetzter Blick reicht für zwei Meter nicht: Die Figur
 * überschiesst, streift eine Kante, und der Rest des Wegs geht schräg an
 * der Öffnung vorbei. Nachgeführt läuft sie in die Öffnungsmitte hinein.
 * Die Nachführung läuft deshalb IM Browser (s. `geheZu`) — von Node aus
 * kostet eine Abtastung eine halbe Sekunde und über zwei Meter Weg.
 *
 * Anmeldung wie in pw-dungeon2-playdev.mjs (formgerechtes, ungültig
 * signiertes Token → der Server würfelt eine frische Identität; kein
 * Konto, kein Passwort). Basic-Auth über `httpCredentials`, NICHT in der
 * Adresse (sonst kein Havok, s. dort). Je Lauf ein eigener Name.
 *
 * Bilder landen unter ~/.cache/wov-stonevault-walk/<dungeonId>-*.png.
 */

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const HOST = 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-stonevault-walk`;
const BENUTZER = process.env.WOV_DEV_USER ?? 'Admin';
const PASSWORT = process.env.WOV_DEV_PASS ?? '!T3mp12345';
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

/** Wie nah an der Zellmitte „erreicht" heisst. Die Zelle ist 2 m, die Öffnung 1,4 m. */
const ZIEL_M = 0.7;
/** Ebenenhöhe. Ein halber Abstand trennt zwei Ebenen sicher. */
const EBENE_M = 3.5;
/**
 * Sprung je BILD, ab dem es kein Gehen mehr ist, sondern Server-Drift.
 *
 * Die Figur läuft mit ~4,6 m/s, ein Bild bei 60 Hz sind also rund 8 cm.
 * Ein Meter in einem Bild ist nichts, was ein Charaktercontroller
 * hervorbringt — das ist der Abgleich, der die Figur an die
 * kollisionsfreie Serverposition zieht (s. Kopfkommentar).
 */
const DRIFT_M = 1.0;
/**
 * Zeitlimit für einen Zellwechsel (2 m) in ms.
 *
 * Bewusst knapp: Wer gegen eine Wand läuft, wird nach rund zwei Sekunden
 * durch sie hindurchgezogen. Ein grosszügiges Limit machte aus jedem
 * blockierten Durchgang ein „erreicht" — die Messung würde den Fehler
 * verstecken, den sie finden soll. 1,8 s reichen für 8 m.
 */
const SCHRITT_MS = 1800;
/** Zeitlimit für eine Treppenquerung (~10 m, bergauf). */
const TREPPE_MS = 6000;

const args = process.argv.slice(2);
const flagWert = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function testToken() {
  const nutzlast = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${nutzlast}.testlauf`;
}

mkdirSync(ORDNER, { recursive: true });

/**
 * Eine Sitzung: eigener Kontext, eigener Charakter, betritt `id`.
 * `id === null` bleibt draussen (für `--erzeuge`).
 */
async function sitzung(browser, id, ablauf) {
  const kontext = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    httpCredentials: { username: BENUTZER, password: PASSWORT },
  });
  const seite = await kontext.newPage();
  const fehler = [];
  const vierNullVier = [];
  seite.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
  seite.on('pageerror', (f) => fehler.push(String(f)));
  // Welche Datei fehlt? Der HUD-Zähler „assets-fehler" nennt keinen Namen.
  seite.on('response', (r) => { if (r.status() === 404) vierNullVier.push(r.url()); });
  await seite.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());

  const name = `Walk${Date.now().toString(36).slice(-5)}`;
  const adresse = id ? `${HOST}/?name=${name}&dungeon=${id}` : `${HOST}/?name=${name}`;
  await seite.goto(adresse, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (id) {
    await seite.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
    // Kit-Teile laden lassen (Thin-Instances + Steinmaterial).
    await seite.waitForTimeout(10_000);
    // Belichtung NUR fürs Beweisbild: Ein Testcharakter trägt keine Fackel,
    // und die Innen-Umgebung „Caves" hat 0,1 Grundlicht — auf dem Bild wäre
    // sonst nichts zu beurteilen. Das ist die Bildverarbeitung der Szene,
    // kein Eingriff in Material oder Licht (WOV_HELL=1 → keine Anhebung).
    const belichtung = Number(process.env.WOV_HELL ?? '6');
    await seite.evaluate((e) => { window.__dbg.scene.imageProcessingConfiguration.exposure = e; }, belichtung);
  } else {
    await seite.waitForFunction(() => typeof window.__vb?.admin === 'function', undefined, { timeout: 240_000 });
  }
  try {
    return await ablauf({ seite, name, fehler, vierNullVier });
  } finally {
    if (fehler.length) console.log(`  Konsolenfehler: ${fehler.length} (erste: ${String(fehler[0]).slice(0, 200)})`);
    if (vierNullVier.length) console.log(`  404: ${[...new Set(vierNullVier)].slice(0, 5).join(', ')}`);
    await kontext.close();
  }
}

/** Steuerung: Maus fangen, Blick setzen, Position lesen. */
function steuerung(seite) {
  const s = {
    gefangen: false,
    /**
     * Vorzeichen der Laufrichtung. `forward = (−sin yaw, −cos yaw)` steht
     * so im `PlayerController` — geprüft wird es trotzdem, weil ein
     * gedrehtes Vorzeichen die Figur vom Ziel WEG trägt und der Lauf das
     * dann als „Wand vor dem Durchgang" meldete.
     */
    offset: 0,
  };
  s.lage = () => seite.evaluate(() => {
    const p = window.__dbg.player;
    return { x: +p.position.x.toFixed(3), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(3) };
  });
  s.blick = (y, pitch = -0.1) => seite.evaluate(([yy, pp]) => {
    const p = window.__dbg.player;
    p._yaw = yy; p._figurYaw = yy; p._pitch = pp;
  }, [y, pitch]);
  // Maus EINMAL fangen — der Klick bewegt den Zeiger von (0,0) nach
  // (800,450), und unter Pointer-Lock addiert dieses Delta auf `_yaw`
  // (PlayerController.ts ~669). Deshalb: erst fangen, DANN den Blick setzen.
  s.fangen = async () => {
    if (s.gefangen) return;
    await seite.mouse.click(800, 450);
    await seite.waitForTimeout(400);
    s.gefangen = true;
  };
  s.yawZu = (dx, dz) => Math.atan2(-dx, -dz) + s.offset;
  return s;
}

// ─────────────────────────────────────────────────────────────────────
// Betriebsart „--erzeuge"
// ─────────────────────────────────────────────────────────────────────
if (args[0] === '--erzeuge') {
  const zeile = args[1];
  if (!zeile) { console.error('Aufruf: --erzeuge "<basis> <saat> <zellen> <zone>"'); process.exit(2); }
  const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
  const antwort = await sitzung(browser, null, async ({ seite }) =>
    seite.evaluate((z) => window.__vb.admin(`dungeon create ${z}`), zeile)
  );
  await browser.close();
  console.log(typeof antwort === 'string' ? antwort : JSON.stringify(antwort));
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────
// Betriebsart „--tour": die G10-Begehung
// ─────────────────────────────────────────────────────────────────────
if (args[0] === '--tour') {
  const planDatei = args[1];
  if (!planDatei) { console.error('Aufruf: --tour <plan.json>'); process.exit(2); }
  const plan = JSON.parse(readFileSync(planDatei, 'utf8'));
  const dungeonId = plan.dungeonId;
  if (!dungeonId) { console.error('Der Plan nennt keine dungeonId — mit --dokument erzeugen.'); process.exit(2); }
  const schluessel = (c) => `${c.i},${c.j},${c.level}`;
  // Weltpunkt → Zelle, dieselbe Rundung wie `worldToCell` in
  // `shared/src/dungeonRasterModul.ts` (Zellmitte `(2i, 3,5e, 2j−1)`).
  const zelleAus = (p) => ({ i: Math.round(p.x / 2), j: Math.round((p.z + 1) / 2), level: Math.round(p.y / 3.5) });
  const hallen = new Set((plan.hallCells ?? []).map(schluessel));

  const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
  const bericht = await sitzung(browser, dungeonId, async ({ seite, name }) => {
    const st = steuerung(seite);
    let bildNr = 0;
    const bild = async (tag, clip) => {
      bildNr++;
      const pfad = `${ORDNER}/${dungeonId}-${String(bildNr).padStart(3, '0')}-${tag}.png`;
      const puffer = await seite.screenshot({ path: pfad, ...(clip ? { clip } : {}) });
      return { pfad, puffer };
    };

    const start = await st.lage();
    console.log(`Sitzung ${name} in ${dungeonId}: Spawn ${JSON.stringify(start)}`);
    await bild('spawn');
    await st.fangen();

    /**
     * Bis zur Zielzelle gehen. Liefert, wie es ausging.
     *
     * ── Warum die Steuerschleife IM Browser läuft ──────────────────────
     * Der erste Anlauf steuerte von Node aus: Position lesen, Blick
     * setzen, 140 ms warten. Gemessen wurden daraus rund 0,5 s je
     * Abtastung (drei CDP-Round-Trips), und die Figur legt in dieser Zeit
     * über zwei Meter zurück — sie sprang über das 0,7-m-Zielfenster
     * hinweg, lief weiter, und der Abgleich zog sie irgendwann durch die
     * Wand. Ergebnis: 0 von 40 Zellen erreicht, Endstand 2 km ausserhalb
     * des Grabs. Im Browser läuft dieselbe Schleife je BILD, also alle
     * ~16 ms und ~8 cm — damit trifft sie das Zielfenster sicher, und der
     * Sprungzähler unterscheidet Gehen von Gezogenwerden.
     *
     * Abgebrochen wird nach `grenzeMs`, damit ein blockierter Durchgang
     * nicht in die Server-Drift hineinläuft und sich am Ende doch noch
     * „erreicht" nennt.
     */
    const geheZu = async (ziel, ebene, grenzeMs) => {
      await seite.keyboard.down('KeyW');
      const r = await seite.evaluate(
        async ([z, lvl, ms, off, tol, ebeneM, driftM]) => {
          const p = window.__dbg.player;
          const lies = () => ({ x: p.position.x, y: p.position.y, z: p.position.z });
          const start = lies();
          let letzte = start;
          let drift = 0;
          let maxSprung = 0;
          let bilder = 0;
          let ok = false;
          const t0 = performance.now();
          while (performance.now() - t0 < ms) {
            await new Promise((r) => requestAnimationFrame(r));
            bilder++;
            const jetzt = lies();
            const dx = z.x - jetzt.x;
            const dz = z.z - jetzt.z;
            const yaw = Math.atan2(-dx, -dz) + off;
            p._yaw = yaw;
            p._figurYaw = yaw;
            p._pitch = -0.1;
            const sprung = Math.hypot(jetzt.x - letzte.x, jetzt.y - letzte.y, jetzt.z - letzte.z);
            if (sprung > driftM) drift++;
            if (sprung > maxSprung) maxSprung = sprung;
            letzte = jetzt;
            if (Math.hypot(dx, dz) <= tol && Math.abs(jetzt.y - lvl * ebeneM) < ebeneM / 2) {
              ok = true;
              break;
            }
          }
          const ende = lies();
          return {
            ok,
            drift,
            maxSprung: +maxSprung.toFixed(3),
            bilder,
            dauerMs: Math.round(performance.now() - t0),
            start: { x: +start.x.toFixed(3), y: +start.y.toFixed(3), z: +start.z.toFixed(3) },
            ende: { x: +ende.x.toFixed(3), y: +ende.y.toFixed(3), z: +ende.z.toFixed(3) },
            dist: +Math.hypot(z.x - ende.x, z.z - ende.z).toFixed(3),
          };
        },
        [ziel, ebene, grenzeMs, st.offset, ZIEL_M, EBENE_M, DRIFT_M]
      );
      await seite.keyboard.up('KeyW');
      // Kurz stehen bleiben: Der Server rechnet die Eingabe weiter, und
      // ohne diese Pause beginnt der nächste Schritt an einer Position,
      // die der Client gleich noch korrigiert.
      await seite.waitForTimeout(150);
      return r;
    };

    // ── Vorzeichenprobe ────────────────────────────────────────────────
    // `forward = (−sin yaw, −cos yaw)` steht im `PlayerController`, wird
    // hier aber gemessen statt geglaubt: Ein gedrehtes Vorzeichen trüge
    // die Figur vom Ziel weg, und der Lauf meldete das als „Wand vor dem
    // Durchgang".
    //
    // Gemessen wird die RICHTUNG der Bewegung (Skalarprodukt), nicht der
    // Abstand zum Ziel. Der erste Versuch verglich Abstände — und flog
    // beim ersten Lauf auf die Nase: Das erste Ziel lag 1,00 m entfernt,
    // die Figur legt in 0,5 s aber 2,3 m zurück, überholte es also und
    // stand danach 1,33 m entfernt. Aus „näher gekommen?" wurde ein
    // „nein", die Probe drehte das Vorzeichen, und die Figur lief den
    // ganzen Lauf lang rückwärts aus dem Grab heraus (Endstand 750 m
    // ausserhalb, 0 von 40 Zellen).
    const ersteZiel = plan.steps[0].world;
    {
      const a = await st.lage();
      const sx = ersteZiel.x - a.x;
      const sz = ersteZiel.z - a.z;
      await st.blick(st.yawZu(sx, sz));
      await seite.keyboard.down('KeyW');
      await seite.waitForTimeout(400);
      await seite.keyboard.up('KeyW');
      const b = await st.lage();
      const skalar = (b.x - a.x) * sx + (b.z - a.z) * sz;
      const weg = Math.hypot(b.x - a.x, b.z - a.z);
      if (skalar < 0) {
        st.offset = Math.PI;
        console.log(`  Laufrichtung GEDREHT (Skalarprodukt ${skalar.toFixed(2)}, Weg ${weg.toFixed(2)} m)`);
      } else {
        console.log(`  Laufrichtung bestätigt (Skalarprodukt ${skalar.toFixed(2)}, Weg ${weg.toFixed(2)} m)`);
      }
    }

    // ── Auf die Eingangszelle stellen ─────────────────────────────────
    // Der Spawn liegt einen Meter tiefer im Raum als deren Mitte (gemessen:
    // z −2,00 statt −1,00). Von dort aus zeigt der erste Schritt schon
    // schräg — und ein schräger erster Schritt trifft die Öffnung nicht.
    {
      const r = await geheZu(plan.start.world, plan.start.cell.level, SCHRITT_MS);
      console.log(`  Eingangszelle: ${r.ok ? 'erreicht' : 'NICHT erreicht'} (${JSON.stringify(r.ende)})`);
    }

    const erreicht = new Set();
    const gequert = [];
    const misslungen = [];
    const driftStellen = [];
    const flimmern = [];
    let hier = plan.start.cell;
    let treppeHoch = 0;
    let treppeRunter = 0;
    const gesehen = new Set();

    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      const treppe = s.stairRoom !== null && s.stairRoom !== undefined;
      // Eine Treppenquerung ist ~10 m weit (Landezelle, drei Laufzellen,
      // Landezelle) und geht bergauf — sie braucht mehr Zeit als ein
      // Zellwechsel, aber nicht beliebig viel.
      const r = await geheZu(s.world, s.cell.level, treppe ? TREPPE_MS : SCHRITT_MS);
      if (r.ok) {
        erreicht.add(schluessel(s.cell));
        gequert.push({ von: hier, nach: s.cell, treppe: s.stairRoom ?? null });
        if (treppe) { if (s.levelChange > 0) treppeHoch++; else treppeRunter++; }
      } else {
        misslungen.push({
          nr: i,
          von: schluessel(hier),
          nach: schluessel(s.cell),
          treppe: s.stairRoom ?? null,
          torbogen: s.archway,
          rest: +r.dist.toFixed(2),
          ende: r.ende,
        });
        console.log(
          `  SCHRITT ${i} MISSLUNGEN: ${schluessel(hier)} → ${schluessel(s.cell)} ` +
            `(${s.module}${s.archway ? ', Torbogen ' + s.archway : ''}), noch ${r.dist.toFixed(2)} m, ` +
            `Position ${JSON.stringify(r.ende)}`
        );
        if (misslungen.length <= 6) await bild(`blockiert-${i}`);
        // Nach einem Fehlschlag steht die Figur irgendwo — die restliche
        // Route wird von der TATSÄCHLICHEN Zelle aus fortgesetzt, damit ein
        // einzelner blockierter Durchgang nicht alle folgenden Schritte
        // mitreisst.
      }
      if (r.drift > 0) {
        driftStellen.push({ nr: i, von: schluessel(hier), nach: schluessel(s.cell), spruenge: r.drift });
      }
      // Nach einem Fehlschlag steht die Figur irgendwo — WO, sagt nur ihre
      // Position. Die Zelle wird deshalb zurückgerechnet (Konzept: „Schlüssel
      // entstehen durch Runden, nie durch Gleichheitsvergleich"), sonst
      // behauptet der Bericht eine Herkunft, die nicht stimmt.
      hier = r.ok ? s.cell : zelleAus(r.ende);

      // ── Beweisbilder in den Hallen und an den Treppen ───────────────
      const marke = treppe ? `treppe-${s.stairRoom}-${s.levelChange > 0 ? 'oben' : 'unten'}` : null;
      const hallenMarke = hallen.has(schluessel(s.cell)) ? `halle-${schluessel(s.cell)}` : null;
      const tag = marke ?? hallenMarke;
      if (r.ok && tag && !gesehen.has(tag)) {
        gesehen.add(tag);
        // Flimmerprobe: zweimal DASSELBE Bild vom oberen Drittel (dort
        // stehen Wand und Decke, die Figur steht unten). Eine
        // deckungsgleiche Wandfläche wechselt zwischen zwei Bildern die
        // sichtbare Seite; ein statisches Bild wäre byte-gleich.
        //
        // Die Zahl ist ein HINWEIS, keine Abnahme, und geht deshalb nicht
        // in `bestanden` ein: Auch Kameranachlauf, Nebel und der
        // Lichtaufbau der Szene ändern Pixel. Gemessen am 04.09.2026:
        // 11 von 14 Standorten unterschiedlich, ohne dass auf den
        // Bildern eine flimmernde Fläche zu sehen wäre. Was die Probe
        // kann, ist das Gegenteil beweisen — wo sie „gleich" meldet,
        // steht dort sicher keine doppelte Fläche.
        const clip = { x: 0, y: 0, width: 1600, height: 300 };
        const a = await bild(`${tag}-a`, clip);
        await seite.waitForTimeout(700);
        const b = await seite.screenshot({ clip });
        flimmern.push({ tag, gleich: a.puffer.equals(b) });
        await bild(tag);
      }
    }

    // Rundblick am Ende, zurück am Eingang.
    for (const d of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      await st.blick(d);
      await seite.waitForTimeout(500);
      await bild('rundblick');
    }

    return { start, erreicht: [...erreicht], gequert, misslungen, driftStellen, flimmern, treppeHoch, treppeRunter };
  });
  await browser.close();

  // ── Abnahme ────────────────────────────────────────────────────────
  const sollZellen = new Set(plan.walkCells.map(schluessel));
  sollZellen.delete(schluessel(plan.start.cell)); // der Spawn zählt als erreicht
  const erreicht = new Set(bericht.erreicht);
  const fehlend = [...sollZellen].filter((k) => !erreicht.has(k));
  const querbar = (plan.stairs ?? []).filter((s) => s.crossable).length;
  const flimmernd = bericht.flimmern.filter((f) => !f.gleich);

  console.log(`\n── Begehung ${dungeonId} ────────────────────────────`);
  console.log(`  Zellen: ${erreicht.size + 1} von ${plan.walkCells.length} begehbaren erreicht` +
    (fehlend.length ? ` — FEHLEND: ${fehlend.join(' ')}` : ''));
  console.log(`  Treppenzellen: ${plan.stairCells.length} in ${querbar} querbaren Läufen`);
  console.log(`  Schritte: ${plan.steps.length} geplant, ${bericht.gequert.length} gelungen, ${bericht.misslungen.length} misslungen`);
  console.log(`  Treppe: ${bericht.treppeHoch}× hoch, ${bericht.treppeRunter}× herunter`);
  console.log(`  Server-Drift (Sprung > ${DRIFT_M} m je Bild): ${bericht.driftStellen.length} Schritte`);
  console.log(`  Flimmerprobe: ${bericht.flimmern.length} Standorte, ${flimmernd.length} mit wechselnder Wandfläche`);
  for (const m of bericht.misslungen.slice(0, 12)) {
    console.log(`    misslungen ${m.von} → ${m.nach}${m.treppe !== null ? ' (Treppe)' : ''}, Rest ${m.rest} m`);
  }
  for (const d of bericht.driftStellen.slice(0, 12)) {
    console.log(`    Drift ${d.von} → ${d.nach}: ${d.spruenge} Sprünge`);
  }
  console.log(`  Bilder: ${ORDNER}/${dungeonId}-*.png`);

  const ausgabe = flagWert('--bericht');
  if (ausgabe) writeFileSync(ausgabe, JSON.stringify(bericht, null, 1));

  const bestanden =
    fehlend.length === 0 &&
    bericht.misslungen.length === 0 &&
    bericht.driftStellen.length === 0 &&
    (querbar === 0 || (bericht.treppeHoch > 0 && bericht.treppeRunter > 0));
  console.log(bestanden ? '  ABNAHME: bestanden' : '  ABNAHME: NICHT bestanden');
  process.exit(bestanden ? 0 : 1);
}

// ─────────────────────────────────────────────────────────────────────
// Betriebsart „Treppenlauf" (M3, unverändert)
// ─────────────────────────────────────────────────────────────────────
const [dungeonId, yawGradRoh = '0', sekundenRoh = '8', zielYRoh] = args;
if (!dungeonId) {
  console.error('Aufruf: node tools/pw-stonevault-walk.mjs <dungeonId> [yawGrad] [sekunden] [ziel-y]');
  console.error('   oder: node tools/pw-stonevault-walk.mjs --tour <plan.json>');
  console.error('   oder: node tools/pw-stonevault-walk.mjs --erzeuge "<basis> <saat> <zellen> <zone>"');
  process.exit(2);
}
const yaw = (Number(yawGradRoh) * Math.PI) / 180;
const sekunden = Number(sekundenRoh);
const zielY = zielYRoh === undefined ? null : Number(zielYRoh);

const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
const rc = await sitzung(browser, dungeonId, async ({ seite, name }) => {
  const st = steuerung(seite);
  const start = await st.lage();
  await seite.screenshot({ path: `${ORDNER}/${dungeonId}-0-spawn.png` });

  await st.fangen();
  await st.blick(yaw);
  await seite.keyboard.down('KeyW');
  let maxY = start.y;
  const spur = [];
  const t0 = Date.now();
  while (Date.now() - t0 < sekunden * 1000) {
    await seite.waitForTimeout(500);
    const l = await st.lage();
    spur.push(l);
    if (l.y > maxY) maxY = l.y;
  }
  await seite.keyboard.up('KeyW');
  await seite.waitForTimeout(800);
  const ende = await st.lage();
  await seite.screenshot({ path: `${ORDNER}/${dungeonId}-1-ende.png` });

  // Umsehen: drei Blicke (links, rechts, zurück).
  let i = 2;
  for (const d of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    await st.blick(yaw + d);
    await seite.waitForTimeout(700);
    await seite.screenshot({ path: `${ORDNER}/${dungeonId}-${i++}-blick.png` });
  }

  console.log(`Dungeon ${dungeonId}, Name ${name}, yaw ${yawGradRoh}°, ${sekunden}s`);
  console.log(`  Start ${JSON.stringify(start)} → Ende ${JSON.stringify(ende)}, max y ${maxY.toFixed(2)}`);
  console.log(`  Spur: ${spur.map((l) => `${l.x},${l.z}|${l.y}`).join('  ')}`);
  if (zielY === null) return 0;
  const ok = maxY >= zielY - 0.05;
  console.log(`  Ziel-Höhe ${zielY}: ${ok ? 'ERREICHT' : 'NICHT erreicht'}`);
  return ok ? 0 : 1;
});
await browser.close();
process.exit(rc);
