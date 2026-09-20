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
  platzierungenNormalisieren,
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
export function istSpielerbau(zdo: ZDO): boolean {
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

/**
 * Der Prefab-Teil einer ALTEN Kennung in ihrer vollen Form `prefab@x,z` (`layoutKennung`: Prefab, `@`, ganze Zahlen),
 * sonst `null`. Ein `@` irgendwo genügt nicht.
 */
const prefabDerAltenKennung = (layoutId: string): string | null => /^([^@]+)@-?\d+,-?\d+$/.exec(layoutId)?.[1] ?? null;

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
  /**
   * ZDOs, deren `layoutId` in diesem Boot auf die `id` ihrer Platzierung
   * geschrieben wurde: die einmalige Migration von der alten Kennung (Prefab +
   * gerundete Position) und die Übernahme über die Nähe. Sie zählen auch bei
   * `aktualisiert`; im Boot danach ist es 0.
   */
  umgestempelt: number;
  /** `id`s neuer Platzierungen, die genau über einem fremden Spielerbau stehen. */
  ueberSpielerbau: string[];
  /** ZDOs, die über die Zahl der verschiedenen Platzierungen ihrer Kennung hinaus da waren, und entfernt wurden. */
  ueberzaehlig: number;
  /** Jedes überzählig entfernte ZDO: Id, seine `layoutId` (Feld `kennung`) und Zahl der Zustands-Member (für das Log). */
  ueberzaehligeZdos: { id: string; kennung: string; member: number }[];
  /**
   * Gesetzt, wenn der Sanitizer Einträge des Dokuments verworfen hat: Dieser
   * Boot löscht dann KEIN Layout-ZDO (s. `layoutAbgleich`).
   * `stehenGeblieben` sind die ZDOs, die ein löschender Boot entfernt hätte.
   */
  ohneLoeschen: { verworfen: number; stehenGeblieben: number } | null;
  /**
   * Platzierungen, deren Prefab die Registry nicht kennt (`kennung` ist ihre
   * `id`). Sie erzeugen nie ein ZDO. Die ZDOs, die zu ihnen gehören könnten
   * (gleiche `id` oder alte Kennung, oder im Umkreis von 1 m), bleiben
   * unangetastet: `geschont` zählt sie.
   */
  unbekanntePrefabs: { kennung: string; prefab: string; geschont: number }[];
}

