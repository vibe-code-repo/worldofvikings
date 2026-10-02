/**
 * Chat command `admin` of the game server (the permanent admin list) and the re-check of the rights of
 * open sessions against that list. They were methods of `WovServer` and moved here as functions with a
 * context (refactoring I1, step 1): `k` is the server itself, `this` became `k`, nothing else changed.
 * `WovServer` keeps one forwarding method per function; calls to other methods of the server go
 * through `k`, so a stand-in set on the instance stays in effect.
 */

import { PacketType } from '@wov/shared';
import { NAME_NICHT_EINDEUTIG } from '../Konstanten.js';
import type { SpielKontext } from '../Kontext.js';

/** What this module uses of the server: 6 members. */
type AdminListeKontext = SpielKontext<'adminCommands' | 'adminListe' | 'spielerIdFuerName' | 'gleicheAdminrechteAb' | 'config' | 'net'>;

/**
 * `admin <sub> ...` — dauerhafte Admin-Liste ueber stabile Spieler-IDs
 * (Roadmap S6, Security-Review):
 *
 *   admin liste              alle dauerhaften Admins (Name + spielerId)
 *   admin add <Name>         Spieler dauerhaft zum Admin machen
 *   admin remove <Name>      Spieler wieder entfernen
 *
 * Laeuft wie jeder andere Admin-Befehl durch canUseAdminCommands()
 * (peer.isAdmin), ganz bewusst: das Recht, die Liste zu PFLEGEN, ist
 * selbst ein Admin-Recht. Seit Paket 0.1 (everyone-admin: false)
 * entscheidet ausschliesslich noch diese Liste, wer diesen Befehl (und
 * alle anderen) ueberhaupt nutzen darf — und ihr erster Eintrag kommt
 * vom Adminkonto aus `standard-konto:` (StandardKonto.ts), weil sich
 * eine leere Liste sonst nie fuellen liesse.
 *
 * Namensaufloesung ueber spielerIdFuerName(): der Zielspieler muss
 * schon einmal verbunden gewesen sein (online ODER in savedPlayers) —
 * ein rein erfundener Name kann nicht zum Admin gemacht werden, es gibt
 * dafuer keine spielerId zum Eintragen.
 */
function registerAdminListeCommands(k: AdminListeKontext): void {
  k.adminCommands.register('admin', (peer, args) => {
    const sub = (args.shift() ?? '').toLowerCase();

    if (sub === 'liste' || sub === 'list') {
      const eintraege = k.adminListe.alle();
      if (eintraege.length === 0) {
        return { ok: true, active: false, message: 'Admin-Liste ist leer' };
      }
      const zeilen = eintraege.map((e) => `${e.name} [${e.spielerId}]`).join(', ');
      return { ok: true, active: false, message: `${eintraege.length} dauerhafte Admins: ${zeilen}` };
    }

    if (sub === 'add' || sub === 'hinzufuegen') {
      const name = args.join(' ').trim();
      if (!name) return { ok: false, active: false, message: 'Aufruf: admin add <Name>' };
      const id = k.spielerIdFuerName(name);
      if (id === NAME_NICHT_EINDEUTIG) return { ok: false, active: false, message: 'Spieler nicht eindeutig gefunden' };
      if (!id) {
        return { ok: false, active: false,
          message: `Unbekannter Spieler: "${name}" (muss schon einmal verbunden gewesen sein)` };
      }
      const neu = k.adminListe.hinzufuegen(id, name);
      // Sofort an den offenen Sitzungen nachziehen — in BEIDE
      // Richtungen, Begruendung bei gleicheAdminrechteAb().
      if (neu) k.gleicheAdminrechteAb();
      return { ok: true, active: false,
        message: neu ? `${name} [${id}] ist jetzt dauerhaft Admin` : `${name} war schon Admin` };
    }

    if (sub === 'remove' || sub === 'entfernen') {
      const name = args.join(' ').trim();
      if (!name) return { ok: false, active: false, message: 'Aufruf: admin remove <Name>' };
      const id = k.spielerIdFuerName(name);
      if (id === NAME_NICHT_EINDEUTIG) return { ok: false, active: false, message: 'Spieler nicht eindeutig gefunden' };
      if (!id) {
        return { ok: false, active: false, message: `Unbekannter Spieler: "${name}"` };
      }
      /*
        Der LETZTE Admin darf sich nicht selbst aussperren.

        Dieselbe Bremse steht schon beim `bann`-Befehl, und aus genau
        demselben Grund (dort ausfuehrlich begruendet): Seit
        `everyone-admin: false` ist diese Liste der einzige Weg zu
        Rechten, und `admin add` braucht einen Admin. Wer den letzten
        Eintrag entfernt, hat einen Server ohne jeden Admin — zurueck
        kommt man nur noch ueber die Datei auf der Platte oder die
        Adminroute des Betriebsdienstes, also nur mit Zugang zur
        Maschine. Das ist eine Huerde in der Bedienung, keine Ausnahme
        in der Berechtigung: Wer wirklich alle Admins loswerden will,
        traegt vorher einen zweiten ein und entfernt dann beide, oder
        er nimmt den Weg ueber den Betriebsdienst.
      */
      if (k.adminListe.enthaelt(id) && k.adminListe.anzahl <= 1) {
        return { ok: false, active: false,
          message: `${name} ist der letzte Admin. Erst "admin add <Name>" fuer jemand anderen, sonst steht der Server ohne Admin da.` };
      }
      const weg = k.adminListe.entfernen(id);
      // Wirkung SOFORT, nicht erst beim naechsten Anmelden: Ein
      // uebernommenes Adminkonto ist genau der Fall, in dem man nicht
      // warten kann, bis der andere von sich aus die Verbindung
      // beendet (Befund 3).
      if (weg) k.gleicheAdminrechteAb();
      return { ok: true, active: false,
        message: weg ? `${name} [${id}] ist kein dauerhafter Admin mehr` : `${name} war nicht in der Admin-Liste` };
    }

    return { ok: false, active: false,
      message: 'Aufruf: admin liste | admin add <Name> | admin remove <Name>' };
  });
}

