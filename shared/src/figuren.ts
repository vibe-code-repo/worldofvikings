/**
 * Die spielbaren Figuren — EINE Liste für Client und Server.
 *
 * WARUM GEMEINSAM: Der Client zeigt sie im Anmeldebildschirm an und lädt
 * das Modell, der Server prüft die eingehende Wahl und schreibt sie ans
 * Charakter-ZDO. Zwei getrennte Listen liefen unweigerlich auseinander —
 * genau das ist in diesem Projekt schon zweimal passiert (das MCP-Schema
 * kannte `meadows`, als die Welt längst `grassland` hiess; `server.yml`
 * versprach sechzehn Schlüssel, die niemand las). Wer eine Figur
 * hinzufügt, trägt sie HIER ein, und beide Seiten wissen davon.
 *
 * WARUM DIE KENNUNG NICHT DER DATEINAME IST: Die Kennung steht im
 * Spielstand und im ZDO jedes Spielers. Ein umbenanntes Modell wäre damit
 * ein kaputter Spielstand. Die Kennung ist stabil, `modell` darf sich
 * ändern.
 */

export interface Figur {
  /** Stabile Kennung — steht im Spielstand und im ZDO. Nie ändern. */
  readonly id: string;
  /**
   * Modellname OHNE Endung — so, wie ihn der AssetManager erwartet
   * (`getMasters('npc_1_walk')`). Die Endung haengt er selbst an.
   * Wer hier `PlayerAvatar.glb` einträgt, bekommt `PlayerAvatar.glb.glb`
   * und einen 404, den man erst am fehlenden Modell im Spiel bemerkt —
   * genau das ist am 22.08.2026 in der ersten Fassung passiert.
   */
  readonly modell: string;
  /** Beschriftung im Anmeldebildschirm. */
  readonly name: string;
}

/**
 * Reihenfolge = Reihenfolge im Anmeldebildschirm.
 *
 * ── Warum nur noch EINE Figur (Stand 22.08.2026) ────────────────────
 * Hier standen drei: `wikinger` (PlayerAvatar), `wikingerin` und
 * `walkuere`. Gepflegt wurde nur die Wikingerin — sie hat als einzige
 * das vollstaendige Rig mit 51 Knochen und 24 Fingern, sechs auf den
 * Boden gesetzte Clips, eine Comic-Hautkarte, 21 Frisuren und Ruestung.
 * Die beiden anderen waren Staende aus frueheren Wochen ohne diese
 * Teile; im Anmeldebildschirm haetten sie eine Auswahl vorgetaeuscht,
 * hinter der nichts steht.
 *
 * ── Warum ein Ordner im Modellnamen steht ───────────────────────────
 * `wikingerin/WikingerinKoerper` ist kein Tippfehler. Die Figur ist in
 * Einzeldateien aufgeteilt — Koerper, 21 Frisuren, Ruestungsteile —,
 * damit die Charaktererstellung nur laedt, was getragen wird: 3,76 MB
 * statt 17,5 MB. Alle Teile liegen unter assets/models/wikingerin/ und
 * tragen dieselbe Gelenkliste; erzeugt werden sie von
 * tools/asset-aufteilen.py, das genau das nachprueft.
 *
 * Die alte Einzeldatei WikingerinBasis.glb bleibt vorerst liegen: Sie
 * ist der Stand, mit dem bis heute gespielt wurde.
 *
 * ── Der Wikinger (09.09.2026) ───────────────────────────────────────
 * `wikinger/WikingerKoerper` ist die Standardfigur aus dem Synty-Rig:
 * 63 Knochen, Clips `idle/gehen/rennen/springen/angriff` (Sprung =
 * Absprung, Flug, Fall; Angriff = Faustschlag). Er steht VORN und ist
 * damit die Vorgabe. Die Wikingerin steht NICHT mehr in der Liste
 * (Mike, 09.09.2026: „den bestehenden ersetzen"): Ein gespeichertes
 * `wikingerin` faellt ueber figurZu() auf den Wikinger zurueck, genau die
 * Regel, fuer die diese Liste gebaut ist. Ihre Dateien und die Teile aus
 * aussehen.ts bleiben liegen; AvatarRig zieht sie nur an, wenn der
 * Koerper wieder die Wikingerin ist.
 *
 * ⚠ Der Wikingerin fehlt der Sprung nicht mehr: Ihre Clips heissen
 * `idle/gehen/rennen/springen/angriff/weitsprung`. AvatarRig sucht sie
 * ueber Namensmuster; `weitsprung` enthaelt bewusst weder "spring" noch
 * "rennen", damit es keinem Zustand untergeschoben wird.
 */
