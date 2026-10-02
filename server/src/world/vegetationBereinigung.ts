/**
 * Bereinigung gespeicherter Streu-Objekte (`WorldLayout.vegetationEntfernt`, Karte Bäume entfernen V2).
 * Cleanup of saved scatter objects (removed-vegetation circles, step V2).
 *
 * V1 hält die Streuung NEUER Zonen aus den Kreisen heraus (Nachfilter in `ZoneManager.populateFoliage`). Eine Zone,
 * die schon erzeugt und gespeichert ist, ist aber eingefroren: ihre Bäume sind ZDOs im Spielstand. Dieses Modul
 * löscht sie, beim Boot und live.
 *
 * ── Was gelöscht wird ──────────────────────────────────────────────────────────────────────────────────────
 * Nur ein ZDO, auf das ALLES zutrifft:
 *   - Prefab aus der Streu-Flora (`FOLIAGE`), Marke `streu` (die Herkunft der Streuung, `zonenRuecksetzer.ts`),
 *   - ohne `layoutId` (von Hand gesetzt, gehört dem Dokument), ohne `spieler` (Spielerbau),
 *   - Lage im Kreis (Rand zählt dazu), `nur: 'baeume'` beachtet (`streuArt`).
 * Der Weg ist `ZDOManager.destroyZDO`, derselbe wie beim Fällen: er trägt das Entfernen in die Löschliste, die an
 * die Clients geht.
 *
 * ── Zonen ohne Marke ───────────────────────────────────────────────────────────────────────────────────────
 * Zonen aus der Zeit vor der Marke tragen keine. Dort ist ein Streu-Baum nicht von einem früher von Hand gesetzten
 * (ohne `layoutId`) zu unterscheiden. Sie werden NICHT geräumt: `ungemarkt` zählt die Kandidaten (Streu-Flora im
 * Kreis, ohne Marke, ohne `layoutId`, ohne `spieler`), `zonenOhneMarke` die Zonen, in denen sie stehen.
 *
 * ── Obergrenze live (je Kreis) ─────────────────────────────────────────────────────────────────────────────
 * `VEGETATION_LIVE_MAX` = 20 000 Objekte je Abgleich. Gemessen an der Dichte der Streuung (rund 95 Objekte je Zone
 * von 64 × 64 m, kuratierte Probewelt) räumen 20 000 etwa 210 volle Zonen, also ein Gebiet von 14 × 14 Zonen
 * (900 × 900 m), und ein einzelner Kreis (50 m) trifft höchstens 200. Das Löschen selbst kostet Mikrosekunden je
 * ZDO; teuer ist die Löschliste, die als ein Paket an alle Clients geht: 20 000 Kennungen sind rund 400 KB.
 * Die Grenze gilt je Abgleich, entschieden wird JE KREIS: Ein Kreis, dessen (noch nicht beanspruchte) Treffer nicht
 * mehr in das Restbudget passen, wird ganz abgelehnt und nie teilweise gelöscht (ein halb geräumter Kreis wäre nicht
 * zu erklären); die übrigen Kreise laufen. Ein allein zu großer Kreis blockiert so keinen späteren kleinen. Der
 * abgelehnte Kreis gilt nicht als geräumt; die Quittung nennt die Zahl. Beim nächsten Neustart räumt der Boot (ohne
 * Obergrenze) alles.
 *
 * ── Live: nur hinzugekommene Kreise ────────────────────────────────────────────────────────────────────────
 * Ein entfernter Kreis (Rückgängig) bringt in schon erzeugten Zonen nichts zurück: Die ZDOs sind weg, und die
 * Streuung läuft dort nicht noch einmal. Das ist Absicht. In noch nicht erzeugten Zonen gilt einfach der neue Stand
 * (`ZoneManager.setzeVegetationEntfernt`).
 */

