/**
 * Leseschicht fuer server/data/server.yml — die EINZIGE Stelle, an der
 * diese Datei ausgewertet wird.
 *
 * Warum eine eigene Datei (A14, 21.08.2026): Die Funktion sass in
 * main.ts, und main.ts startet beim blossen Import sofort einen
 * Weltserver (`server.start()` steht auf oberster Ebene). Kein Test
 * konnte sie also anfassen — und genau deshalb konnte
 * `world.save-interval` monatelang in server.yml stehen, ohne dass es
 * jemand las: Es gab nichts, was den Umstand haette bemerken koennen.
 * Der Inhalt ist Zeile fuer Zeile derselbe wie vorher in main.ts, nur
 * um `datenVerzeichnis`/`instanz` als Parameter erweitert (sonst haenge
 * ich beim Testen an server/data/ des laufenden Servers).
 * Festgehalten in server/test/a14-server-yml.ts.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { type ServerConfig } from './WovServer.js';
import { BENUTZERNAME_REGEX, CHARAKTERNAME_REGEX } from './konto/KontoApi.js';
import { type StandardKontoVorgabe } from './konto/StandardKonto.js';
import {
  findEnvironment,
  istNebelDichte,
  LOOK_VORGABE,
  NEBEL_AUTOMATISCH,
  NEBEL_DICHTE_MAX,
  pruefeLook,
  SAVE_INTERVAL_MS,
  WETTER_AUTOMATISCH,
  type WetterVorgabe,
} from '@wov/shared';

/**
 * Dauer-Syntax aus server.yml ("30min", "45s", "500ms", "2h") in
 * Millisekunden. A14: server.yml versprach ein konfigurierbares
 * world.save-interval, aber niemand las es -- dieser Parser ist die
 * Gegenprobe, kein generisches Framework fuer Schluessel, die es nicht
 * gibt (siehe die Streichungen in server.yml selbst).
 *
 * Unlesbares faellt still auf den Vorgabewert zurueck -- der Server soll
 * an einem Tippfehler nicht sterben. Still heisst hier NICHT unbemerkt:
 * `warnUnbekannteSchluessel` meldet, was die Datei sonst noch enthaelt,
 * und ein Tippfehler IM WERT ("30 min") ist im Log als abweichende
 * Speicherzeit sichtbar.
 */
export function parseDauerMs(wert: unknown, fallbackMs: number): number {
  if (typeof wert !== 'string') return fallbackMs;
  const m = /^(\d+(?:\.\d+)?)(ms|s|min|h)$/.exec(wert.trim());
  if (!m) return fallbackMs;
  const zahl = Number(m[1]);
  const faktor =
    m[2] === 'ms' ? 1 : m[2] === 's' ? 1000 : m[2] === 'min' ? 60_000 : 3_600_000;
  return zahl * faktor;
}

/**
 * Was diese Datei ueberhaupt auswertet, Abschnitt fuer Abschnitt.
 *
 * Diese Liste ist der eigentliche Riegel von A14. Der Ausgangszustand
 * war eine server.yml mit sechzehn Schluesseln, die kein Code las
 * (authenticate, whitelist, timeout, max-online, pregenerate, modern,
 * heightmap-threading, public, dedicated, doors, seeded und die
 * kompletten Bloecke zdos:/events:) -- und nichts daran war zu sehen:
 * `leseServerKonfig` greift gezielt nach bekannten Schluesseln und geht
 * an allem anderen wortlos vorbei. Wer heute etwas eintraegt, das hier
 * nicht steht, bekommt beim Start eine Warnung statt einer stillen
 * Wirkungslosigkeit.
 *
 * Beim Erweitern GILT: erst hier eintragen, dann unten auslesen.
 */
