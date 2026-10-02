/**
 * Chat commands `kick`, `bann` and `entbann` of the game server (the operation of the ban list). They
 * were one method of `WovServer` and moved here as a function with a context (refactoring I1, step 1):
 * `k` is the server itself, `this` became `k`, nothing else changed. `WovServer` keeps a
 * forwarding method with the same name; the bans are stored in `Kontendatenbank.ts`.
 */

import { namenSchluessel } from '../../net/Namen.js';
import { NAME_NICHT_EINDEUTIG } from '../Konstanten.js';
import type { BannArt } from '../../konto/Kontendatenbank.js';
import type { SpielerId } from '../../net/Identitaet.js';
import type { SpielKontext } from '../Kontext.js';

/** What this module uses of the server: 5 members. */
type BannKontext = SpielKontext<'adminListe' | 'kontenDb' | 'adminCommands' | 'net' | 'spielerIdFuerName'>;

/**
 * `kick` / `bann` / `entbann` — die Bedienoberflaeche der Bannliste
 * (Paket 0.5; die Datenhaltung steht in Kontendatenbank.ts, das
 * Hinauswerfen in NetManager.trenneGebannte()).
 *
 * Warum diese drei zusammen in einer Methode stehen: `kick` ohne `bann`
 * ist eine Bitte (der Geworfene verbindet sich sofort wieder), `bann`
 * ohne `kick` erwischt den nicht, der schon drin ist. Beide teilen sich
 * dieselbe Namensaufloesung, und die ist der eigentliche Inhalt.
 *
 * ── Namensaufloesung: Konto zuerst, spielerId als Rueckfall ──────────
 * Ein Admin tippt einen Namen. Gemeint ist fast immer die PERSON, nicht
 * die eine Figur — deshalb loest `bann` ueber die Kontendatenbank auf
 * und bannt das KONTO, was alle Charaktere dieser Person einschliesst,
 * auch die, die gerade nicht online sind. Nur wenn zu dem Namen gar
 * kein Konto gehoert (eine Verbindung ohne Anmeldung bekommt eine
 * gewuerfelte spielerId und keine Kontozeile), faellt der Befehl auf
 * einen Spielerbann zurueck. Beides findet auch Abwesende: die
 * Kontendatenbank ueber `charakterNachName`, der Rueckfall ueber
 * `spielerIdFuerName` (online ODER savedPlayers).
 *
 * ── Gilt ein Bann auch fuer einen Admin? JA ─────────────────────────
 * Strukturell: die Bannpruefung im Handshake laeuft VOR der Zeile, die
 * `peer.isAdmin` setzt (NetManager.handlePasswordAuth) — ein gebannter
 * Admin kommt nicht herein, und das soll auch so sein. Ein
 * uebernommenes Adminkonto ist genau der Fall, in dem man einen Bann
 * BRAUCHT, und eine Ausnahme waere die einzige Luecke, die niemand
 * schliessen koennte.
 *
 * Die Gegenprobe ist trotzdem noetig, denn seit `everyone-admin: false`
 * ist die Adminliste der einzige Weg zu Rechten: wer den letzten Admin
 * bannt, hat den Server dauerhaft ohne Admin, und `admin add` braucht
 * einen Admin. Deshalb LEHNT DER BEFEHL ab, wenn das Ziel auf der
 * Adminliste steht (oder man selbst ist) und verlangt vorher
 * `admin remove <Name>`. Das ist eine Huerde in der Bedienung, keine
 * Ausnahme in der Berechtigung — ein Bann, der auf anderem Weg in die
 * Datenbank kommt, wirkt gegen jeden.
 *
 * ── Herkunftsbann ───────────────────────────────────────────────────
 * `bann herkunft <Name> ...` bannt die Adresse einer GERADE OFFENEN
 * Verbindung (NetManager.herkunftVon). Nur online, absichtlich: eine
 * Adresse, die man nicht mehr sieht, ist geraten. Sie wird auch nicht
 * zurueckgemeldet — die Ablehnung nennt den Spielernamen, nicht die IP.
 */
