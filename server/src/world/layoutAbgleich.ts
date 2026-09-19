/**
 * layoutAbgleich — gleicht die handplatzierten Objekte des WorldLayouts
 * (Editor-Spawn) mit den ZDOs der Welt ab.
 *
 * Aus `WovServer.spawnLayoutPlacements` herausgezogen, damit sich der
 * Abgleich ohne einen ganzen Server testen lässt (Kontext-Parameter statt
 * `this`). Was hier steht, läuft beim BOOT, nachdem der Spielstand geladen
 * und die Kreaturen adoptiert sind: So erscheinen neue Platzierungen auch in
 * bereits generierten Zonen.
 *
 * ── Der Soll-Stempel ─────────────────────────────────────────────────
 * Jedes Layout-ZDO trägt den Member `layoutSoll`: einen Fingerabdruck der
 * Dokumentwerte, die zuletzt angewendet wurden (x, z, yaw, Skalierung), und
 * die Bodenhöhe an der Dokumentposition zu diesem Zeitpunkt. Damit weiß der
 * Abgleich, WAS SICH GEÄNDERT HAT, statt bei jedem Boot alles auf das
 * Dokument zurückzusetzen:
 *
 *   - Fingerabdruck == Stempel: Der Designer hat nichts geändert. Position,
 *     Drehung und Skalierung gehören jetzt dem Server und dem Spiel — ein
 *     Dorfbewohner, der weggewandert ist, bleibt dort, ein Objekt, das der
 *     Server bewusst 3 m über dem Boden hält, bleibt dort. Nur die
 *     Bodenhöhe wird nachgeführt, und auch nur bei einem Objekt, das noch
 *     genau auf der gestempelten Höhe steht (also von niemandem bewegt
 *     wurde).
 *   - Fingerabdruck != Stempel: Der Designer hat gedreht, skaliert oder
 *     verschoben. Die Dokumentwerte werden angewendet und neu gestempelt.
 *     Ein Wesen, das ein Server-System bewegt (wandernder NPC, Boss), wird
 *     dabei samt seinem Wander-Anker an die neue Stelle gesetzt.
 *   - Kein Stempel (Spielstand von vor dem Stempel): Ein bewegtes Wesen wird
 *     NICHT versetzt, nur gestempelt — sein Zustand ist der von damals. Ein
 *     statisches Objekt wird einmal an das Dokument angeglichen.
 */

import type { PlacementDef, RouteDef, WorldLayout } from '@wov/shared';
import {
  HEALTH_MEMBER,
  TRUHE_INHALT_MEMBER,
  TRUHE_LOOTED_MEMBER,
  LAYOUT_ID_MEMBER,
  getStableHash,
  istNpcPrefab,
  layoutKennung,
  maxLeben,
  yawQuaternion,
} from '@wov/shared';
import type { ZDO } from '../zdo/ZDO.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';

/** ZDO-Member mit dem Soll-Stempel (s. Kopfkommentar). */
export const LAYOUT_SOLL_MEMBER = 'layoutSoll';
const SOLL_HASH = getStableHash(LAYOUT_SOLL_MEMBER);
const LAYOUT_ID_HASH = getStableHash(LAYOUT_ID_MEMBER);

/**
 * Toleranzen, unterhalb derer der Abgleich NICHTS schreibt. Jede Änderung
 * hebt die ZDO-Revision und schickt das Objekt erneut an alle Peers im
 * Umkreis; ein Boot mit unverändertem Dokument soll deshalb null Revisionen
 * bewegen (Gleitkomma-Rauschen der Bodenhöhe eingeschlossen).
 */
const TOLERANZ = {
  /** Meter in x/z — unter der 1-mm-Grenze, auf die das Dokument rechnet. */
  lage: 5e-4,
  /** Meter in y — wie beim Nachsetzen der Vegetation. */
  hoehe: 0.05,
  /** Skalierung, wie beim Erzeugen (kein Member unter 1 ± 1e-3). */
  skala: 1e-3,
  /** 1 - |Skalarprodukt| der Quaternionen: 1e-9 sind rund 0,005 Grad. */
  drehung: 1e-9,
  /** Meter, um die sich der Boden an der Dokumentposition ändern muss. */
  boden: 0.05,
  /** Meter in x/z und y, bis zu denen ein Objekt noch „auf seinem Platz" steht. */
  stehtNoch: 0.05,
  /** Nähe (m), ab der eine Platzierung ein gleichartiges ZDO übernimmt. */
  naehe: 0.5,
  /** Meter, bis zu denen zwei Platzierungen mit gleicher Kennung EIN Objekt sind (1 cm). */
  gleicherOrt: 0.01,
  /** Meter um eine Platzierung mit unbekanntem Prefab, in denen ZDOs geschont werden. */
  schonzone: 1.0,
} as const;

