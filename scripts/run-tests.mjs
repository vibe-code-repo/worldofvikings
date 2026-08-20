#!/usr/bin/env node
/**
 * Test-Runner (Review-Punkt 26): fährt die kuratierte Testliste sequenziell
 * und aggregiert die Exit-Codes — vorher liefen 29 Testdateien nur einzeln
 * von Hand.
 *
 *   npm test              schnelle Kernliste (~2–3 min)
 *   npm test -- --alle    zusätzlich die langen Läufe (Placement, E2E-Wire)
 *
 * NICHT enthalten sind die C++-Golden-Tests (geo-compare, heightmap-compare,
 * geo-map): sie brauchen Referenz-Dumps als Argument und gehören zum
 * eingefrorenen valheim-Übergangspfad.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const KERN = [
  // Naht zwischen Kopf- und Rumpfdateien der Weltdaten (Bundle-Schnitt):
  // laeuft in Sekunden und faengt genau den Fehler, den sonst niemand sieht.
  ['shared', 'test/weltdaten-schnitt.ts'],
  ['shared', 'test/worldlayout.ts'],
  ['shared', 'test/region-geo.ts'],
  ['shared', 'test/geo-smoke.ts'],
  // Die Hoehenfunktion aus shared/ fahren Server UND Client. Der Test haelt
  // 13 Zonen aus allen Biomlagen plus den Abfragepfad gegen eine Referenz
  // und laesst genau 0,000 m Abweichung zu — die Bremse gegen jede
  // Beschleunigung, die die Welt unter den Fuessen des Spielers verschiebt.
  ['shared', 'test/heightmap-determinismus.ts'],
  ['shared', 'test/dungeon-generator.ts'],
  ['server', 'test/h1-layout.ts'],
  ['server', 'test/h2-routen.ts'],
  ['server', 'test/h3-routen-vorschau.ts'],
  ['server', 'test/h4-graslandflora.ts'],
  ['server', 'test/d6-zdo-delta.ts'],
  ['server', 'test/d8-save-async.ts'],
  ['server', 'test/d9-terrain-verdichtung.ts'],
  ['server', 'test/g2-persistence.ts'],
  ['server', 'test/g4-creatures.ts'],
  ['server', 'test/e2-vegetation.ts'],
  // A2 (Security-Review): reine Funktion — Paketwaffe zaehlt nur, wenn sie
  // im Server-Inventar liegt, sonst Faust. Sekunden, kein Server/Socket.
  ['server', 'test/a2-waffe-inventar.ts'],
  // A4 (Roadmap): Token-Bucket-Drosselung je Peer und Pakettyp. Reine
  // Funktion (Drossel.ts kennt weder Peer noch Socket), Zeit kommt als
  // Parameter herein — Sekunden, kein Server/Socket noetig.
  ['server', 'test/a4-drossel.ts'],
  // A3 (Security-Review): SetTimeOfDay ist admin-gated. E2E ueber echten
  // WebSocket-Handshake — haelt sowohl den Admin-Erfolgspfad als auch die
  // Ablehnung (InteractResult, kein TimeSync-Broadcast) fest.
  ['server', 'test/set-time-of-day.ts'],
  // F3/F4 (Security-Review): reine Logik aus Identitaet.ts — Spieler-ID,
  // SessionToken (Ausstellen/Pruefen/Ablauf/Faelschung, fremdes Geheimnis)
  // und der Nonce/HMAC-Passwort-Handshake inkl. des leeren-Passwort-Falls.
  // Sekunden, kein Server/Socket.
  ['server', 'test/f3-identitaet.ts'],
  // F3/F4 (Security-Review): der VERDRAHTETE Zustand, nicht nur die reine
  // Logik. E2E ueber echte WebSocket-Verbindungen: kein Client bekommt je
  // eine feste/geteilte userId ohne Token (Luecke A), ein anderer Name
  // bekommt NIE die Position eines fremden Namens, ein gefaelschtes Token
  // wird verworfen statt eine fremde Identitaet zu uebernehmen (Luecke B),
  // und ein gueltiges Token haelt die Identitaet ueber einen Reconnect
  // stabil.
  ['server', 'test/f3-einbau.ts'],
  // A5 (Schlusskontrolle Paket 2): Deckel fuer offene, nie authentifizierte
  // Verbindungen (MAX_PENDING_CONNECTIONS in NetManager.ts). Vorher zaehlte
  // die "Server voll"-Pruefung nur onlinePeers — der Pre-Auth-Timeout liess
  // sich per Ping endlos hinauszoegern. E2E ueber echte WebSocket-Verbindungen,
  // haelt sowohl das Offenbleiben bis zum Limit als auch die sofortige
  // Trennung darueber hinaus fest.
  ['server', 'test/verbindungsdeckel.ts'],
  // Die zwei Client-Tests der Kernliste. Beide kommen ohne Assets, Browser
  // und GPU aus — das ist die Bedingung, um hier zu stehen.
  //
  // Der Umkreis-Index sichert sich gegen die lineare Suche ab, die er
  // ersetzt hat: gleiche Eingabe, gleiche Treffermenge.
  // Der Waechter gegen den Unfall vom 16.08.2026: Der Editor hatte keinen
  // Ladeweg und ueberschrieb die echte Welt mit einem Testlayout, ohne dass
  // es jemandem auffiel. Prueft die Abgleichlogik gegen das ECHTE
  // Bestandsdokument — DOM-frei, Sekunden, gehoert damit hierher.
  ['client', 'test/welt-abgleich.ts'],
  ['client', 'test/entity-index.ts'],
  // Die Grafikoption begrenzt die gemeinsamen Bild-/Schattenmatrizen der
  // Vegetation. Der reine Kreisfilter sichert den unveraenderten Standard
  // (0 = voll), den eingeschlossenen Rand und die X/Z-Distanz ab.
  ['client', 'test/vegetations-grenze.ts'],
  // Weltzeit-Anzeige (Minimap): reine Umrechnung timeOfDay -> Stunde/
  // Minute/Sonnenstand, DOM-frei. Haelt Mitternacht, Mittag, die beiden
  // Uebergangsschwellen und den Tages-Ueberlauf fest.
  ['client', 'test/weltzeit.ts'],
  // Schweregrad-Klassifikation des Editor-Prüfberichts (Aufgabe B1): reine
  // Einstufung eines LayoutBefund nach Fehler/Hinweis, DOM-frei — anders
  // als editorMain.ts selbst, das beim Import sofort die Editor-Shell
  // aufbaut und einen Fetch anstößt und deshalb nicht isoliert testbar
  // ist. Prüft jeden Zweig einzeln UND gegen echte pruefeLayout-Ausgaben,
  // damit ein geänderter Wortlaut in pruefung.ts hier auffällt statt erst
  // als falsch gefärbte Zeile im Editor.
  ['client', 'test/befund-schwere.ts'],
  // Die Keulung der Schattenwerfer pro Instanz ist konservativ in genau
  // EINER Richtung: Was ueberlebt, wird eingereicht — verworfen wird nur,
  // was seitlich sicher ausserhalb des Lichtkastens liegt. Ein Fehler hier
  // loescht Schatten statt sie zu sparen, und zwar unauffaellig. Der Test
  // haelt drei Zusicherungen fest: entlang der Lichtachse wird NICHT
  // gekeult, der Bewegungsrand haelt die Packung bis zum naechsten
  // Neupacken, und entartete Eingaben liefern 0 statt Muell.
  ['client', 'test/schatten-instanz-keulung.ts'],
  // Das 100-FPS-Profil nutzt auf der niedrigen Stufe eine eigene
  // Schattenfassung. Der GPU-lose Test haelt 2 x 1024 px / 80 m fest und
  // prueft zugleich, dass alle normalen Stufen unveraendert bleiben.
  ['client', 'test/schatten-profil.ts'],
  // Die Huellkoerper der Thin-Instance-Master entscheiden seit D10 ueber
  // die SICHTBARKEIT der Prefabs — ein Kasten, der eine Instanz auslaesst,
  // laesst das Objekt aus bestimmten Blickwinkeln verschwinden. Laeuft
  // ueber Babylons NullEngine: ohne GPU, ohne Assets, synthetische
  // Geometrie und Instanzlagen.
  ['client', 'test/master-huelle.ts'],
  // Der Wasser-Refraktionspass darf gestreute Vegetation nicht anhand der
  // weltweiten Thin-Instance-Hülle als "eingetaucht" einstufen. Auf der
  // Referenzinsel bedeutete dieser Fehler 36 Mio. unsichtbare Dreiecke pro
  // Bild. NullEngine reicht, weil Auswahl und Hüllen rein CPU-seitig sind.
  ['client', 'test/wasser-refraktion.ts'],
  // Der experimentelle WebGPU-Pfad verwendet fuer die bestehenden
  // Material-Plugins Babylons GLSL-Uebersetzung. Die Sprachflags muessen vor
  // dem ersten Material gesetzt sein und duerfen durch ein Babylon-Update
  // nicht still auf native WGSL-Shader umspringen.
  ['client', 'test/webgpu-kompatibilitaet.ts'],
  // Das Impostor-Fernfeld ersetzt ferne Vegetation durch Sprites. Sein
  // Fehlermodus ist nicht Ruckeln, sondern ein Baum, den WEDER der
  // Zell-Master NOCH das Sprite-Feld zeichnet — oder den beide zeichnen.
  // Beides ist blickwinkel- und positionsabhaengig, erzeugt keine
  // Meldung und ist beim Durchklicken nicht zu finden. Die Regel liegt
  // deshalb als reine Arithmetik in BaumImpostorKern.ts, und dieser Test
  // haelt sie fest: Der billige Zell-Vorfilter darf der
  // Pro-Instanz-Regel ueber tausende Faelle hinweg NIE widersprechen,
  // die Zuteilung ist eine echte Partition, das Atlasraster ueberlappt
  // nicht und bricht laut statt still, und ein Prototyp ohne Atlas
  // faellt auf die ECHTE Darstellung zurueck — nie auf gar keine.
  // DOM-frei, GPU-frei, Sekunden.
  ['client', 'test/baum-impostor.ts'],
  // Der Betriebsdienst haelt seit Block A/16 den Speicherweg des Editors.
  // Er gehoert in die KERNLISTE und nicht zu den langen Laeufen: Er
  // braucht keine Assets und keine GPU, ist in Sekunden durch — und die
  // Zusicherung, die er prueft, ist die teuerste im ganzen Projekt.
  // Ein misslungener Speichervorgang darf die Welt nicht beschaedigen;
  // wer das erst nach dem Ausrollen merkt, merkt es an der Welt.
  ['admin', 'test/betriebsdienst.ts'],
];

const LANG = [
  ['server', 'test/g3-streaming.ts'],
  ['server', 'test/g5-dungeons.ts'],
  ['server', 'test/f3-leveling.ts'],
];

const liste = process.argv.includes('--alle') ? [...KERN, ...LANG] : KERN;
let fehler = 0;
const start = Date.now();

for (const [paket, datei] of liste) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${paket}/${datei} … `);
  const lauf = spawnSync(resolve(WURZEL, 'node_modules/.bin/tsx'), [datei], {
    cwd: resolve(WURZEL, paket),
    encoding: 'utf-8',
    timeout: 600_000,
  });
  const dauer = ((Date.now() - t0) / 1000).toFixed(1);
  if (lauf.status === 0) {
    console.log(`OK (${dauer}s)`);
  } else {
    fehler++;
    console.log(`FEHLGESCHLAGEN (${dauer}s)`);
    console.log((lauf.stdout ?? '').split('\n').slice(-15).join('\n'));
    console.log(lauf.stderr ?? '');
  }
}

console.log(
  `\n${liste.length - fehler}/${liste.length} Tests grün in ${((Date.now() - start) / 1000).toFixed(0)}s`
);
process.exit(fehler > 0 ? 1 : 0);
