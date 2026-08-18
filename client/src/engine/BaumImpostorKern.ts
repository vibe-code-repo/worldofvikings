/**
 * Der reine Kern des Impostor-Fernfelds — Zuteilung echt/Sprite, Atlasraster,
 * Kartenmasse. KEIN Babylon, KEIN DOM, kein Zustand.
 *
 * ── Warum eine eigene Datei ──────────────────────────────────────────
 * Dasselbe Muster wie SchattenInstanzKeulung.ts: Die Regel, an der der
 * ganze Umbau haengt, ist eine Handvoll Arithmetik — und ihr Fehlerbild ist
 * kein Ruckler, sondern ein BAUM, DER NICHT DA IST (oder doppelt). Genau
 * diese Sorte Fehler findet man beim Durchklicken nicht. Also steht die
 * Regel hier, ohne GPU pruefbar, und client/test/baum-impostor.ts haelt sie
 * fest.
 *
 * ── Der Anlass (Messung Insel 10077/-18723, headed, Tageszeit 0,42) ──
 *   Voll-Master (heute)   16,3 ms CPU   17,1 ms GPU @ 2564 MHz   546 Calls
 *   Zellschnitt 384 m     17,2 ms CPU   13,5 ms GPU @ 2519 MHz  1128 Calls
 *
 * Die beiden Kurven schneiden sich nicht: Der Zellschnitt allein tauscht
 * GPU-Arbeit gegen Zeichenaufrufe. Erst wenn ferne Zellen nicht KLEINER,
 * sondern GAR NICHT MEHR als Geometrie gezeichnet werden, fallen beide
 * zugleich. Das ist dieses Modul.
 */

/**
 * Ab dieser Entfernung (m) wird eine Vegetationsinstanz als Sprite statt
 * als Geometrie gezeichnet.
 *
 * ── Warum 240 und nicht weniger ──────────────────────────────────────
 * Die Schattenkaskaden reichen 150 m weit (Shadows.ts STUFEN, hoechste
 * Stufe `distanz: 150`). Ein Baum, der als Sprite gezeichnet wird, KANN
 * keinen Geometrieschatten mehr werfen — steht er innerhalb der
 * Kaskadendistanz, fehlt sein Schlagschatten, und das ist der auffaelligste
 * denkbare Fehler (Leitplanke 3/4). 240 m laesst 90 m Reserve: Eine 28 m
 * hohe Kiefer4 wirft bei 15 Grad Sonnenstand rund 104 m Schatten, bleibt
 * damit knapp im Rahmen; niedrigere Baeume mit grossem Abstand.
 *
 * ── Was das kostet, ehrlich gerechnet ────────────────────────────────
 * Der Server streamt 9x9 Zonen a 64 m (WovServer.SICHT_RADIUS_ZONEN = 4),
 * also ein Fenster von 576 x 576 m um die Spielerzone. Jenseits von 240 m
 * liegen davon
 *     1 - pi*240^2 / 576^2 = 45 %
 * der Flaeche — mehr Fernfeld gibt es schlicht nicht. Bei 180 m waeren es
 * 69 %, bei 150 m 79 %. Die Grenze ist deshalb bewusst ein STATIC und kein
 * const: Der naechste Schritt ist ein Sweep 150/180/240 gegen die
 * Messbasis, und der braucht sie zur Laufzeit umstellbar
 * (`window.__dbg.impostor.grenze = 180`).
 *
 * NICHT unter 150 gehen, ohne vorher den Schattenwurf zu loesen.
 */
export const IMPOSTOR_GRENZE_M_VORGABE = 240;

/**
 * Gierwinkel je Archetyp. 8 Ansichten = 45 Grad je Paar; zwischen zwei
 * benachbarten Ansichten wird geblendet, der harte Wechsel liegt also bei
 * 22,5 Grad Kamerabewegung um den Baum herum.
 *
 * Die Referenz (ClaudeCraft, foliage_impostor_core.IMPOSTOR_CATEGORY_VIEWS)
 * nimmt 12 fuer Baeume, aber ihre Sprites stehen ab 234 m in einem Fenster,
 * das deutlich tiefer reicht als unsere 576 m. Bei uns liegt der weiteste
 * Sprite rund 300 m weg; um dort das Ansichtspaar zu wechseln, muss die
 * Kamera 2*pi*300/8 = 235 m seitwaerts fahren. 12 Ansichten waeren an
 * dieser Stelle bezahlte Atlasflaeche ohne sichtbaren Gegenwert.
 *
 * KONSTANT ueber alle Archetypen — deshalb ist die Ansichtszahl im Shader
 * ein Uniform und kein Instanzattribut, und das Atlasraster ist ein festes
 * Gitter statt eines Regalpackers (s. atlasRaster()).
 */
