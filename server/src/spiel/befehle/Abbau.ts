/**
 * Admin command `abbau`: removes placed prefabs around the admin again. It was a method of
 * `WovServer` and moved here as a function with a context (refactoring I1, step 1): `k` is the
 * server itself, `this` became `k`, nothing else changed. `WovServer` keeps a forwarding
 * method with the same name, and its constructor still calls it.
 */

import type { SpielKontext } from '../Kontext.js';

/** What this module uses of the server: 3 members. */
type AbbauKontext = SpielKontext<'adminCommands' | 'prefabs' | 'zdosVon'>;

/**
 * `abbau <prefab> [radius]` — gespawnte Prefabs wieder entfernen.
 *
 * Das Gegenstück zu `spawn`, und es hat bis jetzt gefehlt: Wer sich
 * beim Testen einen NPC an die falsche Stelle gesetzt hat, bekam ihn
 * nur über einen Welt-Reset wieder weg (der Kommentar an
 * spawnLayoutPlacements verweist bereits auf einen "Admin-Abbau", den
 * es nie gab). Persistente Prefabs überleben den Save, ein Fehlgriff
 * bleibt also für immer stehen.
 *
 * Der Radius ist bewusst klein vorbelegt (10 m) und gedeckelt (200 m):
 * `abbau Beech1 5000` würde sonst einen halben Wald abräumen, und
 * zerstörte ZDOs kommen nicht zurück.
 */
function registerAbbauCommand(k: AbbauKontext): void {
  k.adminCommands.register('abbau', (peer, args) => {
    const name = args[0];
    if (!name) {
      return { ok: false, active: false, message: 'Aufruf: abbau <prefab> [radius]' };
    }
    const prefab =
      k.prefabs.getByName(name) ??
      k.prefabs.getAll().find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!prefab) {
      return { ok: false, active: false, message: `Unbekanntes Prefab: ${name}` };
    }
    const radius = Math.min(200, Math.max(1, Number(args[1]) || 10));
    let weg = 0;
    for (const zdo of k.zdosVon(peer).getZDOsInRadius(peer.position, radius)) {
      if (zdo.prefabHash !== prefab.hash) continue;
      k.zdosVon(peer).destroyZDO(zdo.zdoid);
      weg++;
    }
    return {
      ok: true,
      active: false,
      message: `${weg}× ${prefab.name} im Umkreis von ${radius} m entfernt`,
    };
  });
}

export { registerAbbauCommand };
