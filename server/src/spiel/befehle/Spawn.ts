/**
 * Admin commands `item` (give an item, deliver a test set, also to an absent player) and `spawn`
 * (place a prefab). They were one method of `WovServer` and moved here as a function with a
 * context (refactoring I1, step 1): `k` is the server itself, `this` became `k`, nothing else
 * changed. `WovServer` keeps a forwarding method with the same name; calls to other methods of
 * the server go through `k`, so a stand-in set on the instance stays in effect.
 */

import { IRONWARD_PARTS, WILDWARDEN_PARTS, Inventory, findItem, ITEMS_BY_NAME } from '@wov/shared';
import { namenSchluessel } from '../../net/Namen.js';
import type { SpielKontext } from '../Kontext.js';

/** What this module uses of the server: 12 members. */
type SpawnKontext = SpielKontext<'adminCommands' | 'speichertGerade' | 'net' | 'savedPlayers' | 'inventarSync' | 'sichereSpielerSofort' | 'stempelZaehler' | 'spielerSicherung' | 'saveWorldAsync' | 'prefabs' | 'getGroundHeight' | 'zdosVon'>;

/**
 * `spawn <prefab> [x z]` — ein Prefab in die Welt setzen (Standard: 2 m
 * vor dem Spieler). Trägt das Prefab das PERSISTENT-Flag, überlebt es
 * den Welt-Save — so kommen eigene NPCs dauerhaft in die Welt.
 */