const SKALA_MEMBER = 'scaleScalar';
const SKALA_HASH = getStableHash(SKALA_MEMBER);

const SPIELER_HASH = getStableHash('spieler');

/**
 * Member, in denen ein Exemplar ZUSTAND trägt, den das Dokument nicht
 * zurückbringt: Truheninhalt, „Erstbefüllung schon geschehen", Trefferpunkte
 * (bei Bäumen der Ernte-Zähler) und der Türzustand. Was der Abgleich selbst
 * schreibt oder ableitet (`layoutId`, `layoutSoll`, `scaleScalar`) und die
 * Animation zählen nicht: Sie sind Dokument bzw. Deko.
 */
const ZUSTANDS_HASHES: readonly number[] = [
  TRUHE_INHALT_MEMBER,
  TRUHE_LOOTED_MEMBER,
  HEALTH_MEMBER,
  'state',
].map(getStableHash);

/** Wie viel Zustand am Exemplar hängt: die Zahl der vorhandenen Zustands-Member. */
function zustand(zdo: ZDO): number {
  return ZUSTANDS_HASHES.filter((h) => zdo.hasMember(h)).length;
}

/**
 * Spielerbauten gehören dem Spieler, nicht dem Dokument.
 *
 * Die Marke `spieler=1` schreibt der Server als Int (`handlePlacePiece`).
 * Gelesen wird sie hier ohne Blick auf den Member-TYP: Ein Spielstand, in dem
 * sie als Float, Long oder Text steht, ist trotzdem ein Spielerbau — `getInt`
 * lieferte für ihn 0, und der Abgleich hätte ihn übernommen und verschoben.
 */
function istSpielerbau(zdo: ZDO): boolean {
  const wert = zdo.getMember(SPIELER_HASH)?.value;
  if (typeof wert === 'number') return wert === 1;
  if (typeof wert === 'bigint') return wert === 1n;
  if (typeof wert === 'string') return wert.trim() === '1';
  return false;
}

/**
 * Läuft diese Platzierung eine Route? Nur dann, wenn die Route im Dokument
 * auch steht — ein unbekannter Name lässt die Figur stehen (s. Abgleich).
 * Ein solcher NPC ist beim Boot IRGENDWO auf seiner Runde: Position, Höhe
 * und Blickrichtung gehören dem Läufer, nicht dem Dokument.
 */
function laeuftRoute(layout: WorldLayout, p: PlacementDef): boolean {
  return p.route !== undefined && (layout.routes ?? []).some((r) => r.id === p.route);
}

/** Skalierung, wie sie im ZDO stehen soll: 0 = kein Member (Prefab-Vorgabe). */
function sollSkala(p: PlacementDef): number {
  return p.scale !== undefined && Math.abs(p.scale - 1) > TOLERANZ.skala ? p.scale : 0;
}

/** Was der Designer an einer Platzierung ändern kann (und was der Stempel festhält). */
function fingerabdruck(p: PlacementDef): string {
  return `${p.x},${p.z},${p.yaw ?? 0},${sollSkala(p)}`;
}

interface Stempel {
  readonly fingerabdruck: string;
  /** Bodenhöhe an der Dokumentposition zum Zeitpunkt des Anwendens. */
  readonly boden: number;
}

function stempelText(fp: string, boden: number): string {
  return `${fp}@${boden.toFixed(3)}`;
}

/** null: kein (oder ein unlesbarer) Stempel — Zustand aus einem Spielstand von vor dem Stempel. */
function liesStempel(zdo: ZDO): Stempel | null {
  const roh = zdo.getString(LAYOUT_SOLL_MEMBER);
  const i = roh.lastIndexOf('@');
  if (i < 0 || i === roh.length - 1) return null;
  const boden = Number(roh.slice(i + 1));
  return Number.isFinite(boden) ? { fingerabdruck: roh.slice(0, i), boden } : null;
}

/**
 * Spielerbauten von einer veralteten Layout-Kennung befreien (Kennung und
 * Stempel ab) und die Zahl zurückgeben. Das ist kein Löschen: der Bau bleibt,
 * wo er ist. Läuft auch dort, wo der Server sonst nichts anfasst (unlesbares
 * `placements`), damit ein Spielstand von einem Server, der Spielerbauten per
 * Nähe übernahm, seine doppelten Kennungen nicht bis zum nächsten sauberen
 * Boot behält.
 */