function registerBannCommands(k: BannKontext): void {
  /** `30m`, `2h`, `7d`, `dauerhaft`/`permanent` → ms-Zeitpunkt oder null. */
  const fristLesen = (wort: string): { bis: number | null } | null => {
    const w = wort.toLowerCase();
    if (w === 'dauerhaft' || w === 'permanent' || w === 'immer') return { bis: null };
    const m = /^(\d+)(m|h|d|t)$/.exec(w);
    if (!m) return null;
    const zahl = Number(m[1]);
    if (zahl <= 0) return null;
    const faktor = m[2] === 'm' ? 60_000 : m[2] === 'h' ? 3_600_000 : 86_400_000;
    return { bis: Date.now() + zahl * faktor };
  };

  const fristText = (bis: number | null): string =>
    bis === null ? 'dauerhaft' : `bis ${new Date(bis).toLocaleString('de-DE')}`;

  /**
   * Steht zu diesem Bannziel ein Eintrag auf der Adminliste? Bei einem
   * Kontobann werden ALLE Charaktere des Kontos geprueft — sonst
   * schuetzt die Huerde nur den einen Namen, der getippt wurde, und der
   * Zweitcharakter desselben Admins faellt still mit.
   */
  const trifftAdmin = (art: BannArt, wert: string, kontoId: number | null): boolean => {
    if (art === 'spieler') return k.adminListe.enthaelt(wert as SpielerId);
    if (art === 'konto' && kontoId !== null) {
      return k.kontenDb
        .charaktereVonKonto(kontoId)
        .some((c) => k.adminListe.enthaelt(c.spielerId));
    }
    return false;
  };

  k.adminCommands.register('kick', (peer, args) => {
    const name = args.join(' ').trim();
    if (!name) return { ok: false, active: false, message: 'Aufruf: kick <Name>' };
    // B1 (Nachbesserung Pruefung 4, Regression aus C3): Selbstschutz
    // ueber das TATSAECHLICH GEFUNDENE Ziel, nicht ueber den rohen
    // Namen — findPeerByName normalisiert (namenSchluessel), ein
    // exakter String-Vergleich liess sich mit anderer Gross-/
    // Kleinschreibung oder Leerzeichen umgehen ("kick boss" traf den
    // Admin "Boss" vorher nicht als sich selbst).
    if (k.net.findPeerByName(name) === peer) {
      return { ok: false, active: false, message: 'Dich selbst kannst du nicht werfen' };
    }
    const getroffen = k.net.kick(name);
    return getroffen
      ? { ok: true, active: false, message: `${name} wurde getrennt (kein Bann — er kann sofort wiederkommen)` }
      : { ok: false, active: false, message: `${name} ist nicht verbunden` };
  });

  k.adminCommands.register('bann', (peer, args) => {
    const sub = (args[0] ?? '').toLowerCase();

    if (sub === 'liste' || sub === 'list') {
      const banns = k.kontenDb.bannListe();
      if (banns.length === 0) return { ok: true, active: false, message: 'Keine wirksamen Banns' };
      // Der rohe Wert eines Kontobanns ist eine Zeilennummer ("konto 1")
      // — damit laesst sich `entbann` nicht bedienen. Wo es einen
      // Benutzernamen gibt, steht deshalb der.
      const zeilen = banns
        .map((b) => {
          const klar = b.art === 'konto'
            ? k.kontenDb.kontoNachId(Number(b.wert))?.benutzername ?? b.wert
            : b.wert;
          return `${b.art} ${klar} (${fristText(b.bis)}${b.grund ? `, ${b.grund}` : ''})`;
        })
        .join('; ');
      return { ok: true, active: false, message: `${banns.length} Banns: ${zeilen}` };
    }

    const aufHerkunft = sub === 'herkunft' || sub === 'ip';
    const rest = aufHerkunft ? args.slice(1) : args;
    const name = (rest.shift() ?? '').trim();
    if (!name) {
      return { ok: false, active: false,
        message: 'Aufruf: bann <Name> [30m|2h|7d|dauerhaft] [Grund] | bann herkunft <Name> ... | bann liste' };
    }
    // B1 (Nachbesserung Pruefung 4, Regression aus C3): dieselbe
    // Umstellung wie bei `kick` — ueber das gefundene Ziel, nicht ueber
    // den rohen Namen. `peer` ist online, also findet `findPeerByName`
    // ihn selbst, sobald der getippte Name (normalisiert) seinem
    // eigenen entspricht — unabhaengig davon, ob `bann herkunft`
    // gemeint ist oder ein Konto-/Spielerbann; `trifftAdmin` weiter
    // unten schuetzt nur Konto-/Spielerbanns, KEINEN Herkunftsbann
    // (Pruefung 4 §2: Admin "Boss" sperrte sich per "bann herkunft
    // BOSS" dauerhaft selbst aus).
    if (k.net.findPeerByName(name) === peer) {
      return { ok: false, active: false, message: 'Dich selbst kannst du nicht bannen' };
    }

    // Frist ist optional und steht, wenn ueberhaupt, direkt hinter dem
    // Namen. Ist das naechste Wort keine Frist, gehoert es zum Grund —
    // sonst muesste jeder Bann eine Frist mitschleppen, nur damit ein
    // Grund dahinter passt.
    let bis: number | null = null;
    if (rest.length > 0) {
      const frist = fristLesen(rest[0]!);
      if (frist) { bis = frist.bis; rest.shift(); }
    }
    const grund = rest.join(' ').trim();

    let art: BannArt;
    let wert: string;
    let kontoId: number | null = null;
    if (aufHerkunft) {
      // C3: namenSchluessel statt `===`, wie kick und die Doppelnamen-
      // Pruefung beim Anmelden jetzt auch. B2 (Nachbesserung Pruefung
      // 4): Editor-Peers bleiben aussen vor, wie bei `findPeerByName`
      // und `spieler entfernen` — sie heissen alle "Editor" und
      // wuerden sonst reihenfolgeabhaengig statt dem Konto-Charakter
      // getroffen.
      const zielSchluessel = namenSchluessel(name);
      const ziel = k.net.getPeers().find((p) => !p.nurEditor && namenSchluessel(p.name) === zielSchluessel);
      if (!ziel) {
        return { ok: false, active: false,
          message: `${name} ist nicht verbunden — eine Herkunft laesst sich nur an einer offenen Verbindung ablesen` };
      }
      const herkunft = k.net.herkunftVon(ziel);
      if (!herkunft) {
        return { ok: false, active: false, message: `Herkunft von ${name} ist unbekannt` };
      }
      art = 'herkunft';
      wert = herkunft;
    } else {
      const charakter = k.kontenDb.charakterNachName(name);
      if (charakter) {
        art = 'konto';
        wert = String(charakter.kontoId);
        kontoId = charakter.kontoId;
      } else {
        const id = k.spielerIdFuerName(name);
        if (id === NAME_NICHT_EINDEUTIG) return { ok: false, active: false, message: 'Spieler nicht eindeutig gefunden' };
        if (!id) {
          return { ok: false, active: false,
            message: `Unbekannter Spieler: "${name}" (kein Konto dieses Namens und nie verbunden gewesen)` };
        }
        art = 'spieler';
        wert = id;
      }
    }

    if (trifftAdmin(art, wert, kontoId)) {
      return { ok: false, active: false,
        message: `${name} steht auf der Admin-Liste. Erst "admin remove ${name}", dann bannen — sonst sperrt man sich womoeglich den letzten Admin aus.` };
    }

    k.kontenDb.bannSetzen(art, wert, { grund, gesetztVon: peer.name, bis });
    // NACH dem Eintrag: trenneGebannte() fragt dieselbe Funktion wie der
    // Handshake und erwischt damit auch den Zweitcharakter desselben
    // Kontos, der nebenher online ist.
    const getroffen = k.net.trenneGebannte();
    const wen = getroffen.length > 0 ? ` — getrennt: ${getroffen.map((p) => p.name).join(', ')}` : '';
    const wasText = art === 'herkunft' ? `Herkunft von ${name}` : art === 'konto' ? `Konto von ${name}` : name;
    return { ok: true, active: false,
      message: `${wasText} gebannt (${fristText(bis)}${grund ? `, ${grund}` : ''})${wen}` };
  });

  k.adminCommands.register('entbann', (_peer, args) => {
    const sub = (args[0] ?? '').toLowerCase();
    const aufHerkunft = sub === 'herkunft' || sub === 'ip';
    const rest = aufHerkunft ? args.slice(1) : args;
    const name = rest.join(' ').trim();
    if (!name) {
      return { ok: false, active: false,
        message: 'Aufruf: entbann <Name> | entbann herkunft <Adresse>' };
    }

    // Bei einer Herkunft ist der getippte Text schon der Wert — die
    // Adresse steht in `bann liste`, und der Gebannte ist ja gerade
    // NICHT verbunden, also gibt es nichts abzulesen.
    if (aufHerkunft) {
      const weg = k.kontenDb.bannAufheben('herkunft', name);
      return { ok: weg, active: false,
        message: weg ? `Herkunftsbann auf ${name} aufgehoben` : `Kein Herkunftsbann auf ${name}` };
    }

    // Beide Arten probieren, in derselben Reihenfolge, in der `bann`
    // sie vergibt — der Admin soll nicht wissen muessen, ob sein
    // Gegenueber damals ein Konto hatte.
    const charakter = k.kontenDb.charakterNachName(name);
    if (charakter && k.kontenDb.bannAufheben('konto', String(charakter.kontoId))) {
      return { ok: true, active: false, message: `Kontobann auf ${name} aufgehoben` };
    }
    const id = k.spielerIdFuerName(name);
    if (id === NAME_NICHT_EINDEUTIG) return { ok: false, active: false, message: 'Spieler nicht eindeutig gefunden' };
    if (id && k.kontenDb.bannAufheben('spieler', id)) {
      return { ok: true, active: false, message: `Spielerbann auf ${name} aufgehoben` };
    }
    return { ok: false, active: false, message: `Kein Bann auf ${name} gefunden` };
  });
}

export { registerBannCommands };
