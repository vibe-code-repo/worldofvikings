/**
 * ── KI-Zustandsmaschine der Kreaturen ─────────────────────────────────
 *
 * Reine Übergangslogik, keine ZDO, kein Server, keine Uhr, kein eigener
 * Zufall (der Würfel kommt als Funktion herein). Der Server ruft sie je
 * Kreatur und Tick; sie sagt, in welcher Phase die Kreatur steht und was
 * der Körper tun soll. Bewegen, Kollision und Schreiben in die ZDO bleiben
 * beim Aufrufer.
 *
 *   wandern → bemerkt → anrennen → kämpfen → zurückziehen → heimkehren
 *
 *  - wandern:       der Aufrufer wandert (Pause, Wanderziel). Hier wird nur
 *                   gewahrt: Sicht (Kegel), Hören (nur über einen Reiz).
 *  - bemerkt:       steht, dreht sich zum Ziel, wartet `bemerktSec`.
 *  - anrennen:      läuft zum Ziel. Endet durch Leine, Strecke, Zeit, Verlust.
 *  - kämpfen:       steht in Reichweite, schlägt im Takt. Nach
 *                   `rueckzugNach` Schlägen würfelt sie `rueckzugChance`.
 *  - zurückziehen:  läuft einen Takt lang vom Ziel weg, dann wieder anrennen.
 *  - heimkehren:    läuft zum Heimatpunkt, vergisst alle Ziele, dann wandern.
 *
 * Die Aggro-Tabelle führt je Angreifer einen Wert (Schaden) und ein Alter.
 * Jeder Schaden zieht Aggro; ein Eintrag ohne neuen Reiz verfällt nach
 * `verfallSec` (Vorgabe 20 s), danach lässt die Kreatur das Ziel los.
 *
 * Kettenaggro: Wer eine Kreatur reizt, reizt damit auch ihre Nachbarn —
 * aber nur, wenn die rufende Kreatur innerhalb ihrer Leine steht
 * (`kiDarfRufen`; bemerkt sie jemanden jenseits davon, kehrt sie heim und
 * hat kein Ziel mehr). Es ruft nur, wer das Ziel selbst wahrgenommen hat
 * oder getroffen wurde: Ein gerufener Nachbar ruft nicht weiter (`kiRuf`).
 *
 * Wer an Leine, Strecke oder Zeit aufgibt, merkt sich das Ziel als
 * `aufgegeben` und bemerkt es nicht noch einmal, solange es außerhalb
 * seines Reviers (Leine) steht und in der Nähe bleibt. Sonst liefe ein
 * Spieler, der still an der Leine steht, den Wolf im Kreis.
 */

import type { NpcKampf } from './npc.js';
import { SERVER_MELDUNG_SCHLUESSEL_PRAEFIX } from './todTreffer.js';

/**
 * Ein Schlag auf eine heimkehrende (unverwundbare) Kreatur: Der Server antwortet mit
 * diesem Schlüssel (Katalog `kampf.unverwundbar`, de/en) statt mit Schaden oder Ernte.
 */
export const SERVER_MELDUNG_UNVERWUNDBAR = `${SERVER_MELDUNG_SCHLUESSEL_PRAEFIX}kampf.unverwundbar`;

export type KiPhase =
  | 'wandern'
  | 'bemerkt'
  | 'anrennen'
  | 'kaempfen'
  | 'zurueckziehen'
  | 'heimkehren';

/** Nach so vielen Sekunden ohne neuen Reiz lässt die Kreatur ein Ziel los. */
export const AGGRO_VERFALL_SEC = 20;

/** Ankunftsradius am Heimatpunkt: näher als das ist sie zu Hause. */
export const HEIM_ANKUNFT_M = 0.5;