export const FIGUREN: readonly Figur[] = [
  { id: 'wikinger', modell: 'wikinger/WikingerKoerper', name: 'Wikinger' },
] as const;

/** Was ein Spieler bekommt, der nie gewählt hat — der bisherige Charakter. */
export const FIGUR_VORGABE = FIGUREN[0]!.id;

/**
 * Name des ZDO-Members am Charakter-ZDO, in dem die Figur steht.
 *
 * Als ZDO-Member und nicht als eigenes Paket: Der Wert läuft damit im
 * vorhandenen ZDO-Sync mit, landet im Save und erreicht jeden Peer, der
 * die Figur ohnehin schon sieht — dieselbe Begründung wie bei
 * TRUHE_INHALT_MEMBER (F1). Ein eigener Pakettyp müsste Sichtbarkeit,
 * Nachzügler und Persistenz alle drei selbst lösen.
 */
export const FIGUR_MEMBER = 'figur';

/**
 * Kennt die Liste diese Kennung? Der Server glaubt dem Client nichts.
 *
 * Bewusst KEIN Typwaechter (`id is string`): Der Aufrufer uebergibt meist
 * schon einen `string`, und die Verengung machte den Fehlerzweig zu
 * `never` — man koennte den abgelehnten Wert dann nicht einmal mehr ins
 * Log schreiben. Der Gewinn waere ohnehin keiner gewesen: Die Frage ist
 * nicht, ob es ein String ist, sondern ob er in der Liste steht.
 */
export function istFigur(id: unknown): boolean {
  return typeof id === 'string' && FIGUREN.some((f) => f.id === id);
}

/**
 * Kennung → Figur. Unbekanntes fällt auf die Vorgabe zurück, statt zu
 * werfen: Eine Figur, die es nicht mehr gibt (umbenannt, entfernt), darf
 * einen alten Spielstand nicht unbrauchbar machen.
 */
export function figurZu(id: string | null | undefined): Figur {
  return FIGUREN.find((f) => f.id === id) ?? FIGUREN[0]!;
}

/**
 * Modellname OHNE Endung — fuer den AssetManager (fremde Spieler).
 */
export function modellZu(id: string | null | undefined): string {
  return figurZu(id).modell;
}

/**
 * Dateiname MIT Endung — fuer den direkten Loader der eigenen Figur
 * (`SceneLoader.ImportMeshAsync` in AvatarRig, der einen echten
 * Dateinamen will). Zwei Funktionen statt einer, weil genau diese
 * Verwechslung schon einen 404 gekostet hat.
 */
export function modellDateiZu(id: string | null | undefined): string {
  return `${figurZu(id).modell}.glb`;
}

