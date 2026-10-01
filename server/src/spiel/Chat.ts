/**
 * Chat packet of the game server: the handler of a chat message. It was a method of `WovServer` and
 * moved here as a function with a context (refactoring I1, step 3): `k` is the server itself,
 * `this` became `k`, nothing else changed. `WovServer` keeps a forwarding method with the same
 * name; the reach of a message is decided in `ChatReichweite.ts`.
 */

import { PacketType } from '@wov/shared';
import { Writer } from '../io/Writer.js';
import { waehleChatEmpfaenger, kuerzeChatText } from './ChatReichweite.js';
import type { Peer } from '../net/Peer.js';
import type { Reader } from '../io/Reader.js';
import type { SpielKontext } from './Kontext.js';

/** What this module uses of the server: 1 member. */
type ChatKontext = SpielKontext<'net'>;

function handleChatMessage(k: ChatKontext, peer: Peer, reader: Reader): void {
  // An editor connection is not in the world and never speaks in it.
  if (peer.nurEditor) return;
  const chatType = reader.readInt32();
  // Serverseitige Längengrenze (F14) — eine rein clientseitige Grenze
  // hält einen manipulierten/zweiten Client nie auf. kuerzeChatText
  // statt eines nackten .slice(), damit der Test dieselbe Funktion
  // ruft wie hier.
  const text = kuerzeChatText(reader.readString());
  // Frequenzlimit (vormals hier als fester 300-ms-Cooldown, Review-Punkt
  // 11): A4 (Security-Review) ersetzt das durch die Token-Bucket-
  // Drosselung in NetManager.handlePacket, VOR diesem Handler — ein zu
  // schnelles ChatMessage-Paket kommt hier gar nicht mehr an.

  // Broadcast — aber nur an Empfänger in Reichweite (F14). Herleitung
  // der drei Reichweiten (Whisper/Normal/Shout) im Kopfkommentar von
  // ChatReichweite.ts. Der Absender ist über waehleChatEmpfaenger IMMER
  // dabei, auch ohne Empfänger in der Nähe — sonst wirkt der Chat für
  // ihn kaputt.
  // Privacy fix (2026-09-27): this first field used to be the sender's
  // userId (account identity), broadcast to every recipient. The client
  // reads and discards it (main.ts, PacketType.ChatMessage handler) —
  // senderName already carries what the UI shows — so it now carries a
  // constant placeholder instead of an identity.
  const writer = new Writer();
  writer.writeString('0');
  writer.writeString(peer.name);
  writer.writeInt32(chatType);
  writer.writeString(text);
  writer.writeVector3(peer.position);
  const payload = writer.toBuffer();

  const senderId = peer.userId.toString();
  const kandidaten = k.net
    .getPeers()
    .map((p) => ({ id: p.userId.toString(), worldId: p.worldId, position: p.position, peer: p }));
  for (const empfaenger of waehleChatEmpfaenger(kandidaten, senderId, peer.worldId, peer.position, chatType)) {
    empfaenger.peer.sendPacket(PacketType.ChatMessage, payload);
  }

  console.log(`[Chat] ${peer.name}: ${text}`);
}

export { handleChatMessage };