/**
 * Kommt eine heimkehrende Kreatur so lange nicht näher an den Heimatpunkt,
 * setzt sie ihn auf ihre Position und wandert dort weiter (Ausweg aus Fels,
 * Wand oder einem Anker im Fels).
 *
 * 5 s: Die Heimkehr geht im Gehtempo des Wolfs (1,0 m/s), in 5 s also 5 m. Wer um ein Hindernis
 * herum läuft, kommt in dieser Zeit mehr als `HEIM_FORTSCHRITT_M` (0,25 m) näher; wer in 5 s nicht
 * einmal 0,25 m schafft, steckt fest. Kürzer (etwa 2 s) schnitte schon einen normalen Bogen um einen
 * Felsen ab, deutlich länger hielte einen Festsitzer unnötig lange unverwundbar und stumm. Der Test
 * [13] (Wand) und [23] (Schleicher) halten den Wert fest.
 */
export const HEIMKEHR_FESTSITZEN_SEC = 5;

/**
 * Bis zu diesem Tempo des Ziels (m/s, geglättet) läuft die Kreatur außen herum; schneller
 * ist das Ziel auf der Flucht und wird direkt verfolgt. Der Bogen (Tangente plus 30 % nach
 * innen) ist bis etwa 1,5-mal so lang wie der gerade Weg; der Wolf läuft 4,9 m/s und holt damit
 * ein Ziel bis rund 3 m/s ein. 1,5 m/s (ein Schlendern, ein Drehen auf der Stelle, ein
 * Stehenbleiben) ist die Hälfte davon als Reserve und liegt klar unter dem Gehtempo (4,5 m/s):
 * Wer geht oder läuft, wird nicht umlaufen. Sonst liefe jeder Wolf einem Weglaufenden im Bogen
 * hinterher, gäbe nach der Verfolgungsstrecke auf und heilte voll.
 */
export const UMLAUF_ZIELTEMPO_MAX_MPS = 1.5;

/**
 * Glättung des Ziel-Tempos in Sekunden (Zeitkonstante): Die Positionen der Spieler kommen im
 * Takt der Eingabepakete, ein einzelner Tick ohne Bewegung darf das Ziel nicht „stehen“ lassen.
 * 0,4 s sind rund acht Ticks zu 0,05 s.
 */
const ZIELTEMPO_GLAETTUNG_SEC = 0.4;

/**
 * Fortschritt, der die Uhr zurücksetzt: 0,25 m in 5 s = 0,05 m/s. Wer
 * langsamer kommt, sitzt fest (Zittern an einer Wand gilt nicht als Weg).
 */
export const HEIM_FORTSCHRITT_M = 0.25;

/** Die Werte einer Art. Alle Längen in Metern, alle Zeiten in Sekunden. */
export interface KiSteckbrief {
  /** Sichtweite im Kegel. */
  readonly sicht: number;
  /** Im Kampf hält sie ein Ziel bis zu diesem Abstand, ohne Kegel. */
  readonly haltSicht: number;
  /** Öffnungswinkel des Sichtkegels in Grad (360 = Rundumsicht). */
  readonly sichtWinkelGrad: number;
  /** Hörradius für Lärm-Reize (`kiLaerm`). */
  readonly hoeren: number;
  /** Höchstabstand vom Heimatpunkt, solange sie einem Ziel folgt. */
  readonly leine: number;
  /** Höchststrecke einer Verfolgung (Summe der gelaufenen Wege). */
  readonly verfolgungM: number;
  /** Höchstdauer einer Verfolgung in `anrennen`. */
  readonly verfolgungSec: number;
  /** Pause zwischen zwei Schlägen. */
  readonly taktSec: number;
  /** Ab diesem Abstand zum Ziel beginnt sie zu schlagen. */
  readonly angriffReichweite: number;
  /** Ab diesem Abstand geht `bemerkt` in `anrennen` über (Gereizte sofort). */
  readonly anrennenAb: number;
  /** Wartezeit in `bemerkt`, bevor sie losrennt. */
  readonly bemerktSec: number;
  /** Nach so vielen Schlägen wird der Rückzug gewürfelt (0 = nie). */
  readonly rueckzugNach: number;
  /** Wahrscheinlichkeit des Rückzugs je Wurf, 0..1. */
  readonly rueckzugChance: number;
  /**
   * Anteil der Schläge des Spielers, die sie blockt, 0..1.
   * NOCH OHNE WIRKUNG: Der Kampfkern (`handleAttack`) kennt keinen Block
   * einer Kreatur; der Wert steht nur im Steckbrief.
   */
  readonly blockChance: number;
  /** Bei Rückenansicht des Ziels außen herum statt von hinten. */
  readonly umlaufen: boolean;
  /** Sekunden, nach denen ein Aggro-Eintrag ohne Reiz verfällt. */
  readonly verfallSec: number;
  /** Kollisionsradius des Körpers. */
  readonly koerperRadius: number;
}

