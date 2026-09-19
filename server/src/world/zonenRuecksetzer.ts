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
 * ── Woran man Streu-ZDOs erkennt: die Marke trägt ihre HERKUNFT ─────────
 * Die Streuung markiert jedes ZDO, das sie anlegt, mit `streu = <Kennung
 * der erzeugenden Zone>` (`markiereStreu`, aufgerufen von
 * `ZoneManager.generateZone` direkt nach der Streuung). Der Rücksetzer
 * nimmt einer Zone genau die Objekte weg, die SIE erzeugt hat, gleich wo
 * sie liegen.
 *
 * Warum nicht "was in der Zone liegt": Die Streuung arbeitet auf einer
 * Höhenkachel, deren Rand EINSCHLIESSLICH ist (x·64 ± 32). Ein Objekt
 * exakt auf der Kante gehört nach `worldToZone` der Nachbarzone, wurde
 * aber von dieser hier erzeugt. Nach Weltlage zugeordnet, verdoppelte es
 * sich oder ging verloren, je nachdem, welche der beiden Zonen zuerst
 * zurückgesetzt wird (Angriff 1, B1).
 *
 * Die Kennung ist eine gepackte Zahl >= 2 (`packeHerkunft`). Der Wert 1
 * bedeutet "Marke ohne Herkunft" — so schrieb eine frühere Fassung; sie ist
 * nie ausgerollt worden, wird aber wie eine fehlende Marke behandelt, statt
 * geraten zu werden.
 *
 * ── Zonen ohne Marke (Ersatzregel, nur auf ausdrücklichen Wunsch) ───────
 * Zonen aus der Zeit vor der Marke tragen keine. Für sie gilt ersatzweise
 * "Streu-Prefab, kein `layoutId`, kein `spieler`" (`istStreuVerdacht`). Ein
 * per `spawn` gesetzter Baum ist davon nicht zu unterscheiden. Deshalb
 * lehnt der Rücksetzer so eine Zone ab und nennt die Zahl der Objekte, die
 * die Ersatzregel träfe; erst `alt` erzwingt sie. Jedes so entfernte Objekt
 * steht (Prefab, Lage) im Protokoll.
 *
 * Objekte exakt auf der Kante einer solchen Zone fasst die Ersatzregel nicht
 * an: Ob diese oder die Nachbarzone sie erzeugt hat, ist ohne Marke nicht
 * zu wissen. Erzeugt die Neuerzeugung an derselben Stelle dasselbe Prefab,
 * war es das eigene — dann fällt das alte als Doppel weg.
 *
 * ── Was abgelehnt wird (und dann null Änderungen) ───────────────────────
 *  - Zone noch nicht erzeugt (die normale Erzeugung ist ohnehin frisch),
 *  - Zone mit gebuchtem Ort: eine Neuerzeugung setzte die Ort-ZDOs ein
 *    zweites Mal,
 *  - Zone mit Spielerspuren: ein ZDO mit `spieler` (typunabhängig, wie im
 *    Layout-Abgleich) oder Terraforming-Daten der Zone,
 *  - Zone ohne Marken, in der die Ersatzregel Objekte träfe (ohne `alt`).
 * Geprüft wird VOR dem ersten Löschen; eine abgelehnte Zone bleibt
 * unverändert.
 *
 * Beschädigte oder abgeerntete Pflanzen (`health`-Member) gelten nicht als
 * Spielerspur: Sie werden zurückgesetzt, die Rückmeldung nennt ihre Zahl.
 */

import {
  FOLIAGE_HASHES,
  HEALTH_MEMBER,
  HeightmapProvider,
  LAYOUT_ID_MEMBER,
  findPrefabByHash,
  getStableHash,
} from '@wov/shared';
import type { ZoneID } from '@wov/shared';
import type { ZDO } from '../zdo/ZDO.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import type { ZoneManager } from './ZoneManager.js';
import { istSpielerbau } from './layoutAbgleich.js';

/** Herkunftsmarke der Streuung (Int-Member: gepackte Kennung der erzeugenden Zone). */
export const STREU_MEMBER = 'streu';
const STREU_HASH = getStableHash(STREU_MEMBER);
const LAYOUT_ID_HASH = getStableHash(LAYOUT_ID_MEMBER);
const HEALTH_HASH = getStableHash(HEALTH_MEMBER);

/** Wert für "Marke ohne Herkunft" (Altform); gültige Kennungen sind >= 2. */
const MARKE_OHNE_HERKUNFT = 1;
const ZONEN_VERSATZ = 16384;
const ZONEN_SPANNE = 32768;

/** Größter Radius (in Zonen) je Aufruf: 5 → 11 × 11 = 121 Zonen. */
export const MAX_RADIUS_ZONEN = 5;

