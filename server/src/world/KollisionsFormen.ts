/**
 * KollisionsFormen — die {@link FormQuelle} des Servers.
 *
 * Der Server öffnete bis heute NIE eine GLB: Was es in der Welt gibt,
 * stand in `shared/src/prefabs.ts`, und wie es AUSSIEHT, war Sache des
 * Clients. Sobald er die Spielerbewegung gegen Hindernisse rechnet, ist
 * das zu wenig — ein Fass ist erst dann ein Hindernis, wenn beide Seiten
 * dieselbe Kiste darum sehen.
 *
 * ── Was hier NICHT passiert ──────────────────────────────────────────
 * Gemessen wird nicht hier. Die Form kommt aus
 * `shared/src/kollision/formen.ts` — derselben Funktion, die der Client
 * mit seinen Babylon-Vertexdaten aufruft. Diese Datei besorgt nur die
 * Zahlen: Datei finden, lesen, das Ergebnis behalten.
 *
 * ── Ohne `assets/` ───────────────────────────────────────────────────
 * Der Speicher liegt AUSSERHALB des Repos (Symlink `assets/store`). Im
 * CI-Checkout gibt es ihn nicht, und dann ist die Quelle einfach LEER:
 * `formFuer()` gibt `null`, `vorladen()` meldet null geladene Formen.
 * Kein Absturz, aber auch kein stiller Ersatz — eine erfundene Kiste
 * wäre schlimmer als gar keine Kollision, weil man ihr nicht ansieht,
 * dass sie erfunden ist.
 *
 * The server's collision shape source: finds the GLB, reads it without
 * Babylon, and hands it to the shared derivation.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BEGEHBAR_NAME,
  PREFAB_DEFS,
  getRoomByHash,
  getStableHash,
  formUebersteuerung,
  istFesterKoerper,
  kollisionsForm,
  kollisionsModellPfad,
  storeKollision,
  PrefabFlag,
  type FormQuelle,
  type KollisionsForm,
  type PrefabDef,
} from '@wov/shared';
import { leseGlb, type GlbNetz } from '@wov/shared/src/kollision/glb.js';

/**
 * `<repo>/assets` — dieselbe Wurzel, aus der auch der Client lädt.
 *
 * DREI Schritte hinauf, nicht vier: Diese Datei liegt in
 * `server/src/world/`, also `world → src → server → <repo>`. Das
 * benachbarte `dungeon/ModuleBuild.ts` braucht vier, weil es eine Ebene
 * tiefer steht — wer die Zeile von dort übernimmt, landet ÜBER dem Repo.
 * Das fällt nicht auf: Eine Wurzel, die es nicht gibt, ist genau der Fall
 * „kein Speicher im CI-Checkout", und dann meldet `vorladen()` brav null
 * Formen und der Server läuft ohne ein einziges Hindernis weiter.
 * Gemessen mit `existsSync` (s. `server/test/kollision-einhaengung.ts`).
 *
 * Gilt für beide Startarten: `tsx src/main.ts` (Quelle) und `dist/` —
 * `rootDir: src` erhält die Tiefe.
 */
export const ASSET_WURZEL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../assets'
);

/**
 * Die Datei hinter einem `PrefabDef.model`.
 *
 * `model` ist der Modellname OHNE Endung und MIT Bestandspräfix
 * (`store/environment/…`, `store-lab/vegetation/…`, `models/…`) — genau
 * die Zeichenkette, aus der `modelUrl()` im Client seine URL baut. Hier
 * wird daraus ein Pfad auf der Platte; der Bestand entscheidet nichts
 * weiter, weil alle drei unter `assets/` liegen.
 */
export function modellDatei(model: string, wurzel = ASSET_WURZEL): string {
  return join(wurzel, `${model}.glb`);
}

/** Wie der EntityManager: Räume und begehbare Bauwerke sind Sonderfälle. */
function istDungeonRaum(prefabName: string): boolean {
  return getRoomByHash(getStableHash(prefabName)) !== undefined;
}

export class KollisionsFormen implements FormQuelle {
  /**
   * `undefined` heisst „noch nicht angesehen", `null` heisst „angesehen,
   * kein Körper". Ohne diese Unterscheidung liefe die Ableitung für jedes
   * durchlässige Prefab bei JEDER Abfrage erneut über alle Vertices.
   */
  private readonly formen = new Map<string, KollisionsForm | null>();
  private readonly defs = new Map<string, PrefabDef>();
  /** Dateien, die fehlen — einmal melden, nicht bei jeder Abfrage. */
  private readonly fehlend = new Set<string>();

  constructor(private readonly wurzel: string = ASSET_WURZEL) {
    for (const d of PREFAB_DEFS) this.defs.set(d.name, d);
  }

