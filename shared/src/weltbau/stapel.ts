/**
 * stapel.ts — der Undo-Stapel des MCP-Prozesses (nur im Speicher).
 *
 * Jeder erfolgreich geschriebene `ops_apply`-Vorgang legt einen Eintrag ab:
 * den Vorgang, das Dokument VOR dem Vorgang (für `world_diff gegen:
 * 'vorgang'`) und die Hashes davor und danach. `undo_last` nimmt den obersten
 * Eintrag erst weg, wenn der Gegenvorgang geschrieben ist. Höchstens
 * `STAPEL_MAX` Einträge, der älteste fällt zuerst heraus.
 *
 * Schnittstelle für world_diff (Leser): `oberster()`, `finde(vorgangId)`,
 * `eintraege()` — jeweils `stand` = Dokument vor dem Vorgang.
 *
 * In-memory undo stack of the MCP process.
 */
import type { Vorgang } from '../worldlayout/ops.js';
import type { WorldLayout } from '../worldlayout/types.js';

export const STAPEL_MAX = 50;

export interface StapelEintrag {
  vorgang: Vorgang;
  /** Das Dokument vor dem Vorgang. */
  stand: WorldLayout;
  hashVor: string;
  hashNach: string;
  zeit: number;
}

export class VorgangsStapel {
  private liste: StapelEintrag[] = [];

  constructor(private readonly max: number = STAPEL_MAX) {}

  get laenge(): number {
    return this.liste.length;
  }

  push(e: StapelEintrag): void {
    this.liste.push(e);
    while (this.liste.length > this.max) this.liste.shift();
  }

  oberster(): StapelEintrag | undefined {
    return this.liste[this.liste.length - 1];
  }

  pop(): StapelEintrag | undefined {
    return this.liste.pop();
  }

  finde(vorgangId: string): StapelEintrag | undefined {
    for (let i = this.liste.length - 1; i >= 0; i--) if (this.liste[i]!.vorgang.vorgangId === vorgangId) return this.liste[i];
    return undefined;
  }

  eintraege(): readonly StapelEintrag[] {
    return this.liste;
  }
}
