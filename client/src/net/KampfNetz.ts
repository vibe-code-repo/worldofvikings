/**
 * The combat packets on the client, hooked up in one place (main.ts has a line budget):
 *
 *  - `HitEffect` (any blow within earshot): blood / sparks / parry flash and the hit sound;
 *  - `PlayerTod`, `PlayerTreffer`, `Teleport` for the own figure's death and flinch (TodTreffer);
 *  - `AttackAck` (D2): the server's count of the combo per swing; the figure follows it (Quittung.ts).
 *  - `Block` (D3): the server ended or refused the block (`false`): the client's block ends.
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PacketType } from '@wov/shared';
import type { AvatarRig } from '../player/AvatarRig';
import { TodTreffer, type TodTrefferEingabe } from '../player/TodTreffer';
import type { GameSocket } from './GameSocket';
import { SchlagBuch, liesQuittung } from './Quittung';

/** What the wiring needs of the effect and sound layers. */
export interface KampfNetzZiele {
  kampfEffekte: { treffer(pos: Vector3, art: number): void };
  kampfToene: { treffer(pos: { x: number; y: number; z: number }, art: number, eigen: boolean): void };
}

export function verdrahteKampf(
  socket: Pick<GameSocket, 'on'> & Partial<Pick<GameSocket, 'setzeSchlagQuelle'>>,
  eingabe: TodTrefferEingabe,
  avatar: () => AvatarRig | null,
  ziele: KampfNetzZiele,
  jetzt: () => number = () => performance.now(),
  /** D3: `Block=false` des Servers (er hat den Block beendet oder abgelehnt) beendet den Block des Clients. */
  block?: { serverBeendet(): void }
): TodTreffer & { schlagBuch: SchlagBuch } {
  // Treffereffekt vom Server (Kreatur getroffen: Blut; Holz/Stein: Funken; Parade: Funke) — auch fuer Treffer, die Mitspieler landen.
  socket.on(PacketType.HitEffect, (reader) => {
    const pos = reader.readVector3();
    const art = reader.readInt32();
    ziele.kampfEffekte.treffer(new Vector3(pos.x, pos.y, pos.z), art);
    ziele.kampfToene.treffer(pos, art, reader.remaining > 0 && reader.readBool());
  });
  // D2: each swing carries its combo step and the time to the weapon tip; the server answers each one.
  const buch = new SchlagBuch();
  socket.setzeSchlagQuelle?.(() => {
    const a = avatar();
    const schritt = a?.schlaegt ? Math.min(a.letzterHieb + 1, 3) : 0;
    const spitze = a?.hiebSpitzeS ?? NaN;
    return { seq: buch.neu(jetzt(), schritt), schritt, alterMs: 0, spitzeMs: Number.isFinite(spitze) ? spitze * 1000 : 0 };
  });
  socket.on(PacketType.AttackAck, (reader) => {
    const antwort = buch.quittiere(liesQuittung(reader), jetzt());
    if (antwort?.kettenNeu) avatar()?.kettenEnde();
  });
  // D3: the server's answer to a block it ended (stamina out, break, own swing) or refused (nothing in the hand, dead).
  socket.on(PacketType.Block, (reader) => {
    if (!reader.readBool()) block?.serverBeendet();
  });
  const tod = new TodTreffer(eingabe, avatar);
  tod.verdrahte(socket);
  return Object.assign(tod, { schlagBuch: buch });
}
