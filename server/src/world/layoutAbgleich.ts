/**
 * layoutAbgleich — gleicht die handplatzierten Objekte des WorldLayouts
 * (Editor-Spawn) mit den ZDOs der Welt ab.
 *
 * Aus `WovServer.spawnLayoutPlacements` herausgezogen, damit sich der
 * Abgleich ohne einen ganzen Server testen lässt (Kontext-Parameter statt
 * `this`). Was hier steht, läuft beim BOOT, nachdem der Spielstand geladen
 * ist: So erscheinen neue Platzierungen auch in bereits generierten Zonen.
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
} as const;

const SKALA_MEMBER = 'scaleScalar';
const SKALA_HASH = getStableHash(SKALA_MEMBER);

/** Spielerbauten gehören dem Spieler, nicht dem Dokument. */
function istSpielerbau(zdo: ZDO): boolean {
  return zdo.getInt('spieler') === 1;
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
}

/**
 * Handplatzierte Objekte des WorldLayouts materialisieren.
 *
 * Idempotent über eine Kennung im ZDO-Member `layoutId`, ersatzweise eine
 * Nähe-Prüfung (gleiches Prefab < 0,5 m) — persistente ZDOs aus dem Save
 * werden nicht dupliziert. Entfernt werden ZDOs, deren Eintrag der
 * Designer gelöscht hat.
 *
 * Ein gefundenes ZDO wird an das Dokument ANGEGLICHEN: Position, Drehung
 * und Skalierung. Ohne das wäre jede Änderung im Editor, die die Kennung
 * (Prefab + auf Meter gerundete Position) nicht ändert, nach dem Neustart
 * unsichtbar — Drehen, Skalieren, Verschieben um weniger als einen Meter.
 * Spielerbauten (`spieler=1`) sind für den Abgleich unsichtbar: Sie werden
 * weder gefunden noch verschoben noch entfernt.
 *
 * Hier werden auch die Routen verdrahtet: Trägt eine Platzierung eine
 * `route`, übernimmt der RoutenLaeufer die ZDO (s. dort).
 */
