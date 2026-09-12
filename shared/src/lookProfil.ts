/**
 * Das Look-Profil — Tonemapping, Nachbearbeitung, Himmel, Schatten, Nebel
 * als EIN Datensatz, den Client und Server gleich lesen.
 *
 * The look profile — tone mapping, post processing, sky, shadows and fog as
 * ONE record that client and server read the same way.
 *
 * ── Warum hier und nicht im Client ───────────────────────────────────
 * Die Werte kommen aus `server/data/server.yml` (`look:`) und müssen an
 * ZWEI Stellen ausgewertet werden: Der Server PRÜFT sie beim Start (ein
 * unbekannter Schlüssel beendet den Start, statt still wirkungslos zu
 * bleiben — dieselbe Haltung wie BEKANNTE_SCHLUESSEL in ServerKonfig.ts),
 * der Client WENDET sie an. Zwei Listen der erlaubten Schlüssel wären die
 * zweite Wahrheit, die beim nächsten Regler auseinanderläuft.
 *
 * ── Farbraum ─────────────────────────────────────────────────────────
 * Farben stehen hier als Hex-Zeichenketten und sind SRGB — genau wie die
 * Werte in `village1.json` des Schwesterprojekts, aus denen sie stammen.
 * Wer sie benutzt, wandelt selbst nach Linear (`Color3.toLinearSpace`),
 * so wie `Lighting.ts` es mit den EnvSetup-Farben tut. Hier roh eine
 * Linearisierung einzubauen hiesse, sie beim nächsten Leser doppelt zu
 * machen — die Gamma-Falle, die diese Codebasis schon zweimal bezahlt hat
 * (StandardGammaFix, PbrNebelFix).
 */

/** Tonemapping-Kurve. `aus` heisst: gar keine, das Bild bleibt roh. */
export type Tonemapping = 'aces' | 'neutral' | 'aus';

/**
 * Nebelkurve.
 *
 * `exp` = lineare Extinktion, `exp2` = quadratische, `linear` = Babylons
 * FOGMODE_LINEAR: voll sichtbar bis `nebelStart`, ab `nebelEnde` ganz
 * Nebel, dazwischen geradlinig. Das ist die Kurve des Vorbilds
 * (`m_FogMode = 1`, design/original-boden.md §D) — und die einzige der
 * drei, die zwei ENTFERNUNGEN statt einer Dichte braucht.
 */
export type Nebelmodus = 'exp' | 'exp2' | 'linear';

/*
 * Die Himmelsregler aus A5/A12 stehen in einer eigenen Datei, weil sie im
 * Block-A-Workflow einem anderen Bauer gehoerten als dieses Profil. Sie
 * sind trotzdem KEINE zweite Wahrheit: die Felder werden unten in
 * `LookHimmel` geerbt, ihre Vorgaben in `LOOK_VORGABE.himmel` gespreizt
 * und ihre Waechter in `BEREICHE` eingehaengt — von hier aus gesehen
 * verhalten sie sich also wie jedes andere Feld des Profils.
 *
 * The sky knobs from A5/A12 live in their own file (a different builder
 * owned them this round) but are wired in as ordinary profile fields:
 * inherited into `LookHimmel`, spread into `LOOK_VORGABE.himmel`, and
 * appended to `BEREICHE`.
 */
import { LOOK_HIMMEL_PLUS_VORGABE, LOOK_HIMMEL_PLUS_BEREICHE, type LookHimmelPlus } from './lookHimmel';

export interface LookBloom {
  an: boolean;
  /** Helligkeit, ab der ein Pixel blüht (0..1 nach Tonemapping). */
  schwelle: number;
  /** Anteil, mit dem die Blüte zurückgemischt wird. */
  staerke: number;
  /** Auflösungsteiler der Blüte-Pyramide. */
  skala: number;
  /**
   * Kerngrösse des Weichzeichners in BILDPUNKTEN.
   *
   * Nicht dasselbe wie Unitys „radius": Der ist ein Stufenfaktor der
   * Bloom-Pyramide, Babylons `bloomKernel` eine Pixelgrösse. Wer die
   * Zahl aus einem Unity-Profil abschreibt, bekommt einen Kernel von
   * fünf Pixeln und wundert sich, warum nichts blüht.
   */
  kernel: number;
}

export interface LookVignette {
  an: boolean;
  staerke: number;
  /** Hex, sRGB. */
  farbe: string;
}

export interface LookCa {
  an: boolean;
  /**
   * Babylons `aberrationAmount` — eine PIXELVERSCHIEBUNG, keine
   * 0..1-Stärke (Babylons Vorgabe ist 30 und damit deutlich sichtbar).
   * Die 4,5 stammen aus der Unity-intensity 0,15 des Vorbilds: 0,15 × 30
   * ≈ 4,5, also dezente Farbsäume nur an kontrastreichen Kanten.
   */
  staerke: number;
}

/**
 * `ShadowsMidtonesHighlights` des Vorbilds — die einzige Komponente,
 * die in Level1 Farbe verschiebt (design/original-boden.md §E).
 *
 * Die Felder stehen so, wie Unity sie ablegt: drei Gammafarben und je
 * ein Offset, dazu zwei Schwellenpaare auf der LUMINANZ. Was daraus
 * wird, rechnet `client/src/engine/Grading.ts` — dort steht auch, warum
 * die Lichter-Zeile des Vorbilds nie feuert.
 */
export interface LookGrading {
  an: boolean;
  /** Hex, sRGB (Unity: `shadows.rgb`). */
  schatten: string;
  /** Unity: `shadows.w`. Positiv wird VERVIERFACHT, negativ nicht. */
  schattenOffset: number;
  /** Luminanz, unter der die Schatten-Zeile voll gilt. */
  schattenStart: number;
  /** Luminanz, ab der sie nicht mehr gilt. */
  schattenEnde: number;
  /** Hex, sRGB. */
  mitten: string;
  mittenOffset: number;
  /** Hex, sRGB. */
  lichter: string;
  lichterOffset: number;
  /** Luminanz, ab der die Lichter-Zeile einsetzt. */
  lichterStart: number;
  lichterEnde: number;
}

