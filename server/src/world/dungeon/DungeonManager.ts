/**
 * DungeonManager (Phase G) — dungeons as standalone instances.
 *
 * Konzept: Jeder Dungeon lebt in einer EIGENEN WELT (`server/src/world/
 * Welt.ts`) — eigener ZDO-Raum, eigenes (leeres) Gelaende, eigene Systeme,
 * Ursprung im Ursprung. Betreten und Verlassen ist ein Weltwechsel, kein
 * Teleport quer durch dieselbe Welt.
 *
 * Bis zum 27.08.2026 lag stattdessen jede Instanz in einem "Band" ab
 * x = 100.000 im SELBEN ZDO-Raum wie die Welt, weit ausserhalb des
 * bespielbaren Gebiets. Das funktionierte, kostete aber, was float32 dort
 * verlangt: Zwei benachbarte darstellbare Werte liegen bei 100.000 ganze
 * 7,8 mm auseinander. Eigene Welten nehmen den Grund fuer den Abstand weg,
 * statt den Abstand zu verwalten.
 *
 * Three layers:
 *   DungeonDocument (persistent, has the ID) — data/dungeons/<id>.json.
 *     Either 'generated' (reproducible from base+seed, stored materialized
 *     so it can be edited) or 'custom' (hand-built in the editor).
 *   Entrance registry (persistent) — data/dungeons/entrances.json maps a
 *     world entrance (zone of the location) to a dungeon ID. Auto-filled
 *     when the ZoneManager materializes a location containing a DG_* piece;
 *     reassignable via admin command.
 *   DungeonInstance (ephemeral) — materialized ZDOs of one document in an
 *     instance slot. Never saved with the world (loot state resets on
 *     server restart — dungeons regenerate).
 *
 * C++ reference: DungeonManager.cpp / DungeonGenerator.cpp (the generation
 * itself lives in shared/src/dungeonGenerator.ts).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  DUNGEON_REGEN_INTERVAL_MS,
  DungeonDocument,
  DungeonLayout,
  ENTRANCE_HULL_MODELS,
  generateDungeonLayout,
  findPrefabByName,
  getDungeonByHash,
  getDungeonByName,
  getStableHash,
  isInstanceableDungeon,
  isValidDungeonId,
  istEigenesModell,
  DUNGEON_DOCUMENT_VERSION,
  sanitizeDungeonDocument,
  dungeon2,
} from '@wov/shared';
import { materialisiere2 } from './Materialisierung2.js';
// Serverseitige Weltdaten: NICHT ueber den Barrel, sondern ueber den
// expliziten Pfad — sie tragen die Rohdaten der Weltvorlagen (Pieces bzw.
// Raum-Einrichtung) und haetten im Barrel jedes Client-Bundle aufgeblaeht.
import { flattenLayout } from '@wov/shared/src/dungeonFlatten.js';
import type { Vector3 } from '@wov/shared';
import type { ZDOManager } from '../../zdo/ZDOManager.js';
import type { Welt } from '../Welt.js';
import type { ZDOID } from '../../zdo/ZDOID.js';

/** A live, materialized dungeon (one per document at a time). */
export interface DungeonInstance {
  dungeonId: string;
  /**
   * Die Welt dieser Instanz — eigener ZDO-Raum, eigenes (leeres) Gelände,
   * eigene Systeme. Sie ist der Grund, warum `origin` unten (0,0,0) ist:
   * Es gibt nichts mehr, wovon man Abstand halten müsste.
   */
  welt: Welt;
  slot: number;
  /**
   * Ursprung der Instanz IN IHRER WELT — seit dem Umbau auf eigene Welten
   * immer (0, 0, 0).
   *
   * Das Feld bleibt, weil `getSpawnPoint` und die Materialisierung damit
   * rechnen und eine spätere Instanz mit Landmasse ihren Dungeon durchaus
   * versetzt hineinsetzen darf. Was verschwunden ist, ist der GRUND für
   * einen Versatz: Vorher lagen alle Instanzen im selben ZDO-Raum wie die
   * Welt und mussten sich ab x = 100.000 aus dem Weg gehen — und zahlten
   * dort 7,8 mm Abstand zwischen zwei darstellbaren float32-Werten.
   */
  origin: Vector3;
  zdoids: ZDOID[];
  /**
   * Die ZDOs der von Hand gesetzten Deko — Teilmenge von `zdoids`.
   *
   * Getrennt geführt, damit eine Deko-Änderung nur diese anfassen muss.
   * Ohne die Liste bliebe nur „alles abreissen und neu bauen", und das
   * heisst für jeden gesetzten Gegenstand: Instanz weg, Instanz neu,
   * Spieler teleportiert. Bei zwanzig Fackeln zwanzigmal.
   */
  propZdoids: ZDOID[];
  /** Peer names currently inside. */
  players: Set<string>;
  /** Für die Regeneration: letzter Zeitpunkt mit Spielern (ms epoch). */
  zuletztBetreten?: number;

  // ── Dungeon Generator 2.0 (AP13) ─────────────────────────────────
  // Zusatzfelder, KEIN zweiter Instanztyp: Betreten, Verlassen, Slots,
  // Regeneration und die ZDO-Zerstörungsreihenfolge sollen für beide
  // Formate genau derselbe Code bleiben. Ein `if` am Materialisieren ist
  // billiger als eine zweite Instanzverwaltung, die zwei Jahre später
  // auseinandergelaufen ist.
  // Extra fields, NOT a second instance type: entering, leaving, slots,
  // regeneration and the ZDO destruction order must remain exactly the
  // same code for both formats.