import {
  FOLIAGE,
  HeightmapProvider,
  getStableHash,
  sanitizeVegetationEntfernt,
  streuArt,
  vegetationPruefer,
  vegetationProblem,
  LAYOUT_ID_MEMBER,
  type StreuArt,
  type VegetationEntferntKreis,
  type VegetationProblem,
  type WorldLayout,
} from '@wov/shared';
import type { ZDO } from '../zdo/ZDO.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import type { ZoneManager } from './ZoneManager.js';
import { istSpielerbau } from './layoutAbgleich.js';
import { istMarkiertStreu } from './zonenRuecksetzer.js';

/** Mehr gelöschte Objekte in einem Live-Abgleich werden abgelehnt (Begründung im Kopf). */
export const VEGETATION_LIVE_MAX = 20_000;

const LAYOUT_ID_HASH = getStableHash(LAYOUT_ID_MEMBER);

/** Prefab-Hash → Art, einmal aus der Streu-Flora. */
const ART_JE_HASH: ReadonlyMap<number, StreuArt> = new Map(FOLIAGE.map((f) => [f.prefabHash, streuArt(f.prefabName)]));

export interface BereinigungsOptionen {
  /**
   * Obergrenze gelöschter ZDOs je Aufruf, entschieden JE KREIS: Ein Kreis, dessen (noch nicht beanspruchte) Treffer
   * nicht mehr in das Restbudget passen, wird ganz abgelehnt, nie teilweise gelöscht; alle übrigen Kreise laufen.
   * Ohne Angabe: keine Grenze (Boot).
   */
  readonly grenze?: number;
  /** Nur zählen, nichts löschen. */
  readonly trocken?: boolean;
}

export interface BereinigungsErgebnis {
  /** Gelöschte ZDOs (bei `trocken`: 0). */
  readonly geloescht: number;
  /** Treffer, die gelöscht würden bzw. wurden (nur die der angenommenen Kreise). */
  readonly anzahl: number;
  /** Erzeugungszonen mit mindestens einem Treffer. */
  readonly zonen: number;
  /** Streu-Flora im Kreis ohne Marke (ohne `layoutId`, ohne `spieler`): nicht gelöscht, nur gezählt. */
  readonly ungemarkt: number;
  /** Erzeugungszonen mit mindestens einem ungemarkten Kandidaten. */
  readonly zonenOhneMarke: number;
  /** Zahl der Kreise, die geprüft wurden. */
  readonly kreise: number;
  /** Kreise, die wegen der Obergrenze ganz abgelehnt wurden (nichts aus ihnen gelöscht). */
  readonly abgelehnteKreise: readonly VegetationEntferntKreis[];
  /** Objekte der abgelehnten Kreise, die stehen blieben: jedes einmal, ohne die, die ein angenommener Kreis räumte. */
  readonly abgelehntObjekte: number;
  readonly ms: number;
}

const zonenKey = (zdo: ZDO): string => `${HeightmapProvider.worldToZone(zdo.position.x)},${HeightmapProvider.worldToZone(zdo.position.z)}`;

/** Rasterzelle für die Zuordnung der Treffer zu den Kreisen (je Kreis nur die Zellen seiner Umgebung). */
const ZELLE = 32;
const zellenKey = (ix: number, iz: number): string => `${ix},${iz}`;

interface Treffer {
  readonly zdo: ZDO;
  readonly art: StreuArt;
}

/**
 * Löscht die gespeicherten Streu-ZDOs in den Kreisen (Regeln im Kopf). Die Kreise werden hier nicht geprüft:
 * `vegetationPruefer` nimmt nur gültige auf; ungültige Kreise (die der Sanitizer nie durchlässt) wirken nicht.
 */