export interface LookDof {
  an: boolean;
  /**
   * Fokusentfernung in METERN (URP `focusDistance`).
   *
   * Ersetzt den Autofokus, den `ValheimDof` bisher gefahren hat: Das
   * Vorbild fokussiert FEST auf 2 m und laesst alles dahinter gleich
   * weich werden — es gibt dort keinen Strahl, der die Entfernung sucht.
   */
  fokus: number;
  /** Blendenzahl (URP `aperture`). */
  blende: number;
  /** Brennweite in MILLIMETERN (URP `focalLength`). */
  brennweite: number;
}

export interface LookStrahlen {
  an: boolean;
  /** Entfernung des Ankers vor der Kamera in Metern (ADR-0042: 1400). */
  ankerAbstand: number;
  /** Ab diesem Winkel zwischen Blickachse und Sonne ist der Effekt aus. */
  torWinkel: number;
  /** Breite des Umschaltbands, damit der Pass nicht je Bild an/aus geht. */
  hysterese: number;
  exposure: number;
  decay: number;
  gewicht: number;
  dichte: number;
}

export interface LookHimmel extends LookHimmelPlus {
  /** Hex, sRGB. */
  zenit: string;
  /**
   * Hex, sRGB — ODER `nebel` (Vorgabe).
   *
   * `nebel` heisst: Der Horizont IST die Nebelfarbe. Das ist keine
   * Bequemlichkeit, sondern die Bedingung dafür, dass die Naht zwischen
   * Kuppel und Dunst unsichtbar bleibt. Eine feste Farbe hier zeichnet
   * über dem Meer eine sichtbare Kante, sobald sich Wetter oder Tageszeit
   * bewegen — und beide bewegen sich.
   */
  horizont: string;
  /** Breite des warmen Scheins um die Sonne, 0..1. */
  'sonnenglühen': number;
}

export interface LookSchatten {
  aufloesung: number;
  /** Reichweite der letzten Kaskade in Metern. */
  reichweite: number;
  /**
   * Zahl der Kaskaden, ODER 0 = „die Qualitaetsstufe entscheidet".
   *
   * Wie `reichweite` eine Look-Entscheidung und deshalb ein ERSATZ und
   * kein Deckel: Das Vorbild faehrt auf der wirksamen URP-Stufe
   * genau EINE Kaskade ueber 50 m (§D). Jede Kaskade ist eine eigene
   * Renderpassage ueber die ganze Werferliste — die Zahl kostet also
   * nicht nur Speicher.
   */
  kaskaden: number;
  /** 0 = schwarz, 1 = kein Schatten (Babylons `ShadowGenerator.darkness`). */
  dunkelheit: number;
  /** Kaskadengrenzen auf das Texelraster rasten (`stabilizeCascades`). */
  rasten: boolean;
}

export interface LookProfil {
  tonemapping: Tonemapping;
  belichtung: number;
  kontrast: number;
  /**
   * Sättigung als FAKTOR: 1 = unverändert, 0,45 = der ausgelieferte Wert.
   *
   * Bewusst der Faktor und nicht Babylons Reglerwert. `ColorCurves`
   * führt die Sättigung auf einer Skala von −100 bis +100 mit 0 als
   * neutral und rechnet daraus `1 + s/100` — eine 68 dort heisst also
   * „68 % MEHR Sättigung", das Gegenteil des Gemeinten. Gemessen, weil
   * genau das passiert ist: mit `globalSaturation = 68` stieg die
   * gemessene Sättigung am Referenzort auf 0,98 statt auf 0,45 zu fallen
   * (`~/.cache/wov-lab/licht-nachher-dorf.png`, erster Anlauf).
   *
   * Der Faktor ist ausserdem die Form, in der `village1.json` des
   * Schwesterprojekts die Zahl führt (`saturation: 0.68`) — eine
   * Umrechnung im Kopf beim Abschreiben ist die zweite Fehlerquelle,
   * die diese Wahl beseitigt. Umgerechnet wird an genau EINER Stelle,
   * in `PostProcessing.wendeLookAn()`.
   *
   * Saturation as a FACTOR (1 = unchanged), not Babylon's −100…+100
   * slider, on which 68 means "68 % MORE saturation".
   */
  saettigung: number;
  /** Nebelkurve für Szene UND Boden. */
  nebelmodus: Nebelmodus;
  /**
   * Entfernung, ab der `linear` zu nebeln beginnt (Meter).
   *
   * Nur bei `nebelmodus: linear` gelesen — genau wie im Vorbild, wo
   * `m_FogDensity` neben `m_FogMode = 1` steht und nichts tut.
   */
  nebelStart: number;
  /** Entfernung, ab der `linear` voll deckt (Meter). */
  nebelEnde: number;
  /**
   * Wärme der zweiten Nebelfarbe, 0..1.
   *
   * 0 (Vorgabe) heisst: Die Keyframe-Daten gelten unverändert — bei
   * `Klar-Comic` sind `fogColorSun*` und `fogColor*` dort ohnehin gleich,
   * bei den alten Wettern bleibt ihr gerichteter Nebel wie er war. Ein
   * Wert > 0 mischt `fogColorSun` zur SONNENFARBE hin und holt die alte
   * Handschrift für jedes Wetter zurück, ohne Daten zu ändern.
   */
  nebelWaerme: number;
  grading: LookGrading;
  bloom: LookBloom;
  vignette: LookVignette;
  ca: LookCa;
  dof: LookDof;
  strahlen: LookStrahlen;
  himmel: LookHimmel;
  schatten: LookSchatten;
}

/** Horizont folgt der Nebelfarbe — siehe LookHimmel.horizont. */
export const HORIZONT_AUS_NEBEL = 'nebel';

