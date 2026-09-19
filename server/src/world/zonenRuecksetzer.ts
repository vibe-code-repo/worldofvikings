/**
 * Zonen-Rücksetzer — die Streuung ausgewählter, schon erzeugter Zonen neu
 * würfeln, ohne etwas anderes anzufassen.
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────
 * Eine Zone wird beim ersten Betreten erzeugt und ist danach eingefroren
 * (`ZoneManager.generated`). Dreht der Designer am Bewuchs einer Region,
 * betrifft das nur Zonen, die noch niemand betreten hat. Der einzige Weg,
 * die übrigen nachzuziehen, war bisher der ganze Spielstand.
 *
 * ── Woran man Streu-ZDOs erkennt ────────────────────────────────────────
 * Die Streuung markiert jedes ZDO, das sie anlegt, mit `streu = 1`
 * (`markiereStreu`, aufgerufen von `ZoneManager.generateZone` direkt nach
 * der Streuung). Nur diese ZDOs nimmt der Rücksetzer weg. Spielerbauten,
 * Layout-Platzierungen, Kreaturen und per Adminbefehl gesetzte Objekte
 * tragen die Marke nicht und bleiben stehen.
 *
 * GRENZE: Zonen, die vor dieser Änderung erzeugt wurden, tragen keine
 * Marke. Für sie gilt ersatzweise "Prefab ist Streu-Flora, kein `layoutId`,
 * kein `spieler`" (`istStreuVerdacht`). Ein per `spawn` gesetzter Baum in
 * so einer Zone ist davon nicht zu unterscheiden und wird mit entfernt.
 * Sobald eine Zone einmal zurückgesetzt wurde, ist sie markiert und die
 * Grenze entfällt für sie. Eine Zone, in der die Streuung nichts anlegt
 * (kahle Insel), trägt nie eine Marke und fällt deshalb immer auf die
 * Ersatzregel zurück.
 *
 * ── Was abgelehnt wird (und dann null Änderungen) ───────────────────────
 *  - Zone noch nicht erzeugt (die normale Erzeugung ist ohnehin frisch),
 *  - Zone mit gebuchtem Ort: eine Neuerzeugung setzte die Ort-ZDOs ein
 *    zweites Mal,
 *  - Zone mit Spielerspuren: ein ZDO mit `spieler` (typunabhängig, wie im
 *    Layout-Abgleich) oder Terraforming-Daten der Zone.
 * Geprüft wird VOR dem ersten Löschen; eine abgelehnte Zone bleibt
 * unverändert.
 */

import {
  FOLIAGE_HASHES,
  HeightmapProvider,
  LAYOUT_ID_MEMBER,
  getStableHash,
} from '@wov/shared';
import type { ZoneID } from '@wov/shared';
import type { ZDO } from '../zdo/ZDO.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import type { ZoneManager } from './ZoneManager.js';

/** Herkunftsmarke der Streuung (Int-Member, 1 = von der Streuung angelegt). */
export const STREU_MEMBER = 'streu';
const STREU_HASH = getStableHash(STREU_MEMBER);
const LAYOUT_ID_HASH = getStableHash(LAYOUT_ID_MEMBER);
const SPIELER_HASH = getStableHash('spieler');

/** Größter Radius (in Zonen) je Aufruf: 5 → 11 × 11 = 121 Zonen. */
export const MAX_RADIUS_ZONEN = 5;

/**
 * Trägt das ZDO ein `spieler`-Member mit dem Wert 1? Typunabhängig: ein
 * Spielerbau bleibt einer, auch wenn die Zahl als Float, Long oder Text
 * abgelegt wurde (gleiche Regel wie `istSpielerbau` im Layout-Abgleich).
 */
function hatSpielerMarke(zdo: ZDO): boolean {
  const wert = zdo.getMember(SPIELER_HASH)?.value;
  if (typeof wert === 'number') return wert === 1;
  if (typeof wert === 'bigint') return wert === 1n;
  if (typeof wert === 'string') return wert.trim() === '1';
  return false;
}

/** Steht ein Layout-Schlüssel im ZDO (gleich welchen Typs)? Dann gehört es dem Dokument. */
function hatLayoutId(zdo: ZDO): boolean {
  return zdo.hasMember(LAYOUT_ID_HASH);
}

/** Trägt das ZDO die Herkunftsmarke der Streuung? */
export function istMarkiertStreu(zdo: ZDO): boolean {
  return zdo.hasMember(STREU_HASH);
}

