/**
 * Interaction packets of the game server: opening a chest, sending its contents, and the two
 * appearance packets (hair and armour, figure). They were methods of `WovServer` and moved here as
 * functions with a context (refactoring I1, step 3): `k` is the server itself, `this` became `k`,
 * nothing else changed. `WovServer` keeps one forwarding method per function; calls to other
 * methods of the server go through `k`, so a stand-in set on the instance stays in effect.
 */

import { encodeArmor, validArmorParts, ruestungZu, PacketType, FIGUR_MEMBER, istFigur, istFrisur, istHaarfarbe, istAugenfarbe, istRuestung, FRISUR_MEMBER, HAARFARBE_MEMBER, AUGENFARBE_MEMBER, RUESTUNG_MEMBER, AUGENFARBE_VORGABE, findItem, packContainer, unpackContainer, TRUHE_INHALT_MEMBER, TRUHE_LOOTED_MEMBER } from '@wov/shared';
import { wuerfleTruhe } from './Beute.js';
import type { ZDO } from '../zdo/ZDO.js';
import type { Prefab } from '../prefab/Prefab.js';
import type { Peer } from '../net/Peer.js';
import type { Reader } from '../io/Reader.js';
import type { SpielKontext } from './Kontext.js';

/** What this module uses of the server: 5 members. */
type InteraktionKontext = SpielKontext<'sendeTruheInhalt' | 'inventarSync' | 'zdosVon' | 'kappeLeben' | 'sichereSpielerSofort'>;

/**
 * Truhe öffnen (F.CONTAINER, Roadmap F1) — ersetzt den früheren
 * Ein-Bit-Schalter samt direkt an den Spieler ausgezahlter
 * Zufallsbeute durch echten, entnehmbaren Inhalt (Container.ts).
 *
 * MIGRATION (Alt-Saves kennen nur TRUHE_LOOTED_MEMBER als Bit):
 *  - Bit noch nicht gesetzt → erste Berührung seit diesem Umbau.
 *    wuerfleTruhe() bleibt die EINZIGE Zufallsquelle (unverändert
 *    gegenüber vorher) und befüllt jetzt die Truhe statt den Spieler
 *    direkt zu beschenken. Das Bit wird SOFORT gesetzt — ein zweiter
 *    Login oder ein zweiter Öffner würfelt nie ein zweites Mal, exakt
 *    dieselbe Garantie wie vorher, nur eine Ebene tiefer (jetzt „hat
 *    ihre Erstbefüllung schon", vorher „wurde geplündert").
 *  - Bit bereits gesetzt (Alt-Save VOR diesem Umbau hatte die Truhe
 *    schon per Direktauszahlung geplündert) → sie startet leer. Ihr
 *    einziger Gegenstand ist damals schon beim Spieler gelandet, es
 *    gibt nichts nachzuholen.
 *
 * Jede weitere Öffnung liest nur noch den vorhandenen Inhalt — die
 * eigentliche Truhen-UI (nehmen/legen) läuft über ContainerAction
 * (handleContainerAction).
 */
function handleTruheOeffnen(k: InteraktionKontext, peer: Peer, ziel: ZDO, def: Prefab | undefined): void {
  if (ziel.getInt(TRUHE_LOOTED_MEMBER) !== 1) {
    ziel.setInt(TRUHE_LOOTED_MEMBER, 1);
    const inv = unpackContainer(ziel.getString(TRUHE_INHALT_MEMBER));
    const beute = wuerfleTruhe(def?.name ?? '');
    const beuteDef = findItem(beute.name);
    if (beuteDef) inv.addItem(beuteDef, beute.amount);
    ziel.setString(TRUHE_INHALT_MEMBER, packContainer(inv));
    ziel.revision.reviseData();
    ziel.dirty = true;
  }
  peer.sendPacketWith(PacketType.InteractResult, (w) => {
    w.writeBool(true);
    w.writeString('Truhe geöffnet');
    w.writeString('');
    w.writeInt32(0);
  });
  k.sendeTruheInhalt(peer, ziel);
}

/** Aktuellen Truheninhalt an GENAU diesen Peer schicken (s. PacketType.ContainerSync). */
function sendeTruheInhalt(k: InteraktionKontext, peer: Peer, ziel: ZDO): void {
  peer.sendPacketWith(PacketType.ContainerSync, (w) => {
    w.writeString(ziel.zdoid.userId.toString());
    w.writeInt32(ziel.zdoid.id);
    w.writeString(ziel.getString(TRUHE_INHALT_MEMBER));
  });
}

/**
 * Frisur und Ruestung des Clients (Paket SetAussehen).
 *
 * Wie handleSetFigur: geprueft wird gegen die GEMEINSAME Liste
 * (shared/aussehen.ts), aus der auch die Charaktererstellung ihre
 * Auswahl baut — der Server glaubt dem Client nichts. Geschrieben wird
 * an ZDO-Member, weil ZDOSync Verteilung und Nachzuegler von selbst
 * loest; ein eigenes Broadcast-Paket muesste beides nachbauen und
 * schwiege bei jedem, der spaeter in Sichtweite kommt.
 *
 * Leerstring ist gueltig und heisst "nichts angezogen".
 */