export const IMPOSTOR_ANSICHTEN = 8;

/** Kantenlaenge des Atlas in Bildpunkten. 2048 = 16 MiB RGBA. */
export const ATLAS_KANTE_PX = 2048;

/**
 * Groesse EINER Ansichtszelle im Atlas.
 *
 * Dimensioniert nach der ANZEIGEDISTANZ, nicht nach dem Modell (Regel aus
 * der Referenz). Die Brennweite in Bildpunkten ist H/(2*tan(fov/2)) mit
 * fov = 1,05 rad (PlayerController.ts: `camera.fov = 1.05`), bei 1440 px
 * Bildhoehe also 1238 px. Damit misst
 *
 *   ein 12-m-Baum bei 240 m   62 px    gegen 128 px Zellhoehe  (2x ueberabgetastet)
 *   ein 12-m-Baum bei 300 m   50 px
 *   eine 28-m-Kiefer4 bei 240 m 144 px gegen 128 px            (leicht unterabgetastet)
 *
 * 80 x 128 ist bewusst NICHT quadratisch: Baeume sind es auch nicht
 * (Fichte1 real 5,84 x 12,18 m, also 1:2,1). Ein quadratisches Raster
 * verschenkte die Haelfte der Flaeche.
 *
 * Modelle mit anderem Seitenverhaeltnis werden beim Backen in die Zelle
 * GEQUETSCHT und beim Zeichnen exakt wieder auseinandergezogen (das Quad
 * ist breite x hoehe in Metern). Es entsteht also keine Verzerrung, nur
 * anisotrope Texel — bei Kiefer4 (24,1 m breit) 0,30 m/px waagerecht gegen
 * 0,23 m/px senkrecht. Das ist der Preis dafuer, dass ein FESTES Raster
 * moeglich bleibt.
 */
export const ZELL_BREITE_PX = 80;
export const ZELL_HOEHE_PX = 128;

/**
 * Freier Rand je Ansichtszelle, in Bildpunkten.
 *
 * Die 8 Ansichten einer Zeile liegen unmittelbar nebeneinander. Ohne Gosse
 * mischt die Mipkette ab Stufe 2-3 die Nachbaransicht herein, und der Rand
 * einer Fichte traegt ein Stueck der um 45 Grad gedrehten Fichte. Gebacken
 * wird deshalb in das um GOSSE eingerueckte Rechteck, und exakt dieses
 * Rechteck wird auch abgetastet — die Randtexel bleiben auf der Clearfarbe
 * stehen und puffern die Interpolation.
 */
export const ATLAS_GOSSE_PX = 2;

/**
 * Mindesthoehe (m), ab der ein Prefab ueberhaupt eine Atlaszeile bekommt.
 *
 * Ein 0,4 m hohes Heidekraut misst bei 240 m zwei Bildpunkte. Ein Sprite
 * dafuer kostet dieselben zwei Dreiecke wie fuer eine 28-m-Kiefer und
 * dieselbe Atlaszeile — das ist teurer als gar nichts zu zeichnen.
 * Bodenpflanzen und Kleinbuesche gehoeren nicht ins Sprite-Fernfeld,
 * sondern hinter eine eigene Entfernungsgrenze nach dem Muster von
 * GrassClutter (eigener Schritt, noch nicht gebaut — s. Risiken).
 */
export const IMPOSTOR_MIN_HOEHE_M = 1.5;

/**
 * Neigung der Schattierungsnormalen von der Senkrechten Richtung Kamera
 * (0 = Hoch-Normale, 1 = zur Kamera).
 *
 * Eine reine Hoch-Normale nimmt die Lichtantwort der BODENEBENE. Die Sonne
 * dieses Projekts steht nie hoch; bei tiefem Stand ist dot(hoch, sonne)
 * nahe null, und jedes Sprite flacht im selben Bild zu einer gleichmaessig
 * ambient beleuchteten Flaeche ab, waehrend der echte Baum daneben noch
 * eine warme Licht- und eine dunkle Rueckseite zeigt. Genau daran wird die
 * Uebergabegrenze als Ring im Wald sichtbar.
 *
 * Wert aus der Referenz (IMPOSTOR_NORMAL_TILT 0.4): haelt mittags rund
 * 83 % der Hoch-Normalen-Antwort und gewinnt an der Morgenkante Faktor 11.
 */