/** Kennung der erzeugenden Zone als Int32 (>= 2). Außerhalb ±16384 Zonen: Marke ohne Herkunft. */
export function packeHerkunft(zone: ZoneID): number {
  const a = zone.x + ZONEN_VERSATZ;
  const b = zone.y + ZONEN_VERSATZ;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return MARKE_OHNE_HERKUNFT;
  if (a < 0 || b < 0 || a >= ZONEN_SPANNE || b >= ZONEN_SPANNE) return MARKE_OHNE_HERKUNFT;
  return a * ZONEN_SPANNE + b + 2;
}

/** Die erzeugende Zone aus der Marke; `null` bei fehlender Marke, Altform (1) oder Unsinn. */
export function herkunftDerMarke(zdo: ZDO): ZoneID | null {
  const wert = zdo.getMember(STREU_HASH)?.value;
  if (typeof wert !== 'number' || !Number.isInteger(wert) || wert < 2) return null;
  const roh = wert - 2;
  return {
    x: Math.floor(roh / ZONEN_SPANNE) - ZONEN_VERSATZ,
    y: (roh % ZONEN_SPANNE) - ZONEN_VERSATZ,
  };
}

function stammtAusZone(zdo: ZDO, zone: ZoneID): boolean {
  const h = herkunftDerMarke(zdo);
  return h !== null && h.x === zone.x && h.y === zone.y;
}

/** Steht ein Layout-Schlüssel im ZDO (gleich welchen Typs)? Dann gehört es dem Dokument. */
function hatLayoutId(zdo: ZDO): boolean {
  return zdo.hasMember(LAYOUT_ID_HASH);
}

/** Trägt das ZDO irgendeine Streu-Marke (auch die Altform)? */
export function istMarkiertStreu(zdo: ZDO): boolean {
  return zdo.hasMember(STREU_HASH);
}

/*
  ACHTUNG, zwei verschiedene Zonenraster: Die Erzeugungszone (x, y) deckt
  die Welt um (x·64, y·64) MIT ±32 m ab (`HeightmapProvider.worldToZone`),
  die Sektoren des ZDO-Raums dagegen [x·64, (x+1)·64) (`floor(pos / 64)`).
  Eine Erzeugungszone liegt also auf vier ZDO-Sektoren, und was in
  `zdosInZone(zone)` steht, ist NICHT das, was diese Zone erzeugt hat.
  Alles hier arbeitet deshalb über die Weltlage der ZDOs oder die Herkunft.
*/

/** Halbe Kantenlänge der Erzeugungszone. */
const HALB = 32;

type Lage = 'innen' | 'rand' | 'aussen';

/** Innerhalb des offenen Quadrats, auf seiner Kante (einschließlich) oder draußen. */
function lageInZone(zdo: ZDO, zone: ZoneID): Lage {
  const dx = Math.abs(zdo.position.x - zone.x * 64);
  const dz = Math.abs(zdo.position.z - zone.y * 64);
  if (dx > HALB || dz > HALB) return 'aussen';
  return dx === HALB || dz === HALB ? 'rand' : 'innen';
}

/** Die ZDO-Sektoren, die das Rechteck der Erzeugungszone berühren, plus ein Sektor Rand. */
function sektoren(zone: ZoneID): ZoneID[] {
  const liste: ZoneID[] = [];
  for (let dy = -2; dy <= 1; dy++) {
    for (let dx = -2; dx <= 1; dx++) liste.push({ x: zone.x + dx, y: zone.y + dy });
  }
  return liste;
}

/** Alle ZDOs in den Sektoren um die Zone (Obermenge von allem, was sie erzeugt hat). */
function umfeld(zdos: ZDOManager, zone: ZoneID): ZDO[] {
  const treffer: ZDO[] = [];
  for (const sektor of sektoren(zone)) {
    for (const zdo of zdos.zdosInZone(sektor) ?? []) treffer.push(zdo);
  }
  return treffer;
}

