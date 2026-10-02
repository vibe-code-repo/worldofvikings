/**
 * The admin command `dungeon <sub> ...` (documents, entrances and instances of the dungeons) and `resolveDungeonBase`, which its
 * `create` branch asks for the kit of a dungeon. They were methods of `WovServer` and moved here as functions with a context
 * (refactoring I1, step 1, package D): `kd` is the server itself, `this` became `kd`, nothing else changed. The context is not
 * called `k` because the `steinkit` branch has a local `k`. `WovServer` keeps one forwarding method per function; its
 * constructor calls `registerDungeonCommand` in the same place as before, and the handler reads `kd.<member>` on every call.
 */

import { DUNGEONS, STEIN_TEXTUREN, sanitizeSteinKit, steinTexturAufloesen, ambientLichtVon, MAX_DUNGEON_AMBIENT, dungeon2 } from '@wov/shared';
import type { SteinKitConfig } from '@wov/shared';
import type { SpielKontext } from '../Kontext.js';

/** What this module uses of the server: 5 members. */
type DungeonKontext = SpielKontext<'adminCommands' | 'dungeons' | 'resolveDungeonBase' | 'enterDungeon' | 'leaveDungeon'>;

/**
 * Admin command family `dungeon <sub> ...` — the management interface
 * for dungeon documents, entrances and instances:
 *
 *   dungeon list                      documents + live instances
 *   dungeon entrances                 world entrances + assignments
 *   dungeon create <base> [seed]      generate + save a new document
 *   dungeon create2 <theme> [seed] [id] [ambient]
 *                                     generate + save a 2.0 document;
 *                                     `ambient` is the base brightness
 *                                     0..1 (0 = pitch dark, only the
 *                                     placed light sources). Omitted =
 *                                     the theme's default.
 *   dungeon enter [id]                enter by id, or the nearest entrance
 *   dungeon leave                     back to the overworld
 *   dungeon assign <id>               assign nearest entrance (≤16 m) to id
 *   dungeon entrance-mode <id> <fixed|regen>
 *                                     'regen' makes the entrance pointing at
 *                                     <id> reroll its layout on every enter
 *                                     (skipped while someone is inside);
 *                                     'fixed' restores the default. Needs a
 *                                     DG_* recipe — for an entrance wired by
 *                                     `assign` it is taken from the document.
 *   dungeon regen <id> [seed]         re-generate a 'generated' document
 *   dungeon steinkit <id> wand=<name> decke=<name> boden=<name>
 *                         moos=<0..4> frost=<0..4> nass=<0..4>
 *                                     set the 1.0 document's own stone
 *                                     material; texture NAMES (no paths)
 *                                     out of `STEIN_TEXTUREN`.
 *                                     `dungeon steinkit <id> reset` clears
 *                                     it (back to the kit default).
 *   dungeon licht <id> <0..3>         set the 1.0 document's base
 *                                     brightness — a FACTOR on the world
 *                                     lighting: 1 = as before, <1 darker,
 *                                     >1 brighter. `dungeon licht <id>
 *                                     reset` clears it (back to 1); with no
 *                                     value it just reports the current one.
 *   dungeon reset <id>                tear down the live instance
 *   dungeon delete <id>               delete document + assignments
 */