/**
 * Die Rechte OFFENER Sitzungen an die Adminliste angleichen.
 * Re-check every open session against the admin list.
 *
 * ── Das Problem ─────────────────────────────────────────────────────
 * `peer.isAdmin` entstand bisher genau EINMAL, im Handshake
 * (NetManager.handlePasswordAuth), und wurde danach nie wieder gegen
 * die Liste gehalten. Ein Angreifer-Skript hat auf EINER offenen
 * Verbindung `admin remove Admin` ausgefuehrt — Liste danach
 * nachweislich leer — und unmittelbar danach, ohne neu zu verbinden,
 * `fly` benutzt: "Fly mode ON" (Befund 3, 13.09.2026). Ein
 * uebernommenes Adminkonto blieb also bis zum SELBSTGEWAEHLTEN
 * Verbindungsende voll handlungsfaehig, und das ist genau der Fall, in
 * dem man sofortige Wirkung braucht.
 *
 * ── Warum nachziehen und nicht trennen ──────────────────────────────
 * `bann` und `kick` trennen (net.trenneGebannte()), weil dort die
 * PERSON weg soll. Hier soll sie bleiben: `admin remove` nimmt Rechte,
 * kein Spielrecht — wer gerade in einem Dungeon steht, soll dafuer
 * nicht aus der Welt fliegen. Getrennt wird deshalb nicht; entzogen
 * wird sofort. Der Unterschied zu heute ist nicht die Haerte, sondern
 * dass der stille Zustand "Liste sagt nein, Sitzung sagt ja" nicht
 * mehr existiert.
 *
 * Der Flug hoert mit dem Recht auf: Er ist die einzige Adminwirkung,
 * die OHNE weiteren Befehl weiterlaeuft (handlePlayerInput fragt nur
 * `peer.flying` ab, nicht `peer.isAdmin`) — bliebe er stehen, koennte
 * ein Entzogener die Welt weiter ueberfliegen.
 *
 * ── Beide Richtungen ────────────────────────────────────────────────
 * Auch das Hinzufuegen wirkt sofort. Dieselbe Begruendung von der
 * anderen Seite: "Liste sagt ja, Sitzung sagt nein" ist genauso
 * unerklaerlich, und ein frisch ernannter Admin, der sich erst neu
 * verbinden muss, ist einfach nur kaputt.
 *
 * Aufgerufen von `admin add`/`admin remove` und im Sekundentakt aus
 * update(). Der Takt ist noetig, weil die Liste auch von AUSSEN
 * wandert (Adminroute des Betriebsdienstes, Handanlegen an der Datei —
 * AdminListe.abgleichen liest die Datei dann neu ein); ohne ihn
 * bliebe die Luecke fuer genau diese Wege offen. Er kostet eine
 * `alle()`-Abfrage je Sekunde, also ein statSync und im Regelfall
 * keinen einzigen Dateizugriff mehr.
 */
function gleicheAdminrechteAb(k: AdminListeKontext): void {
  // Bei `everyone-admin: true` ist die Liste nicht das Tor (s.
  // NetManager.handlePasswordAuth: ODER-Verknuepfung). Dann darf ein
  // fehlender Listeneintrag auch keine Rechte wegnehmen.
  if (k.config.everyoneAdmin) return;
  const berechtigt = new Set(k.adminListe.alle().map((e) => e.spielerId));
  for (const peer of k.net.getPeers()) {
    // Ohne spielerId gibt es nichts abzugleichen (noch nicht
    // angemeldet) — und ein leerer String darf nie in der Menge
    // stehen, sonst haengte die Berechtigung an einer Leerstelle.
    if (!peer.spielerId) continue;
    const soll = berechtigt.has(peer.spielerId);
    if (soll === peer.isAdmin) continue;
    peer.isAdmin = soll;
    if (!soll && peer.flying) {
      peer.flying = false;
      peer.sendPacketWith(PacketType.AdminEvent, (w) => {
        w.writeString('fly');
        w.writeBool(false);
        w.writeString('Fly mode OFF (Adminrechte entzogen)');
      });
    }
    peer.sendPacketWith(PacketType.AdminEvent, (w) => {
      w.writeString('admin');
      w.writeBool(false);
      w.writeString(soll ? 'Du hast jetzt Adminrechte.' : 'Deine Adminrechte wurden entzogen.');
    });
    console.log(`[Admin] "${peer.name}" — Rechte an der Liste nachgezogen: isAdmin=${soll}`);
  }
}

export { registerAdminListeCommands, gleicheAdminrechteAb };