  /** Das ausgerollte 2.0-Layout — nur bei 2.0-Instanzen. / 2.0 layouts only. */
  layout2?: dungeon2.DungeonLayout2;
  /**
   * Das Bauergebnis der Instanz. Es trägt den Spawnpunkt (ausdrücklich,
   * nicht hergeleitet) und die Kollisions-/Navzellen, aus denen die
   * Spawn-Platzprüfung und später die NPC-Wegfindung lesen.
   * The instance's build result — carries the explicit spawn point and the
   * collision/nav cells the spawn placement check reads from.
   */
  bau?: dungeon2.BauErgebnis;
  /** Anker-Id → ZDO. Grundlage von `ankerAngleichen`. / Anchor id → ZDO. */
  ankerZuZdo?: Map<number, ZDOID>;
}

/** 'Spawner_Skeleton_respawn_30' → 'Skeleton'; 'BonePileSpawner' → 'Skeleton'. */
function spawnerCreature(prefabName: string): string | null {
  if (prefabName === 'BonePileSpawner') return 'Skeleton';
  const m = /^Spawner_([A-Za-z]+)/.exec(prefabName);
  if (!m) return null;
  return findPrefabByName(m[1]!) ? m[1]! : null;
}

/** A world entrance mapped to a dungeon ID. */
export interface DungeonEntrance {
  /** Zone key "zx,zy" of the location (1 dungeon entrance per zone). */
  zoneKey: string;
  /** World position of the DG_* piece (≈ the visible entrance). */
  pos: Vector3;
  /** Feature (location) name, e.g. 'Crypt2' — diagnostics/UI. */
  feature: string;
  /** Assigned dungeon document. */
  dungeonId: string;
  /**
   * Recipe for the lazy auto-document: DG_* base + seed. Documents are NOT
   * created eagerly (a fresh world books 1000+ dungeon locations — that
   * would flood data/dungeons/ at startup); getOrCreateInstance builds the
   * document from this on first enter. Absent for admin-assigned custom
   * dungeons whose document already exists.
   */
  base?: string;
  seed?: number;
}

interface EntranceFile {
  version: number;
  entries: DungeonEntrance[];
}

export class DungeonManager {
  private readonly documents = new Map<string, DungeonDocument>();
  /**
   * Die 2.0-Dokumente — eine ZWEITE Karte neben den alten, kein Union-Typ.
   *
   * Der Grund ist die Abnahmebedingung (a) aus AP13: „ein 2.0-Dokument läuft
   * nachweislich NIE durch den Alt-Sanitizer und umgekehrt". Mit einer
   * gemeinsamen Karte und einem Union-Typ wäre jede der rund zwei Dutzend
   * Aufrufstellen (`doc.base`, `doc.layout.rooms`, der Editor, der
   * Betriebsdienst) eine Stelle, an der man sich vertun kann. Zwei Karten
   * sind die Aussage „das sind zwei Formate", und der Übersetzer hält sie.
   * The 2.0 documents — a SECOND map beside the old one, not a union type.
   * Two maps state "these are two formats", and the compiler holds it.
   */
  private readonly dokumente2 = new Map<string, dungeon2.DungeonDokument2>();
  private readonly instances = new Map<string, DungeonInstance>();
  private readonly entrances = new Map<string, DungeonEntrance>();
  private readonly freeSlots: number[] = [];
  private nextSlot = 0;

  /** Fired whenever the entrance registry changes (map markers re-broadcast). */
  onEntrancesChanged: (() => void) | null = null;

  constructor(
    /**
     * ZDO-Raum der HAUPTWELT. Der Dungeon-Manager schreibt dort genau
     * eines hinein: die sichtbare Eingangshülle in der Oberwelt. Alles
     * andere lebt in der Welt der jeweiligen Instanz.
     */
    private readonly zdos: ZDOManager,
    private readonly dungeonsDir: string,
    /** Legt die Welt einer Instanz an (WovServer kennt die Umgebung). */
    private readonly weltAnlegen: (weltId: string) => Welt,
    /** Räumt sie wieder weg. */
    private readonly weltEntfernen: (weltId: string) => void
  ) {}

  /** Welt-Kennung einer Instanz — stabil und im Log lesbar. */
  static weltId(dungeonId: string): string {
    return `dungeon:${dungeonId}`;
  }

  // ── Documents ────────────────────────────────────────────────────

  /** Load all dungeon documents + the entrance registry from disk. */
  load(): void {
    mkdirSync(this.dungeonsDir, { recursive: true });

    for (const file of readdirSync(this.dungeonsDir)) {
      if (!file.endsWith('.json') || file === 'entrances.json') continue;
      try {
        const raw = JSON.parse(readFileSync(join(this.dungeonsDir, file), 'utf-8'));
        // DIE WEICHE (AP13). Sie sieht nur auf `version` — ein 2.0-Dokument
        // kommt nie beim Alt-Sanitizer an und umgekehrt.
        // THE SWITCH — it looks only at `version`.
        if (dungeon2.istDokument2(raw)) {
          const doc2 = dungeon2.sanitizeDungeonDokument2(raw);
          if (doc2) {
            this.dokumente2.set(doc2.id, doc2);
          } else {
            console.warn(`[Dungeon] ${file}: invalid 2.0 document — skipped`);
          }
          continue;
        }
        const doc = sanitizeDungeonDocument(raw);
        if (doc) {
          this.documents.set(doc.id, doc);
        } else {
          console.warn(`[Dungeon] ${file}: invalid document — skipped`);
        }
      } catch (err) {
        console.warn(`[Dungeon] ${file}: unreadable (${err}) — skipped`);
      }
    }

    const entrancePath = join(this.dungeonsDir, 'entrances.json');
    if (existsSync(entrancePath)) {
      try {
        const raw = JSON.parse(readFileSync(entrancePath, 'utf-8')) as EntranceFile;
        for (const e of raw.entries ?? []) {
          if (typeof e?.zoneKey === 'string' && typeof e?.dungeonId === 'string') {
            this.entrances.set(e.zoneKey, e);
          }
        }
      } catch (err) {
        console.warn(`[Dungeon] entrances.json unreadable (${err})`);
      }
    }

    if (this.documents.size > 0 || this.dokumente2.size > 0 || this.entrances.size > 0) {
      console.log(
        `[Dungeon] Loaded ${this.documents.size} document(s), ` +
          `${this.dokumente2.size} 2.0 document(s), ${this.entrances.size} entrance(s)`
      );
    }
  }