function registerDungeonCommand(kd: DungeonKontext): void {
  kd.adminCommands.register('dungeon', (peer, args) => {
    const sub = (args.shift() ?? 'list').toLowerCase();

    switch (sub) {
      case 'list': {
        const docs = kd.dungeons.listDocuments();
        const docs2 = kd.dungeons.listDokumente2();
        if (docs.length === 0 && docs2.length === 0) {
          return { ok: true, active: false, message: 'Keine Dungeons vorhanden' };
        }
        const aktiv = (id: string): string => {
          const inst = kd.dungeons.getInstance(id);
          return inst ? ` [aktiv, ${inst.players.size} Spieler]` : '';
        };
        const lines = [
          ...docs.map(
            (d) => `${d.id} (${d.base}, ${d.mode}, ${d.layout.rooms.length} Räume)${aktiv(d.id)}`
          ),
          // 2.0 zählt keine Räume, sondern Stempel — und das Dokument
          // kennt sie gar nicht, es kennt nur das Rezept. Was hier steht,
          // ist deshalb das Rezept, nicht sein Ergebnis.
          // 2.0 documents know the recipe, not its result.
          ...docs2.map(
            (d) =>
              `${d.id} (2.0, ${d.thema}, ${d.modus}, Seeds ` +
              `${d.seeds.architektur}/${d.seeds.material}/${d.seeds.deko}, ` +
              `Prüfsumme ${d.pruefsumme})${aktiv(d.id)}`
          ),
        ];
        return { ok: true, active: false, message: lines.join(' | ') };
      }

      // AP13: Ein 2.0-Dokument anlegen. Eigener Unterbefehl statt eines
      // Schalters an `create`: Die beiden Formate teilen sich kein
      // Argument — dort ein Kit, hier ein Thema — und ein Befehl, dessen
      // Argumente von einem Schalter abhängen, ist ein Befehl, den man
      // falsch aufruft.
      // AP13: create a 2.0 document. Its own sub-command, because the two
      // formats share no argument.
      case 'create2': {
        const thema = (args[0] ?? 'steingrab').toLowerCase();
        if (dungeon2.themaFinden(thema) === undefined) {
          const bekannt = dungeon2.THEMEN.map((t) => t.id).join(', ');
          return {
            ok: false,
            active: false,
            message: `Aufruf: dungeon create2 <thema> [seed] — bekannt: ${bekannt}`,
          };
        }
        const seed = Number.isFinite(Number(args[1]))
          ? Number(args[1]) | 0
          : (Math.random() * 0x7fffffff) | 0;
        // Drei Seeds aus einem: Wer nur eine Zahl nennt, will einen
        // reproduzierbaren Dungeon, keine Seed-Verwaltung. Gemischt statt
        // dreimal derselbe Wert — gleiche Seeds in drei Strömen wären drei
        // gleich laufende Ströme.
        // Three seeds from one — mixed, not the same value three times.
        const seeds: dungeon2.LayoutSeeds = {
          architektur: seed >>> 0,
          material: dungeon2.mische(seed, 1),
          deko: dungeon2.mische(seed, 2),
        };
        // Vierter Parameter: die Grundhelligkeit (0..1). Weggelassen heisst
        // „Vorgabe des Themas" — und `Number('')` ist 0, also wird
        // ausdrücklich auf „Argument da?" geprüft und nicht auf
        // `Number.isFinite` allein: `dungeon create2 steingrab 2 grab-2`
        // dürfte sonst ein stockdunkles Grab erzeugen, ohne dass jemand
        // eine Helligkeit genannt hätte.
        // Fourth argument: base brightness (0..1). Omitted means "theme
        // default" — checked on PRESENCE, because `Number('')` is 0 and 0 is
        // a valid brightness (pitch dark).
        const ambientRoh = args[3];
        const ambientLicht =
          ambientRoh !== undefined && Number.isFinite(Number(ambientRoh))
            ? Math.min(1, Math.max(0, Number(ambientRoh)))
            : undefined;
        const doc = kd.dungeons.erzeugeDungeon2(thema, seeds, args[2], ambientLicht);
        if (!doc) {
          return { ok: false, active: false, message: `Erzeugung fehlgeschlagen (${thema})` };
        }
        return {
          ok: true,
          active: false,
          message:
            `Dungeon 2.0 erzeugt: ${doc.id} (Thema ${doc.thema}, Seed ${seed}, ` +
            `Prüfsumme ${doc.pruefsumme}, Grundhelligkeit ` +
            `${dungeon2.ambientLichtVon(doc).toFixed(2)}` +
            `${doc.ambientLicht === undefined ? ' aus dem Thema' : ' je Dokument'})`,
        };
      }

      case 'entrances': {
        const entries = kd.dungeons.listEntrances();
        if (entries.length === 0) {
          return { ok: true, active: false, message: 'Keine Eingänge registriert' };
        }
        const lines = entries.map(
          (e) =>
            `${e.feature}@(${e.pos.x.toFixed(0)},${e.pos.z.toFixed(0)}) → ${e.dungeonId}` +
            // Der Modus steht ausdrücklich in JEDER Zeile, auch das 'fest'.
            // Ein Flag, das man nur an seiner Abwesenheit erkennt, liest
            // sich in einer Liste wie ein Anzeigefehler.
            ` [${e.regenerateOnEnter ? 'regen' : 'fest'}]`
        );
        return { ok: true, active: false, message: lines.join(' | ') };
      }

      case 'entrance-mode': {
        const id = args[0];
        const modus = args[1];
        if (!id || (modus !== 'fixed' && modus !== 'regen')) {
          return {
            ok: false,
            active: false,
            message: 'Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>',
          };
        }
        // Die beiden Fehlgründe werden hier getrennt, weil sie zwei ganz
        // verschiedene Fehler des Aufrufers sind: falsche Kennung gegen
        // „dieses Dokument kennt kein Kit-Rezept".
        const eingang = kd.dungeons.eingangZuDungeon(id);
        if (!eingang) {
          return { ok: false, active: false, message: `Kein Eingang zeigt auf: ${id}` };
        }
        if (!kd.dungeons.setzeEingangsModus(id, modus)) {
          return {
            ok: false,
            active: false,
            message:
              `Kein Rezept (base) für ${id} — nur erzeugte 1.0-Dungeons mit ` +
              'DG_*-Basis können bei jedem Betreten neu würfeln',
          };
        }
        return {
          ok: true,
          active: false,
          message:
            modus === 'regen'
              ? `${eingang.feature}@${eingang.zoneKey} → ${id}: würfelt bei jedem Betreten neu`
              : `${eingang.feature}@${eingang.zoneKey} → ${id}: fest`,
        };
      }

      case 'create': {
        const base = kd.resolveDungeonBase(args[0]);
        if (!base) {
          return {
            ok: false,
            active: false,
            message:
              'Aufruf: dungeon create <basis> [seed] [räume] [zone] — Basis z. B. ' +
              'forestcrypt, sunkencrypt, cave; räume/zone leer = Kit-Vorgabe',
          };
        }
        const seed = Number.isFinite(Number(args[1]))
          ? Number(args[1]) | 0
          : (Math.random() * 0x7fffffff) | 0;
        // Dieselben zwei Stellschrauben wie im Web-Editor. Geklemmt wird
        // NICHT hier, sondern in `createGenerated` — eine zweite Prüfung
        // derselben Grenzen driftet auseinander, und dieser Weg hier ist
        // der selten benutzte von beiden.
        const raeume = args[2] !== undefined && Number.isFinite(Number(args[2]))
          ? Number(args[2])
          : undefined;
        const zone = args[3] !== undefined && Number.isFinite(Number(args[3]))
          ? Number(args[3])
          : undefined;
        const einstellungen =
          raeume === undefined && zone === undefined
            ? undefined
            : {
                ...(raeume !== undefined ? { maxRooms: raeume } : {}),
                ...(zone !== undefined ? { zoneSize: zone } : {}),
              };
        const doc = kd.dungeons.createGenerated(base, seed, undefined, einstellungen);
        if (!doc) {
          return { ok: false, active: false, message: `Erzeugung fehlgeschlagen (${base})` };
        }
        return {
          ok: true,
          active: false,
          message:
            `Dungeon erzeugt: ${doc.id} (${doc.layout.rooms.length} Räume, Seed ${seed}, ` +
            `Zone ${doc.zoneSize})`,
        };
      }

      case 'enter': {
        let id = args[0];
        if (!id) {
          const entrance = kd.dungeons.findEntranceNear(peer.position, 16);
          if (!entrance) {
            return { ok: false, active: false, message: 'Kein Dungeon-Eingang in der Nähe' };
          }
          id = entrance.dungeonId;
        }
        const result = kd.enterDungeon(peer, id);
        return { ok: result.ok, active: result.ok, message: result.message };
      }

      case 'leave': {
        const result = kd.leaveDungeon(peer);
        return { ok: result.ok, active: false, message: result.message };
      }

      case 'assign': {
        const id = args[0];
        // Beide Formate: Ein Eingang darf auf ein 2.0-Dokument zeigen.
        // Both formats: an entrance may point at a 2.0 document.
        if (!id || !kd.dungeons.hatDokument(id)) {
          return { ok: false, active: false, message: `Unbekannter Dungeon: ${id ?? '?'}` };
        }
        const entrance = kd.dungeons.findEntranceNear(peer.position, 16);
        if (!entrance) {
          return { ok: false, active: false, message: 'Kein Dungeon-Eingang in der Nähe (≤16 m)' };
        }
        // Den Rückgabewert AUSWERTEN. Er war hier verworfen, und weil
        // `assignEntrance` nur die 1.0-Karte befragt, meldete der Befehl bei
        // jeder 2.0-Kennung Erfolg, während der Eingang unverändert blieb.
        // Evaluate the return value — it was discarded, so a 2.0 id reported
        // success while the entrance stayed untouched.
        if (!kd.dungeons.assignEntrance(entrance.zoneKey, id)) {
          return {
            ok: false,
            active: false,
            message:
              `Zuweisung fehlgeschlagen: kein 1.0-Dokument unter '${id}' — ` +
              '2.0-Dokumente lassen sich (noch) nicht zuweisen',
          };
        }
        return {
          ok: true,
          active: false,
          message: `Eingang ${entrance.feature}@${entrance.zoneKey} → ${id}`,
        };
      }

      case 'regen': {
        const doc = args[0] ? kd.dungeons.getDocument(args[0]) : undefined;
        if (!doc) {
          return { ok: false, active: false, message: `Unbekannter Dungeon: ${args[0] ?? '?'}` };
        }
        // Handarbeit NICHT überwürfeln. `regen` erzeugt aus Basis und
        // Seed neu — bei einem `custom`-Dokument ist das Ergebnis nicht
        // das Grab, an dem jemand gebaut hat, sondern ein fremdes, und
        // das alte Layout ist danach weg. Es gibt hier absichtlich KEIN
        // `force`: Der Weg, ein gebautes Grab durch ein gewürfeltes zu
        // ersetzen, führt über den Editor, wo man vorher sieht, was man
        // wegwirft.
        if (doc.mode === 'custom') {
          return {
            ok: false,
            active: false,
            message:
              `${doc.id} ist von Hand gebaut (mode custom) — 'regen' würfelt aus Basis und ` +
              'Seed neu und die Handarbeit wäre verloren. Neu generieren geht im Editor ' +
              'über „Neu anlegen" mit „voll generieren".',
          };
        }
        const seed = Number.isFinite(Number(args[1]))
          ? Number(args[1]) | 0
          : (Math.random() * 0x7fffffff) | 0;
        // OHNE eigenes `einstellungen`-Argument: `createGenerated` nimmt
        // die im Dokument gespeicherten `generatorEinstellungen`, sonst
        // fiele das Grab hier still auf die Kit-Vorgabe zurück.
        const fresh = kd.dungeons.createGenerated(doc.base, seed, doc.id);
        if (!fresh) {
          return { ok: false, active: false, message: 'Neugenerierung fehlgeschlagen' };
        }
        kd.dungeons.destroyInstance(doc.id);
        return {
          ok: true,
          active: false,
          message: `${doc.id} neu generiert (Seed ${seed}, ${fresh.layout.rooms.length} Räume)`,
        };
      }

      case 'steinkit': {
        const doc = args[0] ? kd.dungeons.getDocument(args[0]) : undefined;
        if (!doc) {
          return { ok: false, active: false, message: `Unbekannter 1.0-Dungeon: ${args[0] ?? '?'}` };
        }
        // ── `room=<i>`: dasselbe Kommando, eine Stufe tiefer ───────────
        //
        // Ohne `room=` gilt wie bisher das DOKUMENT. Mit `room=<i>` gilt
        // GENAU DIESE Platzierung (`PlacedRoom.steinKit`) — deshalb muss
        // die Angabe VOR der allgemeinen key=value-Schleife heraus, die
        // jedes unbekannte Token ablehnt.
        // With `room=<i>` the very same command edits ONE placed room
        // instead of the document; pulled out before the generic loop.
        const rest: string[] = [];
        let roomIndex: number | null = null;
        for (const arg of args.slice(1)) {
          if (!arg.startsWith('room=')) {
            rest.push(arg);
            continue;
          }
          const zahl = Number(arg.slice('room='.length));
          if (!Number.isFinite(zahl) || !Number.isInteger(zahl)) {
            return { ok: false, active: false, message: `Kein Raumindex: ${arg}` };
          }
          roomIndex = zahl;
        }
        if (roomIndex !== null && (roomIndex < 0 || roomIndex >= doc.layout.rooms.length)) {
          return {
            ok: false,
            active: false,
            message: `Raumindex ${roomIndex} liegt ausserhalb — ${doc.id} hat ${doc.layout.rooms.length} Räume (0..${doc.layout.rooms.length - 1})`,
          };
        }
        // Das Ziel der Änderung: das Dokument selbst oder ein Raum darin.
        // Ein Zeiger statt zweier Zweige — sonst driften Prüfung, Sanitizer
        // und Speichern zwischen beiden Wegen auseinander.
        const ziel: { steinKit?: Partial<SteinKitConfig> } =
          roomIndex === null ? doc : doc.layout.rooms[roomIndex]!;
        const wo = roomIndex === null ? doc.id : `${doc.id} Raum ${roomIndex}`;
        if (rest.length === 1 && rest[0] === 'reset') {
          delete ziel.steinKit;
          kd.dungeons.saveDocument(doc);
          kd.dungeons.destroyInstance(doc.id);
          return {
            ok: true,
            active: false,
            message:
              roomIndex === null
                ? `${wo}: Steinmaterial gelöscht — es gilt wieder die Kit-Vorgabe`
                : `${wo}: Steinmaterial gelöscht — es gilt wieder das des Dokuments`,
          };
        }
        // key=value in ein rohes Objekt legen und EINMAL durch denselben
        // Sanitizer schicken wie ein hochgeladenes Dokument. Der Befehl
        // hat damit keine eigene Prüfung, die von jener abweichen könnte.
        // Parsed into a raw object and run through the SAME sanitizer as an
        // uploaded document — no second, divergent check.
        const roh: Record<string, unknown> = { ...(ziel.steinKit ?? {}) };
        const verw: Record<string, unknown> = {
          ...((ziel.steinKit?.verwitterung ?? {}) as Record<string, unknown>),
        };
        const unbekannt: string[] = [];
        for (const arg of rest) {
          const [k, v] = arg.split('=', 2);
          if (!k || v === undefined) {
            unbekannt.push(arg);
            continue;
          }
          switch (k) {
            case 'wand':
            case 'decke':
            case 'boden': {
              const pfad = steinTexturAufloesen(v);
              if (!pfad) {
                return {
                  ok: false,
                  active: false,
                  message:
                    `Unbekannte Textur "${v}" — erlaubt: ` +
                    STEIN_TEXTUREN.map((t) => t.split('/').pop()!.replace('.png', '')).join(', '),
                };
              }
              roh[k === 'wand' ? 'wandTextur' : k === 'decke' ? 'deckeTextur' : 'bodenTextur'] =
                pfad;
              break;
            }
            case 'moos':
            case 'frost':
            case 'nass':
              verw[k] = Number(v);
              break;
            case 'kachel':
              roh.kachelM = Number(v);
              break;
            case 'deckenkachel':
              roh.deckeKachelM = Number(v);
              break;
            default:
              unbekannt.push(arg);
          }
        }
        if (unbekannt.length > 0) {
          return {
            ok: false,
            active: false,
            message:
              `Unbekannte Angabe: ${unbekannt.join(' ')} — Aufruf: dungeon steinkit <id> ` +
              '[room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> ' +
              'nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset',
          };
        }
        if (Object.keys(verw).length > 0) roh.verwitterung = verw;
        const sauber = sanitizeSteinKit(roh);
        if (!sauber) {
          return {
            ok: false,
            active: false,
            message: 'Nichts Gültiges angegeben — nichts geändert',
          };
        }
        ziel.steinKit = sauber;
        kd.dungeons.saveDocument(doc);
        // Drop the instance as `regen` does. Anyone still inside is moved
        // to the main world first (`instanzWeltEntfernen`) and re-enters
        // with `dungeon enter`; only that teleport packet carries the new
        // material to a client.
        // Die Instanz verwerfen wie bei `regen`: Wer drin steht, wird zuerst
        // in die Hauptwelt umgezogen und betritt sie mit `dungeon enter`
        // frisch — erst dieses Teleport-Paket trägt das neue Material.
        kd.dungeons.destroyInstance(doc.id);
        return {
          ok: true,
          active: false,
          message: `${wo}: Steinmaterial gesetzt — ${JSON.stringify(sauber)}`,
        };
      }

      // ── Grundbeleuchtung je 1.0-Dokument ──────────────────────────
      //
      // Gleicher Aufbau wie `steinkit`: prüfen, ins Dokument schreiben,
      // `saveDocument`, `destroyInstance` — erst das nächste Teleport-Paket
      // trägt den neuen Wert zum Client, eine laufende Instanz weiss von
      // ihm nichts (Vault: „server.yml erreicht laufende Clients nicht").
      // Same shape as `steinkit`; only the next teleport packet carries the
      // new value to a client, so the live instance is dropped.
      case 'licht': {
        const doc = args[0] ? kd.dungeons.getDocument(args[0]) : undefined;
        if (!doc) {
          return { ok: false, active: false, message: `Unbekannter 1.0-Dungeon: ${args[0] ?? '?'}` };
        }
        if (args[1] === undefined) {
          return {
            ok: false,
            active: false,
            message:
              `${doc.id}: Grundbeleuchtung ${ambientLichtVon(doc).toFixed(2)}` +
              `${doc.ambientLicht === undefined ? ' (Vorgabe, Feld nicht gesetzt)' : ''} — ` +
              `Aufruf: dungeon licht <id> <0..${MAX_DUNGEON_AMBIENT}> | dungeon licht <id> reset`,
          };
        }
        if (args[1] === 'reset') {
          delete doc.ambientLicht;
          kd.dungeons.saveDocument(doc);
          kd.dungeons.destroyInstance(doc.id);
          return {
            ok: true,
            active: false,
            message: `${doc.id}: Grundbeleuchtung gelöscht — es gilt wieder die Umgebung (1)`,
          };
        }
        const wert = Number(args[1]);
        // `Number('')` ist 0 und `Number('abc')` ist NaN — beides muss hier
        // heraus, sonst schriebe ein Vertipper stillschweigend „stockdunkel".
        // `Number('')` is 0, so an empty argument must be rejected here.
        if (args[1].trim() === '' || !Number.isFinite(wert)) {
          return { ok: false, active: false, message: `Keine Zahl: ${args[1]}` };
        }
        if (wert < 0 || wert > MAX_DUNGEON_AMBIENT) {
          return {
            ok: false,
            active: false,
            message: `Grundbeleuchtung muss zwischen 0 und ${MAX_DUNGEON_AMBIENT} liegen — ${wert} liegt ausserhalb`,
          };
        }
        doc.ambientLicht = wert;
        kd.dungeons.saveDocument(doc);
        kd.dungeons.destroyInstance(doc.id);
        return {
          ok: true,
          active: false,
          message:
            `${doc.id}: Grundbeleuchtung ${wert.toFixed(2)} gesetzt` +
            `${wert < 1 ? ' (dunkler als die Umgebung)' : wert > 1 ? ' (heller als die Umgebung)' : ' (wie die Umgebung)'}`,
        };
      }

      case 'reset': {
        const ok = args[0] ? kd.dungeons.destroyInstance(args[0]) : false;
        return {
          ok,
          active: false,
          message: ok ? `Instanz ${args[0]} zurückgesetzt` : `Keine aktive Instanz: ${args[0] ?? '?'}`,
        };
      }

      case 'delete': {
        const ok = args[0] ? kd.dungeons.deleteDocument(args[0]) : false;
        return {
          ok,
          active: false,
          message: ok ? `Dungeon ${args[0]} gelöscht` : `Unbekannter Dungeon: ${args[0] ?? '?'}`,
        };
      }

      default:
        return {
          ok: false,
          active: false,
          message:
            'Aufruf: dungeon list|entrances|entrance-mode|create|create2|enter|leave|assign|regen|steinkit|licht|reset|delete',
        };
    }
  });
}

/** 'forestcrypt' | 'DG_ForestCrypt' | 'ForestCrypt' → 'DG_ForestCrypt'. */
function resolveDungeonBase(kd: DungeonKontext, input: string | undefined): string | null {
  if (!input) return null;
  const norm = input.toLowerCase().replace(/^dg_/, '');
  for (const d of DUNGEONS) {
    if (d.algorithm !== 0) continue;
    if (d.name.toLowerCase().replace(/^dg_/, '') === norm) return d.name;
  }
  return null;
}

export { registerDungeonCommand, resolveDungeonBase };