export function bereinigeVegetation(
  zdos: ZDOManager,
  kreise: readonly VegetationEntferntKreis[],
  optionen: BereinigungsOptionen = {}
): BereinigungsErgebnis {
  const t0 = performance.now();
  const pruefer = vegetationPruefer(kreise);
  const fertig = (
    geloescht: number,
    gewaehlt: readonly Treffer[],
    ungemarkt: number,
    zonenOhneMarke: Set<string>,
    abgelehnteKreise: readonly VegetationEntferntKreis[],
    abgelehntObjekte: number
  ): BereinigungsErgebnis => ({
    geloescht,
    anzahl: gewaehlt.length,
    zonen: new Set(gewaehlt.map((t) => zonenKey(t.zdo))).size,
    ungemarkt,
    zonenOhneMarke: zonenOhneMarke.size,
    kreise: kreise.length,
    abgelehnteKreise,
    abgelehntObjekte,
    ms: performance.now() - t0,
  });
  if (pruefer.leer) return fertig(0, [], 0, new Set(), [], 0);
  const treffer: Treffer[] = [];
  let ungemarkt = 0;
  const zonenOhneMarke = new Set<string>();
  for (const [hash, art] of ART_JE_HASH) {
    for (const zdo of zdos.getZDOByPrefab(hash)) {
      // Von Hand gesetzt (`layoutId`, gleich welchen Typs) oder Spielerbau: nie.
      if (zdo.hasMember(LAYOUT_ID_HASH) || istSpielerbau(zdo)) continue;
      if (!pruefer.istEntfernt(zdo.position.x, zdo.position.z, art)) continue;
      if (!istMarkiertStreu(zdo)) {
        ungemarkt++;
        zonenOhneMarke.add(zonenKey(zdo));
        continue;
      }
      treffer.push({ zdo, art });
    }
  }
  const grenze = optionen.grenze;
  let gewaehlt: Treffer[] = treffer;
  const abgelehnteKreise: VegetationEntferntKreis[] = [];
  let abgelehntObjekte = 0;
  const abgelehnt = new Set<Treffer>();
  if (grenze !== undefined) {
    // Je Kreis ganz oder gar nicht, in der Reihenfolge des Dokuments: Die Treffer eines Kreises, die nicht mehr in das
    // Restbudget passen, lehnen den ganzen Kreis ab. Ein allein zu großer Kreis blockiert so keinen späteren kleinen.
    const raster = new Map<string, Treffer[]>();
    for (const t of treffer) {
      const key = zellenKey(Math.floor(t.zdo.position.x / ZELLE), Math.floor(t.zdo.position.z / ZELLE));
      const zelle = raster.get(key);
      if (zelle) zelle.push(t);
      else raster.set(key, [t]);
    }
    const genommen = new Set<Treffer>();
    for (const k of kreise) {
      if (vegetationPruefer([k]).leer) continue;
      const hier: Treffer[] = [];
      for (let ix = Math.floor((k.x - k.r) / ZELLE); ix <= Math.floor((k.x + k.r) / ZELLE); ix++) {
        for (let iz = Math.floor((k.z - k.r) / ZELLE); iz <= Math.floor((k.z + k.r) / ZELLE); iz++) {
          for (const t of raster.get(zellenKey(ix, iz)) ?? []) {
            if (genommen.has(t) || (k.nur === 'baeume' && t.art !== 'baum')) continue;
            const dx = t.zdo.position.x - k.x;
            const dz = t.zdo.position.z - k.z;
            if (dx * dx + dz * dz <= k.r * k.r) hier.push(t);
          }
        }
      }
      if (genommen.size + hier.length > grenze) {
        abgelehnteKreise.push(k);
        for (const t of hier) abgelehnt.add(t);
      } else for (const t of hier) genommen.add(t);
    }
    gewaehlt = treffer.filter((t) => genommen.has(t));
    // Jedes Objekt zählt einmal (überlappende abgelehnte Kreise), und was ein späterer, angenommener Kreis doch räumt, steht nicht mehr.
    for (const t of abgelehnt) if (!genommen.has(t)) abgelehntObjekte++;
  }
  if (optionen.trocken) return fertig(0, gewaehlt, ungemarkt, zonenOhneMarke, abgelehnteKreise, abgelehntObjekte);
  let geloescht = 0;
  for (const t of gewaehlt) if (zdos.destroyZDO(t.zdo.zdoid)) geloescht++;
  return fertig(geloescht, gewaehlt, ungemarkt, zonenOhneMarke, abgelehnteKreise, abgelehntObjekte);
}