/**
 * Die Vorgabe: das am Bild kalibrierte „Klar-Comic"-Profil.
 *
 * Herkunft der Zahlen ist der `lighting`-Block von `village1.json` im
 * Schwesterprojekt (Sonne #ffe4c6, Nebel exp/#a3afbd, ACES 1,15/1,1,
 * Sättigung 0,68, Bloom 0,85/0,22, Vignette 1,2 #0d0a08, Schatten
 * 2048/120 m/0,42). Vier Zahlen weichen ab, und jede Abweichung ist
 * gemessen statt gewählt:
 *
 *  · `tonemapping: neutral` mit `saettigung 0,45` statt ACES mit 0,68.
 *
 *    ── Das ist die eine Stelle, an der die Vorlage NICHT überträgt ───
 *    Gemessen am Referenzort (10077/−18723, Klar-Comic, Tagesbruchteil
 *    0,7083), sieben Einstellungen VERSCHRÄNKT in EINER Sitzung, also
 *    am selben Bildinhalt (`~/wov-lab-mess/licht-kalibrieren.mjs`,
 *    Rohwerte in `~/.cache/wov-lab/licht-kalibrierung.json`). Ziel sind
 *    die Werte des Zielbilds `village-square-staging.png` unter
 *    derselben Rechnung: ferner Boden Luma 57,4 / Sättigung 0,447,
 *    naher Boden 55,8 / 0,395.
 *
 *      Tonemapper  Bel.  Sätt.  ferner Boden   naher Boden
 *      ACES        1,15  0,68   41,7 / 0,471   34,3 / 0,553
 *      ACES        1,75  0,45   48,5 / 0,406   36,0 / 0,416
 *      ACES        1,90  0,55   53,7 / 0,480   40,4 / 0,494
 *      ACES        2,00  0,68   53,6 / 0,586   39,9 / 0,603
 *      Neutral     1,00  0,45   57,0 / 0,403   53,2 / 0,449
 *      Neutral     1,05  0,45   57,4 / 0,404   53,4 / 0,449  ← gewählt
 *      Neutral     1,00  0,50   57,0 / 0,443   53,2 / 0,494
 *
 *    ACES kommt am nahen Boden auch mit Belichtung 2,0 nicht über 40
 *    Luma, während der Himmel dabei auf 71 steigt — es fehlt nicht an
 *    Licht, die Kurve drückt die unteren zwei Drittel des Bildes
 *    zusammen. Genau das steht seit einem Jahr als Messung in
 *    `PostProcessing.ts` („auf unserer Gamma-LDR-Pipeline dunkelt ACES
 *    doppelt ab"), und diese Reihe bestätigt es an einer zweiten Szene.
 *
 *    Der WIDERSPRUCH zu ADR-0040 des Schwesterprojekts ist keiner:
 *    Dort ist gemessen, dass Neutral BUNTER ist als ACES (0,70 gegen
 *    0,52) — und genau deshalb steht hier 0,45 statt 0,68. Beide
 *    Projekte zielen auf dasselbe ERGEBNIS (~0,45 gemessene Sättigung);
 *    nur der Reglerwert, mit dem man dorthin kommt, ist ein anderer.
 *    Die Zahl aus der Vorlage abzuschreiben hätte das Ziel verfehlt,
 *    obwohl beide Male dieselbe Zahl dagestanden hätte.
 *
 *    ACES bleibt eine Zeile in server.yml entfernt (`tonemapping: aces`).
 *
 *  · `nebelmodus: exp` mit der Dichte AUS DEM WETTER, nicht 0,0005: Der
 *    Boden des Schwesterprojekts potenziert den Nebelfaktor mit 2,2,
 *    dieser Client tut das nirgends. `pow(exp(-d·z), 2.2) = exp(-2.2·d·z)`
 *    — dieselbe Sicht braucht hier also die 2,2-fache Dichte. Das ist
 *    kein Näherungswert, sondern eine Identität; `sichtweite()` unten
 *    rechnet sie nach.
 *  · `ca` und `dof` bleiben AN. Das Schwesterprojekt hat beides nicht,
 *    das Vorbild zeigt beides (Farbsäume am Schild, unscharfe Ferne).
 *  · `saettigung` steht als FAKTOR (0,68), so wie village1.json sie
 *    führt — nicht als Babylons Reglerwert. Die Umrechnung auf dessen
 *    −100…+100-Skala steht an der einen Stelle, die sie bindet.
 */
