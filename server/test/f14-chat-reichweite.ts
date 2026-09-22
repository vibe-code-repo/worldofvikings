/**
 * F14: Reichweiten-Auswahl der Chat-Empfänger und Textlängenprüfung —
 * reine Funktionen aus server/src/spiel/ChatReichweite.ts, kein
 * Server/Socket nötig (ruft dieselben Funktionen, die
 * WovServer.handleChatMessage tatsächlich verwendet — kein Nachbau der
 * Prüflogik, s. Importzeile).
 *
 * Run: npx tsx server/test/f14-chat-reichweite.ts   (from the repo root)
 */

import { ChatMsgType, type Vector3 } from '@wov/shared';
import {
  chatReichweite,
  waehleChatEmpfaenger,
  kuerzeChatText,
  MAX_CHAT_LAENGE,
  type ChatEmpfaengerKandidat,
} from '../src/spiel/ChatReichweite.js';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)} (expect ${JSON.stringify(expected)})`);
};

const pos = (x: number, z: number): Vector3 => ({ x, y: 0, z });

// 1) Reichweiten-Tabelle: Whisper < Normal < Shout, und die konkreten
//    Werte aus der Herleitung im Kopfkommentar der Produktivdatei.
console.log('[1] chatReichweite');
{
  check('1. Whisper', chatReichweite(ChatMsgType.Whisper), 12);
  check('1. Normal', chatReichweite(ChatMsgType.Normal), 64);
  check('1. Shout', chatReichweite(ChatMsgType.Shout), 256);
  check('1. unbekannter Typ fällt auf Normal zurück', chatReichweite(ChatMsgType.Ping), 64);
  check('1. Reihenfolge Whisper < Normal < Shout',
    chatReichweite(ChatMsgType.Whisper) < chatReichweite(ChatMsgType.Normal) &&
    chatReichweite(ChatMsgType.Normal) < chatReichweite(ChatMsgType.Shout),
    true);
}

// 2) waehleChatEmpfaenger: Entfernungsfilter je Typ.
console.log('[2] waehleChatEmpfaenger — Entfernungsfilter');
{
  const sender: ChatEmpfaengerKandidat = { id: 'sender', worldId: 'haupt', position: pos(0, 0) };
  const nah = { id: 'nah', worldId: 'haupt', position: pos(10, 0) }; // 10 m
  const mittel = { id: 'mittel', worldId: 'haupt', position: pos(50, 0) }; // 50 m
  const weit = { id: 'weit', worldId: 'haupt', position: pos(200, 0) }; // 200 m
  const sehrWeit = { id: 'sehrWeit', worldId: 'haupt', position: pos(300, 0) }; // 300 m
  const kandidaten = [sender, nah, mittel, weit, sehrWeit];

  const idsVon = (r: readonly ChatEmpfaengerKandidat[]): string[] => r.map((k) => k.id).sort();

  check('2. Whisper (12 m) erreicht Absender + nah (10 m), aber nicht mittel (50 m)',
    idsVon(waehleChatEmpfaenger(kandidaten, 'sender', 'haupt', sender.position, ChatMsgType.Whisper)),
    ['nah', 'sender']);
  check('2. Normal (64 m) erreicht Absender + nah + mittel',
    idsVon(waehleChatEmpfaenger(kandidaten, 'sender', 'haupt', sender.position, ChatMsgType.Normal)),
    ['mittel', 'nah', 'sender']);
  check('2. Shout (256 m) erreicht alle ausser sehrWeit (300 m)',
    idsVon(waehleChatEmpfaenger(kandidaten, 'sender', 'haupt', sender.position, ChatMsgType.Shout)),
    ['mittel', 'nah', 'sender', 'weit']);
}

// 3) Der Absender ist IMMER dabei — auch wenn er allein auf der Welt ist
//    (ausdrückliche Vorgabe der Aufgabe: der Chat darf für ihn nie kaputt
//    wirken).
console.log('[3] Absender sieht die eigene Nachricht immer');
{
  const sender: ChatEmpfaengerKandidat = { id: 'sender', worldId: 'haupt', position: pos(1000, 1000) };
  const ergebnis = waehleChatEmpfaenger([sender], 'sender', 'haupt', sender.position, ChatMsgType.Whisper);
  check('3. einziger Kandidat = Absender bleibt im Ergebnis (Whisper, kürzeste Reichweite)',
    ergebnis.map((k) => k.id), ['sender']);
}

// 4) Grenzfall: exakt auf der Reichweitengrenze zählt noch als erreicht
//    (<=, nicht <).
console.log('[4] Grenzwert der Reichweite');
{
  const sender: ChatEmpfaengerKandidat = { id: 'sender', worldId: 'haupt', position: pos(0, 0) };
  const genauAufGrenze = { id: 'grenze', worldId: 'haupt', position: pos(64, 0) }; // exakt Normal-Reichweite
  const knappDrueber = { id: 'drueber', worldId: 'haupt', position: pos(64.01, 0) };
  const ergebnis = waehleChatEmpfaenger(
    [sender, genauAufGrenze, knappDrueber], 'sender', 'haupt', sender.position, ChatMsgType.Normal
  );
  const ids = ergebnis.map((k) => k.id).sort();
  check('4. exakt auf der Grenze ist noch dabei, knapp drüber nicht mehr',
    ids, ['grenze', 'sender']);
}

// 5) kuerzeChatText / MAX_CHAT_LAENGE — die serverseitige Grenze, die
//    WovServer.handleChatMessage tatsächlich anwendet.
console.log('[5] kuerzeChatText');
{
  check('5. Standardgrenze', MAX_CHAT_LAENGE, 256);
  check('5. kurzer Text bleibt unverändert', kuerzeChatText('hallo'), 'hallo');
  const genauLang = 'x'.repeat(MAX_CHAT_LAENGE);
  check('5. Text genau an der Grenze bleibt unverändert', kuerzeChatText(genauLang).length, MAX_CHAT_LAENGE);
  const zuLang = 'x'.repeat(MAX_CHAT_LAENGE + 500);
  check('5. zu langer Text wird auf die Grenze gekappt', kuerzeChatText(zuLang).length, MAX_CHAT_LAENGE);
  check('5. eigene Grenze (maxLaenge-Parameter) wird respektiert', kuerzeChatText('123456789', 4), '1234');
}

// 6) Nur dieselbe Welt: Kandidaten anderer Welten hören nichts, auch nicht auf
//    denselben x/z (Instanzen liegen am Ursprung).
console.log('[6] Welt des Absenders');
{
  const sender = { id: 'sender', worldId: 'haupt', position: pos(0, 0) };
  const gleicheWelt = { id: 'gleiche', worldId: 'haupt', position: pos(1, 0) };
  const andereWelt = { id: 'andere', worldId: 'dungeon:x', position: pos(0, 0) };
  const idsVon = (r: readonly ChatEmpfaengerKandidat[]): string[] => r.map((k) => k.id).sort();
  for (const [name, typ] of [['Whisper', ChatMsgType.Whisper], ['Normal', ChatMsgType.Normal], ['Shout', ChatMsgType.Shout]] as const) {
    check(`6. ${name}: nur die eigene Welt, die andere bekommt nichts`,
      idsVon(waehleChatEmpfaenger([sender, gleicheWelt, andereWelt], 'sender', 'haupt', sender.position, typ)),
      ['gleiche', 'sender']);
  }
  const ausInstanz = waehleChatEmpfaenger([sender, gleicheWelt, andereWelt], 'andere', 'dungeon:x', andereWelt.position, ChatMsgType.Shout);
  check('6. Absender in der Instanz: er hoert sich, die Oberwelt nicht', idsVon(ausInstanz), ['andere']);
}

console.log(
  failures === 0 ? '\n=== F14 ChatReichweite: ALL PASSED ===' : `\n=== F14 ChatReichweite: ${failures} FAILED ===`
);
process.exit(failures === 0 ? 0 : 1);