export function befreieSpielerbauten(zdos: ZDOManager): number {
  let n = 0;
  for (const zdo of zdos.getAllZDOs()) {
    if (!zdo.getString(LAYOUT_ID_MEMBER) || !istSpielerbau(zdo)) continue;
    zdo.removeMember(LAYOUT_ID_HASH);
    zdo.removeMember(SOLL_HASH);
    n++;
  }
  return n;
}

/** Alles, was der Abgleich von der Welt braucht. */
export interface LayoutAbgleichKontext {
  readonly zdos: ZDOManager;
  readonly prefabs: { getByName(name: string): { readonly hash: number } | undefined };
  /** Geländehöhe der Hauptwelt (getGroundHeight) — IMMER die Quelle des y. */
  readonly bodenHoehe: (x: number, z: number) => number;
  /**
   * Höhe, mit der ein Prefab über dem Boden steht (Vegetation:
   * `groundOffset`), sonst 0. Dieselbe Zahl, mit der der Server beim Laden
   * nachsetzt — sonst risse der Abgleich Bäume wieder auf den Boden, die
   * das Nachsetzen gerade angehoben hat.
   */
  readonly bodenAbstand: (prefabHash: number) => number;
  /**
   * Übergibt einen Routen-NPC an den Läufer. Der Aufrufer nimmt ihn dabei
   * auch aus der Kreatur-Simulation, sonst zerren Wander-KI und Route an
   * derselben Position.
   */
  readonly anRoute: (zdo: ZDO, route: RouteDef) => void;
  /**
   * Bewegt ein Server-System dieses ZDO von sich aus (wandernder NPC,
   * Boss, Kreatur der Spawn-Tabelle)? Dann gehört seine Lage nach dem
   * ersten Stempel dem Server, nicht dem Dokument.
   */
  readonly wirdBewegt: (zdo: ZDO) => boolean;
  /**
   * Setzt den Wander-Anker eines bewegten Wesens auf seine AKTUELLE
   * Position. Der Abgleich ruft es, nachdem er das Wesen versetzt hat —
   * sonst liefe es zu seiner alten Wandergegend zurück.
   */
  readonly verankere: (zdo: ZDO) => void;
}

/** Zahlen des Abgleichs — die Logzeile und der Test lesen sie. */
export interface LayoutAbgleichErgebnis {
  gespawnt: number;
  /** ZDOs, bei denen der Abgleich mindestens einen Wert geschrieben hat. */
  aktualisiert: number;
  /** Gefundene ZDOs, die schon stimmten — es wurde nichts geschrieben. */
  unveraendert: number;
  entfernt: number;
  unbekannt: number;
  aufRoute: number;
  /** Spielerbauten, denen eine veraltete Kennung abgenommen wurde. */
  freigegeben: number;
  /** Kennungen neuer Platzierungen, die genau über einem fremden Spielerbau stehen. */
  ueberSpielerbau: string[];
  /** ZDOs, die über die Zahl der verschiedenen Platzierungen ihrer Kennung hinaus da waren, und entfernt wurden. */
  ueberzaehlig: number;
  /** Jedes überzählig entfernte ZDO: Id, Kennung und Zahl der Zustands-Member (für das Log). */
  ueberzaehligeZdos: { id: string; kennung: string; member: number }[];
  /**
   * Gesetzt, wenn der Sanitizer Einträge des Dokuments verworfen hat: Dieser
   * Boot löscht dann KEIN Layout-ZDO (s. `layoutAbgleich`).
   * `stehenGeblieben` sind die ZDOs, die ein löschender Boot entfernt hätte.
   */
  ohneLoeschen: { verworfen: number; stehenGeblieben: number } | null;
  /**
   * Platzierungen, deren Prefab die Registry nicht kennt. Sie erzeugen nie ein
   * ZDO. Die ZDOs, die zu ihnen gehören könnten (gleiche Kennung oder im
   * Umkreis von 1 m), bleiben unangetastet: `geschont` zählt sie.
   */
  unbekanntePrefabs: { kennung: string; prefab: string; geschont: number }[];
}