/*
  ── Diese Vorgabe IST `server.yml` (Roadmap-Paket 0.8, 12.09.2026) ────

  Bis hierher wich sie an sechs Stellen ab — `belichtung` 1,0 gegen 1,42
  war die auffaelligste. Das ist kein Schoenheitsfehler: Diese Werte
  gelten in genau dem Fenster zwischen dem ersten Bild und dem Eintreffen
  des `look:`-Blocks vom Server ([[wov-servereinstellungen-erreichen-
  clients-erst-beim-anmelden]]), und im Editor sowie in jedem Werkzeug
  ohne Serververbindung gelten sie dauerhaft. Eine abweichende Vorgabe
  heisst also: Der Ladebildschirm, der Editor und die Messzellen zeigen
  ein anderes Bild als das Spiel — und weil beide „richtig" aussehen,
  faellt es niemandem auf.

  `server/test/stufe2-licht.ts` haelt die Gleichheit Feld fuer Feld fest
  („LOOK_VORGABE deckt sich mit server.yml"). Wer hier eine Zahl aendert,
  aendert sie dort mit — oder der Test sagt, welche.

  Die `himmel`-Zusatzfelder aus `LOOK_HIMMEL_PLUS_VORGABE` stehen absicht-
  lich NICHT in `server.yml`; der Test vergleicht nur, was dort steht.
*/
/*
  ── Runde 2, 12.09.2026: Neutral statt Kontrast 0,84 ──────────────────

  Fuenf der Zahlen unten haben sich gedreht, und sie haengen an EINER
  Messreihe. Sie steht hier, weil sie zugleich die GRENZE dieser Regler
  beschreibt.

  Gemessen wurde VERSCHRAENKT: eine Anmeldung, eine Pose, danach nur noch
  an `imageProcessingConfiguration` gedreht (`~/wov-lab-mess/
  tm-sweep.mjs`). Jede Zeile misst dieselben Bildpunkte im selben
  Wolkenstand. Dass das noetig ist, ist selbst gemessen: zwei getrennte
  Anmeldungen auf dem UNVERAENDERTEN Stand lieferten am `steinkreis`
  47,6 und 40,6 Luma fuer denselben Wiesengrund — sieben Luma
  Unterschied, ohne dass ein Regler bewegt worden waere.

  ── Die Grenze: ein VERHAELTNIS bewegt keiner dieser Regler ───────────
  Pose `weitblick`, 12:00, Neutral, Kontrast 1,0, Saettigung 1,0 — nur
  die Belichtung gedreht:

    belichtung   1,42   1,63   1,80   2,00   2,20   2,40   2,80   3,00
    Wiesengrund  36,6   39,0   40,7   42,8   44,7   46,6   50,1   51,7
    Himmel      135,8  146,2  153,9  162,0  170,0  177,0  207,7  209,2

  Die Zielbaender der Referenz sind Wiesengrund 52–58 UND Himmel 142 ± 4.
  Das erste verlangt Belichtung ab 3,0, das zweite 1,47–1,63 — ein Faktor
  zwei auseinander. Der Grund ist gegenueber dem Himmel rund doppelt zu
  dunkel, und ein VERHAELTNIS bewegt weder Belichtung noch Tonwertkurve:
  Beide greifen VOR der Kurve an, der Himmel steigt mit. Mit ACES ist es
  schlechter, nicht besser (Himmel/Grund 6,55 bei Belichtung 2,0 gegen
  Neutrals 3,75).

  Runde 1 hat dieses Verhaeltnis mit `kontrast 0,84` erkauft — Babylon
  mischt unter 1,0 gegen Mittelgrau, das hebt den Grund und senkt den
  Himmel (Verhaeltnis 2,67). Der Preis ist ein Mittelgrau-Anteil auf
  JEDEM Bildpunkt und ein Bildkontrast p95/p5 von 3,03 statt der 5–6, auf
  die die Referenz zeigt. Der Regler ist deshalb zurueck auf 1,0; die
  fehlende Grundhelligkeit gehoert den Spitzenfarben von Gras und Laub.

  ── Was die Umstellung bringt und was sie kostet ─────────────────────
  v0 = Stand Runde 1, neu = die Werte unten, je verschraenkt gemessen:

    weitblick 12:00        v0      neu    Ziel
      Wiesengrund L       52,9    39,0    52–58      offen (Material)
      Wiesengrund S      0,440   0,461    0,42–0,47  getroffen
      Himmel L           141,3   146,2    142 ± 4    Oberkante
      Bild-Saettigung    0,221   0,235    —
      Bildkontrast        3,03    4,52    Richtung 5–6
      Ferne/Himmel       0,563   0,383    0,53 ± 0,08  VERFEHLT
      Clipping           0 / 0   0 / 0    0

    steinkreis 18:18       v0      neu    Ziel
      Wiesengrund L       47,6    32,4    ≥ 40       offen (Material)
      Bild-Saettigung    0,149   0,226    ≥ 0,30     offen (Material)
      Bildkontrast        3,39    5,79    5–6        getroffen

  NACHGEMESSEN BEI DER ZUSAMMENFUEHRUNG (12.09.2026): Die Tabelle oben
  ist in einem Arbeitsbaum OHNE `assets/models` entstanden — dort holt
  der Client `clutter_default.glb` nicht, und die Welt steht ganz ohne
  Grasbueschel da (s. tools/README.md, „Wer MISST, braucht auch
  assets/models"). Mit vollstaendiger Welt, gleiche Posen, gleiche Uhr,
  beide Staende auf demselben Baum:

    weitblick 12:00        v0      neu    Ziel
      Wiesengrund L       65,0    51,7    52–58      knapp darunter
      Wiesengrund S      0,458   0,441    0,42–0,47  getroffen
      Himmel L (Rechteck) 141,1  146,1    142 ± 4    Oberkante
      Bildkontrast        2,85    4,17    Richtung 5–6
      Ferne/Himmel       0,647   0,545    0,53 ± 0,08  GETROFFEN
      Clipping           0 / 0   0 / 0    0

    steinkreis 18:18       v0      neu    Ziel
      Wiesengrund L       56,2    41,3    ≥ 40       GETROFFEN
      Bild-Saettigung    0,167   0,220    ≥ 0,30     offen
      Bildkontrast        3,14    5,18    5–6        getroffen

  Der Befund dreht sich damit an zwei Stellen um: `Ferne/Himmel` ist
  keine verfehlte Zeile mehr (die fehlenden Altbestandsbaeume hatten die
  Ferne leer gelassen), und die Grundhelligkeit ist keine Luecke von 14
  Luma, sondern von 0,3 bzw. erfuellt. Die Aussage „die fehlende
  Grundhelligkeit gehoert den Spitzenfarben" traegt trotzdem NICHT: Beide
  Spitzenfarben-Hebel sind mittelwerttreu gebaut und nachgemessen, sie
  koennen einen Mittelwert gar nicht heben. Was den Grund hebt, sind die
  Bueschel selbst.

  Die zwei VERFEHLTEN Zeilen — in der vollstaendigen Welt bleibt davon
  die Bild-Saettigung am steinkreis — sind keine Feinjustage:
   · `Ferne/Himmel` faellt durch die KURVE, nicht durch den Nebel (bei
     unveraendertem Nebelstart 15 steht sie schon auf 0,402). Der
     Neutral-Mapper zieht `min(r,g,b)` ab und trifft damit die dunkle
     Ferne haerter als den hellen Himmel. Wer die Zahl zurueckholen
     will, braucht mehr Nebel in der Ferne — also `nebelEnde`, und das
     ist die gemessene Entscheidung E3 und eine eigene Karte.
   · Die Grundhelligkeit an beiden Posen ist die Spaltung von oben.

  ── Und die Nacht (?t=0), gemessen statt vermutet ────────────────────
  Drei Staende, dieselbe Sitzung, dieselben Bildpunkte:

                          v0 (R1)   vor R1   neu
    Wiesengrund L           35,0     19,4    17,0
    Himmel L                47,5     34,7    18,9
    Bild-Saettigung        0,152    0,242   0,352
    Bild-Farbton (Mittel)    265°     246°    150°

  Der Farbton der EINZELNEN Flaechen bleibt (Himmel 237° → 224°, Gras
  56° → 60°); was kippt, ist das MITTEL — der ohnehin dunkle Nachthimmel
  verliert 46 % seiner Helligkeit, und damit uebernimmt das Gruen der
  Vegetation das Bild. Das ist der eine Punkt dieser Runde, der eine
  Sichtprobe braucht und den keine Zahl entscheidet.

  Round 2 (12 Sep 2026): the Neutral tone mapper with +0.2 EV replaces
  the sub-1.0 contrast round 1 used to buy ground brightness. The
  measured ground/sky ratio cannot be moved by exposure or by a tone
  curve at all; that gap belongs to the grass and leaf materials. Two
  numbers regress and are named above rather than smoothed over.
*/
export const LOOK_VORGABE: LookProfil = {
  /*
    `neutral` statt `aus` (Entscheidung Mike, 12.09.2026): Village1 ist
    das Leitbild fuer die freie Welt, und Village1 faehrt den
    Neutral-Tonemapper mit +0,2 EV. Die Begruendung fuer `aus` bezog
    sich auf die neun SPIEL-Level; das Dorf ist keins davon.

    ── Die Falle beim Nachmessen ──────────────────────────────────────
    Babylons Konstanten sind TONEMAPPING_STANDARD 0, _ACES 1,
    _KHR_PBR_NEUTRAL 2 — die Shader-DEFINES dagegen 1, 2 und 3. Wer beim
    Messen die Define-Zahl als `toneMappingType` setzt, bekommt fuer
    „Neutral" den Typ 3; der faellt in Babylons `default`-Zweig und
    rechnet die alte Exp-Kurve. Der Setter meldet dabei brav `3`
    zurueck. Eine ganze Messreihe dieser Runde ist so entstanden und
    musste wiederholt werden; seither liest `tm-sweep.mjs` das DEFINE
    aus dem uebersetzten Effekt der Kamera.

    Was der Mapper bringt: Bildkontrast 3,03 → 4,52 (weitblick 12:00)
    und 3,39 → 5,79 (steinkreis 18:18, ins Zielband). Was er kostet:
    Grundhelligkeit und die Ferne (s. oben).
  */
  tonemapping: 'neutral',
  /*
    1,42 × 2^0,2 = 1,6315 — die +0,2 EV des Leitbilds, auf den am Bild
    kalibrierten Pegel gerechnet. Unitys `postExposure` steckt in URPs
    `LutBuilder3D` im `_ColorFilter` und wirkt damit VOR dem Tonemapper,
    genau wie Babylons `exposureLinear` (`result.rgb *= exposureLinear`
    steht in `imageProcessingFunctions` vor der Kurve). Die beiden
    Regler sitzen an derselben Stelle der Kette und duerfen deshalb
    ineinander gerechnet werden.

    Sie trifft die Oberkante des Himmelsbands (146,2 gegen 146). Das ist
    innerhalb dessen, was der Wolkenstand ueber eine lange Messreihe
    ohnehin bewegt: In einer Reihe mit 24 Zeilen stand derselbe v0-Himmel
    am Anfang auf 141,3 und am Ende auf 148,9, waehrend der Wiesengrund
    beide Male exakt 52,9 zeigte.

    Die zwei Alternativen sind mitgemessen und beide schlechter:

      Kandidat            Himmel   Wiesengrund   Wiesengrund
                          12:00    12:00         steinkreis 18:18
      1,50 (Band mittig)  139,9    37,5          31,2
      1,6315 (+0,2 EV)    146,2    39,0          32,4   ← gewaehlt
      2,00                162,0    42,8          35,5

    Die 1,50 ist aus dem Zielwert rueckwaerts gerechnet und laesst den
    Grund noch tiefer stehen; die 2,00 reisst den Himmel um 16 Luma auf,
    ohne den Grund in sein Band zu bringen. Die 1,6315 ist die einzige
    der drei, die aus dem Leitbild folgt.
  */
  belichtung: 1.6315,
  /*
    Zurueck auf 1,0 — die Zahl, die das Vorbild fuehrt (es hat gar
    keinen Kontrastregler). Die 0,84 war der Griff, mit dem Runde 1 die
    Grundhelligkeit erkauft hat; sie mischt das ganze Bild gegen
    Mittelgrau und ist damit der graue Schleier selbst.

    Ein Kontrast UEBER 1,0 zeigt in Richtung des Zielbands 5–6 und ist
    mitgemessen (`weitblick`/12:00, Neutral, Belichtung 1,6315):

      kontrast     1,00   1,10   1,20   1,30
      Bildkontrast 4,53   4,91   5,27   5,68
      Wiesengrund  39,0   37,0   35,0   33,0
      Himmel      146,2  147,5  149,3  151,1

    Er kauft den Kontrast also mit genau der Grundhelligkeit, die hier
    ohnehin fehlt, und hebt den Himmel zusaetzlich aus seinem Band.
    Erst wenn die Spitzenfarben von Gras und Laub stehen, ist diese
    Zeile wieder frei. Am `steinkreis` wird das Band 5–6 schon mit 1,0
    erreicht (5,79).
  */
  kontrast: 1.0,
  /*
    0,45 ist KEINE Rueckkehr zur alten Labor-Erfindung, sondern die
    Korrektur fuer eine gemessene Eigenschaft des Neutral-Mappers: Er
    zieht `min(r,g,b) − 6,25·min²` von allen drei Kanaelen ab, und auf
    unserem dunklen Wiesengrund bleibt davon fast nichts vom Blaukanal
    uebrig. ROH steigt die Saettigung des Rechtecks `vordergrund_gras`
    dadurch auf 0,916 — mehr als das Doppelte des Zielbands.

    Gemessen (weitblick 12:00, Belichtung 1,6315, Nebelstart 50):

      saettigung     0,35   0,40   0,45   0,50   0,55   0,60   0,70   1,00
      Wiesengrund S 0,367  0,414  0,461  0,507  0,552  0,596  0,681  0,916
      Bild-S        0,188  0,211  0,235  0,258  0,281  0,303  0,347  0,467

    0,45 trifft das Zielband des Wiesengrunds (0,42–0,47) und hebt die
    Bildsaettigung gegenueber Runde 1 trotzdem (0,221 → 0,235 hier,
    0,149 → 0,226 am `steinkreis`).

    Die zweite Zielzahl — Bild-Saettigung am `steinkreis` ≥ 0,30 —
    erreicht sie NICHT; dafuer braeuchte es rund 0,65, und dort steht
    der Wiesengrund dann auf S 0,652 statt 0,461. EIN globaler Faktor
    kann nur eines von beiden. Gewaehlt ist das Band, das GLEICHES mit
    GLEICHEM vergleicht (dasselbe Rechteck im Referenzbild); die
    Bildsaettigung ist ein Mittel ueber alles, und was sie am
    `steinkreis` drueckt, ist der grosse, fast graue Himmel — kein Fall
    fuer einen Saettigungsregler.
  */
  saettigung: 0.45,
  nebelmodus: 'linear',
  /*
    ── Nebelstart 15 → 50 m ───────────────────────────────────────────
    Bei 15 m liegt schon ueber dem Nahbereich Dunst; im Bild ist das der
    „Schleier" ueber dem Waldrand. Gemessen an der Pose `steinkreis`,
    18:18, auf dem neuen Stand, nur `scene.fogStart` gedreht (der Boden
    liest ihn je Bild aus der Szene, s. `setzeNebelmodus`):

      nebelStart        15     30     40     50     60     70
      Bild-Saettigung 0,179  0,205  0,218  0,226  0,227  0,228
      Bildkontrast     7,23   6,21   5,93   5,79   5,77   5,79
      Ferne/Himmel    0,417  0,399  0,396  0,412  0,423  0,411
      Himmel L        123,0  120,3  122,6  122,5  120,1  123,3
      Wiesengrund L    32,3   32,4   32,4   32,4   32,4   32,4

    Vier Ablesungen, eine Antwort:
     1. Die Bild-Saettigung waechst bis 50 m um 0,047 und danach um
        0,002 auf zwanzig weitere Meter — 50 m holt 96 % des Gewinns.
     2. Der Bildkontrast faellt von 7,23 (ueber dem Zielband) auf 5,79
        und landet damit IM Band 5–6. Der Nebel bei 15 m sass auf dem
        mittleren Grund und hat die untere Bildhaelfte gespreizt.
     3. Der Himmel bewegt sich ueber die ganze Reihe nicht (120–123) —
        Wolken und Kuppel bleiben, was sie waren. Das war die Bedingung.
     4. Der Nahbereich verliert nichts: 32,4 Luma ueber die ganze Reihe.

    Ferne/Himmel bleibt dabei, wo es ist (0,417 → 0,412); dass die Zahl
    ausserhalb ihres Bands liegt, hat die Kurve zu verantworten und
    nicht diese Zeile (Herleitung im Block oben).
  */
  nebelStart: 50,
  nebelEnde: 800,
  nebelWaerme: 0,
  // Die Dorf-Zeile der Entscheidung E1, roh (0,9800831 / 0,92229587 /
  // 1,0) mit Offset −0,044477392, in Hex gerundet (Rundungsfehler
  // hoechstens 0,0038). Der Offset ist NEGATIV — positiv wirkt er in
  // dieser Zeile vierfach. `schattenEnde` muss unter `lichterStart`
  // bleiben, sonst wird das Mittengewicht negativ; `pruefeLook` sieht
  // das nicht, `setzeGrading` warnt, und `client/test/grading-
  // schatten.ts` rechnet beides nach.
  grading: {
    an: true,
    schatten: '#faebff',
    schattenOffset: -0.044477392,
    schattenStart: 0,
    schattenEnde: 0.3,
    mitten: '#fff5e6',
    mittenOffset: -0.014825796,
    lichter: '#ffffff',
    lichterOffset: 0,
    lichterStart: 0.55,
    lichterEnde: 1.0,
  },
  bloom: { an: true, schwelle: 0.35, staerke: 0.55, skala: 0.5, kernel: 32 },
  vignette: { an: true, staerke: 0.686, farbe: '#0d0a08' },
  ca: { an: true, staerke: 3.0 },
  dof: { an: true, fokus: 2.0, blende: 6.0, brennweite: 47 },
  strahlen: {
    an: true,
    ankerAbstand: 1400,
    torWinkel: 55,
    hysterese: 5,
    exposure: 0.18,
    decay: 0.965,
    gewicht: 0.5,
    dichte: 0.94,
  },
  himmel: { zenit: '#6B8798', horizont: '#8D9598', 'sonnenglühen': 0.2, ...LOOK_HIMMEL_PLUS_VORGABE },
  // `kaskaden: 2` ist kein Geschmack, sondern der Deckel, den Babylons
  // `CascadedShadowGenerator` ohnehin zieht (`MIN_CASCADES_COUNT`); eine 1
  // hier waere nur eine falsche Auskunft. `dunkelheit` ist Babylons
  // RESTLICHT im Schatten, nicht seine Staerke — 0,20 laesst den
  // Schlagschatten als Form lesbar werden. Die Gesamthelligkeit trug
  // dazu bis zur Runde 2 `kontrast 0,84`; seit dessen Rueckbau auf 1,0
  // steht sie allein an `belichtung` und an den Materialfarben.
  schatten: { aufloesung: 1024, reichweite: 50, kaskaden: 2, dunkelheit: 0.2, rasten: true },
};