export const IMPOSTOR_NEIGUNG = 0.4;

/**
 * Faecherung der Normalen ueber die Kartenbreite, in Radiant an der Kante.
 *
 * Ohne sie schattiert die Karte wie eine FLACHE Scheibe: eine Farbe fuer
 * das ganze Sprite. Mit ihr schattiert sie wie ein stehender ZYLINDER und
 * traegt selbst eine Licht- und eine Schattenseite — das ist der
 * Unterschied zwischen "ferner Wald" und "aufgestellte Pappkameraden".
 * Wert aus der Referenz (IMPOSTOR_NORMAL_FAN 1.05).
 */
export const IMPOSTOR_FAECHER = 1.05;

/**
 * Alphaschwelle des Sprite-Materials.
 *
 * Niedriger als die 0,5 der Quellmodelle (GLB alphaCutoff 0.5). Grund ist
 * die Mipkette: Der Mittelwert der Alpha faellt in tieferen Stufen, und mit
 * einer gleich hohen Schwelle loesen sich die Kronenraender mit der
 * Entfernung auf — ein Sprite, das duenner wird, je weiter es weg ist, ist
 * genau das Gegenteil dessen, was es soll.
 */
export const IMPOSTOR_ALPHA_SCHNITT = 0.32;

/**
 * Emissions-Sockel der Krone, multipliziert mit dem Atlas-Texel.
 *
 * Ohne ihn steht das Sprite nachts als schwarze Silhouette, waehrend der
 * echte Baum diesseits der Grenze noch Umgebungslicht traegt. Weil der
 * Sockel mit dem TEXEL multipliziert wird (StandardMaterial addiert
 * `emissiveTexture * level` auf `emissiveColor`), leuchtet nur, wo auch
 * Laub ist — der freigestellte Hintergrund bleibt schwarz.
 */
export const IMPOSTOR_EMISSIONS_SOCKEL = 0.16;

/**
 * Stride der Instanzdaten, die der EntityManager je (Prefab, Zelle) an das
 * Sprite-Feld reicht: x, y, z, breite, hoehe, yaw.
 *
 * Steht im KERN und nicht im Babylon-Modul, damit der EntityManager ihn
 * ohne Laufzeitabhaengigkeit auf BaumImpostor.ts lesen kann — der
 * Rueckweg (BaumImpostor -> EntityManager) ist ein echter Wertimport.
 */
export const SPRITE_STRIDE = 6;

// ── Atlasraster ─────────────────────────────────────────────────────

/** Ein Rechteck in Bildpunkten, Ursprung UNTEN LINKS (WebGL-Konvention). */
export interface PxRechteck {
  x: number;
  y: number;
  b: number;
  h: number;
}

/** Ein Rechteck in Texturkoordinaten, Ursprung unten links. */
export interface UvRechteck {
  u0: number;
  v0: number;
  ub: number;
  vh: number;
}

/**
 * Das feste Atlasraster.
 *
 * ── Warum ein festes Gitter und kein Regalpacker ─────────────────────
 * Die Referenz packt EINMAL, weil sie beim Weltaufbau ihr ganzes Inventar
 * kennt. WoV streamt Prefabs nach: `AssetManager.getMasters()` ist
 * asynchron, und ob eine Fichte4 je auftaucht, entscheidet sich erst,
 * wenn der Spieler dorthin laeuft. Ein Packer muesste den Atlas dann
 * umpacken — also alle bereits gebackenen Zeilen neu backen, mitten im
 * Spiel.
 *
 * Ein festes Raster kostet Flaeche (jede Zeile ist gleich gross, egal wie
 * gross das Modell ist) und schenkt dafuer die Nachreichbarkeit: Eine
 * neue Zeile wird in den bereits stehenden Atlas hineingemalt, ohne dass
 * eine einzige vorhandene sich bewegt. Das ist die zentrale bewusste
 * Abweichung von der Referenz.
 */
