/**
 * G1 N1 (Nachbesserung nach Angriff, Befunde B4/B5): der reine
 * Übernahme-Filter (`sollGrundskalaUebernehmen`), die strenge Formprüfung
 * (`istGueltigesEreignis`) UND der volle Kanal-Weg (senden, hören,
 * abmelden) über das echte `BroadcastChannel` aus Node (seit v18 global,
 * DOM-frei).
 *
 * Vorherige Fassung testete einen Zeitstempel-Duplikatfilter, den der
 * Angriff als schädlich einstufte (B5: eine spätere Meldung mit
 * gleichem/kleinerem Zeitstempel — Uhr springt zurück, zwei Meldungen in
 * derselben Millisekunde — ging verloren). Die Meldung trägt jetzt die
 * neue Grundskala selbst, der Filter vergleicht WERTE statt Uhrzeiten, und
 * elf Angriffsproben (B4: `null`, Strings, falsche Feldtypen, Namen
 * ausserhalb des Musters, Grundskala ausserhalb des erlaubten Bereichs)
 * müssen ohne Ausnahme und ohne Übernahme verworfen werden.
 *
 * Lauf: npx tsx client/test/grundskala-live.ts
 */
import {
  GRUNDSKALA_KANAL,
  hoereGrundskalaGeaendert,
  istGueltigesEreignis,
  sendeGrundskalaGeaendert,
  sollGrundskalaUebernehmen,
  type GrundskalaEreignis,
} from '../src/editor/testflug/grundskalaLive';

let fehler = 0;
function pruefe(bedingung: boolean, text: string): void {
  if (!bedingung) {
    fehler++;
    console.log(`  ABWEICHUNG ${text}`);
  }
}

// ── 1) sollGrundskalaUebernehmen: reine Filterlogik, WERT-basiert (B5) ──

{
  const zuletzt = new Map<string, number>();
  const e1: GrundskalaEreignis = { name: 'U_Fass1', grundskala: 2 };
  pruefe(sollGrundskalaUebernehmen(zuletzt, e1) === true, 'erstes Ereignis wird übernommen');
  pruefe(zuletzt.get('U_Fass1') === 2, 'Wert gemerkt');

  // Exaktes Duplikat (gleicher Wert) — verworfen.
  const dup: GrundskalaEreignis = { name: 'U_Fass1', grundskala: 2 };
  pruefe(sollGrundskalaUebernehmen(zuletzt, dup) === false, 'Duplikat (gleicher Wert) verworfen');

  // Andere Grundskala DESSELBEN Namens — übernommen, unabhängig von jeder Uhrzeit.
  const neu: GrundskalaEreignis = { name: 'U_Fass1', grundskala: 4 };
  pruefe(sollGrundskalaUebernehmen(zuletzt, neu) === true, 'geänderter Wert übernommen');
  pruefe(zuletzt.get('U_Fass1') === 4, 'Wert aktualisiert');

  // B5 (Angriffsbefund an der Zeitstempel-Fassung): zurück auf einen FRÜHEREN
  // Wert ist trotzdem eine echte Änderung und muss übernommen werden — ein
  // Zeitstempel-Vergleich hätte das je nach Uhr auch schon getan, ein reiner
  // Wertvergleich tut es UNABHÄNGIG von jeder Uhr.
  const zurueck: GrundskalaEreignis = { name: 'U_Fass1', grundskala: 2 };
  pruefe(sollGrundskalaUebernehmen(zuletzt, zurueck) === true, 'Rücksprung auf einen früheren Wert wird übernommen (B5)');

  // Ein ANDERES Modell — eigene Spur, unabhängig vom ersten.
  const anderesModell: GrundskalaEreignis = { name: 'U_Fass2', grundskala: 1 };
  pruefe(sollGrundskalaUebernehmen(zuletzt, anderesModell) === true, 'anderes Modell unabhängig übernommen');
  pruefe(zuletzt.size === 2, 'zwei getrennte Modellspuren');
}

// ── 2) istGueltigesEreignis: die Angriffsproben aus dem Bericht (B4) ────

{
  const gueltig: GrundskalaEreignis = { name: 'U_Fass1', grundskala: 2 };
  pruefe(istGueltigesEreignis(gueltig), 'eine echte Meldung gilt als gültig');

  const ungueltig: ReadonlyArray<[string, unknown]> = [
    ['null', null],
    ['Text statt Objekt', 'U_Fass1'],
    ['Liste statt Objekt', ['U_Fass1', 2]],
    ['leeres Objekt', {}],
    ['name fehlt', { grundskala: 2 }],
    ['name ist eine Zahl', { name: 42, grundskala: 2 }],
    ['name passt nicht aufs Muster (kein U_-Präfix)', { name: 'Fass1', grundskala: 2 }],
    ['name mit Pfadtraversierung', { name: 'U_../../evil', grundskala: 2 }],
    ['name 100 000 Zeichen', { name: `U_${'x'.repeat(100_000)}`, grundskala: 2 }],
    ['grundskala fehlt', { name: 'U_Fass1' }],
    ['grundskala ist ein String', { name: 'U_Fass1', grundskala: '2' }],
    ['grundskala NaN', { name: 'U_Fass1', grundskala: NaN }],
    ['grundskala 0', { name: 'U_Fass1', grundskala: 0 }],
    ['grundskala negativ', { name: 'U_Fass1', grundskala: -1 }],
    ['grundskala riesig (101)', { name: 'U_Fass1', grundskala: 101 }],
    ['grundskala Infinity', { name: 'U_Fass1', grundskala: Infinity }],
  ];
  for (const [text, wert] of ungueltig) {
    pruefe(istGueltigesEreignis(wert) === false, `ungültig erkannt: ${text}`);
  }

  // Randwerte des erlaubten Bereichs (GRUNDSKALA_MIN=0.01, GRUNDSKALA_MAX=100) — gültig.
  pruefe(istGueltigesEreignis({ name: 'U_Fass1', grundskala: 0.01 }), 'unterer Rand (0.01) gültig');
  pruefe(istGueltigesEreignis({ name: 'U_Fass1', grundskala: 100 }), 'oberer Rand (100) gültig');
}