export interface KiEintrag {
  /** Summe des Schadens, den dieser Angreifer zugefügt hat. */
  wert: number;
  /** Sekunden seit dem letzten Reiz. */
  alter: number;
  /**
   * Der Eintrag stammt von einem Ruf (`kiRuf`), die Kreatur hat das Ziel
   * nicht selbst wahrgenommen: Sie ruft ihrerseits niemanden.
   */
  gerufen?: boolean;
}

export interface KiZustand {
  phase: KiPhase;
  phaseSec: number;
  /** Sekunden im Anrennen seit Beginn der Verfolgung. */
  verfolgtSec: number;
  /** Bisher gelaufene Verfolgungsstrecke. */
  strecke: number;
  /** Schläge seit dem letzten Rückzugswurf. */
  schlaege: number;
  /** Laufender Takt (s seit dem letzten Schlag). */
  takt: number;
  /** Aktuelles Ziel (Schlüssel in der Tabelle). */
  ziel: string | null;
  /** Dauer des laufenden Rückzugs. */
  rueckzugSec: number;
  /** Kürzester Abstand zum Heimatpunkt seit Beginn der Heimkehr. */
  heimBest: number;
  /** Sekunden seit dem letzten Fortschritt der Heimkehr. */
  heimStillSec: number;
  /** Ziele, an denen sie aufgegeben hat (Leine, Strecke, Zeit): nicht gleich wieder bemerken. */
  readonly aufgegeben: Set<string>;
  /** Letzte Position und geglättetes Tempo (m/s) der Ziele: Ein fliehendes Ziel wird nicht umlaufen. */
  readonly zielBewegung: Map<string, { x: number; z: number; tempo: number }>;
  readonly tabelle: Map<string, KiEintrag>;
}

export function neuerKiZustand(): KiZustand {
  return {
    phase: 'wandern',
    phaseSec: 0,
    verfolgtSec: 0,
    strecke: 0,
    schlaege: 0,
    takt: 0,
    ziel: null,
    rueckzugSec: 0,
    heimBest: Infinity,
    heimStillSec: 0,
    aufgegeben: new Set(),
    zielBewegung: new Map(),
    tabelle: new Map(),
  };
}

/** Ein möglicher Gegner. `blick` ist die Blickrichtung (Gierwinkel), falls bekannt. */
export interface KiZiel {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly blick?: number | null;
}

/** Was die Kreatur von der Welt weiß — pro Aufruf frisch vom Aufrufer. */
export interface KiWelt {
  readonly x: number;
  readonly z: number;
  /** Blickrichtung der Kreatur (Gierwinkel, forward = (sin yaw, cos yaw)). */
  readonly yaw: number;
  readonly homeX: number;
  readonly homeZ: number;
  readonly ziele: readonly KiZiel[];
  /** Weg, den sie im letzten Schritt wirklich gelaufen ist (für die Strecke). */
  readonly zuletztGelaufen?: number;
  /** false = im Nahkampf ohne freien Schlagplatz: kein laufender Takt. */
  readonly darfSchlagen?: boolean;
}

export type KiBewegung = 'frei' | 'steht' | 'laeuft';

