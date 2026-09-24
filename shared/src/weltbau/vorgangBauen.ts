/**
 * vorgangBauen.ts — aus den Eingaben von `ops_apply` einen `Vorgang` machen.
 *
 * Rein und ohne Netz: das Werkzeug liest das Dokument frisch, ruft
 * `baueVorgang`, sagt mit `wende` (ops.ts) voraus, was der Betriebsdienst
 * täte, und schickt erst dann.
 *
 * Regeln:
 *  - `setze` einer Platzierung ohne `id` bekommt eine frische (`frischePlatzierungsId`);
 *    für alle anderen Sammlungen ist die `id` Pflicht.
 *  - `vorher` fehlt → der frisch gelesene Stand wird eingesetzt (`opAendern`,
 *    `opEntfernen`, mit Vorgänger-Anker für ein exaktes Undo). Wer `vorher`
 *    angibt, bekommt bei fremder Änderung am selben Objekt einen Konflikt.
 *  - Jede Platzierung muss ein bekanntes Prefab tragen: der Sanitizer nimmt
 *    jeden Namen von 1–64 Zeichen, unbekannte Namen zeigt der Spielserver
 *    nur als Nichts. Die Prüfung ist Sache des Aufrufers (`pruefePrefab`).
 *  - Dieselbe (Sammlung, id) zweimal in einem Vorgang ist ein Fehler.
 *
 * Builds a `Vorgang` from the inputs of `ops_apply`; pure, no I/O.
 */
import {
  OP_COLLECTIONS,
  opAendern,
  opEntfernen,
  opSetzen,
  type Op,
  type OpCollection,
  type OpEntry,
  type Vorgang,
} from '../worldlayout/ops.js';
import { frischePlatzierungsId } from '../worldlayout/platzierungsId.js';
import type { WorldLayout } from '../worldlayout/types.js';

export const OPS_MAX_JE_AUFRUF = 500;

export interface OpEingabe {
  art: 'setze' | 'aendere' | 'entferne';
  sammlung: OpCollection;
  id?: string;
  nachher?: Record<string, unknown>;
  vorher?: Record<string, unknown>;
}

export interface BauOptionen {
  vorgangId: string;
  /** Kennt der Katalog dieses Prefab (Store, eigene Modelle, Uploads)? */
  pruefePrefab: (name: string) => boolean;
  zufall?: () => number;
}

/** Eingabefehler: Meldung an die KI, nichts wurde gesendet. */
export class VorgangFehler extends Error {
  constructor(
    message: string,
    readonly unbekannteNamen: readonly string[] = []
  ) {
    super(message);
  }
}

const istText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const istZahl = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function baueVorgang(layout: WorldLayout, ops: readonly OpEingabe[], opt: BauOptionen): Vorgang {
  if (ops.length === 0) throw new VorgangFehler('ops ist leer.');
  if (ops.length > OPS_MAX_JE_AUFRUF) {
    throw new VorgangFehler(`ops: ${ops.length} Operationen — höchstens ${OPS_MAX_JE_AUFRUF} je Aufruf.`);
  }
  const belegt = new Set<string>();
  for (const p of layout.placements ?? []) if (typeof p.id === 'string') belegt.add(p.id);
  const angefasst = new Set<string>();
  const unbekannt = new Set<string>();
  const bauteile: Op[] = [];

  for (const [i, e] of ops.entries()) {
    const wo = `ops[${i}]`;
    if (!OP_COLLECTIONS.includes(e.sammlung)) throw new VorgangFehler(`${wo}: unbekannte Sammlung "${String(e.sammlung)}".`);
    if (e.art !== 'entferne' && e.nachher === undefined) throw new VorgangFehler(`${wo}: ${e.art} braucht \`nachher\` (den GANZEN Eintrag).`);
    if (e.nachher !== undefined && e.nachher.id !== undefined && !istText(e.nachher.id)) {
      throw new VorgangFehler(`${wo}: nachher.id muss ein Text sein.`);
    }
    if (e.id !== undefined && e.nachher?.id !== undefined && e.id !== e.nachher.id) {
      throw new VorgangFehler(`${wo}: id "${e.id}" und nachher.id "${String(e.nachher.id)}" widersprechen sich.`);
    }
    let id: string | undefined = e.id ?? (e.nachher?.id as string | undefined);
    if (id === undefined) {
      if (e.art === 'setze' && e.sammlung === 'placements') {
        const n = e.nachher!;
        if (!istText(n.prefab) || !istZahl(n.x) || !istZahl(n.z)) {
          throw new VorgangFehler(`${wo}: eine Platzierung ohne id braucht prefab, x und z, um eine id zu bilden.`);
        }
        id = frischePlatzierungsId(belegt, { prefab: n.prefab, x: n.x, z: n.z }, opt.zufall);
      } else {
        throw new VorgangFehler(`${wo}: ${e.art} in ${e.sammlung} braucht eine \`id\`.`);
      }
    }
    const schluessel = `${e.sammlung}/${id}`;
    if (angefasst.has(schluessel)) {
      throw new VorgangFehler(`${wo}: ${schluessel} kommt in diesem Vorgang mehrfach vor — ein Objekt, eine Operation je Aufruf.`);
    }
    angefasst.add(schluessel);
    if (e.sammlung === 'placements') belegt.add(id);

    const nachher = e.nachher !== undefined ? ({ ...e.nachher, id } as OpEntry) : undefined;
    if (e.sammlung === 'placements' && nachher !== undefined) {
      const prefab = nachher.prefab;
      if (!istText(prefab)) throw new VorgangFehler(`${wo}: die Platzierung "${id}" hat kein prefab.`);
      if (!opt.pruefePrefab(prefab)) unbekannt.add(prefab);
    }

    try {
      if (e.art === 'setze') {
        bauteile.push(opSetzen(e.sammlung, nachher!));
      } else if (e.art === 'aendere') {
        const op = opAendern(layout, e.sammlung, nachher!);
        bauteile.push(e.vorher !== undefined ? { ...op, vorher: { ...e.vorher, id } as OpEntry } : op);
      } else {
        const op = opEntfernen(layout, e.sammlung, id);
        bauteile.push(e.vorher !== undefined ? { ...op, vorher: { ...e.vorher, id } as OpEntry } : op);
      }
    } catch (f) {
      throw new VorgangFehler(`${wo}: ${(f as Error).message}`);
    }
  }
  if (unbekannt.size > 0) {
    const namen = [...unbekannt].sort();
    throw new VorgangFehler(
      `Unbekannte(s) Prefab(s): ${namen.join(', ')}. Nichts gesendet. Gültige Namen liefert catalog_search (und uploads_list für Uploads).`,
      namen
    );
  }
  return { vorgangId: opt.vorgangId, ops: bauteile };
}
