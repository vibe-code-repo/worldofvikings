/**
 * The offline flight ("Testflug", `?offline=1&layout=editor`): an object editor
 * inside the real 3D world. Prefab panel (key B), route editor (key R),
 * grab / drag / delete, NPC fields, live plinth levelling, vegetation preview.
 * Moved out of `main.ts` unchanged; it reaches `main()`'s state only through
 * the `TestflugKontext` and its draft only through `TestflugPersistenz`.
 *
 * Der Offline-Testflug: ein Objekt-Editor in der echten 3D-Welt. Aus
 * `main.ts` unverändert herausgezogen; an den Zustand von `main()` kommt er
 * nur über den Kontext, an den Entwurf nur über die Persistenz.
 */
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import {
  findPrefabByName,
  getStableHash,
  istNpcPrefab,
  loeseNpcAuf,
  PLATEAU_RAND_MAX,
  RegionGeo,
  sanitizeWorldLayout,
} from '@wov/shared';
import type { NpcDef } from '@wov/shared';
import { frischePlatzierungsId } from '@wov/shared/src/worldlayout/platzierungsId.js';
import { SpawnPanel } from '../SpawnPanel';
import { RoutenEditor } from '../RoutenEditor';
import { RoutenVorschau } from '../RoutenVorschau';
import { BewuchsVorschau } from '../BewuchsVorschau';
import type { TestflugKontext } from './TestflugKontext';
import type { EntwurfDokument, EntwurfEintrag, TestflugPersistenz } from './TestflugPersistenz';

/**
 * ?layout=editor lädt den Editor-Entwurf — der "Testflug" des 3D-Map-
 * Generators: die unveröffentlichte Welt im echten Spiel-Terrain begehen
 * (editor.html setzt den Eintrag). Ohne `layout=editor` gibt es keinen
 * Entwurf (`null`).
 */
export function ladeTestflugEntwurf(params: URLSearchParams, persistenz: TestflugPersistenz): unknown {
  let testflug: unknown = null;
  if (params.get('layout') === 'editor') {
    try {
      testflug = persistenz.laden();
    } catch {
      testflug = null;
    }
    if (!testflug) console.warn('[Testflug] Kein Editor-Entwurf in localStorage');
  }
  return testflug;
}

/**
 * Wires the flight into the running world. Call it right after the offline
 * `buildWorld()`; `testflug` is what `ladeTestflugEntwurf` returned. Without a
 * draft (or without an entity manager) nothing is set up.
 */