/**
 * ACHTUNG, zwei verschiedene Zonenraster: Die Erzeugungszone (x, y) deckt
 * die Welt um (x·64, y·64) MIT ±32 m ab (`HeightmapProvider.worldToZone`),
 * die Sektoren des ZDO-Raums dagegen [x·64, (x+1)·64) (`floor(pos / 64)`).
 * Eine Erzeugungszone liegt also auf vier ZDO-Sektoren, und was in
 * `zdosInZone(zone)` steht, ist NICHT das, was diese Zone erzeugt hat.
 * Alles hier arbeitet deshalb über die Weltlage der ZDOs.
 *
 * Liegt die Weltlage im Rechteck der Erzeugungszone?
 */
function liegtInZone(zdo: ZDO, zone: ZoneID): boolean {
  return (
    HeightmapProvider.worldToZone(zdo.position.x) === zone.x &&
    HeightmapProvider.worldToZone(zdo.position.z) === zone.y
  );
}

/** Die ZDO-Sektoren, die das Rechteck der Erzeugungszone berühren, plus ein Sektor Rand. */
function sektoren(zone: ZoneID): ZoneID[] {
  const liste: ZoneID[] = [];
  for (let dy = -2; dy <= 1; dy++) {
    for (let dx = -2; dx <= 1; dx++) liste.push({ x: zone.x + dx, y: zone.y + dy });
  }
  return liste;
}

/** Alle ZDOs, deren Weltlage in der Erzeugungszone liegt. */
export function zdosDerZone(zdos: ZDOManager, zone: ZoneID): ZDO[] {
  const treffer: ZDO[] = [];
  for (const sektor of sektoren(zone)) {
    for (const zdo of zdos.zdosInZone(sektor) ?? []) {
      if (liegtInZone(zdo, zone)) treffer.push(zdo);
    }
  }
  return treffer;
}

/**
 * Merkt sich, wie viele ZDOs in den Sektoren um `zone` schon stehen.
 * Die Sektormengen halten die Einfügereihenfolge, alles, was danach kommt,
 * steht also hinter dieser Zahl — ein Vorher/Nachher-Vergleich ohne Kopie.
 */
export function zdoStand(zdos: ZDOManager, zone: ZoneID): number[] {
  return sektoren(zone).map((z) => zdos.zdosInZone(z)?.size ?? 0);
}

/**
 * Markiert alles, was seit `stand` in den Sektoren um die Zone dazugekommen ist und
 * weder ein Layout-Objekt noch ein Spielerbau ist, als Streu-ZDO.
 * Liefert die Zahl der Markierungen.
 */
export function markiereStreu(zdos: ZDOManager, zone: ZoneID, stand: readonly number[]): number {
  let markiert = 0;
  sektoren(zone).forEach((z, i) => {
    const menge = zdos.zdosInZone(z);
    if (!menge) return;
    let index = 0;
    for (const zdo of menge) {
      if (index++ < stand[i]!) continue;
      if (hatLayoutId(zdo) || hatSpielerMarke(zdo)) continue;
      zdo.setInt(STREU_MEMBER, 1);
      markiert++;
    }
  });
  return markiert;
}

/** Ersatzregel für Zonen ohne Marke: Streu-Flora ohne Layout-Schlüssel und ohne Spielermarke. */
function istStreuVerdacht(zdo: ZDO): boolean {
  return FOLIAGE_HASHES.has(zdo.prefabHash) && !hatLayoutId(zdo) && !hatSpielerMarke(zdo);
}

export type ZonenStatus = 'neu-gestreut' | 'abgelehnt' | 'fehler';

export interface ZonenErgebnis {
  readonly zone: ZoneID;
  readonly status: ZonenStatus;
  /** Warum abgelehnt bzw. fehlgeschlagen (sonst leer). */
  readonly grund: string;
  /** Entfernte Streu-ZDOs. */
  readonly entfernt: number;
  /** Neu gestreute ZDOs (mit Marke). */
  readonly gestreut: number;
  /** Ohne Marke erkannt (Ersatzregel) — nur für Zonen aus der Zeit vor der Marke. */
  readonly ersatzregel: boolean;
  readonly ms: number;
}

/** Alles, was der Rücksetzer von der Welt braucht. */
export interface RuecksetzKontext {
  readonly zdos: ZDOManager;
  readonly heightmaps: Pick<HeightmapProvider, 'getTerrainComp'>;
  readonly zones: Pick<
    ZoneManager,
    'isZoneGenerated' | 'getFeatureInstance' | 'nimmZoneZurueck' | 'erzeugeZone'
  >;
  /** Zeitquelle in Millisekunden; die Tests liefern eine feste. */
  readonly jetzt?: () => number;
}

