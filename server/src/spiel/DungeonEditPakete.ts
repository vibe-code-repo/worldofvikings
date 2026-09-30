/**
 * Dungeon editor packets of the game server: the four handlers that answer the editor (request a
 * document, save a document, build a hall, delete a hall). They were methods of `WovServer` and
 * moved here as functions with a context (refactoring I1, step 2): `k` is the server itself, `this`
 * became `k`, nothing else changed. `WovServer` keeps one forwarding method per function; calls to
 * other methods of the server go through `k`, so a stand-in set on the instance stays in effect.
 */

import { PacketType, dungeon2 } from '@wov/shared';
import { baueModul, deleteModule, registryChecksum, registryPruefsumme } from '../world/dungeon/ModuleBuild.js';
import type { Peer } from '../net/Peer.js';
import type { Reader } from '../io/Reader.js';
import type { SpielKontext } from './Kontext.js';

/** What this module uses of the server: 4 members. */
type DungeonEditKontext = SpielKontext<'dungeons' | 'config' | 'enterDungeon' | 'dungeonsWurzel'>;

/** Editor: aktuelles Dungeon-Dokument als JSON ausliefern (admin-gated). */
function handleDungeonEditRequest(k: DungeonEditKontext, peer: Peer, reader: Reader): void {
  const requested = reader.readString();
  const sendData = (ok: boolean, message: string, json = '') => {
    peer.sendPacketWith(PacketType.DungeonEditData, (w) => {
      w.writeBool(ok);
      w.writeString(message);
      w.writeString(json);
    });
  };
  if (!peer.isAdmin) return sendData(false, 'Keine Berechtigung');
  const id = requested || peer.dungeonId || '';
  // AP13: Beide Formate reisen als JSON durch DASSELBE Paket. Der Editor
  // erkennt an `version >= 10`, welches er vor sich hat — dieselbe Weiche
  // wie im Sanitizer, und deshalb braucht es kein zweites Paket.
  // AP13: both formats travel as JSON through THE SAME packet.
  const doc2 = id ? k.dungeons.getDokument2(id) : undefined;
  if (doc2) return sendData(true, doc2.id, JSON.stringify(doc2));
  const doc = id ? k.dungeons.getDocument(id) : undefined;
  if (!doc) return sendData(false, `Unbekannter Dungeon: ${id || '(keiner)'}`);
  sendData(true, doc.id, JSON.stringify(doc));
}

/**
 * Editor: hochgeladenes Dokument sanitisieren, speichern und — wenn der
 * Peer gerade in diesem Dungeon steht — die Instanz neu materialisieren
 * und ihn wieder hineinteleportieren, damit die Änderung sofort sichtbar
 * ist (upsertDocument reisst die alte Instanz ab).
 */