function handleSetAussehen(k: InteraktionKontext, peer: Peer, reader: Reader): void {
  const frisur = reader.readString();
  const ober = reader.readString();
  const beine = reader.readString();
  // Vierter Wert, aber nur wenn er da ist: Ein Client von vor dem
  // 23.08.2026 sendet drei Strings. `readString()` auf einem leeren
  // Rest wuerfe und risse die Verbindung ab — fuer eine Haarfarbe.
  const haarfarbe = reader.remaining() > 0 ? reader.readString() : peer.haarfarbe;
  /*
   * Zwei additive Protokollstaende muessen sich hier ueberlappen:
   * Ruestungsclients von vor der Augenfarben-Auswahl schicken als
   * fuenften String bereits das JSON der Zusatz-Slots. Neue Clients
   * schicken erst die Augenfarbe und danach dieses JSON. Eine bekannte
   * Augenfarben-Kennung unterscheidet beide Formen eindeutig.
   */
  const fuenfterWert = reader.remaining() > 0 ? reader.readString() : '';
  const hatAugenfarbe = istAugenfarbe(fuenfterWert);
  const augenfarbe = hatAugenfarbe
    ? fuenfterWert
    : istAugenfarbe(peer.augenfarbe) ? peer.augenfarbe : AUGENFARBE_VORGABE;
  const ruestungsJson = hatAugenfarbe
    ? reader.remaining() > 0 ? reader.readString() : ''
    : fuenfterWert;
  let extra: unknown = {};
  try { if (ruestungsJson) extra = JSON.parse(ruestungsJson); }
  catch { k.inventarSync(peer); return; }
  if (!validArmorParts(extra, peer.figur)) { k.inventarSync(peer); return; }
  const parts = { ...extra, oberkoerper: ober, beine };
  if (!validArmorParts(parts, peer.figur) || Object.values(parts).some(id =>
    id && ruestungZu(id)?.figure && !peer.inventar.all.some(i => i.shared.ruestungsteil === id))) {
    k.inventarSync(peer); return;
  }
  if (
    !istFrisur(frisur) ||
    !istRuestung(ober) ||
    !istRuestung(beine) ||
    !istHaarfarbe(haarfarbe) ||
    !istAugenfarbe(augenfarbe)
  ) {
    console.warn(
      `[WoV] SetAussehen von "${peer.name}" abgelehnt: ` +
        `frisur="${frisur.slice(0, 24)}" ober="${ober.slice(0, 24)}" ` +
        `beine="${beine.slice(0, 24)}" haarfarbe="${haarfarbe.slice(0, 24)}" ` +
        `augenfarbe="${augenfarbe.slice(0, 24)}" ` +
        `— steht nicht in shared/aussehen.ts`
    );
    return;
  }
  peer.frisur = frisur;
  peer.haarfarbe = haarfarbe;
  peer.augenfarbe = augenfarbe;
  peer.ruestung = encodeArmor(parts);
  const remaining = new Set(Object.values(parts));
  for (const item of peer.inventar.all) {
    if (item.shared.ruestungsteil) item.equipped = remaining.delete(item.shared.ruestungsteil);
  }
  const charZDO = k.zdosVon(peer).getZDO(peer.characterID);
  if (charZDO) {
    charZDO.setString(FRISUR_MEMBER, frisur);
    charZDO.setString(HAARFARBE_MEMBER, haarfarbe);
    charZDO.setString(AUGENFARBE_MEMBER, augenfarbe);
    charZDO.setString(RUESTUNG_MEMBER, peer.ruestung);
  }
  k.kappeLeben(peer);
  // F8: Ausruestungswechsel geht sofort auf die Platte.
  k.sichereSpielerSofort(peer, 'ausruestung');
}

/**
 * Figurenwahl des Clients (Paket SetFigur).
 *
 * WAS HIER GEPRUEFT WIRD: Der Client schickt eine Kennung, und der
 * Server glaubt sie NICHT — `istFigur()` entscheidet, ob sie in der
 * gemeinsamen Liste steht. Ohne diese Pruefung landete ein beliebiger
 * String am ZDO, und jeder andere Client versuchte, ihn als
 * Modelldateinamen zu laden.
 *
 * WARUM DER WEG UEBER DAS ZDO: Der Member am Charakter-ZDO ist der
 * einzige Ort, an dem die Wahl AUTOMATISCH bei allen ankommt, die den
 * Spieler sehen — ZDOSync erledigt Verteilung und Nachzuegler. Ein
 * eigenes Broadcast-Paket muesste beides selbst loesen und wuerde bei
 * jemandem, der spaeter in Sichtweite kommt, schweigen.
 *
 * Ein Wechsel MITTEN IM SPIEL ist damit ebenfalls abgedeckt: Er
 * aendert denselben Member, und der Sync traegt ihn weiter.
 */
function handleSetFigur(k: InteraktionKontext, peer: Peer, reader: Reader): void {
  const gewuenscht = reader.readString();
  if (!istFigur(gewuenscht)) {
    console.warn(
      `[WoV] SetFigur von "${peer.name}" abgelehnt: "${gewuenscht.slice(0, 40)}" ` +
        `steht nicht in FIGUREN (shared/figuren.ts)`
    );
    return;
  }
  if (peer.figur === gewuenscht) return;
  peer.figur = gewuenscht;
  const charZDO = k.zdosVon(peer).getZDO(peer.characterID);
  if (charZDO) charZDO.setString(FIGUR_MEMBER, gewuenscht);
  // Teile, die zur neuen Figur nicht passen, fallen ab (dieselbe Pruefung wie sonst), Werte werden neu gerechnet.
  k.inventarSync(peer);
  k.sichereSpielerSofort(peer, 'figur'); // F8
  console.log(`[WoV] "${peer.name}" spielt jetzt als "${gewuenscht}"`);
}

export { handleTruheOeffnen, sendeTruheInhalt, handleSetAussehen, handleSetFigur };
