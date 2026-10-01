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
 * ── Obergrenze live ────────────────────────────────────────────────────────────────────────────────────────
 * `VEGETATION_LIVE_MAX` = 20 000 Objekte je Abgleich. Gemessen an der Dichte der Streuung (rund 95 Objekte je Zone
 * von 64 × 64 m, kuratierte Probewelt) räumen 20 000 etwa 210 volle Zonen, also ein Gebiet von 14 × 14 Zonen
 * (900 × 900 m), und ein einzelner Kreis (50 m) trifft höchstens 200. Das Löschen selbst kostet Mikrosekunden je
 * ZDO; teuer ist die Löschliste, die als ein Paket an alle Clients geht: 20 000 Kennungen sind rund 400 KB.
 * Darüber wird abgelehnt (`zuViele`), nichts teilweise gelöscht: ein halb geräumter Streifen wäre nicht zu erklären,
 * und die Kreise wirken beim nächsten Neustart ohnehin (Boot, ohne Obergrenze).
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
  /** Höchstens so viele ZDOs löschen; darüber `zuViele` und nichts gelöscht. Ohne Angabe: keine Grenze (Boot). */
  readonly grenze?: number;
  /** Nur zählen, nichts löschen. */
  readonly trocken?: boolean;
}

export interface BereinigungsErgebnis {
  /** `zuViele`: mehr Treffer als `grenze`, nichts gelöscht (`geloescht` = 0, `anzahl` = die Trefferzahl). */
  readonly art: 'ok' | 'zuViele';
  /** Gelöschte ZDOs (bei `trocken` und bei `zuViele`: 0). */
  readonly geloescht: number;
  /** Treffer, die gelöscht würden bzw. wurden. */
  readonly anzahl: number;
  /** Erzeugungszonen mit mindestens einem Treffer. */
  readonly zonen: number;
  /** Streu-Flora im Kreis ohne Marke (ohne `layoutId`, ohne `spieler`): nicht gelöscht, nur gezählt. */
  readonly ungemarkt: number;
  /** Erzeugungszonen mit mindestens einem ungemarkten Kandidaten. */
  readonly zonenOhneMarke: number;
  /** Zahl der Kreise, die geprüft wurden. */
  readonly kreise: number;
  readonly ms: number;
}

const zonenKey = (zdo: ZDO): string => `${HeightmapProvider.worldToZone(zdo.position.x)},${HeightmapProvider.worldToZone(zdo.position.z)}`;

/**
 * Löscht die gespeicherten Streu-ZDOs in den Kreisen (Regeln im Kopf). Die Kreise werden hier nicht geprüft:
 * `vegetationPruefer` nimmt nur gültige auf.
 */
export function bereinigeVegetation(
  zdos: ZDOManager,
  kreise: readonly VegetationEntferntKreis[],
  optionen: BereinigungsOptionen = {}
): BereinigungsErgebnis {
  const t0 = performance.now();
  const pruefer = vegetationPruefer(kreise);
  const leer = (art: BereinigungsErgebnis['art'] = 'ok'): BereinigungsErgebnis => ({
    art,
    geloescht: 0,
    anzahl: 0,
    zonen: 0,
    ungemarkt: 0,
    zonenOhneMarke: 0,
    kreise: kreise.length,
    ms: performance.now() - t0,
  });
  if (pruefer.leer) return leer();
  const treffer: ZDO[] = [];
  let ungemarkt = 0;
  const zonenGetroffen = new Set<string>();
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
      treffer.push(zdo);
      zonenGetroffen.add(zonenKey(zdo));
    }
  }
  const grenze = optionen.grenze;
  const ergebnis = (art: BereinigungsErgebnis['art'], geloescht: number): BereinigungsErgebnis => ({
    art,
    geloescht,
    anzahl: treffer.length,
    zonen: zonenGetroffen.size,
    ungemarkt,
    zonenOhneMarke: zonenOhneMarke.size,
    kreise: kreise.length,
    ms: performance.now() - t0,
  });
  if (grenze !== undefined && treffer.length > grenze) return ergebnis('zuViele', 0);
  if (optionen.trocken) return ergebnis('ok', 0);
  let geloescht = 0;
  for (const zdo of treffer) if (zdos.destroyZDO(zdo.zdoid)) geloescht++;
  return ergebnis('ok', geloescht);
}

/** Eine Logzeile mit den Zählern (Boot und live, gleiches Format). */
export function bereinigungsZeile(wo: string, e: BereinigungsErgebnis): string {
  const teile = [`${e.geloescht} gelöscht in ${e.zonen} Zone(n)`, `${e.kreise} Kreis(e)`, `${e.ms.toFixed(1)} ms`];
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
  /** `trocken`: so viele ZDOs würden gelöscht. Sonst: so viele wurden gelöscht. */
  | { art: 'ok'; ergebnis: BereinigungsErgebnis }
  | { art: 'zuViele'; anzahl: number };

/**
 * Der Live-Ast (eigener Ast der Layout-Wache, KEINE Geo-Änderung und nicht gegen `AENDERUNGEN_MAX`):
 * räumt die Kreise von `neu`, die gegenüber dem Stand „zuletzt geräumt“ (`geraeumt`, Vorgabe ohne Boot: das
 * Dokument `alt` beim ersten Aufruf) hinzugekommen sind, und setzt den Prüfer des `ZoneManager` auf den neuen Stand (auch wenn nur ein
 * Kreis entfernt wurde: neue Zonen gelten nach dem neuen Stand).
 *
 * Über der Obergrenze (`zuViele`) wird NICHTS gelöscht, der Prüfer neuer Zonen aber trotzdem gesetzt, und der Stand
 * „zuletzt geräumt“ bleibt: Der Aufrufer muss davon den übrigen Abgleich nicht abhängig machen (Platzierungen laufen
 * weiter), nur die Vegetation bleibt ungeräumt, bis der Kreis kleiner wird oder der Neustart sie räumt.
 * `trocken`: nur zählen, nichts ändern.
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
  if (!trocken) kontext.zones.setzeVegetationEntfernt(neu.vegetationEntfernt);
  if (e.art === 'zuViele') return { art: 'zuViele', anzahl: e.anzahl };
  if (!trocken) geraeumt.set(kontext.zdos, jetzt);
  return { art: 'ok', ergebnis: e };
}