export function layoutAbgleich(kontext: LayoutAbgleichKontext, layout: WorldLayout): LayoutAbgleichErgebnis {
  const { zdos } = kontext;
  const ergebnis: LayoutAbgleichErgebnis = {
    gespawnt: 0,
    aktualisiert: 0,
    unveraendert: 0,
    entfernt: 0,
    unbekannt: 0,
    aufRoute: 0,
  };
  // Kennung je Eintrag: Prefab + gerundete Position (layoutKennung in
  // shared). Damit lassen sich beim Boot ZDOs entfernen, deren Eintrag der
  // Designer gelöscht hat (vorher blieben sie für immer stehen,
  // Review-Punkt 13) — und der Client findet über denselben Member den
  // Layout-Eintrag zu einer Instanz wieder (Namensschild).
  const kennung = layoutKennung;
  const gewollt = new Set((layout.placements ?? []).map(kennung));
  // Im selben Durchlauf einen Index über die Kennung aufbauen: Ein
  // Routen-NPC ist beim nächsten Boot IRGENDWO auf seiner Runde, die
  // Nähe-Prüfung unten fände ihn also nicht wieder und spawnte bei jedem
  // Start einen weiteren. Die Kennung wandert dagegen mit ihm mit.
  const nachKennung = new Map<string, ZDO>();
  for (const zdo of zdos.getAllZDOs()) {
    const id = zdo.getString(LAYOUT_ID_MEMBER);
    if (!id || istSpielerbau(zdo)) continue;
    if (!gewollt.has(id)) {
      zdos.destroyZDO(zdo.zdoid);
      ergebnis.entfernt++;
      continue;
    }
    nachKennung.set(id, zdo);
  }
  const routen = new Map((layout.routes ?? []).map((r) => [r.id, r]));
  for (const p of layout.placements ?? []) {
    const prefab = kontext.prefabs.getByName(p.prefab);
    if (!prefab) {
      ergebnis.unbekannt++;
      continue;
    }
    const y = kontext.bodenHoehe(p.x, p.z) + kontext.bodenAbstand(prefab.hash);
    const pos = { x: p.x, y, z: p.z };
    let zdo = nachKennung.get(kennung(p));
    if (zdo && zdo.prefabHash !== prefab.hash) zdo = undefined;
    if (!zdo) {
      const vorhanden = zdos
        .getZDOsInRadius(pos, 1)
        .find(
          (z) =>
            z.prefabHash === prefab.hash &&
            !istSpielerbau(z) &&
            Math.hypot(z.position.x - p.x, z.position.z - p.z) < 0.5
        );
      zdo = vorhanden;
    }
    if (!zdo) {
      zdo = zdos.createZDO(prefab.hash, pos);
      zdo.rotation = yawQuaternion(p.yaw ?? 0);
      const skala = sollSkala(p);
      if (skala !== 0) zdo.setFloat(SKALA_MEMBER, skala);
      zdo.setString(LAYOUT_ID_MEMBER, kennung(p));
      ergebnis.gespawnt++;
    } else {
      let geschrieben = false;
      if (zdo.getString(LAYOUT_ID_MEMBER) !== kennung(p)) {
        // Über die NÄHE wiedergefunden (ZDO aus einem Save von vor der
        // Kennung): Member nachtragen. Sonst bliebe das Objekt für immer
        // ohne Herkunft — der Client könnte ihm kein Namensschild
        // zuordnen, und beim nächsten Löschen im Editor bliebe es stehen.
        zdo.setString(LAYOUT_ID_MEMBER, kennung(p));
        geschrieben = true;
      }
      if (gleicheAn(zdos, zdo, p, pos, laeuftRoute(layout, p))) geschrieben = true;
      if (geschrieben) ergebnis.aktualisiert++;
      else ergebnis.unveraendert++;
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
  return ergebnis;
}

/** Skalierung, wie sie im ZDO stehen soll: 0 = kein Member (Prefab-Vorgabe). */
function sollSkala(p: PlacementDef): number {
  return p.scale !== undefined && Math.abs(p.scale - 1) > TOLERANZ.skala ? p.scale : 0;
}

/**
 * Drehung, Skalierung und (außer bei Routen-NPCs) Position eines gefundenen
 * ZDO auf die Platzierung setzen — aber NUR, was sich um mehr als die
 * Toleranz unterscheidet. Gibt zurück, ob etwas geschrieben wurde.
 */
function gleicheAn(
  zdos: ZDOManager,
  zdo: ZDO,
  p: PlacementDef,
  soll: { x: number; y: number; z: number },
  folgtRoute: boolean
): boolean {
  let geaendert = false;
  // Lage und Drehung gehören bei einem Routen-NPC dem Läufer: Er steht
  // irgendwo auf seiner Runde und schaut in Laufrichtung.
  if (!folgtRoute) {
    const q = yawQuaternion(p.yaw ?? 0);
    const r = zdo.rotation;
    // q und -q sind dieselbe Drehung — der Betrag des Skalarprodukts zählt.
    const skalar = Math.abs(q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w);
    if (1 - skalar > TOLERANZ.drehung) {
      zdo.rotation = q;
      geaendert = true;
    }
    const pos = zdo.position;
    if (
      Math.abs(pos.x - soll.x) > TOLERANZ.lage ||
      Math.abs(pos.z - soll.z) > TOLERANZ.lage ||
      Math.abs(pos.y - soll.y) > TOLERANZ.hoehe
    ) {
      // Über den Manager, damit ein Sprung über eine Zonengrenze das ZDO
      // auch im Zonenindex umhängt.
      zdos.updateZDOZone(zdo, { x: soll.x, y: soll.y, z: soll.z });
      geaendert = true;
    }
    if (geaendert) {
      zdo.revision.reviseData();
      zdo.dirty = true;
    }
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

/**
 * Layout-Objekte beim Laden auf die aktuelle Bodenhöhe setzen.
 *
 * Die y-Werte im Spielstand stammen aus dem Boden ZUM SPEICHERZEITPUNKT.
 * Ändert der Designer danach das Gelände (Region, Fluss, Einebnen), schweben
 * Häuser oder stecken im Hang — bisher setzte der Server nur Vegetation
 * nach, Layout-Objekte nicht. Ausgenommen sind Spielerbauten (`spieler=1`,
 * sie stehen dort, wo der Spieler sie hingestellt hat) und Routen-NPCs
 * (die Höhe schreibt der Läufer bei jedem Schritt selbst).
 *
 * Gibt die Zahl der bewegten ZDOs zurück.
 */
export function layoutObjekteAufBoden(
  zdos: ZDOManager,
  layout: WorldLayout,
  bodenHoehe: (x: number, z: number) => number,
  bodenAbstand: (prefabHash: number) => number
): number {
  const aufRoute = new Set((layout.placements ?? []).filter((p) => laeuftRoute(layout, p)).map(layoutKennung));
  let bewegt = 0;
  for (const zdo of zdos.getAllZDOs()) {
    const id = zdo.getString(LAYOUT_ID_MEMBER);
    if (!id || istSpielerbau(zdo) || aufRoute.has(id)) continue;
    const soll = bodenHoehe(zdo.position.x, zdo.position.z) + bodenAbstand(zdo.prefabHash);
    if (Math.abs(zdo.position.y - soll) <= TOLERANZ.hoehe) continue;
    zdo.position = { x: zdo.position.x, y: soll, z: zdo.position.z };
    zdo.revision.reviseData();
    zdo.dirty = true;
    bewegt++;
  }
  return bewegt;
}