/** Grund, aus dem eine Zone nicht zurückgesetzt wird — oder `null`, wenn nichts dagegen spricht. */
export function ablehnungsGrund(kontext: RuecksetzKontext, zone: ZoneID): string | null {
  if (!kontext.zones.isZoneGenerated(zone)) {
    return 'Zone ist noch nicht erzeugt (die normale Erzeugung ist ohnehin frisch)';
  }
  if (kontext.zones.getFeatureInstance(zone)) {
    return 'in der Zone steht ein Ort; eine Neuerzeugung setzte seine Objekte doppelt';
  }
  const comp = kontext.heightmaps.getTerrainComp(zone.x, zone.y);
  if (comp && !comp.isEmpty) return 'Terraforming in der Zone';
  if (zdosDerZone(kontext.zdos, zone).some(hatSpielerMarke)) return 'Spielerbau in der Zone';
  return null;
}

/** Setzt EINE Zone zurück. Wirft nicht; ein Fehler steht im Ergebnis. */
export function setzeZoneZurueck(kontext: RuecksetzKontext, zone: ZoneID): ZonenErgebnis {
  const jetzt = kontext.jetzt ?? (() => performance.now());
  const start = jetzt();
  const fertig = (
    teil: Pick<ZonenErgebnis, 'status' | 'grund'> &
      Partial<Pick<ZonenErgebnis, 'entfernt' | 'gestreut' | 'ersatzregel'>>
  ): ZonenErgebnis => ({
    zone,
    entfernt: 0,
    gestreut: 0,
    ersatzregel: false,
    ...teil,
    ms: Math.round((jetzt() - start) * 10) / 10,
  });

  const grund = ablehnungsGrund(kontext, zone);
  if (grund) return fertig({ status: 'abgelehnt', grund });

  const menge = zdosDerZone(kontext.zdos, zone);
  const markiert = menge.filter(istMarkiertStreu);
  const ersatzregel = markiert.length === 0;
  const streu = ersatzregel ? menge.filter(istStreuVerdacht) : markiert;

  let entfernt = 0;
  for (const zdo of streu) {
    if (kontext.zdos.destroyZDO(zdo.zdoid)) entfernt++;
  }

  try {
    kontext.zones.nimmZoneZurueck(zone);
    kontext.zones.erzeugeZone(zone);
  } catch (err) {
    return fertig({
      status: 'fehler',
      grund: `Neuerzeugung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      entfernt,
      ersatzregel,
    });
  }

  const gestreut = zdosDerZone(kontext.zdos, zone).filter(istMarkiertStreu).length;
  return fertig({ status: 'neu-gestreut', grund: '', entfernt, gestreut, ersatzregel });
}

/**
 * Setzt das Quadrat der Zonen um (`zx`, `zy`) mit Halbseite `radius` zurück,
 * von innen nach außen. Der Radius wird auf `MAX_RADIUS_ZONEN` begrenzt.
 */
export function setzeZonenZurueck(
  kontext: RuecksetzKontext,
  zx: number,
  zy: number,
  radius: number
): ZonenErgebnis[] {
  const r = Math.min(Math.max(0, Math.floor(radius)), MAX_RADIUS_ZONEN);
  const zonen: ZoneID[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) zonen.push({ x: zx + dx, y: zy + dy });
  }
  zonen.sort(
    (a, b) =>
      Math.max(Math.abs(a.x - zx), Math.abs(a.y - zy)) -
      Math.max(Math.abs(b.x - zx), Math.abs(b.y - zy))
  );
  return zonen.map((zone) => setzeZoneZurueck(kontext, zone));
}

/** Die Zeilen der Rückmeldung an den Admin: je Zone entfernt / neu gestreut / abgelehnt, mit ms. */
export function formatiereErgebnis(ergebnisse: readonly ZonenErgebnis[]): string {
  const zeilen = ergebnisse.map((e) => {
    const ort = `Zone ${e.zone.x},${e.zone.y}`;
    if (e.status === 'abgelehnt') return `${ort}: abgelehnt — ${e.grund} (${e.ms} ms)`;
    if (e.status === 'fehler') {
      return `${ort}: FEHLER — ${e.grund}; ${e.entfernt} entfernt (${e.ms} ms)`;
    }
    const hinweis = e.ersatzregel ? ' [ohne Marke erkannt: auch Adminbäume möglich]' : '';
    return `${ort}: ${e.entfernt} entfernt, ${e.gestreut} neu gestreut (${e.ms} ms)${hinweis}`;
  });
  const ok = ergebnisse.filter((e) => e.status === 'neu-gestreut').length;
  zeilen.push(`${ok} von ${ergebnisse.length} Zone(n) zurückgesetzt`);
  return zeilen.join('\n');
}

/** Erlaubt nur auf der Dev-Instanz oder mit `WOV_ZONEN_RUECKSETZER=1`. */
export function ruecksetzerErlaubt(
  instanz: string,
  umgebungsvariable: string | undefined
): boolean {
  return instanz === 'dev' || umgebungsvariable === '1';
}
