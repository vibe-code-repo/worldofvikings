/**
 * Die Wettervorgabe des Servers — EINE Quelle für Client und Server.
 *
 * WAS SIE LÖST: Das Wetter ist bis heute eine reine Funktion der
 * Weltzeit (`shared/weather.ts`): Alle 666 s zieht ein gesetzter
 * Zufallsgenerator aus dem Topf des Bioms. Für Wiesen heisst das zu
 * 86 % `Clear` und zu je 3,4 % `Rain`, `Misty`, `ThunderStorm`,
 * `LightRain`. Das ist stimmig, aber nicht steuerbar: Wer eine bestimmte
 * Stimmung will, kann sie nur abwarten.
 *
 * Der einzige vorhandene Regler war `?fog=` in der Adresszeile — und der
 * ist WIRKUNGSLOS: `Lighting.apply()` schreibt `scene.fogDensity` in
 * jedem Frame neu, der von Hand gesetzte Wert überlebt keinen Frame.
 *
 * ── Warum zwei getrennte Grössen ─────────────────────────────────────
 * `umgebung` und `nebelDichte` sind bewusst nicht dasselbe. Eine
 * Umgebung bringt ihre Nebeldichte pro TAGESZEIT mit, und die Spanne ist
 * gewaltig: `Misty` hat mittags 0,020 und nachts 0,150 — das Achtfache.
 * Wer die Optik eines bestimmten Moments festhalten will, muss deshalb
 * BEIDES festnageln können, sonst bekommt er nachts eine Suppe, die er
 * so nie gesehen hat. Die Nebel-FARBE folgt weiter der Tageszeit; nur
 * die Dichte steht still.
 */

/** Nebeldichte folgt der Tageszeit wie bisher. */
export const NEBEL_AUTOMATISCH = -1;

/** Wetter wird wie bisher gewürfelt. */
export const WETTER_AUTOMATISCH = '';

export interface WetterVorgabe {
  /**
   * Name der festgenagelten Umgebung (`Misty`, `Clear`, …) oder
   * WETTER_AUTOMATISCH. Geprüft wird gegen `findEnvironment()` — ein
   * Tippfehler in server.yml darf nicht in einer Welt ohne Wetter enden.
   */
  readonly umgebung: string;
  /**
   * Feste Nebeldichte oder NEBEL_AUTOMATISCH. Exponentieller Nebel
   * (EXP2), Werte über ~0,2 sind praktisch undurchsichtig.
   */
  readonly nebelDichte: number;
}

export const WETTER_VORGABE_AUS: WetterVorgabe = {
  umgebung: WETTER_AUTOMATISCH,
  nebelDichte: NEBEL_AUTOMATISCH,
};

/**
 * Obergrenze für die Nebeldichte.
 *
 * Nicht willkürlich: Der dichteste Wert in den Spieldaten ist `Misty`
 * nachts mit 0,15, und schon dort sieht man keine zehn Meter weit. Ein
 * versehentliches `fog-density: 5` in server.yml wäre eine Welt aus
 * einfarbigem Nebel — ohne Fehlermeldung, denn technisch ist der Wert
 * gültig.
 */
export const NEBEL_DICHTE_MAX = 0.5;

/**
 * Ist die Dichte brauchbar? NEBEL_AUTOMATISCH gilt als brauchbar.
 *
 * Bewusst kein Typwächter: Der Aufrufer will den abgelehnten Wert ins
 * Log schreiben können.
 */
export function istNebelDichte(wert: unknown): boolean {
  if (typeof wert !== 'number' || !Number.isFinite(wert)) return false;
  if (wert === NEBEL_AUTOMATISCH) return true;
  return wert >= 0 && wert <= NEBEL_DICHTE_MAX;
}