export function atlasRaster(): {
  /** Zeilen (= Archetypen) nebeneinander in einer Rasterlinie. */
  spalten: number;
  /** Rasterlinien uebereinander. */
  linien: number;
  /** Wie viele Archetypen der Atlas insgesamt fasst. */
  budget: number;
  /** Breite einer ganzen Zeile (alle Ansichten) in px. */
  zeilenBreitePx: number;
} {
  const zeilenBreitePx = ZELL_BREITE_PX * IMPOSTOR_ANSICHTEN;
  const spalten = Math.floor(ATLAS_KANTE_PX / zeilenBreitePx);
  const linien = Math.floor(ATLAS_KANTE_PX / ZELL_HOEHE_PX);
  return { spalten, linien, budget: spalten * linien, zeilenBreitePx };
}

/**
 * Das BACKRECHTECK einer Ansicht: das um die Gosse eingerueckte Feld, in
 * das die Kamera rendert. Ausserhalb bleibt die Clearfarbe stehen.
 *
 * Wirft, statt still abzuschneiden — ein gewachsenes Kit muss den Aufbau
 * LAUT brechen (Invariante aus der Analyse), damit nicht irgendwann eine
 * Zeile stumm auf einer fremden landet.
 */
export function ansichtRechteck(zeile: number, ansicht: number): PxRechteck {
  const r = atlasRaster();
  if (zeile < 0 || zeile >= r.budget) {
    throw new Error(
      `Impostor-Atlas: Zeile ${zeile} liegt ausserhalb des Budgets von ${r.budget} ` +
        `(${r.spalten} Spalten x ${r.linien} Linien bei ${ATLAS_KANTE_PX} px, ` +
        `Zelle ${ZELL_BREITE_PX}x${ZELL_HOEHE_PX}, ${IMPOSTOR_ANSICHTEN} Ansichten).`
    );
  }
  if (ansicht < 0 || ansicht >= IMPOSTOR_ANSICHTEN) {
    throw new Error(`Impostor-Atlas: Ansicht ${ansicht} ausserhalb 0..${IMPOSTOR_ANSICHTEN - 1}.`);
  }
  const linie = Math.floor(zeile / r.spalten);
  const spalte = zeile % r.spalten;
  return {
    x: spalte * r.zeilenBreitePx + ansicht * ZELL_BREITE_PX + ATLAS_GOSSE_PX,
    y: linie * ZELL_HOEHE_PX + ATLAS_GOSSE_PX,
    b: ZELL_BREITE_PX - 2 * ATLAS_GOSSE_PX,
    h: ZELL_HOEHE_PX - 2 * ATLAS_GOSSE_PX,
  };
}

/**
 * Das UV-Rechteck der ANSICHT 0 einer Zeile plus die Schrittweite.
 *
 * Genau diese vier Zahlen braucht der Shader; Ansicht k liegt um
 * k * schrittU weiter rechts. Weil das Raster fest ist, sind `ub`, `vh`
 * und `schrittU` fuer ALLE Zeilen gleich und liegen als Uniform im Shader
 * — pro Instanz wandert nur (u0, v0) ueber den Puffer.
 */
export function zeilenUv(zeile: number): UvRechteck & { schrittU: number } {
  const r0 = ansichtRechteck(zeile, 0);
  return {
    u0: r0.x / ATLAS_KANTE_PX,
    v0: r0.y / ATLAS_KANTE_PX,
    ub: r0.b / ATLAS_KANTE_PX,
    vh: r0.h / ATLAS_KANTE_PX,
    schrittU: ZELL_BREITE_PX / ATLAS_KANTE_PX,
  };
}

// ── Kartenmasse ─────────────────────────────────────────────────────

/**
 * Breite und Hoehe der Sprite-Karte (in MODELLmetern) aus dem Huellquader.
 *
 * ── Warum der WORST-CASE-Radius und nicht die Boxbreite ──────────────
 * Das Modell dreht sich beim Backen um die Prefab-Achse (x=0, z=0) — das
 * ist dieselbe Achse, um die spaeter der Instanz-Gierwinkel dreht. Der
 * Rahmen muss deshalb fuer JEDEN Gierwinkel passen, sonst schneidet eine
 * Ansicht die Krone ab und die naechste laesst Luft. Die groesste
 * horizontale Reichweite ueber alle Drehungen ist der groesste Abstand
 * einer der vier XZ-Ecken von der Achse.
 *
 * ── Warum die Hoehe bei 0 beginnt ────────────────────────────────────
 * Der Prefab-Ursprung IST der Stammfuss (AssetManager.zuMaster baeckt die
 * Hierarchie in localMatrix, der Ursprung bleibt der der ZDO-Platzierung).
 * Was darunter liegt, sind Wurzelanlaeufe, die im Boden stecken; sie
 * werden abgeschnitten, damit das Quad seine Basis exakt auf der
 * ZDO-Hoehe hat und der Sprite nicht schwebt.
 */