export const BEKANNTE_SCHLUESSEL: Record<string, readonly string[]> = Object.assign(
  // OHNE Prototyp. Sonst liefert ein Abschnitt, der zufaellig wie eine
  // Object-Eigenschaft heisst (`constructor`, `toString`, `valueOf`), beim
  // Nachschlagen die geerbte FUNKTION statt `undefined` -- und
  // `bekannt.includes(...)` wirft. Der Wurf landet im Sammel-catch von
  // `leseServerKonfig`, der Server startet dann mit VOLLSTAENDIGEN
  // Vorgabewerten: Port 2456 statt 2467, `worldMode: 'valheim'` statt
  // `layout`, fremder Weltname. Sichtbar waere davon genau eine Logzeile.
  // Gefunden am 21.08.2026 von der Gegenprobe, die genau danach gesucht hat.
  Object.create(null) as Record<string, readonly string[]>,
  {
    server: ['name', 'password', 'port'],
    players: ['max', 'everyone-admin'],
    world: [
      'mode',
      'seed',
      'save-interval',
      'features',
      'vegetation',
      'creatures',
      'experimental-location-overrides',
      'experimental-ashlands-modern-noise',
      'experimental-biome-blend-smoothstep',
      'experimental-bilinear-height-sampling',
      'experimental-river-affects-ocean',
      'experimental-disable-distant-rivers',
    ],
    dungeons: ['enabled', 'modulbau'],
    wetter: ['umgebung', 'nebeldichte'],
    'standard-konto': ['name', 'passwort', 'charakter'],
    /*
      Der Look-Block. Nur die OBERSTE Ebene steht hier — die
      Unterabschnitte (bloom, vignette, ca, dof, strahlen, himmel,
      schatten) prueft `pruefeLook` gegen LOOK_VORGABE, und zwar
      rekursiv und mit Typen. Zwei Listen derselben Schluessel waeren
      genau die zweite Wahrheit, gegen die dieser Riegel antritt;
      deshalb wird sie hier aus der Vorgabe ABGELEITET.
    */
    look: Object.keys(LOOK_VORGABE),
  }
);

/**
 * Alle Schluessel des YAML-Dokuments, die `leseServerKonfig` NICHT liest.
 * Ein unbekannter Abschnitt wird als Ganzes gemeldet ("zdos") statt in
 * seine Einzelteile zerlegt -- sonst verschwindet die eigentliche
 * Aussage ("diesen Block kennt niemand") hinter vier Zeilen Detail.
 */
export function unbekannteSchluessel(yaml: unknown): string[] {
  if (typeof yaml !== 'object' || yaml === null) return [];
  const gefunden: string[] = [];
  for (const [abschnitt, inhalt] of Object.entries(yaml as Record<string, unknown>)) {
    const bekannt = BEKANNTE_SCHLUESSEL[abschnitt];
    if (!bekannt) {
      gefunden.push(abschnitt);
      continue;
    }
    if (typeof inhalt !== 'object' || inhalt === null) continue;
    for (const schluessel of Object.keys(inhalt as Record<string, unknown>)) {
      if (!bekannt.includes(schluessel)) gefunden.push(`${abschnitt}.${schluessel}`);
    }
  }
  return gefunden;
}

/** Die Warnung selbst -- getrennt, damit der Test sie pruefen kann. */
function warnUnbekannteSchluessel(yaml: unknown): void {
  for (const schluessel of unbekannteSchluessel(yaml)) {
    console.warn(
      `[Konfig] server.yml: "${schluessel}" liest niemand — der Eintrag bleibt wirkungslos ` +
        `(bekannte Schluessel: BEKANNTE_SCHLUESSEL in server/src/ServerKonfig.ts)`
    );
  }
}

/**
 * Abschnitt `wetter:` aus server.yml.
 *
 * Beide Werte werden GEPRUEFT und im Zweifel verworfen, statt den Server
 * scheitern zu lassen: Ein Tippfehler im Umgebungsnamen ergaebe sonst
 * eine Welt, in der `setEnvironmentByName` bei jedem Aufruf fehlschlaegt
 * — sichtbar nur als Warnung in der Browserkonsole jedes Spielers. Wer
 * sich vertippt, bekommt hier eine Zeile im Serverlog und das bisherige
 * Verhalten (Wetter wuerfeln).
 */