/**
 * Handplatzierte Objekte des WorldLayouts materialisieren.
 *
 * Idempotent über eine Kennung im ZDO-Member `layoutId`, ersatzweise eine
 * Nähe-Prüfung (gleiches Prefab < 0,5 m) — persistente ZDOs aus dem Save
 * werden nicht dupliziert. Entfernt werden ZDOs, deren Eintrag der
 * Designer gelöscht hat (auch der letzte: ein Dokument ohne Platzierungen
 * räumt alle Layout-ZDOs ab).
 *
 * Zwei Schutzregeln, getrennt nach Ursache:
 *   - Hat der Sanitizer Einträge des Dokuments VERWORFEN (roh != gültig), ist
 *     das nur durch Handarbeit an der Datei erreichbar (Editor und MCP
 *     schreiben sanitisiert): Dann löscht dieser Boot KEIN Layout-ZDO —
 *     ein unlesbarer Eintrag ist vielleicht nur unlesbar und nicht gelöscht,
 *     und sein ZDO trägt Zustand, den das Dokument nicht zurückbringt.
 *   - Ein UNBEKANNTES Prefab (Tippfehler im Freitextfeld des Editors, ein aus
 *     der Registry gefallenes Prefab) ist im Normalbetrieb erreichbar und
 *     sperrt deshalb nicht die Welt: Es erzeugt nie ein ZDO, und geschont
 *     werden nur die ZDOs, die zu ihm gehören könnten (gleiche Kennung oder
 *     im Umkreis von 1 m seiner Position). Alles andere räumt normal ab.
 *
 * Eine Kennung führt so viele ZDOs, wie es VERSCHIEDENE Platzierungen mit ihr
 * gibt: Zwei Platzierungen im selben Meter, die mehr als 1 cm auseinander
 * liegen, sind zwei Objekte. Positionsgleiche Duplikate (<= 1 cm) teilen sich
 * ein ZDO (das entscheidet K1.1). Jede Platzierung bekommt das nächste noch
 * freie ZDO ihrer Kennung; fehlt eines, entsteht ein neues. Überzählig ist
 * nur, was darüber hinausgeht.
 *
 * Ein gefundenes ZDO wird an das Dokument ANGEGLICHEN, soweit sich das
 * Dokument geändert hat (Soll-Stempel, s. Kopfkommentar): Drehung,
 * Skalierung und Position. Ohne das wäre jede Änderung im Editor, die die
 * Kennung (Prefab + auf Meter gerundete Position) nicht ändert, nach dem
 * Neustart unsichtbar.
 *
 * Spielerbauten (`spieler=1`) gehören dem Spieler: Sie werden weder
 * gefunden noch verschoben noch entfernt. Trägt einer noch eine Kennung
 * (Zustand von einem Server, der Spielerbauten per Nähe übernahm), wird
 * sie ihm abgenommen — es darf nie zwei ZDOs mit derselben Kennung geben.
 *
 * Hier werden auch die Routen verdrahtet: Trägt eine Platzierung eine
 * `route`, übernimmt der RoutenLaeufer die ZDO (s. dort).
 */