// ── Nebelkurve ───────────────────────────────────────────────────────

/**
 * Sichtweite: Entfernung, ab der nur noch `schwelle` der Eigenfarbe
 * durchkommt (Babylons `fog` ist der SICHTBARKEITS-Anteil, 1 = klar).
 *
 *   exp   fog = exp(−d·z)        →  z = −ln(s) / d
 *   exp2  fog = exp(−(d·z)²)     →  z = sqrt(−ln(s)) / d
 *
 * Das ist die eine Stelle, an der die beiden Kurven vergleichbar werden.
 * Wer nur die Dichte übernimmt, wechselt zugleich die Sichtweite — und
 * zwar bei kleinen Dichten um mehr als eine Zehnerpotenz.
 */
export function sichtweite(
  modus: Nebelmodus,
  dichte: number,
  schwelle = 0.5,
  start = 0,
  ende = 0
): number {
  // `linear` kennt gar keine Dichte: Die Sichtbarkeit faellt geradlinig
  // von 1 bei `start` auf 0 bei `ende`, die halbe Sicht liegt also genau
  // in der Mitte. Wer hier die Dichte einsetzte, bekaeme eine Zahl aus
  // einer Kurve, die nicht laeuft.
  if (modus === 'linear') return start + (ende - start) * (1 - schwelle);
  if (!(dichte > 0)) return Number.POSITIVE_INFINITY;
  const l = -Math.log(schwelle);
  return modus === 'exp' ? l / dichte : Math.sqrt(l) / dichte;
}