function leseWetterVorgabe(wetter: Record<string, unknown>): WetterVorgabe {
  const rohUmgebung = wetter.umgebung;
  let umgebung = WETTER_AUTOMATISCH;
  if (typeof rohUmgebung === 'string' && rohUmgebung.trim() !== '') {
    if (findEnvironment(rohUmgebung)) {
      umgebung = rohUmgebung;
    } else {
      console.warn(
        `[Main] wetter.umgebung "${rohUmgebung}" ist keine bekannte Umgebung — Wetter bleibt zufaellig`
      );
    }
  }

  const rohDichte = wetter.nebeldichte;
  let nebelDichte = NEBEL_AUTOMATISCH;
  if (rohDichte !== undefined && rohDichte !== null && rohDichte !== '') {
    if (istNebelDichte(rohDichte)) {
      nebelDichte = rohDichte as number;
    } else {
      console.warn(
        `[Main] wetter.nebeldichte ${JSON.stringify(rohDichte)} ist unbrauchbar ` +
          `(erlaubt: 0 bis ${NEBEL_DICHTE_MAX}) — Nebel folgt weiter der Tageszeit`
      );
    }
  }

  return { umgebung, nebelDichte };
}

/**
 * Abschnitt `standard-konto:` aus server.yml — Ausprobieren ohne
 * Registrierung (siehe StandardKonto.ts).
 *
 * GEPRUEFT und im Zweifel VERWORFEN, genau wie `wetter:` und aus demselben
 * Grund: Ein Tippfehler hier ist sichtbar (niemand kann sich mit dem
 * kaputten Namen anmelden, das Konto existiert schlicht nicht) und ein
 * Startabbruch waere fuer eine Ausprobier-Bequemlichkeit unverhaeltnis-
 * maessig — anders als beim `look:`-Block, dessen Fehler NIRGENDWO
 * auffaellt.
 */
function leseStandardKonto(yaml: Record<string, unknown>): StandardKontoVorgabe | undefined {
  const roh = yaml['standard-konto'];
  if (roh === undefined || roh === null) return undefined;
  if (typeof roh !== 'object') {
    console.warn(
      '[Konfig] server.yml: standard-konto ist kein Block — Standardkonto bleibt aus',
    );
    return undefined;
  }

  const block = roh as Record<string, unknown>;
  const name = String(block.name ?? '');
  const passwort = String(block.passwort ?? '');
  const charakter = String(block.charakter ?? '');

  const maengel: string[] = [];
  // "wie bei der Registrierung": dieselben Muster wie in KontoApi.ts, nicht
  // eine zweite Abschrift davon.
  if (!BENUTZERNAME_REGEX.test(name)) {
    maengel.push(`name "${name}" ist ungueltig (3-24 Zeichen, wie beim Benutzernamen der Registrierung)`);
  }
  if (passwort.length < 4) {
    maengel.push('passwort muss mindestens 4 Zeichen haben');
  }
  if (!CHARAKTERNAME_REGEX.test(charakter)) {
    maengel.push(`charakter "${charakter}" ist kein gueltiger Charaktername`);
  }
  if (maengel.length > 0) {
    for (const m of maengel) {
      console.warn(`[Konfig] server.yml standard-konto: ${m} — Standardkonto bleibt aus`);
    }
    return undefined;
  }

  return { name, passwort, charakter };
}

/**
 * Ein `look:`-Fehler beendet den Start. Eigene Klasse, damit der Test
 * ihn von einem YAML-Syntaxfehler unterscheiden kann.
 */
export class LookKonfigFehler extends Error {
  constructor(readonly meldungen: readonly string[]) {
    super(`server.yml look: ${meldungen.join('; ')}`);
    this.name = 'LookKonfigFehler';
  }
}

/**
 * Abschnitt `look:` aus server.yml — PRUEFEN, nicht heilen.
 *
 * ── Warum hier ein Startfehler steht und bei `wetter:` nur eine Warnung
 * Weil die Fehlerbilder verschieden sind. Ein falscher Umgebungsname ist
 * SICHTBAR: Der Server wuerfelt weiter, im Log steht die Zeile, und die
 * Welt hat Wetter. Ein Tippfehler im Look-Block dagegen faellt
 * NIRGENDWO auf — `saettigng: 40` sieht im Editor aus wie ein gesetzter
 * Regler, kommt nie im Client an, und die einzige Spur waere ein Bild,
 * von dem niemand weiss, wie es aussehen sollte. Genau diese Sorte
 * stiller Wirkungslosigkeit hat A14 aus dieser Datei geraeumt (sechzehn
 * Schluessel, die etwas versprachen und nichts taten); ein neuer Block
 * mit dreissig Reglern darf sie nicht wieder einfuehren.
 *
 * Gemeldet werden ALLE Befunde auf einmal und nicht nur der erste — wer
 * eine Konfiguration abtippt, vertippt sich selten genau einmal.
 */
