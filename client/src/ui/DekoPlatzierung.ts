/**
 * DekoPlatzierung — Gegenstände im Dungeon setzen, mit Geist am Fadenkreuz.
 *
 * ── Bedienung ────────────────────────────────────────────────────────
 *   Zielen           Der Geist schnappt an die Fläche unter dem MAUSZEIGER
 *   R halten + Maus  frei um die Flächennormale drehen
 *   Mausrad          drehen in 15°-Schritten
 *   Shift            Rastung AUS — frei drehen und frei schieben
 *   Strg + Mausrad   Abstand zur Fläche (in die Wand hinein / heraus)
 *   Linksklick       setzen
 *   Rechtsklick      abbrechen · Esc beenden
 *
 * ── Der Geist ist IMMER zu sehen ─────────────────────────────────────
 * Trifft der Zielstrahl nichts, hängt er in fester Entfernung vor der
 * Kamera und leuchtet ROT; dann setzt der Klick auch nicht. Trifft er,
 * schnappt der Geist an die Fläche und leuchtet GRÜN.
 *
 * Das ist die Bedienung, die Valheim vormacht, und der Grund dafür ist
 * kein Geschmack: Ein Geist, der bei jedem Fehlschuss verschwindet, sagt
 * dem Spieler nicht „hier geht es nicht", sondern „das Werkzeug ist
 * kaputt". Genau so ist es hier beim ersten Anlauf auch angekommen.
 *
 * Eingefärbt wird über `renderOverlay`/`overlayColor` und NICHT über das
 * Material: Der Geist kommt aus dem Container-Cache und teilt sein
 * Material mit jedem gesetzten Exemplar desselben Prefabs — wer es
 * einfärbt, färbt alle (dieselbe Falle wie bei der Völva, s.
 * `EntityManager.removeZDO`).
 *
 * Winkel und Abstand bleiben zwischen zwei Platzierungen stehen. Wer eine
 * Reihe Fackeln setzt, will sie gleich — und nicht jede einzeln
 * nachstellen.
 *
 * ── Warum die Maus umgeleitet wird ───────────────────────────────────
 * Solange R gedrückt ist, gehen die Mausbewegungen an das Objekt und NICHT
 * an die Kamera (`InputManager.mausUmlenkung`). Sonst drehte sich beim
 * Ausrichten der Blick mit, das Fadenkreuz wanderte von der Wand, und der
 * Geist spränge unter der Hand weg.
 *
 * ── Warum nicht der PlacementController ──────────────────────────────
 * Der baut Spielerbauten und zielt mit `getGroundHeightRaycast` gegen die
 * HEIGHTMAP. In einer Instanz gibt es kein Gelände — `LeereGeo` antwortet
 * überall 0 —, und ein Wandobjekt will ohnehin an eine Wand. Hier wird
 * gegen die PHYSIK gezielt, also gegen genau die Raum-Kollisionskörper,
 * an denen der Spieler auch entlangläuft.
 *
 * ── Die Drehung kommt aus der Wand ───────────────────────────────────
 * Nicht aus dem Blickwinkel: Wer schräg auf eine Wand schaut, will das
 * Objekt trotzdem gerade daran haben. Der Strahl liefert die
 * Flächennormale, und die IST die Grundausrichtung; die Maus legt einen
 * Zusatzwinkel darauf.
 *
 * Hergeleitet, nicht geraten: `PlayerController` legt fest „increasing yaw
 * sweeps forward from -Z towards -X", die Blickrichtung zu einem Winkel θ
 * ist also (−sin θ, 0, −cos θ). Soll das Objekt entlang der Normale n
 * schauen, folgt θ = atan2(−n.x, −n.z). Probe an der +x-Wand: n = (−1,0,0)
 * ergibt 90° — und 90° ist der Winkel, bei dem die Fackel im Prüfstand
 * flach an der Wand sitzt.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import { strahlTreffer } from '../engine/Physics';

/** Reichweite des Zielstrahls in Metern — eine Gangbreite plus Reserve. */
const REICHWEITE_M = 8;
/** Rastung des Winkels, wenn gerastet wird (Grad). */
const DREH_RASTER = 15;
/** Grad je Pixel Mausbewegung beim freien Drehen. */
const DREH_EMPFINDLICHKEIT = 0.4;
/**
 * Rastung der Stelle IN der getroffenen Fläche (Meter).
 *
 * Nur längs der Fläche, nie in ihrer Normalen: Wer die Höhe eines Treffers
 * an der Decke auf 0,25 rundete, drückte das Objekt ins Mauerwerk — die
 * lichte Höhe des Kits ist 3,60 m und damit selbst kein Vielfaches davon.
 * Längs gerastet wird dagegen alles besser: Eine Reihe Fackeln steht in
 * gleichen Abständen, ohne dass jemand zielt.
 *
 * 0,25 m, weil das Kit darauf gebaut ist — Wandstärke 0,25,
 * Wandinnenseiten auf ±1,75, Bodenplatten auf 0.
 */
