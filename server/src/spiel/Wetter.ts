/**
 * Wetter.ts (F9) — der Server entscheidet das Wetter, je Spieler und je Biom.
 *
 * Bis F9 war das Wetter eine reine Clientfunktion der Weltzeit: Jeder Client
 * würfelte selbst, der Server kannte es nicht und erreichte keinen
 * verbundenen Spieler. Jetzt zieht der Server aus den Biom-Definitionen
 * (`shared/data/wetter/biome.json`, gewürfelt von `WetterWuerfel`) und schickt
 * jedem Spieler der Oberwelt das Wetter SEINES Bioms als Paket
 * `WetterZustand`.
 *
 * Ein einziger Weg für alle Anlässe: `takt()` läuft im Sekundentakt des
 * Servers, rechnet je Spieler `(Umgebung, Fenster)` aus und sendet, wenn sich
 * das gegenüber dem zuletzt gesendeten Stand geändert hat. Damit sind
 * Fensterwechsel, Biomwechsel des Spielers, Admin-Override und neu geladene
 * Definitionen derselbe Fall, und der Wechsel kommt in höchstens einer
 * Sekunde an. Beim Anmelden ruft der Server `sendeAn()` einmal direkt.
 *
 * Rangfolge der Quelle (oben gewinnt): Admin-Override des Bioms, globaler
 * Admin-Override, feste Umgebung aus `server.yml` (`wetter: umgebung:`),
 * Würfel. Die Nebeldichte und der `look:`-Block bleiben Sache des Pakets
 * `WeltWetter` beim Anmelden und werden hier nicht berührt.
 *
 * Keine Spieler ohne Oberwelt: Editor-Verbindungen (`nurEditor`), Spieler im
 * Dungeon (`dungeonId`, Koordinatenband oder eigene Welt) bekommen nichts;
 * ihr Licht ist die Innenraum-Umgebung.
 */
import {
  Biome,
  PacketType,
  WETTER_AUTOMATISCH,
  WetterWuerfel,
  isInDungeonBand,
  resolveBiomeBit,
  type Vector3,
  type WetterErgebnis,
  type WetterVorgabe,
} from '@wov/shared';
import type { Peer } from '../net/Peer.js';

/** Was das Modul von einem Spieler braucht (ein Peer erfüllt es). */
export interface WetterEmpfaenger {
  position: Vector3;
  worldId: string;
  dungeonId: string | null;
  nurEditor: boolean;
  authenticated: boolean;
  sendPacketWith: Peer['sendPacketWith'];
}

/** Biom unter dem Spieler; `null` = kein Oberwelt-Biom (z. B. andere Welt). */
export type BiomVon = (peer: WetterEmpfaenger) => Biome | null;

const GLOBAL = '*';

export class WetterDienst {
  private readonly wuerfel: WetterWuerfel;
  /** Admin-Overrides: Schlüssel = Biomname oder `*`; Wert = Zustands-Id. */
  private readonly overrides = new Map<string, string>();
  /** Zuletzt gesendeter Stand je Spieler (`umgebung|fenster`). */
  private readonly gesendet = new WeakMap<object, string>();

  constructor(
    wuerfel: WetterWuerfel,
    private readonly vorgabe: WetterVorgabe,
    private readonly biomVon: BiomVon,
    private readonly hauptweltId: string,
  ) {
    this.wuerfel = wuerfel;
  }

  /** Das Wetter, das dieser Spieler jetzt hat — `null`, wenn er keins bekommt (Editor, Dungeon, andere Welt). */
  wetterFuer(peer: WetterEmpfaenger, worldTime: number): WetterErgebnis | null {
    if (peer.nurEditor || !peer.authenticated) return null;
    if (peer.dungeonId || peer.worldId !== this.hauptweltId || isInDungeonBand(peer.position.x)) return null;
    const biom = this.biomVon(peer);
    if (biom === null) return null;
    const gewuerfelt = this.wuerfel.wetterFuer(biom, worldTime);
    // Mischzonen (Bitmaske) wie der Würfel auf EIN Biom auflösen, sonst fände der Biom-Override sie nicht.
    const name = Biome[resolveBiomeBit(biom) ?? biom];
    const gewaehlt =
      this.overrides.get(name) ??
      this.overrides.get(GLOBAL) ??
      (this.vorgabe.umgebung !== WETTER_AUTOMATISCH ? this.vorgabe.umgebung : null);
    if (gewaehlt === null || gewaehlt === undefined) return gewuerfelt;
    const info = this.wuerfel.info(gewaehlt);
    // Die feste Vorgabe aus server.yml kann eine Umgebung ohne Zustandseintrag nennen.
    return {
      zustand: info?.id ?? gewaehlt,
      umgebung: info?.umgebung ?? gewaehlt,
      fenster: gewuerfelt.fenster,
    };
  }

  /** Sendet dem Spieler sein Wetter, wenn es sich gegenüber dem letzten Versand geändert hat (`erzwingen`: immer). */
  sendeAn(peer: WetterEmpfaenger, worldTime: number, erzwingen = false): boolean {
    const e = this.wetterFuer(peer, worldTime);
    if (e === null) {
      this.gesendet.delete(peer);
      return false;
    }
    const stand = `${e.umgebung}|${e.fenster}`;
    if (!erzwingen && this.gesendet.get(peer) === stand) return false;
    this.gesendet.set(peer, stand);
    peer.sendPacketWith(PacketType.WetterZustand, (w) => {
      w.writeString(e.umgebung);
      w.writeString(e.zustand);
      w.writeInt32(e.fenster);
    });
    return true;
  }