/**
 * Handplatzierte Objekte des WorldLayouts materialisieren.
 *
 * Idempotent über die `id` der Platzierung im ZDO-Member `layoutId`,
 * ersatzweise die alte Kennung (Spielstand von vor E1, wird umgestempelt) und
 * eine Nähe-Prüfung (gleiches Prefab < 0,5 m) — persistente ZDOs aus dem Save
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
 * Eine `id` führt genau ein ZDO. Zwei Platzierungen im selben Meter oder sogar
 * im selben Zentimeter sind zwei Objekte mit zwei `id`s (exakte Duplikate hat
 * der Sanitizer schon zu einem Eintrag zusammengefasst). Wechselt das Prefab
 * einer Platzierung bei gleicher `id`, wird das alte ZDO ersetzt: ein neues
 * entsteht, das alte geht im selben Boot (samt Zustand — Truheninhalt eines
 * anderen Prefabs wäre am neuen sinnlos). Verschieben ändert die `id` nicht:
 * dasselbe ZDO wandert mit, der Zustand bleibt.
 *
 * Ein gefundenes ZDO wird an das Dokument ANGEGLICHEN, soweit sich das
 * Dokument geändert hat (Soll-Stempel, s. Kopfkommentar): Drehung,
 * Skalierung und Position. Ohne das wäre jede Änderung im Editor, die die
 * `id` nicht ändert (also jede außer Löschen und Neuanlegen), nach dem
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
  /**
   * `verworfen`: Einträge, die der Sanitizer aus dem rohen Dokument gestrichen hat (roh − gültig);
   * `zusammengefasst`: davon exakte Duplikate, die er zu einem Eintrag zusammengelegt hat (kein Verlust).
   */
  optionen: { verworfen?: number; zusammengefasst?: number } = {}
): LayoutAbgleichErgebnis {
  const { zdos } = kontext;
  // Jede Platzierung hat eine `id` (dafür sorgt der Sanitizer). Wer ein
  // ungeprüftes Dokument übergibt, bekommt sie hier abgeleitet — dieselbe
  // Ableitung, dieselbe Zusammenfassung exakter Duplikate.
  const placements = platzierungenNormalisieren(layout.placements ?? []).placements;
  const ergebnis: LayoutAbgleichErgebnis = {
    gespawnt: 0,
    aktualisiert: 0,
    unveraendert: 0,
    entfernt: 0,
    unbekannt: 0,
    aufRoute: 0,
    freigegeben: 0,
    umgestempelt: 0,
    ueberSpielerbau: [],
    ueberzaehlig: 0,
    ueberzaehligeZdos: [],
    ohneLoeschen: null,
    unbekanntePrefabs: [],
  };
  // Exakte Duplikate, die der Sanitizer zu einem Eintrag zusammengefasst hat,
  // fehlen in der Zahl der gültigen Einträge, sind aber nichts Verworfenes:
  // Sie tragen kein ZDO, das ein löschender Boot gefährden könnte. Die Zahl
  // reicht der Aufrufer ausdrücklich herein (`sanitizeWorldLayoutMitBericht`),
  // dieselbe wie im Schreibweg — nichts hängt an einem Layout-Objekt.
  const verworfen = Math.max(0, (optionen.verworfen ?? 0) - (optionen.zusammengefasst ?? 0));
  if (verworfen > 0) ergebnis.ohneLoeschen = { verworfen, stehenGeblieben: 0 };
  // Der ZDO-Member `layoutId` trägt die `id` der Platzierung. Damit lassen
  // sich beim Boot ZDOs entfernen, deren Eintrag der Designer gelöscht hat
  // (vorher blieben sie für immer stehen, Review-Punkt 13) — und der Client
  // findet über denselben Member den Layout-Eintrag zu einer Instanz wieder
  // (Namensschild).
  const gewollt = new Set(placements.map((p) => p.id!));
  // Spielstände von vor E1 tragen dort noch die ALTE Kennung (Prefab +
  // gerundete Position). Sie enthält ein `@` und kann nie eine `id` sein; ihr
  // ZDO wird beim ersten Boot der passenden Platzierung zugeordnet und auf die
  // `id` umgestempelt — kein Spawn, kein Löschen.
  const nachAlterKennung = new Map<string, PlacementDef[]>();
  for (const p of placements) {
    const k = layoutKennung(p);
    const liste = nachAlterKennung.get(k);
    if (liste) liste.push(p);
    else nachAlterKennung.set(k, [p]);
  }
  ergebnis.freigegeben = befreieSpielerbauten(zdos);
  const bekannt = (p: PlacementDef): { hash: number } | undefined => kontext.prefabs.getByName(p.prefab);

  // Unbekannte Prefabs: was zu ihnen gehören könnte, wird geschont.
  const unbekannte = placements.filter((p) => !bekannt(p));
  const gehoertZu = (zdo: ZDO, layoutId: string, p: PlacementDef): boolean =>
    layoutId === p.id ||
    layoutId === layoutKennung(p) ||
    Math.hypot(zdo.position.x - p.x, zdo.position.z - p.z) <= TOLERANZ.schonzone;
  const geschont = (zdo: ZDO, layoutId: string): boolean => unbekannte.some((p) => gehoertZu(zdo, layoutId, p));
  for (const p of unbekannte) {
    let n = 0;
    for (const zdo of zdos.getAllZDOs()) {
      const layoutId = zdo.getString(LAYOUT_ID_MEMBER);
      if (layoutId && gehoertZu(zdo, layoutId, p)) n++;
    }
    ergebnis.unbekannt++;
    ergebnis.unbekanntePrefabs.push({ kennung: p.id!, prefab: p.prefab, geschont: n });
  }
  // Darf dieses ZDO in diesem Boot zerstört werden? Nein, wenn es zu einem
  // unbekannten Prefab gehören könnte, und nein, wenn der Sanitizer Einträge
  // verworfen hat (dann zählt es als stehen geblieben).
  const gezaehlt = new Set<ZDO>();
  const darfLoeschen = (zdo: ZDO, layoutId: string): boolean => {
    if (geschont(zdo, layoutId)) return false;
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
  // Kennung zu keiner Platzierung passt, aber unter 0,5 m neben einer
  // Platzierung desselben Prefabs steht, ist DASSELBE Objekt, dessen alte
  // Kennung sich geändert hat (Spielstand von vor E1, Dokument von Hand
  // umgebaut). Es wird nicht sofort zerstört, sondern von der Nähesuche unten
  // übernommen — mit seiner ZDO-Id und allem, was daran hängt — WENN es eine
  // alte Kennung (`@`) trägt (`darfUebernehmen`); ein ZDO mit id-förmiger
  // Kennung, die im Dokument fehlt, geht im Nachlauf am Ende.
  const ziele = placements.flatMap((p) => {
    const prefab = bekannt(p);
    return prefab ? [{ hash: prefab.hash, x: p.x, z: p.z }] : [];
  });
  const gruppen = new Map<string, ZDO[]>(); // ZDOs je `id`
  const alteGruppen = new Map<string, ZDO[]>(); // ZDOs je alter Kennung
  const zurueckgestellt: ZDO[] = [];
  for (const zdo of zdos.getAllZDOs()) {
    const layoutId = zdo.getString(LAYOUT_ID_MEMBER);
    if (!layoutId) continue;
    // Im selben Durchlauf einen Index über die Kennung aufbauen: Ein
    // Routen-NPC ist beim nächsten Boot IRGENDWO auf seiner Runde, die
    // Nähe-Prüfung unten fände ihn also nicht wieder und spawnte bei jedem
    // Start einen weiteren. Die Kennung wandert dagegen mit ihm mit.
    const index = gewollt.has(layoutId) ? gruppen : nachAlterKennung.has(layoutId) ? alteGruppen : null;
    if (index) {
      const gruppe = index.get(layoutId);
      if (gruppe) gruppe.push(zdo);
      else index.set(layoutId, [zdo]);
      continue;
    }
    const nah = ziele.some(
      (t) =>
        t.hash === zdo.prefabHash &&
        Math.hypot(zdo.position.x - t.x, zdo.position.z - t.z) < TOLERANZ.naehe
    );
    if (nah) {
      zurueckgestellt.push(zdo);
    } else if (darfLoeschen(zdo, layoutId)) {
      zdos.destroyZDO(zdo.zdoid);
      ergebnis.entfernt++;
    }
  }

  // Zuordnung Platzierung → ZDO. Eine `id` führt genau EIN ZDO (dasselbe
  // Prefab; bei mehreren das nächste, bei Gleichstand das mit mehr Zustand,
  // dann das gestempelte, dann die Reihenfolge im Spielstand). Was darüber
  // hinaus die gleiche Kennung trägt, ist überzählig.
  const zdoJe = new Map<PlacementDef, ZDO>();
  const beansprucht = new Set<ZDO>();
  // ZDOs, deren Prefab nicht mehr zur Platzierung passt (Prefab-Wechsel bei
  // gleicher `id`, oder ein ZDO mit falschem Prefab an einer alten Kennung):
  // Sie gehen, sobald unten das neue entstanden ist (im selben Boot).
  const stale: { zdo: ZDO; layoutId: string; besitzer: PlacementDef[] }[] = [];
  const ueberzaehligEntfernen = (z: ZDO, layoutId: string): void => {
    if (!darfLoeschen(z, layoutId)) return;
    meldeUeberzaehlig(ergebnis, z, layoutId);
    zdos.destroyZDO(z.zdoid);
    ergebnis.entfernt++;
    ergebnis.ueberzaehlig++;
  };
  for (const p of placements) {
    const prefab = bekannt(p);
    const alle = gruppen.get(p.id!) ?? [];
    if (!prefab || alle.length === 0) continue;
    const passend = alle.filter((z) => z.prefabHash === prefab.hash);
    if (passend.length === 0) {
      for (const z of alle) stale.push({ zdo: z, layoutId: p.id!, besitzer: [p] });
      continue;
    }
    const z = ordneZu([p], passend).get(p)!;
    zdoJe.set(p, z);
    beansprucht.add(z);
    for (const rest of alle) if (rest !== z) ueberzaehligEntfernen(rest, p.id!);
  }
  // Alte Kennungen (Migration): Platzierungen einer Kennung, die noch kein ZDO
  // haben, bekommen die ZDOs dieser Kennung — das nächste zuerst.
  for (const [alteKennung, alle] of alteGruppen) {
    const besitzer = nachAlterKennung.get(alteKennung)!.filter((p) => bekannt(p));
    if (besitzer.length === 0) continue;
    const hash = bekannt(besitzer[0]!)!.hash;
    const passend = alle.filter((z) => z.prefabHash === hash);
    if (passend.length === 0) {
      for (const z of alle) stale.push({ zdo: z, layoutId: alteKennung, besitzer });
      continue;
    }
    for (const [p, z] of ordneZu(besitzer.filter((p) => !zdoJe.has(p)), passend)) {
      zdoJe.set(p, z);
      beansprucht.add(z);
    }
    for (const z of alle) {
      if (!beansprucht.has(z)) ueberzaehligEntfernen(z, alteKennung);
    }
  }

  // DIE EINE Sperre gegen das Erben: Übernehmen (Nähesuche) darf eine Platzierung nur ein ZDO OHNE Kennung oder mit
  // ALTER Kennung (`@`, Spielstand von vor E1) — das ist der Migrationsweg. Ein ZDO mit id-förmiger Kennung, die
  // im Dokument fehlt (ein Objekt, das der Designer gelöscht hat), ist verwaist und stirbt nach den gewohnten
  // Regeln (`darfLoeschen`): Die id in der Datei ist die ADRESSE des Objekts, eine neue id ist ein neues Objekt
  // und erbt nie den Zustand eines gelöschten — gleich, wie die id aussieht und wie nah es steht. Ein Dokument
  // ohne ids hat keine stabile Objektidentität: Liegt ein solcher Eintrag nach einer Verschiebung über die
  // Meterkante, ändert sich seine abgeleitete id, und das ZDO der alten geht (Zustand mit).
  // Das ist die einzige Stelle, die das entscheidet: Die Zurückstellung in der ersten Schleife (Nähe zu einer
  // Platzierung) schont ein id-förmiges ZDO nur bis hierher, danach nimmt es diese Sperre — eine zweite Sperre dort
  // hätte keine beobachtbare Wirkung (das ZDO stürbe im Nachlauf im selben Boot).
  const darfUebernehmen = (z: ZDO): boolean => {
    const member = z.getMember(LAYOUT_ID_HASH);
    // Ein Member, der da ist, aber kein Text: eine unlesbare Kennung ist trotzdem eine — nicht „ohne Kennung“.
    if (member !== undefined && typeof member.value !== 'string') return false;
    const kennung = z.getString(LAYOUT_ID_MEMBER);
    if (!kennung) return true;
    // Eine alte Kennung, die dieser Server je geschrieben hat, nennt das Prefab des ZDO selbst: `irgendwas@7,7` ist keine.
    const prefab = prefabDerAltenKennung(kennung);
    return prefab !== null && kontext.prefabs.getByName(prefab)?.hash === z.prefabHash;
  };

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
    let zdo = zdoJe.get(p);
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
            darfUebernehmen(z) &&
            Math.hypot(z.position.x - p.x, z.position.z - p.z) < TOLERANZ.naehe
        );
      if (zdo) {
        zdoJe.set(p, zdo);
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
      if (ueber) ergebnis.ueberSpielerbau.push(p.id!);
      zdo = zdos.createZDO(prefab.hash, pos);
      zdo.rotation = yawQuaternion(p.yaw ?? 0);
      const skala = sollSkala(p);
      if (skala !== 0) zdo.setFloat(SKALA_MEMBER, skala);
      zdo.setString(LAYOUT_ID_MEMBER, p.id!);
      zdo.setString(LAYOUT_SOLL_MEMBER, stempelText(fp, boden));
      zdoJe.set(p, zdo);
      beansprucht.add(zdo);
      neuErzeugt.add(p.id!);
      ergebnis.gespawnt++;
    } else if (
      gleicheAn(kontext, ergebnis, zdo, p, {
        id: p.id!,
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
  // Passte kein ZDO einer `id` zum Prefab, ist oben ein neues entstanden: Die
  // unpassenden gehen im selben Boot, damit nach ihm die `id` nur noch das
  // neue ZDO trägt (sonst räumte erst der nächste Boot auf und zerstörte dann
  // etwas, das dieser bewusst behalten hat). Das ist der Prefab-Wechsel bei
  // gleicher `id`: Das alte ZDO samt Zustand wird ERSETZT, nicht umgewandelt —
  // Truheninhalt und Ernte-Zähler eines anderen Prefabs wären am neuen sinnlos.
  for (const { zdo, layoutId, besitzer } of stale) {
    if (!besitzer.some((p) => neuErzeugt.has(p.id!))) continue;
    if (zdo.destroyed || beansprucht.has(zdo) || zdo.getString(LAYOUT_ID_MEMBER) !== layoutId) continue;
    if (!darfLoeschen(zdo, layoutId)) continue;
    meldeUeberzaehlig(ergebnis, zdo, layoutId);
    zdos.destroyZDO(zdo.zdoid);
    ergebnis.entfernt++;
    ergebnis.ueberzaehlig++;
  }
  // Zurückgestellte, die keine Platzierung übernommen hat (sie fand ein
  // anderes ZDO): jetzt wirklich verwaist.
  for (const zdo of zurueckgestellt) {
    const layoutId = zdo.getString(LAYOUT_ID_MEMBER);
    if (gewollt.has(layoutId) || zdo.destroyed) continue;
    if (!darfLoeschen(zdo, layoutId)) continue;
    zdos.destroyZDO(zdo.zdoid);
    ergebnis.entfernt++;
  }
  return ergebnis;
}

function meldeUeberzaehlig(ergebnis: LayoutAbgleichErgebnis, zdo: ZDO, kennung: string): void {
  ergebnis.ueberzaehligeZdos.push({ id: zdo.zdoid.toString(), kennung, member: zustand(zdo) });
}

/**
 * Platzierungen und ZDOs einander zuordnen, kürzester Abstand zuerst. Bei
 * gleichem Abstand (auf 1e-9 m) entscheidet der ZUSTAND (eine volle Truhe
 * schlägt eine leere), dann der Stempel, dann die Reihenfolge: Platzierung in
 * Dokumentreihenfolge, ZDO in Spielstandreihenfolge. Sonst hinge es von der
 * Dateireihenfolge ab, welches Exemplar mit seinem Inhalt geht. Jede
 * Platzierung und jedes ZDO kommt höchstens einmal vor.
 */
function ordneZu(placements: readonly PlacementDef[], zdoListe: readonly ZDO[]): Map<PlacementDef, ZDO> {
  const paare: { p: number; z: number; abstand: number }[] = [];
  placements.forEach((p, i) =>
    zdoListe.forEach((z, j) =>
      paare.push({ p: i, z: j, abstand: Math.round(Math.hypot(z.position.x - p.x, z.position.z - p.z) * 1e9) })
    )
  );
  paare.sort(
    (a, b) =>
      a.abstand - b.abstand ||
      zustand(zdoListe[b.z]!) - zustand(zdoListe[a.z]!) ||
      Number(liesStempel(zdoListe[b.z]!) !== null) - Number(liesStempel(zdoListe[a.z]!) !== null) ||
      a.p - b.p ||
      a.z - b.z
  );
  const ergebnis = new Map<PlacementDef, ZDO>();
  const vergeben = new Set<number>();
  for (const { p, z } of paare) {
    if (ergebnis.has(placements[p]!) || vergeben.has(z)) continue;
    ergebnis.set(placements[p]!, zdoListe[z]!);
    vergeben.add(z);
  }
  return ergebnis;
}

interface Angleich {
  readonly id: string;
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
function gleicheAn(
  kontext: LayoutAbgleichKontext,
  ergebnis: LayoutAbgleichErgebnis,
  zdo: ZDO,
  p: PlacementDef,
  a: Angleich
): boolean {
  let geschrieben = false;
  if (zdo.getString(LAYOUT_ID_MEMBER) !== a.id) {
    // Über die alte Kennung (Spielstand von vor E1) oder die NÄHE
    // wiedergefunden: `id` eintragen. Sonst bliebe das Objekt für immer ohne
    // Herkunft — der Client könnte ihm kein Namensschild zuordnen, und beim
    // nächsten Löschen im Editor bliebe es stehen.
    zdo.setString(LAYOUT_ID_MEMBER, a.id);
    ergebnis.umgestempelt++;
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
