/**
 * G1 N1 (Nachbesserung nach Angriff, Befunde B4/B5) und G1 N2
 * (Nachangriff-Auflagen N1-2/N1-3): die strenge Formprüfung
 * (`istGueltigesEreignis`), der volle Kanal-Weg (senden, hören, abmelden)
 * über das echte `BroadcastChannel` aus Node (seit v18 global, DOM-frei),
 * die serialisierte Verarbeitung mehrerer Meldungen (N1-2) und das Merken
 * des Wert-Duplikatfilters ERST nach erfolgreicher Übernahme (N1-3).
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
 * N2: `sollGrundskalaUebernehmen` gibt es nicht mehr als eigene, reine
 * Funktion — das Merken (wann ein Wert als „übernommen" gilt) ist jetzt an
 * den ECHTEN Verarbeitungsweg gebunden (`hoereGrundskalaGeaendert` ruft
 * `uebernehmen` auf und merkt den Wert nur bei Erfolg). Die vorherigen
 * reinen Filtertests sind deshalb durch Abschnitt 3/4 unten ersetzt, die
 * genau dasselbe Verhalten über den echten Kanal prüfen — B5 (Rücksprung
 * auf einen früheren Wert wird übernommen) bleibt dabei in Abschnitt 2
 * (`kanalDurchlauf`) abgedeckt.
 *
 * Lauf: npx tsx client/test/grundskala-live.ts
 */
import {
  GRUNDSKALA_KANAL,
  hoereGrundskalaGeaendert,
  istGueltigesEreignis,
  sendeGrundskalaGeaendert,
  type GrundskalaEreignis,
} from '../src/editor/testflug/grundskalaLive';

let fehler = 0;
function pruefe(bedingung: boolean, text: string): void {
  if (!bedingung) {
    fehler++;
    console.log(`  ABWEICHUNG ${text}`);
  }
}

// ── 1) istGueltigesEreignis: die Angriffsproben aus dem Bericht (B4) ────

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

// ── 2) Der volle Kanal-Weg: senden -> hören, in einem eigenen Kanalnamen,
//    damit ein Fehlschlag hier keinen anderen Testlauf im selben Prozess
//    stört (jede Instanz von `BroadcastChannel(GRUNDSKALA_KANAL)` mit
//    demselben Namen hört mit — s. `grundskalaLive.ts`-Kopf). Zusätzlich
//    eine rohe, ungültige Nachricht DIREKT auf den Kanal (B4: der
//    Empfänger muss sie ignorieren, ohne zu werfen und ohne den
//    Callback aufzurufen). ─────────────────────────────────────────────

