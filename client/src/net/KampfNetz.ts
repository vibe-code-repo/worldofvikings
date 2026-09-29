/**
 * The combat packets on the client, hooked up in one place (main.ts has a line budget):
 *
 *  - `HitEffect` (any blow within earshot): blood / sparks / parry flash and the hit sound;
 *  - `PlayerTod`, `PlayerTreffer`, `Teleport` for the own figure's death and flinch (TodTreffer).
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PacketType } from '@wov/shared';
import type { AvatarRig } from '../player/AvatarRig';
import { TodTreffer, type TodTrefferEingabe } from '../player/TodTreffer';
import type { GameSocket } from './GameSocket';

/** What the wiring needs of the effect and sound layers. */
export interface KampfNetzZiele {
  kampfEffekte: { treffer(pos: Vector3, art: number): void };
  kampfToene: { treffer(pos: { x: number; y: number; z: number }, art: number, eigen: boolean): void };
}

export function verdrahteKampf(
  socket: Pick<GameSocket, 'on'>,
  eingabe: TodTrefferEingabe,
  avatar: () => AvatarRig | null,
  ziele: KampfNetzZiele
): TodTreffer {
  // Treffereffekt vom Server (Kreatur getroffen: Blut; Holz/Stein: Funken; Parade: Funke) — auch fuer Treffer, die Mitspieler landen.
  socket.on(PacketType.HitEffect, (reader) => {
    const pos = reader.readVector3();
    const art = reader.readInt32();
    ziele.kampfEffekte.treffer(new Vector3(pos.x, pos.y, pos.z), art);
    ziele.kampfToene.treffer(pos, art, reader.remaining > 0 && reader.readBool());
  });
  const tod = new TodTreffer(eingabe, avatar);
  tod.verdrahte(socket);
  return tod;
}