  // ── Dokumente 2.0 (AP13) ─────────────────────────────────────────

  getDokument2(id: string): dungeon2.DungeonDokument2 | undefined {
    return this.dokumente2.get(id);
  }

  listDokumente2(): dungeon2.DungeonDokument2[] {
    return [...this.dokumente2.values()];
  }

  /**
   * Gibt es zu dieser Kennung überhaupt ein Dokument — gleich welchen
   * Formats? Die Aufrufstellen, die nur „kenne ich das?" fragen wollen
   * (`dungeon enter`, der Editor-Weg), sollen sich nicht entscheiden müssen.
   * Is there any document under this id, whichever format?
   */
  hatDokument(id: string): boolean {
    return this.documents.has(id) || this.dokumente2.has(id);
  }

  /** Persist a (sanitized) 2.0 document and register it. */
  saveDokument2(doc: dungeon2.DungeonDokument2): void {
    this.dokumente2.set(doc.id, doc);
    mkdirSync(this.dungeonsDir, { recursive: true });
    const path = join(this.dungeonsDir, `${doc.id}.json`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc, null, 1));
    renameSync(tmp, path);
  }

  /**
   * Ein erzeugtes 2.0-Dokument anlegen und ablegen. Gegenstück zu
   * `createGenerated`, nur ohne Kit: Thema und Seeds sind das ganze Rezept.
   * Create and persist a generated 2.0 document — the counterpart to
   * `createGenerated`, only without a kit: theme and seeds are the whole
   * recipe.
   */
  erzeugeDungeon2(
    thema: string,
    seeds: dungeon2.LayoutSeeds,
    id?: string,
    /**
     * Grundhelligkeit dieses Grabs (0..1). Weggelassen = Vorgabe des Themas
     * — und das ist der Normalfall.
     * Base brightness (0..1); omitted = the theme's default.
     */
    ambientLicht?: number
  ): dungeon2.DungeonDokument2 | null {
    const kennung = id ?? `${thema}-${(seeds.architektur >>> 0).toString(16)}`;
    const name = `${thema} #${(seeds.architektur >>> 0).toString(16)}`;
    const doc = dungeon2.erzeugeDokument2(kennung, name, thema, seeds, ambientLicht);
    if (!doc) return null;
    this.saveDokument2(doc);
    return doc;
  }

  /**
   * Der Deskriptor einer 2.0-Instanz für das Teleportpaket — Thema, Seeds,
   * Prüfsumme, Layout-Formatversion. Über die Leitung reist er, nie die
   * Geometrie.
   * The descriptor of a 2.0 instance for the teleport packet.
   */
  deskriptor2(dungeonId: string): dungeon2.LayoutDeskriptor | null {
    const doc = this.dokumente2.get(dungeonId);
    return doc ? dungeon2.deskriptorVon(doc) : null;
  }

  getDocument(id: string): DungeonDocument | undefined {
    return this.documents.get(id);
  }

  listDocuments(): DungeonDocument[] {
    return [...this.documents.values()];
  }

  /** Persist a (sanitized) document and register it. */
  saveDocument(doc: DungeonDocument): void {
    this.documents.set(doc.id, doc);
    mkdirSync(this.dungeonsDir, { recursive: true });
    const path = join(this.dungeonsDir, `${doc.id}.json`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc, null, 1));
    renameSync(tmp, path);
  }

  /**
   * Accept an untrusted document (editor upload). Returns the sanitized
   * document or null. Existing instance is torn down so the next enter
   * materializes the new state.
   */
  /**
   * Ein Dokument annehmen (Editor-Weg).
   *
   * `instanzErhalten` sagt dem Aufrufer, ob die laufende Instanz stehen
   * geblieben ist. Nur dann darf er auf das Zurückteleportieren
   * verzichten — und nur dann bleibt der Spieler beim Setzen einer Fackel
   * dort, wo er steht.
   */
  upsertDocument(raw: unknown): { doc: DungeonDocument; instanzErhalten: boolean } | null {
    // Dieselbe Weiche wie in `load()`. Ein 2.0-Dokument darf hier nicht
    // durchrutschen: Der Alt-Sanitizer würde es an `base` scheitern lassen
    // und `null` melden — „ungültig" statt „falscher Weg".
    // The same switch as in `load()`.
    if (dungeon2.istDokument2(raw)) return null;
    const doc = sanitizeDungeonDocument(raw);
    if (!doc) return null;
    const vorher = this.documents.get(doc.id);
    this.saveDocument(doc);

    const instance = this.instances.get(doc.id);
    // Nur Deko geändert UND die Instanz läuft: angleichen statt abreissen.
    // Der Vergleich läuft über die serialisierten Räume und Türen — beide
    // stammen aus demselben Sanitizer und sind deshalb feldweise
    // vergleichbar; ein selbstgeschriebener Vergleich wäre die Stelle, an
    // der ein neues Feld eines Tages stillschweigend durchrutscht.
    const nurDeko =
      instance !== undefined &&
      vorher !== undefined &&
      JSON.stringify(vorher.layout.rooms) === JSON.stringify(doc.layout.rooms) &&
      JSON.stringify(vorher.layout.doors) === JSON.stringify(doc.layout.doors);

    if (nurDeko) {
      this.dekoAngleichen(instance, doc);
      return { doc, instanzErhalten: true };
    }
    this.destroyInstance(doc.id);
    return { doc, instanzErhalten: false };
  }

  /**
   * Ein 2.0-Dokument annehmen (Editor-Weg).
   *
   * Verglichen wird die PRÜFSUMME, nicht `JSON.stringify` — sauberer und
   * billiger als ein Stringvergleich, und es fällt keine neue Eigenschaft
   * still durch, weil die Prüfsumme über die Kanonisierung des GANZEN
   * Layouts läuft. Anker gehen NICHT in diesen Vergleich ein: Sie sind
   * genau das, was sich ändern darf, ohne dass die Instanz abgerissen wird
   * (sonst teleportiert jede gesetzte Fackel den Spieler an den Eingang).
   *
   * Accept a 2.0 document. The CHECKSUM is compared, not `JSON.stringify`.
   * Anchors are excluded from that comparison: they are exactly what may
   * change without tearing the instance down.
   */
  upsertDokument2(
    raw: unknown
  ): { doc: dungeon2.DungeonDokument2; instanzErhalten: boolean } | null {
    if (!dungeon2.istDokument2(raw)) return null;
    const doc = dungeon2.sanitizeDungeonDokument2(raw);
    if (!doc) return null;
    const vorher = this.dokumente2.get(doc.id);
    this.saveDokument2(doc);

    const instance = this.instances.get(doc.id);
    const nurAnker =
      instance !== undefined &&
      vorher !== undefined &&
      dungeon2.pruefsummeOhneAnker(vorher) === dungeon2.pruefsummeOhneAnker(doc);

    if (nurAnker) {
      this.ankerAngleichen(instance, doc);
      return { doc, instanzErhalten: true };
    }
    this.destroyInstance(doc.id);
    return { doc, instanzErhalten: false };
  }

  deleteDocument(id: string): boolean {
    // Beide Kartensätze, EIN Löschweg: Die Eingangs-Zuordnungen, die
    // Instanz und die Datei sind für beide Formate dieselben Dinge.
    // Both maps, ONE delete path.
    const geloescht = this.documents.delete(id) || this.dokumente2.delete(id);
    if (!geloescht) return false;
    this.destroyInstance(id);
    // Drop entrance assignments pointing at the deleted dungeon.
    for (const [key, e] of this.entrances) {
      if (e.dungeonId === id) this.entrances.delete(key);
    }
    this.saveEntrances();
    this.onEntrancesChanged?.();
    const path = join(this.dungeonsDir, `${id}.json`);
    try {
      if (existsSync(path)) renameSync(path, `${path}.deleted`);
    } catch {
      /* Datei weg = Ziel erreicht */
    }
    return true;
  }

  /**
   * Create (and persist) a generated dungeon document.
   * The layout is stored materialized so the editor can modify it later.
   */
  createGenerated(baseName: string, seed: number, id?: string): DungeonDocument | null {
    const def = getDungeonByName(baseName);
    if (!def || !isInstanceableDungeon(def)) return null;

    const slug = baseName.replace(/^DG_/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const finalId = id ?? `${slug}-${(seed >>> 0).toString(16)}`;
    if (!isValidDungeonId(finalId)) return null;

    const layout = generateDungeonLayout(def, seed);
    const doc: DungeonDocument = {
      // Die KONSTANTE, nicht die Zahl. Sie steht in `shared/src/dungeons.ts`
      // und stand hier als Literal daneben — beim Sprung auf 2 (Deko im
      // Dokument) schrieb der Generator weiter eine 1, waehrend der
      // Sanitizer beim naechsten Laden 2 daraus machte. Folgenlos, aber
      // eine Zahl, die zwei Dinge behauptet, ist keine Versionsangabe.
      version: DUNGEON_DOCUMENT_VERSION,
      id: finalId,
      name: `${baseName.replace(/^DG_/, '')} #${(seed >>> 0).toString(16)}`,
      base: baseName,
      mode: 'generated',
      seed,
      zoneSize: 64,
      layout,
    };
    this.saveDocument(doc);
    return doc;
  }

  // ── Entrances ────────────────────────────────────────────────────

  /**
   * Called by the ZoneManager when a location materializes a DG_* piece,
   * and by the startup backfill for every booked dungeon location. First
   * contact books the entrance with a deterministic auto-document recipe
   * (base+seed — the document itself is created lazily on first enter);
   * later contacts keep whatever assignment exists (admin overrides win).
   */
  registerEntrance(
    featureName: string,
    dgPrefabHash: number,
    zoneKey: string,
    pos: Vector3,
    seed: number,
    quiet = false
  ): DungeonEntrance | null {
    const existing = this.entrances.get(zoneKey);
    if (existing) return existing;
    // Backfill bucht mit der FEATURE-Position, der Generierungs-Hook später
    // mit der (rotierten) PIECE-Position — liegt die auf der Nachbarzone,
    // entstünde ein Duplikat. Nähe schlägt deshalb den Zonenschlüssel.
    const near = this.findEntranceNear(pos, 40);
    if (near) return near;

    const def = getDungeonByHash(dgPrefabHash);
    // Camps bleiben Oberwelt, PlainsFortress ist gesperrt (8k-Räume-Monster).
    if (!def || !isInstanceableDungeon(def)) return null;

    const slug = def.name.replace(/^DG_/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const id = `${slug}-${zoneKey.replace(',', 'x').replace(/-/g, 'm')}`;

    const entrance: DungeonEntrance = {
      zoneKey,
      pos: { ...pos },
      feature: featureName,
      dungeonId: id,
      base: def.name,
      seed: seed | 0,
    };
    this.entrances.set(zoneKey, entrance);
    if (!quiet) {
      this.saveEntrances();
      this.onEntrancesChanged?.();
      console.log(`[Dungeon] Entrance '${featureName}' @ ${zoneKey} → ${id}`);
    }
    return entrance;
  }

  /**
   * Startup backfill: book entrances for every dungeon-bearing location the
   * ZoneManager has PREPARED (booked), not just the generated ones — on an
   * existing save the already-generated zones never run generateFeature
   * again, and the world map should still show every crypt/cave. Seed is
   * derived position-based like C++ DungeonGenerator::GetSeed.
   */
  backfillFromFeatures(
    instances: ReadonlyArray<{ zoneKey: string; featureName: string; dgPrefabHash: number; pos: Vector3 }>,
    worldSeed: number
  ): number {
    let added = 0;
    for (const inst of instances) {
      if (this.entrances.has(inst.zoneKey)) continue;
      const seed =
        (worldSeed +
          Math.imul(Math.trunc(inst.pos.x), -4271) +
          Math.imul(Math.trunc(inst.pos.y), 9187) +
          Math.imul(Math.trunc(inst.pos.z), -2134)) |
        0;
      if (this.registerEntrance(inst.featureName, inst.dgPrefabHash, inst.zoneKey, inst.pos, seed, true)) {
        added++;
      }
    }
    if (added > 0) {
      this.saveEntrances();
      this.onEntrancesChanged?.();
      console.log(`[Dungeon] Backfilled ${added} entrance(s) from booked locations`);
    }
    return added;
  }

  /** Reassign an entrance to another dungeon document. */
  assignEntrance(zoneKey: string, dungeonId: string): boolean {
    const entrance = this.entrances.get(zoneKey);
    if (!entrance || !this.documents.has(dungeonId)) return false;
    entrance.dungeonId = dungeonId;
    // Das Auto-Rezept löschen: die Zuweisung zeigt jetzt auf ein
    // existierendes Dokument, nicht mehr auf einen lazy zu erzeugenden.
    delete entrance.base;
    delete entrance.seed;
    this.saveEntrances();
    this.onEntrancesChanged?.();
    return true;
  }

  /** Nearest entrance within `radius` meters (horizontal). */
  findEntranceNear(pos: Vector3, radius: number): DungeonEntrance | null {
    let best: DungeonEntrance | null = null;
    let bestD = radius * radius;
    for (const e of this.entrances.values()) {
      const dx = e.pos.x - pos.x;
      const dz = e.pos.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d <= bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  listEntrances(): DungeonEntrance[] {
    return [...this.entrances.values()];
  }

  private saveEntrances(): void {
    mkdirSync(this.dungeonsDir, { recursive: true });
    const path = join(this.dungeonsDir, 'entrances.json');
    const tmp = `${path}.tmp`;
    const data: EntranceFile = { version: 1, entries: [...this.entrances.values()] };
    writeFileSync(tmp, JSON.stringify(data, null, 1));
    renameSync(tmp, path);
  }

  // ── Entrance hulls ───────────────────────────────────────────────

  /** Zonen, deren Hüllen-ZDO diese Session schon steht (nicht persistent). */
  private readonly hullSpawned = new Set<string>();

  /**
   * Sichtbare Eingangs-Hülle spawnen (Crypt2-Steinbau, Höhleneingang …).
   * Die Hülle ist im Original statische Location-Prefab-Geometrie, kein
   * ZNetView — hier wird sie ein gewöhnliches statisches ZDO. Bewusst
   * NICHT persistent: dieser Aufruf läuft bei jedem Serverstart für alle
   * Eingänge erneut (spawnAllEntranceHulls), gespeicherte Hüllen würden
   * sich sonst bei jedem Boot verdoppeln.
   */
  spawnEntranceHull(entrance: DungeonEntrance): boolean {
    if (this.hullSpawned.has(entrance.zoneKey)) return false;
    if (!ENTRANCE_HULL_MODELS.has(entrance.feature)) return false;
    // Block A: alle zehn Hüllennamen sind Fremdexporte, keiner steht in
    // EIGENE_MODELLE. Ein ZDO dafür wäre ein Geist — der Client bekäme es
    // zugestellt, fände kein Modell und zeichnete nichts, während die
    // Weltkarte weiter eine Marke auf eine unsichtbare Krypta setzte.
    // Verworfen: einen Platzhalter-Würfel spawnen. Das hätte die Welt mit
    // Kisten gepflastert, die niemand betreten kann.
    // Die Prüfung sitzt hier und nicht beim Aufrufer, weil beide Wege
    // (Zonen-Hook und Boot-Backfill) sowie der Admin-Befehl hier durchlaufen.
    if (!istEigenesModell(entrance.feature)) return false;
    this.hullSpawned.add(entrance.zoneKey);
    this.zdos.createZDO(getStableHash(entrance.feature), { ...entrance.pos });
    return true;
  }

  /** Hüllen für alle bekannten Eingänge (Serverstart, nach dem Weltladen). */
  spawnAllEntranceHulls(): number {
    let n = 0;
    let ohneModell = 0;
    for (const e of this.entrances.values()) {
      if (this.spawnEntranceHull(e)) n++;
      else if (!istEigenesModell(e.feature)) ohneModell++;
    }
    if (n > 0) console.log(`[Dungeon] ${n} entrance hull(s) spawned`);
    // Eine stille Null wäre hier die schlechtere Meldung: sie ließe offen,
    // ob die Registrierung leer ist oder die Hüllen mit Absicht ausbleiben.
    if (ohneModell > 0) {
      console.log(`[Dungeon] ${ohneModell} Eingangshülle(n) übersprungen — kein eigenes Modell`);
    }
    return n;
  }

  // ── Instances ────────────────────────────────────────────────────

  getInstance(dungeonId: string): DungeonInstance | undefined {
    return this.instances.get(dungeonId);
  }

  listInstances(): DungeonInstance[] {
    return [...this.instances.values()];
  }

  /** Get the live instance for a dungeon, materializing it on first use. */
  getOrCreateInstance(dungeonId: string): DungeonInstance | null {
    const existing = this.instances.get(dungeonId);
    if (existing) return existing;

    // 2.0 zuerst — die beiden Kartensätze sind disjunkt (die Weiche in
    // `load()`), die Reihenfolge ist also nur Lesbarkeit, kein Vorrang.
    // 2.0 first — the two maps are disjoint, so the order is readability.
    const doc2 = this.dokumente2.get(dungeonId);
    if (doc2) return this.instanz2Anlegen(doc2);

    let doc = this.documents.get(dungeonId);
    if (!doc) {
      // Lazy auto-document: an entrance carries the recipe (base+seed),
      // the document materializes on first enter.
      const entrance = [...this.entrances.values()].find((e) => e.dungeonId === dungeonId);
      if (entrance?.base) {
        const created = this.createGenerated(entrance.base, entrance.seed ?? 0, dungeonId);
        if (created) {
          created.name = `${entrance.feature} (${entrance.zoneKey})`;
          this.saveDocument(created);
          doc = created;
        }
      }
    }
    if (!doc) return null;

    const slot = this.freeSlots.pop() ?? this.nextSlot++;
    // Der Ursprung liegt im Ursprung. Eine eigene Welt braucht keinen
    // Sicherheitsabstand zu einer anderen — s. `DungeonInstance.origin`.
    const origin: Vector3 = { x: 0, y: 0, z: 0 };
    const welt = this.weltAnlegen(DungeonManager.weltId(dungeonId));

    const { zdoids, propZdoids } = this.materialize(doc.layout, doc, origin, welt.zdos);
    const instance: DungeonInstance = {
      dungeonId, welt, slot, origin, zdoids, propZdoids, players: new Set(),
    };
    this.instances.set(dungeonId, instance);
    console.log(
      `[Dungeon] Instance '${dungeonId}' materialized in world '${welt.id}': ` +
        `${doc.layout.rooms.length} rooms, ${zdoids.length} ZDOs`
    );
    return instance;
  }

  /**
   * Eine 2.0-Instanz anlegen (AP13).
   *
   * ALLES ab hier ist derselbe Weg wie für den Altbestand: Slot, Ursprung,
   * `weltAnlegen`, Eintrag in `instances`. Nur das Materialisieren ist ein
   * anderes — und genau darum geht es beim Wort „Adapter".
   * EVERYTHING from here on is the same path as for legacy: slot, origin,
   * `weltAnlegen`, entry in `instances`. Only the materialisation differs.
   */
  private instanz2Anlegen(doc: dungeon2.DungeonDokument2): DungeonInstance | null {
    const thema = dungeon2.themaFinden(doc.thema);
    if (thema === undefined) {
      console.warn(`[Dungeon] '${doc.id}': unbekanntes Thema '${doc.thema}' — keine Instanz`);
      return null;
    }
    const layout = dungeon2.layoutVonDokument2(doc);
    if (layout === null) {
      console.warn(`[Dungeon] '${doc.id}': Layout nicht herstellbar — keine Instanz`);
      return null;
    }
    // Der Server prüft SEIN Layout, bevor er darauf baut. Ein Grab mit
    // einem abgeschnittenen Raum ist unsichtbar kaputt — und es wäre der
    // Client, der es ausbadet, weil er dieselbe Rechnung noch einmal macht.
    // The server validates ITS layout before building on it.
    const fehler = dungeon2.nurFehler(dungeon2.validateLayout(layout));
    if (fehler.length > 0) {
      console.warn(
        `[Dungeon] '${doc.id}': ${fehler.length} Layout-Fehler ` +
          `(${fehler.slice(0, 3).map((f) => f.regel).join(', ')}) — keine Instanz`
      );
      return null;
    }
    // Die Prüfsumme des Dokuments gegen das eben Erzeugte. Geht das
    // auseinander, hat sich der Generator seit dem Anlegen des Dokuments
    // geändert — das ist eine stille Datenmigration, und sie soll laut sein.
    // Checksum of the document against what was just generated.
    const gerechnet = dungeon2.layoutPruefsumme(layout);
    if (gerechnet !== doc.pruefsumme) {
      console.warn(
        `[Dungeon] '${doc.id}': Prüfsumme abweichend (Dokument ${doc.pruefsumme}, ` +
          `erzeugt ${gerechnet}) — der Generator hat sich seit dem Anlegen geändert`
      );
    }

    const bau = dungeon2.baueGeometrie(layout);
    const slot = this.freeSlots.pop() ?? this.nextSlot++;
    const origin: Vector3 = { x: 0, y: 0, z: 0 };
    const welt = this.weltAnlegen(DungeonManager.weltId(doc.id));

    const erg = materialisiere2(bau, thema, origin, welt.zdos);
    const instance: DungeonInstance = {
      dungeonId: doc.id,
      welt,
      slot,
      origin,
      zdoids: erg.zdoids,
      propZdoids: erg.ankerZdoids,
      players: new Set(),
      layout2: layout,
      bau,
      ankerZuZdo: erg.ankerZuZdo,
    };
    this.instances.set(doc.id, instance);
    const ohne = erg.ohnePrefab.length;
    console.log(
      `[Dungeon] Instance '${doc.id}' (2.0) materialized in world '${welt.id}': ` +
        `${layout.stempel.length} stamps, ${bau.stuecke.length} pieces, ` +
        `${bau.nav.length} nav cells, ${erg.zdoids.length} ZDOs` +
        (ohne > 0 ? `, ${ohne} anchor(s) without a registered prefab` : '')
    );
    return instance;
  }

  /**
   * Die Deko-ZDOs einer LAUFENDEN 2.0-Instanz an ein neues Dokument
   * angleichen — das Gegenstück zu `dekoAngleichen()`, gleiche Bauform,
   * gleiches Ziel: Die Architektur bleibt stehen, der Spieler bleibt, wo er
   * ist, und sieht die Fackel erscheinen.
   * Align the decor ZDOs of a LIVE 2.0 instance with a new document.
   */
  private ankerAngleichen(instance: DungeonInstance, doc: dungeon2.DungeonDokument2): void {
    const thema = dungeon2.themaFinden(doc.thema);
    const layout = dungeon2.layoutVonDokument2(doc);
    if (thema === undefined || layout === null) return;

    const zdos = instance.welt.zdos;
    const weg = new Set(instance.propZdoids.map((id) => id.toString()));
    for (const id of instance.propZdoids) zdos.destroyZDO(id);
    instance.zdoids = instance.zdoids.filter((id) => !weg.has(id.toString()));

    // Neu gebaut wird NUR für die Anker — die Architektur bleibt die alte.
    // `baueGeometrie` ist rein und blockweise aufrufbar (W8), der zweite
    // Aufruf liefert also dieselben Plätze, wenn sich nichts geändert hat.
    // Only the anchors are rebuilt — the architecture stays as it was.
    const bau = dungeon2.baueGeometrie(layout);
    const erg = materialisiere2(bau, thema, instance.origin, zdos);
    instance.zdoids.push(...erg.zdoids);
    instance.propZdoids = erg.ankerZdoids;
    instance.ankerZuZdo = erg.ankerZuZdo;
    instance.layout2 = layout;
    instance.bau = bau;
  }

  /** Tear down a live instance (ZDOs destroyed, slot freed). */
  destroyInstance(dungeonId: string): boolean {
    const instance = this.instances.get(dungeonId);
    if (!instance) return false;
    // ERST die ZDOs einzeln zerstören, DANN die Welt wegwerfen: Das
    // Zerstören füllt die Zerstörungsliste ihres ZDO-Raums, und nur
    // darüber erfährt ein Client, der noch drinsteht, dass die Räume weg
    // sind. Wer die Welt zuerst aus der Karte nimmt, lässt ihn mit einem
    // Dungeon zurück, den es nicht mehr gibt.
    for (const zdoid of instance.zdoids) {
      instance.welt.zdos.destroyZDO(zdoid);
    }
    this.instances.delete(dungeonId);
    this.freeSlots.push(instance.slot);
    this.weltEntfernen(instance.welt.id);
    console.log(`[Dungeon] Instance '${dungeonId}' destroyed (${instance.zdoids.length} ZDOs)`);
    return true;
  }

  /**
   * ERSETZT (s. `LEGACY.md`) — wird nach Erfolg von Dungeon Generator 2.0
   * durch `BauErgebnis.spawnPunkt` abgeloest (design/ARCHITECTURE.md AP13,
   * `getSpawnPoint()` → `BauErgebnis.spawnPunkt`). Der Rest der Klasse
   * bleibt unveraendert.
   * REPLACED (see `LEGACY.md`) — will be superseded by
   * `BauErgebnis.spawnPunkt` once Dungeon Generator 2.0 succeeds
   * (design/ARCHITECTURE.md AP13). The rest of the class is unchanged.
   *
   * Spawn point inside an instance: 2 m from the entrance connector
   * (= instance origin) toward the start room center — independent of
   * connector orientation conventions.
   */
  getSpawnPoint(instance: DungeonInstance): Vector3 {
    // 2.0: der AUSDRÜCKLICHE Punkt aus dem Bauergebnis statt einer
    // Herleitung. Der Bauer weiß, wo der Boden der Eingangszelle liegt; die
    // Herleitung unten musste ihn aus der Richtung zum ersten Raum raten und
    // setzte y hart auf 0,5 — in einem Grab mit Ebenen ist das die falsche
    // Etage.
    // 2.0: the EXPLICIT point from the build result instead of a derivation.
    if (instance.bau) {
      const p = instance.bau.spawnPunkt;
      return {
        x: instance.origin.x + p.x,
        y: instance.origin.y + p.y,
        z: instance.origin.z + p.z,
      };
    }
    const doc = this.documents.get(instance.dungeonId);
    const start = doc?.layout.rooms[0];
    let dir = { x: 0, y: 0, z: 1 };
    if (start) {
      const len = Math.hypot(start.pos.x, start.pos.z);
      if (len > 0.01) dir = { x: start.pos.x / len, y: 0, z: start.pos.z / len };
    }
    return {
      x: instance.origin.x + dir.x * 2,
      y: instance.origin.y + 0.5,
      z: instance.origin.z + dir.z * 2,
    };
  }

  /**
   * ERSETZT (s. `LEGACY.md`) — wird nach Erfolg von Dungeon Generator 2.0
   * durch `Materialisierung2.ts` abgeloest (design/ARCHITECTURE.md AP13,
   * `materialize()` → `materialisiere2()`, ZDOs nur fuer Bewegliches/
   * Interaktives). Der Rest der Klasse bleibt unveraendert.
   * REPLACED (see `LEGACY.md`) — will be superseded by
   * `Materialisierung2.ts` once Dungeon Generator 2.0 succeeds
   * (design/ARCHITECTURE.md AP13). The rest of the class is unchanged.
   *
   * Materialize a layout at an origin: one static ZDO per room shell
   * (geometry + colliders come from the room GLB client-side), one ZDO per
   * net view (chests, spawners, torches, …) and per door.
   */
  private materialize(
    layout: DungeonLayout,
    doc: DungeonDocument,
    origin: Vector3,
    zdos: ZDOManager
  ): { zdoids: ZDOID[]; propZdoids: ZDOID[] } {
    const zdoids: ZDOID[] = [];
    const propZdoids: ZDOID[] = [];
    const spawned = flattenLayout(layout, doc.base);

    for (const item of spawned) {
      const pos = { x: origin.x + item.pos.x, y: origin.y + item.pos.y, z: origin.z + item.pos.z };
      const zdo = zdos.createZDO(item.prefabHash, pos, item.rot);
      zdoids.push(zdo.zdoid);
      if (item.kind === 'prop') propZdoids.push(zdo.zdoid);

      // Spawner erwachen: aus 'Spawner_Skeleton(_respawn_30)' wird beim
      // Materialisieren EINE Kreatur an Ort und Stelle (das Spawner-Piece
      // selbst bleibt als unsichtbarer Marker). Respawn-Zyklen später.
      if (item.kind === 'netView') {
        const kreatur = spawnerCreature(item.prefabName);
        if (kreatur !== null) {
          const c = zdos.createZDO(getStableHash(kreatur), { ...pos, y: pos.y + 0.2 }, item.rot);
          zdoids.push(c.zdoid);
        }
      }
    }
    return { zdoids, propZdoids };
  }

  /**
   * ERSETZT (s. `LEGACY.md`) — wird nach Erfolg von Dungeon Generator 2.0
   * durch `ankerAngleichen()` abgeloest (design/ARCHITECTURE.md AP13,
   * `dekoAngleichen()` → `ankerAngleichen()`). Der Rest der Klasse bleibt
   * unveraendert.
   * REPLACED (see `LEGACY.md`) — will be superseded by `ankerAngleichen()`
   * once Dungeon Generator 2.0 succeeds (design/ARCHITECTURE.md AP13). The
   * rest of the class is unchanged.
   *
   * Die Deko einer LAUFENDEN Instanz an ein neues Dokument angleichen.
   *
   * Alle Deko-ZDOs weg, alle neuen hin. Kein Vergleich Stück für Stück:
   * Es sind eine Handvoll ZDOs, das Zerstören füllt ohnehin die
   * Zerstörungsliste, über die der Client es erfährt, und ein Diff wäre
   * Code, den niemand je gegen den Ernstfall prüft.
   *
   * Die Räume bleiben stehen — und genau darum geht es: Der Spieler
   * bleibt, wo er ist, und sieht die Fackel erscheinen, statt in einer
   * neu gebauten Instanz aufzuwachen.
   */
  private dekoAngleichen(instance: DungeonInstance, doc: DungeonDocument): void {
    const zdos = instance.welt.zdos;
    const weg = new Set(instance.propZdoids.map((id) => id.toString()));
    for (const id of instance.propZdoids) zdos.destroyZDO(id);
    instance.zdoids = instance.zdoids.filter((id) => !weg.has(id.toString()));
    instance.propZdoids = [];

    for (const prop of doc.layout.props) {
      const pos = {
        x: instance.origin.x + prop.pos.x,
        y: instance.origin.y + prop.pos.y,
        z: instance.origin.z + prop.pos.z,
      };
      const zdo = zdos.createZDO(prop.prefabHash, pos, prop.rot);
      instance.zdoids.push(zdo.zdoid);
      instance.propZdoids.push(zdo.zdoid);
    }
  }

  /**
   * Regeneration (C++ TryRegenerateDungeon-Idee): leere Instanzen werden
   * nach DUNGEON_REGEN_INTERVAL_MS abgerissen — der nächste Besuch
   * materialisiert frisch (Loot/Kreaturen zurück). Periodisch aufrufen.
   */
  tick(now: number): void {
    for (const inst of [...this.instances.values()]) {
      if (inst.players.size > 0) {
        inst.zuletztBetreten = now;
        continue;
      }
      const alter = now - (inst.zuletztBetreten ?? now);
      if (alter > DUNGEON_REGEN_INTERVAL_MS) {
        this.destroyInstance(inst.dungeonId);
      }
    }
  }
}