async function kanalDurchlauf(): Promise<void> {
  pruefe(typeof GRUNDSKALA_KANAL === 'string' && GRUNDSKALA_KANAL.length > 0, 'Kanalname gesetzt');

  const empfangen: string[] = [];
  const abmelden = hoereGrundskalaGeaendert((name) => {
    empfangen.push(name);
  });

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

// ── 3) N1-2: mehrere Meldungen kurz hintereinander werden JE EMPFÄNGER
//    STRENG NACHEINANDER verarbeitet — ein langsamer erster Abruf darf
//    einen später gestarteten, aber früher fertigen nicht überschreiben.
//    `uebernehmen` bekommt hier eine künstliche Verzögerung, wie sie ein
//    echter Registry-`fetch` hätte (Angriffsprobe N1-2: 2→3→4 mit
//    langsamem ersten Abruf blieb ohne Serialisierung bei 3 stehen). ────

async function reihenfolgeDurchlauf(): Promise<void> {
  // 2 → 3 → 4, der ERSTE Abruf (Wert 2) ist langsam — muss trotzdem bei 4 enden.
  {
    const angewendet: number[] = [];
    let ruf = 0;
    const abmelden = hoereGrundskalaGeaendert(async (_name, grundskala) => {
      ruf++;
      if (ruf === 1) await new Promise((r) => setTimeout(r, 60));
      angewendet.push(grundskala);
    });
    sendeGrundskalaGeaendert('U_Reihenfolge1', 2);
    sendeGrundskalaGeaendert('U_Reihenfolge1', 3);
    sendeGrundskalaGeaendert('U_Reihenfolge1', 4);
    await new Promise((r) => setTimeout(r, 150));
    pruefe(angewendet.length === 3, `alle drei Meldungen verarbeitet (${angewendet.length}: ${angewendet.join(',')})`);
    pruefe(
      angewendet[angewendet.length - 1] === 4,
      `2→3→4 mit langsamem ersten Abruf endet bei 4 (N1-2), Reihenfolge ${angewendet.join(',')}`
    );
    abmelden();
  }

  // 4 → 1 → 4, der ERSTE Abruf (Wert 4) ist langsam — muss wieder bei 4 enden.
  {
    const angewendet: number[] = [];
    let ruf = 0;
    const abmelden = hoereGrundskalaGeaendert(async (_name, grundskala) => {
      ruf++;
      if (ruf === 1) await new Promise((r) => setTimeout(r, 60));
      angewendet.push(grundskala);
    });
    sendeGrundskalaGeaendert('U_Reihenfolge2', 4);
    sendeGrundskalaGeaendert('U_Reihenfolge2', 1);
    sendeGrundskalaGeaendert('U_Reihenfolge2', 4);
    await new Promise((r) => setTimeout(r, 150));
    pruefe(angewendet.length === 3, `alle drei Meldungen verarbeitet (${angewendet.length}: ${angewendet.join(',')})`);
    pruefe(
      angewendet[angewendet.length - 1] === 4,
      `4→1→4 mit langsamem ersten Abruf endet bei 4 (N1-2), Reihenfolge ${angewendet.join(',')}`
    );
    abmelden();
  }
}

// ── 4) N1-3: ein gescheiterter Abruf darf denselben Wert nicht für immer
//    als „übernommen" markieren — eine erneute Meldung mit demselben Wert
//    muss wieder versucht werden, statt als Duplikat zu gelten. Der
//    Fehlschlag selbst darf nie als unbehandelte Ablehnung entkommen,
//    sondern nur über `console.warn`. ───────────────────────────────────

async function fehlschlagDurchlauf(): Promise<void> {
  const rufe: number[] = [];
  let naechsterSchlaegtFehl = true;
  const abmelden = hoereGrundskalaGeaendert(async (_name, grundskala) => {
    rufe.push(grundskala);
    if (naechsterSchlaegtFehl) {
      naechsterSchlaegtFehl = false;
      throw new Error('HTTP 500 (simulierter Registry-Abruf)');
    }
  });
  const urspruenglichesWarn = console.warn;
  const warnungen: unknown[][] = [];
  console.warn = (...teile: unknown[]) => void warnungen.push(teile);
  let unbehandelt = 0;
  const aufUnbehandelt = (): void => void unbehandelt++;
  process.on('unhandledRejection', aufUnbehandelt);
  try {
    sendeGrundskalaGeaendert('U_Fehlschlag', 2);
    await new Promise((r) => setTimeout(r, 40));
    pruefe(rufe.length === 1, `erster Versuch lief (${rufe.length})`);
    pruefe(warnungen.length === 1, `der Fehlschlag wird nur gewarnt, nicht geworfen (${warnungen.length} Warnungen)`);
    pruefe(unbehandelt === 0, 'kein unhandledRejection beim Fehlschlag');

    // Dieselbe Meldung, derselbe Wert, ERNEUT — darf NICHT als Duplikat
    // verworfen werden, weil der erste Versuch nie erfolgreich war (N1-3).
    sendeGrundskalaGeaendert('U_Fehlschlag', 2);
    await new Promise((r) => setTimeout(r, 40));
    pruefe(
      rufe.length === 2,
      `erneute Meldung mit demselben Wert nach einem Fehlschlag wird verarbeitet (N1-3), rufe=${rufe.length}`
    );

    // Jetzt gelingt der Abruf — eine DRITTE, identische Meldung ist ein
    // echtes Duplikat (der Wert wurde inzwischen erfolgreich übernommen).
    sendeGrundskalaGeaendert('U_Fehlschlag', 2);
    await new Promise((r) => setTimeout(r, 40));
    pruefe(rufe.length === 2, `ein Wert-Duplikat NACH erfolgreicher Übernahme wird weiterhin verworfen, rufe=${rufe.length}`);
  } finally {
    console.warn = urspruenglichesWarn;
    process.off('unhandledRejection', aufUnbehandelt);
    abmelden();
  }
}

// ── 5) Ohne `BroadcastChannel` (Umgebung ohne Unterstützung): No-Op statt
//    Absturz — `hoereGrundskalaGeaendert` liefert eine harmlose Abmelde-
//    funktion, `sendeGrundskalaGeaendert` schickt still nichts. ────────

function ohneKanalDurchlauf(): void {
  const orig = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
  try {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    let hoerAufruf = 0;
    const abmelden = hoereGrundskalaGeaendert(() => {
      hoerAufruf++;
    });
    sendeGrundskalaGeaendert('U_OhneKanal', 2);
    abmelden();
    pruefe(hoerAufruf === 0, 'ohne BroadcastChannel: kein Absturz, kein Empfang');
  } finally {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = orig;
  }
}

async function haupt(): Promise<void> {
  await kanalDurchlauf();
  await reihenfolgeDurchlauf();
  await fehlschlagDurchlauf();
  ohneKanalDurchlauf();
  console.log(fehler === 0 ? 'OK — grundskala-live' : `${fehler} ABWEICHUNGEN`);
  process.exit(fehler > 0 ? 1 : 0);
}

void haupt();
