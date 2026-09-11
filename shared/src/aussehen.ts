/**
 * Das Aussehen einer Spielfigur — Frisuren und Rüstung.
 *
 * WARUM NEBEN figuren.ts UND NICHT DARIN: `figuren.ts` beantwortet
 * "welcher Körper", diese Datei "was trägt er". Beides ändert sich
 * unabhängig: Eine neue Frisur betrifft keinen Körper, ein neuer
 * Körper erbt alle Frisuren. Zusammengelegt müsste jede Erweiterung
 * die jeweils andere Liste mitlesen.
 *
 * WARUM ÜBERHAUPT EINE LISTE: dieselbe Begründung wie in figuren.ts —
 * der Client zeigt die Auswahl und lädt das Modell, der Server prüft
 * die eingehende Wahl und schreibt sie ans ZDO. Zwei getrennte Listen
 * liefen unweigerlich auseinander.
 *
 * ── Warum die Teile EINZELN geladen werden ──────────────────────────
 * Alle 38 Frisuren und 18 Bärte in einer Datei müsste jeder Spieler
 * herunterladen, obwohl jeweils nur eine Auswahl getragen wird. Getrennt
 * lädt der Client lediglich Körper, gewählte Frisur und gewählten Bart.
 *
 * Das funktioniert nur, weil jede Teildatei DIESELBE Gelenkliste trägt
 * wie der Körper — 63 Knochen, Index für Index gleich. Erzeugt werden
 * sie deshalb ausschliesslich von tools/web/charakterteile-exportieren.py,
 * das genau das nachprüft und sonst abbricht. Wer eine Teildatei von Hand
 * exportiert, riskiert eine Frisur, die im Spiel am Fussgelenk hängt.
 */

/** Ordner unter assets/models/, in dem die Teildateien liegen. */
export const AUSSEHEN_ORDNER = 'wikingerin';

/** Körperdatei — trägt Skelett und alle Animationsclips. */
export const AUSSEHEN_KOERPER = 'WikingerinKoerper';

export interface Frisur {
  /** Stabile Kennung — steht im Spielstand. Nie ändern. */
  readonly id: string;
  /** Dateiname OHNE Endung, unter AUSSEHEN_ORDNER. */
  readonly datei: string;
  /** Beschriftung in der Charaktererstellung. */
  readonly name: string;
}

/**
 * Reihenfolge = Reihenfolge in der Auswahl.
 *
 * Bis die endgültigen Namen feststehen, entspricht die Nummer im Namen
 * der stabilen Kennung. Der Anzeigename darf später geändert werden;
 * `H_07` selbst bleibt unverändert, weil die Kennung im Spielstand steht.
 */
export const FRISUREN: readonly Frisur[] = [
  { id: 'H_01', datei: 'H_01', name: 'Frisur 01' },
  { id: 'H_02', datei: 'H_02', name: 'Frisur 02' },
  { id: 'H_03', datei: 'H_03', name: 'Frisur 03' },
  { id: 'H_04', datei: 'H_04', name: 'Frisur 04' },
  { id: 'H_05', datei: 'H_05', name: 'Frisur 05' },
  { id: 'H_06', datei: 'H_06', name: 'Frisur 06' },
  { id: 'H_07', datei: 'H_07', name: 'Frisur 07' },
  { id: 'H_08', datei: 'H_08', name: 'Frisur 08' },
  { id: 'H_09', datei: 'H_09', name: 'Frisur 09' },
  { id: 'H_10', datei: 'H_10', name: 'Frisur 10' },
  { id: 'H_11', datei: 'H_11', name: 'Frisur 11' },
  { id: 'H_12', datei: 'H_12', name: 'Frisur 12' },
  { id: 'H_13', datei: 'H_13', name: 'Frisur 13' },
  { id: 'H_14', datei: 'H_14', name: 'Frisur 14' },
  { id: 'H_15', datei: 'H_15', name: 'Frisur 15' },
  { id: 'H_16', datei: 'H_16', name: 'Frisur 16' },
  { id: 'H_17', datei: 'H_17', name: 'Frisur 17' },
  { id: 'H_18', datei: 'H_18', name: 'Frisur 18' },
  { id: 'H_19', datei: 'H_19', name: 'Frisur 19' },
  { id: 'H_20', datei: 'H_20', name: 'Frisur 20' },
  { id: 'H_21', datei: 'H_21', name: 'Frisur 21' },
  { id: 'H_22', datei: 'H_22', name: 'Frisur 22' },
  { id: 'H_23', datei: 'H_23', name: 'Frisur 23' },
  { id: 'H_24', datei: 'H_24', name: 'Frisur 24' },
  { id: 'H_25', datei: 'H_25', name: 'Frisur 25' },
  { id: 'H_26', datei: 'H_26', name: 'Frisur 26' },
  { id: 'H_27', datei: 'H_27', name: 'Frisur 27' },
  { id: 'H_28', datei: 'H_28', name: 'Frisur 28' },
  { id: 'H_29', datei: 'H_29', name: 'Frisur 29' },
  { id: 'H_30', datei: 'H_30', name: 'Frisur 30' },
  { id: 'H_31', datei: 'H_31', name: 'Frisur 31' },
  { id: 'H_32', datei: 'H_32', name: 'Frisur 32' },
  { id: 'H_33', datei: 'H_33', name: 'Frisur 33' },
  { id: 'H_34', datei: 'H_34', name: 'Frisur 34' },
  { id: 'H_35', datei: 'H_35', name: 'Frisur 35' },
  { id: 'H_36', datei: 'H_36', name: 'Frisur 36' },
  { id: 'H_37', datei: 'H_37', name: 'Frisur 37' },
  { id: 'H_38', datei: 'H_38', name: 'Frisur 38' },
] as const;