  /** Liefert die Form eines Prefabs oder null (kein fester Koerper). */
  formFuer(prefabName: string): KollisionsForm | null {
    const bekannt = this.formen.get(prefabName);
    if (bekannt !== undefined) return bekannt;
    const form = this.ableiten(prefabName);
    this.formen.set(prefabName, form);
    return form;
  }

  /** Wie viele Prefabs bereits angesehen wurden (Zeuge fürs Vorladen). */
  get zahl(): number {
    return this.formen.size;
  }

  /** Wie viele davon wirklich einen Körper haben. */
  get feste(): number {
    let n = 0;
    for (const f of this.formen.values()) if (f !== null) n++;
    return n;
  }

  /** Modelldateien, die fehlten — im CI-Checkout ist das ALLES. */
  get fehlendeDateien(): readonly string[] {
    return [...this.fehlend];
  }

  /**
   * Alle FESTEN Prefabs im Voraus ableiten.
   *
   * Beim Serverstart und nicht beim ersten Schritt eines Spielers: Eine
   * GLB zu lesen und über ihre Vertices zu laufen dauert Millisekunden,
   * und Millisekunden mitten im Bewegungsschritt sind ein Ruckler, den
   * genau ein Spieler bekommt — der erste, der an diesem Fass vorbeiläuft.
   */
  vorladen(): { geladen: number; fest: number; fehlend: number; ms: number } {
    const start = Date.now();
    for (const d of PREFAB_DEFS) {
      if (!this.istFest(d.name, d)) continue;
      this.formFuer(d.name);
    }
    return {
      geladen: this.formen.size,
      fest: this.feste,
      fehlend: this.fehlend.size,
      ms: Date.now() - start,
    };
  }

  /** Die Menge „fest" — dieselbe Regel wie im Client, aus `shared`. */
  private istFest(prefabName: string, def: PrefabDef | undefined): boolean {
    return istFesterKoerper(def, prefabName, {
      dungeonRaum: istDungeonRaum(prefabName),
      begehbar: BEGEHBAR_NAME.test(prefabName),
    });
  }

  private ableiten(prefabName: string): KollisionsForm | null {
    const def = this.defs.get(prefabName);
    if (!this.istFest(prefabName, def)) return null;
    /*
      Die Handtabelle VOR dem Dateizugriff — sie steht in einer Zeile
      Quelltext und braucht die GLB nicht. Das ist nicht nur schneller:
      Ohne `assets/` (CI-Checkout) bekommt der Server für die grossen
      Büsche trotzdem dieselbe Kapsel wie der Client, statt sie unter
      `fehlend` zu verbuchen und den Spieler hindurchzuziehen.
    */
    const handform = formUebersteuerung(prefabName);
    if (handform !== null) return handform;
    if (!def?.model) return null;

    const inhalt = this.leseModell(def.model);
    if (inhalt === null) return null;

    const katalog = storeKollision(prefabName);
    /*
      Das eigene Kollisionsnetz — genau die beiden Wege, die der Client
      geht: ein `_col`-Netz IN der Datei (Altbestand) oder die
      `…-collision.glb` daneben (Speicher). Es ERSETZT die Kollision;
      kommt daraus nichts zustande, gilt das Sichtnetz.
    */
    let eigen: GlbNetz | null = inhalt.kollision;
    if (eigen === null && katalog?.netz !== undefined) {
      eigen = this.leseModell(kollisionsModellPfad(katalog.netz))?.sicht ?? null;
    }
    const optionen = {
      stammartig: def.flags !== undefined && (def.flags & PrefabFlag.TREE_BASE) !== 0n,
      dungeonRaum: istDungeonRaum(prefabName),
    };
    const ausEigen =
      eigen === null
        ? null
        : kollisionsForm(eigen.positionen, eigen.indizes, prefabName, katalog, {
            ...optionen,
            eigenesNetz: true,
          });
    if (ausEigen !== null) return ausEigen;
    const sicht = inhalt.sicht;
    if (sicht === null) return null;
    return kollisionsForm(sicht.positionen, sicht.indizes, prefabName, katalog, optionen);
  }

  private leseModell(model: string): { sicht: GlbNetz | null; kollision: GlbNetz | null } | null {
    const pfad = modellDatei(model, this.wurzel);
    if (!existsSync(pfad)) {
      this.fehlend.add(model);
      return null;
    }
    try {
      return leseGlb(readFileSync(pfad));
    } catch (f) {
      /*
        Eine kaputte GLB darf den Server nicht anhalten — aber sie darf
        auch nicht lautlos zu „kein Hindernis" werden. Deshalb die
        Meldung MIT Dateinamen: Ein Prefab ohne Kollision sieht man beim
        Spielen erst, wenn man hindurchläuft.
      */
      console.warn(`[kollision] ${model} nicht lesbar: ${String(f)}`);
      this.fehlend.add(model);
      return null;
    }
  }
}