/** Alle ZDOs, die im geschlossenen Quadrat der Erzeugungszone liegen (Kante eingeschlossen). */
export function zdosImKasten(zdos: ZDOManager, zone: ZoneID): ZDO[] {
  return umfeld(zdos, zone).filter((z) => lageInZone(z, zone) !== 'aussen');
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
 * weder ein Layout-Objekt noch ein Spielerbau ist, als Streu-ZDO dieser Zone.
 * Liefert die Zahl der Markierungen.
 */
export function markiereStreu(zdos: ZDOManager, zone: ZoneID, stand: readonly number[]): number {
  const herkunft = packeHerkunft(zone);
  let markiert = 0;
  sektoren(zone).forEach((z, i) => {
    const menge = zdos.zdosInZone(z);
    if (!menge) return;
    let index = 0;
    for (const zdo of menge) {
      if (index++ < stand[i]!) continue;
      if (hatLayoutId(zdo) || istSpielerbau(zdo)) continue;
      zdo.setInt(STREU_MEMBER, herkunft);
      markiert++;
    }
  });
  return markiert;
}

/** Ersatzregel für Zonen ohne Marke: Streu-Flora ohne Layout-Schlüssel und ohne Spielermarke. */
function istStreuVerdacht(zdo: ZDO): boolean {
  return FOLIAGE_HASHES.has(zdo.prefabHash) && !hatLayoutId(zdo) && !istSpielerbau(zdo);
}

export type ZonenStatus = 'neu-gestreut' | 'abgelehnt' | 'fehler';

export interface ZonenErgebnis {
  readonly zone: ZoneID;
  readonly status: ZonenStatus;
  /** Warum abgelehnt bzw. fehlgeschlagen (sonst leer). */
  readonly grund: string;
  /** Entfernte Streu-ZDOs (mit Marke der Zone plus per Ersatzregel). */
  readonly entfernt: number;
  /** Neu gestreute ZDOs (mit Marke dieser Zone). */
  readonly gestreut: number;
  /** Davon ohne Marke nach der Ersatzregel entfernt (steht einzeln im Protokoll). */
  readonly ersatzregel: number;
  /** Entfernte Pflanzen mit `health`-Member (angeschlagen oder abgeerntet). */
  readonly beschaedigt: number;
  /** Alte Kantenobjekte, die die Neuerzeugung als ihr eigenes Doppel erkannt und entfernt hat. */
  readonly kantenDoppel: number;
  readonly ms: number;
}

export interface RuecksetzOptionen {
  /** Ersatzregel für Zonen ohne Marke ausdrücklich erlauben (`alt`). */
  readonly alt?: boolean;
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
  /** Protokollzeile (Server-Log); Vorgabe `console.log`. */
  readonly protokoll?: (zeile: string) => void;
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
  if (zdosImKasten(kontext.zdos, zone).some(istSpielerbau)) return 'Spielerbau in der Zone';
  return null;
}

function beschreibe(zdo: ZDO): string {
  const name = findPrefabByHash(zdo.prefabHash)?.name ?? String(zdo.prefabHash);
  const p = zdo.position;
  return `${name} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
}

/** Setzt EINE Zone zurück. Wirft nicht; ein Fehler steht im Ergebnis. */
export function setzeZoneZurueck(
  kontext: RuecksetzKontext,
  zone: ZoneID,
  optionen: RuecksetzOptionen = {}
): ZonenErgebnis {
  const jetzt = kontext.jetzt ?? (() => performance.now());
  const protokoll = kontext.protokoll ?? ((zeile: string) => console.log(zeile));
  const start = jetzt();
  const fertig = (
    teil: Pick<ZonenErgebnis, 'status' | 'grund'> &
      Partial<
        Pick<ZonenErgebnis, 'entfernt' | 'gestreut' | 'ersatzregel' | 'beschaedigt' | 'kantenDoppel'>
      >
  ): ZonenErgebnis => ({
    zone,
    entfernt: 0,
    gestreut: 0,
    ersatzregel: 0,
    beschaedigt: 0,
    kantenDoppel: 0,
    ...teil,
    ms: Math.round((jetzt() - start) * 10) / 10,
  });

  const grund = ablehnungsGrund(kontext, zone);
  if (grund) return fertig({ status: 'abgelehnt', grund });

  // Eigene Objekte: nach HERKUNFT, gleich wo sie liegen (auch auf der Kante der Nachbarzone).
  const eigene = umfeld(kontext.zdos, zone).filter((z) => stammtAusZone(z, zone));
  // Ohne Herkunft (keine Marke, Altform 1): nur Verdacht, nur im geschlossenen Quadrat.
  const verdacht = zdosImKasten(kontext.zdos, zone).filter(
    (z) => herkunftDerMarke(z) === null && istStreuVerdacht(z)
  );
  const verdachtInnen = verdacht.filter((z) => lageInZone(z, zone) === 'innen');
  const verdachtRand = verdacht.filter((z) => lageInZone(z, zone) === 'rand');
  const alt = optionen.alt === true;

  if (!alt && eigene.length === 0 && verdachtInnen.length > 0) {
    return fertig({
      status: 'abgelehnt',
      grund:
        `Zone ohne Marken (vor der Marke erzeugt): die Ersatzregel träfe ${verdachtInnen.length} ` +
        `Objekt(e), darunter womöglich von Hand gesetzte; mit "alt" erzwingen`,
    });
  }

  const ersatz = alt ? verdachtInnen : [];
  const streu = [...eigene, ...ersatz];
  for (const zdo of ersatz) {
    protokoll(`[Zonen-Reset] Ersatzregel entfernt ${beschreibe(zdo)}, Zone ${zone.x},${zone.y}`);
  }
  const beschaedigt = streu.filter((z) => z.hasMember(HEALTH_HASH)).length;

  let entfernt = 0;
  for (const zdo of streu) {
    if (kontext.zdos.destroyZDO(zdo.zdoid)) entfernt++;
  }

  const stand = new Set(umfeld(kontext.zdos, zone));
  try {
    kontext.zones.nimmZoneZurueck(zone);
    kontext.zones.erzeugeZone(zone);
  } catch (err) {
    return fertig({
      status: 'fehler',
      grund: `Neuerzeugung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      entfernt,
      ersatzregel: ersatz.length,
      beschaedigt,
    });
  }

  // Alte Kantenobjekte ohne Marke: Steht an derselben Stelle jetzt dasselbe Prefab neu, war es das eigene.
  let kantenDoppel = 0;
  if (verdachtRand.length > 0 && (alt || eigene.length === 0)) {
    const neu = umfeld(kontext.zdos, zone).filter((z) => !stand.has(z) && stammtAusZone(z, zone));
    for (const alter of verdachtRand) {
      const doppel = neu.some(
        (n) =>
          n.prefabHash === alter.prefabHash &&
          n.position.x === alter.position.x &&
          n.position.z === alter.position.z
      );
      if (doppel && kontext.zdos.destroyZDO(alter.zdoid)) {
        kantenDoppel++;
        protokoll(
          `[Zonen-Reset] Kantenobjekt als Doppel der Neuerzeugung entfernt: ${beschreibe(alter)}, ` +
            `Zone ${zone.x},${zone.y}`
        );
      }
    }
  }

  const gestreut = umfeld(kontext.zdos, zone).filter((z) => stammtAusZone(z, zone)).length;
  return fertig({
    status: 'neu-gestreut',
    grund: '',
    entfernt,
    gestreut,
    ersatzregel: ersatz.length,
    beschaedigt,
    kantenDoppel,
  });
}