export function starteTestflug(kontext: TestflugKontext, testflug: unknown): void {
  const { scene, engine, canvas, hud, lighting, persistenz } = kontext;

  // ── Editor-Spawn im 3D-Testflug ─────────────────────────────────
  // Platzierungen des Entwurfs sichtbar machen und per Taste B + Klick
  // NEUE Objekte direkt im Gelände setzen — sie landen im selben
  // localStorage-Entwurf, den editor.html bearbeitet.
  const ent = kontext.entities();
  if (testflug && ent) {
    // `anim` ist optional und nur für die Routen-Vorschau da: Sie schaltet
    // damit dieselbe Animationsgruppe um, die online der Server über den
    // ZDO-Member `anim` steuert (idle/walk). Ohne Angabe bleibt es bei der
    // Animation aus der PrefabDef — für jede stehende Platzierung.
    const zeige = (p: { prefab: string; x: number; z: number; yaw?: number; scale?: number; anim?: string; npc?: NpcDef }, i: number): void => {
      const world = kontext.world();
      if (!findPrefabByName(p.prefab) || !world) return;
      const yaw = p.yaw ?? 0;
      // NPC-Einordnung fertig aufgelöst mitgeben statt über `layoutId`:
      // Offline gibt es keinen Server, der eine Kennung setzen könnte,
      // und der Entwurf liegt hier unmittelbar vor. Damit sieht der
      // Zeichner jede Änderung an Name/Rolle/Stufe sofort am Schild —
      // die Platzierung wird nach dem Bearbeiten einfach neu gezeichnet.
      const npc = loeseNpcAuf(p.prefab, p.npc);
      ent.applyUpdate({
        key: i < 0 ? 'edghost' : `edplace-${i}`,
        prefabHash: getStableHash(p.prefab),
        position: { x: p.x, y: world.getGroundHeight(p.x, p.z), z: p.z },
        rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
        ...(p.anim !== undefined ? { anim: p.anim } : {}),
        // Der Geist an der Maus (i < 0) bleibt bewusst ohne Schild — er
        // ist noch keine Figur, sondern eine Vorschau.
        ...(npc && i >= 0 ? { npc } : {}),
        isOwn: false,
      } as never);
    };
    const entwurf = testflug as { placements?: EntwurfEintrag[] };
    (entwurf.placements ?? []).forEach(zeige);
    ent.flush();

    // ── Live-Planieren ──────────────────────────────────────────────
    // Sockel sofort in die laufende Geo einfügen/entfernen und die
    // betroffenen Kacheln neu bauen — wer ein Bauwerk setzt, muss das
    // Planieren SOFORT sehen, nicht erst nach F5. Neuladen und Server
    // rechnen trotzdem exakt dieselbe Höhe, weil die Zielhöhe in
    // RegionGeo immer die UNGEEBNETE Mittelpunkthöhe ist — unabhängig
    // davon, wann die Platte dazukam.
    const kachelnNeu = (x: number, z: number, radius: number): void => {
      const world = kontext.world();
      if (!world) return;
      const reichweite = radius + PLATEAU_RAND_MAX;
      // Muster F4 (applyLocationLeveling): Zonen-Cache verwerfen, Kacheln
      // über den Ring-Scan neu bauen lassen. Das Gras steht sonst auf der
      // alten Höhe (Muster: Terrain-Werkzeuge, grass.clearArea).
      kontext.terrain()?.rebuildZones(world.heightmaps.invalidateArea(x, z, reichweite));
      kontext.grass()?.clearArea(x, z, reichweite);
    };
    const sockelLiveDazu = (x: number, z: number, radius: number): void => {
      const world = kontext.world();
      if (!world || !(world.geo instanceof RegionGeo)) return;
      world.geo.sockelEinfuegen(x, z, radius);
      kontext.sockelFreiflaechen().push({ x, z, r: radius });
      kachelnNeu(x, z, radius);
    };
    const sockelLiveWeg = (p: { x: number; z: number; einebnen?: number }): void => {
      const world = kontext.world();
      if (!p.einebnen || !world || !(world.geo instanceof RegionGeo)) return;
      if (!world.geo.sockelEntfernen(p.x, p.z)) return;
      kontext.setzeSockelFreiflaechen(
        kontext.sockelFreiflaechen().filter(
          (s) => Math.abs(s.x - p.x) >= 0.05 || Math.abs(s.z - p.z) >= 0.05
        )
      );
      kachelnNeu(p.x, p.z, p.einebnen);
    };

    const panel = new SpawnPanel({
      // Tageszeit im Testflug: Lighting rechnet in Tagesbruchteilen
      // (0–1), der Regler zeigt Stunden. `paused` stoppt den Zyklus in
      // Lighting.apply() — ohne das wandert jeder eingestellte Wert
      // sofort weiter.
      setzeZeit: (stunden, angehalten) => {
        if (!lighting) return;
        lighting.timeOfDay = ((stunden / 24) % 1 + 1) % 1;
        lighting.paused = angehalten;
      },
      zeit: () => (lighting ? lighting.timeOfDay * 24 : 12),
      anzahl: () => {
        const roh: EntwurfDokument = persistenz.laden() ?? {};
        return roh.placements?.length ?? 0;
      },
      platzieren: () => platziere(),
      // ── NPC-Angaben der GEWÄHLTEN Platzierung ─────────────────────
      // Gelesen und geschrieben wird derselbe localStorage-Entwurf, den
      // auch Setzen, Ziehen und Löschen anfassen — eine zweite Quelle
      // für dieselben Daten wäre der sichere Weg in Widersprüche.
      gewaehlteNpc: () => {
        if (auswahlIndex < 0) return null;
        const p = leseEntwurf()?.placements[auswahlIndex];
        return p ? { prefab: p.prefab, npc: p.npc } : null;
      },
      setzeNpc: (npc) => {
        const roh = leseEntwurf();
        const p = roh?.placements[auswahlIndex];
        if (!roh || !p) return;
        if (npc) p.npc = npc;
        else delete p.npc;
        persistenz.aendern(roh);
        // Sofort neu zeichnen: Das Namensschild hängt an der Instanz,
        // und der Zeichner soll den geänderten Namen sehen, ohne die
        // Figur erst verschieben zu müssen.
        zeige(p, auswahlIndex);
        ent.flush();
        hud.meldung(`${p.prefab}: Angaben übernommen`);
      },
      entferneLetztes: () => {
        const roh = persistenz.laden();
        if (!roh?.placements?.length) return;
        const i = roh.placements.length - 1;
        const weg = roh.placements[i]!;
        roh.placements = roh.placements.slice(0, -1);
        persistenz.aendern(roh);
        ent.removeZDO(`edplace-${i}`);
        ent.flush();
        // Kein verwaister Sockel: Der Untergrund geht mit der Platzierung.
        sockelLiveWeg(weg);
        hud.meldung('Letzte Platzierung entfernt');
      },
    });
    // Sockel-Radius fürs Einebnen: halbe DIAGONALE der Grundfläche plus
    // ein Meter Zugabe, mit der gewählten Größe skaliert. Zwei Anläufe
    // reichten nicht: ×0,8 ließ den Rand des Grabhügels auf unplaniertem
    // Gelände stehen, und auch w/2 + 1 (= 22,3 m) endete VOR der
    // Eingangsfront — renderScale.w ist nur die Bbox-BREITE, Vorbauten
    // (Portal bei −21,6 m, Runenstein bei −24 m) und jede yaw-Drehung
    // schieben Ecken bis zur halben Diagonale hinaus, und die Böschung
    // kletterte als Grashang quer über das Portal. Erst hinter der
    // Diagonale (Grabhügel: ~31 m) darf sie beginnen.
    const sockelRadius = (): number => {
      const e = panel.einstellung;
      const w = findPrefabByName(e.prefab)?.renderScale.w ?? 4;
      // Halbe LÄNGSTE Ausdehnung plus ein Meter Zugabe. Ein Kreis mit
      // diesem Radius deckt das Bauwerk in JEDER Drehung, weil w bereits
      // die größte waagerechte Kante ist.
      //
      // Vorher stand hier zusätzlich ein √2 — das rechnet die Diagonale
      // eines QUADRATS aus und ist für längliche Bauten schlicht zu
      // grosszügig: Beim Grabhügel (42,6 × 29,4 m) ergab das 31 m statt
      // 22 m, also einen Ring von bis zu 9 m planierter Wiese rund um
      // den Fuss. Gemeldet als „es wird sehr viel rund um den Hügel
      // planiert". Die Ecken einer gedachten Bbox deckt der Kreis dann
      // zwar nicht mehr — dort ist bei einem runden Hügel aber ohnehin
      // nur Luft.
      return Math.round(((w * e.scale) / 2) + 1);
    };
    const platziere = (): void => {
      const player = kontext.player();
      if (!player || !kontext.world()) return;
      // Zentrale Schranke für ALLE Setz-Pfade (Taste P, „Platzieren"-
      // Knopf, Linksklick bei gefangener Maus): Ohne bewusst in der
      // Liste aktivierten Platzier-Modus wird NICHTS gesetzt — sonst
      // setzte z. B. der Klick, der nach dem Schließen mit B die Maus
      // wieder einfängt, still das localStorage-Prefab in die Welt.
      if (!panel.istPlatzierModus) {
        hud.meldung('Kein Prefab aktiv — erst in der Liste (B) anklicken');
        return;
      }
      // Zweite Schranke: Solange Wegpunkte gesetzt werden, gehört der
      // Klick (und die Taste P) der Route — sonst stünde am Wegpunkt
      // ungewollt ein Baum. Kann eigentlich nicht eintreten, weil
      // aufZeichenStart den Platzier-Modus beendet; billiger Rückhalt.
      if (routen.istZeichenModus) {
        hud.meldung('Routen-Zeichnen aktiv — erst mit ✎ oder Esc beenden');
        return;
      }
      const e = panel.einstellung;
      const wx = Math.round(player.position.x - Math.sin(player.yaw) * e.abstand);
      const wz = Math.round(player.position.z - Math.cos(player.yaw) * e.abstand);
      const roh = persistenz.laden();
      if (!roh) return;
      const sockel = e.einebnen ? sockelRadius() : undefined;
      const eintrag = {
        // Eine neue Platzierung bekommt eine id mit Zufallsschwanz (frischePlatzierungsId), nie die abgeleitete.
        id: frischePlatzierungsId(roh, { prefab: e.prefab, x: wx, z: wz }),
        prefab: e.prefab,
        x: wx,
        z: wz,
        yaw: e.yaw ?? Math.random() * Math.PI * 2,
        ...(Math.abs(e.scale - 1) > 1e-3 ? { scale: e.scale } : {}),
        ...(sockel !== undefined ? { einebnen: sockel } : {}),
      };
      roh.placements = [...(roh.placements ?? []), eintrag];
      persistenz.aendern(roh);
      // Erst planieren, DANN zeichnen: zeige() liest getGroundHeight —
      // das Bauwerk soll auf der Platte sitzen, nicht auf der alten Welle.
      if (sockel !== undefined) sockelLiveDazu(wx, wz, sockel);
      zeige(eintrag, roh.placements.length - 1);
      ent.flush();
      // Eine frisch gesetzte FIGUR ist sofort die gewählte: Sonst müsste
      // man sie erst wieder anklicken, um ihr einen Namen zu geben.
      // Bewusst nur bei NPCs — bei Bäumen wäre eine Auswahl, die Entf
      // scharf macht, eine unerwartete Nebenwirkung des Setzens.
      if (istNpcPrefab(e.prefab)) auswahlIndex = roh.placements.length - 1;
      panel.aktualisiere();
      hud.meldung(
        `${e.prefab} platziert @ (${wx}, ${wz})` +
          (sockel !== undefined ? ` — Boden planiert (r=${sockel} m)` : '')
      );
      // Nutzerwunsch: Nach dem Setzen hängt NICHTS mehr an der Maus —
      // der Modus endet mit der Platzierung (aufWahl räumt den Geist ab).
      // Wer ein weiteres Exemplar will, klickt den Eintrag erneut an.
      panel.beendePlatzierModus();
    };
    kontext.setzeSpawnEditorOffen(() => panel.istOffen);
    /**
     * Landet der Tastendruck gerade in einem Feld des Panels, das ihn
     * selbst verarbeitet? Im Suchfeld sind „b"/„p"/Entf Texteingabe, im
     * Kategorie-Select springen Buchstaben zu Einträgen — ohne diese
     * Sperre schloss das Tippen das Menü bzw. platzierte mitten im
     * Suchwort (Ursache von „B setzt nochmal"). Regler und Häkchen
     * schlucken keine Buchstaben, dort gelten die Kürzel weiter.
     */
    const tipptImFeld = (e: KeyboardEvent): boolean =>
      (e.target instanceof HTMLInputElement &&
        // `number` seit den NPC-Feldern dabei: Im Stufenfeld ist die
        // Tastatur Eingabe, nicht Steuerung — sonst schlösse ein
        // Tastendruck darin das Panel oder platzierte.
        (e.target.type === 'text' || e.target.type === 'number')) ||
      e.target instanceof HTMLSelectElement;
    window.addEventListener('keydown', (e) => {
      if (tipptImFeld(e)) return;
      if (e.code === 'KeyB') {
        const offen = panel.toggle();
        if (!offen) {
          geistWeg();
          ring.setEnabled(false);
          auswahlIndex = -1;
        }
        if (offen) {
          // Maus freigeben, damit Liste/Regler anklickbar sind — das
          // Wieder-Einfangen übernimmt der Game-Loop (cursorNoetig).
          document.exitPointerLock();
        }
        hud.meldung(
          offen
            ? 'Spawn-Editor offen — Prefab anklicken startet die Platzierung, B schließt'
            : 'Spawn-Editor zu'
        );
      }
      if (e.code === 'KeyP' && panel.istOffen) platziere();
      // Esc beendet den Platzier-Modus (die Vorauswahl in der Liste bleibt).
      if (e.code === 'Escape') panel.beendePlatzierModus();
    });

    // ── Baumodus (Taste V) ──────────────────────────────────────────
    // Nur im Editor-Testflug registriert (dieser Block läuft sonst nie):
    // Figur schwebt, Kamera darf weit heraus — Übersicht beim Anlegen
    // ganzer Siedlungen. V ist frei (B=Spawn-Panel, E/F/P/M/I/C/Tab
    // vergeben); die Mechanik liegt im PlayerController (setBauModus).
    window.addEventListener('keydown', (e) => {
      const player = kontext.player();
      if (e.code !== 'KeyV' || !player) return;
      // Tippt man gerade im Suchfeld des Panels, ist "v" ein Buchstabe.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const an = !player.bauModus;
      player.setBauModus(an);
      hud.meldung(
        an
          ? 'Baumodus AN — WASD fliegt, Leer steigt, X/Strg sinkt, Rad zoomt weit, V beendet'
          : 'Baumodus AUS — Figur fällt zu Boden'
      );
    });
    window.addEventListener('mousedown', (e) => {
      // Bei gefangener Maus platziert der Linksklick vor dem Spieler;
      // Rechtsklick (button 2) verwirft auch hier.
      if (!panel.istOffen || !document.pointerLockElement) return;
      if (e.button === 2) {
        verwerfen();
        return;
      }
      if (e.button === 0 && performance.now() - rechtsklickZeit > 400) platziere();
    });

    // ── Maus-Platzierung + Verschieben (Cursor frei) ────────────────
    //
    // Der Klickpunkt wird per Kamerastrahl gegen das Höhenfeld gemarcht
    // (kein scene.pick: Thin Instances und Terrain-Kacheln sind nicht
    // verlässlich pickbar). Klick auf freie Fläche = neues Objekt am
    // Mauspunkt; Klick nahe einer Platzierung = greifen und ziehen.
    const bodenPunkt = (px: number, py: number): { x: number; z: number } | null => {
      const player = kontext.player();
      const world = kontext.world();
      if (!player || !world) return null;
      const ray = scene.createPickingRay(px, py, null, player.camera);
      let t0 = 0;
      let t1 = -1;
      for (let t = 2; t < 800; t += 2) {
        const x = ray.origin.x + ray.direction.x * t;
        const y = ray.origin.y + ray.direction.y * t;
        const z = ray.origin.z + ray.direction.z * t;
        if (y <= world.getGroundHeight(x, z)) {
          t1 = t;
          break;
        }
        t0 = t;
      }
      if (t1 < 0) return null;
      for (let i = 0; i < 10; i++) {
        const tm = (t0 + t1) / 2;
        const x = ray.origin.x + ray.direction.x * tm;
        const y = ray.origin.y + ray.direction.y * tm;
        const z = ray.origin.z + ray.direction.z * tm;
        if (y <= world.getGroundHeight(x, z)) t1 = tm;
        else t0 = tm;
      }
      const tm = (t0 + t1) / 2;
      return { x: ray.origin.x + ray.direction.x * tm, z: ray.origin.z + ray.direction.z * tm };
    };
    const leseEntwurf = (): { placements: EntwurfEintrag[] } | null => {
      const roh = persistenz.laden();
      if (!roh) return null;
      roh.placements = roh.placements ?? [];
      return roh as { placements: EntwurfEintrag[] };
    };
    let ziehIndex = -1;
    /** Griffposition beim Packen — nach dem Ziehen wandert der Sockel
     *  von dort zur neuen Position (die alte steht sonst als verwaiste
     *  Platte im Gelände). */
    let ziehStart: { x: number; z: number } | null = null;
    /** Ausgewählte (zuletzt gegriffene) Platzierung — Ziel von Entf. */
    let auswahlIndex = -1;
    // Ob die Vorschau an der Maus hängt, entscheidet allein
    // panel.istPlatzierModus: aktiv erst nach bewusstem Klick in der
    // Liste, beendet durch Abwahl/Esc/Rechtsklick. Ein lokales Flag
    // hier war die Quelle des „Geist klebt nach dem Laden an der Maus".

    // ── Routen-Editor (Taste R) ─────────────────────────────────────
    // NACH `auswahlIndex` angelegt: Der Konstruktor zeichnet die Anzeige
    // einmal auf und liest dabei die gewählte Platzierung — vor der
    // Deklaration wäre das ein Zugriff in die temporale Todeszone.
    const routen = new RoutenEditor(scene, {
      bodenHoehe: (x, z) => kontext.world()?.getGroundHeight(x, z) ?? 0,
      meldung: (t) => hud.meldung(t),
      gewaehltePlatzierung: () => auswahlIndex,
      // Zeichnen und Platzieren schließen einander aus (s. RoutenEditor).
      aufZeichenStart: () => {
        panel.beendePlatzierModus();
        geistWeg();
      },
      // Entwurf in die Serverdatei schreiben (Persistenz-Baustein `speichern`,
      // derselbe Endpunkt wie beim Karten-Editor).
      aufSpeichern: () => {
        const roh = leseEntwurf();
        if (!roh) {
          hud.meldung('Kein Entwurf zum Speichern');
          return;
        }
        const sauber = sanitizeWorldLayout(roh as never);
        if (!sauber) {
          hud.meldung('Entwurf ist unbrauchbar — nicht gespeichert');
          return;
        }
        hud.meldung('Speichere in die Welt …');
        void persistenz
          .speichern(sauber)
          .then((a) => {
            hud.meldung(
              a.ok
                ? `${a.message} — Server neu starten, damit die Welt sie lädt`
                : a.message
            );
          })
          .catch((err) => hud.meldung(`Speichern fehlgeschlagen: ${String(err)}`));
      },
      // Umschalter „Vorschau an/aus" (Vorgabe AN). Der Zustand lebt im
      // Panel, das Laufen in RoutenVorschau — beim Ausschalten kehren die
      // NPCs auf ihren gespeicherten Platz zurück.
      aufVorschau: (an) => vorschau.setzeAn(an),
    });
    kontext.setzeRoutenEditorOffen(() => routen.istOffen);

    // ── Routen-Vorschau im Testflug ─────────────────────────────────
    // Läuft NUR hier (offline + layout=editor). Online bewegt der Server,
    // im normalen Offline-Spiel gibt es keinen Entwurf mit Routen.
    const vorschau = new RoutenVorschau({
      // Derselbe Weg wie bei jeder anderen Platzierung: gleicher Schlüssel
      // `edplace-<i>` ⇒ die bestehende Instanz wird nachgeführt, es
      // entsteht keine zweite. `anim` schaltet die Animationsgruppe um.
      zeichne: (i, p, x, z, yaw, anim) => zeige({ prefab: p.prefab, x, z, yaw, anim }, i),
      // Was am Mauszeiger hängt, läuft nicht (s. RoutenVorschau).
      gegriffen: () => ziehIndex,
      // Der Spieler ist im Testflug das Gegenüber, an dem sich Aggro
      // entscheidet — online liefert der Server dafür die Peer-Positionen.
      spieler: () => {
        const player = kontext.player();
        return player ? { x: player.position.x, z: player.position.z } : null;
      },
      meldung: (t) => hud.meldung(t),
    });
    // ── Bewuchs-Vorschau im Testflug ────────────────────────────────
    // Streut, was der Server streuen würde — mit DERSELBEN Funktion
    // (`streueZone` aus @wov/shared). Ohne sie blieb eine Insel im
    // Testflug kahl, auch wenn im Editor "Grasland bewachsen" gedrückt
    // war: Offline gibt es keinen ZoneManager.
    //
    // Nur im Layout-Modus sinnvoll — ohne Region gibt es keine
    // Kuratierung und damit nichts vorzuschauen.
    const welt = kontext.world();
    const bewuchs = welt?.regionGeo
      ? new BewuchsVorschau(
          { seed: welt.seed, geo: welt.geo, heightmaps: welt.heightmaps, regionGeo: welt.regionGeo },
          ent
        )
      : null;
    if (bewuchs) {
      hud.meldung('Bewuchs-Vorschau: wächst um dich herum nach (V baut sie neu auf)');
      window.addEventListener('keydown', (e) => {
        if (tipptImFeld(e) || e.code !== 'KeyV') return;
        bewuchs.neuAufbauen();
        hud.meldung('Bewuchs-Vorschau neu aufgebaut');
      });
    }

    scene.onBeforeRenderObservable.add(() => {
      // Vor buildWorld() gibt es keine Geländehöhe — dann noch nichts tun.
      if (!kontext.world()) return;
      // Höchstens EINE Zone je Bild (13,4 ms gemessen) — der Umkreis
      // steht damit nach gut einer Sekunde, ohne dass ein Bild reißt.
      const player = kontext.player();
      if (bewuchs && player) bewuchs.schritt(player.position.x, player.position.z);
      // Dieselbe Deckelung wie die Hauptschleife: Nach einem Tab-Wechsel
      // wäre der erste dt sonst Sekunden lang und der NPC teleportierte.
      vorschau.update(Math.min(engine.getDeltaTime() / 1000, 0.1));
      // Ein Routen-NPC ist dynamisch (SYNCED_TRANSFORM) und käme ohne das
      // flush() aus; eine statische Platzierung an einer Route nicht —
      // ihre Thin-Instance-Matrix wird erst dort neu gebaut. Einmal je
      // Frame, nicht je NPC.
      ent.flush();
    });
    /** Gegriffener Wegpunkt der gewählten Route (−1 = keiner). */
    let routenZiehIndex = -1;
    window.addEventListener('keydown', (e) => {
      if (tipptImFeld(e)) return;
      if (e.code === 'KeyR') {
        const offen = routen.toggle();
        // Wie bei B: Maus freigeben, das Wieder-Einfangen macht der
        // Game-Loop über cursorNoetig().
        if (offen) document.exitPointerLock();
        hud.meldung(
          offen
            ? 'Routen-Editor offen — Route wählen/anlegen, ✎ schaltet das Setzen scharf, R schließt'
            : 'Routen-Editor zu'
        );
      }
      // Esc beendet nur das Zeichnen, nicht das Panel — die Route bleibt.
      if (e.code === 'Escape') routen.beendeZeichnen();
    });

    // Leuchtring markiert Auswahl/Griff; Geist zeigt das Prefab an der Maus.
    const ring = MeshBuilder.CreateTorus('spawnRing', { diameter: 3, thickness: 0.12, tessellation: 48 }, scene);
    const ringMat = new StandardMaterial('spawnRingMat', scene);
    ringMat.emissiveColor = new Color3(0.95, 0.82, 0.35);
    ringMat.disableLighting = true;
    ring.material = ringMat;
    ring.isPickable = false;
    ring.setEnabled(false);
    const ringZu = (x: number, z: number): void => {
      ring.position.set(x, (kontext.world()?.getGroundHeight(x, z) ?? 0) + 0.15, z);
      ring.setEnabled(true);
    };

    let geistPrefab = '';
    const geistWeg = (): void => {
      // BEDINGUNGSLOS abräumen. Vorher hing das Entfernen an der
      // Merkvariablen `geistPrefab` — und wenn die aus irgendeinem Grund
      // leer war, während die Geist-Instanz noch in der Szene lag, blieb
      // sie für immer stehen. Genau das passierte seit „ein Klick = eine
      // Platzierung": Der Geist fror auf dem eben gesetzten Bauwerk ein,
      // und es sah aus, als wäre doppelt gesetzt worden (gemessen: der
      // Bucket enthielt `edghost` UND `edplace-0`).
      //
      // removeZDO auf einen unbekannten Schlüssel ist ein No-Op, die
      // Bedingung war also nie nötig — nur riskant.
      ent.removeZDO('edghost');
      geistPrefab = '';
      ent.flush();
    };
    /**
     * Prefab für den VORSCHAU-Geist.
     *
     * Rein kosmetische Varianten werden für die Vorschau auf ihre
     * Grundform zurückgeführt. Grund: Der Geist ist eine echte Instanz
     * in der Szene, und der Kuppel-Bewuchs (HuegelGras) streut auf
     * jede Instanz, die er findet. Beim Geist hiess das: Gras wird
     * gestreut, sobald man den Eintrag anklickt — und bleibt in der
     * Luft stehen, sobald der Geist mit der Maus weiterwandert.
     *
     * Für die Vorschau ist das kein Verlust: Beide Varianten haben
     * exakt dieselbe Form, es geht um Lage und Drehung.
     */
    const VORSCHAU_PREFAB: Readonly<Record<string, string>> = {
      GrabhuegelGras: 'Grabhuegel',
    };
    const geistZu = (x: number, z: number): void => {
      const e = panel.einstellung;
      // Prefabwechsel: alter Geist liegt in einem anderen Bucket — erst weg.
      const sichtbar = VORSCHAU_PREFAB[e.prefab] ?? e.prefab;
      if (geistPrefab && geistPrefab !== sichtbar) geistWeg();
      geistPrefab = sichtbar;
      zeige(
        { prefab: VORSCHAU_PREFAB[e.prefab] ?? e.prefab, x, z, yaw: e.yaw ?? 0, scale: e.scale },
        -1 as never
      );
      ent.flush();
    };

    /** Nach Löschen/Umbau: alle edplace-Keys neu aufbauen (Indizes rutschen). */
    const alleNeuZeichnen = (roh: { placements: EntwurfEintrag[] }, vorher: number): void => {
      for (let i = 0; i < vorher; i++) ent.removeZDO(`edplace-${i}`);
      roh.placements.forEach(zeige);
      ent.flush();
    };
    window.addEventListener('keydown', (e) => {
      // Entf im Suchfeld löscht Text — nicht die gegriffene Platzierung.
      if (tipptImFeld(e)) return;
      if (e.code !== 'Delete' || !panel.istOffen || auswahlIndex < 0) return;
      const roh = leseEntwurf();
      if (!roh || !roh.placements[auswahlIndex]) return;
      const weg = roh.placements[auswahlIndex]!;
      const vorher = roh.placements.length;
      roh.placements.splice(auswahlIndex, 1);
      persistenz.aendern(roh);
      // Sockel VOR dem Neuzeichnen entfernen: alleNeuZeichnen liest
      // getGroundHeight — Nachbarn sollen wieder auf dem Urgelände sitzen.
      sockelLiveWeg(weg);
      alleNeuZeichnen(roh, vorher);
      hud.meldung(`${weg.prefab} gelöscht`);
      auswahlIndex = -1;
      ring.setEnabled(false);
      panel.aktualisiere();
      // Die Indizes hinter der Lücke rutschen — die Anzeige „gewählte
      // Platzierung" im Routen-Editor darf keine alte Nummer behalten.
      routen.aktualisiere();
      // Aus demselben Grund die Vorschau neu aufbauen: `edplace-3` ist
      // nach dem Löschen ein anderes Objekt, ein weiterlaufender Läufer
      // schöbe das falsche durch die Gegend.
      vorschau.ruecksetzen();
    });

    /** Verwerfen: von Rechtsklick-pointerdown UND contextmenu gerufen —
     *  je nach Browser/Pointer-Lock kommt nur eines von beiden an. */
    let rechtsklickZeit = 0;
    const verwerfen = (): void => {
      rechtsklickZeit = performance.now();
      if (document.pointerLockElement) {
        document.exitPointerLock();
        return;
      }
      ziehIndex = -1;
      routenZiehIndex = -1;
      auswahlIndex = -1;
      ring.setEnabled(false);
      geistWeg();
      panel.beendePlatzierModus();
      // Ohne Auswahl gibt es keine Figur zu bearbeiten — Felder weg.
      panel.aktualisiere();
      // Rechtsklick verwirft auch das Routen-Zeichnen — dieselbe Geste,
      // dieselbe Bedeutung wie beim Prefab-Geist.
      routen.beendeZeichnen();
      hud.meldung('Auswahl verworfen — Prefab in der Liste wählen startet die Vorschau neu');
    };
    canvas.addEventListener('pointerdown', (e) => {
      // Der Routen-Editor darf dieselben Wege benutzen (Wegpunkt setzen,
      // Platzierung zum Zuweisen auswählen) — deshalb genügt es, dass
      // EINES der beiden Editor-Panels offen ist. Ist keines offen,
      // bleibt der Klick unangetastet Spiel-Eingabe.
      if (!panel.istOffen && !routen.istOffen) return;
      if (e.button === 2) {
        e.preventDefault();
        verwerfen();
        return;
      }
      // Nur reiner Linksklick platziert/greift — und nie direkt nach
      // einem Rechtsklick (manche Browser feuern die Folge-Ereignisse
      // in anderer Reihenfolge, das setzte den Gegenstand ungewollt).
      if (e.button !== 0 || e.buttons !== 1 || document.pointerLockElement) return;
      if (performance.now() - rechtsklickZeit < 400) return;
      const p = bodenPunkt(e.offsetX, e.offsetY);
      const roh = leseEntwurf();
      if (!p || !roh) return;
      // ── Routen zuerst ───────────────────────────────────────────────
      // Im Zeichen-Modus gehört JEDER Geländeklick der Route; danach
      // kommt weder Greifen noch Platzieren dran.
      if (routen.istZeichenModus) {
        routen.punktSetzen(p.x, p.z);
        return;
      }
      // Sonst: Wegpunkt der gewählten Route in Griffweite? Dann anfassen.
      // Nur bei offenem Routen-Panel — bei geschlossenem bleibt der
      // Greif-Pfad der Platzierungen exakt wie zuvor.
      if (routen.istOffen) {
        const wp = routen.punktUnter(p.x, p.z);
        if (wp >= 0) {
          routenZiehIndex = wp;
          geistWeg();
          hud.meldung(`Wegpunkt ${wp + 1} von ${routen.gewaehlteId} gegriffen — ziehen verschiebt`);
          return;
        }
      }
      // Nächste Platzierung im Griffradius? Dann greifen statt setzen.
      // Gemessen wird an der SICHTBAREN Stelle: Ein Routen-NPC ist in der
      // Vorschau längst weitergelaufen, und auf seinen unsichtbaren
      // Startpunkt zu zielen wäre Raten. Ohne Vorschau ist das der
      // Eintrag selbst (positionVon liefert dann null).
      let best = -1;
      let bestD = 3;
      roh.placements.forEach((q, i) => {
        const sicht = vorschau.positionVon(i) ?? q;
        const d = Math.hypot(sicht.x - p.x, sicht.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        ziehIndex = best;
        auswahlIndex = best;
        geistWeg();
        const q = roh.placements[best]!;
        // ziehStart bleibt die GESPEICHERTE Stelle: Von dort muss beim
        // Absetzen ein etwaiger Sockel weggeräumt werden.
        ziehStart = { x: q.x, z: q.z };
        const sicht = vorschau.positionVon(best) ?? q;
        ringZu(sicht.x, sicht.z);
        // Der Routen-Editor zeigt die gewählte Platzierung an (Ziel von
        // „→ zuweisen") — er erfährt den Wechsel nur hierüber.
        routen.aktualisiere();
        // Aus demselben Grund das Spawn-Panel: Die NPC-Felder gehören
        // zur gewählten Platzierung und müssen jetzt die ihre zeigen.
        panel.aktualisiere();
        hud.meldung(`${q.prefab} gegriffen — ziehen verschiebt, Entf löscht`);
      } else if (panel.istOffen && panel.istPlatzierModus) {
        // `panel.istOffen` steht hier zusätzlich, weil der Klick seit dem
        // Routen-Editor auch bei GESCHLOSSENEM Spawn-Panel hier ankommt:
        // Gesetzt wird weiterhin nur mit sichtbarer Prefab-Liste — sonst
        // platzierte ein Klick beim Routenzeichnen aus einem Modus, den
        // man gerade gar nicht sieht.
        const einst = panel.einstellung;
        const sockel = einst.einebnen ? sockelRadius() : undefined;
        const eintrag = {
          id: frischePlatzierungsId(roh, { prefab: einst.prefab, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }),
          prefab: einst.prefab,
          x: Math.round(p.x * 10) / 10,
          z: Math.round(p.z * 10) / 10,
          yaw: einst.yaw ?? Math.random() * Math.PI * 2,
          ...(Math.abs(einst.scale - 1) > 1e-3 ? { scale: einst.scale } : {}),
          ...(sockel !== undefined ? { einebnen: sockel } : {}),
        };
        roh.placements.push(eintrag);
        persistenz.aendern(roh);
        // Erst planieren, DANN zeichnen — siehe platziere().
        if (sockel !== undefined) sockelLiveDazu(eintrag.x, eintrag.z, sockel);
        zeige(eintrag, roh.placements.length - 1);
        ent.flush();
        // Wie in platziere(): frisch gesetzte Figur ist gewählt.
        if (istNpcPrefab(einst.prefab)) auswahlIndex = roh.placements.length - 1;
        panel.aktualisiere();
        hud.meldung(
          `${einst.prefab} platziert @ (${eintrag.x}, ${eintrag.z})` +
            (sockel !== undefined ? ` — Boden planiert (r=${sockel} m)` : '')
        );
        // Ein Klick = eine Platzierung: Modus endet, der Geist folgt der
        // Maus nicht weiter — sonst setzt der nächste beiläufige Klick
        // (oder das Schließen-und-Wiederklicken um B) ungewollt erneut.
        panel.beendePlatzierModus();
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if ((!panel.istOffen && !routen.istOffen) || document.pointerLockElement) return;
      const p = bodenPunkt(e.offsetX, e.offsetY);
      if (!p) return;
      // Gegriffener Wegpunkt folgt der Maus (Linie und Marker werden in
      // punktVerschieben neu gezeichnet).
      if (routenZiehIndex >= 0) {
        routen.punktVerschieben(routenZiehIndex, p.x, p.z);
        return;
      }
      // Im Zeichen-Modus hängt bewusst NICHTS an der Maus — der Geist
      // gehört dem Prefab-Setzen, und beides zugleich wäre irreführend.
      if (routen.istZeichenModus) return;
      if (ziehIndex < 0) {
        // Vorschau: Das gewählte Prefab hängt sichtbar an der Maus,
        // erst der Klick setzt es — aber NUR im aktiven Platzier-Modus
        // (bewusste Wahl in der Liste; Abwahl/Esc/Rechtsklick beendet).
        // `istOffen` wie beim Setzen: kein Geist ohne sichtbare Liste.
        if (panel.istOffen && panel.istPlatzierModus) {
          geistZu(Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10);
        }
        return;
      }
      const roh = leseEntwurf();
      if (!roh || !roh.placements[ziehIndex]) return;
      const q = roh.placements[ziehIndex]!;
      q.x = Math.round(p.x * 10) / 10;
      q.z = Math.round(p.z * 10) / 10;
      persistenz.aendern(roh);
      zeige(q, ziehIndex); // gleicher Key ⇒ Matrix-Update, kein Duplikat
      ringZu(q.x, q.z);
      ent.flush();
    });
    canvas.addEventListener('contextmenu', (e) => {
      // Auch mit nur offenem Routen-Panel: Rechtsklick bricht ab, statt
      // das Browser-Menü über die Szene zu legen.
      if (!panel.istOffen && !routen.istOffen) return;
      e.preventDefault();
      // Doppelt ausgelöst (pointerdown + contextmenu)? Die Sperre in
      // verwerfen() macht den zweiten Aufruf harmlos.
      if (performance.now() - rechtsklickZeit > 50) verwerfen();
    });
    panel.aufWahl = () => {
      // Wahl/Modus im Panel hat sich geändert: Bei Abwahl den Geist
      // sofort abräumen; bei (Neu-)Wahl zeichnet ihn das nächste
      // pointermove — geistZu() räumt einen Prefab-Wechsel selbst auf.
      if (!panel.istPlatzierModus) geistWeg();
      // Andersherum als aufZeichenStart: Wer in der Prefab-Liste einen
      // Eintrag scharf schaltet, hört damit auf, Wegpunkte zu setzen.
      if (panel.istPlatzierModus) routen.beendeZeichnen();
      panel.aktualisiere();
    };
    window.addEventListener('pointerup', () => {
      if (routenZiehIndex >= 0) {
        hud.meldung(`Wegpunkt ${routenZiehIndex + 1} abgesetzt`);
        routenZiehIndex = -1;
        return;
      }
      if (ziehIndex < 0) return;
      const roh = leseEntwurf();
      const q = roh?.placements[ziehIndex];
      // Sockel zieht mit um: alte Platte raus, neue rein, Objekt und
      // Ring neu aufsetzen — erst NACH dem Absetzen, damit nicht bei
      // jedem pointermove Kacheln neu gebaut werden.
      if (q?.einebnen && ziehStart && (ziehStart.x !== q.x || ziehStart.z !== q.z)) {
        sockelLiveWeg({ x: ziehStart.x, z: ziehStart.z, einebnen: q.einebnen });
        sockelLiveDazu(q.x, q.z, q.einebnen);
        zeige(q, ziehIndex);
        ringZu(q.x, q.z);
        ent.flush();
      }
      if (q) hud.meldung(`${q.prefab} abgesetzt @ (${q.x}, ${q.z})`);
      ziehStart = null;
      ziehIndex = -1;
      panel.aktualisiere();
    });
  }
}