// ── 3) Der volle Kanal-Weg: senden -> hören, in einem eigenen Kanalnamen,
//    damit ein Fehlschlag hier keinen anderen Testlauf im selben Prozess
//    stört (jede Instanz von `BroadcastChannel(GRUNDSKALA_KANAL)` mit
//    demselben Namen hört mit — s. `grundskalaLive.ts`-Kopf). Zusätzlich
//    eine rohe, ungültige Nachricht DIREKT auf den Kanal (B4: der
//    Empfänger muss sie ignorieren, ohne zu werfen und ohne den
//    Callback aufzurufen). ─────────────────────────────────────────────

async function kanalDurchlauf(): Promise<void> {
  pruefe(typeof GRUNDSKALA_KANAL === 'string' && GRUNDSKALA_KANAL.length > 0, 'Kanalname gesetzt');

  const empfangen: string[] = [];
  const abmelden = hoereGrundskalaGeaendert((name) => empfangen.push(name));

  sendeGrundskalaGeaendert('U_Testobjekt', 2);
  // BroadcastChannel liefert asynchron (auch in Node) — auf den Tick warten.
  await new Promise((r) => setTimeout(r, 20));
  pruefe(empfangen.length === 1 && empfangen[0] === 'U_Testobjekt', 'gesendetes Ereignis kommt an');

  // Zwei Meldungen HINTEREINANDER für unterschiedliche Modelle — beide an,
  // keine wird von der anderen unterdrückt (verschiedene `zuletzt`-Spuren).
  sendeGrundskalaGeaendert('U_Testobjekt2', 3);
  sendeGrundskalaGeaendert('U_Testobjekt3', 3);
  await new Promise((r) => setTimeout(r, 20));
  pruefe(empfangen.length === 3, `zwei weitere Modelle kommen beide an (${empfangen.length})`);

  // Dasselbe Modell, derselbe Wert — Duplikat, wird NICHT übernommen.
  sendeGrundskalaGeaendert('U_Testobjekt', 2);
  await new Promise((r) => setTimeout(r, 20));
  pruefe(empfangen.length === 3, 'echtes Wert-Duplikat wird nicht erneut übernommen');

  // Eine rohe, ungültige Nachricht direkt auf den Kanal — kein Absturz, kein Empfang.
  const roherKanal = new (globalThis as unknown as { BroadcastChannel: new (n: string) => { postMessage(m: unknown): void; close(): void } }).BroadcastChannel(GRUNDSKALA_KANAL);
  roherKanal.postMessage(null);
  roherKanal.postMessage({ name: 'nicht-passend', grundskala: 2 });
  roherKanal.postMessage({ name: 'U_Testobjekt', grundskala: 'zwei' });
  roherKanal.close();
  await new Promise((r) => setTimeout(r, 20));
  pruefe(empfangen.length === 3, 'ungültige rohe Nachrichten werden ignoriert, kein Absturz');

  // Nach dem Abmelden kommt NICHTS mehr an — auch keine spätere Sendung.
  abmelden();
  sendeGrundskalaGeaendert('U_Testobjekt', 5);
  await new Promise((r) => setTimeout(r, 20));
  pruefe(empfangen.length === 3, 'nach dem Abmelden kein weiterer Empfang');
}

// ── 4) Ohne `BroadcastChannel` (Umgebung ohne Unterstützung): No-Op statt
//    Absturz — `hoereGrundskalaGeaendert` liefert eine harmlose Abmelde-
//    funktion, `sendeGrundskalaGeaendert` schickt still nichts. ────────

function ohneKanalDurchlauf(): void {
  const orig = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
  try {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    let hoerAufruf = 0;
    const abmelden = hoereGrundskalaGeaendert(() => hoerAufruf++);
    sendeGrundskalaGeaendert('U_OhneKanal', 2);
    abmelden();
    pruefe(hoerAufruf === 0, 'ohne BroadcastChannel: kein Absturz, kein Empfang');
  } finally {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = orig;
  }
}

async function haupt(): Promise<void> {
  await kanalDurchlauf();
  ohneKanalDurchlauf();
  console.log(fehler === 0 ? 'OK — grundskala-live' : `${fehler} ABWEICHUNGEN`);
  process.exit(fehler > 0 ? 1 : 0);
}

void haupt();
