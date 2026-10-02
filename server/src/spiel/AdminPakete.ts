/**
 * Admin packets of the game server: the handler of the admin command line and the one that sets the
 * time of day. They were methods of `WovServer` and moved here as functions with a context
 * (refactoring I1, step 2): `k` is the server itself, `this` became `k`, nothing else changed.
 * `WovServer` keeps one forwarding method per function; calls to other methods of the server go
 * through `k`, so a stand-in set on the instance stays in effect.
 */

import { PacketType, WORLD_TIME_LENGTH } from '@wov/shared';
import type { Peer } from '../net/Peer.js';
import type { Reader } from '../io/Reader.js';
import type { SpielKontext } from './Kontext.js';

/** What this module uses of the server: 6 members. */
type AdminPaketeKontext = SpielKontext<'adminCommands' | 'net' | 'worldTime' | 'getTimeOfDay' | 'getDay' | 'sendTimeSync'>;

/**
 * Client sent an admin command line (e.g. "fly"). Dispatched to the
 * AdminCommandRegistry; the result goes back to the requesting peer as
 * AdminEvent (command / active / message) so the client HUD mirrors the
 * server state. Permission gate lives in AdminCommands.canUseAdminCommands.
 */
function handleAdminCommand(k: AdminPaketeKontext, peer: Peer, reader: Reader): void {
  const line = reader.readString();
  const result = k.adminCommands.execute(peer, line);

  const wort = line.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  // `adminrechte` is the name of the live rights packet (`gleicheAdminrechteAb`): the answer to a typed command never carries it (the client takes it as a grant or withdrawal)
  const command = wort === 'adminrechte' ? 'admin' : wort;
  peer.sendPacketWith(PacketType.AdminEvent, (w) => {
    w.writeString(command);
    w.writeBool(result.active);
    w.writeString(result.message);
  });

  console.log(`[Admin] "${peer.name}" ran "${line}" → ${result.message}`);
}

/**
 * Client requested a new time of day (angeboten auf dem Verbindungsbildschirm,
 * client/src/main.ts — dort für JEDEN Spieler, nicht nur Admins). Ändert
 * die Zeit für ALLE Peers, deshalb wie die anderen Admin-Pfade gegated
 * (Zeile 1142/1164 DungeonEdit*, Zeile 1200 AdminCommand). Anders als bei
 * denen gibt es hier noch kein eigenes Antwortpaket — der Client kennt
 * InteractResult bereits (nur message wird angezeigt, s. main.ts), das
 * reicht für die Ablehnung, ohne ein neues Paket einzuführen.
 *
 * Kein Sonderfall beim ERSTEN Verbinden: Der Client schickt dieses Paket
 * nur, wenn auf dem Verbindungsbildschirm aktiv eine Uhrzeit gewählt wurde
 * (main.ts `zeitWunsch`) — bei "Serverzeit übernehmen" (Default) bleibt es
 * ganz aus. Die Sperre kann den normalen Verbindungsaufbau also nicht
 * brechen.
 */
function handleSetTimeOfDay(k: AdminPaketeKontext, peer: Peer, reader: Reader): void {
  let timeOfDay = reader.readFloat64();
  if (!Number.isFinite(timeOfDay)) return;

  if (!peer.isAdmin) {
    console.log(`[Admin] "${peer.name}" — SetTimeOfDay abgelehnt: keine Berechtigung`);
    peer.sendPacketWith(PacketType.InteractResult, (w) => {
      w.writeBool(false);
      w.writeString('Keine Berechtigung, die Weltzeit zu ändern');
      w.writeString('');
      w.writeInt32(0);
    });
    return;
  }

  // Wrap into [0, WORLD_TIME_LENGTH)
  timeOfDay = ((timeOfDay % WORLD_TIME_LENGTH) + WORLD_TIME_LENGTH) % WORLD_TIME_LENGTH;

  k.worldTime += timeOfDay - k.getTimeOfDay();

  console.log(`[WoV] "${peer.name}" set time of day to ${timeOfDay.toFixed(0)}s (day ${k.getDay()})`);

  // Broadcast the new time to all peers
  for (const p of k.net.getPeers()) {
    k.sendTimeSync(p);
  }
}

export { handleAdminCommand, handleSetTimeOfDay };