/** Was ein Spieler bekommt, der nie gewählt hat. */
export const FRISUR_VORGABE = FRISUREN[0]!.id;

export interface Bart {
  /** Stabile Kennung; leer bedeutet glatt rasiert. */
  readonly id: string;
  readonly datei: string;
  readonly name: string;
}

export const BAERTE: readonly Bart[] = Array.from({ length: 18 }, (_, index) => {
  const nummer = String(index + 1).padStart(2, '0');
  return { id: `B_${nummer}`, datei: `B_${nummer}`, name: `Bart ${nummer}` };
});

export const BART_VORGABE = '';

export function istBart(id: unknown): boolean {
  return typeof id === 'string' && (id === '' || BAERTE.some((b) => b.id === id));
}

export function bartZu(id: string | null | undefined): Bart | null {
  return BAERTE.find((b) => b.id === id) ?? null;
}

/**
 * Bart und Frisur reisen gemeinsam im vorhandenen Frisurfeld. So bleiben
 * Kontendatenbank, ZDO und ältere Clients kompatibel; `H_04+B_02` bedeutet
 * Frisur H_04 mit Bart B_02, ein altes `H_04` weiterhin nur die Frisur.
 */
export function frisurMitBart(frisur: string, bart: string): string {
  return bart ? `${frisur}+${bart}` : frisur;
}

export function bartAusFrisur(id: string | null | undefined): Bart | null {
  return bartZu(typeof id === 'string' ? id.split('+', 2)[1] : undefined);
}

/**
 * Rüstungsslots. Ein Slot trägt höchstens ein Teil.
 *
 * WARUM SLOTS UND NICHT EINE FLACHE LISTE: Ein BH und eine Hose lassen
 * sich zusammen tragen, ein Kleid und ein BH nicht. Ohne Slots müsste
 * jede neue Kombination von Hand ausgeschlossen werden; mit Slots
 * ergibt sich der Ausschluss von selbst.
 */
export type Slot = 'oberkoerper' | 'beine';

export interface Ruestungsteil {
  readonly id: string;
  readonly datei: string;
  readonly name: string;
  readonly slot: Slot;
}

export const RUESTUNG: readonly Ruestungsteil[] = [
  { id: 'leder_bh', datei: 'R_LederBH', name: 'Leder-Oberteil', slot: 'oberkoerper' },
  { id: 'leder_shorts', datei: 'R_LederShorts', name: 'Lederhose, kurz', slot: 'beine' },
] as const;

/** Kennt die Liste diese Frisur? Der Server glaubt dem Client nichts. */
export function istFrisur(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const [frisur, bart = ''] = id.split('+', 2);
  return FRISUREN.some((f) => f.id === frisur) && istBart(bart);
}

/** Kennt die Liste dieses Rüstungsteil? Leerstring = nichts angezogen. */
export function istRuestung(id: unknown): boolean {
  return typeof id === 'string' && (id === '' || RUESTUNG.some((r) => r.id === id));
}

/**
 * Kennung → Frisur. Unbekanntes fällt auf die Vorgabe zurück statt zu
 * werfen: Eine entfernte Frisur darf einen alten Spielstand nicht
 * unbrauchbar machen — dieselbe Regel wie bei figurZu().
 */
export function frisurZu(id: string | null | undefined): Frisur {
  const frisur = typeof id === 'string' ? id.split('+', 1)[0] : undefined;
  return FRISUREN.find((f) => f.id === frisur) ?? FRISUREN[0]!;
}

export function ruestungZu(id: string | null | undefined): Ruestungsteil | null {
  return RUESTUNG.find((r) => r.id === id) ?? null;
}