/** Eine Logzeile mit den Zählern (Boot und live, gleiches Format). */
export function bereinigungsZeile(wo: string, e: BereinigungsErgebnis): string {
  const teile = [`${e.geloescht} gelöscht in ${e.zonen} Zone(n)`, `${e.kreise} Kreis(e)`, `${e.ms.toFixed(1)} ms`];
  if (e.abgelehnteKreise.length > 0) teile.push(`${e.abgelehnteKreise.length} Kreis(e) mit ${e.abgelehntObjekte} Objekten über der Obergrenze NICHT geräumt`);
  if (e.ungemarkt > 0) teile.push(`${e.ungemarkt} ungemarkte Kandidaten in ${e.zonenOhneMarke} Zone(n) ohne Marke NICHT gelöscht`);
  return `[WoV] Vegetation (${wo}): ${teile.join(', ')}`;
}

/**
 * Beim Boot, einmal, nach dem Laden der gespeicherten Zonen und dem Abgleich des Layouts: räumt die Kreise des
 * Dokuments. Ist `vegetationEntfernt` beschädigt (`vegetationProblem`), geht der Boot weiter: nichts wird gelöscht,
 * das Problem steht im Log. Wirft nie.
 */
export function bereinigeBeimBoot(
  zdos: ZDOManager,
  dokument: unknown,
  log: { log: (t: string) => void; warn: (t: string) => void; error: (t: string) => void } = console
): BereinigungsErgebnis | VegetationProblem | null {
  // Stand „zuletzt geräumt“: leer, bis das Räumen gelungen ist (beschädigtes Feld, Fehler ⇒ leer).
  geraeumt.set(zdos, []);
  try {
    const roh = (dokument as { vegetationEntfernt?: unknown } | null)?.vegetationEntfernt;
    const problem = vegetationProblem(roh);
    if (problem) {
      const gezeigt = problem.fehlerhaft
        .slice(0, 5)
        .map((f) => `${f.eintrag}.${f.feld}`)
        .join(', ');
      log.error(
        `[WoV] Vegetation (Boot): vegetationEntfernt beschädigt (${problem.reason === 'limit' ? `${problem.anzahl} Kreise, Grenze ${problem.grenze}` : `${problem.fehlerhaft.length} fehlerhafte Angabe(n): ${gezeigt}`}) — ` +
          `NICHTS gelöscht, die Welt startet weiter; Kreise in der Weltdatei korrigieren`
      );
      return problem;
    }
    const kreise = sanitizeVegetationEntfernt(roh);
    if (kreise.length === 0) return null;
    const e = bereinigeVegetation(zdos, kreise);
    geraeumt.set(zdos, kreise);
    (e.ungemarkt > 0 ? log.warn : log.log)(bereinigungsZeile('Boot', e));
    return e;
  } catch (fehler) {
    log.error(`[WoV] Vegetation (Boot): Bereinigung fehlgeschlagen: ${(fehler as Error).message}`);
    return null;
  }
}

/**
 * Stand „zuletzt geräumt“ je ZDO-Raum: die Kreise, deren Objekte dieser Server wirklich geräumt hat. Der Vegetationsast
 * vergleicht gegen DIESEN Stand, nicht gegen das zuletzt angewendete Dokument der Wache: Ein Boot mit beschädigtem Feld
 * hat nichts geräumt (Stand leer), obwohl der Sanitizer die gültigen Kreise im Dokument behält; nach der Reparatur
 * räumt der erste Live-Abgleich deshalb ALLE Kreise. Ein wegen der Obergrenze abgelehnter Kreis kommt nicht hinein.
 */
const geraeumt = new WeakMap<ZDOManager, readonly VegetationEntferntKreis[]>();

/** Die Kreise von `neu`, die `alt` nicht hat (als Mehrfachmenge, Reihenfolge von `neu`). */
export function hinzugekommeneKreise(
  alt: readonly VegetationEntferntKreis[] | undefined,
  neu: readonly VegetationEntferntKreis[] | undefined
): VegetationEntferntKreis[] {
  const schluessel = (k: VegetationEntferntKreis): string => `${k.x}|${k.z}|${k.r}|${k.nur ?? ''}`;
  const vorhanden = new Map<string, number>();
  for (const k of alt ?? []) vorhanden.set(schluessel(k), (vorhanden.get(schluessel(k)) ?? 0) + 1);
  const neue: VegetationEntferntKreis[] = [];
  for (const k of neu ?? []) {
    const s = schluessel(k);
    const n = vorhanden.get(s) ?? 0;
    if (n > 0) vorhanden.set(s, n - 1);
    else neue.push(k);
  }
  return neue;
}