/** Umkehrung: welche Dichte erreicht diese Sichtweite auf dieser Kurve? */
export function dichteFuerSichtweite(
  modus: Nebelmodus,
  weite: number,
  schwelle = 0.5
): number {
  // Fuer `linear` gibt es keine Dichte — die Sicht steht dort in
  // `nebelStart`/`nebelEnde`. NaN statt einer stillen Zahl: Ein Aufrufer,
  // der hier landet, rechnet mit der falschen Groesse.
  if (modus === 'linear') return Number.NaN;
  const l = -Math.log(schwelle);
  return modus === 'exp' ? l / weite : Math.sqrt(l) / weite;
}

// ── Prüfung und Mischung ─────────────────────────────────────────────

/**
 * Die erlaubten Schlüssel, aus der VORGABE abgeleitet statt daneben
 * aufgeschrieben. Eine handgepflegte Liste wäre genau die zweite
 * Wahrheit, gegen die BEKANNTE_SCHLUESSEL in ServerKonfig.ts antritt —
 * nur eine Ebene tiefer und deshalb noch leichter zu vergessen.
 */
function erlaubteSchluessel(vorlage: unknown, pfad: string): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (typeof vorlage !== 'object' || vorlage === null) return map;
  for (const [k, v] of Object.entries(vorlage as Record<string, unknown>)) {
    map.set(pfad ? `${pfad}.${k}` : k, v);
  }
  return map;
}

