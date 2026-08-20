/**
 * AdminListe — dauerhafte Admin-Berechtigung ueber stabile Spieler-IDs
 * (Roadmap S6, Security-Review).
 *
 * Hintergrund: `players.everyone-admin: true` (server.yml) macht heute
 * JEDEN verbundenen Spieler zum Admin. Das bleibt Mikes eigener Handgriff
 * und wird hier NICHT abgeschaltet — diese Liste ist eine ZUSAETZLICHE,
 * dauerhafte Berechtigung fuer den Tag, an dem everyone-admin auf false
 * steht: dann bestimmt allein diese Liste (ueber die spielerId aus F3),
 * wer weiterhin Admin-Befehle nutzen darf.
 *
 * ── Warum server/data/worlds/ und NICHT server/data/server.yml ─────────
 * server.yml ist GIT-VERSIONIERT und wird bei jedem Deploy (`git pull`,
 * siehe wov-nur-auf-dev-arbeiten) durch den Stand aus dem Repo ERSETZT —
 * eine dort abgelegte Admin-Liste waere nach dem naechsten Pull weg bzw.
 * stuende im oeffentlichen Repo und waere auf jeder Instanz gleich.
 * `server/data/worlds/` ist dagegen bereits die etablierte Ablage fuer
 * instanzspezifischen, NICHT versionierten Zustand (.gitignore:
 * `server/data/worlds/`, dort liegen die .db.zst-Weltstaende und der
 * Placement-Cache) — sie ueberlebt sowohl einen Serverneustart als auch
 * ein Deploy, und dev/live bekommen ueber den Dateinamen (Instanzname)
 * getrennte Listen, ohne dass dieses Modul irgendetwas ueber Instanzen
 * wissen muss (der Pfad kommt fertig vom Aufrufer).
 *
 * Spieler-IDs sind KEINE Geheimnisse (128 Bit Zufall, aber nicht dazu
 * gedacht, etwas zu beweisen — das SessionToken tut das, siehe
 * Identitaet.ts) — diese Datei ist also keine Zugangsdatei im Sinne des
 * Geheimnis-Verbots, sondern eine gewoehnliche Konfigurationsliste.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { istSpielerId, type SpielerId } from '../net/Identitaet.js';

export interface AdminEintrag {
  spielerId: SpielerId;
  /** Letzter bekannter Anzeigename — NUR fuer die Lesbarkeit der Datei
   *  und der `admin liste`-Ausgabe, nicht sicherheitsrelevant (die
   *  Berechtigung haengt ausschliesslich an spielerId). */
  name: string;
  /** ISO-Zeitstempel, wann der Eintrag hinzugefuegt wurde (Diagnose). */
  seit: string;
}

export class AdminListe {
  private eintraege = new Map<SpielerId, AdminEintrag>();

  constructor(private readonly pfad: string) {
    this.laden();
  }

  private laden(): void {
    if (!existsSync(this.pfad)) return;
    try {
      const roh = JSON.parse(readFileSync(this.pfad, 'utf-8')) as unknown;
      if (!Array.isArray(roh)) {
        console.error(`[AdminListe] ${this.pfad}: kein Array — starte mit leerer Liste`);
        return;
      }
      for (const eintrag of roh) {
        if (
          eintrag &&
          typeof eintrag === 'object' &&
          istSpielerId((eintrag as Partial<AdminEintrag>).spielerId)
        ) {
          const e = eintrag as AdminEintrag;
          this.eintraege.set(e.spielerId, e);
        }
      }
    } catch (err) {
      // Kaputte/unlesbare Datei darf den Serverstart nicht verhindern —
      // leere Liste ist der sichere Rueckfall (niemand bekommt Rechte,
      // die er vorher nicht hatte).
      console.error(`[AdminListe] ${this.pfad} unlesbar, starte mit leerer Liste: ${err}`);
    }
  }

  private speichern(): void {
    mkdirSync(dirname(this.pfad), { recursive: true });
    const tmp = `${this.pfad}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.eintraege.values()], null, 2));
    // Atomarer Ersatz (rename statt direktem writeFileSync auf den
    // Zielpfad) — bei einem Absturz mitten im Schreiben bleibt entweder
    // die alte oder die neue Datei vollstaendig stehen, nie ein
    // halb geschriebener Torso.
    renameSync(tmp, this.pfad);
  }

  enthaelt(id: SpielerId): boolean {
    return this.eintraege.has(id);
  }

  /** @returns true, wenn NEU hinzugefuegt (false = war schon Admin). */
  hinzufuegen(id: SpielerId, name: string): boolean {
    if (this.eintraege.has(id)) return false;
    this.eintraege.set(id, { spielerId: id, name, seit: new Date().toISOString() });
    this.speichern();
    return true;
  }

  /** @returns true, wenn ENTFERNT (false = war nicht in der Liste). */
  entfernen(id: SpielerId): boolean {
    if (!this.eintraege.delete(id)) return false;
    this.speichern();
    return true;
  }

  alle(): AdminEintrag[] {
    return [...this.eintraege.values()];
  }

  get anzahl(): number {
    return this.eintraege.size;
  }
}