export function layoutAbgleich(
  kontext: LayoutAbgleichKontext,
  layout: WorldLayout,
  /** `verworfen`: Einträge, die der Sanitizer aus dem rohen Dokument gestrichen hat. */
  optionen: { verworfen?: number } = {}
): LayoutAbgleichErgebnis {
  const { zdos } = kontext;
  const placements = layout.placements ?? [];
  const ergebnis: LayoutAbgleichErgebnis = {
    gespawnt: 0,
    aktualisiert: 0,
    unveraendert: 0,
    entfernt: 0,
    unbekannt: 0,
    aufRoute: 0,
    freigegeben: 0,
    ueberSpielerbau: [],
    ueberzaehlig: 0,
    ueberzaehligeZdos: [],
    ohneLoeschen: null,
    unbekanntePrefabs: [],
  };
  const verworfen = optionen.verworfen ?? 0;
  if (verworfen > 0) ergebnis.ohneLoeschen = { verworfen, stehenGeblieben: 0 };
  // Kennung je Eintrag: Prefab + gerundete Position (layoutKennung in
  // shared). Damit lassen sich beim Boot ZDOs entfernen, deren Eintrag der
  // Designer gelöscht hat (vorher blieben sie für immer stehen,
  // Review-Punkt 13) — und der Client findet über denselben Member den
  // Layout-Eintrag zu einer Instanz wieder (Namensschild).
  const kennung = layoutKennung;
  const gewollt = new Set(placements.map(kennung));
  ergebnis.freigegeben = befreieSpielerbauten(zdos);
  const bekannt = (p: PlacementDef): { hash: number } | undefined => kontext.prefabs.getByName(p.prefab);

  // Unbekannte Prefabs: was zu ihnen gehören könnte, wird geschont.
  const unbekannte = placements.filter((p) => !bekannt(p));
  const unbekannteKennungen = new Set(unbekannte.map(kennung));
  const gehoertZu = (zdo: ZDO, id: string, p: PlacementDef): boolean =>
    id === kennung(p) || Math.hypot(zdo.position.x - p.x, zdo.position.z - p.z) <= TOLERANZ.schonzone;
  const geschont = (zdo: ZDO, id: string): boolean => unbekannte.some((p) => gehoertZu(zdo, id, p));
  for (const p of unbekannte) {
    let n = 0;
    for (const zdo of zdos.getAllZDOs()) {
      const id = zdo.getString(LAYOUT_ID_MEMBER);
      if (id && gehoertZu(zdo, id, p)) n++;
    }
    ergebnis.unbekannt++;
    ergebnis.unbekanntePrefabs.push({ kennung: kennung(p), prefab: p.prefab, geschont: n });
  }
  // Darf dieses ZDO in diesem Boot zerstört werden? Nein, wenn es zu einem
  // unbekannten Prefab gehören könnte, und nein, wenn der Sanitizer Einträge
  // verworfen hat (dann zählt es als stehen geblieben).
  const gezaehlt = new Set<ZDO>();
  const darfLoeschen = (zdo: ZDO, id: string): boolean => {
    if (geschont(zdo, id)) return false;
    if (ergebnis.ohneLoeschen) {
      if (!gezaehlt.has(zdo)) {
        gezaehlt.add(zdo);
        ergebnis.ohneLoeschen.stehenGeblieben++;
      }
      return false;
    }
    return true;
  };

  // Wo die Platzierungen stehen (nur bekannte Prefabs): Ein ZDO, dessen
  // Kennung nicht mehr gewollt ist, aber unter 0,5 m neben einer
  // Platzierung desselben Prefabs steht, ist DASSELBE Objekt, das der
  // Designer über die Rundungsgrenze der Kennung geschoben hat (140,4 →
  // 140,5 wechselt „@140" zu „@141"). Es wird nicht zerstört, sondern von
  // der Nähesuche unten übernommen — mit seiner ZDO-Id und allem, was daran
  // hängt.
  const ziele = placements.flatMap((p) => {
    const prefab = bekannt(p);
    return prefab ? [{ hash: prefab.hash, x: p.x, z: p.z }] : [];
  });
  const gruppen = new Map<string, ZDO[]>();
  const zurueckgestellt: ZDO[] = [];
  for (const zdo of zdos.getAllZDOs()) {
    const id = zdo.getString(LAYOUT_ID_MEMBER);
    if (!id) continue;
    if (!gewollt.has(id)) {
      const nah = ziele.some(
        (t) =>
          t.hash === zdo.prefabHash &&
          Math.hypot(zdo.position.x - t.x, zdo.position.z - t.z) < TOLERANZ.naehe
      );
      if (nah) {
        zurueckgestellt.push(zdo);
      } else if (darfLoeschen(zdo, id)) {
        zdos.destroyZDO(zdo.zdoid);
        ergebnis.entfernt++;
      }
      continue;
    }
    // Im selben Durchlauf einen Index über die Kennung aufbauen: Ein
    // Routen-NPC ist beim nächsten Boot IRGENDWO auf seiner Runde, die
    // Nähe-Prüfung unten fände ihn also nicht wieder und spawnte bei jedem
    // Start einen weiteren. Die Kennung wandert dagegen mit ihm mit.
    const gruppe = gruppen.get(id);
    if (gruppe) gruppe.push(zdo);
    else gruppen.set(id, [zdo]);
  }

  // Zuordnung: Platzierungen mit gleicher Kennung, die höchstens 1 cm
  // auseinander liegen, sind EIN Objekt (Vertreter = die erste); weiter
  // auseinander sind es verschiedene Objekte. Je Objekt das nächste noch freie
  // ZDO der Kennung (bei Gleichstand das mit mehr Zustand, dann das
  // gestempelte, dann die Reihenfolge im Spielstand).
  const objektVon = new Map<PlacementDef, PlacementDef>();
  const zdoJeObjekt = new Map<PlacementDef, ZDO>();
  const beansprucht = new Set<ZDO>();
  const stale: { zdo: ZDO; id: string }[] = [];
  const nachKennungPlacements = new Map<string, PlacementDef[]>();
  for (const p of placements) {
    if (!bekannt(p)) continue;
    const liste = nachKennungPlacements.get(kennung(p));
    if (liste) liste.push(p);
    else nachKennungPlacements.set(kennung(p), [p]);
  }
  for (const [id, liste] of nachKennungPlacements) {
    const vertreter: PlacementDef[] = [];
    for (const p of liste) {
      const v = vertreter.find((r) => Math.hypot(r.x - p.x, r.z - p.z) <= TOLERANZ.gleicherOrt);
      if (v) objektVon.set(p, v);
      else {
        vertreter.push(p);
        objektVon.set(p, p);
      }
    }
    const alle = gruppen.get(id) ?? [];
    if (alle.length === 0) continue;
    const hash = bekannt(liste[0]!)!.hash;
    const passend = alle.filter((z) => z.prefabHash === hash);
    const frei = [...passend];
    for (const v of vertreter) {
      if (frei.length === 0) break;
      const abstand = (z: ZDO): number => Math.hypot(z.position.x - v.x, z.position.z - v.z);
      let bleibt = frei[0]!;
      for (const z of frei) {
        const naeher = abstand(z) < abstand(bleibt) - 1e-9;
        const gleichweit = Math.abs(abstand(z) - abstand(bleibt)) <= 1e-9;
        // Bei Gleichstand entscheidet der ZUSTAND (eine volle Truhe schlägt
        // eine leere), dann der Stempel, dann die Reihenfolge im Spielstand.
        // Sonst hinge es von der Dateireihenfolge ab, welches Exemplar mit
        // seinem Inhalt geht.
        const mehrZustand = zustand(z) > zustand(bleibt);
        const gleichZustand = zustand(z) === zustand(bleibt);
        const gestempelt = liesStempel(z) !== null && liesStempel(bleibt) === null;
        if (naeher || (gleichweit && (mehrZustand || (gleichZustand && gestempelt)))) bleibt = z;
      }
      frei.splice(frei.indexOf(bleibt), 1);
      zdoJeObjekt.set(v, bleibt);
      beansprucht.add(bleibt);
    }
    for (const z of alle) {
      if (beansprucht.has(z)) continue;
      if (passend.length === 0) {
        // Kein ZDO der Kennung passt zum Prefab: Sie gehen, sobald unten das
        // neue entstanden ist (im selben Boot).
        stale.push({ zdo: z, id });
      } else if (darfLoeschen(z, id)) {
        meldeUeberzaehlig(ergebnis, z, id);
        zdos.destroyZDO(z.zdoid);
        ergebnis.entfernt++;
        ergebnis.ueberzaehlig++;
      }
    }
  }

  const routen = new Map((layout.routes ?? []).map((r) => [r.id, r]));
  const neuErzeugt = new Set<string>();
  for (const p of placements) {
    const prefab = bekannt(p);
    // Ein unbekanntes Prefab erzeugt nie ein ZDO (und wird oben gezählt).
    if (!prefab) continue;
    const boden = kontext.bodenHoehe(p.x, p.z);
    const abstand = kontext.bodenAbstand(prefab.hash);
    const pos = { x: p.x, y: boden + abstand, z: p.z };
    const fp = fingerabdruck(p);
    const vertreter = objektVon.get(p)!;
    let zdo = zdoJeObjekt.get(vertreter);
    if (!zdo) {
      // Ein ZDO, das schon zu einer anderen Platzierung gehört, wird nicht
      // übernommen: Jedes verschiedene Objekt bekommt sein eigenes.
      zdo = zdos
        .getZDOsInRadius(pos, 1)
        .find(
          (z) =>
            z.prefabHash === prefab.hash &&
            !istSpielerbau(z) &&
            !beansprucht.has(z) &&
            Math.hypot(z.position.x - p.x, z.position.z - p.z) < TOLERANZ.naehe
        );
      if (zdo) {
        zdoJeObjekt.set(vertreter, zdo);
        beansprucht.add(zdo);
      }
    }
    if (!zdo) {
      // Steht schon ein fremdes Bauwerk genau hier? Zwei Objekte sind dann
      // in Ordnung (das Bauwerk gehört dem Spieler), aber der Designer soll
      // es im Boot-Log lesen können.
      const ueber = zdos
        .getZDOsInRadius(pos, 1)
        .some(
          (z) =>
            z.prefabHash === prefab.hash &&
            istSpielerbau(z) &&
            Math.hypot(z.position.x - p.x, z.position.z - p.z) < TOLERANZ.naehe
        );
      if (ueber) ergebnis.ueberSpielerbau.push(kennung(p));
      zdo = zdos.createZDO(prefab.hash, pos);
      zdo.rotation = yawQuaternion(p.yaw ?? 0);
      const skala = sollSkala(p);
      if (skala !== 0) zdo.setFloat(SKALA_MEMBER, skala);
      zdo.setString(LAYOUT_ID_MEMBER, kennung(p));
      zdo.setString(LAYOUT_SOLL_MEMBER, stempelText(fp, boden));
      zdoJeObjekt.set(vertreter, zdo);
      beansprucht.add(zdo);
      neuErzeugt.add(kennung(p));
      ergebnis.gespawnt++;
    } else if (
      gleicheAn(kontext, zdo, p, {
        kennung: kennung(p),
        fingerabdruck: fp,
        boden,
        abstand,
        route: laeuftRoute(layout, p),
      })
    ) {
      ergebnis.aktualisiert++;
    } else {
      ergebnis.unveraendert++;
    }
    // Trefferpunkte für alles, was eine FIGUR ist. Die Prüfung auf
    // `istNpcPrefab` ist nicht Zierde: In derselben Schleife entstehen
    // auch Häuser, Steine und Bäume, und die tragen `health` bereits mit
    // einer ganz anderen Bedeutung (handleHarvest zählt damit die
    // Axtschläge bis zum Fällen). Ein Lebensbalken über einer Fichte
    // wäre das kleinere Übel — ein Startwert aus der Figurentabelle in
    // ihrem Ernte-Zähler das größere.
    if (istNpcPrefab(p.prefab) && zdo.getInt(HEALTH_MEMBER) <= 0) {
      zdo.setInt(HEALTH_MEMBER, maxLeben(p.prefab));
      zdo.revision.reviseData();
      zdo.dirty = true;
    }
    // Route anhängen. Ein unbekannter Name lässt das Objekt schlicht
    // stehen (pruefeLayout meldet ihn im Aufrufer) — eine halb gespawnte
    // Welt wäre der schlechtere Tausch.
    const route = p.route ? routen.get(p.route) : undefined;
    if (route) {
      kontext.anRoute(zdo, route);
      ergebnis.aufRoute++;
    }
  }
  // Passte kein ZDO einer Kennung zum Prefab, ist oben ein neues entstanden:
  // Die unpassenden gehen im selben Boot, damit nach ihm die Kennung nur noch
  // die neuen ZDOs trägt (sonst räumte erst der nächste Boot auf und zerstörte
  // dann etwas, das dieser bewusst behalten hat).
  for (const { zdo, id } of stale) {
    if (!neuErzeugt.has(id) || zdo.destroyed || beansprucht.has(zdo) || zdo.getString(LAYOUT_ID_MEMBER) !== id) continue;
    if (!darfLoeschen(zdo, id)) continue;
    meldeUeberzaehlig(ergebnis, zdo, id);
    zdos.destroyZDO(zdo.zdoid);
    ergebnis.entfernt++;
    ergebnis.ueberzaehlig++;
  }
  // Zurückgestellte, die keine Platzierung übernommen hat (sie fand ein
  // anderes ZDO): jetzt wirklich verwaist.
  for (const zdo of zurueckgestellt) {
    const id = zdo.getString(LAYOUT_ID_MEMBER);
    if (gewollt.has(id) || zdo.destroyed) continue;
    if (!darfLoeschen(zdo, id)) continue;
    zdos.destroyZDO(zdo.zdoid);
    ergebnis.entfernt++;
  }
  return ergebnis;
}