export interface KiBefehl {
  readonly phase: KiPhase;
  /** frei: der Aufrufer wandert selbst. steht: bleibt stehen. laeuft: bewegt sich. */
  readonly bewegung: KiBewegung;
  /** Gewünschte Laufrichtung (Einheitsvektor) oder 0/0. */
  readonly dirX: number;
  readonly dirZ: number;
  /** Längster sinnvoller Schritt (verhindert das Überlaufen des Ziels). */
  readonly maxWeg: number;
  /** Richtung, in die sie blicken soll (0/0 = unverändert). */
  readonly blickX: number;
  readonly blickZ: number;
  /** Ein Schlag ist fällig. */
  readonly schlag: boolean;
  /** Schlüssel des Ziels, oder null. */
  readonly ziel: string | null;
  readonly abstand: number;
  /**
   * Sie wurde in diesem Schritt neu aufmerksam (Anlass für den Ruf an Nachbarn).
   * Steht sie jenseits ihrer Leine, ist sie im selben Schritt schon nach
   * `heimkehren` gewechselt und `ziel` ist null: Es gibt nichts zu rufen.
   */
  readonly neuBemerkt: boolean;
  /** In diesem Schritt wurde der Rückzug gewürfelt: Ergebnis, sonst null. */
  readonly rueckzugWurf: boolean | null;
  /**
   * Die Heimkehr kam nicht voran (`HEIMKEHR_FESTSITZEN_SEC`): Der Aufrufer
   * setzt den Heimatpunkt auf die jetzige Position; die Phase ist `wandern`.
   */
  readonly ankerNeu: boolean;
}

/** Sieht ein Wesen an (x,z) mit Blick `yaw` ein Ziel an (zx,zz)? */
export function sieht(s: KiSteckbrief, x: number, z: number, yaw: number, zx: number, zz: number): boolean {
  const dx = zx - x;
  const dz = zz - z;
  const abstand = Math.sqrt(dx * dx + dz * dz);
  if (abstand > s.sicht) return false;
  if (s.sichtWinkelGrad >= 360 || abstand === 0) return true;
  // Winkel zwischen Blickrichtung (sin yaw, cos yaw) und Richtung zum Ziel.
  const cos = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / abstand;
  const halb = (s.sichtWinkelGrad / 2) * (Math.PI / 180);
  return cos >= Math.cos(halb);
}

/** Hört ein Wesen an (x,z) einen Lärm an (lx,lz)? */
export function hoert(s: KiSteckbrief, x: number, z: number, lx: number, lz: number): boolean {
  const dx = lx - x;
  const dz = lz - z;
  return dx * dx + dz * dz <= s.hoeren * s.hoeren;
}

/**
 * Schaden (oder ein anderer Reiz mit Wert) von einem Angreifer. Die Kreatur
 * hat ihn selbst erlebt (gesehen, gehört, getroffen): Schaden hebt auch ein
 * früheres Aufgeben auf.
 */
export function kiReiz(z: KiZustand, key: string, wert: number): void {
  const e = z.tabelle.get(key);
  if (e) {
    e.wert += wert;
    e.alter = 0;
    e.gerufen = false;
  } else {
    z.tabelle.set(key, { wert, alter: 0 });
  }
  if (wert > 0) z.aufgegeben.delete(key);
}

/**
 * Ein Nachbar hat den Verursacher wahrgenommen und ruft: Der Eintrag trägt
 * keinen Wert und gilt nicht als eigene Wahrnehmung, damit der Ruf nicht
 * von Nachbar zu Nachbar weiterläuft. Ein vorhandener Eintrag bleibt, wie er
 * ist, und wird nur aufgefrischt.
 */
export function kiRuf(z: KiZustand, key: string): void {
  const e = z.tabelle.get(key);
  if (e) e.alter = 0;
  else z.tabelle.set(key, { wert: 0, alter: 0, gerufen: true });
}

/** Ein Lärm, den die Kreatur gehört hat: der Verursacher ist bekannt, ohne Wert. */
export function kiLaerm(z: KiZustand, key: string): void {
  kiReiz(z, key, 0);
}

/** Darf diese Kreatur ihre Nachbarn rufen? Nur innerhalb ihrer Leine. */
export function kiDarfRufen(s: KiSteckbrief, x: number, z: number, homeX: number, homeZ: number): boolean {
  const dx = x - homeX;
  const dz = z - homeZ;
  return dx * dx + dz * dz <= s.leine * s.leine;
}

/**
 * Ziel verloren oder Verfolgung abgebrochen: Kreaturen mit Leine gehen nach
 * Hause; Figuren ohne Leine (NPC) haben keinen Heimatpunkt und wandern sofort.
 */