/**
 * Plausible Bereiche, wo eine Zahl allein nicht reicht.
 *
 * Die Liste ist kurz und absichtlich unvollständig: Sie fängt genau die
 * Werte ab, bei denen eine falsche SKALA wie eine gültige Zahl aussieht.
 * Der teuerste Fall ist gemessen — `saettigung: 68` (Babylons Reglerwert
 * statt des Faktors) rutschte durch die Typprüfung, wurde im Client zu
 * `(68−1)·100 = 6700`, klemmte auf Babylons Maximum und lieferte ein
 * knallgrünes Bild mit Sättigung 1,00 statt 0,45. Eine Obergrenze von 4
 * hätte den Start beendet, bevor irgendjemand ein Bild gemacht hat.
 *
 * Ranges for the values where a wrong SCALE still looks like a valid
 * number — measured: `saettigung: 68` slipped through and produced 6700.
 */
const BEREICHE: ReadonlyMap<string, readonly [number, number]> = new Map([
  ['look.belichtung', [0, 8]],
  ['look.kontrast', [0, 4]],
  ['look.saettigung', [0, 4]],
  ['look.nebelWaerme', [0, 1]],
  ['look.nebelStart', [0, 4000]],
  ['look.nebelEnde', [1, 20000]],
  ['look.grading.schattenOffset', [-1, 1]],
  ['look.grading.mittenOffset', [-1, 1]],
  ['look.grading.lichterOffset', [-1, 1]],
  ['look.grading.schattenStart', [0, 2]],
  ['look.grading.schattenEnde', [0, 2]],
  ['look.grading.lichterStart', [0, 2]],
  ['look.grading.lichterEnde', [0, 2]],
  ['look.dof.fokus', [0.1, 2000]],
  ['look.dof.blende', [0.5, 64]],
  ['look.dof.brennweite', [1, 600]],
  ['look.schatten.kaskaden', [0, 4]],
  ['look.bloom.schwelle', [0, 4]],
  ['look.bloom.staerke', [0, 4]],
  ['look.bloom.skala', [0.05, 1]],
  ['look.bloom.kernel', [1, 512]],
  ['look.vignette.staerke', [0, 10]],
  ['look.ca.staerke', [0, 64]],
  ['look.strahlen.ankerAbstand', [200, 9000]],
  ['look.strahlen.torWinkel', [0, 90]],
  ['look.strahlen.hysterese', [0, 30]],
  ['look.strahlen.exposure', [0, 2]],
  ['look.strahlen.decay', [0, 1]],
  ['look.strahlen.gewicht', [0, 4]],
  ['look.strahlen.dichte', [0, 1]],
  ['look.himmel.sonnenglühen', [0, 1]],
  ...LOOK_HIMMEL_PLUS_BEREICHE,
  ['look.schatten.aufloesung', [128, 4096]],
  ['look.schatten.reichweite', [10, 2000]],
  ['look.schatten.dunkelheit', [0, 1]],
]);

/** Ein Befund der Prüfung: Pfad und was daran nicht stimmt. */
export interface LookFehler {
  pfad: string;
  grund: string;
}

/**
 * Prüft einen rohen `look:`-Block gegen LOOK_VORGABE.
 *
 * Gemeldet wird BEIDES: unbekannte Schlüssel und Werte vom falschen Typ.
 * Ein unbekannter Schlüssel ist der gefährlichere Fall — er sieht aus
 * wie ein Regler und ist keiner —, deshalb steht er zuerst.
 */