function meldeUeberzaehlig(ergebnis: LayoutAbgleichErgebnis, zdo: ZDO, kennung: string): void {
  ergebnis.ueberzaehligeZdos.push({ id: zdo.zdoid.toString(), kennung, member: zustand(zdo) });
}

interface Angleich {
  readonly kennung: string;
  readonly fingerabdruck: string;
  /** Boden an der Dokumentposition, jetzt. */
  readonly boden: number;
  readonly abstand: number;
  readonly route: boolean;
}

/**
 * Ein gefundenes ZDO auf den Stand des Dokuments bringen — soweit der
 * Soll-Stempel es verlangt (s. Kopfkommentar). Schreibt nur, was sich um
 * mehr als die Toleranz unterscheidet. Gibt zurück, ob irgendetwas
 * geschrieben wurde.
 */
function gleicheAn(kontext: LayoutAbgleichKontext, zdo: ZDO, p: PlacementDef, a: Angleich): boolean {
  let geschrieben = false;
  if (zdo.getString(LAYOUT_ID_MEMBER) !== a.kennung) {
    // Über die NÄHE wiedergefunden (ZDO aus einem Save von vor der
    // Kennung, oder über die Rundungsgrenze geschoben): Member nachtragen.
    // Sonst bliebe das Objekt für immer ohne Herkunft — der Client könnte
    // ihm kein Namensschild zuordnen, und beim nächsten Löschen im Editor
    // bliebe es stehen.
    zdo.setString(LAYOUT_ID_MEMBER, a.kennung);
    geschrieben = true;
  }
  const stempel = liesStempel(zdo);
  // Ein Wesen, das ein Server-System bewegt, aber keine Route läuft: seine
  // Lage gehört nach dem ersten Stempel dem Server.
  const wesen = !a.route && kontext.wirdBewegt(zdo);
  let neuStempeln = stempel === null || stempel.fingerabdruck !== a.fingerabdruck;

  if (stempel === null) {
    // Spielstand von vor dem Stempel. Ein bewegtes Wesen steht, wo es
    // gewandert ist — so wie vor diesem Umbau; nur stempeln. Alles andere
    // wird einmal an das Dokument angeglichen.
    if (!wesen && anwenden(kontext, zdo, p, a, false)) geschrieben = true;
  } else if (stempel.fingerabdruck !== a.fingerabdruck) {
    // Der Designer hat etwas geändert: Dokumentwerte anwenden, und ein
    // bewegtes Wesen samt Wander-Anker an die neue Stelle.
    if (anwenden(kontext, zdo, p, a, wesen)) geschrieben = true;
  } else if (!a.route && !wesen && Math.abs(a.boden - stempel.boden) > TOLERANZ.boden) {
    // Dokument unverändert, aber der Boden unter dem Objekt hat sich
    // geändert (Region, Fluss, Einebnen, Terraforming). Das Objekt zieht
    // nur mit, wenn es noch genau dort steht, wo der Stempel es hinstellte:
    // was der Server oder das Spiel bewegt hat, bleibt stehen.
    const stand = zdo.position;
    const alt = stempel.boden + a.abstand;
    if (
      Math.abs(stand.y - alt) <= TOLERANZ.stehtNoch &&
      Math.abs(stand.x - p.x) <= TOLERANZ.stehtNoch &&
      Math.abs(stand.z - p.z) <= TOLERANZ.stehtNoch
    ) {
      zdo.position = { x: stand.x, y: a.boden + a.abstand, z: stand.z };
      zdo.revision.reviseData();
      zdo.dirty = true;
      geschrieben = true;
    }
    neuStempeln = true; // die gesehene Bodenhöhe merken, auch wenn nichts bewegt wurde
  }

  if (neuStempeln) {
    zdo.setString(LAYOUT_SOLL_MEMBER, stempelText(a.fingerabdruck, a.boden));
    geschrieben = true;
  }
  return geschrieben;
}

