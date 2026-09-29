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
import { t } from '../i18n';

const VOLLE_DREHUNG = Math.PI * 2;

/** A random id (36 characters); `crypto.randomUUID` needs a secure context, the fallback does not. */
function zufallsId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** The ids that occur more than once in the placements (those entries cannot be addressed). */
export function doppelteIds(liste: readonly { id?: string }[] | undefined): string[] {
  const gesehen = new Set<string>();
  const doppelt = new Set<string>();
  for (const e of liste ?? []) {
    if (e.id === undefined) continue;
    if (gesehen.has(e.id)) doppelt.add(e.id);
    gesehen.add(e.id);
  }
  return [...doppelt];
}

export class TestflugAktionen {
  constructor(private readonly persistenz: TestflugPersistenz) {}

  /** Unique across instances and tabs: a random part, not a clock and a counter. */
  private vorgangsId(): string {
    return `tf-${zufallsId()}`;
  }

  private schicke(op: Op, zwischen = false): VorgangErgebnis {
    return this.persistenz.vorgang({ vorgangId: this.vorgangsId(), ops: [op] } satisfies Vorgang, zwischen);
  }

  /**
   * The entry with this id in the current draft, and the draft as a layout for the op builders.
   * `null` when the id is missing OR occurs twice (then no entry is THE one: nothing is touched).
   */
  private finde(id: string): { eintrag: EntwurfEintrag; layout: WorldLayout } | null {
    const dok = this.persistenz.laden();
    const treffer = dok?.placements?.filter((p) => p.id === id) ?? [];
    return dok && treffer.length === 1 ? { eintrag: treffer[0]!, layout: dok as unknown as WorldLayout } : null;
  }

  private fehlt(id: string): VorgangErgebnis {
    const n = this.persistenz.laden()?.placements?.filter((p) => p.id === id).length ?? 0;
    return n > 1
      ? { ok: false, ids: [id], message: t('testflug.aktionen.doppelte_id', { id, n }) }
      : { ok: false, ids: [id], message: t('testflug.aktionen.konflikt_bei', { id }) };
  }

  /** Turning and NPC fields are their own gestures: not while a drag is open (release first). */
  private gesperrt(id: string): VorgangErgebnis | null {
    return this.persistenz.ziehOffen?.()
      ? { ok: false, ids: [id], message: t('testflug.aktionen.gesperrt') }
      : null;
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
    const gesperrt = this.gesperrt(id);
    if (gesperrt) return gesperrt;
    const rund = Math.round((((yaw % VOLLE_DREHUNG) + VOLLE_DREHUNG) % VOLLE_DREHUNG) * 10000) / 10000;
    return this.schicke(opAendern(s.layout, 'placements', { ...s.eintrag, id, yaw: rund } as unknown as OpEntry));
  }

  /** NPC fields of a placement; `null` removes them. */
  npcSetzen(id: string, npc: NpcDef | null): VorgangErgebnis {
    const s = this.finde(id);
    if (!s) return this.fehlt(id);
    const gesperrt = this.gesperrt(id);
    if (gesperrt) return gesperrt;
    const { npc: _alt, ...ohne } = s.eintrag;
    return this.schicke(opAendern(s.layout, 'placements', { ...(npc ? { ...s.eintrag, npc } : ohne), id } as unknown as OpEntry));
  }

  loeschen(id: string): VorgangErgebnis {
    const s = this.finde(id);
    if (!s) return this.fehlt(id);
    return this.schicke(opEntfernen(s.layout, 'placements', id));
  }
}
