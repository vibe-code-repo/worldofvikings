/**
 * Spatial index of the static instances: the four functions that fill, move,
 * empty and query it. They were methods of EntityManager and moved here as
 * functions with a context: `k` is the instance itself, `this` became `k`,
 * nothing else changed. The class keeps the two fields (`zellen`, `indexVon`),
 * the accessor `indexStats` and one forwarding method per function. Calls
 * between the four go through `k`, so a stub set on the instance stays in
 * effect.
 */

import { INDEX_ZELLE_M, zellenSchluessel } from './konstanten';
import type { EntityKontext } from './kontext';
import type { StatischeInstanz, IndexEintrag } from './typen';

/** What this module uses of the class: two fields and one method, 3 members. */
type RaumIndexKontext = EntityKontext<'zellen' | 'indexVon' | 'ausZelleLoesen'>;

/**
 * Alle statischen Instanzen im Umkreis, mit Prefab-Namen.
 *
 * Für das Namens-Overlay (Einstellung "Objektnamen anzeigen"): Anders als
 * colliderPositions() listet das ALLES, was in der Welt steht — auch
 * Deko und Aufsammelbares ohne Kollisionskörper. Genau das braucht man,
 * um ein unbekanntes Objekt zu identifizieren.
 */
function nearbyInstances(
  k: RaumIndexKontext,
  x: number,
  z: number,
  radius: number,
  aus: StatischeInstanz[] = []
): StatischeInstanz[] {
  aus.length = 0;
  const r2 = radius * radius;
  const cx0 = Math.floor((x - radius) / INDEX_ZELLE_M);
  const cx1 = Math.floor((x + radius) / INDEX_ZELLE_M);
  const cz0 = Math.floor((z - radius) / INDEX_ZELLE_M);
  const cz1 = Math.floor((z + radius) / INDEX_ZELLE_M);
  // Das umschliessende QUADRAT der Zellen, danach der exakte Kreistest je
  // Instanz. Zellen kreisförmig vorzufiltern lohnt sich nicht: Bei den
  // hier üblichen 1 bis 25 Zellen kostet die Ecke weniger als die
  // Rechnung, die sie einsparen würde.
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const liste = k.zellen.get(zellenSchluessel(cx, cz));
      if (liste === undefined) continue;
      for (let i = 0; i < liste.length; i++) {
        const e = liste[i]!;
        const dx = e.x - x;
        const dz = e.z - z;
        if (dx * dx + dz * dz > r2) continue;
        aus.push(e);
      }
    }
  }
  return aus;
}

/**
 * Instanz im Index anlegen ODER verschieben.
 *
 * Der zweite Fall ist nicht theoretisch: Statische ZDOs bekommen im
 * Editor und beim Terrain-Werkzeug neue Positionen, und der Server
 * schickt für dasselbe ZDO wiederholt Updates. Bleibt die Zelle
 * dieselbe, wird nur die Position nachgezogen — das ist der Normalfall
 * und kostet dann keinen Listenumbau.
 */
function indexSetzen(k: RaumIndexKontext, key: string, prefab: string, x: number, y: number, z: number): void {
  const zelle = zellenSchluessel(
    Math.floor(x / INDEX_ZELLE_M),
    Math.floor(z / INDEX_ZELLE_M)
  );
  let e = k.indexVon.get(key);
  if (e) {
    e.prefab = prefab;
    e.x = x;
    e.y = y;
    e.z = z;
    if (e.zelle === zelle) return;
    k.ausZelleLoesen(e);
    e.zelle = zelle;
  } else {
    e = { prefab, x, y, z, zelle, platz: 0 };
    k.indexVon.set(key, e);
  }
  let liste = k.zellen.get(zelle);
  if (!liste) {
    liste = [];
    k.zellen.set(zelle, liste);
  }
  e.platz = liste.length;
  liste.push(e);
}

/** Eintrag aus seiner Zellenliste nehmen (Swap-Remove, O(1)). */
function ausZelleLoesen(k: RaumIndexKontext, e: IndexEintrag): void {
  const liste = k.zellen.get(e.zelle);
  if (!liste) return;
  const letzter = liste[liste.length - 1]!;
  liste[e.platz] = letzter;
  letzter.platz = e.platz;
  liste.length--;
  // Leere Zellen wieder wegwerfen, sonst wächst die Map beim Durchlaufen
  // der Welt monoton mit — jede je betretene Zelle bliebe für immer als
  // leeres Array liegen und verlangsamte nichts, belegte aber Speicher.
  if (liste.length === 0) k.zellen.delete(e.zelle);
}

/** Instanz aus dem Index nehmen — Gegenstück zu indexSetzen(). */
function indexEntfernen(k: RaumIndexKontext, key: string): void {
  const e = k.indexVon.get(key);
  if (!e) return;
  k.ausZelleLoesen(e);
  k.indexVon.delete(key);
}

export { nearbyInstances, indexSetzen, ausZelleLoesen, indexEntfernen };