export function pruefeLook(roh: unknown, pfad = 'look'): LookFehler[] {
  const fehler: LookFehler[] = [];
  if (roh === undefined || roh === null) return fehler;
  if (typeof roh !== 'object' || Array.isArray(roh)) {
    return [{ pfad, grund: 'erwartet einen Abschnitt (Schlüssel: Wert)' }];
  }
  const vorlage = pfadWert(LOOK_VORGABE, pfad === 'look' ? '' : pfad.slice(5));
  const erlaubt = erlaubteSchluessel(vorlage, '');
  for (const [k, v] of Object.entries(roh as Record<string, unknown>)) {
    if (!erlaubt.has(k)) {
      fehler.push({
        pfad: `${pfad}.${k}`,
        grund: `liest niemand (bekannt: ${[...erlaubt.keys()].join(', ')})`,
      });
      continue;
    }
    const soll = erlaubt.get(k);
    if (typeof soll === 'object' && soll !== null) {
      fehler.push(...pruefeLook(v, `${pfad}.${k}`));
      continue;
    }
    if (v === null || v === undefined) continue;
    if (typeof soll === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) {
      fehler.push({ pfad: `${pfad}.${k}`, grund: `erwartet eine Zahl, bekam ${JSON.stringify(v)}` });
    } else if (typeof soll === 'number' && typeof v === 'number') {
      const bereich = BEREICHE.get(`${pfad}.${k}`);
      if (bereich && (v < bereich[0] || v > bereich[1])) {
        fehler.push({
          pfad: `${pfad}.${k}`,
          grund: `${v} liegt ausserhalb von ${bereich[0]}..${bereich[1]} — Skala verwechselt?`,
        });
      }
    } else if (typeof soll === 'boolean' && typeof v !== 'boolean') {
      fehler.push({ pfad: `${pfad}.${k}`, grund: `erwartet true/false, bekam ${JSON.stringify(v)}` });
    } else if (typeof soll === 'string' && typeof v !== 'string') {
      fehler.push({ pfad: `${pfad}.${k}`, grund: `erwartet Text, bekam ${JSON.stringify(v)}` });
    }
  }
  // Aufzählungen kennen ihre Werte selbst.
  if (pfad === 'look') {
    const tm = (roh as Record<string, unknown>).tonemapping;
    if (typeof tm === 'string' && !['aces', 'neutral', 'aus'].includes(tm)) {
      fehler.push({ pfad: 'look.tonemapping', grund: `erwartet aces|neutral|aus, bekam "${tm}"` });
    }
    const nm = (roh as Record<string, unknown>).nebelmodus;
    if (typeof nm === 'string' && !['exp', 'exp2', 'linear'].includes(nm)) {
      fehler.push({ pfad: 'look.nebelmodus', grund: `erwartet exp|exp2|linear, bekam "${nm}"` });
    }
  }
  return fehler;
}

/** `look.himmel.zenit` → der Vorgabewert an dieser Stelle. */
function pfadWert(wurzel: unknown, pfad: string): unknown {
  if (!pfad) return wurzel;
  let hier: unknown = wurzel;
  for (const teil of pfad.split('.').filter(Boolean)) {
    if (typeof hier !== 'object' || hier === null) return undefined;
    hier = (hier as Record<string, unknown>)[teil];
  }
  return hier;
}

/**
 * Vorgabe + Teilangabe → vollständiges Profil.
 *
 * Die Unterabschnitte werden EINZELN gemischt und nicht ersetzt. Genau
 * dieser Fehler steht als Falle in ADR-0040 des Schwesterprojekts: Ein
 * `{ bloom: { staerke: 0.4 } }` würde sonst Schwelle, Skala und Kernel
 * auf `undefined` setzen und der Regler täte etwas anderes als er sagt.
 */
export function mischeLook(teil: unknown, vorgabe: LookProfil = LOOK_VORGABE): LookProfil {
  const aus = { ...vorgabe } as Record<string, unknown>;
  if (typeof teil !== 'object' || teil === null) return aus as unknown as LookProfil;
  for (const [k, v] of Object.entries(teil as Record<string, unknown>)) {
    if (!(k in vorgabe)) continue;
    if (v === null || v === undefined) continue;
    const soll = (vorgabe as unknown as Record<string, unknown>)[k];
    if (typeof soll === 'object' && soll !== null && typeof v === 'object' && !Array.isArray(v)) {
      aus[k] = { ...(soll as object), ...gefiltert(v as Record<string, unknown>, soll as object) };
    } else if (typeof soll === typeof v) {
      aus[k] = v;
    }
  }
  return aus as unknown as LookProfil;
}

function gefiltert(v: Record<string, unknown>, soll: object): Record<string, unknown> {
  const aus: Record<string, unknown> = {};
  for (const [k, w] of Object.entries(v)) {
    if (!(k in soll)) continue;
    if (w === null || w === undefined) continue;
    if (typeof (soll as Record<string, unknown>)[k] !== typeof w) continue;
    aus[k] = w;
  }
  return aus;
}

// ── Strahlen-Tor (ADR-0042) ──────────────────────────────────────────

/**
 * Winkel zwischen Blickachse und Sonnenrichtung in Grad.
 *
 * Beide Vektoren müssen normalisiert sein; der Aufrufer hat sie ohnehin
 * so. `clamp` gegen Rundung: `Math.acos(1.0000001)` ist NaN, und ein NaN
 * im Tor unten hiesse „Effekt bleibt an, wo er lügt".
 */
export function strahlenWinkel(
  blick: { x: number; y: number; z: number },
  zurSonne: { x: number; y: number; z: number }
): number {
  const d = blick.x * zurSonne.x + blick.y * zurSonne.y + blick.z * zurSonne.z;
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}

/**
 * Das Tor mit Hysterese: 0 = ganz aus, 1 = volle Stärke.
 *
 * Warum überhaupt ein Tor: Der Ursprung des Strahlenkranzes kommt aus
 * einer Projektion, und eine perspektivische Division kann einen Punkt
 * VOR der Kamera nicht von seinem Spiegelbild dahinter unterscheiden.
 * Jenseits von 90° landet der projizierte Ursprung wieder im Bild — der
 * Effekt malt dann einen Kranz um eine Sonne, die im Rücken steht.
 *
 * Warum ein BAND und keine Kante: Ohne Hysterese schaltet ein Schwenk
 * entlang der Schwelle eine komplette zweite Szenenpassage in jedem Bild
 * an und aus. Der Rampenwert wird auf die Belichtung gelegt, damit das
 * Abhängen unsichtbar bleibt.
 */
export function strahlenTor(winkel: number, torWinkel: number, hysterese: number): number {
  const oben = torWinkel;
  const unten = Math.max(0, torWinkel - hysterese);
  if (winkel <= unten) return 1;
  if (winkel >= oben) return 0;
  return (oben - winkel) / (oben - unten);
}
