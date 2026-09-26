/**
 * What the test flight does to the draft, one function per gesture, each as
 * ONE Vorgang of ONE op addressed by `id` (`shared/src/worldlayout/ops.ts`).
 * DOM-free: `Testflug.ts` (which needs a scene) calls these, the test counts
 * their Vorgaenge.
 *
 *   setzen      -> setze     (1 op)
 *   verschieben -> aendere   (1 op per frame; the frames of one drag close as ONE Vorgang)
 *   drehen      -> aendere   (1 op)
 *   npcSetzen   -> aendere   (1 op)
 *   loeschen    -> entferne  (1 op)
 *
 * Was der Testflug am Entwurf tut, je Geste ein Vorgang mit einer Operation,
 * adressiert über `id` (nicht über den Listenplatz).
 */
import type { NpcDef, WorldLayout } from '@wov/shared';
import { opAendern, opEntfernen, opSetzen, type Op, type OpEntry, type Vorgang } from '@wov/shared/src/worldlayout/ops.js';
import type { EntwurfEintrag, TestflugPersistenz, VorgangAntwort, VorgangErgebnis } from './TestflugPersistenz';

const VOLLE_DREHUNG = Math.PI * 2;

export class TestflugAktionen {
  private zaehler = 0;

  constructor(
    private readonly persistenz: TestflugPersistenz,
    private readonly jetzt: () => number = Date.now
  ) {}

  private vorgangsId(): string {
    return `tf-${this.jetzt().toString(36)}-${++this.zaehler}`;
  }

  private schicke(op: Op, zwischen = false): VorgangErgebnis {
    return this.persistenz.vorgang({ vorgangId: this.vorgangsId(), ops: [op] } satisfies Vorgang, zwischen);
  }

  /** The entry with this id in the current draft, and the draft as a layout for the op builders. */
  private finde(id: string): { eintrag: EntwurfEintrag; layout: WorldLayout } | null {
    const dok = this.persistenz.laden();
    const eintrag = dok?.placements?.find((p) => p.id === id);
    return dok && eintrag ? { eintrag, layout: dok as unknown as WorldLayout } : null;
  }

  private fehlt(id: string): VorgangErgebnis {
    return { ok: false, ids: [id], message: `Konflikt bei ${id} — nichts geändert` };
  }

  /** A new placement (`eintrag.id` is its address). */
  setzen(eintrag: EntwurfEintrag & { id: string }): VorgangErgebnis {
    return this.schicke(opSetzen('placements', eintrag as unknown as OpEntry));
  }

  /** One frame of a drag; `abschliessen` folds the frames into one Vorgang. */
  verschieben(id: string, x: number, z: number): VorgangErgebnis {
    const s = this.finde(id);
    if (!s) return this.fehlt(id);
    return this.schicke(opAendern(s.layout, 'placements', { ...s.eintrag, id, x, z } as unknown as OpEntry), true);
  }

  /** The end of a drag: the remote answer of the ONE Vorgang, `null` when nothing moved. */
  abschliessen(): Promise<VorgangAntwort> | null {
    return this.persistenz.abschliessen();
  }

  /** Turn to `yaw` (radians, kept in 0 … 2π). */
  drehen(id: string, yaw: number): VorgangErgebnis {
    const s = this.finde(id);
    if (!s) return this.fehlt(id);
    const rund = Math.round((((yaw % VOLLE_DREHUNG) + VOLLE_DREHUNG) % VOLLE_DREHUNG) * 10000) / 10000;
    return this.schicke(opAendern(s.layout, 'placements', { ...s.eintrag, id, yaw: rund } as unknown as OpEntry));
  }

  /** NPC fields of a placement; `null` removes them. */
  npcSetzen(id: string, npc: NpcDef | null): VorgangErgebnis {
    const s = this.finde(id);
    if (!s) return this.fehlt(id);
    const { npc: _alt, ...ohne } = s.eintrag;
    return this.schicke(opAendern(s.layout, 'placements', { ...(npc ? { ...s.eintrag, npc } : ohne), id } as unknown as OpEntry));
  }

  loeschen(id: string): VorgangErgebnis {
    const s = this.finde(id);
    if (!s) return this.fehlt(id);
    return this.schicke(opEntfernen(s.layout, 'placements', id));
  }
}