/** Ob sich die Kreise zwischen zwei Ständen überhaupt geändert haben (auch ein entfernter Kreis zählt). */
export function kreiseGeaendert(alt: WorldLayout, neu: WorldLayout): boolean {
  return JSON.stringify(alt.vegetationEntfernt ?? []) !== JSON.stringify(neu.vegetationEntfernt ?? []);
}

export type VegetationLive =
  | { art: 'unveraendert' }
  /** `ergebnis.abgelehnteKreise`: Kreise über der Obergrenze, ganz abgelehnt und nicht als geräumt vermerkt. */
  | { art: 'ok'; ergebnis: BereinigungsErgebnis };

/** `liste` ohne die `entfernen` (als Mehrfachmenge, gleicher Schlüssel wie `hinzugekommeneKreise`). */
function ohneKreise(liste: readonly VegetationEntferntKreis[], entfernen: readonly VegetationEntferntKreis[]): VegetationEntferntKreis[] {
  const rest = hinzugekommeneKreise(entfernen, liste); // liste \ entfernen
  return rest;
}

/**
 * Der Live-Ast (eigener Ast der Layout-Wache, KEINE Geo-Änderung und nicht gegen `AENDERUNGEN_MAX`):
 * räumt die Kreise von `neu`, die gegenüber dem Stand „zuletzt geräumt“ (`geraeumt`, Vorgabe ohne Boot: das
 * Dokument `alt` beim ersten Aufruf) hinzugekommen sind, und setzt den Prüfer des `ZoneManager` auf den neuen Stand
 * (auch wenn nur ein Kreis entfernt wurde: neue Zonen gelten nach dem neuen Stand).
 *
 * Die Obergrenze gilt je Abgleich, entschieden wird je Kreis (`bereinigeVegetation`): Ein zu großer Kreis wird ganz
 * abgelehnt und NICHT als geräumt vermerkt, die übrigen Kreise laufen. Der Aufrufer macht davon den übrigen Abgleich
 * nicht abhängig (Platzierungen laufen weiter). `trocken`: nur zählen, nichts ändern.
 *
 * Der Aufrufer fragt auch dann, wenn sich das Dokument sonst nicht geändert hat: Weicht „zuletzt geräumt“ von den
 * gültigen Kreisen des Dokuments ab (Boot mit beschädigtem Eintrag, der danach gestrichen wurde), wird geräumt.
 */
export function vegetationLive(
  kontext: { zdos: ZDOManager; zones: Pick<ZoneManager, 'setzeVegetationEntfernt'> },
  alt: WorldLayout,
  neu: WorldLayout,
  trocken: boolean
): VegetationLive {
  let stand = geraeumt.get(kontext.zdos);
  if (!stand) {
    // Ohne Boot-Stand (Tests ohne Spielserver): Vorgabe ist der Stand des Dokuments, einmal festgehalten.
    stand = alt.vegetationEntfernt ?? [];
    geraeumt.set(kontext.zdos, stand);
  }
  const jetzt = neu.vegetationEntfernt ?? [];
  if (JSON.stringify(stand) === JSON.stringify(jetzt)) return { art: 'unveraendert' };
  const neue = hinzugekommeneKreise(stand, jetzt);
  const e = bereinigeVegetation(kontext.zdos, neue, { grenze: VEGETATION_LIVE_MAX, trocken });
  if (!trocken) {
    kontext.zones.setzeVegetationEntfernt(neu.vegetationEntfernt);
    geraeumt.set(kontext.zdos, ohneKreise(jetzt, e.abgelehnteKreise));
  }
  return { art: 'ok', ergebnis: e };
}
