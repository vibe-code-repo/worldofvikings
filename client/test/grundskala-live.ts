/**
 * G1 — Grundskala live im Testflug: der reine Übernahme-Filter
 * (`sollGrundskalaUebernehmen`) UND der volle Kanal-Weg (senden, hören,
 * abmelden) über das echte `BroadcastChannel` aus Node (seit v18 global,
 * DOM-frei).
 *
 * Lauf: npx tsx client/test/grundskala-live.ts
 */
import {
  GRUNDSKALA_KANAL,
  hoereGrundskalaGeaendert,
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

// ── 1) sollGrundskalaUebernehmen: reine Filterlogik ──────────────────

{
  const zuletzt = new Map<string, number>();
  const e1: GrundskalaEreignis = { name: 'U_Fass1', zeitpunkt: 1000 };
  pruefe(sollGrundskalaUebernehmen(zuletzt, e1) === true, 'erstes Ereignis wird übernommen');
  pruefe(zuletzt.get('U_Fass1') === 1000, 'Zeitstempel gemerkt');

  // Exaktes Duplikat (gleicher Zeitstempel) — verworfen.
  const dup: GrundskalaEreignis = { name: 'U_Fass1', zeitpunkt: 1000 };
  pruefe(sollGrundskalaUebernehmen(zuletzt, dup) === false, 'Duplikat (gleicher Zeitstempel) verworfen');

  // Nachzügler mit ÄLTEREM Zeitstempel — verworfen.
  const alt: GrundskalaEreignis = { name: 'U_Fass1', zeitpunkt: 500 };
  pruefe(sollGrundskalaUebernehmen(zuletzt, alt) === false, 'veraltetes Ereignis verworfen');
  pruefe(zuletzt.get('U_Fass1') === 1000, 'Zeitstempel bleibt beim jüngsten Stand');

  // Neuere Änderung DESSELBEN Namens — übernommen, Stand wandert weiter.
  const neu: GrundskalaEreignis = { name: 'U_Fass1', zeitpunkt: 2000 };
  pruefe(sollGrundskalaUebernehmen(zuletzt, neu) === true, 'neuere Änderung übernommen');
  pruefe(zuletzt.get('U_Fass1') === 2000, 'Zeitstempel aktualisiert');

  // Ein ANDERES Modell — eigene Spur, unabhängig vom ersten.
  const anderesModell: GrundskalaEreignis = { name: 'U_Fass2', zeitpunkt: 100 };
  pruefe(sollGrundskalaUebernehmen(zuletzt, anderesModell) === true, 'anderes Modell unabhängig übernommen');
  pruefe(zuletzt.size === 2, 'zwei getrennte Modellspuren');
}

// ── 2) Der volle Kanal-Weg: senden -> hören, in einem eigenen Kanalnamen,
//    damit ein Fehlschlag hier keinen anderen Testlauf im selben Prozess
//    stört (jede Instanz von `BroadcastChannel(GRUNDSKALA_KANAL)` mit
//    demselben Namen hört mit — s. `grundskalaLive.ts`-Kopf). ─────────

async function kanalDurchlauf(): Promise<void> {
  pruefe(typeof GRUNDSKALA_KANAL === 'string' && GRUNDSKALA_KANAL.length > 0, 'Kanalname gesetzt');

  const empfangen: string[] = [];
  const abmelden = hoereGrundskalaGeaendert((name) => empfangen.push(name));

  sendeGrundskalaGeaendert('U_Testobjekt');
  // BroadcastChannel liefert asynchron (auch in Node) — auf den Tick warten.
  await new Promise((r) => setTimeout(r, 20));
  pruefe(empfangen.length === 1 && empfangen[0] === 'U_Testobjekt', 'gesendetes Ereignis kommt an');

  // Zwei Meldungen HINTEREINANDER für unterschiedliche Modelle — beide an,
  // keine wird von der anderen unterdrückt (verschiedene `zuletzt`-Spuren).
  sendeGrundskalaGeaendert('U_Testobjekt2');
  sendeGrundskalaGeaendert('U_Testobjekt3');
  await new Promise((r) => setTimeout(r, 20));
  pruefe(empfangen.length === 3, `zwei weitere Modelle kommen beide an (${empfangen.length})`);

  // Nach dem Abmelden kommt NICHTS mehr an — auch keine spätere Sendung.
  abmelden();
  sendeGrundskalaGeaendert('U_Testobjekt');
  await new Promise((r) => setTimeout(r, 20));
  pruefe(empfangen.length === 3, 'nach dem Abmelden kein weiterer Empfang');
}

// ── 3) Ohne `BroadcastChannel` (Umgebung ohne Unterstützung): No-Op statt
//    Absturz — `hoereGrundskalaGeaendert` liefert eine harmlose Abmelde-
//    funktion, `sendeGrundskalaGeaendert` schickt still nichts. ────────

function ohneKanalDurchlauf(): void {
  const orig = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
  try {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    let hoerAufruf = 0;
    const abmelden = hoereGrundskalaGeaendert(() => hoerAufruf++);
    sendeGrundskalaGeaendert('U_OhneKanal');
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