/**
 * Setzt das Quadrat der Zonen um (`zx`, `zy`) mit Halbseite `radius` zurück,
 * von innen nach außen. Der Radius wird auf `MAX_RADIUS_ZONEN` begrenzt.
 */
export function setzeZonenZurueck(
  kontext: RuecksetzKontext,
  zx: number,
  zy: number,
  radius: number,
  optionen: RuecksetzOptionen = {}
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
  return zonen.map((zone) => setzeZoneZurueck(kontext, zone, optionen));
}

/** Die Zeilen der Rückmeldung an den Admin: je Zone entfernt / neu gestreut / abgelehnt, mit ms. */
export function formatiereErgebnis(ergebnisse: readonly ZonenErgebnis[]): string {
  const zeilen = ergebnisse.map((e) => {
    const ort = `Zone ${e.zone.x},${e.zone.y}`;
    if (e.status === 'abgelehnt') return `${ort}: abgelehnt — ${e.grund} (${e.ms} ms)`;
    if (e.status === 'fehler') {
      return `${ort}: FEHLER — ${e.grund}; ${e.entfernt} entfernt (${e.ms} ms)`;
    }
    const zusatz: string[] = [];
    if (e.ersatzregel > 0) {
      zusatz.push(`${e.ersatzregel} ohne Marke nach Ersatzregel entfernt (einzeln im Server-Log)`);
    }
    if (e.beschaedigt > 0) zusatz.push(`${e.beschaedigt} beschädigte Pflanzen zurückgesetzt`);
    if (e.kantenDoppel > 0) zusatz.push(`${e.kantenDoppel} Kantendoppel entfernt`);
    const hinweis = zusatz.length > 0 ? `; ${zusatz.join('; ')}` : '';
    return `${ort}: ${e.entfernt} entfernt, ${e.gestreut} neu gestreut (${e.ms} ms)${hinweis}`;
  });
  const ok = ergebnisse.filter((e) => e.status === 'neu-gestreut').length;
  zeilen.push(`${ok} von ${ergebnisse.length} Zone(n) zurückgesetzt`);
  return zeilen.join('\n');
}

/**
 * Freigabe: nur wenn `WOV_INSTANZ` AUSDRÜCKLICH `dev` ist oder
 * `WOV_ZONEN_RUECKSETZER` genau `1`. Eine fehlende oder unlesbare Instanz
 * gibt den Befehl NICHT frei (bei einem zerstörenden Befehl schließt der
 * Zweifel), anders als der Rückfall in `instanzName()`.
 */
export function ruecksetzerErlaubt(
  instanz: string | undefined,
  umgebungsvariable: string | undefined
): boolean {
  return instanz === 'dev' || umgebungsvariable === '1';
}