export interface Haarfarbe {
  /** Stabile Kennung — steht im Spielstand. Nie ändern. */
  readonly id: string;
  /** Beschriftung in der Charaktererstellung. */
  readonly name: string;
  /**
   * Grundfarbe als sRGB-Hex — also das, was ein Mensch liest und was
   * die Webseite unverändert als Farbfleck neben die Auswahl setzen
   * kann.
   *
   * WARUM HEX UND NICHT LINEARE ZAHLEN: Das Material erwartet lineares
   * RGB, aber `#6B4A2F` sagt jedem etwas und `0.148, 0.068, 0.028`
   * niemandem. Die Umrechnung steht an EINER Stelle im Client
   * (`Color3.FromHexString(hex).toLinearSpace()`); stünde sie in der
   * Liste, müsste sie jeder Ersteller einer neuen Farbe von Hand
   * richtig machen.
   */
  readonly hex: string;
}

/**
 * Haarfarben.
 *
 * WARUM EINE PALETTE UND KEIN FARBWÄHLER: Der Server prüft jede
 * eingehende Kennung nach dem Muster "steht sie in der Liste"
 * (istFigur/istFrisur/istRuestung). Eine Palette fügt sich da ohne
 * Sonderfall ein. Ein freier Wert bräuchte eine eigene Prüfart, und
 * gewonnen wäre wenig: Die Frisuren tragen eine FLACHE Farbe ohne
 * Textur, zwölf gewählte Töne decken davon alles Sinnvolle ab.
 *
 * Die Vorgabe `mittelbraun` liegt bewusst dicht an der bisherigen
 * Platzhalterfarbe des Materials (linear 0,16/0,10/0,05) — Spielstände
 * ohne gespeicherte Farbe sollen nicht plötzlich anders aussehen.
 */
export const HAARFARBEN: readonly Haarfarbe[] = [
  { id: 'rabenschwarz', name: 'Rabenschwarz', hex: '#1A1613' },
  { id: 'dunkelbraun', name: 'Dunkelbraun', hex: '#2E2018' },
  { id: 'kastanie', name: 'Kastanienbraun', hex: '#4A2C1A' },
  // #6F593F ist NICHT gerundet, sondern die Platzhalterfarbe des
  // Materials (linear 0,16/0,10/0,05) in sRGB. Damit sieht ein
  // Spielstand ohne gespeicherte Farbe exakt aus wie bisher.
  { id: 'mittelbraun', name: 'Mittelbraun', hex: '#6F593F' },
  { id: 'hellbraun', name: 'Hellbraun', hex: '#8A6A45' },
  { id: 'aschblond', name: 'Aschblond', hex: '#A89272' },
  { id: 'weizenblond', name: 'Weizenblond', hex: '#C8AB77' },
  { id: 'hellblond', name: 'Hellblond', hex: '#E0CDA0' },
  { id: 'fuchsrot', name: 'Fuchsrot', hex: '#8C3A17' },
  { id: 'kupfer', name: 'Kupferrot', hex: '#B5602A' },
  { id: 'eisgrau', name: 'Eisgrau', hex: '#9A9691' },
  { id: 'schneeweiss', name: 'Schneeweiß', hex: '#DED9D0' },
] as const;

/** Was ein Spieler bekommt, der nie gewählt hat. */
export const HAARFARBE_VORGABE = 'mittelbraun';

/** Kennt die Liste diese Haarfarbe? Der Server glaubt dem Client nichts. */
export function istHaarfarbe(id: unknown): boolean {
  return typeof id === 'string' && HAARFARBEN.some((h) => h.id === id);
}

/**
 * Kennung → Haarfarbe. Unbekanntes fällt auf die Vorgabe zurück statt
 * zu werfen — dieselbe Regel wie bei frisurZu().
 */
export function haarfarbeZu(id: string | null | undefined): Haarfarbe {
  return (
    HAARFARBEN.find((h) => h.id === id) ??
    HAARFARBEN.find((h) => h.id === HAARFARBE_VORGABE)!
  );
}

/** Pfad einer Teildatei, relativ zu assets/models/. */
export function teilPfad(datei: string): string {
  return `${AUSSEHEN_ORDNER}/${datei}.glb`;
}

/**
 * ZDO-Member, in denen das Aussehen steht — wie FIGUR_MEMBER (F17).
 * Als ZDO-Member und nicht als eigener Pakettyp: Der Wert läuft damit
 * im vorhandenen Sync mit, landet im Save und erreicht jeden Peer, der
 * die Figur ohnehin sieht.
 */
export const FRISUR_MEMBER = 'frisur';
export const RUESTUNG_MEMBER = 'ruestung';
export const HAARFARBE_MEMBER = 'haarfarbe';