export function karteMasse(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  maxY: number
): { breite: number; hoehe: number } {
  const radius = Math.max(
    Math.hypot(minX, minZ),
    Math.hypot(minX, maxZ),
    Math.hypot(maxX, minZ),
    Math.hypot(maxX, maxZ)
  );
  return { breite: 2 * radius, hoehe: Math.max(maxY, 0) };
}

// ── Zuteilung echt / Sprite ─────────────────────────────────────────

/**
 * Lage einer Renderzelle zur Uebergabegrenze.
 *
 * `nah`     — die FERNSTE Ecke liegt noch diesseits: jede Instanz echt.
 * `fern`    — die NAECHSTE Kante liegt schon jenseits: jede Instanz Sprite.
 * `geteilt` — die Zelle liegt auf der Grenze: jede Instanz einzeln.
 */
export type ZellLage = 'nah' | 'fern' | 'geteilt';

/** Darstellung EINER Instanz. Es gibt keinen dritten Wert — s. teileZelle(). */
export type Darstellung = 'echt' | 'sprite';

/** Abstand des NAECHSTEN Punktes der Zelle (cx,cz) zum Punkt (px,pz). */
export function zellNahkante(
  cx: number,
  cz: number,
  zellM: number,
  px: number,
  pz: number
): number {
  const x0 = cx * zellM;
  const z0 = cz * zellM;
  const dx = Math.max(x0 - px, 0, px - (x0 + zellM));
  const dz = Math.max(z0 - pz, 0, pz - (z0 + zellM));
  return Math.hypot(dx, dz);
}

/** Abstand des FERNSTEN Punktes der Zelle (cx,cz) zum Punkt (px,pz). */
export function zellFernkante(
  cx: number,
  cz: number,
  zellM: number,
  px: number,
  pz: number
): number {
  const x0 = cx * zellM;
  const z0 = cz * zellM;
  const dx = Math.max(Math.abs(px - x0), Math.abs(px - (x0 + zellM)));
  const dz = Math.max(Math.abs(pz - z0), Math.abs(pz - (z0 + zellM)));
  return Math.hypot(dx, dz);
}

/**
 * Die Lage einer Zelle — der billige Vorfilter vor der Pro-Instanz-Pruefung.
 *
 * ── Warum das KEINE eigene Wahrheit ist ──────────────────────────────
 * Beide Schnellwege sind aus DERSELBEN Ungleichung abgeleitet, die
 * teileZelle() je Instanz auswertet:
 *   Nahkante >= Grenze  ==>  JEDE Instanz der Zelle hat Abstand >= Grenze
 *   Fernkante <  Grenze ==>  JEDE Instanz der Zelle hat Abstand <  Grenze
 * Beides folgt daraus, dass Nah- und Fernkante Infimum und Supremum der
 * Abstaende ueber das Zellrechteck sind. Es kann deshalb keinen Fall
 * geben, in dem Vorfilter und Pro-Instanz-Regel verschiedener Meinung
 * sind — und genau das ist Leitplanke 4 (genau EINE Darstellung je
 * Instanz), strukturell statt durch Absprache zweier Schwellen.
 *
 * Ohne Atlas gibt es NIE einen Sprite: `atlasBereit === false` heisst
 * durchgehend 'nah'. Der Ausfall des Backens kostet damit das Fernfeld,
 * niemals einen Baum.
 */
export function zellLage(
  cx: number,
  cz: number,
  zellM: number,
  px: number,
  pz: number,
  grenze: number,
  atlasBereit: boolean
): ZellLage {
  if (!atlasBereit) return 'nah';
  if (zellNahkante(cx, cz, zellM, px, pz) >= grenze) return 'fern';
  if (zellFernkante(cx, cz, zellM, px, pz) < grenze) return 'nah';
  return 'geteilt';
}