const ORT_RASTER_M = 0.25;
/** Schrittweite des Abstands zur Fläche (Meter). */
const ABSTAND_SCHRITT_M = 0.05;
/** Wie weit ein Objekt höchstens vor oder hinter der Fläche sitzen darf. */
const ABSTAND_GRENZE_M = 1.0;
/**
 * Ab welchem waagerechten Anteil die Fläche als WAND gilt.
 *
 * Auf Boden und Decke gibt es keine Wandrichtung, aus der sich eine
 * Drehung ableiten liesse — dort zählt der Blickwinkel des Spielers.
 * 0,3 entspricht rund 17° Neigung: Alles Steilere ist Wand.
 */
const WAND_SCHWELLE = 0.3;
/** Entfernung des Geistes vor der Kamera, wenn der Strahl nichts trifft. */
const FREIE_ENTFERNUNG_M = 3;
const FARBE_GUELTIG = new Color3(0.35, 1.0, 0.45);
const FARBE_UNGUELTIG = new Color3(1.0, 0.3, 0.25);

export interface DekoPlatzierungCallbacks {
  /** Geist laden (auf AssetManager.instantiate verdrahtet). */
  ladeGeist(prefab: string): Promise<TransformNode | null>;
  /**
   * Zielstrahl unter dem Mauszeiger — Ursprung und Richtung.
   *
   * Nicht der Kamerastrahl: Beim Platzieren ist der Zeiger frei, und
   * gezielt wird mit ihm. Ein Fadenkreuz zwingt dazu, den ganzen Kopf zu
   * drehen, um eine Fackel zwei Meter weiter links zu setzen.
   */
  strahl(): { x: number; y: number; z: number; dx: number; dy: number; dz: number } | null;
  /** Gierwinkel des Spielers — Grundausrichtung auf Boden und Decke. */
  spielerYaw(): number;
  /** Gesetzt: Ort und Drehung in Weltkoordinaten der Instanz. */
  gesetzt(prefab: string, pos: { x: number; y: number; z: number }, yaw: number): void;
  /**
   * Mausbewegung umleiten (`InputManager.mausUmlenkung`). Null gibt sie
   * der Kamera zurück.
   */
  mausUmlenken(fn: ((dx: number, dy: number) => void) | null): void;
  /**
   * Mausrad umleiten (`InputManager.radUmlenkung`). Null gibt es der
   * Kamera zurueck.
   *
   * Muss ueber DENSELBEN Weg laufen wie die Kamera und nicht ueber einen
   * eigenen Zuhoerer am Fenster: Zwei Zuhoerer auf demselben Ereignis
   * heissen zwei Wirkungen — die Fackel dreht sich, und der Blick zoomt.
   */
  radUmlenken(fn: ((richtung: number) => void) | null): void;
  /** Kurzmeldung im HUD — für Anfang, Ende und Fehlschläge. */
  meldung(text: string): void;
}