function handleDungeonEditSave(k: DungeonEditKontext, peer: Peer, reader: Reader): void {
  const json = reader.readString();
  // E6: Die Registry-Prüfsumme reist HINTER dem Dokument — ein Feld, das
  // ein Client von vor E6 gar nicht schickt. `isValidOffset(1)` fragt
  // deshalb erst, ob überhaupt noch Bytes da sind (dasselbe Muster wie
  // beim nachträglich angehängten `seq` in PlayerState); ein blindes
  // `readString()` liefe über das Ende des Puffers und beendete die
  // Verbindung mit einer RangeError-Meldung, die nichts erklärt.
  const gesendeteSumme = reader.isValidOffset(1) ? reader.readString() : '';
  const sendData = (ok: boolean, message: string, docJson = '') => {
    peer.sendPacketWith(PacketType.DungeonEditData, (w) => {
      w.writeBool(ok);
      w.writeString(message);
      w.writeString(docJson);
    });
  };
  if (!peer.isAdmin) return sendData(false, 'Keine Berechtigung');
  if (json.length > 2_000_000) return sendData(false, 'Dokument zu groß (max 2 MB)');

  // ── E6: Kennen beide Seiten dieselben Module? ──────────────────────
  //
  // Diese Frage MUSS vor `sanitizeDungeonDocument` stehen, denn dieser
  // verwirft unbekannte Räume STILL (`shared/src/dungeons.ts`, Kopf:
  // „Unknown rooms are dropped"). Für eine Datei von der Platte ist das
  // richtig; für ein Dokument aus dem Editor ist es der teuerste aller
  // Fehler — der Nutzer bekommt ein Häkchen und ein Grab mit einem
  // Loch, und das Loch fällt erst beim Betreten auf.
  //
  // Ein FEHLENDES Feld ist kein Sonderfall, sondern die wörtliche
  // Wahrheit über den Absender: Ein Bündel von vor E6 registriert keine
  // generierten Module, seine Registry IST leer. Kennt der Server auch
  // keine, sind sich beide einig und das Speichern geht durch; kennt er
  // welche, ist die Seite im Browser älter als er — und genau dann darf
  // sie nicht speichern.
  const eigeneSumme = registryChecksum();
  const clientSumme = gesendeteSumme || registryPruefsumme([]);
  if (clientSumme !== eigeneSumme) {
    console.warn(
      `[Dungeon] '${peer.name}' hat eine veraltete Modulregistry ` +
        `(Client ${clientSumme}, Server ${eigeneSumme}) — Speichern abgelehnt.`
    );
    return sendData(
      false,
      `Registry veraltet — Seite neu laden (Client ${clientSumme}, Server ${eigeneSumme})`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return sendData(false, 'Ungültiges JSON');
  }
  // Die Weiche, ein zweites Mal (AP13). Sie steht hier und nicht in
  // `upsertDocument`, weil die beiden Rückgabetypen verschieden sind —
  // und weil ein 2.0-Dokument im Alt-Sanitizer als „ungültig" gemeldet
  // würde statt als „falscher Weg".
  // The switch, a second time.
  if (dungeon2.istDokument2(raw)) {
    const erg2 = k.dungeons.upsertDokument2(raw);
    if (!erg2) return sendData(false, 'Dokument 2.0 abgelehnt (Thema/ID/Seeds ungültig)');
    const { doc: d2, instanzErhalten: erhalten2 } = erg2;
    if (peer.dungeonId === d2.id && !erhalten2) k.enterDungeon(peer, d2.id);
    sendData(
      true,
      `Gespeichert: ${d2.id} (2.0, Thema ${d2.thema}, Prüfsumme ${d2.pruefsumme})`,
      JSON.stringify(d2)
    );
    console.log(
      `[Dungeon] '${peer.name}' saved 2.0 document '${d2.id}' ` +
        `(${d2.thema}, ${d2.pruefsumme}${erhalten2 ? ', instance kept' : ''})`
    );
    return;
  }
  const ergebnis = k.dungeons.upsertDocument(raw);
  if (!ergebnis) return sendData(false, 'Dokument abgelehnt (Basis/ID/Räume ungültig)');
  const { doc, instanzErhalten } = ergebnis;

  // Zurückteleportieren NUR, wenn die Instanz abgerissen wurde. Hat sich
  // bloss die Deko geändert, steht sie noch — und der Spieler soll dort
  // bleiben, wo er gerade eine Fackel gesetzt hat, statt am Eingang
  // aufzuwachen. Genau das machte das Setzen vorher unbenutzbar.
  if (peer.dungeonId === doc.id && !instanzErhalten) {
    k.enterDungeon(peer, doc.id);
  }
  sendData(
    true,
    `Gespeichert: ${doc.id} (${doc.layout.rooms.length} Räume, ${doc.layout.props.length} Deko)`,
    JSON.stringify(doc)
  );
  console.log(
    `[Dungeon] '${peer.name}' saved document '${doc.id}' ` +
      `(${doc.layout.rooms.length} rooms, ${doc.layout.props.length} props` +
      `${instanzErhalten ? ', instance kept' : ''})`
  );
}

/**
 * Editor: einen Saal bauen (E5). Der Client schickt VIER ZAHLEN —
 * Breite, Tiefe, Pfeilerraster, Gewicht —, sonst nichts. Namen,
 * Pfade und jede Klemme liegen in `ModuleBuild.baueModul`; dieser
 * Handler übersetzt nur zwischen Paket und Funktion.
 *
 * Warum hier KEINE zweite Prüfung steht: Zwei Klemmenlisten für
 * dieselbe Sache laufen auseinander, sobald eine von beiden angefasst
 * wird — und die im Socket-Handler wäre die, die kein Test fährt.
 */
function handleDungeonModulBau(k: DungeonEditKontext, peer: Peer, reader: Reader): void {
  const cellsX = reader.readInt32();
  const cellsZ = reader.readInt32();
  const raster = reader.readInt32();
  const weight = reader.readFloat32();

  const antwort = baueModul(
    {
      istAdmin: peer.isAdmin,
      modulbauErlaubt: k.config.dungeonsModulbau,
      verzeichnis: k.config.generiertDir,
    },
    { cellsX, cellsZ, raster, weight }
  );

  peer.sendPacketWith(PacketType.DungeonModulBauErgebnis, (w) => {
    w.writeBool(antwort.ok);
    w.writeString(
      antwort.ok
        ? `Gebaut: ${antwort.ergebnis.name} — ${antwort.ergebnis.tris} Dreiecke, ` +
            `${antwort.ergebnis.sizeX} x ${antwort.ergebnis.sizeZ} m`
        : antwort.meldung
    );
    // Die Zahlen als JSON und nicht als Einzelfelder: Das Formular
    // zeigt sie an, und ein zusaetzliches Feld spaeter verschoebe
    // sonst den Aufbau eines Pakets, das ein offener Tab noch kennt.
    w.writeString(antwort.ok ? JSON.stringify(antwort.ergebnis) : '');
  });

  console.log(
    antwort.ok
      ? `[Dungeon] '${peer.name}' built module '${antwort.ergebnis.name}' ` +
          `(${antwort.ergebnis.tris} tris, registry ${antwort.ergebnis.pruefsumme})`
      : `[Dungeon] '${peer.name}' — Modulbau abgelehnt: ${antwort.meldung}`
  );
}

/**
 * Editor: einen gebauten Saal wieder entfernen (E9).
 *
 * Wie beim Bauen steht hier KEINE eigene Prüfung: Tore, Namensform,
 * Bestandsfrage und Reihenfolge des Entfernens liegen vollständig in
 * `ModuleBuild.deleteModule`. Der Handler übersetzt zwischen Paket und
 * Funktion und reicht die Dokumentwurzel herein — das Einzige, was der
 * Bauweg nicht schon kennt.
 */
function handleDungeonModulLoeschen(k: DungeonEditKontext, peer: Peer, reader: Reader): void {
  const name = reader.readString();

  const antwort = deleteModule(
    {
      istAdmin: peer.isAdmin,
      modulbauErlaubt: k.config.dungeonsModulbau,
      verzeichnis: k.config.generiertDir,
      dungeonsWurzel: k.dungeonsWurzel(),
    },
    name
  );

  peer.sendPacketWith(PacketType.DungeonModulLoeschErgebnis, (w) => {
    w.writeBool(antwort.ok);
    w.writeString(
      antwort.ok
        ? `Entfernt: ${antwort.ergebnis.name}` +
            `${antwort.ergebnis.dateiEntfernt ? '' : ' (die GLB-Datei fehlte bereits)'} — ` +
            `${antwort.ergebnis.verbleibend} Modul(e) verbleiben`
        : antwort.meldung
    );
    // Die Zahlen als JSON, aus demselben Grund wie beim Bauergebnis: ein
    // spaeteres Feld verschoebe sonst den Aufbau eines Pakets, das ein
    // offener Tab noch kennt.
    w.writeString(antwort.ok ? JSON.stringify(antwort.ergebnis) : '');
  });

  console.log(
    antwort.ok
      ? `[Dungeon] '${peer.name}' deleted module '${antwort.ergebnis.name}' ` +
          `(registry ${antwort.ergebnis.pruefsumme}, ${antwort.ergebnis.verbleibend} left)`
      : `[Dungeon] '${peer.name}' — Modul löschen abgelehnt: ${antwort.meldung}`
  );
}

export { handleDungeonEditRequest, handleDungeonEditSave, handleDungeonModulBau, handleDungeonModulLoeschen };