/**
 * Die EINE Stelle, an der entschieden wird, ob eine Instanz echt oder als
 * Sprite gezeichnet wird.
 *
 * ── Warum ein einziges if/else und keine zwei Shader-Fenster ─────────
 * Die Referenz loest dieselbe Aufgabe mit zwei Shadern und einer
 * byteweise identischen GLSL-Zeile in beiden — und haelt in ihrem eigenen
 * Quelltext fest, dass Treiber-Kontraktion das brechen KANN
 * (foliage_impostor_core.ts:207-216). In Babylon waeren das zwei
 * Material-Plugins in zwei Effekten, also noch mehr Spielraum.
 *
 * Hier fuellt DIESELBE Schleife beide Listen. Ein Index landet in genau
 * einer von beiden, weil es genau ein `else` gibt. Ein Loch oder ein
 * Doppelbild ist damit nicht "unwahrscheinlich", sondern nicht
 * ausdrueckbar.
 *
 * Der Preis: Die Zuteilung friert zwischen zwei Zell-Neuaufbauten ein,
 * haengt der Spielerbewegung also um bis zu einen Streaming-Schritt
 * hinterher. Das ist rein kosmetisch (ein Baum tauscht ein paar Meter zu
 * frueh oder zu spaet) und verletzt die Ein-Darstellungs-Regel NICHT.
 *
 * @param indizes  Instanzindizes dieser Zelle (aus baueZellMaster).
 * @param x,z      Zugriff auf die Weltposition eines Index.
 * @param echt     AUSGABE — wird geleert und gefuellt.
 * @param sprite   AUSGABE — wird geleert und gefuellt.
 */
export function teileZelle(
  indizes: readonly number[],
  x: (i: number) => number,
  z: (i: number) => number,
  lage: ZellLage,
  spielerX: number,
  spielerZ: number,
  grenze: number,
  echt: number[],
  sprite: number[]
): void {
  echt.length = 0;
  sprite.length = 0;
  if (lage === 'nah') {
    for (const i of indizes) echt.push(i);
    return;
  }
  if (lage === 'fern') {
    for (const i of indizes) sprite.push(i);
    return;
  }
  const g2 = grenze * grenze;
  for (const i of indizes) {
    const dx = x(i) - spielerX;
    const dz = z(i) - spielerZ;
    if (dx * dx + dz * dz >= g2) sprite.push(i);
    else echt.push(i);
  }
}

/**
 * Gierwinkel und Skalierung aus einer Babylon-Weltmatrix (row-major, 16
 * Zahlen ab `versatz`).
 *
 * ── Die Annahme, die hier drinsteckt ─────────────────────────────────
 * Eine REINE Y-Drehung. `composeZdoWorld` baut die Matrix aus
 * localScale x scaleScalar x Rotation x Translation; die Rotation der
 * gestreuten Vegetation ist der Zufalls-Yaw des Servers. Kippt ein Prefab
 * zusaetzlich um X oder Z (Hangausrichtung), faellt diese Neigung hier
 * unter den Tisch — der Sprite steht dann senkrecht, wo der echte Baum
 * schraeg stand. Sichtbar waere das nur direkt an der Uebergabegrenze und
 * nur bei stark geneigten Instanzen; ein Sprite kann prinzipbedingt keine
 * Neigung tragen, ohne dass die Billboard-Achse kippt.
 *
 * `-m[2]` und `m[0]` stammen aus DERSELBEN Matrixzeile: ihr gemeinsamer
 * Skalierungsfaktor kuerzt sich im atan2 exakt weg. Ueber zwei Zeilen
 * gemischt (etwa m[8]/m[0]) taete er das bei ungleichmaessiger Skalierung
 * nicht.
 */
export function yawUndSkala(
  m: ArrayLike<number>,
  versatz: number
): { yaw: number; sxz: number; sy: number } {
  const m0 = m[versatz]!;
  const m1 = m[versatz + 1]!;
  const m2 = m[versatz + 2]!;
  const m4 = m[versatz + 4]!;
  const m5 = m[versatz + 5]!;
  const m6 = m[versatz + 6]!;
  return {
    yaw: Math.atan2(-m2, m0),
    sxz: Math.hypot(m0, m1, m2),
    sy: Math.hypot(m4, m5, m6),
  };
}