/**
 * Alle Netze unter einem Knoten — den Knoten selbst eingeschlossen.
 *
 * `getChildMeshes()` allein reicht nicht, und das ist keine Feinheit: Ob
 * ein glTF-Import eine Wurzel ÜBER das Netz legt, hängt an der Datei. Die
 * Fremdmodelle bringen eine mit (`__root__` mit Kindnetzen), unsere eigene
 * Fackel nicht — dort ist die zurückgegebene Wurzel das Netz.
 *
 * Gemessen, nicht vermutet: `__vb.deko()` meldete `geistGeladen: true` und
 * `geistTeile: 0`. Der Geist war da, durchsichtig gemacht wurde nichts,
 * eingefärbt wurde nichts, und zu sehen war nichts — drei Symptome, eine
 * Ursache.
 */
function netzeVon(knoten: TransformNode): AbstractMesh[] {
  const netze = knoten.getChildMeshes();
  const selbst = knoten as unknown as AbstractMesh;
  if (typeof selbst.getTotalVertices === 'function' && selbst.getTotalVertices() > 0) {
    netze.push(selbst);
  }
  return netze;
}

export class DekoPlatzierung {
  private prefab: string | null = null;
  /**
   * Halter des Geistes — traegt Ort und Drehung.
   *
   * NICHT der `__root__` der GLB: Der traegt die Haendigkeits-Umrechnung
   * (z-Spiegelung plus 180 Grad), und wer ihm eine Drehung zuweist, wirft
   * sie weg. Der Geist stand dadurch 180 Grad anders als das gesetzte
   * Objekt, dessen Weltmatrix im EntityManager als `local.multiply(zdo)`
   * entsteht — mit unversehrtem `local`.
   *
   * Der Halter ist die Entsprechung zur ZDO-Matrix. Damit rechnet der
   * Geist genau denselben Weg wie das Ergebnis.
   */
  private geist: TransformNode | null = null;
  private geistPrefab: string | null = null;
  /** Zusatzwinkel auf die Wandausrichtung, in Grad. Überlebt das Setzen. */
  private zusatzYaw = 0;
  /** Abstand zur Fläche entlang ihrer Normalen. Überlebt das Setzen. */
  private abstand = 0;
  private dreht = false;
  private rasten = true;
  private ortRasten = true;
  private strg = false;
  /**
   * Fester Versatz auf die Grundausrichtung, in Grad — Messhilfe.
   *
   * Steht auf 0 und soll dort bleiben. Er existiert, um die eine Frage zu
   * beantworten, die sich von aussen nicht entscheiden laesst: Rechnet die
   * Ausrichtung falsch, oder schaut das MODELL anders herum als seine
   * Datei behauptet? Wer `__vb.dekoVersatz(180)` setzt und es sitzt dann
   * richtig, hat die Antwort — und dann gehoert die Zahl ans Prefab und
   * nicht hierher.
   */
  private versatz = 0;
  private letzterOrt: { x: number; y: number; z: number } | null = null;
  /** Sitzt der Geist auf einer Fläche? Nur dann darf gesetzt werden. */
  private gueltig = false;
  private letzterYaw = 0;
  private readonly anzeige: HTMLDivElement;