/**
 * Drehung, Skalierung und (außer bei Routen-NPCs) Position auf die
 * Platzierung setzen. `verankern`: ein Server-System bewegt das Wesen — sein
 * Wander-Anker geht mit an die neue Position.
 */
function anwenden(
  kontext: LayoutAbgleichKontext,
  zdo: ZDO,
  p: PlacementDef,
  a: Angleich,
  verankern: boolean
): boolean {
  let geaendert = false;
  // Lage und Drehung gehören bei einem Routen-NPC dem Läufer: Er steht
  // irgendwo auf seiner Runde und schaut in Laufrichtung.
  if (!a.route) {
    const q = yawQuaternion(p.yaw ?? 0);
    const r = zdo.rotation;
    // q und -q sind dieselbe Drehung — der Betrag des Skalarprodukts zählt.
    const skalar = Math.abs(q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w);
    if (1 - skalar > TOLERANZ.drehung) {
      zdo.rotation = q;
      geaendert = true;
    }
    const soll = { x: p.x, y: a.boden + a.abstand, z: p.z };
    const pos = zdo.position;
    let versetzt = false;
    if (
      Math.abs(pos.x - soll.x) > TOLERANZ.lage ||
      Math.abs(pos.z - soll.z) > TOLERANZ.lage ||
      Math.abs(pos.y - soll.y) > TOLERANZ.hoehe
    ) {
      // Über den Manager, damit ein Sprung über eine Zonengrenze das ZDO
      // auch im Zonenindex umhängt.
      kontext.zdos.updateZDOZone(zdo, soll);
      versetzt = true;
      geaendert = true;
    }
    if (geaendert) {
      zdo.revision.reviseData();
      zdo.dirty = true;
    }
    if (versetzt && verankern) kontext.verankere(zdo);
  }
  const skala = sollSkala(p);
  if (skala === 0) {
    if (zdo.removeMember(SKALA_HASH)) geaendert = true;
  } else if (Math.abs(zdo.getFloat(SKALA_MEMBER, 0) - skala) > TOLERANZ.skala) {
    zdo.setFloat(SKALA_MEMBER, skala);
    geaendert = true;
  }
  return geaendert;
}