export function leseLookVorgabe(yaml: Record<string, unknown>): Record<string, unknown> | undefined {
  const roh = yaml.look;
  if (roh === undefined || roh === null) return undefined;
  const fehler = pruefeLook(roh);
  if (fehler.length > 0) {
    throw new LookKonfigFehler(fehler.map((f) => `${f.pfad}: ${f.grund}`));
  }
  return roh as Record<string, unknown>;
}

/**
 * @param datenVerzeichnis server/data (enthaelt server.yml, welten/, worlds/)
 * @param instanz 'dev' | 'live' — bestimmt Weltdatei UND Spielstandnamen
 */
export function leseServerKonfig(
  datenVerzeichnis: string,
  instanz: string
): Partial<ServerConfig> {
  const configPath = resolve(datenVerzeichnis, 'server.yml');

  if (!existsSync(configPath)) {
    console.log('[Main] No server.yml found, using defaults');
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const yaml = (parseYaml(raw) ?? {}) as Record<string, unknown>;

    warnUnbekannteSchluessel(yaml);

    const server = (yaml.server ?? {}) as Record<string, unknown>;
    const players = (yaml.players ?? {}) as Record<string, unknown>;
    const world = (yaml.world ?? {}) as Record<string, unknown>;
    const dungeons = (yaml.dungeons ?? {}) as Record<string, unknown>;
    const wetter = (yaml.wetter ?? {}) as Record<string, unknown>;
    // VOR allem anderen, damit ein Look-Fehler nicht erst nach dem
    // Weltaufbau auffaellt. Der Wurf verlaesst `leseServerKonfig`
    // absichtlich NICHT ueber den Sammel-catch unten — s. dort.
    const lookVorgabe = leseLookVorgabe(yaml);

    // Weltdatei je Instanz. Fehlt sie, endet der Start hier mit einer
    // lesbaren Meldung — vorher warf erst readFileSync in WovServer.init()
    // ein nacktes ENOENT mitten im Start, und Restart=always machte daraus
    // eine Neustartschleife ohne Hinweis auf die eigentliche Ursache.
    // Bewusst weiterhin process.exit() und kein throw: der Aufrufer faengt
    // Fehler ab und faehrt mit Vorgabewerten weiter — aus einem throw
    // wuerde also ein Server auf der falschen Welt statt eines klaren Endes.
    const layoutPfad = resolve(datenVerzeichnis, 'welten', `${instanz}.json`);
    if (world.mode === 'layout' && !existsSync(layoutPfad)) {
      console.error(`[Main] Weltdatei fehlt: ${layoutPfad}`);
      console.error(`[Main] WOV_INSTANZ=${instanz} — erwartet wird server/data/welten/${instanz}.json`);
      process.exit(1);
    }

    return {
      name: (server.name as string) ?? 'World of Vikings Server',
      password: (server.password as string) ?? '',
      port: (server.port as number) ?? 2456,
      maxPlayers: (players.max as number) ?? 10,
      everyoneAdmin: (players['everyone-admin'] as boolean) ?? false,
      // Weltname = Instanzname. Daraus folgen Spielstand (<instanz>.db.zst)
      // und Placement-Cache (<instanz>.locations.json) ohne weitere Regel.
      worldName: instanz,
      // WORLD_SEED env var wins over server.yml — the easiest way to start
      // a fresh server with a custom seed (e.g. one picked on the client's
      // connect screen and pasted here); has no effect on an already
      //-running server / an existing save (see client/src/main.ts header).
      worldSeed: process.env.WORLD_SEED || (world.seed as string) || 'KxSYuZquuw',
      // Kartengenerierungs-Umbau: 'layout' liest die designer-definierte
      // Welt aus server/data/welten/<instanz>.json, 'valheim' bleibt der
      // Name des radialen Seed-Ports (Übergangspfad, s. server.yml).
      worldMode: world.mode === 'layout' ? 'layout' : 'valheim',
      worldLayoutPath: layoutPfad,
      // worldgen flags (C++ ServerSettings defaults: smoothstep=true, bilinear=false,
      // ashlands-modern-noise=true)
      worldBlendSmoothStep: (world['experimental-biome-blend-smoothstep'] as boolean) ?? true,
      worldBilinearHeight: (world['experimental-bilinear-height-sampling'] as boolean) ?? false,
      worldRiverAffectsOcean: (world['experimental-river-affects-ocean'] as boolean) ?? false,
      worldAshlandsModernNoise: (world['experimental-ashlands-modern-noise'] as boolean) ?? true,
      worldDisableDistantRivers: (world['experimental-disable-distant-rivers'] as boolean) ?? false,
      // Phase E/F zone population flags (C++ defaults: all true / overrides false)
      worldFeatures: (world.features as boolean) ?? true,
      worldVegetation: (world.vegetation as boolean) ?? true,
      worldLocationOverrides: (world['experimental-location-overrides'] as boolean) ?? false,
      dungeonsEnabled: (dungeons.enabled as boolean) ?? true,
      /*
        E5: Saal-Bau aus dem Editor. Vorgabe FALSE, und das ist die
        einzige Vorgabe, die hier abschaltet statt einzuschalten:
        `peer.isAdmin` schützt heute nichts (players.everyone-admin ist
        true), dieser Schalter ist also das einzige Schloss, das wirklich
        zu ist. Wer ihn setzt, erlaubt jedem verbundenen Client, Dateien
        unter assets/generiert/ anzulegen.

        `=== true` und nicht `?? false`: Ein Tippfehler im WERT ("ja",
        "on", 1) soll ausschalten, nicht einschalten — YAML liest "ja"
        als Zeichenkette, und eine nicht-leere Zeichenkette wäre wahr.
      */
      dungeonsModulbau: dungeons.modulbau === true,
      // G2: creature spawning (C++ world.creatures default true)
      worldCreatures: (world.creatures as boolean) ?? true,
      // A14: vorher stand world.save-interval in server.yml, ohne dass hier
      // etwas davon las -- der Default kam ausschliesslich aus
      // SAVE_INTERVAL_MS in WovServer.ts. Jetzt wirkt eine Aenderung wirklich
      // (WovServer.start() armiert damit seinen Speichertakt).
      saveIntervalMs: parseDauerMs(world['save-interval'], SAVE_INTERVAL_MS),
      // G1: world saves live next to server.yml (C++ ./worlds)
      worldsDir: resolve(datenVerzeichnis, 'worlds'),
      // G12: Betriebsmetriken-Schnappschuss fuer den Betriebsdienst
      // (admin/, GET /metriken). Nur der echte Serverstart setzt ihn --
      // Tests, die createWovServer() direkt rufen, bleiben ohne Pfad und
      // schreiben dadurch nichts (s. Kopfkommentar von
      // ServerConfig.metrikenDatei).
      metrikenDatei: resolve(datenVerzeichnis, 'metriken.json'),
      wetterVorgabe: { ...leseWetterVorgabe(wetter), look: lookVorgabe },
      standardKonto: leseStandardKonto(yaml),
    };
  } catch (err) {
    /*
      Der Look-Block ist die eine Ausnahme vom "weiter mit Vorgabewerten".
      Der Rest dieser Funktion darf an einem kaputten YAML mit Defaults
      weiterlaufen -- ein Server auf Port 2456 faellt auf. Ein Server, der
      den halben Look-Block still verwirft, faellt nicht auf; genau davor
      schuetzt der Riegel, und ein Sammel-catch, der ihn schluckt, waere
      derselbe Fehler eine Ebene hoeher.
    */
    if (err instanceof LookKonfigFehler) {
      console.error(`[Main] server.yml, Abschnitt look:`);
      for (const m of err.meldungen) console.error(`[Main]   ${m}`);
      console.error(`[Main] Bekannte Schluessel: LOOK_VORGABE in shared/src/lookProfil.ts`);
      process.exit(1);
    }
    console.error(`[Main] Failed to parse server.yml: ${err}`);
    return {};
  }
}