/**
 * Tönung je Figurmodell — der Faktor auf die Basisfarbe (`baseColorFactor`
 * des glTF, `albedoColor` in Babylon), MODELLNAME OHNE ENDUNG als Schlüssel.
 *
 * ── Der Befund (10.09.2026) ─────────────────────────────────────────
 * Seit `wikinger/WikingerKoerper` die Vorgabefigur ist, steht eine WEISSE
 * Figur mit dunkler Hose im Bild (`~/.cache/wov-lab/felsen-lab3-messort.png`);
 * vorher war sie hautfarben (`boden3-lab-messort.png`, die Wikingerin).
 * Am Client liegt das nicht: Die Atlas-Textur wird geladen, richtig
 * orientiert und richtig aus sRGB gewandelt — im Spiel nachgemessen
 * liefert das Hautfeld auf der GPU exakt sRGB 255/204/173, und
 * `_useSRGBBuffer` steht auf true.
 *
 * 255/204/173 IST der Fehler. Linear sind das 1,000 / 0,604 / 0,418 —
 * ein Rotkanal von 1,0 ist als Albedo unmöglich (frischer Schnee liegt
 * bei 0,9). Der Atlas kommt aus Syntys POLYGON-Bestand und ist für deren
 * nahezu unbeleuchteten Unity-Shader gemalt: Der Farbfleck ist dort das
 * FERTIGE Bild, nicht die Albedo. Unter unserer Sonne (1,55) plus
 * Hemisphäre (0,79) landet er weit über 1, und die ACES-Kurve zieht
 * alles über 1 gegen Weiss UND entsättigt es dabei — daher weiss statt
 * bloss hell. Die dunkle Hose bleibt sichtbar, weil ihr Lederfleck als
 * einziger dunkel genug ist.
 *
 * ── Woher der Faktor kommt ──────────────────────────────────────────
 * Aus zwei Messungen an den Texturen, nicht aus dem Gefühl. Bezug ist
 * die Wikingerin — sie ist die Figur, die auf `0db27bf` hautfarben im
 * Bild stand, und ihre Hautkarte (`wikingerin/WikingerinKoerper.glb`,
 * `base_color`) ist eine Fläche: Mittel 222,5/147,6/115,6, 90. Perzentil
 * 223/148/116.
 *
 *   Wikinger-Hautfeld    sRGB 255/204/173   linear 1,0000/0,6038/0,4179
 *   Wikingerin-Hautkarte sRGB 222/148/116   linear 0,7305/0,2961/0,1746
 *   Faktor = Ziel/Quelle                           0,7305/0,4904/0,4179
 *
 * Der Faktor bildet also das Hautfeld des Atlas GENAU auf die Haut der
 * Wikingerin ab — `tools/test/figur-toenung.ts` rechnet das nach, statt
 * die drei Zahlen zu glauben.
 *
 * ── Warum ein Faktor auf den GANZEN Atlas ───────────────────────────
 * Genau dasselbe tut die Speicher-Aufbereitung für jedes andere
 * Synty-Modell im Labor: `tools/store-vegetation-aufbereiten.mjs`
 * schreibt ihre Tönung als `baseColorFactor` ins Material. Der Atlas ist
 * durchgehend zu hell, nicht nur an der Haut; die Hose wird damit
 * ebenfalls dunkler, und das ist richtig — sie ist Leder.
 *
 * ── Warum hier und nicht in der Datei ───────────────────────────────
 * `assets/` liegt ausserhalb des Repos (Mike sichert die Modelle selbst).
 * Eine Korrektur im GLB wäre auf jedem Rechner eine andere Datei; hier
 * ist sie versioniert, und der Test kann sie nachrechnen.
 *
 * ── Warum JEDE Figur hier stehen muss ───────────────────────────────
 * Eine fehlende Zeile hat kein Symptom, das ein Test von selbst sähe:
 * Die Figur lädt, sie bewegt sich, sie ist nur weiss. Genau so ist
 * dieser Fehler entstanden — der Wikinger kam am 09.09. dazu, niemand
 * hat an eine Tönung gedacht, und kein Test wurde rot. `FIGUREN` und
 * diese Tabelle müssen sich deshalb DECKEN (`shared/test/figur-toenung.ts`).
 * Eine Figur, deren Datei ihre Farben selbst mitbringt, trägt die
 * neutrale Tönung `[1, 1, 1]` — dann ist es eine Entscheidung und kein
 * Vergessen. `figurToenung()` gibt für sie `null` zurück, damit die
 * Ladewege ihr `baseColorFactor` aus der Datei NICHT überschreiben.
 *
 * Tint per figure model — the factor on the base colour.
 */
export const FIGUR_TOENUNG: Readonly<Record<string, readonly [number, number, number]>> = {
  'wikinger/WikingerKoerper': [0.7305, 0.4904, 0.4179],
};

/**
 * Tönung zu einem Modellnamen — mit oder ohne `.glb`, weil die drei
 * Ladewege sie unterschiedlich führen: `AvatarRig` und die
 * Charaktervorschau haben den DATEInamen (`modellDateiZu`), der
 * `AssetManager` den Modellnamen (`modellZu`). Ein Schlüssel, der nur
 * eine der beiden Formen träfe, liesse die Figur an genau einer Stelle
 * weiss — und die andere Stelle ist der Anmeldebildschirm, den beim
 * Prüfen niemand zweimal ansieht.
 *
 * `null` für alles Unbekannte: Eine Figur ohne Eintrag bleibt, wie ihre
 * Datei sie meint.
 */
export function figurToenung(modell: string | null | undefined): readonly [number, number, number] | null {
  if (!modell) return null;
  const t = FIGUR_TOENUNG[modell.replace(/\.glb$/i, '')];
  if (!t) return null;
  // Die neutrale Tönung heisst „nicht anfassen", nicht „auf 1 setzen":
  // Ein Modell mit eigenem `baseColorFactor` verlöre ihn sonst.
  return t[0] === 1 && t[1] === 1 && t[2] === 1 ? null : t;
}
