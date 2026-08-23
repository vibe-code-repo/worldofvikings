/**
 * Die geöffnete Truhe — eine animierte Kopie anstelle der Thin Instance.
 *
 * ── Warum es diesen Umweg braucht ────────────────────────────────────
 * Truhen werden als THIN INSTANCES gezeichnet: ein Master, ein
 * Matrixpuffer für alle Truhen der Welt. Das ist der Grund, warum eine
 * Insel voller Kisten nicht in Zeichenaufrufen ertrinkt — und zugleich
 * der Grund, warum eine einzelne davon sich nicht bewegen kann. Ein
 * Deckel, der aufgeht, ist eine Bewegung je Instanz.
 *
 * Der Ausweg ist derselbe, den andere Spiele nehmen: Solange EINE Truhe
 * offen ist, tritt an ihre Stelle eine echte, vollständige Kopie
 * (`AssetManager.instantiate`), die ihre Animation aus dem GLB abspielt.
 * Die Thin Instance wird solange verborgen
 * (`EntityManager.setzeInstanzVerborgen`), sonst stünden zwei Deckel
 * ineinander.
 *
 * Der Preis ist ein Zeichenaufruf mehr, und zwar nur, solange jemand
 * hineinsieht. Bei geschlossenen Truhen ändert sich nichts.
 *
 * ── Warum die Animation im GLB liegt ─────────────────────────────────
 * `tools/truhe-generieren.py` legt den Deckel als eigenen Knoten mit der
 * Drehachse auf der hinteren Oberkante an und schreibt einen Clip
 * `oeffnen` (18 Bilder, 102°) ins GLB. Der AssetManager lädt
 * Animationsgruppen ohnehin, und der Avatar spielt seine so ab. Eine
 * handgeschriebene Drehung hier wäre ein zweiter Weg für dieselbe Sache
 * gewesen — und zwei Wege laufen auseinander.
 *
 * ── Was bewusst NICHT passiert ───────────────────────────────────────
 * Die Collider bleiben unberührt. Man soll nicht durch eine offene Truhe
 * hindurchlaufen können, nur weil ihr Bild gerade aus einer anderen
 * Quelle kommt.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AssetManager } from '../engine/AssetManager';
import type { EntityManager } from './EntityManager';

/** Prefab- und Modellname der Truhe. */
const TRUHE = 'HolzTruhe';
/** Name des Clips im GLB. */
const CLIP = 'oeffnen';
/**
 * Wie lange die Schließbewegung laufen darf, bevor die Kopie entsorgt
 * wird (ms). Etwas mehr als die 0,75 s der Animation — lieber ein
 * Wimpernschlag zu spät als ein Deckel, der beim Zuklappen verschwindet.
 */
const SCHLIESSDAUER_MS = 900;

export class OffeneTruhe {
  private wurzel: TransformNode | null = null;
  private zdoKey: string | null = null;
  /** Läuft, solange die Schließbewegung noch spielt. */
  private schliessUhr: number | null = null;
  /**
   * Wird gesetzt, während `instantiate()` noch lädt. Kommt in der
   * Zwischenzeit ein Schließen, darf die fertige Kopie nicht mehr
   * auftauchen — sonst bleibt ein offener Deckel im Feld stehen.
   */
  private erwartet: string | null = null;

  constructor(
    private readonly assets: AssetManager,
    private readonly entities: EntityManager
  ) {}

  /**
   * Öffnet die Truhe mit diesem ZDO-Schlüssel (`userId:id`).
   *
   * Mehrfaches Aufrufen für dieselbe Truhe ist harmlos — der Server
   * schickt bei jedem Umschichten ein neues ContainerSync, und der Deckel
   * soll davon nicht neu aufspringen.
   */
  async oeffne(zdoKey: string): Promise<void> {
    if (this.zdoKey === zdoKey && this.wurzel) return;
    await this.schliesseSofort();

    const pos = this.entities.instanzPosition(zdoKey);
    if (!pos) return; // Truhe nicht (mehr) im Streamingfenster.

    this.erwartet = zdoKey;
    const wurzel = await this.assets.instantiate(TRUHE);
    // Während des Ladens kann längst wieder geschlossen worden sein.
    if (!wurzel || this.erwartet !== zdoKey) {
      wurzel?.dispose(false, true);
      return;
    }

    wurzel.position.set(pos.x, pos.y, pos.z);
    this.wurzel = wurzel;
    this.zdoKey = zdoKey;
    this.entities.setzeInstanzVerborgen(zdoKey, true);
    this.assets.spieleEinmal(wurzel, CLIP, false);
  }

  /** Schließt die offene Truhe, falls eine offen ist. */
  schliesse(): void {
    this.erwartet = null;
    const wurzel = this.wurzel;
    const key = this.zdoKey;
    if (!wurzel || !key) return;

    // Rückwärts abspielen und die Kopie erst danach entsorgen, damit man
    // den Deckel zufallen sieht.
    const laeuft = this.assets.spieleEinmal(wurzel, CLIP, true);
    this.wurzel = null;
    this.zdoKey = null;

    const aufraeumen = (): void => {
      this.schliessUhr = null;
      this.assets.entsorgeAnimationen(wurzel);
      wurzel.dispose(false, true);
      this.entities.setzeInstanzVerborgen(key, false);
    };

    if (!laeuft) {
      aufraeumen();
      return;
    }
    if (this.schliessUhr !== null) window.clearTimeout(this.schliessUhr);
    this.schliessUhr = window.setTimeout(aufraeumen, SCHLIESSDAUER_MS);
  }

  /** Ohne Bewegung wegräumen — beim Wechsel auf eine andere Truhe. */
  private async schliesseSofort(): Promise<void> {
    this.erwartet = null;
    if (this.schliessUhr !== null) {
      window.clearTimeout(this.schliessUhr);
      this.schliessUhr = null;
    }
    const wurzel = this.wurzel;
    const key = this.zdoKey;
    this.wurzel = null;
    this.zdoKey = null;
    if (wurzel) {
      this.assets.entsorgeAnimationen(wurzel);
      wurzel.dispose(false, true);
    }
    if (key) this.entities.setzeInstanzVerborgen(key, false);
  }

  /** Beim Verbindungsabbruch: nichts stehen lassen. */
  dispose(): void {
    void this.schliesseSofort();
  }
}