  /** Sekundentakt: gibt an, wie vielen Spielern gesendet wurde. */
  takt(peers: Iterable<WetterEmpfaenger>, worldTime: number): number {
    let n = 0;
    for (const p of peers) if (this.sendeAn(p, worldTime)) n++;
    return n;
  }

  /**
   * Admin-Override. `zustand === null` nimmt ihn zurück. `biom` (Name aus
   * `Biome`) beschränkt ihn auf ein Biom, sonst gilt er überall. Wirkt beim
   * nächsten `takt()`.
   */
  setze(zustand: string | null, biom?: string): void {
    const schluessel = biom ?? GLOBAL;
    if (zustand === null) this.overrides.delete(schluessel);
    else this.overrides.set(schluessel, zustand);
  }

  /** Alle gesetzten Overrides, für die Statusausgabe. */
  aktiveOverrides(): [string, string][] {
    return [...this.overrides.entries()];
  }

  zustandsIds(): string[] {
    return this.wuerfel.zustandsIds();
  }
}

/** Findet eine Zustands-Id unabhängig von Groß-/Kleinschreibung; `_` steht für ein Leerzeichen (Befehlszeilen werden an Leerzeichen geteilt). */
function findeZustand(dienst: WetterDienst, eingabe: string): string | undefined {
  const norm = (s: string): string => s.toLowerCase().replace(/[ _]/g, '_');
  return dienst.zustandsIds().find((id) => norm(id) === norm(eingabe));
}

function findeBiom(eingabe: string): string | undefined {
  return Object.keys(Biome).find(
    (k) => Number.isNaN(Number(k)) && k !== 'None' && k.toLowerCase() === eingabe.toLowerCase(),
  );
}

/** Admin-Befehl `wetter <Zustand|auto> [biom]` — `args` ohne den Befehlsnamen. */
export function fuehreWetterBefehlAus(
  dienst: WetterDienst,
  args: string[],
): { ok: boolean; active: boolean; message: string } {
  const hilfe = `Aufruf: wetter <Zustand|auto> [Biom] — Zustände: ${dienst
    .zustandsIds()
    .map((i) => i.replace(/ /g, '_'))
    .join(', ')}`;
  const wunsch = args[0];
  if (!wunsch) {
    const aktiv = dienst.aktiveOverrides().map(([b, z]) => `${b === GLOBAL ? 'überall' : b}: ${z}`);
    return {
      ok: true,
      active: false,
      message: `${aktiv.length > 0 ? `Gesetzt: ${aktiv.join(', ')}` : 'Kein Wetter gesetzt (Server würfelt)'}. ${hilfe}`,
    };
  }
  let biom: string | undefined;
  if (args[1] !== undefined) {
    biom = findeBiom(args[1]);
    if (!biom) return { ok: false, active: false, message: `Unbekanntes Biom: "${args[1]}"` };
  }
  if (wunsch.toLowerCase() === 'auto') {
    dienst.setze(null, biom);
    return {
      ok: true,
      active: false,
      message: `Wetter ${biom ?? 'überall'}: automatisch (Server würfelt)`,
    };
  }
  const zustand = findeZustand(dienst, wunsch);
  if (!zustand) return { ok: false, active: false, message: `Unbekannter Zustand: "${wunsch}". ${hilfe}` };
  dienst.setze(zustand, biom);
  return { ok: true, active: false, message: `Wetter ${biom ?? 'überall'}: ${zustand}` };
}

/**
 * Obergrenze der geladenen Weltzeit: 1e10 s (317 Jahre, Fenster 1,5e7 — weit unter der Int32-Grenze des Pakets
 * `WetterZustand` bei 1,4e12 s). Mehr erreicht kein echter Spielstand: Die Weltzeit läuft mit Faktor 1.
 */
export const WELTZEIT_MAX = 1e10;

/** Längste Wertanzeige im Warntext; der Rest wird mit „… (N Zeichen)“ abgeschnitten. */
const ZEIGE_MAX = 150;

/**
 * Wert für den Warntext, wirft nie: Zahlen wie sie sind (auch NaN, ±Infinity), sonst als JSON ("270" ≠ 270,
 * Objekte lesbar). Scheitert JSON (zu tief verschachtelt, BigInt, Zyklus), gilt `String`, scheitert auch das
 * `typeof`. Lange Werte werden gekürzt: Die Datei kann beliebig groß und beschädigt sein.
 */
function zeige(roh: unknown): string {
  let text: string;
  try {
    text = typeof roh === 'number' ? String(roh) : (JSON.stringify(roh) ?? String(roh));
  } catch {
    try {
      text = String(roh);
    } catch {
      text = `<${typeof roh}>`;
    }
  }
  return text.length > ZEIGE_MAX ? `${text.slice(0, ZEIGE_MAX)} … (${text.length} Zeichen)` : text;
}

/**
 * Prüft die `worldTime` aus einer Speicherdatei. Nicht endlich (±Infinity, NaN, null, Text), negativ oder über
 * `WELTZEIT_MAX` gilt `vorgabe`, dazu ein Warntext. Sonst kam ±Infinity bis zum `writeInt32` des Wetterpakets
 * (RangeError im Sekundentakt) und 1e15 füllte die Laufliste des Würfels.
 */
export function pruefeGeladeneWeltzeit(roh: unknown, vorgabe: number): { wert: number; warnung?: string } {
  if (typeof roh === 'number' && Number.isFinite(roh) && roh >= 0 && roh <= WELTZEIT_MAX)
    return { wert: roh };
  return {
    wert: vorgabe,
    warnung: `Gespeicherte Weltzeit ${zeige(roh)} unbrauchbar (erlaubt: 0 bis ${WELTZEIT_MAX}) — es gilt ${vorgabe}`,
  };
}