function verliere(z: KiZustand, s: KiSteckbrief): void {
  if (Number.isFinite(s.leine)) {
    gibAuf(z);
    wechsle(z, 'heimkehren');
  } else {
    // Wer aufgibt, vergisst das Ziel; sonst finge er im nächsten Schritt von vorn an.
    z.tabelle.clear();
    wechsle(z, 'wandern');
  }
}

/** Das laufende Ziel als aufgegeben merken (vor dem Wechsel nach `heimkehren`). */
function gibAuf(z: KiZustand): void {
  if (z.ziel !== null) z.aufgegeben.add(z.ziel);
}

function wechsle(z: KiZustand, phase: KiPhase): void {
  const alt = z.phase;
  z.phase = phase;
  z.phaseSec = 0;
  // Das Verfolgungsbudget beginnt neu, wenn die Verfolgung neu beginnt (aus `bemerkt`) oder nach einem
  // Rückzug (der Kampf geht weiter). Nicht bei `kaempfen → anrennen`: Wer eben ausser Reichweite tritt
  // und wieder heran lässt, hielte den Wolf sonst unbegrenzt hin.
  if (phase === 'anrennen' && (alt === 'bemerkt' || alt === 'zurueckziehen')) {
    z.verfolgtSec = 0;
    z.strecke = 0;
  }
  if (phase === 'kaempfen') z.takt = 0;
  if (phase === 'zurueckziehen') z.rueckzugSec = 0;
  if (phase === 'heimkehren') {
    z.tabelle.clear();
    z.ziel = null;
    z.heimBest = Infinity;
    z.heimStillSec = 0;
  }
  if (phase === 'wandern') {
    z.ziel = null;
    z.schlaege = 0;
  }
}

/** Das wichtigste bekannte Ziel: höchster Wert, bei Gleichstand das nächste. */
function waehleZiel(z: KiZustand, w: KiWelt): { ziel: KiZiel; wert: number; abstand: number; gerufen: boolean } | null {
  let best: { ziel: KiZiel; wert: number; abstand: number; gerufen: boolean } | null = null;
  for (const ziel of w.ziele) {
    const e = z.tabelle.get(ziel.key);
    if (!e) continue;
    const dx = ziel.x - w.x;
    const dz = ziel.z - w.z;
    const abstand = Math.sqrt(dx * dx + dz * dz);
    if (!best || e.wert > best.wert || (e.wert === best.wert && abstand < best.abstand)) {
      best = { ziel, wert: e.wert, abstand, gerufen: e.gerufen === true };
    }
  }
  return best;
}

/** Richtung (Einheitsvektor) von (x,z) nach (tx,tz); 0/0 bei Abstand 0. */
function richtung(x: number, z: number, tx: number, tz: number): { x: number; z: number; d: number } {
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.sqrt(dx * dx + dz * dz);
  return d === 0 ? { x: 0, z: 0, d: 0 } : { x: dx / d, z: dz / d, d };
}

/**
 * Außen herum: Steht die Kreatur hinter dem Ziel (es kehrt ihr den Rücken),
 * läuft sie im Bogen zur Vorderseite, statt von hinten zu kommen. Nur im
 * Nahfeld (halbe Leine) und nur, wenn die Blickrichtung des Ziels bekannt ist.
 */
