/**
 * layoutAbgleich — gleicht die handplatzierten Objekte des WorldLayouts
 * (Editor-Spawn) mit den ZDOs der Welt ab.
 *
 * Aus `WovServer.spawnLayoutPlacements` herausgezogen, damit sich der
 * Abgleich ohne einen ganzen Server testen lässt (Kontext-Parameter statt
 * `this`). Was hier steht, läuft beim BOOT, nachdem der Spielstand geladen
 * ist: So erscheinen neue Platzierungen auch in bereits generierten Zonen.
 */

import type { RouteDef, WorldLayout } from '@wov/shared';
import { HEALTH_MEMBER, LAYOUT_ID_MEMBER, istNpcPrefab, layoutKennung, maxLeben } from '@wov/shared';
import type { ZDO } from '../zdo/ZDO.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';

/** Alles, was der Abgleich von der Welt braucht. */
export interface LayoutAbgleichKontext {
  readonly zdos: ZDOManager;
  readonly prefabs: { getByName(name: string): { readonly hash: number } | undefined };
  /** Geländehöhe der Hauptwelt (getGroundHeight) — IMMER die Quelle des y. */
  readonly bodenHoehe: (x: number, z: number) => number;
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
 * Hier werden auch die Routen verdrahtet: Trägt eine Platzierung eine
 * `route`, übernimmt der RoutenLaeufer die ZDO (s. dort).
 */
export function layoutAbgleich(kontext: LayoutAbgleichKontext, layout: WorldLayout): LayoutAbgleichErgebnis {
  const { zdos } = kontext;
  const ergebnis: LayoutAbgleichErgebnis = { gespawnt: 0, entfernt: 0, unbekannt: 0, aufRoute: 0 };
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
    if (!id) continue;
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
    const y = kontext.bodenHoehe(p.x, p.z);
    const pos = { x: p.x, y, z: p.z };
    let zdo = nachKennung.get(kennung(p));
    if (zdo && zdo.prefabHash !== prefab.hash) zdo = undefined;
    if (!zdo) {
      const vorhanden = zdos
        .getZDOsInRadius(pos, 1)
        .find((z) => z.prefabHash === prefab.hash && Math.hypot(z.position.x - p.x, z.position.z - p.z) < 0.5);
      zdo = vorhanden;
    }
    if (!zdo) {
      const yaw = p.yaw ?? 0;
      zdo = zdos.createZDO(prefab.hash, pos);
      zdo.rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
      if (p.scale !== undefined && Math.abs(p.scale - 1) > 1e-3) zdo.setFloat('scaleScalar', p.scale);
      zdo.setString(LAYOUT_ID_MEMBER, kennung(p));
      ergebnis.gespawnt++;
    } else if (zdo.getString(LAYOUT_ID_MEMBER) !== kennung(p)) {
      // Über die NÄHE wiedergefunden (ZDO aus einem Save von vor der
      // Kennung): Member nachtragen. Sonst bliebe das Objekt für immer
      // ohne Herkunft — der Client könnte ihm kein Namensschild
      // zuordnen, und beim nächsten Löschen im Editor bliebe es stehen.
      zdo.setString(LAYOUT_ID_MEMBER, kennung(p));
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