function registerSpawnCommand(k: SpawnKontext): void {
  // item give <Name> [Anzahl] — legt einen Gegenstand ins eigene
  // Inventar (10.09.2026). Gebaut, damit bestehende Charaktere, die die
  // Startausruestung laengst haben, neue Gegenstaende wie das Nordschwert
  // zum Ausprobieren bekommen, ohne dass man den Spielstand anfasst.
  k.adminCommands.register('item', (peer, args) => {
    const sub = (args.shift() ?? '').toLowerCase();
    // Explicit, idempotent test-set delivery, including offline characters.
    // Stage the whole inventory first: a full bag must never get half a set.
    if (sub === 'ironward' || sub === 'wildwarden') {
      const parts = sub === 'ironward' ? IRONWARD_PARTS : WILDWARDEN_PARTS;
      const label = sub === 'ironward' ? 'Ironward' : 'Waldhüter';
      if (k.speichertGerade) return { ok: false, active: false, message: 'Sicherung läuft; bitte gleich erneut versuchen. Nichts verändert.' };
      const name = args.join(' ').trim();
      if (!name) return { ok: false, active: false, message: `Aufruf: item ${sub} <Spielername>` };
      const online = k.net.getPeers().filter(p => !p.nurEditor && namenSchluessel(p.name) === namenSchluessel(name));
      const saved = [...k.savedPlayers.entries()].filter(([, p]) => namenSchluessel(p.name) === namenSchluessel(name));
      if (online.length > 1 || (!online.length && saved.length !== 1)) return { ok: false, active: false, message: 'Spieler nicht eindeutig gefunden' };
      const target = online[0]; const record = saved[0];
      if ((target?.figur ?? record?.[1].figur) !== 'wikinger') return { ok: false, active: false, message: `${label} benötigt den männlichen Wikinger-Körper` };
      const snapshot = target?.inventar.serialize() ?? record?.[1].inventar;
      if (!snapshot) return { ok: false, active: false, message: 'Kein gespeichertes Inventar vorhanden' };
      const staged = target ? target.inventar.kopie() : Inventory.ausSpeicherstand(snapshot); let added = 0;
      for (const part of parts) {
        if (staged.countOf(part.item)) continue;
        if (staged.addItem(findItem(part.item)!, 1)) return { ok: false, active: false, message: 'Nicht genug Platz für das vollständige Set; nichts verändert' };
        added++;
      }
      if (target) { target.inventar.uebernimm(staged); k.inventarSync(target); k.sichereSpielerSofort(target, 'admin'); }
      else {
        // F8 N2 (B4): ein Eingriff an einem ABWESENDEN Spieler bekommt einen neuen
        // Stempel und geht sofort in die Konten-SQLite: sonst gewinnt beim
        // Neustart die aeltere Zeile mit dem Stempel vom Abmelden (oder der
        // Eingriff fehlt nach einem Kill bis zum naechsten Weltspeichern).
        record![1].inventar = staged.serialize();
        record![1].gespeichertAm = k.stempelZaehler().naechster();
        k.spielerSicherung?.sichere([record![1]], 'admin');
      }
      void k.saveWorldAsync();
      return { ok: true, active: false, message: `${name}: ${label} vollständig (7/7), ${added} neue Gegenstände. Sicherung angefordert.` };
    }
    if (sub !== 'give' && sub !== 'gib') {
      return { ok: false, active: false, message: 'Aufruf: item give <Name> [Anzahl]' };
    }
    const name = args[0];
    if (!name) return { ok: false, active: false, message: 'Aufruf: item give <Name> [Anzahl]' };
    const def = findItem(name)
      ?? [...ITEMS_BY_NAME.values()].find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (!def) return { ok: false, active: false, message: `Unbekannter Gegenstand: ${name}` };
    const menge = Math.max(1, Math.floor(Number(args[1]) || 1));
    const rest = peer.inventar.addItem(def, menge);
    k.inventarSync(peer);
    const drin = menge - rest;
    return { ok: drin > 0, active: false,
      message: drin > 0
        ? `${drin}× ${def.label} ins Inventar gelegt${rest > 0 ? ` (${rest} passten nicht)` : ''}`
        : `Kein Platz im Inventar für ${def.label}` };
  });

  k.adminCommands.register('spawn', (peer, args) => {
    const name = args[0];
    if (!name) {
      return { ok: false, active: false, message: 'Aufruf: spawn <prefab> [x z]' };
    }
    // Exakter Name zuerst, sonst case-insensitiv über die Registry.
    let prefab = k.prefabs.getByName(name);
    if (!prefab) {
      const norm = name.toLowerCase();
      for (const p of k.prefabs.getAll()) {
        if (p.name.toLowerCase() === norm) {
          prefab = p;
          break;
        }
      }
    }
    if (!prefab) {
      return { ok: false, active: false, message: `Unbekanntes Prefab: ${name}` };
    }

    const hatKoordinaten = Number.isFinite(Number(args[1])) && Number.isFinite(Number(args[2]));
    const x = hatKoordinaten ? Number(args[1]) : peer.position.x + 2;
    const z = hatKoordinaten ? Number(args[2]) : peer.position.z + 2;
    // Auf den BODEN, nicht auf den Wasserspiegel.
    //
    // Hier stand `Math.max(getGroundHeight(x, z), WATER_LEVEL)`, damit
    // nichts auf dem Meeresgrund landet. In den Layout-Welten ist das
    // aber falsch: WATER_LEVEL ist die aus der radialen Weltgenerierung
    // übernommene Konstante 30, das Gelände dieser Welt liegt bei rund -55. Der Ausdruck
    // lieferte deshalb IMMER 30 — jedes gespawnte Prefab hing 85 m über
    // dem Boden.
    //
    // Nachgemessen im laufenden Client (__vb.dynPose/__vb.groundAt):
    // `spawn FurlocFischer` ergab y = 30 bei Geländehöhe -55,5, und
    // `spawn NPC_1` genauso. Es lag also nie am Modell — die
    // gemeldete "im Boden versunkene" Figur war eine, die 85 m daneben
    // stand. Layout-Platzierungen waren nie betroffen, die nehmen
    // getGroundHeight direkt (s. spawnLayoutPlacements).
    const y = k.getGroundHeight(x, z);

    const zdo = k.zdosVon(peer).createZDO(prefab.hash, { x, y, z });
    // Blick Richtung Spieler, damit ein NPC einen ansieht statt wegzuschauen.
    const dx = peer.position.x - x;
    const dz = peer.position.z - z;
    const yaw = Math.atan2(dx, dz);
    zdo.rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };

    return {
      ok: true,
      active: false,
      message: `${prefab.name} gespawnt bei ${x.toFixed(1)}, ${z.toFixed(1)} (Höhe ${y.toFixed(1)})${
        prefab.isPersistent() ? '' : ' — NICHT persistent'
      }`,
    };
  });
}

export { registerSpawnCommand };