  constructor(
    private readonly scene: Scene,
    private readonly cb: DekoPlatzierungCallbacks
  ) {
    // Eigene Anzeige statt HUD-Meldungen: Winkel und Abstand ändern sich
    // laufend, und eine Meldung je Änderung wäre ein Wasserfall, in dem
    // die eine wichtige Meldung untergeht.
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:96px', 'transform:translateX(-50%)',
      'z-index:950', 'display:none', 'pointer-events:none',
      'padding:6px 14px', 'border-radius:4px', 'white-space:pre',
      'background:rgba(20,16,12,.72)', 'border:1px solid rgba(190,160,110,.35)',
      'font-family:Georgia,"Times New Roman",serif', 'font-size:13px',
      'color:#e8d9b8', 'text-align:center', 'text-shadow:0 1px 3px #000',
    ].join(';');
    document.body.appendChild(el);
    this.anzeige = el;
  }

  get aktiv(): boolean {
    return this.prefab !== null;
  }

  starte(prefab: string): void {
    this.prefab = prefab;
    // Bei null anfangen. Winkel und Abstand bleiben zwischen zwei
    // PLATZIERUNGEN stehen — eine Reihe Fackeln soll gleich aussehen —,
    // aber nicht zwischen zwei Sitzungen des Modus: Ein Zusatzwinkel von
    // 315 Grad aus dem letzten Versuch verdreht sonst jede Fackel danach,
    // und niemand sucht den Fehler dort. (Genau so passiert, am 27.08.)
    this.zusatzYaw = 0;
    this.abstand = 0;
    this.anzeige.style.display = 'block';
    this.cb.radUmlenken((richtung) => {
      if (this.strg) this.schiebe(-richtung);
      else this.dreheSchritt(richtung);
    });
    this.cb.meldung('Platzieren: Linksklick setzt, R+Maus dreht, Esc beendet');
  }

  beende(): void {
    this.prefab = null;
    this.letzterOrt = null;
    this.dreheEnde();
    this.cb.radUmlenken(null);
    this.anzeige.style.display = 'none';
    // NUR die Instanz abräumen, niemals Material und Texturen: Der Geist
    // stammt aus dem Container-Cache und teilt sein Material mit allem,
    // was dasselbe Prefab benutzt (s. EntityManager.removeZDO).
    // `dispose(false, false)`: Kinder mit, Material NIEMALS. Der Geist
    // stammt aus dem Container-Cache und teilt sein Material mit jedem
    // gesetzten Exemplar (s. EntityManager.removeZDO).
    this.geist?.dispose(false, false);
    this.geist = null;
    this.geistPrefab = null;
  }

  /** R gedrückt: ab jetzt dreht die Maus das Objekt statt der Kamera. */
  dreheBeginn(): void {
    if (!this.aktiv || this.dreht) return;
    this.dreht = true;
    this.cb.mausUmlenken((dx) => {
      this.zusatzYaw += dx * DREH_EMPFINDLICHKEIT;
      this.zusatzYaw = ((this.zusatzYaw % 360) + 360) % 360;
    });
  }

  /** R losgelassen — die Kamera bekommt die Maus zurück. */
  dreheEnde(): void {
    if (!this.dreht) return;
    this.dreht = false;
    this.cb.mausUmlenken(null);
  }

  /** Mausrad ohne Strg: Winkel in Rasterschritten. */
  dreheSchritt(richtung: number): void {
    if (!this.aktiv) return;
    const gerastet = Math.round(this.zusatzYaw / DREH_RASTER) * DREH_RASTER;
    this.zusatzYaw = ((gerastet + richtung * DREH_RASTER) % 360 + 360) % 360;
  }

  /** Messhilfe, s. `versatz`. */
  setzeVersatz(grad: number): number {
    this.versatz = ((grad % 360) + 360) % 360;
    return this.versatz;
  }

  /** Zusatzwinkel und Abstand verwerfen — zurueck auf die Wandrichtung. */
  zuruecksetzen(): void {
    this.zusatzYaw = 0;
    this.abstand = 0;
  }

  /** Mausrad mit Strg: Abstand zur Fläche. */
  schiebe(richtung: number): void {
    if (!this.aktiv) return;
    this.abstand = Math.max(
      -ABSTAND_GRENZE_M,
      Math.min(ABSTAND_GRENZE_M, this.abstand + richtung * ABSTAND_SCHRITT_M)
    );
  }

  /**
   * Shift schaltet die Rastung AUS — Winkel und Stelle werden stufenlos.
   *
   * Herum wie in Valheim: Dort ist Shift die „alternative Platzierung",
   * die alle Rastpunkte ignoriert. Gerastet ist der Normalfall, weil er
   * in neun von zehn Fällen das ist, was man will.
   */
  setzeModifikatoren(shift: boolean, strg: boolean): void {
    this.rasten = !shift;
    this.ortRasten = !shift;
    this.strg = strg;
  }

  /** Linksklick — setzt, wenn der Strahl gerade etwas trifft. */
  setze(): boolean {
    if (!this.aktiv || !this.letzterOrt || !this.gueltig) {
      this.cb.meldung('Kein Halt — auf eine Wand, den Boden oder die Decke zeigen');
      return false;
    }
    this.cb.gesetzt(this.prefab!, { ...this.letzterOrt }, this.letzterYaw);
    return true;
  }

  /** Jeden Frame: zielen, Geist nachführen, Anzeige schreiben. */
  update(): void {
    if (!this.prefab) return;
    void this.geistLaden(this.prefab);

    const b = this.cb.strahl();
    const treffer = b
      ? strahlTreffer(this.scene, b.x, b.y, b.z, b.dx, b.dy, b.dz, REICHWEITE_M)
      : null;

    if (!treffer) {
      // Kein Halt: Der Geist bleibt sichtbar und hängt vor der Kamera,
      // damit man SIEHT, dass das Werkzeug arbeitet und nur die Stelle
      // nicht taugt.
      this.gueltig = false;
      if (b) {
        this.letzterOrt = {
          x: b.x + b.dx * FREIE_ENTFERNUNG_M,
          y: b.y + b.dy * FREIE_ENTFERNUNG_M,
          z: b.z + b.dz * FREIE_ENTFERNUNG_M,
        };
        this.letzterYaw =
          (((this.cb.spielerYaw() * 180) / Math.PI + 180 + this.zusatzYaw) % 360 + 360) % 360;
        this.zeige(this.letzterOrt, this.letzterYaw, false);
      }
      this.anzeige.textContent =
        'kein Halt — auf eine Wand, den Boden oder die Decke zeigen\n' +
        'R+Maus drehen · Rad rastet · Shift frei · Strg+Rad Abstand';
      return;
    }
    this.gueltig = true;

    // Grundausrichtung: an einer Wand aus ihrer Normalen, sonst aus dem
    // Blick des Spielers.
    //
    // ── Das Vorzeichen der Normalen wird NICHT geglaubt ──────────────
    // Ob eine Physik-Engine die Flaechennormale zur Strahlquelle hin oder
    // von ihr weg meldet, ist Auslegungssache der Engine — und wer sich
    // darauf verlaesst, baut alles 180 Grad verkehrt. Genau das ist beim
    // ersten Anlauf passiert: Die Fackel klebte mit dem Ruecken zum Raum.
    //
    // Stattdessen wird das Vorzeichen aus der Geometrie erschlossen: Der
    // Spieler sieht die Flaeche an, das Objekt soll ihn ansehen. Zeigt die
    // waagerechte Normale in dieselbe Richtung wie der Blick, zeigt sie
    // von der Kamera WEG und wird umgedreht. Damit stimmt es in jeder
    // Engine, und niemand muss die Frage je wieder stellen.
    let nx = treffer.nx;
    let nz = treffer.nz;
    if (nx * b!.dx + nz * b!.dz > 0) {
      nx = -nx;
      nz = -nz;
    }
    const waagerecht = Math.hypot(nx, nz);
    const anDerWand = waagerecht > WAND_SCHWELLE;
    // Blickrichtung zu einem Gierwinkel θ ist (−sin θ, 0, −cos θ)
    // (`PlayerController`). Soll das Objekt entlang n schauen, folgt
    // θ = atan2(−n.x, −n.z).
    const grundYaw = anDerWand
      ? (Math.atan2(-nx, -nz) * 180) / Math.PI
      : (this.cb.spielerYaw() * 180) / Math.PI + 180;

    // Längs der Fläche rasten, in Richtung der Normalen nie: Welche Achse
    // die Normale ist, entscheidet ihr grösster Anteil — bei den
    // achsparallelen Wänden dieses Kits ist das eindeutig.
    const ax = Math.abs(treffer.nx);
    const ay = Math.abs(treffer.ny);
    const az = Math.abs(treffer.nz);
    const raste = (v: number, istNormale: boolean): number =>
      istNormale || !this.ortRasten ? v : Math.round(v / ORT_RASTER_M) * ORT_RASTER_M;

    // Der Abstand laeuft entlang der KORRIGIERTEN Normalen — sonst
    // schoebe „vom Spieler weg" das Objekt in die Wand hinein.
    this.letzterOrt = {
      x: raste(treffer.x, ax >= ay && ax >= az) + nx * this.abstand,
      y: raste(treffer.y, ay >= ax && ay >= az) + treffer.ny * this.abstand,
      z: raste(treffer.z, az >= ax && az >= ay) + nz * this.abstand,
    };

    const zusatz = this.rasten
      ? Math.round(this.zusatzYaw / DREH_RASTER) * DREH_RASTER
      : this.zusatzYaw;
    this.letzterYaw = ((grundYaw + zusatz + this.versatz) % 360 + 360) % 360;

    this.zeige(this.letzterOrt, this.letzterYaw, true);

    this.anzeige.textContent =
      `${anDerWand ? 'Wand' : 'Boden/Decke'}  ·  ${this.letzterYaw.toFixed(0)}°` +
      ` = Fläche ${grundYaw.toFixed(0)}° + Zusatz ${zusatz.toFixed(0)}°` +
      `${this.versatz ? ` + Versatz ${this.versatz}°` : ''}` +
      `${this.rasten ? '' : ' (frei)'}` +
      `  ·  Abstand ${this.abstand.toFixed(2)} m\n` +
      'Rad dreht · R+Maus frei · Shift ohne Rastung · Strg+Rad Abstand · F stellt zurück';
  }

  /** Geist an Ort und Stelle zeigen und nach Gültigkeit einfärben. */
  private zeige(
    ort: { x: number; y: number; z: number },
    yaw: number,
    gueltig: boolean
  ): void {
    const geist = this.geist;
    if (!geist) return;
    geist.setEnabled(true);
    geist.position.set(ort.x, ort.y, ort.z);
    geist.rotationQuaternion = null;
    geist.rotation.set(0, (yaw * Math.PI) / 180, 0);
    for (const m of netzeVon(geist)) {
      m.renderOverlay = true;
      m.overlayAlpha = 0.35;
      m.overlayColor = gueltig ? FARBE_GUELTIG : FARBE_UNGUELTIG;
    }
  }

  /** Zustand für die Konsole — `__vb.deko()`. */
  diagnose(): Record<string, unknown> {
    return {
      aktiv: this.aktiv,
      prefab: this.prefab,
      geistGeladen: this.geist !== null,
      geistTeile: this.geist ? netzeVon(this.geist).length : 0,
      geistName: this.geist?.name ?? null,
      geistAn: this.geist?.isEnabled() ?? false,
      gueltig: this.gueltig,
      ort: this.letzterOrt,
      yaw: this.letzterYaw,
      zusatzYaw: this.zusatzYaw,
      abstand: this.abstand,
      dreht: this.dreht,
      rasten: this.rasten,
      versatz: this.versatz,
    };
  }

  private async geistLaden(prefab: string): Promise<void> {
    if (this.geistPrefab === prefab) return;
    this.geistPrefab = prefab;
    this.geist?.dispose(false, false);
    this.geist = null;
    const geladen = await this.cb.ladeGeist(prefab);
    if (!geladen) return;
    // Wettlauf verloren: Modus beendet oder Teil gewechselt, während die
    // GLB lud.
    if (this.geistPrefab !== prefab || !this.prefab) {
      geladen.dispose(false, false);
      return;
    }
    const netze = netzeVon(geladen);
    for (const m of netze) {
      m.visibility = 0.45;
      m.isPickable = false;
    }
    if (netze.length === 0) {
      // Ein Geist ohne Netz ist kein Geist. Lieber laut als unsichtbar.
      console.warn(`[deko] "${prefab}" hat keine sichtbare Geometrie — kein Geist`);
    }
    const halter = new TransformNode('dekoGeist', this.scene);
    geladen.parent = halter;
    this.geist = halter;
  }
}