function umlaufRichtung(
  s: KiSteckbrief,
  w: KiWelt,
  ziel: KiZiel,
  abstand: number,
  zielTempo: number
): { x: number; z: number } | null {
  if (!s.umlaufen || ziel.blick == null || !Number.isFinite(s.leine)) return null;
  // Nahfeld: höchstens die halbe Leine. Weiter weg lohnt der Bogen nicht, und innerhalb der Leine
  // bleibt er so immer kürzer als der Weg heim.
  if (abstand <= s.angriffReichweite || abstand > s.leine / 2) return null;
  if (zielTempo > UMLAUF_ZIELTEMPO_MAX_MPS) return null;
  // Blickrichtung des Ziels: forward = (−sin yaw, −cos yaw) (Konvention der Peers).
  const fx = -Math.sin(ziel.blick);
  const fz = -Math.cos(ziel.blick);
  const rx = (w.x - ziel.x) / abstand;
  const rz = (w.z - ziel.z) / abstand;
  // dot < 0: die Kreatur steht in der hinteren Hälfte des Ziels.
  if (fx * rx + fz * rz >= 0) return null;
  // Tangente; Vorzeichen so, dass sie zur Vorderseite läuft.
  let tx = -rz;
  let tz = rx;
  if (tx * fx + tz * fz < 0) {
    tx = -tx;
    tz = -tz;
  }
  // Ein Anteil nach innen, damit der Bogen sich dem Ziel nähert. 0,3 ist ein gewählter, nicht
  // gemessener Wert (Entwurf D4): Ohne Anteil liefe die Kreatur auf einem Kreis um das Ziel und
  // käme ihm nie näher; je größer der Anteil, desto geradliniger der Weg und desto weniger „außen
  // herum“. Mit 0,3 weicht der Weg sichtbar seitlich aus (Test [11]: Seitenlage bis 3,9 m aus 8 m)
  // und schließt trotzdem in wenigen Metern. Wer ihn ändert, ändert das Aussehen des Anlaufs.
  const ix = -rx;
  const iz = -rz;
  const bx = tx + 0.3 * ix;
  const bz = tz + 0.3 * iz;
  const l = Math.sqrt(bx * bx + bz * bz);
  return { x: bx / l, z: bz / l };
}

/**
 * Rundungsspielraum an der Schlaggrenze: Der Schritt wird auf genau
 * `abstand − angriffReichweite` gekappt und landet sonst um ein Bit davor.
 */
const REICHWEITE_TOLERANZ = 1e-6;

/**
 * Ein Schritt der Zustandsmaschine.
 *
 * Übergänge dürfen sich im selben Aufruf verketten (wandern → bemerkt →
 * anrennen), damit eine Kreatur ohne Reaktionszeit nicht einen Tick verliert.
 */
