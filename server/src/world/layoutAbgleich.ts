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
} as const;

const SKALA_MEMBER = 'scaleScalar';
const SKALA_HASH = getStableHash(SKALA_MEMBER);

const SPIELER_HASH = getStableHash('spieler');

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
  /** ZDOs mit einer Kennung, die schon ein anderes ZDO trägt: über das eine hinaus entfernt. */
  ueberzaehlig: number;
  /**
   * Platzierungen, deren Prefab die Registry nicht kennt. Ein vorhandenes ZDO
   * mit dieser Kennung bleibt unangetastet (nicht entfernt, nicht nachgeführt).
   */
  unbekanntePrefabs: { kennung: string; prefab: string; zdoVorhanden: boolean }[];
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
export function layoutAbgleich(kontext: LayoutAbgleichKontext, layout: WorldLayout): LayoutAbgleichErgebnis {
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
    unbekanntePrefabs: [],
  };
  // Kennung je Eintrag: Prefab + gerundete Position (layoutKennung in
  // shared). Damit lassen sich beim Boot ZDOs entfernen, deren Eintrag der
  // Designer gelöscht hat (vorher blieben sie für immer stehen,
  // Review-Punkt 13) — und der Client findet über denselben Member den
  // Layout-Eintrag zu einer Instanz wieder (Namensschild).
  const kennung = layoutKennung;
  const gewollt = new Set(placements.map(kennung));
  // Wo die Platzierungen stehen (nur bekannte Prefabs): Ein ZDO, dessen
  // Kennung nicht mehr gewollt ist, aber unter 0,5 m neben einer
  // Platzierung desselben Prefabs steht, ist DASSELBE Objekt, das der
  // Designer über die Rundungsgrenze der Kennung geschoben hat (140,4 →
  // 140,5 wechselt „@140" zu „@141"). Es wird nicht zerstört, sondern von
  // der Nähesuche unten übernommen — mit seiner ZDO-Id und allem, was daran
  // hängt.
  const ziele = placements.flatMap((p) => {
    const prefab = kontext.prefabs.getByName(p.prefab);
    return prefab ? [{ hash: prefab.hash, x: p.x, z: p.z }] : [];
  });
  const nachKennung = new Map<string, ZDO>();
  const gruppen = new Map<string, ZDO[]>();
  const zurueckgestellt: ZDO[] = [];
  for (const zdo of zdos.getAllZDOs()) {
    const id = zdo.getString(LAYOUT_ID_MEMBER);
    if (!id) continue;
    if (istSpielerbau(zdo)) {
      zdo.removeMember(LAYOUT_ID_HASH);
      zdo.removeMember(SOLL_HASH);
      ergebnis.freigegeben++;
      continue;
    }
    if (!gewollt.has(id)) {
      const nah = ziele.some(
        (t) =>
          t.hash === zdo.prefabHash &&
          Math.hypot(zdo.position.x - t.x, zdo.position.z - t.z) < TOLERANZ.naehe
      );
      if (nah) {
        zurueckgestellt.push(zdo);
      } else {
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
  // Eine Kennung führt EIN ZDO — so viele, wie der Abgleich unten je Kennung
  // braucht (auch mehrere bitgleiche Platzierungen teilen sich eines, das
  // entscheidet K1.1). Ein Spielstand von einem Server, der per Nähe
  // übernahm, kann mehrere tragen: Das nächste an der Platzierung (bei
  // Gleichstand das gestempelte) bleibt, die übrigen gehen. Sonst führte der
  // Abgleich nur eines nach, und die anderen stünden mit ihrem alten Boden
  // für immer da.
  const ersteJeKennung = new Map<string, PlacementDef>();
  for (const p of placements) if (!ersteJeKennung.has(kennung(p))) ersteJeKennung.set(kennung(p), p);
  for (const [id, liste] of gruppen) {
    if (liste.length === 1) {
      nachKennung.set(id, liste[0]!);
      continue;
    }
    const p = ersteJeKennung.get(id)!;
    const hash = kontext.prefabs.getByName(p.prefab)?.hash;
    const passend = hash === undefined ? liste : liste.filter((z) => z.prefabHash === hash);
    const kandidaten = passend.length > 0 ? passend : liste;
    let bleibt = kandidaten[0]!;
    const abstand = (z: ZDO): number => Math.hypot(z.position.x - p.x, z.position.z - p.z);
    for (const z of kandidaten) {
      const naeher = abstand(z) < abstand(bleibt) - 1e-9;
      const gleichweit = Math.abs(abstand(z) - abstand(bleibt)) <= 1e-9;
      if (naeher || (gleichweit && liesStempel(z) !== null && liesStempel(bleibt) === null)) bleibt = z;
    }
    nachKennung.set(id, bleibt);
    for (const z of liste) {
      if (z === bleibt) continue;
      zdos.destroyZDO(z.zdoid);
      ergebnis.ueberzaehlig++;
    }
  }
  const routen = new Map((layout.routes ?? []).map((r) => [r.id, r]));
  for (const p of placements) {
    const prefab = kontext.prefabs.getByName(p.prefab);
    if (!prefab) {
      // Ein vorhandenes ZDO mit dieser Kennung bleibt, wie es ist: Es steht
      // unter einer gewollten Kennung, wird also nicht als verwaist entfernt,
      // und ohne bekanntes Prefab gibt es nichts, wonach der Abgleich es
      // ausrichten könnte. Der Aufrufer meldet es im Log.
      ergebnis.unbekannt++;
      ergebnis.unbekanntePrefabs.push({
        kennung: kennung(p),
        prefab: p.prefab,
        zdoVorhanden: nachKennung.has(kennung(p)),
      });
      continue;
    }
    const boden = kontext.bodenHoehe(p.x, p.z);
    const abstand = kontext.bodenAbstand(prefab.hash);
    const pos = { x: p.x, y: boden + abstand, z: p.z };
    const fp = fingerabdruck(p);
    let zdo = nachKennung.get(kennung(p));
    if (zdo && zdo.prefabHash !== prefab.hash) zdo = undefined;
    if (!zdo) {
      const vorhanden = zdos
        .getZDOsInRadius(pos, 1)
        .find(
          (z) =>
            z.prefabHash === prefab.hash &&
            !istSpielerbau(z) &&
            Math.hypot(z.position.x - p.x, z.position.z - p.z) < TOLERANZ.naehe
        );
      zdo = vorhanden;
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
  // Zurückgestellte, die keine Platzierung übernommen hat (sie fand ein
  // anderes ZDO): jetzt wirklich verwaist.
  for (const zdo of zurueckgestellt) {
    if (gewollt.has(zdo.getString(LAYOUT_ID_MEMBER)) || zdo.destroyed) continue;
    zdos.destroyZDO(zdo.zdoid);
    ergebnis.entfernt++;
  }
  return ergebnis;
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
