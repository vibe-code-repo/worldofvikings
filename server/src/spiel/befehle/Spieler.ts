/**
 * Admin commands about players: `teleport <x> <z>` (aware of dungeon instances, it overrides the base command of
 * `AdminCommands`) and `spieler liste | online | entfernen`. They were registered by methods of `WovServer` and moved
 * here as functions with a context (refactoring I1, step 1): `k` is the server itself, `this` became `k`, nothing
 * else changed. `WovServer` keeps one forwarding method per function and calls them from its constructor in the same
 * order as before; the handlers read `k.<member>` on every call, so a stand-in set on the instance stays in effect.
 */

import { namenSchluessel } from '../../net/Namen.js';
import type { SpielKontext } from '../Kontext.js';

/** What this module uses of the server: 7 members. */
type SpielerKontext = SpielKontext<'adminCommands' | 'dungeons' | 'getGroundHeight' | 'teleportPeer' | 'savedPlayers' | 'net' | 'spielerSicherung'>;

function registerTeleportCommand(k: SpielerKontext): void {
  // Den Basis-`teleport` dungeon-bewusst überschreiben: Strg+Klick auf
  // die Weltkarte aus einer Instanz heraus soll den Dungeon sauber
  // verlassen (Buchführung!) statt nur die Koordinaten zu wechseln.
  k.adminCommands.register('teleport', (peer, args) => {
    const x = Number(args[0]);
    const z = Number(args[1]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return { ok: false, active: false, message: 'Aufruf: teleport <x> <z>' };
    }
    if (peer.dungeonId) {
      k.dungeons.getInstance(peer.dungeonId)?.players.delete(peer.userId);
      peer.dungeonId = null;
      peer.dungeonReturn = null;
    }
    // Ebenfalls auf den Boden statt auf WATER_LEVEL — siehe die
    // ausführliche Begründung beim `spawn`-Kommando. Beim Teleport
    // wirkte derselbe Fehler noch unangenehmer: Der Spieler landete
    // 85 m über dem Ziel und fiel die Strecke herunter.
    const y = k.getGroundHeight(x, z);
    k.teleportPeer(peer, { x, y, z }, null);
    return {
      ok: true,
      active: false,
      message: `Teleportiert nach ${x.toFixed(0)}, ${z.toFixed(0)} (Höhe ${y.toFixed(1)})`,
    };
  });
}

function registerSpielerCommand(k: SpielerKontext): void {
  // ── Aufraeumen von Spieler-Datensaetzen (17.08.2026) ─────────────
  //
  // Anlass: Eine Nacht Grafik-Messreihen hat rund zehn Bot-Spieler in
  // der DEV-Welt hinterlassen (RieselBot, Kombi768, Fern601, Tex915 …).
  // `savedPlayers` waechst monoton — jeder Name, der sich je verbunden
  // hat, bleibt in der `players[]`-Sektion, bis ihn jemand entfernt.
  // Auf einer Entwicklungswelt, auf der Testverbindungen die Regel sind,
  // ist das kein Ausnahmefall, sondern der Normalbetrieb.
  //
  // `spieler liste` zeigt, was da ist. `spieler entfernen <name>…` nimmt
  // gezielt Namen heraus — bewusst NUR namentlich, kein Muster und kein
  // "alle ausser mir": Ein Tippfehler in einem Glob loescht sonst
  // Spielstaende, und fuer diese Welt gibt es kein Backup (Roadmap S2).
  // Verbundene Spieler werden uebersprungen; ihr Datensatz wuerde beim
  // naechsten Speichern ohnehin sofort neu geschrieben.
  //
  // F3 (Security-Review): `savedPlayers` ist mittlerweile ueber die
  // stabile spielerId geschluesselt, nicht mehr ueber den Namen — diese
  // Befehle bleiben trotzdem namentlich (so denkt Mike ueber Spieler)
  // und loesen intern ueber das `name`-Feld der Datensaetze auf.
  // `spieler online` zeigt zusaetzlich die spielerId JEDES verbundenen
  // Spielers (S6: Grundlage fuer `admin add <Name>`).
  k.adminCommands.register('spieler', (peer, args) => {
    const sub = (args.shift() ?? 'liste').toLowerCase();
    if (sub === 'liste') {
      const namen = [...k.savedPlayers.values()].map((p) => p.name).sort();
      return { ok: true, active: false,
        message: `${namen.length} Datensaetze: ${namen.join(', ')}` };
    }
    if (sub === 'online') {
      const zeilen = k.net.getPeers().map(
        (p) => `${p.name} [${p.spielerId}]${p.isAdmin ? ' (admin)' : ''}`
      );
      return { ok: true, active: false,
        message: zeilen.length ? zeilen.join(' | ') : 'Niemand online' };
    }
    if (sub === 'entfernen') {
      if (args.length === 0) {
        return { ok: false, active: false, message: 'Aufruf: spieler entfernen <name> [<name> …]' };
      }
      // D2 (Pruefung 3): namenSchluessel statt `===`, sonst meldet
      // `spieler entfernen <andere Schreibung>` "Entfernt" fuer einen
      // Online-Spieler, dessen Datensatz gleich danach beim naechsten
      // Speichern/Trennen neu geschrieben wird — die Meldung war falsch,
      // nicht der Zustand. Editor-Peers bleiben aussen vor: Sie heissen
      // alle "Editor" und wuerden sonst jedes "spieler entfernen editor"
      // auf "verbunden" ziehen, obwohl der Konto-Charakter "Editor"
      // laengst offline ist.
      const verbunden = new Set(
        k.net.getPeers().filter((p) => !p.nurEditor).map((p) => namenSchluessel(p.name))
      );
      const weg: string[] = [];
      const uebersprungen: string[] = [];
      for (const name of args) {
        const schluessel = namenSchluessel(name);
        if (verbunden.has(schluessel)) { uebersprungen.push(`${name} (verbunden)`); continue; }
        // C5 (Pruefung 2): mehrere gespeicherte Treffer sind eine
        // Verwechslungsgefahr wie bei `admin add`/`bann` — nicht still den
        // ersten (aeltesten) loeschen, sondern melden und nichts tun.
        const treffer = [...k.savedPlayers.entries()].filter(([, p]) => namenSchluessel(p.name) === schluessel);
        if (treffer.length === 0) { uebersprungen.push(`${name} (unbekannt)`); continue; }
        if (treffer.length > 1) { uebersprungen.push(`${name} (nicht eindeutig)`); continue; }
        k.savedPlayers.delete(treffer[0][0]);
        k.spielerSicherung?.vergiss([treffer[0][0], treffer[0][1].spielerId ?? '']);
        weg.push(name);
      }
      const rest = k.savedPlayers.size;
      return { ok: true, active: false,
        message: `Entfernt: ${weg.length ? weg.join(', ') : '—'}` +
          (uebersprungen.length ? ` | Uebersprungen: ${uebersprungen.join(', ')}` : '') +
          ` | Noch ${rest} Datensaetze (wird beim naechsten Speichern geschrieben)` };
    }
    return { ok: false, active: false, message: 'Aufruf: spieler liste | spieler online | spieler entfernen <name> …' };
  });
}

export { registerTeleportCommand, registerSpielerCommand };