export function kiSchritt(
  z: KiZustand,
  s: KiSteckbrief,
  w: KiWelt,
  dt: number,
  wuerfel: () => number
): KiBefehl {
  // ── Alter, Verfall, Wahrnehmung ───────────────────────────────────
  for (const e of z.tabelle.values()) e.alter += dt;
  z.phaseSec += dt;

  // Tempo der Ziele (geglättet), für die Entscheidung „umlaufen oder direkt“.
  for (const ziel of w.ziele) {
    const vor = z.zielBewegung.get(ziel.key);
    if (!vor) {
      z.zielBewegung.set(ziel.key, { x: ziel.x, z: ziel.z, tempo: 0 });
    } else if (dt > 0) {
      const roh = Math.sqrt((ziel.x - vor.x) ** 2 + (ziel.z - vor.z) ** 2) / dt;
      vor.tempo += (roh - vor.tempo) * (1 - Math.exp(-dt / ZIELTEMPO_GLAETTUNG_SEC));
      vor.x = ziel.x;
      vor.z = ziel.z;
    }
  }
  for (const key of z.zielBewegung.keys()) {
    if (!w.ziele.some((q) => q.key === key)) z.zielBewegung.delete(key);
  }

  const amLeben = new Set<string>();
  for (const ziel of w.ziele) amLeben.add(ziel.key);
  const engagiert = z.phase !== 'wandern' && z.phase !== 'heimkehren';
  for (const ziel of w.ziele) {
    // Wahrnehmen erneuert einen Eintrag; im Kampf genügt die Sichtweite
    // ohne Kegel, denn die Kreatur dreht sich zum Ziel, statt es zu verlieren.
    const gesehen = engagiert
      ? (ziel.x - w.x) ** 2 + (ziel.z - w.z) ** 2 <= s.haltSicht * s.haltSicht
      : z.phase === 'wandern' && !z.aufgegeben.has(ziel.key) && sieht(s, w.x, w.z, w.yaw, ziel.x, ziel.z);
    if (gesehen) kiReiz(z, ziel.key, 0);
  }
  // Aufgegebene Ziele: vergessen, wenn es sie nicht mehr gibt, sie im Revier
  // (Leine) stehen oder weit vom Revier weg sind (Leine + Sicht).
  for (const key of z.aufgegeben) {
    const ziel = w.ziele.find((q) => q.key === key);
    const dHeim = ziel ? Math.sqrt((ziel.x - w.homeX) ** 2 + (ziel.z - w.homeZ) ** 2) : Infinity;
    if (!ziel || dHeim <= s.leine || dHeim > s.leine + s.sicht) z.aufgegeben.delete(key);
  }
  // Verfall und Ziele, die es nicht mehr gibt (tot, abgemeldet).
  for (const [key, e] of z.tabelle) {
    if (e.alter > s.verfallSec || !amLeben.has(key)) z.tabelle.delete(key);
  }

  const heimD = Math.sqrt((w.x - w.homeX) ** 2 + (w.z - w.homeZ) ** 2);
  let neuBemerkt = false;
  let rueckzugWurf: boolean | null = null;
  let ankerNeu = false;
  let schlag = false;

  const befehl = (
    bewegung: KiBewegung,
    dirX: number,
    dirZ: number,
    maxWeg: number,
    blickX: number,
    blickZ: number,
    abstand: number
  ): KiBefehl => ({
    phase: z.phase,
    bewegung,
    dirX,
    dirZ,
    maxWeg,
    blickX,
    blickZ,
    schlag,
    ziel: z.ziel,
    abstand,
    neuBemerkt,
    rueckzugWurf,
    ankerNeu,
  });

  // Mehrere Übergänge hintereinander sind erlaubt, aber nie endlos.
  for (let runde = 0; runde < 4; runde += 1) {
    const phase = z.phase;

    // Leine: jenseits davon gibt es nur noch den Weg nach Hause.
    if (
      (phase === 'bemerkt' || phase === 'anrennen' || phase === 'kaempfen' || phase === 'zurueckziehen') &&
      heimD > s.leine
    ) {
      gibAuf(z);
      wechsle(z, 'heimkehren');
      continue;
    }

    if (phase === 'wandern') {
      const t = waehleZiel(z, w);
      if (!t) return befehl('frei', 0, 0, Infinity, 0, 0, Infinity);
      z.ziel = t.ziel.key;
      // Jenseits der Leine folgt gleich der Übergang nach `heimkehren` (oben in
      // der Schleife); `ziel` ist dann null, der Ruf an die Nachbarn entfällt.
      // Ein gerufener Nachbar hat nichts selbst wahrgenommen und ruft nicht weiter.
      neuBemerkt = !t.gerufen;
      wechsle(z, 'bemerkt');
      continue;
    }

    if (phase === 'bemerkt') {
      const t = waehleZiel(z, w);
      if (!t) {
        wechsle(z, 'wandern');
        continue;
      }
      z.ziel = t.ziel.key;
      const r = richtung(w.x, w.z, t.ziel.x, t.ziel.z);
      const gereizt = t.wert > 0;
      if (z.phaseSec >= s.bemerktSec && (gereizt || r.d <= s.anrennenAb)) {
        wechsle(z, 'anrennen');
        continue;
      }
      return befehl('steht', 0, 0, 0, r.x, r.z, r.d);
    }

    if (phase === 'anrennen') {
      const t = waehleZiel(z, w);
      if (!t) {
        verliere(z, s);
        continue;
      }
      z.ziel = t.ziel.key;
      z.verfolgtSec += dt;
      z.strecke += w.zuletztGelaufen ?? 0;
      if (z.verfolgtSec > s.verfolgungSec || z.strecke > s.verfolgungM) {
        verliere(z, s);
        continue;
      }
      const r = richtung(w.x, w.z, t.ziel.x, t.ziel.z);
      if (r.d <= s.angriffReichweite + REICHWEITE_TOLERANZ) {
        wechsle(z, 'kaempfen');
        continue;
      }
      const um = umlaufRichtung(s, w, t.ziel, r.d, z.zielBewegung.get(t.ziel.key)?.tempo ?? 0);
      const dir = um ?? r;
      return befehl('laeuft', dir.x, dir.z, r.d - s.angriffReichweite, r.x, r.z, r.d);
    }

    if (phase === 'kaempfen') {
      const t = waehleZiel(z, w);
      if (!t) {
        verliere(z, s);
        continue;
      }
      z.ziel = t.ziel.key;
      const r = richtung(w.x, w.z, t.ziel.x, t.ziel.z);
      if (r.d > s.angriffReichweite + REICHWEITE_TOLERANZ) {
        wechsle(z, 'anrennen');
        continue;
      }
      if (w.darfSchlagen === false) {
        // Kein freier Schlagplatz: der Takt läuft nicht, sie wartet.
        z.takt = 0;
      } else {
        z.takt += dt;
        if (z.takt >= s.taktSec) {
          // Der Rest über die Taktlänge bleibt stehen (gedeckelt auf einen
          // Takt), damit grobe Prüfschritte den mittleren Takt nicht dehnen.
          z.takt = Math.min(z.takt - s.taktSec, s.taktSec);
          schlag = true;
          z.schlaege += 1;
          if (s.rueckzugNach > 0 && z.schlaege >= s.rueckzugNach) {
            z.schlaege = 0;
            rueckzugWurf = wuerfel() < s.rueckzugChance;
            if (rueckzugWurf) {
              // Der Rückzug beginnt in diesem Schritt; der Schlag gilt noch.
              wechsle(z, 'zurueckziehen');
              continue;
            }
          }
        }
      }
      return befehl('steht', 0, 0, 0, r.x, r.z, r.d);
    }

    if (phase === 'zurueckziehen') {
      const t = waehleZiel(z, w);
      z.rueckzugSec += dt;
      if (!t) {
        verliere(z, s);
        continue;
      }
      z.ziel = t.ziel.key;
      if (z.rueckzugSec >= s.taktSec) {
        wechsle(z, 'anrennen');
        continue;
      }
      const r = richtung(w.x, w.z, t.ziel.x, t.ziel.z);
      return befehl('laeuft', -r.x, -r.z, Infinity, r.x, r.z, r.d);
    }

    // heimkehren
    const r = richtung(w.x, w.z, w.homeX, w.homeZ);
    if (r.d <= HEIM_ANKUNFT_M) {
      z.tabelle.clear();
      wechsle(z, 'wandern');
      return befehl('frei', 0, 0, Infinity, 0, 0, Infinity);
    }
    // Kommt sie nicht näher (Fels, Wand, Anker im Fels), ist hier ihr neues Zuhause.
    if (r.d < z.heimBest - HEIM_FORTSCHRITT_M) {
      z.heimBest = r.d;
      z.heimStillSec = 0;
    } else {
      z.heimStillSec += dt;
    }
    if (z.heimStillSec >= HEIMKEHR_FESTSITZEN_SEC) {
      z.tabelle.clear();
      wechsle(z, 'wandern');
      ankerNeu = true;
      return befehl('frei', 0, 0, Infinity, 0, 0, Infinity);
    }
    // Während des Heimwegs verfallen die Einträge weiter; was neu reizt,
    // wird nach der Ankunft aufgenommen.
    return befehl('laeuft', r.x, r.z, r.d, r.x, r.z, r.d);
  }
  return befehl('steht', 0, 0, 0, 0, 0, Infinity);
}

/**
 * Steckbrief für Figuren mit den Kampfwerten aus `npc.ts` (Bänder
 * „bemerken — nachsetzen — zuschlagen" von `aggroSchritt`): Rundumsicht bis
 * `aggro`, Nachsetzen ab dem halben Aggroradius, Schlag ab `angriff`, keine
 * Leine, kein Rückzug, kein Verfall — wer außer Sicht ist, wird sofort
 * losgelassen. Dieselben Zahlen wie die Vorschau im Editor.
 */
export function npcSteckbrief(kampf: NpcKampf, anrennenAnteil: number): KiSteckbrief {
  return {
    sicht: kampf.aggro,
    haltSicht: kampf.aggro,
    sichtWinkelGrad: 360,
    hoeren: 0,
    leine: Infinity,
    verfolgungM: Infinity,
    verfolgungSec: Infinity,
    taktSec: kampf.takt,
    angriffReichweite: kampf.angriff,
    anrennenAb: Math.max(kampf.aggro * anrennenAnteil, kampf.angriff),
    bemerktSec: 0,
    rueckzugNach: 0,
    rueckzugChance: 0,
    blockChance: 0,
    umlaufen: false,
    verfallSec: 0,
    koerperRadius: 0.4,
  };
}
